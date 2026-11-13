import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Copy, ExternalLink, RefreshCw, ShieldCheck, Wallet, Zap } from 'lucide-react';
import type { AnalyzedToken, BotSettings } from '../shared/types';
import { formatTokenPrice, formatUsd } from '../utils/formatters';
import {
  DEFAULT_SOLANA_RPC,
  SOL_MINT,
  USDC_MINT,
  executePhantomJupiterSwap,
  fetchJupiterQuote,
  fetchPhantomBalances,
  getSavedRpcUrl,
  isPhantomInstalled,
  saveRpcUrl,
  shortenAddress,
  type JupiterQuoteResponse,
  type PhantomBalances,
} from '../utils/phantom';
import { HelpTooltip } from './HelpTooltip';

interface PhantomWalletViewProps {
  phantomPublicKey: string | null;
  onConnectPhantom: () => Promise<void>;
  onDisconnectPhantom: () => Promise<void>;
  marketTokens: AnalyzedToken[];
  settings: BotSettings;
  preselectedMint?: string | null;
}

export function PhantomWalletView({
  phantomPublicKey,
  onConnectPhantom,
  onDisconnectPhantom,
  marketTokens,
  settings,
  preselectedMint,
}: PhantomWalletViewProps) {
  const [rpcUrl, setRpcUrl] = useState<string>(() => getSavedRpcUrl());
  const [balances, setBalances] = useState<PhantomBalances | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [targetMint, setTargetMint] = useState<string>(
    () => preselectedMint || marketTokens[0]?.token.baseToken.address || ''
  );
  const [payAsset, setPayAsset] = useState<'SOL' | 'USDC'>('SOL');
  const [stakeUsd, setStakeUsd] = useState<number>(settings.botMinStakeUsd || 20);
  const [slippageBps, setSlippageBps] = useState<number>(300);
  const [priorityLamports, setPriorityLamports] = useState<number>(150_000);

  const [quote, setQuote] = useState<JupiterQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const extensionDetected = isPhantomInstalled();

  useEffect(() => {
    if (preselectedMint) {
      setTargetMint(preselectedMint);
      setQuote(null);
      setTxSignature(null);
    }
  }, [preselectedMint]);

  useEffect(() => {
    if (!targetMint && marketTokens[0]?.token.baseToken.address) {
      setTargetMint(marketTokens[0].token.baseToken.address);
    }
  }, [marketTokens, targetMint]);

  async function refreshBalance(pubkey: string, customRpc?: string) {
    setLoadingBalance(true);
    setBalanceError(null);
    try {
      const data = await fetchPhantomBalances(pubkey, customRpc ?? rpcUrl);
      setBalances(data);
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : 'Error leyendo saldo de Phantom.');
    } finally {
      setLoadingBalance(false);
    }
  }

  useEffect(() => {
    if (phantomPublicKey) {
      refreshBalance(phantomPublicKey);
    } else {
      setBalances(null);
    }
  }, [phantomPublicKey]);

  const matchedToken = useMemo(
    () => marketTokens.find((item) => item.token.baseToken.address === targetMint.trim()),
    [marketTokens, targetMint]
  );

  const solPriceUsd = balances?.solPriceUsd || 160;

  async function handleConnectClick() {
    setConnecting(true);
    setActionError(null);
    try {
      await onConnectPhantom();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo conectar con Phantom.');
    } finally {
      setConnecting(false);
    }
  }

  function handleSaveRpc(e: React.FormEvent) {
    e.preventDefault();
    const saved = saveRpcUrl(rpcUrl);
    setRpcUrl(saved);
    if (phantomPublicKey) {
      refreshBalance(phantomPublicKey, saved);
    }
  }

  async function handleFetchQuote() {
    const cleanMint = targetMint.trim();
    if (!cleanMint || cleanMint.length < 32) {
      setActionError('Introduce un Contract Address (CA) válido de Solana.');
      return;
    }
    if (!Number.isFinite(stakeUsd) || stakeUsd < 1) {
      setActionError('El importe USD debe ser mayor o igual a $1.');
      return;
    }

    setQuoting(true);
    setActionError(null);
    setTxSignature(null);
    try {
      const inputMint = payAsset === 'SOL' ? SOL_MINT : USDC_MINT;
      const amountAtomic =
        payAsset === 'SOL'
          ? String(Math.max(10_000, Math.round((stakeUsd / solPriceUsd) * 1e9)))
          : String(Math.max(1_000, Math.round(stakeUsd * 1e6)));

      const result = await fetchJupiterQuote({
        inputMint,
        outputMint: cleanMint,
        amountAtomic,
        slippageBps,
      });
      setQuote(result);
    } catch (err) {
      setQuote(null);
      setActionError(err instanceof Error ? err.message : 'No se encontró ruta en Jupiter.');
    } finally {
      setQuoting(false);
    }
  }

  async function handleSignAndSendSwap() {
    if (!phantomPublicKey || !quote) return;
    setSwapping(true);
    setActionError(null);
    setTxSignature(null);
    try {
      const { signature } = await executePhantomJupiterSwap({
        userPublicKey: phantomPublicKey,
        quoteResponse: quote,
        priorityFeeLamports: priorityLamports,
      });
      setTxSignature(signature);
      refreshBalance(phantomPublicKey);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Transacción cancelada o rechazada en Phantom.'
      );
    } finally {
      setSwapping(false);
    }
  }

  function handleCopyAddress() {
    if (!phantomPublicKey) return;
    navigator.clipboard?.writeText(phantomPublicKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  }

  const routeNames =
    quote?.routePlan
      ?.map((step) => step.swapInfo?.label)
      .filter(Boolean)
      .join(' → ') || 'Jupiter Direct';

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-6 space-y-5">
      {/* Wallet Connection & Balances Header */}
      <div className="rounded-xl border border-slate-800 bg-[#111622] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">
                Conexión Phantom Local (Solana Mainnet)
              </h1>
              <HelpTooltip
                title="Modo 100% local en tu PC"
                what="Conecta tu extensión Phantom directamente en http://localhost:3000 sin subir claves ni alojar ninguna página web."
                why="Tu clave privada nunca sale de tu extensión Phantom: victorinOX solo prepara la ruta de Jupiter y te pide confirmación visual."
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Firma órdenes reales en Solana vía Jupiter desde tu propio PC sin servidores externos ni exposición de llaves.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {phantomPublicKey ? (
              <>
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 font-mono text-xs text-emerald-300 hover:bg-emerald-950/70"
                >
                  <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{shortenAddress(phantomPublicKey)}</span>
                  {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  disabled={loadingBalance}
                  onClick={() => refreshBalance(phantomPublicKey)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingBalance ? 'animate-spin' : ''}`} />
                  <span>Actualizar</span>
                </button>
                <button
                  type="button"
                  onClick={onDisconnectPhantom}
                  className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-950/60"
                >
                  Desconectar
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={connecting}
                onClick={handleConnectClick}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{connecting ? 'Conectando...' : 'Conectar Phantom'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Status / Extension Check + Live Balances */}
        {!extensionDetected && !phantomPublicKey && (
          <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
            <span className="font-semibold">Extensión Phantom no detectada en este navegador:</span>{' '}
            para firmar swaps reales en local, abre{' '}
            <span className="font-mono text-amber-300">http://localhost:3000</span> en Chrome o Brave
            con la extensión Phantom instalada y desbloqueada. Mientras tanto puedes cotizar rutas reales en Jupiter abajo.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 border-b border-slate-800 pb-4">
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
            <p className="text-[11px] text-slate-400">Estado de Wallet</p>
            <p
              className={`mt-1 font-mono text-sm font-semibold whitespace-nowrap ${
                phantomPublicKey ? 'text-emerald-400' : 'text-slate-300'
              }`}
            >
              {phantomPublicKey ? 'Conectada (Local)' : 'Sin conectar'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
            <p className="text-[11px] text-slate-400">Saldo SOL</p>
            <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums whitespace-nowrap">
              {balances ? `${balances.solBalance.toFixed(4)} SOL` : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
            <p className="text-[11px] text-slate-400">Saldo USDC</p>
            <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums whitespace-nowrap">
              {balances ? formatUsd(balances.usdcBalance) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3.5">
            <p className="text-[11px] text-slate-400">Valor estimado total</p>
            <p className="mt-1 font-mono text-sm font-semibold text-emerald-400 tabular-nums whitespace-nowrap">
              {balances ? formatUsd(balances.totalUsd) : '—'}
            </p>
          </div>
        </div>

        {balanceError && (
          <p role="alert" className="text-xs text-rose-400">
            {balanceError}
          </p>
        )}

        {/* Custom Local RPC URL Bar */}
        <form onSubmit={handleSaveRpc} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="phantom-rpc-input" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <span>Nodo RPC Solana local</span>
              <HelpTooltip
                title="Nodo RPC Solana"
                what="Servidor RPC usado por tu PC para leer saldos y enviar confirmaciones."
                why="El RPC público sirve para empezar, pero pegar tu URL gratuita de Helius o QuickNode evita límites de peticiones al operar rápido."
              />
            </label>
            <input
              id="phantom-rpc-input"
              type="url"
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              placeholder={DEFAULT_SOLANA_RPC}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Guardar RPC
          </button>
          <button
            type="button"
            onClick={() => {
              const def = saveRpcUrl(DEFAULT_SOLANA_RPC);
              setRpcUrl(def);
              if (phantomPublicKey) refreshBalance(phantomPublicKey, def);
            }}
            className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            Mainnet estándar
          </button>
        </form>
      </div>

      {/* Swap Executor via Jupiter + Phantom */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111622] p-5 space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Ejecutor directo Jupiter + Phantom (sin salir de localhost)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Cotiza en tiempo real cualquier token detectado por victorinOX y fírmalo directamente en tu billetera Phantom.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="phantom-quick-token" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <span>Elegir token del escáner actual</span>
                <HelpTooltip
                  title="Token rápido del escáner"
                  what="Autocompleta el Contract Address (Mint) de los tokens analizados en Mercado."
                  why="Te permite saltar de una señal Apta de victorinOX a su compra real en segundos sin copiar manualmente direcciones."
                />
              </label>
              <select
                id="phantom-quick-token"
                value={matchedToken ? matchedToken.token.baseToken.address : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    setTargetMint(e.target.value);
                    setQuote(null);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">-- Seleccionar token analizado ({marketTokens.length}) --</option>
                {marketTokens.map((item) => (
                  <option key={item.token.id} value={item.token.baseToken.address}>
                    {item.token.baseToken.symbol} · {item.analysis.verdict} ({item.analysis.aptitudePct}%) ·{' '}
                    {formatTokenPrice(item.token.priceUsd)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="phantom-mint-input" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <span>Contract Address (Mint Solana)</span>
                <HelpTooltip
                  title="Mint Address (CA)"
                  what="Dirección exacta del token SPL en Solana que deseas comprar."
                  why="Verifica siempre que coincide con DexScreener para evitar tokens falsos con el mismo símbolo."
                />
              </label>
              <input
                id="phantom-mint-input"
                type="text"
                value={targetMint}
                onChange={(e) => {
                  setTargetMint(e.target.value);
                  setQuote(null);
                }}
                placeholder="Pega aquí la dirección Mint de Solana..."
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-300">
                  Pagar con
                  <HelpTooltip
                    title="Moneda de pago"
                    what="Activo de tu Phantom usado para comprar el memecoin."
                    why="SOL suele tener rutas más directas en Raydium/PumpSwap; USDC evita exposición al precio de SOL."
                  />
                </span>
                <div className="mt-1 flex rounded-lg border border-slate-700 bg-[#0B0F17] p-0.5">
                  {(['SOL', 'USDC'] as const).map((asset) => (
                    <button
                      key={asset}
                      type="button"
                      onClick={() => {
                        setPayAsset(asset);
                        setQuote(null);
                      }}
                      className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                        payAsset === asset ? 'bg-slate-800 text-emerald-300' : 'text-slate-400'
                      }`}
                    >
                      {asset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="phantom-stake-usd" className="inline-flex items-center gap-1 text-xs font-medium text-slate-300">
                  <span>Importe ($)</span>
                  <HelpTooltip
                    title="Tamaño de orden real"
                    what="Valor aproximado en dólares a intercambiar desde tu Phantom."
                    why="Mantén $20 para alinear riesgo real con tus pruebas en el bot."
                  />
                </label>
                <input
                  id="phantom-stake-usd"
                  type="number"
                  min={1}
                  max={1000}
                  value={stakeUsd}
                  onChange={(e) => {
                    setStakeUsd(Number(e.target.value));
                    setQuote(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="phantom-slippage" className="inline-flex items-center gap-1 text-xs font-medium text-slate-300">
                  <span>Slippage</span>
                  <HelpTooltip
                    title="Tolerancia de Slippage"
                    what="Variación máxima de precio aceptada mientras se confirma el bloque en Solana."
                    why="Tokens nuevos volátiles fallan con <1%; 3% equilibra tasa de éxito frente a bots MEV."
                  />
                </label>
                <select
                  id="phantom-slippage"
                  value={slippageBps}
                  onChange={(e) => {
                    setSlippageBps(Number(e.target.value));
                    setQuote(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value={100}>1.0%</option>
                  <option value={150}>1.5%</option>
                  <option value={300}>3.0%</option>
                  <option value={500}>5.0%</option>
                </select>
              </div>

              <div>
                <label htmlFor="phantom-priority" className="inline-flex items-center gap-1 text-xs font-medium text-slate-300">
                  <span>Prioridad gas</span>
                  <HelpTooltip
                    title="Priority Fee Solana"
                    what="Propina adicional enviada a validadores para entrar antes en el bloque."
                    why="Medio (~0.00015 SOL) ofrece rapidez sin comerse ganancias en jugadas de $20."
                  />
                </label>
                <select
                  id="phantom-priority"
                  value={priorityLamports}
                  onChange={(e) => setPriorityLamports(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value={50000}>Económico</option>
                  <option value={150000}>Medio</option>
                  <option value={500000}>Rápido</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={quoting}
                onClick={handleFetchQuote}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50"
              >
                <Zap className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                <span>{quoting ? 'Cotizando ruta...' : 'Cotizar ruta en Jupiter'}</span>
              </button>

              <button
                type="button"
                disabled={!phantomPublicKey || !quote || swapping}
                onClick={handleSignAndSendSwap}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {swapping
                    ? 'Esperando firma en Phantom...'
                    : 'Firmar y enviar en Phantom'}
                </span>
              </button>
            </div>

            {actionError && (
              <p role="alert" className="text-xs font-medium text-rose-400">
                {actionError}
              </p>
            )}

            {quote && (
              <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Ruta Jupiter:</span>
                  <span className="font-mono text-slate-200">{routeNames}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Impacto en precio est.:</span>
                  <span className="font-mono text-slate-200 tabular-nums">
                    {(Number(quote.priceImpactPct || 0) * 100).toFixed(3)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Cantidad mínima recibida (unidades base):</span>
                  <span className="font-mono text-emerald-400 tabular-nums">
                    {quote.otherAmountThreshold}
                  </span>
                </div>
              </div>
            )}

            {txSignature && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-300">
                <span>Transacción enviada a Solana.</span>
                <a
                  href={`https://solscan.io/tx/${txSignature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono underline hover:text-white"
                >
                  <span>Ver en Solscan</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Right: Local-Only PC Guide & Companion Signals */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111622] p-5 space-y-4 text-xs">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Guía rápida: uso 100% local en tu ordenador
            </h2>
          </div>

          <ol className="space-y-2.5 text-slate-300 list-decimal pl-4">
            <li>
              Descarga o guarda la carpeta del proyecto en tu PC e instala una sola vez con{' '}
              <span className="font-mono text-emerald-300">npm install</span>.
            </li>
            <li>
              Arranca el servidor local con{' '}
              <span className="font-mono text-emerald-300">npm run dev</span> y abre{' '}
              <span className="font-mono text-slate-100">http://localhost:3000</span> en Chrome o Brave (donde tengas Phantom).
            </li>
            <li>
              Tu historial, reglas y cartera virtual se guardan en disco local (
              <span className="font-mono text-slate-400">data/portfolio.json</span>), sin nube ni página web externa.
            </li>
            <li>
              Cuando el escáner encuentre un token apto, pulsa <span className="font-semibold text-slate-100">Comprar en Phantom</span> y aprueba el swap directamente desde la ventana emergente de tu billetera.
            </li>
          </ol>

          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 space-y-1.5">
            <p className="font-semibold text-slate-200 flex items-center justify-between">
              <span>API local para bot externo (opcional)</span>
              <a
                href="/api/signals"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-normal text-emerald-400 hover:underline"
              >
                <span>Probar JSON</span>
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </p>
            <p className="text-[11px] text-slate-400">
              Si quieres conectar un script Node/Python futuro en tu PC, lee las señales listas para comprar desde:
            </p>
            <code className="block rounded bg-[#111622] px-2.5 py-1.5 font-mono text-[11px] text-emerald-300">
              GET http://localhost:3000/api/signals
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
