import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { estimateOpenPositionNetPnl } from '../shared/execution';
import type {
  AnalyzedToken,
  BotSettings,
  ChartTimeframe,
  PortfolioState,
  Position,
  TokenLiveDetailResponse,
} from '../shared/types';
import {
  formatCompactUsd,
  formatSignedPct,
  formatTimeShort,
  formatTokenPrice,
  formatUsd,
} from '../utils/formatters';
import { HelpTooltip } from './HelpTooltip';
import { TokenInspectorPanel } from './TokenInspectorPanel';

interface PortfolioViewProps {
  portfolio: PortfolioState;
  marketTokens: AnalyzedToken[];
  onClosePosition: (positionId: string) => Promise<{ ok: boolean; error?: string }>;
  onManualBuy: (tokenId: string, stakeUsd: number) => Promise<{ ok: boolean; error?: string }>;
  onRecharge: (
    action: { type: 'reset' } | { type: 'add'; amountUsd: number } | { type: 'set'; amountUsd: number }
  ) => Promise<void>;
  onResetAll: (keepSettings?: boolean) => Promise<void>;
  onUpdateSettings?: (next: Partial<BotSettings>) => Promise<void>;
  onGoToMarket: () => void;
  onOpenLearningTab: () => void;
  onOpenPhantomSwap?: (mintAddress: string) => void;
  phantomConnected?: boolean;
}

export function PortfolioView({
  portfolio,
  marketTokens,
  onClosePosition,
  onManualBuy,
  onRecharge,
  onResetAll,
  onUpdateSettings,
  onGoToMarket,
  onOpenLearningTab,
  onOpenPhantomSwap,
  phantomConnected = false,
}: PortfolioViewProps) {
  const baseBalanceUsd = portfolio.settings?.customInitialBalanceUsd || 1_000_000;
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(
    portfolio.positions[0]?.id ?? null
  );
  const [selectedDetail, setSelectedDetail] = useState<TokenLiveDetailResponse | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [recharging, setRecharging] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [customBalanceInput, setCustomBalanceInput] = useState<string>(String(baseBalanceUsd));
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditingBalance) {
      setCustomBalanceInput(String(baseBalanceUsd));
    }
  }, [baseBalanceUsd, isEditingBalance]);

  const selectedPosition: Position | undefined =
    portfolio.positions.find((p) => p.id === selectedPositionId) ?? portfolio.positions[0];

  useEffect(() => {
    if (!selectedPosition) {
      setSelectedDetail(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/token/${encodeURIComponent(selectedPosition.pairAddress)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TokenLiveDetailResponse | null) => {
        if (data) setSelectedDetail(data);
      })
      .catch(() => {});
    return () => {
      controller.abort();
    };
  }, [selectedPosition?.pairAddress]);

  const feeProfile = portfolio.settings?.feeProfile || 'medio';
  const {
    openBreakdowns,
    investedUsd,
    grossOpenPnlUsd,
    openRoundTripGasUsd,
    realOpenPnlUsd,
    closedTrades,
    realizedPnlUsd,
    winsCount,
    winRate,
  } = useMemo(() => {
    const breakdowns = portfolio.positions.map((pos) => ({
      pos,
      net: estimateOpenPositionNetPnl(pos, feeProfile),
    }));
    const invested = portfolio.positions.reduce((s, p) => s + p.stakeUsd, 0);
    const currentVal = portfolio.positions.reduce((s, p) => s + p.currentValueUsd, 0);
    const grossOpen = currentVal - invested;
    const roundTripGas = breakdowns.reduce((s, item) => s + item.net.totalRoundTripCostUsd, 0);
    const realOpen = breakdowns.reduce((s, item) => s + item.net.netPnlUsd, 0);
    const sells = portfolio.trades.filter((t) => t.side === 'SELL');
    const realized = sells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const wins = sells.filter((t) => (t.pnlUsd ?? 0) > 0).length;
    return {
      openBreakdowns: breakdowns,
      investedUsd: invested,
      grossOpenPnlUsd: grossOpen,
      openRoundTripGasUsd: roundTripGas,
      realOpenPnlUsd: realOpen,
      closedTrades: sells,
      realizedPnlUsd: realized,
      winsCount: wins,
      winRate: sells.length > 0 ? (wins / sells.length) * 100 : 0,
    };
  }, [portfolio.positions, portfolio.trades, feeProfile]);

  async function handleRechargeClick(
    action: { type: 'reset' } | { type: 'add'; amountUsd: number } | { type: 'set'; amountUsd: number }
  ) {
    setRecharging(true);
    setStatusMessage(null);
    try {
      await onRecharge(action);
      if (action.type === 'reset') {
        setStatusMessage(`Cartera restaurada a ${formatUsd(baseBalanceUsd)} disponibles.`);
      } else if (action.type === 'set') {
        setStatusMessage(`Saldo virtual fijado a ${formatUsd(action.amountUsd)} como nueva base.`);
      } else {
        setStatusMessage(`Recarga completada: +${formatUsd(action.amountUsd)} añadidos.`);
      }
    } finally {
      setRecharging(false);
    }
  }

  async function handleConfirmResetAll() {
    setResetting(true);
    setStatusMessage(null);
    try {
      await onResetAll(true);
      setConfirmReset(false);
      setStatusMessage(
        `Reset total completado: historial, posiciones, escaneos y PnL reiniciados a 0 con base ${formatUsd(baseBalanceUsd)}.`
      );
    } finally {
      setResetting(false);
    }
  }

  async function handleSell(pos: Position) {
    setClosingId(pos.id);
    setStatusMessage(null);
    const estSeconds = pos.estimatedExitSeconds ?? 4.8;
    try {
      const res = await onClosePosition(pos.id);
      if (res.ok) {
        setStatusMessage(
          portfolio.settings.simulateExecutionDelay
            ? `Salida confirmada en ${pos.symbol} (latencia Solana est. ~${estSeconds.toFixed(1)}s, tasas incluidas).`
            : `Salida confirmada en ${pos.symbol} (tasas incluidas).`
        );
      } else {
        setStatusMessage(res.error || 'No se pudo vender la posición.');
      }
    } finally {
      setClosingId(null);
    }
  }

  const matchedMarketItem = selectedPosition
    ? marketTokens.find((t) => t.token.id === selectedPosition.tokenId)
    : undefined;

  const inspectorToken =
    selectedDetail && selectedPosition && selectedDetail.token.pairAddress === selectedPosition.pairAddress
      ? selectedDetail.token
      : matchedMarketItem?.token;
  const inspectorAnalysis =
    selectedDetail && selectedPosition && selectedDetail.token.pairAddress === selectedPosition.pairAddress
      ? selectedDetail.analysis
      : matchedMarketItem?.analysis;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6 space-y-6">
      {/* Header + Custom Balance & Reset Actions */}
      <div className="rounded-xl border border-slate-800 bg-[#111622] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">
              Cartera virtual Solana (base {formatUsd(baseBalanceUsd)})
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Pulsa cualquiera de tus tokens abiertos para ver en tiempo real cómo fluyen las compras y ventas antes de vender · Recargado:{' '}
              <span className="font-mono text-slate-300 tabular-nums">
                {formatUsd(portfolio.totalRechargedUsd)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={recharging}
              onClick={() => handleRechargeClick({ type: 'add', amountUsd: 1_000 })}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
            >
              +$1,000
            </button>
            <button
              type="button"
              disabled={recharging}
              onClick={() => handleRechargeClick({ type: 'add', amountUsd: 100_000 })}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
            >
              +$100,000
            </button>
            <button
              type="button"
              disabled={recharging}
              onClick={() => handleRechargeClick({ type: 'reset' })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Restaurar {formatCompactUsd(baseBalanceUsd)}</span>
            </button>

            {confirmReset ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={resetting}
                  onClick={handleConfirmResetAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{resetting ? 'Reseteando...' : 'Confirmar reset total'}</span>
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => setConfirmReset(false)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/70 bg-rose-950/30 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/60"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Resetear historial y PnL</span>
              </button>
            )}
          </div>
        </div>

        {/* Customizable Initial Balance Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Personalizar saldo virtual:</span>
            {[500, 1_000, 5_000, 1_000_000].map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={recharging}
                onClick={() => {
                  setCustomBalanceInput(String(preset));
                  handleRechargeClick({ type: 'set', amountUsd: preset });
                }}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums transition-colors ${
                  Math.abs(baseBalanceUsd - preset) < 1
                    ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300'
                    : 'border-slate-700 bg-[#0B0F17] text-slate-300 hover:bg-slate-800'
                }`}
              >
                {formatCompactUsd(preset)}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const val = Number(customBalanceInput);
              if (Number.isFinite(val) && val >= 20) {
                handleRechargeClick({ type: 'set', amountUsd: val });
              }
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="custom-balance-input" className="text-xs text-slate-400">
              Saldo exacto ($):
            </label>
            <input
              id="custom-balance-input"
              type="number"
              min={20}
              max={10_000_000}
              step={1}
              value={customBalanceInput}
              onFocus={() => setIsEditingBalance(true)}
              onBlur={() => setIsEditingBalance(false)}
              onChange={(e) => setCustomBalanceInput(e.target.value)}
              className="w-32 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={recharging}
              className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              Fijar saldo
            </button>
          </form>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="rounded-lg border border-slate-700 bg-[#111622] px-4 py-2.5 text-xs font-medium text-emerald-300"
        >
          {statusMessage}
        </div>
      )}

      {/* Summary 5-column Strip (Strict Single-Line PnL) */}
      <div className="grid grid-cols-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-[#111622] lg:grid-cols-5 lg:divide-y-0 sm:divide-x">
        <div className="p-4">
          <p className="text-xs text-slate-400">Efectivo disponible</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-100 tabular-nums whitespace-nowrap">
            {formatUsd(portfolio.cashUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Capital activo</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-100 tabular-nums whitespace-nowrap">
            {formatUsd(investedUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span>PnL abierto (c/ gas)</span>
            <HelpTooltip
              title="Desglose PnL real abierto"
              what={`Bruto actual: ${grossOpenPnlUsd >= 0 ? '+' : ''}${formatUsd(grossOpenPnlUsd)} · Gas entrada/salida est.: -${formatUsd(openRoundTripGasUsd)}.`}
              why="Muestra exactamente cuánto dinero neto recibirías si vendieras todas tus posiciones abiertas en este instante."
            />
          </p>
          <p
            data-testid="portfolio-open-pnl"
            className={`mt-1 font-mono text-lg font-semibold tabular-nums whitespace-nowrap ${
              realOpenPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {realOpenPnlUsd >= 0 ? '+' : ''}
            {formatUsd(realOpenPnlUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">PnL realizado</p>
          <p
            data-testid="portfolio-realized-pnl"
            className={`mt-1 font-mono text-lg font-semibold tabular-nums whitespace-nowrap ${
              realizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {realizedPnlUsd >= 0 ? '+' : ''}
            {formatUsd(realizedPnlUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Acierto (cerradas)</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-100 tabular-nums whitespace-nowrap">
            {winRate.toFixed(1)}% ({winsCount}/{closedTrades.length})
          </p>
        </div>
      </div>

      {/* Latest Internal Study Note */}
      {portfolio.learningProfile?.recentStudies?.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#111622] px-5 py-3.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-100">
              {portfolio.learningProfile.recentStudies[0].summary}
            </p>
            <button
              type="button"
              onClick={onOpenLearningTab}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 whitespace-nowrap"
            >
              Ver todos los estudios ({portfolio.learningProfile.recentStudies.length}) →
            </button>
          </div>
          <p className="text-xs text-slate-300">
            {portfolio.learningProfile.recentStudies[0].commonObservation}
          </p>
          <p className="text-[11px] text-slate-400">
            <span className="font-medium text-emerald-400">Siguiente regla:</span>{' '}
            {portfolio.learningProfile.recentStudies[0].nextActionRule}
          </p>
        </div>
      )}

      {/* Positions Table + Live Token Flow Inspector */}
      {portfolio.positions.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#111622] flex flex-col items-center justify-center px-6 py-12 text-center">
          <Wallet className="h-7 w-7 text-slate-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-slate-200">
            No tienes posiciones abiertas actualmente.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Compra manualmente un token de Solana ($20–$100) o ejecuta un escaneo inmediato.
          </p>
          <button
            type="button"
            onClick={onGoToMarket}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            Explorar Top 10 Solana
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111622] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-100">
                Posiciones abiertas ({portfolio.positions.length})
              </h2>
              <span className="text-xs text-slate-400">
                Auto TP/SL: {portfolio.settings.autoCloseTpSl ? 'Activado' : 'Manual'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                    <th className="py-3 pl-4 pr-2">Token · Modo</th>
                    <th className="px-2 py-3 text-right">Jugada</th>
                    <th className="px-2 py-3 text-right">Entrada / Actual</th>
                        <th className="px-2 py-3 text-right">PnL real (c/ gas)</th>
                    <th className="px-2 py-3 text-right">Trailing / Pico</th>
                    <th className="pl-2 pr-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {openBreakdowns.map(({ pos, net }) => {
                    const isSelected = selectedPosition?.id === pos.id;
                    return (
                      <tr
                        key={pos.id}
                        className={isSelected ? 'bg-slate-800/65' : 'hover:bg-slate-800/30'}
                      >
                        <td className="py-3 pl-4 pr-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedPositionId(pos.id)}
                              aria-label={`Ver flujo en vivo de ${pos.symbol}`}
                              className="font-semibold text-slate-100 hover:text-emerald-300 text-left"
                            >
                              {pos.symbol}
                            </button>
                            <a
                              href={pos.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Abrir ${pos.symbol} en DexScreener`}
                              className="text-slate-400 hover:text-slate-200"
                            >
                              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400">
                            SOL · {pos.mode === 'auto' ? 'Auto' : 'Manual'}
                            {pos.scannerMode === 'crazy'
                              ? ' · Crazy 1m'
                              : pos.scannerMode === 'risky'
                              ? ' · Risky'
                              : ''}{' '}
                            · {formatTimeShort(pos.openedAt)}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-right font-mono text-slate-200 tabular-nums whitespace-nowrap">
                          {formatUsd(pos.stakeUsd)}
                        </td>
                        <td className="px-2 py-3 text-right font-mono text-[11px] tabular-nums whitespace-nowrap">
                          <div className="text-slate-400">{formatTokenPrice(pos.entryPriceUsd)}</div>
                          <div className="text-slate-200">{formatTokenPrice(pos.currentPriceUsd)}</div>
                        </td>
                        <td
                          title={`Bruto ${net.grossPnlUsd >= 0 ? '+' : ''}${formatUsd(net.grossPnlUsd)} · Gas -${formatUsd(net.totalRoundTripCostUsd)}`}
                          className={`px-2 py-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            net.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {net.netPnlUsd >= 0 ? '+' : ''}
                          {formatUsd(net.netPnlUsd)} ({formatSignedPct(net.netPnlPct)})
                        </td>
                        <td className="px-2 py-3 text-right font-mono text-[11px] tabular-nums whitespace-nowrap">
                          <div
                            className={
                              pos.trailingActive
                                ? 'text-emerald-400 font-semibold'
                                : pos.breakEvenActive
                                ? 'text-amber-300 font-semibold'
                                : 'text-slate-400'
                            }
                          >
                            {pos.trailingActive
                              ? 'Trailing '
                              : pos.breakEvenActive
                              ? 'BE '
                              : 'SL '}
                            {formatSignedPct(pos.trailingFloorPct)}
                          </div>
                          <div className="text-[10px] font-normal text-slate-500">
                            Pico {formatSignedPct(pos.peakPnlPct)} · ~{(pos.estimatedExitSeconds ?? 4.8).toFixed(1)}s
                          </div>
                        </td>
                        <td className="pl-2 pr-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={closingId === pos.id}
                            onClick={() => handleSell(pos)}
                            className="rounded-md border border-rose-700/60 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900/60 disabled:opacity-50 whitespace-nowrap"
                          >
                            {closingId === pos.id ? 'Vendiendo...' : 'Vender posición'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside
            aria-label="Flujo de mercado del token en cartera"
            className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111622] p-4"
          >
            {inspectorToken && inspectorAnalysis ? (
              <TokenInspectorPanel
                token={inspectorToken}
                analysis={inspectorAnalysis}
                heldPosition={selectedPosition}
                cashUsd={portfolio.cashUsd}
                feeProfile={portfolio.settings.feeProfile}
                chartTimeframe={portfolio.settings.chartTimeframe || '5h'}
                onChangeChartTimeframe={
                  onUpdateSettings
                    ? (tf: ChartTimeframe) => {
                        void onUpdateSettings({ chartTimeframe: tf });
                      }
                    : undefined
                }
                simulateExecutionDelay={portfolio.settings.simulateExecutionDelay}
                onManualBuy={onManualBuy}
                onClosePosition={onClosePosition}
                onOpenPhantomSwap={onOpenPhantomSwap}
                phantomConnected={phantomConnected}
                allowBuy={false}
              />
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Cargando flujo en tiempo real de {selectedPosition?.symbol}...
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
