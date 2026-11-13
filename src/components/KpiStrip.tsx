import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { estimateOpenPositionNetPnl } from '../shared/execution';
import type { PortfolioState } from '../shared/types';
import { formatCompactUsd, formatCountdown, formatSignedPct, formatUsd } from '../utils/formatters';

interface KpiStripProps {
  portfolio: PortfolioState;
  onQuickRecharge: () => void;
  onToggleAutoScan: () => void;
  onOpenPortfolio: () => void;
}

export function KpiStrip({
  portfolio,
  onQuickRecharge,
  onToggleAutoScan,
  onOpenPortfolio,
}: KpiStripProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!portfolio.settings.autoScanEnabled) return;
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [portfolio.settings.autoScanEnabled]);

  const { totalEquityUsd, totalRealPnlUsd, realOpenPnlPct } = useMemo(() => {
    const investedUsd = portfolio.positions.reduce((acc, p) => acc + p.stakeUsd, 0);
    const feeProfile = portfolio.settings?.feeProfile || 'medio';
    const openBreakdown = portfolio.positions.map((p) => estimateOpenPositionNetPnl(p, feeProfile));
    const netPositionsValueUsd = openBreakdown.reduce((acc, b) => acc + b.netProceedsUsd, 0);
    const equityUsd = portfolio.cashUsd + netPositionsValueUsd;
    const openPnlUsd = openBreakdown.reduce((acc, b) => acc + b.netPnlUsd, 0);
    const openPnlPct = investedUsd > 0 ? (openPnlUsd / investedUsd) * 100 : 0;
    const realizedPnlUsd = portfolio.trades.reduce(
      (acc, t) => (t.side === 'SELL' ? acc + (t.pnlUsd ?? 0) : acc),
      0
    );
    return {
      totalEquityUsd: equityUsd,
      totalRealPnlUsd: openPnlUsd + realizedPnlUsd,
      realOpenPnlPct: openPnlPct,
    };
  }, [portfolio.cashUsd, portfolio.positions, portfolio.trades, portfolio.settings?.feeProfile]);

  return (
    <section
      aria-label="Resumen de cartera y escáner"
      className="border-b border-slate-800 bg-[#0E131D]"
    >
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 divide-y divide-slate-800 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        {/* KPI 1: Cash + Recharge */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-400 truncate">Capital disponible</p>
            <p
              data-testid="wallet-cash"
              className="mt-1 font-mono text-lg font-semibold tracking-tight text-slate-100 tabular-nums whitespace-nowrap"
            >
              {formatUsd(portfolio.cashUsd)}
            </p>
          </div>
          <button
            type="button"
            onClick={onQuickRecharge}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-500"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Recargar {formatCompactUsd(portfolio.settings.customInitialBalanceUsd || 1_000_000)}</span>
          </button>
        </div>

        {/* KPI 2: Total Equity & Single-Line Real Net PnL */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-400 truncate">Valor real y PnL (c/ gas)</p>
            <div className="mt-1 flex flex-nowrap items-baseline gap-2 whitespace-nowrap overflow-hidden">
              <span className="font-mono text-lg font-semibold tracking-tight text-slate-100 tabular-nums whitespace-nowrap">
                {formatUsd(totalEquityUsd)}
              </span>
              <span
                data-testid="kpi-pnl"
                className={`font-mono text-xs font-semibold tabular-nums whitespace-nowrap ${
                  totalRealPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {totalRealPnlUsd >= 0 ? '+' : ''}
                {formatUsd(totalRealPnlUsd)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenPortfolio}
            className="text-right text-xs font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline whitespace-nowrap shrink-0"
          >
            {portfolio.positions.length} abiertas
            <span className="block font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
              {formatSignedPct(realOpenPnlPct)} neto
            </span>
          </button>
        </div>

        {/* KPI 3: Stake Limits & Timeframe */}
        <div className="flex flex-col justify-center px-5 py-3.5">
          <p className="text-xs font-medium text-slate-400 truncate">Auto $20 · Manual $20–$100 · Ventana</p>
          <p className="mt-1 font-mono text-base font-semibold text-slate-100 tabular-nums whitespace-nowrap">
            Auto ${portfolio.settings.botMaxStakeUsd}
            <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-300">
              {(() => {
                const tf = portfolio.settings.scannerTimeframe;
                if (tf === 'all' || portfolio.settings.maxAgeHours <= 0) return 'Todos';
                if (tf === 'new') return 'New (≤2m)';
                if (tf) return `≤ ${tf}`;
                if (portfolio.settings.maxAgeHours < 1) {
                  return `≤ ${Math.max(1, Math.round(portfolio.settings.maxAgeHours * 60))}m`;
                }
                return portfolio.settings.maxAgeHours >= 240
                  ? '≤ 10 días'
                  : `≤ ${portfolio.settings.maxAgeHours}h`;
              })()}
            </span>
          </p>
        </div>

        {/* KPI 4: Auto Scanner */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-400 truncate">
              Escáner automático ({portfolio.settings.scanIntervalMinutes || 5} min)
            </p>
            <p
              data-testid="scanner-countdown"
              className="mt-1 font-mono text-lg font-semibold tracking-tight text-slate-100 tabular-nums whitespace-nowrap"
            >
              {portfolio.settings.autoScanEnabled
                ? formatCountdown(portfolio.nextScanAt, nowMs)
                : 'Pausado'}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleAutoScan}
            aria-pressed={portfolio.settings.autoScanEnabled}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-500 ${
              portfolio.settings.autoScanEnabled
                ? 'border-emerald-700/70 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {portfolio.settings.autoScanEnabled ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Pausar Bot</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Activar Bot</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
