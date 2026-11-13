import { useState } from 'react';
import type { Candle5m, ChartTimeframe } from '../shared/types';
import { formatCompactUsd, formatTokenPrice } from '../utils/formatters';

interface FiveHourChartProps {
  candles: Candle5m[];
  symbol: string;
  chartTimeframe?: ChartTimeframe;
  onChangeChartTimeframe?: (tf: ChartTimeframe) => void;
}

const CHART_TF_OPTIONS: ChartTimeframe[] = ['15m', '1h', '5h', '10h', '24h'];

const CHART_TF_LABEL: Record<ChartTimeframe, string> = {
  '15m': '15 min (velas 1m)',
  '1h': '1 hora (velas 1m)',
  '5h': '5 horas (velas 5m)',
  '10h': '10 horas (velas 15m)',
  '24h': '24 horas (velas 15m)',
};

export function FiveHourChart({
  candles,
  symbol,
  chartTimeframe = '5h',
  onChangeChartTimeframe,
}: FiveHourChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!candles || candles.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-slate-800 bg-[#0B0F17] text-xs text-slate-400">
        Sin datos de velas disponibles para el marco {chartTimeframe}.
      </div>
    );
  }

  const width = 520;
  const height = 164;
  const padLeft = 8;
  const padRight = 58;
  const padTop = 10;
  const padBottom = 32;
  const chartW = width - padLeft - padRight;
  const priceH = height - padTop - padBottom - 20;
  const volTop = padTop + priceH + 6;
  const volH = 18;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxP = Math.max(...highs);
  const minP = Math.min(...lows);
  const rangeP = maxP - minP || maxP * 0.05 || 1e-6;
  const maxVol = Math.max(...candles.map((c) => c.volumeUsd), 1);

  const yForPrice = (p: number) => padTop + ((maxP - p) / rangeP) * priceH;
  const stepX = chartW / Math.max(1, candles.length);
  const candleW = Math.max(2, Math.min(8, stepX * 0.65));

  const activeIndex = hoverIdx !== null && candles[hoverIdx] ? hoverIdx : candles.length - 1;
  const activeCandle = candles[activeIndex];
  const activeTime = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(activeCandle.timestamp));

  const firstTime = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(candles[0].timestamp));

  const lastTime = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(candles[candles.length - 1].timestamp));

  return (
    <div className="rounded-lg border border-slate-800 bg-[#0B0F17] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-300">
            {symbol} · {CHART_TF_LABEL[chartTimeframe]}
          </span>
          {onChangeChartTimeframe && (
            <div
              role="group"
              aria-label="Marco temporal del gráfico"
              className="flex items-center gap-0.5 rounded border border-slate-800 bg-[#111622] p-0.5"
            >
              {CHART_TF_OPTIONS.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onChangeChartTimeframe(tf)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    chartTimeframe === tf
                      ? 'bg-emerald-950/80 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400 tabular-nums">
          <span>{activeTime}</span>
          <span>C: {formatTokenPrice(activeCandle.close)}</span>
          <span>Vol: {formatCompactUsd(activeCandle.volumeUsd)}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label={`Gráfico de movimientos de ${chartTimeframe} para ${symbol}`}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal reference lines */}
        {[0, 0.5, 1].map((ratio) => {
          const y = padTop + ratio * priceH;
          const priceVal = maxP - ratio * rangeP;
          return (
            <g key={ratio}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#1E293B"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text
                x={width - padRight + 6}
                y={y + 3}
                fill="#64748B"
                fontSize={9}
                fontFamily="JetBrains Mono, monospace"
              >
                {formatTokenPrice(priceVal)}
              </text>
            </g>
          );
        })}

        {/* Candles + Volume */}
        {candles.map((c, idx) => {
          const xCenter = padLeft + idx * stepX + stepX / 2;
          const isUp = c.close >= c.open;
          const fill = isUp ? '#10B981' : '#F43F5E';

          const yHigh = yForPrice(c.high);
          const yLow = yForPrice(c.low);
          const yOpen = yForPrice(c.open);
          const yClose = yForPrice(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));

          const barH = Math.max(1.5, (c.volumeUsd / maxVol) * volH);

          return (
            <g
              key={c.timestamp}
              onMouseEnter={() => setHoverIdx(idx)}
              className="cursor-crosshair"
            >
              {/* Invisible hit target for easy hover */}
              <rect
                x={padLeft + idx * stepX}
                y={padTop}
                width={stepX}
                height={height - padTop - 16}
                fill="transparent"
              />
              {hoverIdx === idx && (
                <line
                  x1={xCenter}
                  y1={padTop}
                  x2={xCenter}
                  y2={volTop + volH}
                  stroke="#334155"
                  strokeWidth={1}
                />
              )}
              <line
                x1={xCenter}
                y1={yHigh}
                x2={xCenter}
                y2={yLow}
                stroke={fill}
                strokeWidth={1}
              />
              <rect
                x={xCenter - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyHeight}
                fill={fill}
                rx={0.5}
              />
              <rect
                x={xCenter - candleW / 2}
                y={volTop + (volH - barH)}
                width={candleW}
                height={barH}
                fill={fill}
                opacity={0.45}
              />
            </g>
          );
        })}

        {/* Time axis labels */}
        <text x={padLeft} y={height - 4} fill="#64748B" fontSize={9} fontFamily="JetBrains Mono, monospace">
          {firstTime}
        </text>
        <text
          x={width - padRight}
          y={height - 4}
          textAnchor="end"
          fill="#64748B"
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
        >
          {lastTime}
        </text>
      </svg>
    </div>
  );
}
