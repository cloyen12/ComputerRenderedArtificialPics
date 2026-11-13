import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import express from 'express';
import path from 'node:path';
import {
  fetchSolanaPoolLiveDetail,
  fetchTop10VolatileSnapshot,
  searchSolanaTokensDexScreener,
} from './src/server/marketService.ts';
import {
  applyRecharge,
  getPortfolioState,
  manualBuyToken,
  manualClosePosition,
  refreshOpenPositionsPrices,
  resetAllPortfolioHistory,
  restorePortfolioStateFromBackup,
  runMarketScanAndAutoTrade,
  startAutoScannerLoop,
  updateBotSettings,
} from './src/server/store.ts';

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

function resolveSafeRpcUrl(raw?: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return DEFAULT_SOLANA_RPC;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // fallback below
  }
  return DEFAULT_SOLANA_RPC;
}

async function fetchSolPriceUsd(): Promise<number> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`);
    if (res.ok) {
      const json = (await res.json()) as {
        pairs?: Array<{ chainId?: string; priceUsd?: string; liquidity?: { usd?: number } }>;
      };
      const solPair = (json.pairs || [])
        .filter((p) => p.chainId === 'solana' && Number(p.priceUsd) > 0)
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (solPair?.priceUsd) return Number(solPair.priceUsd);
    }
  } catch {
    // ignore transient error
  }
  return 160;
}

async function fetchJupiterWithFallback(
  pathSuffix: string,
  init?: RequestInit
): Promise<Response> {
  const bases = ['https://lite-api.jup.ag/swap/v1', 'https://quote-api.jup.ag/v6'];
  let lastError: Error | null = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${pathSuffix}`, init);
      if (res.ok || res.status < 500) {
        return res;
      }
      lastError = new Error(`Jupiter HTTP ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Network error');
    }
  }
  throw lastError ?? new Error('No se pudo conectar con Jupiter Swap API.');
}

async function bootstrap() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get('/api/state', async (req, res) => {
    try {
      const forceRefresh = req.query?.refresh === '1';
      const portfolio = getPortfolioState();
      const market = await fetchTop10VolatileSnapshot(
        portfolio.settings,
        forceRefresh,
        portfolio.learningProfile
      );
      await refreshOpenPositionsPrices(market);
      res.json({
        portfolio: getPortfolioState(),
        market,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Error al obtener el estado del mercado.',
      });
    }
  });

  app.get('/api/search', async (req, res) => {
    try {
      const q = String(req.query?.q || '').trim();
      if (!q) {
        res.status(400).json({ error: 'Introduce un contrato o símbolo de Solana.' });
        return;
      }
      const portfolio = getPortfolioState();
      const results = await searchSolanaTokensDexScreener(
        q,
        portfolio.settings,
        portfolio.learningProfile
      );
      res.json({ results, query: q, fetchedAt: Date.now() });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Error al buscar en DexScreener.',
      });
    }
  });

  app.get('/api/token/:pairAddress', async (req, res) => {
    try {
      const pairAddress = String(req.params.pairAddress || '').trim();
      if (!pairAddress) {
        res.status(400).json({ error: 'Dirección de pool inválida.' });
        return;
      }
      const portfolio = getPortfolioState();
      const detail = await fetchSolanaPoolLiveDetail(
        pairAddress,
        portfolio.settings,
        portfolio.learningProfile
      );
      if (!detail) {
        res.status(404).json({ error: 'No se encontró información en vivo para este pool de Solana.' });
        return;
      }
      res.json(detail);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Error al consultar el flujo en vivo del token.',
      });
    }
  });

  app.post('/api/scan', async (req, res) => {
    try {
      const executeAutoBuys = req.body?.executeAutoBuys !== false;
      const { market, scanLog } = await runMarketScanAndAutoTrade('manual', executeAutoBuys);
      res.json({
        portfolio: getPortfolioState(),
        market,
        scanLog,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Error al ejecutar el escaneo de 5 horas.',
      });
    }
  });

  app.post('/api/buy', async (req, res) => {
    const tokenId = String(req.body?.tokenId || '');
    const stakeUsd = Number(req.body?.stakeUsd);
    if (!tokenId) {
      res.status(400).json({ error: 'Debes indicar un token válido.' });
      return;
    }

    const result = await manualBuyToken(tokenId, stakeUsd);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ portfolio: result.state });
  });

  app.post('/api/sell', async (req, res) => {
    const positionId = String(req.body?.positionId || '');
    if (!positionId) {
      res.status(400).json({ error: 'Debes indicar una posición válida.' });
      return;
    }

    const result = await manualClosePosition(positionId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ portfolio: result.state });
  });

  app.post('/api/recharge', (req, res) => {
    const type = req.body?.type;
    if (type === 'add' || type === 'set') {
      const amountUsd = Number(req.body?.amountUsd || 0);
      if (!Number.isFinite(amountUsd) || amountUsd < (type === 'set' ? 20 : 1)) {
        res.status(400).json({ error: 'Importe de saldo inválido (mínimo $20 para saldo base).' });
        return;
      }
      const portfolio = applyRecharge({ type, amountUsd });
      res.json({ portfolio });
      return;
    }
    const portfolio = applyRecharge({ type: 'reset' });
    res.json({ portfolio });
  });

  app.post('/api/reset', (req, res) => {
    const keepSettings = req.body?.keepSettings !== false;
    const initialCashUsd =
      req.body?.initialCashUsd !== undefined ? Number(req.body.initialCashUsd) : undefined;
    const portfolio = resetAllPortfolioHistory({ keepSettings, initialCashUsd });
    res.json({ portfolio });
  });

  app.post('/api/restore-state', (req, res) => {
    const backup = req.body?.portfolio;
    if (!backup || typeof backup !== 'object') {
      res.status(400).json({ error: 'Estado de respaldo inválido.' });
      return;
    }
    const portfolio = restorePortfolioStateFromBackup(backup);
    res.json({ portfolio });
  });

  app.post('/api/settings', (req, res) => {
    const portfolio = updateBotSettings(req.body || {});
    res.json({ portfolio });
  });

  app.get('/api/signals', async (_req, res) => {
    try {
      const portfolio = getPortfolioState();
      const market = await fetchTop10VolatileSnapshot(
        portfolio.settings,
        false,
        portfolio.learningProfile
      );
      const actionable = market.tokens
        .filter((item) => item.analysis.verdict === 'COMPRAR')
        .map((item) => ({
          tokenId: item.token.id,
          pairAddress: item.token.pairAddress,
          mintAddress: item.token.baseToken.address,
          symbol: item.token.baseToken.symbol,
          priceUsd: item.token.priceUsd,
          liquidityUsd: item.token.liquidityUsd,
          score: item.analysis.score,
          aptitudePct: item.analysis.aptitudePct,
          rugRiskLevel: item.analysis.rugRiskLevel,
          entryModeUsed: item.analysis.entryModeUsed,
          recommendedStakeUsd: item.analysis.recommendedStakeUsd,
          suggestedStopLossPct: item.analysis.suggestedStopLossPct,
          suggestedTakeProfitPct: item.analysis.suggestedTakeProfitPct,
        }));
      res.json({
        generatedAt: Date.now(),
        scannerMode: portfolio.settings.scannerMode,
        actionable,
        openPositions: portfolio.positions,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Error al generar señales locales.',
      });
    }
  });

  app.get('/api/phantom/balance/:pubkey', async (req, res) => {
    try {
      const rawKey = String(req.params.pubkey || '').trim();
      let owner: PublicKey;
      try {
        owner = new PublicKey(rawKey);
      } catch {
        res.status(400).json({ error: 'Dirección pública de Solana (Phantom) inválida.' });
        return;
      }

      const rpcUrl = resolveSafeRpcUrl(req.query?.rpc);
      const connection = new Connection(rpcUrl, 'confirmed');
      const [lamports, tokenAccounts, solPriceUsd] = await Promise.all([
        connection.getBalance(owner),
        connection
          .getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(USDC_MINT) })
          .catch(() => ({ value: [] })),
        fetchSolPriceUsd(),
      ]);

      const solBalance = Number(lamports) / LAMPORTS_PER_SOL;
      const usdcBalance = tokenAccounts.value.reduce((sum, acct) => {
        const uiAmount =
          (acct.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } })
            ?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        return sum + (Number.isFinite(uiAmount) ? uiAmount : 0);
      }, 0);

      res.json({
        publicKey: owner.toBase58(),
        solBalance,
        usdcBalance,
        solPriceUsd,
        totalUsd: solBalance * solPriceUsd + usdcBalance,
        rpcUsed: rpcUrl,
      });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error
            ? `No se pudo leer saldo desde RPC Solana: ${error.message}`
            : 'No se pudo consultar el saldo de Phantom.',
      });
    }
  });

  app.get('/api/phantom/quote', async (req, res) => {
    try {
      const inputMint = String(req.query?.inputMint || '').trim();
      const outputMint = String(req.query?.outputMint || '').trim();
      const amount = String(req.query?.amount || '').trim();
      const slippageBps = Math.min(2500, Math.max(10, Number(req.query?.slippageBps || 150)));

      if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount) || Number(amount) <= 0) {
        res.status(400).json({ error: 'Parámetros de cotización inválidos.' });
        return;
      }

      const qs = new URLSearchParams({
        inputMint,
        outputMint,
        amount,
        slippageBps: String(slippageBps),
      });
      const jupRes = await fetchJupiterWithFallback(`/quote?${qs.toString()}`);
      const payload = await jupRes.json();
      if (!jupRes.ok) {
        res.status(jupRes.status).json({
          error: (payload as { error?: string })?.error || 'Jupiter no devolvió ruta para este par.',
        });
        return;
      }
      res.json(payload);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Error consultando ruta en Jupiter.',
      });
    }
  });

  app.post('/api/phantom/swap-tx', async (req, res) => {
    try {
      const userPublicKey = String(req.body?.userPublicKey || '').trim();
      const quoteResponse = req.body?.quoteResponse;
      const priorityFeeLamports = Math.min(
        5_000_000,
        Math.max(1_000, Number(req.body?.priorityFeeLamports || 100_000))
      );

      if (!userPublicKey || !quoteResponse || typeof quoteResponse !== 'object') {
        res.status(400).json({ error: 'Faltan datos de wallet o cotización Jupiter.' });
        return;
      }
      try {
        new PublicKey(userPublicKey);
      } catch {
        res.status(400).json({ error: 'Clave pública de Phantom inválida.' });
        return;
      }

      const jupRes = await fetchJupiterWithFallback('/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: priorityFeeLamports,
        }),
      });
      const payload = await jupRes.json();
      if (!jupRes.ok) {
        res.status(jupRes.status).json({
          error: (payload as { error?: string })?.error || 'Jupiter rechazó construir la transacción.',
        });
        return;
      }
      res.json(payload);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Error construyendo swap en Jupiter.',
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`victorinOX server listening on http://0.0.0.0:${PORT}`);
    startAutoScannerLoop();
  });
}

bootstrap();
