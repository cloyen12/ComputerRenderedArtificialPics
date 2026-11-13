import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { MAX_STAKE_USD, MIN_STAKE_USD, validateStakeUsd } from '../shared/analyzer';
import { calculateExecutionEstimate, estimateOpenPositionNetPnl } from '../shared/execution';
import type {
  ChartTimeframe,
  FeeProfile,
  FiveHourAnalysis,
  PoolTrade,
  Position,
  TokenLiveDetailResponse,
  TokenPair,
} from '../shared/types';
import {
  formatAge,
  formatCompactUsd,
  formatSignedPct,
  formatTimeShort,
  formatTokenPrice,
  formatUsd,
} from '../utils/formatters';
import { FiveHourChart } from './FiveHourChart';

interface TokenInspectorPanelProps {
  token: TokenPair;
  analysis: FiveHourAnalysis;
  heldPosition?: Position;
  cashUsd: number;
  feeProfile?: FeeProfile;
  chartTimeframe?: ChartTimeframe;
  onChangeChartTimeframe?: (tf: ChartTimeframe) => void;
  simulateExecutionDelay?: boolean;
  onManualBuy: (tokenId: string, stakeUsd: number) => Promise<{ ok: boolean; error?: string }>;
  onClosePosition?: (positionId: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenPhantomSwap?: (mintAddress: string) => void;
  phantomConnected?: boolean;
  allowBuy?: boolean;
}

export function TokenInspectorPanel({
  token: initialToken,
  analysis: initialAnalysis,
  heldPosition,
  cashUsd,
  feeProfile = 'medio',
  chartTimeframe = '5h',
  onChangeChartTimeframe,
  simulateExecutionDelay = true,
  onManualBuy,
  onClosePosition,
  onOpenPhantomSwap,
  phantomConnected = false,
  allowBuy = true,
}: TokenInspectorPanelProps) {
  const [subTab, setSubTab] = useState<'analysis' | 'flow'>('analysis');
  const [showFullDiagnostic, setShowFullDiagnostic] = useState(false);
  const [liveDetail, setLiveDetail] = useState<TokenLiveDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [stakeInput, setStakeInput] = useState<string>(String(initialAnalysis.recommendedStakeUsd));
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pendingTokens, setPendingTokens] = useState<Record<string, boolean>>({});
  const [sellingIds, setSellingIds] = useState<Record<string, boolean>>({});
  const activeAbortRef = useRef<AbortController | null>(null);

  const token = liveDetail?.token.id === initialToken.id ? liveDetail.token : initialToken;
  const analysis = liveDetail?.token.id === initialToken.id ? liveDetail.analysis : initialAnalysis;
  const recentTrades: PoolTrade[] =
    liveDetail?.token.id === initialToken.id ? liveDetail.recentTrades : [];

  const fetchLiveDetail = async (pairAddress: string) => {
    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/token/${encodeURIComponent(pairAddress)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as TokenLiveDetailResponse;
      setLiveDetail(data);
    } catch {
      // Ignore abort / transient fetch errors
    } finally {
      if (activeAbortRef.current === controller) {
        setLoadingDetail(false);
      }
    }
  };

  useEffect(() => {
    setShowFullDiagnostic(false);
    setStakeInput(String(initialAnalysis.recommendedStakeUsd));
    setFeedback(null);
    fetchLiveDetail(initialToken.pairAddress);

    const timer = setInterval(() => {
      fetchLiveDetail(initialToken.pairAddress);
    }, 8_000);
    return () => {
      clearInterval(timer);
      activeAbortRef.current?.abort();
    };
  }, [initialToken.id, initialToken.pairAddress, chartTimeframe]);

  const parsedStake = Number(stakeInput);
  const stakeValidation = validateStakeUsd(parsedStake);
  const previewStake = stakeValidation.valid ? stakeValidation.clamped : 20;
  const execEstimate = calculateExecutionEstimate(token, previewStake, feeProfile);
  const heldNetPnl = heldPosition ? estimateOpenPositionNetPnl(heldPosition, feeProfile) : null;
  const isSubmittingCurrent = Boolean(pendingTokens[token.id]);
  const isSellingCurrent = heldPosition ? Boolean(sellingIds[heldPosition.id]) : false;

  async function handleBuySubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const check = validateStakeUsd(Number(stakeInput));
    if (!check.valid) {
      setFeedback({ type: 'err', text: check.error || 'Importe fuera de rango ($20–$100).' });
      return;
    }
    const est = calculateExecutionEstimate(token, check.clamped, feeProfile);
    if (cashUsd < check.clamped + est.entryFeeUsd) {
      setFeedback({ type: 'err', text: 'Saldo virtual insuficiente. Recarga la cartera.' });
      return;
    }

    const targetId = token.id;
    const targetSymbol = token.baseToken.symbol;
    setPendingTokens((prev) => ({ ...prev, [targetId]: true }));
    setFeedback({
      type: 'ok',
      text: `Orden enviada en ${targetSymbol} (${formatUsd(check.clamped)})${
        simulateExecutionDelay ? ` · est. red ~${est.estimatedEntrySeconds}s` : ''
      }. Puedes seguir navegando y comprando.`,
    });

    try {
      const res = await onManualBuy(targetId, check.clamped);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: `Compra ejecutada: ${formatUsd(check.clamped)} en ${targetSymbol} (tasa ~$${est.entryFeeUsd.toFixed(2)} ${est.label}).`,
        });
      } else {
        setFeedback({ type: 'err', text: res.error || 'No se pudo completar la compra.' });
      }
    } finally {
      setPendingTokens((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  }

  async function handleSellPosition() {
    if (!heldPosition || !onClosePosition) return;
    const targetPosId = heldPosition.id;
    const targetSymbol = heldPosition.symbol;
    setSellingIds((prev) => ({ ...prev, [targetPosId]: true }));
    setFeedback(null);
    try {
      const res = await onClosePosition(targetPosId);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: `Venta ejecutada en ${targetSymbol} (tasa salida ~$${execEstimate.exitFeeUsd.toFixed(2)}).`,
        });
      } else {
        setFeedback({ type: 'err', text: res.error || 'Error al vender la posición.' });
      }
    } finally {
      setSellingIds((prev) => {
        const next = { ...prev };
        delete next[targetPosId];
        return next;
      });
    }
  }

  const m5Total = token.txns.m5.buys + token.txns.m5.sells;
  const m5BuyShare = m5Total > 0 ? (token.txns.m5.buys / m5Total) * 100 : 50;
  const h1Total = token.txns.h1.buys + token.txns.h1.sells;
  const h1BuyShare = h1Total > 0 ? (token.txns.h1.buys / h1Total) * 100 : 50;

  const rugColor =
    analysis.rugRiskLevel === 'BAJO'
      ? 'text-emerald-400'
      : analysis.rugRiskLevel === 'MEDIO'
      ? 'text-amber-400'
      : 'text-rose-400';

  return (
    <div className="space-y-3.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-bold text-slate-100 truncate">
              {token.baseToken.symbol}
            </h2>
            <span className="text-xs text-slate-400 truncate max-w-[170px]">
              {token.baseToken.name}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
            SOL · {token.dexId} · Edad {formatAge(token.ageMinutes, token.ageSeconds)} · {formatTokenPrice(token.priceUsd)}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => fetchLiveDetail(token.pairAddress)}
            disabled={loadingDetail}
            aria-label={`Refrescar flujo de ${token.baseToken.symbol}`}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingDetail ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Flujo</span>
          </button>
          <a
            href={token.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap"
          >
            <span>DexScreener</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Sub-tabs: Chart Analysis vs Live Market Flow */}
      <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0B0F17] p-1">
        <button
          type="button"
          onClick={() => setSubTab('analysis')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            subTab === 'analysis' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Análisis ({analysis.chartTimeframe || chartTimeframe}) y Anti-Rug
        </button>
        <button
          type="button"
          onClick={() => {
            setSubTab('flow');
            if (recentTrades.length === 0 && !loadingDetail) {
              fetchLiveDetail(token.pairAddress);
            }
          }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            subTab === 'flow' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Flujo en vivo ({recentTrades.length > 0 ? `${recentTrades.length} txns` : `${m5Total} en 5m`})
        </button>
      </div>

      {subTab === 'analysis' ? (
        <div className="space-y-3">
          <FiveHourChart
            candles={analysis.candles}
            symbol={token.baseToken.symbol}
            chartTimeframe={analysis.chartTimeframe || chartTimeframe}
            onChangeChartTimeframe={onChangeChartTimeframe}
          />

          {/* Clean Verdict Header + Primary Takeaway (no visual clutter) */}
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {analysis.saleACuenta ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-400 shrink-0" aria-hidden="true" />
                )}
                <span
                  className={`text-xs font-semibold whitespace-nowrap ${
                    analysis.saleACuenta ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {analysis.saleACuenta
                    ? analysis.entryModeUsed === 'crazy'
                      ? 'Apta (Crazy 1m)'
                      : analysis.entryModeUsed === 'risky'
                      ? 'Apta (Modo Risky)'
                      : 'Apta para compra'
                    : 'No apta'}
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap ${rugColor}`}>
                  {analysis.rugRiskLevel === 'BAJO' ? (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Riesgo {analysis.rugRiskLevel}
                </span>
              </div>

              <span className="font-mono text-xs font-bold text-slate-100 tabular-nums whitespace-nowrap shrink-0">
                {analysis.aptitudePct}% · {analysis.score}/100
              </span>
            </div>

            {/* Single-sentence top reason */}
            <p className="text-[11px] leading-snug text-slate-300">
              {analysis.rugReasons[0] ?? analysis.aptitudeReasons[0] ?? analysis.summaryReason}
            </p>

            {/* Collapsible Detailed Diagnostic */}
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-2">
              <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                Filtros superados: {analysis.checks.filter((c) => c.passed).length}/{analysis.checks.length}
                {analysis.learnedBonusPts !== 0 &&
                  ` · Estudio ${analysis.learnedBonusPts > 0 ? '+' : ''}${analysis.learnedBonusPts} pts`}
              </span>
              <button
                type="button"
                onClick={() => setShowFullDiagnostic((v) => !v)}
                aria-expanded={showFullDiagnostic}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                <span>
                  {showFullDiagnostic
                    ? 'Ocultar diagnóstico'
                    : `Ver diagnóstico (${analysis.rugReasons.length + analysis.aptitudeReasons.length})`}
                </span>
                {showFullDiagnostic ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            {showFullDiagnostic && (
              <div className="space-y-2 border-t border-slate-800/80 pt-2.5 text-[11px]">
                <p className="text-slate-400">{analysis.summaryReason}</p>
                {analysis.rugReasons.length > 0 && (
                  <ul className="space-y-1">
                    {analysis.rugReasons.map((r, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-rose-300">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" aria-hidden="true" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {analysis.aptitudeReasons.length > 0 && (
                  <ul className="space-y-1">
                    {analysis.aptitudeReasons.map((r, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-slate-300">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Hairline 2-column compact threshold summary */}
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-[#0B0F17] overflow-hidden">
            {analysis.checks.map((chk) => (
              <div key={chk.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]">
                <span className="flex items-center gap-1.5 min-w-0 text-slate-400 truncate">
                  {chk.passed ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-3 w-3 text-rose-400 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{chk.label}</span>
                </span>
                <span
                  className={`font-mono text-[10px] tabular-nums shrink-0 whitespace-nowrap ${
                    chk.passed ? 'text-slate-100' : 'text-rose-300'
                  }`}
                >
                  {chk.actualFormatted.split(' ')[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Live Buy/Sell Pressure Gauges */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Flujo últimos 5 min</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {token.txns.m5.buys}C / {token.txns.m5.sells}V
                </span>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/40">
                <div
                  className="bg-emerald-500"
                  style={{ width: `${Math.min(100, Math.max(0, m5BuyShare))}%` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
                {m5BuyShare.toFixed(0)}% comprando · Vol {formatCompactUsd(token.volume.m5)}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Flujo última 1 hora</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {token.txns.h1.buys}C / {token.txns.h1.sells}V
                </span>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-rose-500/40">
                <div
                  className="bg-emerald-500"
                  style={{ width: `${Math.min(100, Math.max(0, h1BuyShare))}%` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
                {h1BuyShare.toFixed(0)}% comprando · Vol {formatCompactUsd(token.volume.h1)}
              </p>
            </div>
          </div>

          {/* Real-Time Solana Trade Tape */}
          <div className="rounded-lg border border-slate-800 bg-[#0B0F17] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-[11px]">
              <span className="font-semibold text-slate-200">
                Últimas operaciones en vivo (Solana)
              </span>
              <span className="font-mono text-slate-400 tabular-nums">
                {liveDetail ? formatTimeShort(liveDetail.fetchedAt) : 'Cargando...'}
              </span>
            </div>

            {recentTrades.length === 0 ? (
              <div className="p-4 text-center space-y-2 text-xs text-slate-400">
                <p>
                  {loadingDetail
                    ? 'Consultando últimas compras y ventas reales en GeckoTerminal...'
                    : 'No se recibieron operaciones individuales en este instante (rate-limit o pool reciente).'}
                </p>
                {!loadingDetail && (
                  <button
                    type="button"
                    onClick={() => fetchLiveDetail(token.pairAddress)}
                    className="rounded border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    Reintentar flujo en vivo
                  </button>
                )}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800/70 text-slate-400">
                      <th className="py-1.5 pl-3 pr-2">Tipo</th>
                      <th className="px-2 py-1.5 text-right">Importe</th>
                      <th className="px-2 py-1.5 text-right">Precio</th>
                      <th className="px-2 py-1.5 text-right">Wallet</th>
                      <th className="pl-2 pr-3 py-1.5 text-right">Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                    {recentTrades.map((tr) => (
                      <tr key={tr.id}>
                        <td
                          className={`py-1.5 pl-3 pr-2 font-semibold ${
                            tr.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {tr.type === 'buy' ? 'COMPRA' : 'VENTA'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-200">
                          {formatUsd(tr.volumeUsd, tr.volumeUsd < 10 ? 2 : 0)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-300">
                          {formatTokenPrice(tr.priceUsd)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-500">
                          {tr.maker.slice(0, 4)}…{tr.maker.slice(-4)}
                        </td>
                        <td className="pl-2 pr-3 py-1.5 text-right text-slate-400">
                          {formatTimeShort(tr.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Open Position Box (Single-Line PnL + Direct Sell) */}
      {heldPosition && onClosePosition && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2.5 text-xs">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 whitespace-nowrap overflow-hidden">
              <span className="font-medium text-slate-200">
                Abierta ({formatUsd(heldPosition.stakeUsd)})
              </span>
              <span
                className={`font-mono text-xs font-semibold tabular-nums whitespace-nowrap ${
                  (heldNetPnl?.netPnlUsd ?? heldPosition.pnlUsd) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {(heldNetPnl?.netPnlUsd ?? heldPosition.pnlUsd) >= 0 ? '+' : ''}
                {formatUsd(heldNetPnl?.netPnlUsd ?? heldPosition.pnlUsd)} (
                {formatSignedPct(heldNetPnl?.netPnlPct ?? heldPosition.pnlPct)})
              </span>
            </div>
            <p className="font-mono text-[10px] text-slate-400 tabular-nums whitespace-nowrap truncate">
              Pico {formatSignedPct(heldPosition.peakPnlPct)} · Gas -{formatUsd(heldNetPnl?.totalRoundTripCostUsd ?? 0)} ·{' '}
              {heldPosition.trailingActive ? 'Trailing' : heldPosition.breakEvenActive ? 'BE' : 'SL'}{' '}
              {formatSignedPct(heldPosition.trailingFloorPct)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSellPosition}
            disabled={isSellingCurrent}
            className="rounded-md border border-rose-700/70 bg-rose-950/50 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isSellingCurrent ? 'Vendiendo...' : `Vender ${heldPosition.symbol}`}
          </button>
        </div>
      )}

      {/* Manual Buy Form ($20 - $100) */}
      {allowBuy && (
        <form onSubmit={handleBuySubmit} className="space-y-2.5 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <label htmlFor="manual-stake-input" className="text-xs font-semibold text-slate-200">
              Compra manual ($20 – $100 USD)
            </label>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              Sugerido: ${analysis.recommendedStakeUsd}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-400">
                $
              </span>
              <input
                id="manual-stake-input"
                type="number"
                min={MIN_STAKE_USD}
                max={MAX_STAKE_USD}
                step="1"
                value={stakeInput}
                onChange={(e) => {
                  setStakeInput(e.target.value);
                  setFeedback(null);
                }}
                className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] py-2 pl-7 pr-3 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </div>
            {[20, 50, 75, 100].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setStakeInput(String(preset));
                  setFeedback(null);
                }}
                className={`rounded-lg border px-2.5 py-2 font-mono text-xs tabular-nums transition-colors ${
                  Number(stakeInput) === preset
                    ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300'
                    : 'border-slate-700 bg-[#0B0F17] text-slate-300 hover:border-slate-600'
                }`}
              >
                ${preset}
              </button>
            ))}
          </div>

          {!stakeValidation.valid && (
            <p role="alert" className="text-xs text-rose-400">
              {stakeValidation.error}
            </p>
          )}

          {feedback && (
            <p
              role="status"
              className={`text-xs font-medium ${
                feedback.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {feedback.text}
            </p>
          )}

          <p className="font-mono text-[11px] text-slate-400 tabular-nums">
            {execEstimate.label}: ~${execEstimate.roundTripFeeUsd.toFixed(2)} ida/vuelta ({execEstimate.roundTripFeePct}% · vs $2.00 Turbo) · Salida est. ~{execEstimate.estimatedExitSeconds}s
          </p>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!stakeValidation.valid}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              {isSubmittingCurrent
                ? `Enviando otra orden en ${token.baseToken.symbol}...`
                : `Comprar ${token.baseToken.symbol} (Virtual)`}
            </button>

            {onOpenPhantomSwap && (
              <button
                type="button"
                onClick={() => onOpenPhantomSwap(token.baseToken.address)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-600/70 hover:text-emerald-300 whitespace-nowrap shrink-0"
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{phantomConnected ? 'Phantom (Real)' : 'Swap Phantom'}</span>
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
