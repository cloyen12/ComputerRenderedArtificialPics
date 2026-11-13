import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, Search, SlidersHorizontal, X, XCircle } from 'lucide-react';
import type {
  AnalyzedToken,
  BotLearningProfile,
  BotSettings,
  ChartTimeframe,
  FeeProfile,
  MarketSnapshotResponse,
  Position,
  ScannerMode,
  ScannerSortBy,
  ScannerTimeframeId,
} from '../shared/types';
import {
  formatAge,
  formatCompactUsd,
  formatSignedPct,
  formatTimeShort,
  formatTokenPrice,
} from '../utils/formatters';
import { HelpTooltip } from './HelpTooltip';
import { TokenInspectorPanel } from './TokenInspectorPanel';

interface MarketScannerViewProps {
  market: MarketSnapshotResponse;
  positions: Position[];
  cashUsd: number;
  settings: BotSettings;
  scannerTimeframe: ScannerTimeframeId;
  maxAgeHours: number;
  displayLimit: number;
  scannerMode: ScannerMode;
  riskyMinScorePct: number;
  feeProfile: FeeProfile;
  simulateExecutionDelay: boolean;
  learningProfile: BotLearningProfile;
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string) => void;
  onManualBuy: (tokenId: string, stakeUsd: number) => Promise<{ ok: boolean; error?: string }>;
  onClosePosition: (positionId: string) => Promise<{ ok: boolean; error?: string }>;
  onManualRefreshScan: () => Promise<void>;
  onChangeTimeframe: (tf: ScannerTimeframeId) => Promise<void>;
  onChangeDisplayLimit: (limit: number) => Promise<void>;
  onChangeScannerMode: (mode: ScannerMode) => Promise<void>;
  onUpdateSettings: (next: Partial<BotSettings>) => Promise<void>;
  onOpenLearningTab: () => void;
  onOpenPhantomSwap: (mintAddress: string) => void;
  phantomConnected: boolean;
  isLoading: boolean;
  isScanning: boolean;
}

type VerdictFilter = 'all' | 'buy' | 'reject';

const TIMEFRAME_OPTIONS: Array<{ id: ScannerTimeframeId; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'new', label: 'New' },
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '10m', label: '10m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1h' },
  { id: '5h', label: '5h' },
  { id: '10h', label: '10h' },
  { id: '24h', label: '24h' },
  { id: '1d', label: '1d' },
  { id: '10d', label: '10d' },
];

export function MarketScannerView({
  market,
  positions,
  cashUsd,
  settings,
  scannerTimeframe,
  maxAgeHours,
  displayLimit,
  scannerMode,
  riskyMinScorePct,
  feeProfile,
  simulateExecutionDelay,
  learningProfile,
  selectedTokenId,
  onSelectToken,
  onManualBuy,
  onClosePosition,
  onManualRefreshScan,
  onChangeTimeframe,
  onChangeDisplayLimit,
  onChangeScannerMode,
  onUpdateSettings,
  onOpenLearningTab,
  onOpenPhantomSwap,
  phantomConnected,
  isLoading,
  isScanning,
}: MarketScannerViewProps) {
  const [filter, setFilter] = useState<VerdictFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AnalyzedToken[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);

  const [customDraft, setCustomDraft] = useState({
    scanIntervalMinutes: settings.scanIntervalMinutes,
    displayLimit: settings.displayLimit,
    scannerSortBy: settings.scannerSortBy || ('score' as ScannerSortBy),
    minLiquidityUsd: settings.minLiquidityUsd,
    minVolume5hUsd: settings.minVolume5hUsd,
    minBuyRatioPct: Math.round(settings.minBuyRatio * 100),
    riskyMinScorePct: settings.riskyMinScorePct,
    riskyMinLiquidityUsd: settings.riskyMinLiquidityUsd ?? 8_000,
    riskyMinAgeMinutes: settings.riskyMinAgeMinutes ?? 15,
    riskyAllowHighRugRisk: settings.riskyAllowHighRugRisk !== false,
  });

  const settingsSyncKey = `${settings.scanIntervalMinutes}|${settings.displayLimit}|${settings.scannerSortBy}|${settings.minLiquidityUsd}|${settings.minVolume5hUsd}|${settings.minBuyRatio}|${settings.riskyMinScorePct}|${settings.riskyMinLiquidityUsd}|${settings.riskyMinAgeMinutes}|${settings.riskyAllowHighRugRisk}`;

  useEffect(() => {
    if (showCustomizer) return;
    setCustomDraft({
      scanIntervalMinutes: settings.scanIntervalMinutes,
      displayLimit: settings.displayLimit,
      scannerSortBy: settings.scannerSortBy || 'score',
      minLiquidityUsd: settings.minLiquidityUsd,
      minVolume5hUsd: settings.minVolume5hUsd,
      minBuyRatioPct: Math.round(settings.minBuyRatio * 100),
      riskyMinScorePct: settings.riskyMinScorePct,
      riskyMinLiquidityUsd: settings.riskyMinLiquidityUsd ?? 8_000,
      riskyMinAgeMinutes: settings.riskyMinAgeMinutes ?? 15,
      riskyAllowHighRugRisk: settings.riskyAllowHighRugRisk !== false,
    });
  }, [settingsSyncKey, showCustomizer]);

  async function handleApplyCustomScanner(e: React.FormEvent) {
    e.preventDefault();
    setSavingCustom(true);
    try {
      await onUpdateSettings({
        scanIntervalMinutes: customDraft.scanIntervalMinutes,
        displayLimit: customDraft.displayLimit,
        scannerSortBy: customDraft.scannerSortBy,
        minLiquidityUsd: customDraft.minLiquidityUsd,
        minVolume5hUsd: customDraft.minVolume5hUsd,
        minBuyRatio: Math.min(0.85, Math.max(0.5, customDraft.minBuyRatioPct / 100)),
        riskyMinScorePct: customDraft.riskyMinScorePct,
        riskyMinLiquidityUsd: customDraft.riskyMinLiquidityUsd,
        riskyMinAgeMinutes: customDraft.riskyMinAgeMinutes,
        riskyAllowHighRugRisk: customDraft.riskyAllowHighRugRisk,
      });
    } finally {
      setSavingCustom(false);
    }
  }

  const activeSourceList = searchResults ?? market.tokens;

  const filteredTokens = useMemo(
    () =>
      activeSourceList.filter((item) => {
        if (filter === 'buy') return item.analysis.verdict === 'COMPRAR';
        if (filter === 'reject') return item.analysis.verdict === 'DESCARTAR';
        return true;
      }),
    [activeSourceList, filter]
  );

  const selectedItem: AnalyzedToken | undefined = useMemo(
    () =>
      activeSourceList.find((t) => t.token.id === selectedTokenId) ??
      market.tokens.find((t) => t.token.id === selectedTokenId) ??
      filteredTokens[0] ??
      activeSourceList[0],
    [activeSourceList, market.tokens, filteredTokens, selectedTokenId]
  );

  const heldPosition = selectedItem
    ? positions.find((p) => p.tokenId === selectedItem.token.id)
    : undefined;

  const aptoCount = useMemo(
    () => activeSourceList.filter((t) => t.analysis.verdict === 'COMPRAR').length,
    [activeSourceList]
  );

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { results?: AnalyzedToken[]; error?: string };
      if (!res.ok) {
        setSearchError(data.error || 'Error al buscar en DexScreener.');
        return;
      }
      const list = data.results || [];
      setSearchResults(list);
      if (list.length > 0) {
        onSelectToken(list[0].token.id);
      } else {
        setSearchError(`No se encontraron pools activos en Solana para "${q}".`);
      }
    } catch {
      setSearchError('No se pudo conectar con la búsqueda de DexScreener.');
    } finally {
      setIsSearching(false);
    }
  }

  function handleClearSearch() {
    setSearchQuery('');
    setSearchResults(null);
    setSearchError(null);
    if (market.tokens[0]) {
      onSelectToken(market.tokens[0].token.id);
    }
  }

  const windowLabel =
    scannerTimeframe === 'all' || maxAgeHours <= 0
      ? 'todos los plazos'
      : scannerTimeframe === 'new'
      ? 'recién creados (New ≤2m)'
      : scannerTimeframe === '10d' || maxAgeHours >= 240
      ? 'últimos 10 días'
      : scannerTimeframe
      ? `últimos ${scannerTimeframe}`
      : `últimas ${maxAgeHours}h`;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6 space-y-4">
      {/* Header + DexScreener Magnifier Search + Timeframes */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            {searchResults
              ? `Resultados DexScreener Solana (${searchResults.length})`
              : `Mercado Solana · Top ${displayLimit} (${windowLabel})`}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {market.sourceMessage} · Modo{' '}
            <span
              className={
                scannerMode === 'crazy'
                  ? 'text-fuchsia-300 font-medium'
                  : scannerMode === 'risky'
                  ? 'text-amber-300 font-medium'
                  : 'text-slate-300'
              }
            >
              {scannerMode === 'crazy'
                ? 'Crazy (1m bajo→alto)'
                : scannerMode === 'risky'
                ? `Risky (${riskyMinScorePct}%+)`
                : 'Estricto'}
            </span>{' '}
            · Actualizado {formatTimeShort(market.fetchedAt)} · {aptoCount} aptos
          </p>
        </div>

        {/* DexScreener Search Input with Magnifier */}
        <form onSubmit={handleSearchSubmit} className="flex w-full max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="dex-search-input" className="sr-only">
              Buscar contrato o token de Solana en DexScreener
            </label>
            <input
              id="dex-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pegar contrato (CA) o buscar token en DexScreener..."
              className="w-full rounded-lg border border-slate-700 bg-[#111622] py-2 pl-9 pr-8 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {(searchQuery || searchResults) && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 border border-slate-700 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isSearching ? 'Buscando...' : 'Buscar'}
          </button>
        </form>
      </div>

      {searchError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-2 text-xs text-rose-300"
        >
          {searchError}
        </div>
      )}

      {/* Streamlined 2-part Responsive Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Expanded Timeframe segmented selector (Todos active + New, 1m..10d) */}
          <div
            role="group"
            aria-label="Ventana temporal de tokens"
            className="flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-800 bg-[#111622] p-1"
          >
            {TIMEFRAME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeTimeframe(opt.id)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  scannerTimeframe === opt.id
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Count limit selector: Top 10 vs Top 25 */}
          <div
            role="group"
            aria-label="Cantidad de monedas en pantalla"
            className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#111622] p-1"
          >
            <button
              type="button"
              onClick={() => onChangeDisplayLimit(10)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                displayLimit === 10 ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top 10
            </button>
            <button
              type="button"
              onClick={() => onChangeDisplayLimit(25)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                displayLimit === 25 ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top 25
            </button>
          </div>

          {/* Scanner Mode selector: Estricto vs Risky vs Crazy (1m) */}
          <div
            role="group"
            aria-label="Modo de exigencia del escáner"
            className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#111622] p-1"
          >
            <button
              type="button"
              onClick={() => onChangeScannerMode('strict')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                scannerMode === 'strict'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Estricto
            </button>
            <button
              type="button"
              onClick={() => onChangeScannerMode('risky')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                scannerMode === 'risky'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
                  : 'text-slate-400 hover:text-amber-200'
              }`}
            >
              Risky ({riskyMinScorePct}%)
            </button>
            <button
              type="button"
              onClick={() => onChangeScannerMode('crazy')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                scannerMode === 'crazy'
                  ? 'bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-700/60'
                  : 'text-slate-400 hover:text-fuchsia-200'
              }`}
            >
              Crazy 1m
            </button>
          </div>
          <HelpTooltip
            title="Modos de escáner"
            what="Estricto exige 8/8 filtros; Risky compra desde tu % mínimo; Crazy 1m busca rebotes de zona baja a alta en plazo de 1 min."
            why="Usa Estricto para seguridad, Risky para entrar antes y Crazy 1m para scalping rápido de altísima volatilidad."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomizer((v) => !v)}
            aria-expanded={showCustomizer}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              showCustomizer
                ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300'
                : 'border-slate-700 bg-[#111622] text-slate-200 hover:border-slate-600 hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Filtros</span>
          </button>

          <button
            type="button"
            onClick={onManualRefreshScan}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111622] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Solo analizar</span>
          </button>

          <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#111622] p-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === 'all' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({activeSourceList.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('buy')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === 'buy' ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Aptos ({aptoCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('reject')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === 'reject' ? 'bg-slate-800 text-rose-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Desc. ({activeSourceList.length - aptoCount})
            </button>
          </div>
        </div>
      </div>

      {/* Inline Customizable Scanner & Risky Mode Panel */}
      {showCustomizer && (
        <form
          onSubmit={handleApplyCustomScanner}
          className="rounded-xl border border-slate-800 bg-[#111622] p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h2 className="text-xs font-semibold text-slate-100">
                Personalización rápida de Escáner y Modo Risky
              </h2>
              <p className="text-[11px] text-slate-400">
                Ajusta en tiempo real cuántos tokens escanear, frecuencia, criterio de orden y la agresividad exacta del Modo Risky.
              </p>
            </div>
            <button
              type="submit"
              disabled={savingCustom}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {savingCustom ? 'Aplicando...' : 'Aplicar al escáner'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label htmlFor="custom-scan-interval" className="block text-[11px] font-medium text-slate-300">
                Intervalo auto (min)
              </label>
              <input
                id="custom-scan-interval"
                type="number"
                min={1}
                max={60}
                value={customDraft.scanIntervalMinutes}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, scanIntervalMinutes: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="custom-scan-limit" className="block text-[11px] font-medium text-slate-300">
                Monedas (10–40)
              </label>
              <select
                id="custom-scan-limit"
                value={customDraft.displayLimit}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, displayLimit: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value={10}>Top 10</option>
                <option value={15}>Top 15</option>
                <option value={25}>Top 25</option>
                <option value={40}>Top 40</option>
              </select>
            </div>

            <div>
              <label htmlFor="custom-scan-sort" className="block text-[11px] font-medium text-slate-300">
                Ordenar tabla por
              </label>
              <select
                id="custom-scan-sort"
                value={customDraft.scannerSortBy}
                onChange={(e) =>
                  setCustomDraft({
                    ...customDraft,
                    scannerSortBy: e.target.value as ScannerSortBy,
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="score">Aptitud y estudio</option>
                <option value="volume">Mayor volumen</option>
                <option value="liquidity">Mayor liquidez</option>
                <option value="momentum1h">Mayor subida 1h</option>
                <option value="newest">Más recientes</option>
              </select>
            </div>

            <div>
              <label htmlFor="custom-min-liq" className="block text-[11px] font-medium text-slate-300">
                Liquidez mín. ($)
              </label>
              <input
                id="custom-min-liq"
                type="number"
                min={2000}
                step={1000}
                value={customDraft.minLiquidityUsd}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, minLiquidityUsd: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="custom-min-vol" className="block text-[11px] font-medium text-slate-300">
                Volumen 5h mín. ($)
              </label>
              <input
                id="custom-min-vol"
                type="number"
                min={1000}
                step={1000}
                value={customDraft.minVolume5hUsd}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, minVolume5hUsd: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="custom-min-buy" className="block text-[11px] font-medium text-slate-300">
                Compras mín. (%)
              </label>
              <input
                id="custom-min-buy"
                type="number"
                min={50}
                max={85}
                value={customDraft.minBuyRatioPct}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, minBuyRatioPct: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-800/80 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="custom-risky-score" className="block text-[11px] font-medium text-amber-300">
                Risky: Aptitud mín. (40–95%)
              </label>
              <input
                id="custom-risky-score"
                type="number"
                min={40}
                max={95}
                value={customDraft.riskyMinScorePct}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, riskyMinScorePct: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="custom-risky-liq" className="block text-[11px] font-medium text-amber-300">
                Risky: Liquidez mín. ($)
              </label>
              <input
                id="custom-risky-liq"
                type="number"
                min={2000}
                step={1000}
                value={customDraft.riskyMinLiquidityUsd}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, riskyMinLiquidityUsd: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="custom-risky-age" className="block text-[11px] font-medium text-amber-300">
                Risky: Edad mín. (3–60 min)
              </label>
              <input
                id="custom-risky-age"
                type="number"
                min={3}
                max={60}
                value={customDraft.riskyMinAgeMinutes}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, riskyMinAgeMinutes: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 pt-4 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={customDraft.riskyAllowHighRugRisk}
                onChange={(e) =>
                  setCustomDraft({ ...customDraft, riskyAllowHighRugRisk: e.target.checked })
                }
                className="h-4 w-4 rounded border-slate-600 bg-[#0B0F17] accent-amber-500"
              />
              <span>Risky: permitir riesgo ALTO (bloquea CRÍTICO)</span>
            </label>
          </div>
        </form>
      )}

      {/* Compact Internal Study Directive Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111622] px-4 py-2 text-xs">
        <p className="min-w-0 flex-1 truncate text-slate-300" title={learningProfile.activeDirective}>
          <span className="font-semibold text-emerald-400">Estudio interno:</span>{' '}
          {learningProfile.activeDirective}
        </p>
        <button
          type="button"
          onClick={onOpenLearningTab}
          className="text-xs font-medium text-slate-300 hover:text-emerald-300 whitespace-nowrap shrink-0"
        >
          Ver estudios ({learningProfile.recentStudies.length}) →
        </button>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left: Solana Tokens Table */}
        <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111622] overflow-hidden">
          {isLoading && activeSourceList.length === 0 ? (
            <div className="p-8 space-y-3" aria-busy="true">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-10 rounded bg-slate-800/60 animate-pulse" />
              ))}
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-300">
                No hay tokens de Solana en esta categoría o ventana temporal.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter('all');
                  if (searchResults) handleClearSearch();
                }}
                className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Restablecer vista
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[680px] overflow-y-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[#111622] z-10">
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                    <th className="py-3 pl-4 pr-2"># · Token · Edad</th>
                    <th className="px-2 py-3 text-right">Precio</th>
                    <th className="px-2 py-3 text-right">5m / 1h</th>
                    <th className="px-2 py-3 text-right">Liquidez</th>
                    <th className="px-2 py-3 text-right">Riesgo Rug</th>
                    <th className="px-2 py-3 text-right">Neto 5h</th>
                    <th className="pl-2 pr-4 py-3 text-right">Veredicto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredTokens.map((item, idx) => {
                    const { token, analysis } = item;
                    const isSelected = selectedItem?.token.id === token.id;
                    const isHeld = positions.some((p) => p.tokenId === token.id);
                    const isBuy = analysis.verdict === 'COMPRAR';
                    const rugClass =
                      analysis.rugRiskLevel === 'BAJO'
                        ? 'text-emerald-400'
                        : analysis.rugRiskLevel === 'MEDIO'
                        ? 'text-amber-400'
                        : 'text-rose-400';

                    return (
                      <tr
                        key={token.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-slate-800/65' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <button
                            type="button"
                            onClick={() => onSelectToken(token.id)}
                            aria-label={`Inspeccionar ${token.baseToken.symbol}`}
                            className="group flex flex-col items-start text-left focus-visible:outline-2 focus-visible:outline-emerald-500 rounded"
                          >
                            <span className="font-semibold text-slate-100 group-hover:text-emerald-300">
                              <span className="mr-1.5 font-mono text-[11px] font-normal text-slate-500 tabular-nums">
                                #{idx + 1}
                              </span>
                              {token.baseToken.symbol}
                              {isHeld && (
                                <span className="ml-1.5 text-[10px] font-medium text-emerald-400">
                                  · En cartera
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                              SOL · {formatAge(token.ageMinutes, token.ageSeconds)} · {formatCompactUsd(token.volume.h6)} vol
                            </span>
                          </button>
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono text-slate-200 tabular-nums">
                          {formatTokenPrice(token.priceUsd)}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                          <span className={token.priceChange.m5 >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {formatSignedPct(token.priceChange.m5)}
                          </span>
                          <span className="mx-1 text-slate-600">/</span>
                          <span className={token.priceChange.h1 >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {formatSignedPct(token.priceChange.h1)}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono text-slate-300 tabular-nums">
                          {formatCompactUsd(token.liquidityUsd)}
                        </td>
                        <td className={`px-2 py-2.5 text-right font-mono text-[11px] font-medium ${rugClass}`}>
                          {analysis.rugRiskLevel}
                        </td>
                        <td
                          className={`px-2 py-2.5 text-right font-mono font-medium tabular-nums ${
                            !isBuy
                              ? 'text-slate-400'
                              : analysis.netExpectedReturnPct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {formatSignedPct(analysis.netExpectedReturnPct)}
                        </td>
                        <td className="pl-2 pr-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onSelectToken(token.id)}
                            className={`inline-flex flex-col items-end font-medium whitespace-nowrap ${
                              isBuy ? 'text-emerald-400' : 'text-slate-400'
                            }`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {isBuy ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400/80" aria-hidden="true" />
                              )}
                              <span>{isBuy ? 'Apta' : 'Descartada'}</span>
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                              {analysis.aptitudePct}%
                              {isBuy && analysis.entryModeUsed === 'crazy'
                                ? ' · Crazy 1m'
                                : isBuy && analysis.entryModeUsed === 'risky'
                                ? ' · Risky'
                                : ''}
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Analysis, Live Trade Flow & Buy/Sell */}
        <aside
          aria-label="Análisis de mercado y compra manual"
          className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111622] p-4"
        >
          {!selectedItem ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Selecciona un token de Solana o busca un contrato en DexScreener para ver su flujo en vivo y análisis.
            </div>
          ) : (
            <TokenInspectorPanel
              token={selectedItem.token}
              analysis={selectedItem.analysis}
              heldPosition={heldPosition}
              cashUsd={cashUsd}
              feeProfile={feeProfile}
              chartTimeframe={(settings.chartTimeframe || '5h') as ChartTimeframe}
              onChangeChartTimeframe={(tf) => onUpdateSettings({ chartTimeframe: tf })}
              simulateExecutionDelay={simulateExecutionDelay}
              onManualBuy={onManualBuy}
              onClosePosition={onClosePosition}
              onOpenPhantomSwap={onOpenPhantomSwap}
              phantomConnected={phantomConnected}
              allowBuy={true}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
