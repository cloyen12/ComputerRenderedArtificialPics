import { useEffect, useState } from 'react';
import {
  DEFAULT_BOT_SETTINGS,
  MAX_STAKE_USD,
  MIN_STAKE_USD,
  resolveTimeframeToHours,
} from '../shared/analyzer';
import type { BotSettings, ChartTimeframe, ScannerMode, ScannerTimeframeId } from '../shared/types';
import { formatUsd } from '../utils/formatters';
import { HelpTooltip } from './HelpTooltip';

interface BotRulesViewProps {
  settings: BotSettings;
  onSaveSettings: (next: Partial<BotSettings>) => Promise<void>;
}

const SCANNER_TIMEFRAME_OPTIONS: Array<{ id: ScannerTimeframeId; label: string }> = [
  { id: 'all', label: 'Todos (sin límite de edad)' },
  { id: 'new', label: 'New (≤ 2 min)' },
  { id: '1m', label: '1m (≤ 1 min)' },
  { id: '5m', label: '5m (≤ 5 min)' },
  { id: '10m', label: '10m (≤ 10 min)' },
  { id: '15m', label: '15m (≤ 15 min)' },
  { id: '1h', label: '1h' },
  { id: '5h', label: '5h' },
  { id: '10h', label: '10h' },
  { id: '24h', label: '24h' },
  { id: '1d', label: '1d (24h)' },
  { id: '10d', label: '10d (240h)' },
];

const CHART_TIMEFRAME_OPTIONS: Array<{ id: ChartTimeframe; label: string }> = [
  { id: '15m', label: '15 minutos (micro scalping)' },
  { id: '1h', label: '1 hora (intradía)' },
  { id: '5h', label: '5 horas (estándar)' },
  { id: '10h', label: '10 horas (tendencia media)' },
  { id: '24h', label: '24 horas (ciclo completo)' },
];

export function BotRulesView({ settings, onSaveSettings }: BotRulesViewProps) {
  const [form, setForm] = useState<BotSettings>(settings);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const settingsSyncKey = JSON.stringify(settings);

  useEffect(() => {
    if (!isDirty) {
      setForm(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsSyncKey]);

  function updateField<K extends keyof BotSettings>(key: K, value: BotSettings[K]) {
    setIsDirty(true);
    setSavedNotice(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(null);
    try {
      await onSaveSettings(form);
      setIsDirty(false);
      setSavedNotice(
        `Reglas guardadas y sincronizadas (Modo: ${
          form.scannerMode === 'crazy' ? 'Crazy 1m' : form.scannerMode === 'risky' ? `Risky ${form.riskyMinScorePct}%` : 'Estricto'
        } · Gráfico: ${form.chartTimeframe} · Base: ${formatUsd(form.customInitialBalanceUsd)}).`
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreDefaults() {
    const defaults = { ...DEFAULT_BOT_SETTINGS };
    setForm(defaults);
    setSaving(true);
    setSavedNotice(null);
    try {
      await onSaveSettings(defaults);
      setIsDirty(false);
      setSavedNotice('Valores predeterminados restaurados ($20 auto, SL -8%, Trailing activo).');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-6">
      <div className="rounded-xl border border-slate-800 bg-[#111622] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">
              Reglas del Bot, Estrategias (Estricto · Risky · Crazy 1m) y Ajustes
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Pasa el cursor o pulsa el icono <span className="font-semibold text-emerald-400">?</span> en cualquier ajuste para ver qué significa y por qué ajustarlo.
            </p>
          </div>
          {isDirty && (
            <span className="rounded-md border border-amber-700/60 bg-amber-950/40 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              Cambios sin guardar
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-6">
          {/* BLOQUE 1: MODO ESTRICTO */}
          <section className="rounded-xl border border-emerald-900/40 bg-[#0B0F17]/70 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div>
                <h2 className="text-sm font-semibold text-emerald-300">1. Modo Estricto (Filtros 8/8 conservadores)</h2>
                <p className="text-[11px] text-slate-400">
                  Exige que se cumplan todos los filtros mínimos y bloquea riesgos ALTO/CRÍTICO.
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateField('scannerMode', 'strict')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  form.scannerMode === 'strict'
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-700 bg-[#111622] text-slate-300 hover:bg-slate-800'
                }`}
              >
                {form.scannerMode === 'strict' ? 'Modo activo' : 'Activar Estricto'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label
                  htmlFor="rule-min-liq"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Liquidez mínima Estricto (USD)</span>
                  <HelpTooltip
                    title="Liquidez mínima en Estricto"
                    what="Profundidad mínima en USD del pool exigida en Modo Estricto."
                    why="Subirlo ($25K+) baja el slippage y bloquea pools fáciles de drenar; bajarlo abre pares pequeños."
                  />
                </label>
                <input
                  id="rule-min-liq"
                  type="number"
                  min={1000}
                  step={1}
                  value={form.minLiquidityUsd}
                  onChange={(e) => updateField('minLiquidityUsd', Math.max(1000, Number(e.target.value)))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-min-vol"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Volumen mínimo 5h (USD)</span>
                  <HelpTooltip
                    title="Volumen mínimo en 5 horas"
                    what="Dinero total negociado durante las últimas 5 horas en el par."
                    why="Garantiza demanda activa para salir sin quedarte atrapado; súbelo si ves tokens sin flujo."
                  />
                </label>
                <input
                  id="rule-min-vol"
                  type="number"
                  min={1000}
                  step={1}
                  value={form.minVolume5hUsd}
                  onChange={(e) => updateField('minVolume5hUsd', Math.max(1000, Number(e.target.value)))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-min-txns"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Transacciones mínimas</span>
                  <HelpTooltip
                    title="Transacciones mínimas"
                    what="Cantidad mínima de swaps ejecutados recientemente en el pool."
                    why="Exigir 40–80+ filtra gráficos manipulados por pocas wallets; bajarlo capta pares recién creados."
                  />
                </label>
                <input
                  id="rule-min-txns"
                  type="number"
                  min={5}
                  step={1}
                  value={form.minTxnsCount}
                  onChange={(e) => updateField('minTxnsCount', Math.max(5, Number(e.target.value)))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-buy-ratio"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Presión compradora mín. (%)</span>
                  <HelpTooltip
                    title="Presión compradora mínima"
                    what="Porcentaje mínimo de transacciones de compra frente a ventas en 1h/5m."
                    why="Subirlo (56–62%) exige demanda clara y evita entrar cuando las ballenas están descargando."
                  />
                </label>
                <input
                  id="rule-buy-ratio"
                  type="number"
                  min={50}
                  max={85}
                  value={Math.round(form.minBuyRatio * 100)}
                  onChange={(e) =>
                    updateField('minBuyRatio', Math.min(0.85, Math.max(0.5, Number(e.target.value) / 100)))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-min-volat"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Volatilidad mínima (%)</span>
                  <HelpTooltip
                    title="Volatilidad mínima en la ventana"
                    what="Amplitud mínima de movimiento en las velas analizadas para que compense operar."
                    why="8–12% evita monedas planas donde solo pagas comisiones de Solana sin recorrido."
                  />
                </label>
                <input
                  id="rule-min-volat"
                  type="number"
                  min={2}
                  max={80}
                  step={1}
                  value={form.minVolatilityPct}
                  onChange={(e) =>
                    updateField('minVolatilityPct', Math.min(80, Math.max(2, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-min-exp-profit"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Beneficio neto mínimo (%)</span>
                  <HelpTooltip
                    title="Margen neto mínimo tras comisiones"
                    what="Rentabilidad esperada mínima después de restar gas de entrada/salida y slippage."
                    why="6%+ asegura que una operación promedio de $20 cubra de sobra las tasas de la red."
                  />
                </label>
                <input
                  id="rule-min-exp-profit"
                  type="number"
                  min={2}
                  max={50}
                  step={1}
                  value={form.minExpectedProfitPct}
                  onChange={(e) =>
                    updateField('minExpectedProfitPct', Math.min(50, Math.max(2, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* BLOQUE 2: MODO RISKY */}
          <section className="rounded-xl border border-amber-900/40 bg-[#0B0F17]/70 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div>
                <h2 className="text-sm font-semibold text-amber-300">
                  2. Modo Risky (Compra por % de aptitud configurable)
                </h2>
                <p className="text-[11px] text-slate-400">
                  Compra cualquier token que supere tu umbral de aptitud (%) sin desplome activo y cumpla liquidez/edad Risky.
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateField('scannerMode', 'risky')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  form.scannerMode === 'risky'
                    ? 'bg-amber-600 text-white'
                    : 'border border-slate-700 bg-[#111622] text-slate-300 hover:bg-slate-800'
                }`}
              >
                {form.scannerMode === 'risky' ? 'Modo activo' : 'Activar Risky'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label
                  htmlFor="rule-risky-pct"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Umbral mínimo Risky (%)</span>
                  <HelpTooltip
                    title="Umbral mínimo en Modo Risky"
                    what="Porcentaje mínimo de aptitud exigido para dar señal COMPRAR en Modo Risky."
                    why="Si lo bajas a 55–65%, el bot comprará monedas antes ignoradas; 75–85% es más selectivo."
                  />
                </label>
                <input
                  id="rule-risky-pct"
                  type="number"
                  min={40}
                  max={95}
                  value={form.riskyMinScorePct}
                  onChange={(e) =>
                    updateField('riskyMinScorePct', Math.min(95, Math.max(40, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-risky-liq"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Liquidez mínima Risky (USD)</span>
                  <HelpTooltip
                    title="Liquidez mínima en Modo Risky"
                    what="Profundidad mínima en dólares exigida al pool exclusivo en Modo Risky."
                    why="$8K–$12K permite memecoins recién nacidas; súbelo a $20K si sufres mucho slippage."
                  />
                </label>
                <input
                  id="rule-risky-liq"
                  type="number"
                  min={2000}
                  step={1}
                  value={form.riskyMinLiquidityUsd}
                  onChange={(e) =>
                    updateField('riskyMinLiquidityUsd', Math.max(2000, Number(e.target.value)))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-risky-age"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Edad mínima Risky (min)</span>
                  <HelpTooltip
                    title="Edad mínima del pool en Risky"
                    what="Minutos de vida desde la creación del par exigidos antes de entrar en Risky."
                    why="15 min esquiva rug pulls tempranos; 1–5 min entra casi en el lanzamiento."
                  />
                </label>
                <input
                  id="rule-risky-age"
                  type="number"
                  min={1}
                  max={60}
                  value={form.riskyMinAgeMinutes}
                  onChange={(e) =>
                    updateField('riskyMinAgeMinutes', Math.min(60, Math.max(1, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={form.riskyAllowHighRugRisk}
                onChange={(e) => updateField('riskyAllowHighRugRisk', e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-600 bg-[#111622] accent-amber-500"
              />
              <span className="font-medium">Risky: permitir riesgo ALTO (siempre bloquea riesgo CRÍTICO)</span>
              <HelpTooltip
                title="Riesgo ALTO en Modo Risky"
                what="Permite operar tokens marcados como ALTO cuando superan tu % mínimo; CRÍTICO sigue bloqueado."
                why="Mantenlo activo si buscas entradas muy tempranas; desactívalo para limitar Risky a BAJO/MEDIO."
              />
            </label>
          </section>

          {/* BLOQUE 3: MODO CRAZY (SCALPING 1 MINUTO) */}
          <section className="rounded-xl border border-fuchsia-900/40 bg-[#0B0F17]/70 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div>
                <h2 className="text-sm font-semibold text-fuchsia-300">
                  3. Modo Crazy 1m (Scalping rápido · entrada en suelo y salida en alto)
                </h2>
                <p className="text-[11px] text-slate-400">
                  Analiza la trayectoria reciente para detectar rebotes en parte baja de rango y cerrar rápido en ~1 minuto (vigilado cada 5s).
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateField('scannerMode', 'crazy')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  form.scannerMode === 'crazy'
                    ? 'bg-fuchsia-600 text-white'
                    : 'border border-slate-700 bg-[#111622] text-slate-300 hover:bg-slate-800'
                }`}
              >
                {form.scannerMode === 'crazy' ? 'Modo activo' : 'Activar Crazy 1m'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor="rule-crazy-tp"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Take-Profit Crazy (%)</span>
                  <HelpTooltip
                    title="Objetivo rápido en Crazy 1m"
                    what="Porcentaje de subida rápida desde la entrada donde Crazy cierra la jugada con beneficio."
                    why="8–12% captura impulsos cortos de 1 minuto antes de que giren a la baja."
                  />
                </label>
                <input
                  id="rule-crazy-tp"
                  type="number"
                  min={4}
                  max={50}
                  step={1}
                  value={form.crazyTakeProfitPct}
                  onChange={(e) =>
                    updateField('crazyTakeProfitPct', Math.min(50, Math.max(4, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-fuchsia-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-crazy-sl"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Stop-Loss Crazy (%)</span>
                  <HelpTooltip
                    title="Stop Loss ceñido en Crazy 1m"
                    what="Pérdida máxima tolerada en micro-scalping antes de cortar la operación."
                    why="4–6% protege el capital cuando un rebote falla en cuestión de segundos."
                  />
                </label>
                <input
                  id="rule-crazy-sl"
                  type="number"
                  min={2}
                  max={20}
                  step={0.1}
                  value={form.crazyStopLossPct}
                  onChange={(e) =>
                    updateField('crazyStopLossPct', Math.min(20, Math.max(2, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-fuchsia-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-crazy-hold"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Plazo máximo salida (seg)</span>
                  <HelpTooltip
                    title="Cierre temporal Crazy 1m"
                    what="Segundos máximos que el bot mantiene abierta una jugada Crazy antes de cerrarla automáticamente."
                    why="60s cumple el plazo de 1 minuto para entrar en bajo, salir en alto y no quedarse atrapado."
                  />
                </label>
                <input
                  id="rule-crazy-hold"
                  type="number"
                  min={20}
                  max={300}
                  step={1}
                  value={form.crazyMaxHoldSeconds}
                  onChange={(e) =>
                    updateField('crazyMaxHoldSeconds', Math.min(300, Math.max(20, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-fuchsia-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-crazy-liq"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Liquidez mín. Crazy (USD)</span>
                  <HelpTooltip
                    title="Liquidez mínima para Crazy 1m"
                    what="Profundidad mínima en USD para entrar y salir en 1 minuto sin impacto excesivo en precio."
                    why="$5,000–$10,000 da suficiente contrapartida para entradas rápidas de $20."
                  />
                </label>
                <input
                  id="rule-crazy-liq"
                  type="number"
                  min={2000}
                  max={100000}
                  step={1}
                  value={form.crazyMinLiquidityUsd}
                  onChange={(e) =>
                    updateField('crazyMinLiquidityUsd', Math.min(100000, Math.max(2000, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-fuchsia-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* BLOQUE 4: OTROS AJUSTES, GRÁFICO Y GESTIÓN DE RIESGO */}
          <section className="rounded-xl border border-slate-800 bg-[#0B0F17]/70 p-4 space-y-5">
            <div className="border-b border-slate-800/80 pb-2.5">
              <h2 className="text-sm font-semibold text-slate-100">
                4. Otros ajustes · Gráfico, Cartera, Comisiones y Protecciones
              </h2>
              <p className="text-[11px] text-slate-400">
                Ajusta el horizonte del gráfico, sincroniza el saldo base de la cartera y configura las protecciones comunes.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label
                  htmlFor="rule-scanner-mode"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Modo de escáner activo</span>
                  <HelpTooltip
                    title="Selector de estrategia activa"
                    what="Define si el escáner evalúa compras con Estricto, Risky o Crazy 1m."
                    why="También puedes alternarlo al vuelo desde la barra superior del mercado."
                  />
                </label>
                <select
                  id="rule-scanner-mode"
                  value={form.scannerMode}
                  onChange={(e) => {
                    const v = e.target.value;
                    const mode: ScannerMode = v === 'risky' || v === 'crazy' ? v : 'strict';
                    updateField('scannerMode', mode);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="strict">Estricto (8/8 filtros y riesgo bajo/medio)</option>
                  <option value="risky">Risky (permite compras desde {form.riskyMinScorePct}%)</option>
                  <option value="crazy">Crazy 1m (scalping bajo → alto en ~{form.crazyMaxHoldSeconds}s)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="rule-chart-tf"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Ventana del gráfico</span>
                  <HelpTooltip
                    title="Horizonte temporal del gráfico"
                    what="Controla cuántas horas o minutos muestra el gráfico de velas en el inspector y en Cartera."
                    why="Usa 15m/1h para scalping rápido y 5h/10h/24h para leer la estructura completa del día."
                  />
                </label>
                <select
                  id="rule-chart-tf"
                  value={form.chartTimeframe}
                  onChange={(e) => updateField('chartTimeframe', e.target.value as ChartTimeframe)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {CHART_TIMEFRAME_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="rule-scanner-tf"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Ventana de mercado (Tokens)</span>
                  <HelpTooltip
                    title="Filtro temporal de creación del par"
                    what="Elige ver Todos los pares activos o solo los lanzados en New, 1m, 5m, 10m, 15m, 1h, 5h, 10h, 24h, 1d o 10d."
                    why="Todos reúne activos de todas las edades; New/1m–15m se enfoca en lanzamientos recién salidos."
                  />
                </label>
                <select
                  id="rule-scanner-tf"
                  value={form.scannerTimeframe}
                  onChange={(e) => {
                    const tf = e.target.value as ScannerTimeframeId;
                    setIsDirty(true);
                    setSavedNotice(null);
                    setForm((prev) => ({
                      ...prev,
                      scannerTimeframe: tf,
                      maxAgeHours: resolveTimeframeToHours(tf),
                    }));
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {SCANNER_TIMEFRAME_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="rule-initial-balance"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Saldo base de cartera (USD)</span>
                  <HelpTooltip
                    title="Saldo base sincronizado con Cartera"
                    what="Saldo virtual de referencia que se sincroniza directamente con la pestaña Cartera."
                    why="Pon $500–$2,000 para simular tu banca real sin conflictos entre Reglas y Cartera."
                  />
                </label>
                <input
                  id="rule-initial-balance"
                  type="number"
                  min={20}
                  max={10_000_000}
                  step={1}
                  value={form.customInitialBalanceUsd}
                  onChange={(e) =>
                    updateField(
                      'customInitialBalanceUsd',
                      Math.min(10_000_000, Math.max(20, Number(e.target.value)))
                    )
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-scan-interval"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Intervalo escaneo auto (min)</span>
                  <HelpTooltip
                    title="Intervalo de escaneo automático"
                    what="Frecuencia con la que el bot consulta DexScreener y evalúa los últimos pools de Solana."
                    why="1–3 min capta lanzamientos rápidos; 5–10 min evita sobre-operar en mercados lentos."
                  />
                </label>
                <input
                  id="rule-scan-interval"
                  type="number"
                  min={1}
                  max={60}
                  value={form.scanIntervalMinutes}
                  onChange={(e) =>
                    updateField('scanIntervalMinutes', Math.min(60, Math.max(1, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-fee-profile"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Comisión Solana y salida</span>
                  <HelpTooltip
                    title="Comisión Solana y velocidad de salida"
                    what="Prioridad de gas y fee DEX en Solana al entrar y salir."
                    why="Con $20, Punto medio (~2.3% ida/vuelta) evita el 10% del modo Turbo sin quedar lento al vender."
                  />
                </label>
                <select
                  id="rule-fee-profile"
                  value={form.feeProfile}
                  onChange={(e) =>
                    updateField(
                      'feeProfile',
                      e.target.value === 'economico' || e.target.value === 'rapido'
                        ? e.target.value
                        : 'medio'
                    )
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="medio">Punto medio (~$0.22/lado · 4–9s salida)</option>
                  <option value="economico">Económico (~$0.05 gas · 10–18s salida)</option>
                  <option value="rapido">Turbo Jito ($1.00+$1.00 · 1–2s)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="rule-min-stake"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Orden auto mínima ($20–$100)</span>
                  <HelpTooltip
                    title="Orden automática mínima"
                    what="Capital base que invierte el bot en señales válidas."
                    why="$20 limita pérdidas por rug pull y permite diversificar múltiples jugadas en paralelo."
                  />
                </label>
                <input
                  id="rule-min-stake"
                  type="number"
                  min={MIN_STAKE_USD}
                  max={MAX_STAKE_USD}
                  value={form.botMinStakeUsd}
                  onChange={(e) =>
                    updateField(
                      'botMinStakeUsd',
                      Math.min(MAX_STAKE_USD, Math.max(MIN_STAKE_USD, Number(e.target.value)))
                    )
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-max-stake"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Orden auto máxima ($20–$100)</span>
                  <HelpTooltip
                    title="Orden automática máxima"
                    what="Tope máximo automático para los tokens con mayor puntuación."
                    why="Déjalo en $20 para riesgo fijo por jugada; súbelo si quieres escalar señales 95–100%."
                  />
                </label>
                <input
                  id="rule-max-stake"
                  type="number"
                  min={MIN_STAKE_USD}
                  max={MAX_STAKE_USD}
                  value={form.botMaxStakeUsd}
                  onChange={(e) =>
                    updateField(
                      'botMaxStakeUsd',
                      Math.min(MAX_STAKE_USD, Math.max(MIN_STAKE_USD, Number(e.target.value)))
                    )
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-sl"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Stop Loss inicial (%)</span>
                  <HelpTooltip
                    title="Stop Loss inicial reducido"
                    what="Pérdida máxima tolerada desde la entrada antes de vender automáticamente (Estricto/Risky)."
                    why="6–8% corta caídas rápido; 10–14% da más aire si el token oscila antes de subir."
                  />
                </label>
                <input
                  id="rule-sl"
                  type="number"
                  min={3}
                  max={25}
                  value={form.defaultStopLossPct}
                  onChange={(e) => updateField('defaultStopLossPct', Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-tp"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Activación Trailing TP (%)</span>
                  <HelpTooltip
                    title="Activación Trailing Take-Profit"
                    what="Subida mínima desde la entrada que activa el seguimiento dinámico sin techo fijo."
                    why="Bájalo (12–15%) para asegurar rallies cortos; súbelo (22–30%) para buscar +50%/+100%."
                  />
                </label>
                <input
                  id="rule-tp"
                  type="number"
                  min={5}
                  max={100}
                  value={form.defaultTakeProfitPct}
                  onChange={(e) => updateField('defaultTakeProfitPct', Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-callback"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Retroceso desde pico (%)</span>
                  <HelpTooltip
                    title="Retroceso Trailing"
                    what="Caída desde el máximo alcanzado que dispara la venta para asegurar el pico."
                    why="6–8% vende pegado al techo; 12–15% aguanta sacudidas sin salir antes del segundo impulso."
                  />
                </label>
                <input
                  id="rule-callback"
                  type="number"
                  min={3}
                  max={25}
                  value={form.trailingCallbackPct}
                  onChange={(e) => updateField('trailingCallbackPct', Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-be-trigger"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Activación Break-Even (%)</span>
                  <HelpTooltip
                    title="Activación Auto Break-Even"
                    what="Subida desde la entrada que mueve el Stop Loss a territorio positivo."
                    why="Bájalo (7–9%) para blindar rápido; súbelo (12–15%) si los tokens retroceden antes de despegar."
                  />
                </label>
                <input
                  id="rule-be-trigger"
                  type="number"
                  min={5}
                  max={25}
                  value={form.breakEvenTriggerPct}
                  onChange={(e) => updateField('breakEvenTriggerPct', Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-be-floor"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Suelo Break-Even (+% cubre tasas)</span>
                  <HelpTooltip
                    title="Suelo Break-Even"
                    what="Ganancia mínima asegurada tras activarse el Break-Even."
                    why="Mantenlo ≥ 2.5% para cubrir gas y slippage de entrada y salida sin perder dinero."
                  />
                </label>
                <input
                  id="rule-be-floor"
                  type="number"
                  min={0.5}
                  max={12}
                  step={0.5}
                  value={form.breakEvenFloorPct}
                  onChange={(e) => updateField('breakEvenFloorPct', Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-max-positions"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Máximo posiciones abiertas</span>
                  <HelpTooltip
                    title="Límite de posiciones abiertas"
                    what="Cantidad máxima de tokens abiertos simultáneamente para evitar sobreexposición."
                    why="En carteras de $500–$1,000, limitar a 5–10 jugadas de $20 protege tu liquidez libre."
                  />
                </label>
                <input
                  id="rule-max-positions"
                  type="number"
                  min={1}
                  max={30}
                  value={form.maxOpenPositions}
                  onChange={(e) =>
                    updateField('maxOpenPositions', Math.min(30, Math.max(1, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-cooldown"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Cooldown anti-recompra (min)</span>
                  <HelpTooltip
                    title="Cooldown tras venta"
                    what="Pausa obligatoria antes de que el bot pueda volver a comprar un token recién cerrado."
                    why="15–30 min evita reentrar inmediatamente tras un Stop Loss o toma de beneficios."
                  />
                </label>
                <input
                  id="rule-cooldown"
                  type="number"
                  min={0}
                  max={240}
                  value={form.reentryCooldownMinutes}
                  onChange={(e) =>
                    updateField(
                      'reentryCooldownMinutes',
                      Math.min(240, Math.max(0, Number(e.target.value)))
                    )
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="rule-daily-loss"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200"
                >
                  <span>Stop diario auto (USD, 0=off)</span>
                  <HelpTooltip
                    title="Freno diario de pérdidas"
                    what="Límite de pérdida diaria realizada a partir del cual se pausan compras automáticas."
                    why="Fija $60–$100 en sesiones reales para cortar malas rachas de mercado automáticamente."
                  />
                </label>
                <input
                  id="rule-daily-loss"
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  value={form.dailyMaxLossUsd}
                  onChange={(e) =>
                    updateField('dailyMaxLossUsd', Math.min(10000, Math.max(0, Number(e.target.value))))
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#111622] px-3 py-2 font-mono text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoScanEnabled}
                  onChange={(e) => updateField('autoScanEnabled', e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-slate-600 bg-[#111622] accent-emerald-500"
                />
                <span className="font-medium">
                  Escaneo auto cada {form.scanIntervalMinutes}m (${form.botMinStakeUsd})
                </span>
                <HelpTooltip
                  title="Escaneo y compra automática"
                  what="Ejecuta el ciclo periódico del bot de forma autónoma."
                  why="Desactívalo si prefieres analizar y pulsar compras manualmente."
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoCloseTpSl}
                  onChange={(e) => updateField('autoCloseTpSl', e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-slate-600 bg-[#111622] accent-emerald-500"
                />
                <span className="font-medium">Venta auto (SL / BE / Trailing / 1m)</span>
                <HelpTooltip
                  title="Cierre automático TP/SL"
                  what="Cierra posiciones automáticamente cuando tocan SL, Break-Even, Trailing o el plazo de 1m en Crazy."
                  why="Mantenlo activo para proteger beneficios y limitar pérdidas."
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.adaptiveLearningEnabled}
                  onChange={(e) => updateField('adaptiveLearningEnabled', e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-slate-600 bg-[#111622] accent-emerald-500"
                />
                <span className="font-medium">Estudio interno automático</span>
                <HelpTooltip
                  title="Aprendizaje tras compras/ventas"
                  what="Analiza patrones comunes de tus operaciones cerradas para ajustar puntuaciones."
                  why="Prioriza características ganadoras repetidas y filtra trampas frecuentes."
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.simulateExecutionDelay}
                  onChange={(e) => updateField('simulateExecutionDelay', e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-slate-600 bg-[#111622] accent-emerald-500"
                />
                <span className="font-medium">Estimar latencia Solana (sin bloquear)</span>
                <HelpTooltip
                  title="Estimación realista de latencia"
                  what="Calcula el tiempo estimado de confirmación en Solana para auditoría sin bloquear tus clics manuales."
                  why="Te permite navegar entre pestañas y lanzar varias compras a la vez viendo el retraso real estimado."
                />
              </label>
            </div>
          </section>

          {savedNotice && (
            <p role="status" className="text-xs font-medium text-emerald-400">
              {savedNotice}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              disabled={saving}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Restaurar valores
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar reglas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
