import { useEffect, useMemo, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import type { PortfolioState } from '../shared/types';
import {
  formatAge,
  formatChainLabel,
  formatSignedPct,
  formatTimeShort,
  formatTokenPrice,
  formatUsd,
} from '../utils/formatters';
import { HelpTooltip } from './HelpTooltip';

export type HistorySubTab = 'trades' | 'scans' | 'studies';

interface HistoryViewProps {
  portfolio: PortfolioState;
  initialSubTab?: HistorySubTab;
  onResetAll: (keepSettings?: boolean) => Promise<void>;
}

export function HistoryView({ portfolio, initialSubTab = 'trades', onResetAll }: HistoryViewProps) {
  const [subTab, setSubTab] = useState<HistorySubTab>(initialSubTab);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const lp = portfolio.learningProfile;
  const { profitFactor, netRealizedUsd, totalGasPaidUsd, bestTradeUsd, worstTradeUsd } = useMemo(() => {
    const sells = portfolio.trades.filter((t) => t.side === 'SELL');
    const grossWinsUsd = sells.reduce((s, t) => ((t.pnlUsd ?? 0) > 0 ? s + (t.pnlUsd ?? 0) : s), 0);
    const grossLossesUsd = Math.abs(
      sells.reduce((s, t) => ((t.pnlUsd ?? 0) < 0 ? s + (t.pnlUsd ?? 0) : s), 0)
    );
    const pf =
      sells.length === 0
        ? '—'
        : grossLossesUsd === 0
        ? grossWinsUsd > 0
          ? '∞'
          : '0.00'
        : (grossWinsUsd / grossLossesUsd).toFixed(2);
    return {
      profitFactor: pf,
      netRealizedUsd: sells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0),
      totalGasPaidUsd: portfolio.trades.reduce((s, t) => s + (t.feeUsd ?? 0), 0),
      bestTradeUsd: sells.length > 0 ? Math.max(...sells.map((t) => t.pnlUsd ?? 0)) : null,
      worstTradeUsd: sells.length > 0 ? Math.min(...sells.map((t) => t.pnlUsd ?? 0)) : null,
    };
  }, [portfolio.trades]);

  function handleExportCsv() {
    const header = [
      'Fecha',
      'Tipo',
      'Modo',
      'Token',
      'Cadena',
      'PrecioUSD',
      'JugadaUSD',
      'GasUSD',
      'PnLNetoUSD',
      'PnLPct',
      'Motivo',
    ].join(',');
    const rows = portfolio.trades.map((tr) =>
      [
        new Date(tr.timestamp).toISOString(),
        tr.side,
        tr.mode,
        `"${tr.symbol.replace(/"/g, '""')}"`,
        tr.chainId,
        tr.priceUsd,
        tr.stakeUsd,
        tr.feeUsd ?? 0,
        tr.pnlUsd ?? '',
        tr.pnlPct ?? '',
        `"${tr.reason.replace(/"/g, '""')}"`,
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `victorinox-historial-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleConfirmReset() {
    setResetting(true);
    try {
      await onResetAll(true);
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  }

  const scanIntervalMin = portfolio.settings?.scanIntervalMinutes ?? 5;

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            Historial, escaneos y estudio interno del bot
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Auditoría persistente de compras/ventas, escaneos cada {scanIntervalMin}m y aprendizaje automático · Exportable a CSV.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#111622] p-1">
            <button
              type="button"
              onClick={() => setSubTab('trades')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'trades' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Operaciones ({portfolio.trades.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('scans')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'scans' ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Escaneos {scanIntervalMin}m ({portfolio.scanLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('studies')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'studies' ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Estudio del Bot ({lp?.recentStudies?.length ?? 0})
            </button>
          </div>

          <button
            type="button"
            disabled={portfolio.trades.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Exportar CSV</span>
          </button>

          {confirmReset ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={resetting}
                onClick={handleConfirmReset}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{resetting ? 'Reseteando...' : 'Confirmar reset total'}</span>
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => setConfirmReset(false)}
                className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/70 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/60 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Resetear todo</span>
            </button>
          )}
        </div>
      </div>

      {/* Quantitative 4-metric performance strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-[#111622] sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        <div className="p-4">
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span>Profit Factor (cerradas)</span>
            <HelpTooltip
              title="Profit Factor"
              what="Ganancias totales divididas entre pérdidas totales en operaciones cerradas."
              why="Por encima de 1.50 la estrategia gana dinero sólido; por debajo de 1.00 el gas o las pérdidas erosionan la cuenta."
            />
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-100 tabular-nums whitespace-nowrap">
            {profitFactor}
          </p>
        </div>
        <div className="p-4">
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span>PnL neto realizado (gas incl.)</span>
            <HelpTooltip
              title="PnL Neto Realizado"
              what="Suma real de ganancias y pérdidas cerradas ya descontando fees y slippage de entrada/salida."
              why="Mide tu beneficio neto real acumulable en tu wallet."
            />
          </p>
          <p
            className={`mt-1 font-mono text-lg font-semibold tabular-nums whitespace-nowrap ${
              netRealizedUsd > 0 ? 'text-emerald-400' : netRealizedUsd < 0 ? 'text-rose-400' : 'text-slate-100'
            }`}
          >
            {netRealizedUsd > 0 ? '+' : ''}
            {formatUsd(netRealizedUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <span>Gas y fees totales</span>
            <HelpTooltip
              title="Comisiones Solana acumuladas"
              what="Total pagado en priority fees, gas Solana y peaje DEX de todas tus entradas y salidas."
              why="Con jugadas de $20, vigilar este dato evita regalar margen usando modo Turbo innecesariamente."
            />
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-amber-300 tabular-nums whitespace-nowrap">
            {formatUsd(totalGasPaidUsd)}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Mejor / Peor operación</p>
          <p className="mt-1 font-mono text-sm font-semibold tabular-nums whitespace-nowrap">
            {bestTradeUsd !== null && worstTradeUsd !== null ? (
              <>
                <span className="text-emerald-400">
                  {bestTradeUsd >= 0 ? '+' : ''}
                  {formatUsd(bestTradeUsd)}
                </span>
                <span className="mx-1.5 text-slate-600">/</span>
                <span className="text-rose-400">
                  {worstTradeUsd >= 0 ? '+' : ''}
                  {formatUsd(worstTradeUsd)}
                </span>
              </>
            ) : (
              <span className="text-slate-400">— / —</span>
            )}
          </p>
        </div>
      </div>

      {subTab === 'trades' ? (
        <div className="rounded-xl border border-slate-800 bg-[#111622] overflow-hidden">
          {portfolio.trades.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-400">
              Aún no se ha ejecutado ninguna compra o venta en esta cartera virtual.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                    <th className="py-3 pl-5 pr-3">Hora</th>
                    <th className="px-3 py-3">Tipo · Modo</th>
                    <th className="px-3 py-3">Token</th>
                    <th className="px-3 py-3 text-right">Precio</th>
                    <th className="px-3 py-3 text-right">Jugada</th>
                    <th className="px-3 py-3 text-right">Resultado</th>
                    <th className="pl-3 pr-5 py-3">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {portfolio.trades.map((tr) => (
                    <tr key={tr.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pl-5 pr-3 font-mono text-slate-400 tabular-nums">
                        {formatTimeShort(tr.timestamp)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`font-semibold ${
                            tr.side === 'BUY' ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {tr.side === 'BUY' ? 'COMPRA' : 'VENTA'}
                        </span>
                        <span className="ml-1.5 text-slate-400">
                          · {tr.mode === 'auto' ? 'Auto 5m' : 'Manual'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-100">
                        {tr.symbol}{' '}
                        <span className="font-mono text-[11px] text-slate-400">
                          ({formatChainLabel(tr.chainId)})
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300 tabular-nums">
                        {formatTokenPrice(tr.priceUsd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-200 tabular-nums">
                        {formatUsd(tr.stakeUsd)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {tr.side === 'SELL' && tr.pnlUsd !== undefined ? (
                          <span className={tr.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {tr.pnlUsd >= 0 ? '+' : ''}
                            {formatUsd(tr.pnlUsd)} ({formatSignedPct(tr.pnlPct ?? 0)})
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="pl-3 pr-5 py-2.5 text-slate-300 max-w-xs truncate" title={tr.reason}>
                        {tr.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : subTab === 'scans' ? (
        <div className="space-y-4">
          {portfolio.scanLogs.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#111622] p-12 text-center text-sm text-slate-400">
              No hay registros de escaneo todavía. Pulsa «Escanear Ahora» o espera al ciclo automático de 5 minutos.
            </div>
          ) : (
            portfolio.scanLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border border-slate-800 bg-[#111622] overflow-hidden"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-slate-100 tabular-nums">
                      {formatTimeShort(log.timestamp)}
                    </span>
                    <span className="text-slate-400">
                      {log.trigger === 'auto-5m' ? 'Escaneo automático' : 'Escaneo manual'} ·{' '}
                      {log.scannerMode === 'crazy'
                        ? 'Modo Crazy 1m'
                        : log.scannerMode === 'risky'
                        ? 'Modo Risky'
                        : 'Modo Estricto'}{' '}
                      · {log.tokensEvaluated} tokens analizados
                    </span>
                  </div>
                  <div className="font-mono text-slate-200 tabular-nums">
                    Comprados: <span className="text-emerald-400">{log.tokensBought}</span> · Invertido:{' '}
                    {formatUsd(log.totalSpentUsd)}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800/70 text-[11px] text-slate-400">
                        <th className="py-2 pl-5 pr-2">Token</th>
                        <th className="px-2 py-2 text-right">Edad</th>
                        <th className="px-2 py-2 text-right">Aptitud · Score</th>
                        <th className="px-2 py-2 text-right">Riesgo Rug</th>
                        <th className="px-2 py-2">Acción</th>
                        <th className="pl-2 pr-5 py-2">Detalle de evaluación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {log.decisions.map((dec) => (
                        <tr key={dec.tokenId}>
                          <td className="py-2 pl-5 pr-2 font-medium text-slate-100">
                            {dec.symbol}{' '}
                            <span className="font-mono text-[11px] text-slate-500">
                              {formatChainLabel(dec.chainId)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-slate-400 tabular-nums">
                            {formatAge(dec.ageMinutes)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-slate-200 tabular-nums">
                            {dec.aptitudePct !== undefined ? `${dec.aptitudePct}% · ` : ''}
                            {dec.score}/100
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-[11px] text-slate-300">
                            {dec.rugRiskLevel || '—'}
                          </td>
                          <td className="px-2 py-2 font-medium">
                            {dec.actionTaken === 'COMPRADO' ? (
                              <span className="text-emerald-400">
                                Comprado ({formatUsd(dec.stakeUsd ?? 0)})
                              </span>
                            ) : dec.actionTaken === 'YA_EN_CARTERA' ? (
                              <span className="text-amber-400">Ya en cartera</span>
                            ) : dec.actionTaken === 'SALDO_INSUFICIENTE' ? (
                              <span className="text-rose-400">Saldo insuficiente</span>
                            ) : (
                              <span className="text-slate-400">Descartado</span>
                            )}
                          </td>
                          <td className="pl-2 pr-5 py-2 text-slate-300">{dec.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Active Learning Directive Summary */}
          <div className="rounded-xl border border-slate-800 bg-[#111622] p-5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">
                Directiva actual del estudio interno
              </h2>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {lp.totalBuysStudied} compras · {lp.totalSellsStudied} ventas estudiadas ({lp.winsCount}G / {lp.lossesCount}P)
              </span>
            </div>
            <p className="text-xs leading-relaxed text-emerald-300">{lp.activeDirective}</p>
          </div>

          {/* Learned Trait Performance Table */}
          {lp.patternStats.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-[#111622] overflow-hidden">
              <div className="border-b border-slate-800 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  Patrones comunes medidos en operaciones cerradas
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                      <th className="py-2.5 pl-5 pr-3">Rasgo común</th>
                      <th className="px-3 py-2.5 text-right">Cierres</th>
                      <th className="px-3 py-2.5 text-right">Acierto</th>
                      <th className="px-3 py-2.5 text-right">PnL medio</th>
                      <th className="px-3 py-2.5 text-right">Pico medio</th>
                      <th className="px-3 py-2.5 text-right">Total USD</th>
                      <th className="pl-3 pr-5 py-2.5 text-right">Ajuste aplicado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                    {lp.patternStats.map((stat) => {
                      const winPct = stat.tradesCount > 0 ? (stat.winsCount / stat.tradesCount) * 100 : 0;
                      return (
                        <tr key={stat.key} className="hover:bg-slate-800/30">
                          <td className="py-2.5 pl-5 pr-3 font-sans font-medium text-slate-100">
                            {stat.label}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{stat.tradesCount}</td>
                          <td className="px-3 py-2.5 text-right text-slate-200">{winPct.toFixed(0)}%</td>
                          <td
                            className={`px-3 py-2.5 text-right ${
                              stat.avgPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatSignedPct(stat.avgPnlPct)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-300">
                            {formatSignedPct(stat.avgPeakPnlPct)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right ${
                              stat.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {stat.totalPnlUsd >= 0 ? '+' : ''}
                            {formatUsd(stat.totalPnlUsd)}
                          </td>
                          <td
                            className={`pl-3 pr-5 py-2.5 text-right font-semibold ${
                              stat.weightAdjustment > 0
                                ? 'text-emerald-400'
                                : stat.weightAdjustment < 0
                                ? 'text-rose-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {stat.weightAdjustment > 0
                              ? `+${stat.weightAdjustment} pts prioridad`
                              : stat.weightAdjustment < 0
                              ? `${stat.weightAdjustment} pts filtro`
                              : 'Observando'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Post-Buy & Post-Sell Study Log */}
          <div className="rounded-xl border border-slate-800 bg-[#111622] overflow-hidden">
            <div className="border-b border-slate-800 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-100">
                Mini estudios tras cada compra y venta ({lp.recentStudies.length})
              </h3>
            </div>
            {lp.recentStudies.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-400">
                Ejecuta una compra o cierra una venta para ver aquí el estudio interno automático.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {lp.recentStudies.map((st) => (
                  <div key={st.id} className="px-5 py-3.5 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-semibold ${
                            st.side === 'BUY'
                              ? 'text-emerald-400'
                              : (st.pnlUsd ?? 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {st.summary}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-400">
                          {st.mode === 'auto' ? 'Auto' : 'Manual'} ·{' '}
                          {st.scannerMode === 'crazy'
                            ? 'Crazy 1m'
                            : st.scannerMode === 'risky'
                            ? 'Risky'
                            : 'Estricto'}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {formatTimeShort(st.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200">{st.commonObservation}</p>
                    <p className="text-[11px] text-slate-400">
                      <span className="font-medium text-emerald-400">Conclusión operativa:</span>{' '}
                      {st.nextActionRule}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

