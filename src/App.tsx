import { useCallback, useEffect, useState } from 'react';
import { BotRulesView } from './components/BotRulesView';
import { HistoryView, type HistorySubTab } from './components/HistoryView';
import { KpiStrip } from './components/KpiStrip';
import { MarketScannerView } from './components/MarketScannerView';
import { PhantomWalletView } from './components/PhantomWalletView';
import { PortfolioView } from './components/PortfolioView';
import { TopBar, type ActiveTab } from './components/TopBar';
import { createInitialPortfolioState } from './shared/analyzer';
import type {
  AppStateResponse,
  BotSettings,
  MarketSnapshotResponse,
  PortfolioState,
  ScanLogEntry,
} from './shared/types';
import { formatUsd } from './utils/formatters';
import {
  connectPhantomWallet,
  disconnectPhantomWallet,
  getPhantomProvider,
} from './utils/phantom';

const BACKUP_STORAGE_KEY = 'victorinox_portfolio_backup_v1';

const EMPTY_MARKET: MarketSnapshotResponse = {
  tokens: [],
  fetchedAt: Date.now(),
  sourceStatus: 'live',
  sourceMessage: 'Conectando con DexScreener y GeckoTerminal...',
};

function saveLocalBackup(portfolio: PortfolioState) {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(portfolio));
  } catch {
    // Ignore storage quota errors
  }
}

function readLocalBackup(): PortfolioState | null {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PortfolioState;
    if (parsed && typeof parsed.cashUsd === 'number' && parsed.settings) {
      return parsed;
    }
  } catch {
    // Ignore malformed storage
  }
  return null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('market');
  const [historySubTab, setHistorySubTab] = useState<HistorySubTab>('trades');
  const [portfolio, setPortfolio] = useState<PortfolioState>(
    () => readLocalBackup() ?? createInitialPortfolioState()
  );
  const [market, setMarket] = useState<MarketSnapshotResponse>(EMPTY_MARKET);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [scanBanner, setScanBanner] = useState<string | null>(null);
  const [hasCheckedBackup, setHasCheckedBackup] = useState<boolean>(false);
  const [phantomPublicKey, setPhantomPublicKey] = useState<string | null>(null);
  const [phantomSwapMint, setPhantomSwapMint] = useState<string | null>(null);

  const loadState = useCallback(
    async (forceRefresh = false) => {
      try {
        const res = await fetch(forceRefresh ? '/api/state?refresh=1' : '/api/state');
        if (!res.ok) throw new Error('Error al consultar el servidor');
        const data = (await res.json()) as AppStateResponse;
        let activePortfolio = data.portfolio;

        if (!hasCheckedBackup) {
          setHasCheckedBackup(true);
          const serverIsClean =
            activePortfolio.trades.length === 0 &&
            activePortfolio.positions.length === 0 &&
            activePortfolio.scanLogs.length === 0 &&
            activePortfolio.totalRechargedUsd === 0 &&
            activePortfolio.learningProfile.totalBuysStudied === 0 &&
            activePortfolio.learningProfile.totalSellsStudied === 0;

          const backup = readLocalBackup();
          const backupHasData =
            backup &&
            (backup.trades.length > 0 ||
              backup.positions.length > 0 ||
              backup.scanLogs.length > 0 ||
              backup.cashUsd !== 1_000_000);

          if (serverIsClean && backup && backupHasData) {
            const restoreRes = await fetch('/api/restore-state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ portfolio: backup }),
            });
            if (restoreRes.ok) {
              const restored = (await restoreRes.json()) as { portfolio?: PortfolioState };
              if (restored.portfolio) {
                activePortfolio = restored.portfolio;
              }
            }
          }
        }

        setPortfolio(activePortfolio);
        saveLocalBackup(activePortfolio);
        setMarket(data.market);
        setErrorBanner(null);
        setSelectedTokenId((prev) => {
          if (prev && data.market.tokens.some((t) => t.token.id === prev)) return prev;
          return data.market.tokens[0]?.token.id ?? null;
        });
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'No se pudo cargar el mercado.');
      } finally {
        setIsLoading(false);
      }
    },
    [hasCheckedBackup]
  );

  useEffect(() => {
    loadState(false);
    const poll = setInterval(() => {
      void loadState(false);
    }, 15_000);
    return () => clearInterval(poll);
  }, [loadState]);

  useEffect(() => {
    const provider = getPhantomProvider();
    if (!provider) return;

    connectPhantomWallet(true)
      .then((pubkey) => setPhantomPublicKey(pubkey))
      .catch(() => {
        // Not trusted yet; user connects on demand
      });

    const handleDisconnect = () => setPhantomPublicKey(null);
    const handleAccountChanged = (newPubkey: unknown) => {
      if (newPubkey && typeof (newPubkey as { toBase58?: () => string }).toBase58 === 'function') {
        setPhantomPublicKey((newPubkey as { toBase58(): string }).toBase58());
      } else {
        setPhantomPublicKey(null);
      }
    };

    provider.on('disconnect', handleDisconnect);
    provider.on('accountChanged', handleAccountChanged);
    return () => {
      provider.off?.('disconnect', handleDisconnect);
      provider.off?.('accountChanged', handleAccountChanged);
    };
  }, []);

  async function handleScanNow() {
    setIsScanning(true);
    setScanBanner(null);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = (await res.json()) as {
        portfolio?: PortfolioState;
        market?: MarketSnapshotResponse;
        scanLog?: ScanLogEntry;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Error en el escaneo');
      if (data.portfolio) {
        setPortfolio(data.portfolio);
        saveLocalBackup(data.portfolio);
      }
      if (data.market) {
        setMarket(data.market);
        setSelectedTokenId((prev) => prev || data.market?.tokens[0]?.token.id || null);
      }
      if (data.scanLog) {
        setScanBanner(
          data.scanLog.tokensBought > 0
            ? `Escaneo completado: ${data.scanLog.tokensBought} compras automáticas ejecutadas por ${formatUsd(data.scanLog.totalSpentUsd)}.`
            : `Escaneo completado: ${data.scanLog.tokensEvaluated} tokens analizados, sin compras nuevas.`
        );
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Error al escanear el mercado.');
    } finally {
      setIsScanning(false);
    }
  }

  async function handleManualBuy(tokenId: string, stakeUsd: number) {
    try {
      const res = await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, stakeUsd }),
      });
      const data = (await res.json()) as { portfolio?: PortfolioState; error?: string };
      if (!res.ok || !data.portfolio) {
        return { ok: false, error: data.error || 'Error al ejecutar la compra' };
      }
      const nextPortfolio = data.portfolio;
      setPortfolio(nextPortfolio);
      saveLocalBackup(nextPortfolio);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error de red al comprar' };
    }
  }

  async function handleClosePosition(positionId: string) {
    try {
      const res = await fetch('/api/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId }),
      });
      const data = (await res.json()) as { portfolio?: PortfolioState; error?: string };
      if (!res.ok || !data.portfolio) {
        return { ok: false, error: data.error || 'Error al cerrar la posición' };
      }
      const nextPortfolio = data.portfolio;
      setPortfolio(nextPortfolio);
      saveLocalBackup(nextPortfolio);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error de red al vender' };
    }
  }

  async function handleRecharge(
    action: { type: 'reset' } | { type: 'add'; amountUsd: number } | { type: 'set'; amountUsd: number }
  ) {
    const res = await fetch('/api/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    const data = (await res.json()) as { portfolio?: PortfolioState };
    if (res.ok && data.portfolio) {
      setPortfolio(data.portfolio);
      saveLocalBackup(data.portfolio);
    }
  }

  async function handleResetAll(keepSettings = true) {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepSettings }),
    });
    const data = (await res.json()) as { portfolio?: PortfolioState };
    if (res.ok && data.portfolio) {
      setPortfolio(data.portfolio);
      saveLocalBackup(data.portfolio);
    }
  }

  async function handleSaveSettings(next: Partial<BotSettings>) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    const data = (await res.json()) as { portfolio?: PortfolioState };
    if (res.ok && data.portfolio) {
      setPortfolio(data.portfolio);
      saveLocalBackup(data.portfolio);

      const affectsMarketView =
        next.scannerMode !== undefined ||
        next.scannerTimeframe !== undefined ||
        next.chartTimeframe !== undefined ||
        next.maxAgeHours !== undefined ||
        next.displayLimit !== undefined ||
        next.scannerSortBy !== undefined ||
        next.riskyMinScorePct !== undefined ||
        next.riskyMinLiquidityUsd !== undefined ||
        next.riskyMinAgeMinutes !== undefined ||
        next.riskyAllowHighRugRisk !== undefined ||
        next.crazyTakeProfitPct !== undefined ||
        next.crazyStopLossPct !== undefined ||
        next.crazyMaxHoldSeconds !== undefined ||
        next.crazyMinLiquidityUsd !== undefined ||
        next.minLiquidityUsd !== undefined ||
        next.minVolume5hUsd !== undefined ||
        next.minTxnsCount !== undefined ||
        next.minBuyRatio !== undefined ||
        next.minVolatilityPct !== undefined ||
        next.minExpectedProfitPct !== undefined;

      if (affectsMarketView) {
        await loadState(true);
      }
    }
  }

  function openStudiesTab() {
    setHistorySubTab('studies');
    setActiveTab('history');
  }

  async function handleConnectPhantom() {
    const pubkey = await connectPhantomWallet(false);
    setPhantomPublicKey(pubkey);
  }

  async function handleDisconnectPhantom() {
    await disconnectPhantomWallet();
    setPhantomPublicKey(null);
  }

  function handleOpenPhantomWithMint(mintAddress: string) {
    setPhantomSwapMint(mintAddress);
    setActiveTab('phantom');
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <TopBar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === 'history') setHistorySubTab('trades');
          setActiveTab(tab);
        }}
        onScanNow={handleScanNow}
        isScanning={isScanning}
        phantomConnected={Boolean(phantomPublicKey)}
      />

      <KpiStrip
        portfolio={portfolio}
        onQuickRecharge={() => handleRecharge({ type: 'reset' })}
        onToggleAutoScan={() =>
          handleSaveSettings({ autoScanEnabled: !portfolio.settings.autoScanEnabled })
        }
        onOpenPortfolio={() => setActiveTab('portfolio')}
      />

      {(errorBanner || scanBanner) && (
        <div className="mx-auto w-full max-w-[1440px] px-6 pt-4">
          {errorBanner && (
            <div
              role="alert"
              className="rounded-lg border border-rose-800/70 bg-rose-950/40 px-4 py-2.5 text-xs font-medium text-rose-300"
            >
              {errorBanner}
            </div>
          )}
          {scanBanner && (
            <div
              role="status"
              className="flex items-center justify-between gap-4 rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-4 py-2.5 text-xs font-medium text-emerald-300"
            >
              <span>{scanBanner}</span>
              <button
                type="button"
                onClick={() => setScanBanner(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      )}

      <main className="flex-1">
        {activeTab === 'market' && (
          <MarketScannerView
            market={market}
            positions={portfolio.positions}
            cashUsd={portfolio.cashUsd}
            settings={portfolio.settings}
            scannerTimeframe={portfolio.settings.scannerTimeframe || '24h'}
            maxAgeHours={portfolio.settings.maxAgeHours}
            displayLimit={portfolio.settings.displayLimit}
            scannerMode={portfolio.settings.scannerMode}
            riskyMinScorePct={portfolio.settings.riskyMinScorePct}
            feeProfile={portfolio.settings.feeProfile}
            simulateExecutionDelay={portfolio.settings.simulateExecutionDelay}
            learningProfile={portfolio.learningProfile}
            selectedTokenId={selectedTokenId}
            onSelectToken={setSelectedTokenId}
            onManualBuy={handleManualBuy}
            onClosePosition={handleClosePosition}
            onManualRefreshScan={async () => {
              setIsScanning(true);
              setScanBanner(null);
              try {
                const res = await fetch('/api/scan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ executeAutoBuys: false }),
                });
                const data = (await res.json()) as {
                  portfolio?: PortfolioState;
                  market?: MarketSnapshotResponse;
                };
                if (res.ok) {
                  if (data.portfolio) {
                    setPortfolio(data.portfolio);
                    saveLocalBackup(data.portfolio);
                  }
                  if (data.market) setMarket(data.market);
                  setScanBanner('Escaneo manual completado (solo análisis, sin compras automáticas).');
                }
              } finally {
                setIsScanning(false);
              }
            }}
            onChangeTimeframe={async (tf) => {
              await handleSaveSettings({ scannerTimeframe: tf });
            }}
            onChangeDisplayLimit={async (limit) => {
              await handleSaveSettings({ displayLimit: limit });
            }}
            onChangeScannerMode={async (mode) => {
              await handleSaveSettings({ scannerMode: mode });
            }}
            onUpdateSettings={handleSaveSettings}
            onOpenLearningTab={openStudiesTab}
            onOpenPhantomSwap={handleOpenPhantomWithMint}
            phantomConnected={Boolean(phantomPublicKey)}
            isLoading={isLoading}
            isScanning={isScanning}
          />
        )}

        {activeTab === 'portfolio' && (
          <PortfolioView
            portfolio={portfolio}
            marketTokens={market.tokens}
            onClosePosition={handleClosePosition}
            onManualBuy={handleManualBuy}
            onRecharge={handleRecharge}
            onResetAll={handleResetAll}
            onUpdateSettings={handleSaveSettings}
            onGoToMarket={() => setActiveTab('market')}
            onOpenLearningTab={openStudiesTab}
            onOpenPhantomSwap={handleOpenPhantomWithMint}
            phantomConnected={Boolean(phantomPublicKey)}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            portfolio={portfolio}
            initialSubTab={historySubTab}
            onResetAll={handleResetAll}
          />
        )}

        {activeTab === 'rules' && (
          <BotRulesView settings={portfolio.settings} onSaveSettings={handleSaveSettings} />
        )}

        {activeTab === 'phantom' && (
          <PhantomWalletView
            phantomPublicKey={phantomPublicKey}
            onConnectPhantom={handleConnectPhantom}
            onDisconnectPhantom={handleDisconnectPhantom}
            marketTokens={market.tokens}
            settings={portfolio.settings}
            preselectedMint={phantomSwapMint}
          />
        )}
      </main>
    </div>
  );
}
