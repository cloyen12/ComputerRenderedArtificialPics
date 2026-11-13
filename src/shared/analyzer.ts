import { calculateExecutionEstimate, estimateOpenPositionNetPnl } from './execution.ts';
import {
  buildEntryFeatureSnapshot,
  createInitialLearningProfile,
  evaluateLearnedBonus,
  recordBuyStudy,
  recordSellStudy,
} from './learning.ts';
import type {
  BotLearningProfile,
  BotSettings,
  Candle5m,
  ChartTimeframe,
  FiveHourAnalysis,
  PortfolioState,
  Position,
  RugRiskLevel,
  ScannerMode,
  ScannerTimeframeId,
  ThresholdCheck,
  TokenPair,
  TradeRecord,
} from './types.ts';

export const INITIAL_VIRTUAL_BALANCE_USD = 1_000_000;
export const MIN_STAKE_USD = 20;
export const MAX_STAKE_USD = 100;
export const DEFAULT_AUTO_STAKE_USD = 20;
export const MAX_WINDOW_HOURS = 240; // Up to 10 days (240h)
export const FIVE_HOUR_MINUTES = 300;
export const FIVE_MINUTE_MS = 5 * 60 * 1000;

export const TIMEFRAME_HOURS_MAP: Record<ScannerTimeframeId, number> = {
  all: 0,
  new: 2 / 60,
  '1m': 1 / 60,
  '5m': 5 / 60,
  '10m': 10 / 60,
  '15m': 15 / 60,
  '1h': 1,
  '5h': 5,
  '10h': 10,
  '24h': 24,
  '1d': 24,
  '10d': 240,
};

export function resolveTimeframeToHours(id: ScannerTimeframeId): number {
  return TIMEFRAME_HOURS_MAP[id] ?? 24;
}

export function getChartWindowMinutes(tf: ChartTimeframe = '5h'): number {
  switch (tf) {
    case '15m':
      return 15;
    case '1h':
      return 60;
    case '5h':
      return 300;
    case '10h':
      return 600;
    case '24h':
      return 1440;
    default:
      return 300;
  }
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  onlySolana: true,
  customInitialBalanceUsd: INITIAL_VIRTUAL_BALANCE_USD,
  scannerMode: 'strict',
  scannerTimeframe: '24h',
  chartTimeframe: '5h',
  scannerSortBy: 'score',
  riskyMinScorePct: 70,
  riskyMinLiquidityUsd: 8_000,
  riskyMinAgeMinutes: 15,
  riskyAllowHighRugRisk: true,
  crazyTakeProfitPct: 10,
  crazyStopLossPct: 5,
  crazyMaxHoldSeconds: 60,
  crazyMinLiquidityUsd: 5_000,
  adaptiveLearningEnabled: true,
  feeProfile: 'medio', // Balanced midpoint fee (~$0.22/side instead of $1+$1 turbo)
  simulateExecutionDelay: true,
  breakEvenTriggerPct: 10, // Once trade reaches +10%, lock floor above fees
  breakEvenFloorPct: 2.5, // Covers Punto Medio round-trip fees so winners don't turn negative
  maxOpenPositions: 10,
  reentryCooldownMinutes: 20,
  dailyMaxLossUsd: 0,
  autoScanEnabled: true,
  scanIntervalMinutes: 5,
  maxAgeHours: 24,
  displayLimit: 25,
  minLiquidityUsd: 15_000,
  minVolume5hUsd: 25_000,
  minTxnsCount: 40,
  minBuyRatio: 0.53,
  minVolatilityPct: 8,
  minExpectedProfitPct: 5,
  botMinStakeUsd: 20,
  botMaxStakeUsd: 20, // Strictly $20 automatic orders
  autoCloseTpSl: true,
  defaultTakeProfitPct: 18, // Trailing activation at +18% (lets rallies run to +50%, +100%+)
  defaultStopLossPct: 8, // Tighter stop loss (-8%)
  trailingCallbackPct: 10, // Sells if it drops 10% from highest peak reached
};

export function createInitialPortfolioState(initialBalanceUsd: number = INITIAL_VIRTUAL_BALANCE_USD): PortfolioState {
  const now = Date.now();
  const safeBalance = Number(
    Math.max(20, Math.min(10_000_000, Number.isFinite(initialBalanceUsd) ? initialBalanceUsd : INITIAL_VIRTUAL_BALANCE_USD)).toFixed(2)
  );
  return {
    cashUsd: safeBalance,
    totalRechargedUsd: 0,
    positions: [],
    trades: [],
    scanLogs: [],
    settings: { ...DEFAULT_BOT_SETTINGS, customInitialBalanceUsd: safeBalance },
    learningProfile: createInitialLearningProfile(),
    lastScanAt: null,
    nextScanAt: now + DEFAULT_BOT_SETTINGS.scanIntervalMinutes * 60 * 1000,
  };
}

/**
 * Validates a manual or auto stake amount strictly inside [$20, $100].
 */
export function validateStakeUsd(stakeUsd: number): {
  valid: boolean;
  clamped: number;
  error?: string;
} {
  if (!Number.isFinite(stakeUsd)) {
    return {
      valid: false,
      clamped: MIN_STAKE_USD,
      error: 'El importe de la jugada debe ser un número válido.',
    };
  }
  if (stakeUsd < MIN_STAKE_USD || stakeUsd > MAX_STAKE_USD) {
    return {
      valid: false,
      clamped: Math.min(MAX_STAKE_USD, Math.max(MIN_STAKE_USD, Number(stakeUsd.toFixed(2)))),
      error: `Cada jugada debe estar estrictamente entre $${MIN_STAKE_USD} y $${MAX_STAKE_USD} USD.`,
    };
  }
  return {
    valid: true,
    clamped: Number(stakeUsd.toFixed(2)),
  };
}

/**
 * Filters pairs strictly to Solana tokens (when onlySolana=true) created within maxAgeHours (0=Todos, 1h, 5h, 24h, or 10d=240h).
 */
export function filterVolatileNewTokens(
  pairs: TokenPair[],
  nowMs: number = Date.now(),
  maxAgeHours: number = 24,
  onlySolana: boolean = true
): TokenPair[] {
  const isAllWindows = maxAgeHours <= 0;
  const cappedMaxHours = isAllWindows
    ? MAX_WINDOW_HOURS
    : Math.min(MAX_WINDOW_HOURS, Math.max(1 / 60, maxAgeHours));
  const maxAgeMs = isAllWindows ? Number.POSITIVE_INFINITY : cappedMaxHours * 60 * 60 * 1000;

  return pairs
    .map((p) => {
      const ageMs = Math.max(1000, nowMs - p.pairCreatedAt);
      const ageSeconds = Math.max(1, Math.round(ageMs / 1000));
      const ageMinutes = Math.max(0, Number((ageMs / 60000).toFixed(2)));
      return { ...p, ageMinutes, ageSeconds };
    })
    .filter((p) => {
      if (onlySolana && p.chainId.toLowerCase() !== 'solana') return false;
      const ageMs = nowMs - p.pairCreatedAt;
      return ageMs > 0 && ageMs <= maxAgeMs && p.priceUsd > 0;
    });
}

/**
 * Ranks and selects up to `limit` (default 25, with #1-#10 as Top 10) most volatile Solana tokens in the selected window.
 */
export function selectTopVolatileTokens(
  pairs: TokenPair[],
  nowMs: number = Date.now(),
  maxAgeHours: number = 24,
  onlySolana: boolean = true,
  limit: number = 25
): TokenPair[] {
  const eligible = filterVolatileNewTokens(pairs, nowMs, maxAgeHours, onlySolana);
  const effectiveHours = maxAgeHours <= 0 ? MAX_WINDOW_HOURS : Math.max(1 / 60, maxAgeHours);

  const byTokenKey = new Map<string, TokenPair>();
  for (const pair of eligible) {
    const key = `${pair.chainId}:${pair.baseToken.address.toLowerCase()}`;
    const existing = byTokenKey.get(key);
    if (!existing || pair.volume.h6 + pair.liquidityUsd > existing.volume.h6 + existing.liquidityUsd) {
      byTokenKey.set(key, pair);
    }
  }

  return Array.from(byTokenKey.values())
    .sort((a, b) => {
      const volScoreA =
        Math.abs(a.priceChange.m5) * 2.2 + Math.abs(a.priceChange.h1) * 1.4 + Math.abs(a.priceChange.h6) * 0.6;
      const volScoreB =
        Math.abs(b.priceChange.m5) * 2.2 + Math.abs(b.priceChange.h1) * 1.4 + Math.abs(b.priceChange.h6) * 0.6;
      const maxWindowMin = Math.max(1, effectiveHours * 60);
      const recencyA = Math.max(0, maxWindowMin - a.ageMinutes) / Math.max(1, maxWindowMin / 24);
      const recencyB = Math.max(0, maxWindowMin - b.ageMinutes) / Math.max(1, maxWindowMin / 24);
      const liqBonusA = a.liquidityUsd >= 15_000 ? 25 : 0;
      const liqBonusB = b.liquidityUsd >= 15_000 ? 25 : 0;
      return volScoreB + recencyB + liqBonusB - (volScoreA + recencyA + liqBonusA);
    })
    .slice(0, Math.max(1, Math.min(40, limit)));
}

export function buildSynthetic5hCandlesFromPair(pair: TokenPair, nowMs: number = Date.now()): Candle5m[] {
  const windowMinutes = Math.min(FIVE_HOUR_MINUTES, Math.max(15, pair.ageMinutes));
  const candleCount = Math.max(3, Math.min(60, Math.floor(windowMinutes / 5)));

  const currentPrice = pair.priceUsd;
  const h6Change = (pair.priceChange.h6 || 0) / 100;
  const h1Change = (pair.priceChange.h1 || 0) / 100;
  const m5Change = (pair.priceChange.m5 || 0) / 100;

  const startPrice = currentPrice / Math.max(0.2, 1 + h6Change * (windowMinutes / 360));
  const price1hAgo = currentPrice / Math.max(0.2, 1 + h1Change);
  const price5mAgo = currentPrice / Math.max(0.2, 1 + m5Change);

  const avgVolPerCandle = Math.max(100, (pair.volume.h6 || pair.volume.h1 || 5000) / Math.max(1, candleCount));
  const candles: Candle5m[] = [];

  let seed = 0;
  for (let i = 0; i < pair.pairAddress.length; i++) {
    seed = (seed * 31 + pair.pairAddress.charCodeAt(i)) % 100000;
  }

  let prevClose = startPrice;
  for (let i = 0; i < candleCount; i++) {
    const progress = (i + 1) / candleCount;
    const timestamp = nowMs - (candleCount - 1 - i) * FIVE_MINUTE_MS;
    const minutesAgo = (candleCount - 1 - i) * 5;

    let anchorTarget: number;
    if (minutesAgo <= 5) {
      anchorTarget = currentPrice;
    } else if (minutesAgo <= 60) {
      const localP = 1 - (minutesAgo - 5) / 55;
      anchorTarget = price1hAgo + (price5mAgo - price1hAgo) * localP;
    } else {
      const earlierSpan = Math.max(1, windowMinutes - 60);
      const localP = Math.min(1, Math.max(0, 1 - (minutesAgo - 60) / earlierSpan));
      anchorTarget = startPrice + (price1hAgo - startPrice) * localP;
    }

    const wave = Math.sin((i + 1) * 0.85 + seed * 0.01) * 0.025 + Math.cos((i + 2) * 0.43 + seed) * 0.015;
    const close = i === candleCount - 1 ? currentPrice : Math.max(1e-12, anchorTarget * (1 + wave));
    const open = i === 0 ? startPrice : prevClose;
    const bodyMax = Math.max(open, close);
    const bodyMin = Math.min(open, close);
    const wickScale = 0.012 + Math.abs(wave) * 0.6;
    const high = bodyMax * (1 + wickScale);
    const low = Math.max(1e-12, bodyMin * (1 - wickScale * 0.85));
    const volumeUsd = avgVolPerCandle * (0.65 + 0.7 * progress + Math.abs(Math.sin(i + seed)) * 0.4);

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volumeUsd,
    });
    prevClose = close;
  }

  return candles;
}

export function analyzeFiveHourMovements(
  pair: TokenPair,
  rawCandles: Candle5m[],
  settings: BotSettings,
  nowMs: number = Date.now(),
  learningProfile?: BotLearningProfile
): FiveHourAnalysis {
  const chartTimeframe: ChartTimeframe = settings.chartTimeframe || '5h';
  const chartWindowMinutes = getChartWindowMinutes(chartTimeframe);
  const analysisWindowMs = Math.max(FIVE_HOUR_MINUTES, chartWindowMinutes) * 60 * 1000;
  const windowAgo = nowMs - analysisWindowMs;

  const relevantCandles = rawCandles
    .filter((c) => c.timestamp >= windowAgo - FIVE_MINUTE_MS && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-96);

  const synthetic = buildSynthetic5hCandlesFromPair(pair, nowMs);
  const fullCandles = relevantCandles.length >= 3 ? relevantCandles : synthetic;

  // Filter visible chart candles cleanly to user's selected chartTimeframe
  const chartCutoff = nowMs - chartWindowMinutes * 60 * 1000 - FIVE_MINUTE_MS;
  const chartSliced = fullCandles.filter((c) => c.timestamp >= chartCutoff);
  const candles = chartSliced.length >= 3 ? chartSliced : fullCandles.slice(-Math.min(fullCandles.length, 15));

  const effectiveAgeMin = Math.min(FIVE_HOUR_MINUTES, Math.max(15, pair.ageMinutes));
  const expectedWindowCandles = Math.max(3, Math.floor(effectiveAgeMin / 5));
  const coveragePct = Math.min(100, Math.round((fullCandles.length / expectedWindowCandles) * 100));

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const volatility5hPct = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;

  const firstOpen = candles[0].open || candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  const momentum5hPct = firstOpen > 0 ? ((lastClose - firstOpen) / firstOpen) * 100 : 0;

  let bullishCount = 0;
  for (const c of candles) {
    if (c.close >= c.open) bullishCount++;
  }
  const bullishCandlesPct = (bullishCount / candles.length) * 100;

  const mid = Math.floor(candles.length / 2);
  const firstHalfMin = Math.min(...candles.slice(0, Math.max(1, mid)).map((c) => c.low));
  const secondHalfMin = Math.min(...candles.slice(mid).map((c) => c.low));
  const higherLowsHolding = secondHalfMin >= firstHalfMin * 0.94;

  const recentSlice = candles.slice(-Math.min(12, candles.length));
  const olderSlice = candles.slice(0, Math.max(1, candles.length - recentSlice.length));
  const recentAvgVol = recentSlice.reduce((s, c) => s + c.volumeUsd, 0) / recentSlice.length;
  const olderAvgVol = olderSlice.reduce((s, c) => s + c.volumeUsd, 0) / olderSlice.length;
  const volumeAcceleration = olderAvgVol > 0 ? recentAvgVol / olderAvgVol : 1;

  const h1Tx = pair.txns.h1;
  const h6Tx = pair.txns.h6;
  const m5Tx = pair.txns.m5;
  const totalTxns = h6Tx.buys + h6Tx.sells > 0 ? h6Tx.buys + h6Tx.sells : h1Tx.buys + h1Tx.sells;
  const activeBuys = h1Tx.buys + h1Tx.sells >= 15 ? h1Tx.buys : h6Tx.buys;
  const activeTotal = h1Tx.buys + h1Tx.sells >= 15 ? h1Tx.buys + h1Tx.sells : h6Tx.buys + h6Tx.sells;
  const buyPressurePct = activeTotal > 0 ? (activeBuys / activeTotal) * 100 : 50;

  const m5Total = m5Tx.buys + m5Tx.sells;
  const m5BuyPressurePct = m5Total > 0 ? (m5Tx.buys / m5Total) * 100 : buyPressurePct;

  const volume5hUsd = Math.max(
    pair.volume.h6 * 0.85,
    pair.volume.h1,
    candles.reduce((acc, c) => acc + c.volumeUsd, 0)
  );

  const refCap = pair.marketCap || pair.fdv || 0;
  const liquidityToFdvPct = refCap > 0 ? Number(((pair.liquidityUsd / refCap) * 100).toFixed(1)) : 0;

  const evalStake = Math.max(MIN_STAKE_USD, Math.min(MAX_STAKE_USD, settings.botMinStakeUsd || 20));
  const execEst = calculateExecutionEstimate(pair, evalStake, settings.feeProfile || 'medio');
  const estimatedFrictionPct = execEst.totalFrictionPct;

  const directionalFactor =
    momentum5hPct >= 0 && pair.priceChange.h1 >= -5
      ? 0.32
      : momentum5hPct >= -10
      ? 0.18
      : 0.08;
  const baseSwingCapture = Math.min(34, volatility5hPct * directionalFactor);
  const momentumAdj =
    momentum5hPct > 0
      ? Math.min(14, momentum5hPct * 0.18)
      : Math.max(-24, momentum5hPct * 0.35);
  const h1Adj = pair.priceChange.h1 < -10 ? Math.max(-15, pair.priceChange.h1 * 0.3) : 0;
  const pressureAdj = (buyPressurePct - 50) * 0.35;
  const expectedUpsidePct = Number(
    Math.max(0, baseSwingCapture + momentumAdj + h1Adj + pressureAdj).toFixed(2)
  );
  const netExpectedReturnPct = Number((expectedUpsidePct - estimatedFrictionPct).toFixed(2));

  const isAllWindows = settings.maxAgeHours <= 0;
  const maxAllowedAgeMin = isAllWindows
    ? Number.POSITIVE_INFINITY
    : Math.min(MAX_WINDOW_HOURS, Math.max(1 / 60, settings.maxAgeHours)) * 60;
  const isCrashFreefall = pair.priceChange.m5 < -18 || (pair.priceChange.h1 < -32 && pair.priceChange.m5 < -5);
  const isM5ExitDump = m5Total >= 8 && m5BuyPressurePct < 42 && pair.priceChange.m5 < -4;
  const isTooYoungFor5h = pair.ageMinutes < 15;
  const isThinPoolRatio = refCap > 0 && liquidityToFdvPct < 3.5 && pair.liquidityUsd < 100_000;

  const rugReasons: string[] = [];
  const aptitudeReasons: string[] = [];
  let rugPoints = 0;

  if (pair.liquidityUsd < 10_000) {
    rugPoints += 45;
    rugReasons.push(
      `Liquidez crítica ($${Math.round(pair.liquidityUsd).toLocaleString('en-US')}): riesgo extremo de drenaje de pool o slippage severo.`
    );
  } else if (pair.liquidityUsd < settings.minLiquidityUsd) {
    rugPoints += 25;
    rugReasons.push(
      `Liquidez insuficiente ($${Math.round(pair.liquidityUsd).toLocaleString('en-US')} < $${Math.round(settings.minLiquidityUsd).toLocaleString('en-US')}).`
    );
  } else {
    aptitudeReasons.push(
      `Pool con $${Math.round(pair.liquidityUsd).toLocaleString('en-US')} de liquidez (bajo slippage para órdenes de $20–$100).`
    );
  }

  if (isThinPoolRatio) {
    rugPoints += 30;
    rugReasons.push(
      `Ratio Liquidez/Market Cap muy bajo (${liquidityToFdvPct}%): típico de tokens inflados donde los creadores descargan sobre poca liquidez.`
    );
  } else if (refCap > 0) {
    aptitudeReasons.push(`Respaldo de pool saludable (${liquidityToFdvPct}% liquidez sobre FDV).`);
  }

  if (isTooYoungFor5h) {
    rugPoints += 30;
    rugReasons.push(
      `Token recién lanzado (${pair.ageMinutes} min): historial insuficiente para validar tendencia 5h y alto riesgo de sniping inicial.`
    );
  } else {
    aptitudeReasons.push(
      `Supervivencia inicial superada (${formatAgeShort(pair.ageMinutes)} activo) con ${candles.length} velas de 5m analizadas.`
    );
  }

  if (isCrashFreefall || isM5ExitDump) {
    rugPoints += 35;
    rugReasons.push(
      `Señal de descarga en curso: últimos 5 min con ${m5BuyPressurePct.toFixed(0)}% compras y variación ${pair.priceChange.m5.toFixed(1)}%.`
    );
  } else if (buyPressurePct / 100 >= settings.minBuyRatio) {
    aptitudeReasons.push(
      `Flujo comprador dominante (${buyPressurePct.toFixed(1)}% compras en 1h y ${m5BuyPressurePct.toFixed(0)}% en últimos 5m).`
    );
  } else {
    rugPoints += 15;
    rugReasons.push(
      `Presión vendedora elevada: solo ${buyPressurePct.toFixed(1)}% de las transacciones recientes son compras.`
    );
  }

  if (volume5hUsd < settings.minVolume5hUsd || totalTxns < settings.minTxnsCount) {
    rugPoints += 15;
    rugReasons.push(
      `Actividad baja ($${Math.round(volume5hUsd).toLocaleString('en-US')} vol, ${totalTxns} txns): riesgo de quedar atrapado sin compradores al vender.`
    );
  } else {
    aptitudeReasons.push(
      `Alta rotación ($${Math.round(volume5hUsd).toLocaleString('en-US')} en 5h y ${totalTxns} txns), facilitando entrada y salida rápida.`
    );
  }

  let rugRiskLevel: RugRiskLevel = 'BAJO';
  if (rugPoints >= 65) rugRiskLevel = 'CRITICO';
  else if (rugPoints >= 40) rugRiskLevel = 'ALTO';
  else if (rugPoints >= 20) rugRiskLevel = 'MEDIO';

  const windowLabel = isAllWindows
    ? 'Todos'
    : settings.maxAgeHours < 1
    ? `${Math.max(1, Math.round(settings.maxAgeHours * 60))}m`
    : settings.maxAgeHours >= 240
    ? '10d'
    : `${settings.maxAgeHours}h`;
  const checks: ThresholdCheck[] = [
    {
      key: 'age',
      label: isAllWindows ? 'Edad segura (≥15m)' : `Ventana (${windowLabel})`,
      passed:
        settings.maxAgeHours > 0 && settings.maxAgeHours < 1
          ? pair.ageMinutes <= maxAllowedAgeMin
          : pair.ageMinutes >= 15 && pair.ageMinutes <= maxAllowedAgeMin,
      actualFormatted: formatAgeShort(pair.ageMinutes),
      requiredFormatted: isAllWindows
        ? '≥ 15m (Todos)'
        : settings.maxAgeHours < 1
        ? `≤ ${windowLabel}`
        : `15m – ${windowLabel}`,
    },
    {
      key: 'coverage',
      label: 'Cobertura movimientos 5h',
      passed: coveragePct >= 60 && candles.length >= 3,
      actualFormatted: `${candles.length}/${expectedWindowCandles} (${coveragePct}%)`,
      requiredFormatted: '≥ 60% marco 5h',
    },
    {
      key: 'liquidity',
      label: 'Liquidez mínima (Anti-Rug)',
      passed: pair.liquidityUsd >= settings.minLiquidityUsd && !isThinPoolRatio,
      actualFormatted: `$${Math.round(pair.liquidityUsd).toLocaleString('en-US')} (${liquidityToFdvPct}% FDV)`,
      requiredFormatted: `≥ $${Math.round(settings.minLiquidityUsd).toLocaleString('en-US')}`,
    },
    {
      key: 'volume',
      label: 'Volumen activo (5h)',
      passed: volume5hUsd >= settings.minVolume5hUsd,
      actualFormatted: `$${Math.round(volume5hUsd).toLocaleString('en-US')}`,
      requiredFormatted: `≥ $${Math.round(settings.minVolume5hUsd).toLocaleString('en-US')}`,
    },
    {
      key: 'txns',
      label: 'Transacciones activas',
      passed: totalTxns >= settings.minTxnsCount,
      actualFormatted: `${totalTxns} txns`,
      requiredFormatted: `≥ ${settings.minTxnsCount} txns`,
    },
    {
      key: 'buyPressure',
      label: 'Flujo comprador (1h y 5m)',
      passed: buyPressurePct / 100 >= settings.minBuyRatio && !isM5ExitDump,
      actualFormatted: `${buyPressurePct.toFixed(1)}% (5m: ${m5BuyPressurePct.toFixed(0)}%)`,
      requiredFormatted: `≥ ${(settings.minBuyRatio * 100).toFixed(0)}% sin dump 5m`,
    },
    {
      key: 'volatility',
      label: 'Volatilidad 5h (sin colapso)',
      passed: volatility5hPct >= settings.minVolatilityPct && !isCrashFreefall,
      actualFormatted: `${volatility5hPct.toFixed(1)}% (5m ${pair.priceChange.m5 >= 0 ? '+' : ''}${pair.priceChange.m5.toFixed(1)}%)`,
      requiredFormatted: `≥ ${settings.minVolatilityPct}% y 5m > -18%`,
    },
    {
      key: 'profitability',
      label: 'Beneficio neto 5h vs costes',
      passed:
        netExpectedReturnPct >= settings.minExpectedProfitPct &&
        expectedUpsidePct >= estimatedFrictionPct * 3 &&
        momentum5hPct > -15 &&
        (bullishCandlesPct >= 45 || higherLowsHolding),
      actualFormatted: `${netExpectedReturnPct >= 0 ? '+' : ''}${netExpectedReturnPct.toFixed(1)}% neto (coste ${estimatedFrictionPct.toFixed(1)}%)`,
      requiredFormatted: `≥ +${settings.minExpectedProfitPct}% y 3x costes`,
    },
  ];

  const scannerMode: ScannerMode =
    settings.scannerMode === 'risky' || settings.scannerMode === 'crazy' ? settings.scannerMode : 'strict';
  const riskyThreshold = Math.max(40, Math.min(95, settings.riskyMinScorePct || 70));

  const minimumKeys = new Set(['age', 'coverage', 'liquidity', 'volume', 'txns', 'buyPressure', 'volatility']);
  const passesMinimums = checks.filter((c) => minimumKeys.has(c.key)).every((c) => c.passed);
  const profitCheck = checks.find((c) => c.key === 'profitability')!;

  if (!profitCheck.passed) {
    rugReasons.push(
      `No sale a cuenta tras costes: expectativa neta ${netExpectedReturnPct.toFixed(1)}% (coste estimado ${estimatedFrictionPct.toFixed(1)}%).`
    );
  } else {
    aptitudeReasons.push(
      `Sale a cuenta: retorno neto proyectado +${netExpectedReturnPct.toFixed(1)}% frente a ${estimatedFrictionPct.toFixed(1)}% de fricción.`
    );
  }

  let score = 0;
  if (pair.liquidityUsd >= settings.minLiquidityUsd) score += 16;
  else if (scannerMode === 'risky' && pair.liquidityUsd >= (settings.riskyMinLiquidityUsd ?? 8_000)) score += 10;
  if (volume5hUsd >= settings.minVolume5hUsd) score += 16;
  else if (scannerMode !== 'strict' && volume5hUsd >= settings.minVolume5hUsd * 0.4) score += 9;
  if (totalTxns >= settings.minTxnsCount) score += 12;
  else if (scannerMode !== 'strict' && totalTxns >= Math.max(12, settings.minTxnsCount * 0.4)) score += 7;
  score += Math.min(20, Math.max(0, (buyPressurePct - 42) * 0.9));
  score += Math.min(18, Math.max(0, netExpectedReturnPct * 0.9));
  if (higherLowsHolding) score += 9;
  if (volumeAcceleration >= 1.1) score += 9;

  // Anti-FOMO exhaustion guard & healthy pullback continuation bonus
  const isFomoOverextended = pair.priceChange.h1 > 110 && pair.priceChange.m5 <= 0;
  const isHealthyPullbackEntry =
    pair.priceChange.h1 >= 8 &&
    pair.priceChange.h1 <= 90 &&
    pair.priceChange.m5 >= -3 &&
    pair.priceChange.m5 <= 8 &&
    buyPressurePct >= 55;

  if (isFomoOverextended) {
    score -= 16;
    rugReasons.push(
      `Sobre-extensión Anti-FOMO: +${pair.priceChange.h1.toFixed(0)}% en 1h con 5m frenado (${pair.priceChange.m5.toFixed(1)}%), alto riesgo de comprar techo.`
    );
  } else if (isHealthyPullbackEntry) {
    score += 6;
    aptitudeReasons.push(
      `Entrada anti-FOMO en consolidación sana (1h +${pair.priceChange.h1.toFixed(0)}%, 5m ${pair.priceChange.m5 >= 0 ? '+' : ''}${pair.priceChange.m5.toFixed(1)}%).`
    );
  }

  // Apply adaptive learning bias from previous closed trades
  const learned = evaluateLearnedBonus({
    pair,
    buyPressurePct,
    volumeAcceleration,
    higherLowsHolding,
    scannerMode,
    profile: learningProfile,
    enabled: settings.adaptiveLearningEnabled !== false,
  });
  score += learned.bonusPts;
  for (const r of learned.learnedReasons) {
    if (learned.bonusPts >= 0) {
      aptitudeReasons.push(r);
    } else {
      rugReasons.push(r);
    }
  }

  // Only hard-cap ALTO risk to 48 in strict mode or when risky explicitly disallows ALTO risk.
  // Otherwise, let Risky threshold reflect real pool aptitude cleanly so Risky % slider/input always applies!
  if (isCrashFreefall || isM5ExitDump) score = Math.min(score, 22);
  if (rugRiskLevel === 'CRITICO') score = Math.min(score, 18);
  else if (rugRiskLevel === 'ALTO' && (scannerMode === 'strict' || settings.riskyAllowHighRugRisk === false)) {
    score = Math.min(score, 48);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const passedChecksCount = checks.filter((c) => c.passed).length;
  const checksPassPct = (passedChecksCount / checks.length) * 100;
  const aptitudePct = Math.max(
    0,
    Math.min(100, Math.round(checksPassPct * 0.6 + score * 0.4))
  );

  const strictPass =
    passesMinimums &&
    profitCheck.passed &&
    rugRiskLevel !== 'CRITICO' &&
    rugRiskLevel !== 'ALTO';

  const riskyMinLiq = Math.max(2_000, settings.riskyMinLiquidityUsd ?? 8_000);
  const riskyMinAge = Math.max(1, Math.min(60, settings.riskyMinAgeMinutes ?? 15));
  const riskyAllowHigh = settings.riskyAllowHighRugRisk !== false;

  const riskyPass =
    !isCrashFreefall &&
    pair.ageMinutes >= riskyMinAge &&
    rugRiskLevel !== 'CRITICO' &&
    (riskyAllowHigh || rugRiskLevel !== 'ALTO') &&
    pair.liquidityUsd >= riskyMinLiq &&
    aptitudePct >= riskyThreshold;

  // Crazy Mode (1-minute low-to-high trajectory scalping)
  const microSlice = candles.slice(-Math.min(12, candles.length));
  const microHigh = Math.max(...microSlice.map((c) => c.high), pair.priceUsd);
  const microLow = Math.min(...microSlice.map((c) => c.low), pair.priceUsd);
  const microSpan = microHigh - microLow;
  const rangePos = microSpan > 0 ? (pair.priceUsd - microLow) / microSpan : 0.5;
  const prevMicroClose = microSlice.length >= 2 ? microSlice[microSlice.length - 2].close : pair.priceUsd;
  const bouncingFromLow = pair.priceUsd >= prevMicroClose * 0.992 || pair.priceChange.m5 >= -2;
  const crazyMinLiq = Math.max(2_000, settings.crazyMinLiquidityUsd ?? 5_000);
  const crazyRangePct = microLow > 0 ? ((microHigh - microLow) / microLow) * 100 : Math.abs(pair.priceChange.m5);
  const isCrazyDipRebound =
    !isCrashFreefall &&
    rugRiskLevel !== 'CRITICO' &&
    pair.liquidityUsd >= crazyMinLiq &&
    (m5Total >= 6 || totalTxns >= 15) &&
    rangePos <= 0.68 &&
    bouncingFromLow &&
    crazyRangePct >= 3 &&
    m5BuyPressurePct >= 48;

  const crazySignalNote =
    scannerMode === 'crazy'
      ? isCrazyDipRebound
        ? `Crazy 1m: zona baja (${Math.round(rangePos * 100)}% del rango) · ${m5BuyPressurePct.toFixed(0)}% compras · salida máx ${settings.crazyMaxHoldSeconds || 60}s`
        : `Sin entrada Crazy 1m: precio en ${Math.round(rangePos * 100)}% del rango o flujo comprador débil (${m5BuyPressurePct.toFixed(0)}%)`
      : undefined;

  if (scannerMode === 'crazy' && isCrazyDipRebound) {
    aptitudeReasons.unshift(crazySignalNote!);
  }

  const saleACuenta =
    scannerMode === 'crazy'
      ? isCrazyDipRebound
      : scannerMode === 'risky'
      ? strictPass || riskyPass
      : strictPass;
  const verdict: 'COMPRAR' | 'DESCARTAR' = saleACuenta ? 'COMPRAR' : 'DESCARTAR';

  // Automatic bot stake strictly respects [botMinStakeUsd, botMaxStakeUsd] (default $20 fixed)
  const minStake = Math.max(MIN_STAKE_USD, Math.min(MAX_STAKE_USD, settings.botMinStakeUsd));
  const maxStake = Math.max(minStake, Math.min(MAX_STAKE_USD, settings.botMaxStakeUsd));
  const confidenceRatio = Math.max(0, Math.min(1, (score - 45) / 50));
  const rawStake = minStake + (maxStake - minStake) * confidenceRatio;
  const recommendedStakeUsd = Math.min(MAX_STAKE_USD, Math.max(MIN_STAKE_USD, Math.round(rawStake)));

  const suggestedTakeProfitPct =
    scannerMode === 'crazy'
      ? Math.round(Math.max(4, Math.min(50, settings.crazyTakeProfitPct || 10)))
      : Math.round(Math.max(10, settings.defaultTakeProfitPct));
  const suggestedStopLossPct =
    scannerMode === 'crazy'
      ? Math.round(Math.max(2, Math.min(20, settings.crazyStopLossPct || 5)))
      : Math.round(Math.min(20, Math.max(3, settings.defaultStopLossPct)));

  let summaryReason: string;
  if (verdict === 'COMPRAR') {
    if (scannerMode === 'crazy') {
      summaryReason = `Crazy 1m activo (${Math.round(rangePos * 100)}% rango · +${crazyRangePct.toFixed(1)}% oscilación): entrada en zona baja y salida rápida ≤${settings.crazyMaxHoldSeconds || 60}s.`;
    } else if (scannerMode === 'risky' && !strictPass) {
      summaryReason = `Apta en Modo Risky (${aptitudePct}% ≥ ${riskyThreshold}%): Riesgo Rug ${rugRiskLevel}, ${buyPressurePct.toFixed(0)}% compras y $${Math.round(pair.liquidityUsd).toLocaleString('en-US')} liquidez.`;
    } else {
      summaryReason = `Apta en Solana (Aptitud ${aptitudePct}%, Riesgo Rug: ${rugRiskLevel}): +${netExpectedReturnPct.toFixed(1)}% neto esperado, ${buyPressurePct.toFixed(0)}% compras y $${Math.round(pair.liquidityUsd).toLocaleString('en-US')} en pool.`;
    }
  } else {
    summaryReason =
      scannerMode === 'crazy'
        ? crazySignalNote || 'Sin patrón óptimo de rebote bajo-alto para scalp de 1 min.'
        : scannerMode === 'risky'
        ? `Descartado en Risky (${aptitudePct}% < ${riskyThreshold}% o filtro Risky: edad ${pair.ageMinutes}m/${riskyMinAge}m, liq $${Math.round(pair.liquidityUsd).toLocaleString('en-US')}/$${riskyMinLiq.toLocaleString('en-US')}, riesgo ${rugRiskLevel}).`
        : rugReasons[0] || 'Descartado por no superar el mínimo indispensable.';
  }

  return {
    tokenId: pair.id,
    candlesCount: candles.length,
    expectedWindowCandles,
    coveragePct,
    volatility5hPct: Number(volatility5hPct.toFixed(2)),
    momentum5hPct: Number(momentum5hPct.toFixed(2)),
    bullishCandlesPct: Number(bullishCandlesPct.toFixed(1)),
    buyPressurePct: Number(buyPressurePct.toFixed(1)),
    m5BuyPressurePct: Number(m5BuyPressurePct.toFixed(1)),
    volumeAcceleration: Number(volumeAcceleration.toFixed(2)),
    higherLowsHolding,
    liquidityToFdvPct,
    estimatedFrictionPct,
    expectedUpsidePct,
    netExpectedReturnPct,
    score,
    aptitudePct,
    learnedBonusPts: learned.bonusPts,
    matchedLearnedTraits: learned.matchedTraits,
    entryModeUsed: scannerMode,
    rugRiskLevel,
    rugReasons,
    aptitudeReasons,
    passesMinimums,
    saleACuenta,
    verdict,
    recommendedStakeUsd,
    suggestedTakeProfitPct,
    suggestedStopLossPct,
    checks,
    summaryReason,
    candles,
    chartTimeframe,
    crazySignalNote,
  };
}

/**
 * Evaluates a live price update against a position's tighter Stop Loss AND dynamic Trailing Take-Profit.
 * Lets optimal rallies run (+50%, +80%, +120%+) without capping at a fixed TP, selling only when price
 * pulls back `trailingCallbackPct` from the highest peak reached once `takeProfitPct` activation is passed.
 */
export function evaluateTrailingExit(
  pos: Position,
  nextPriceUsd: number,
  settings: BotSettings,
  nowMs: number = Date.now()
): {
  updatedPosition: Position;
  shouldSell: boolean;
  sellReason: string | null;
} {
  const effectivePrice = nextPriceUsd > 0 ? nextPriceUsd : pos.currentPriceUsd;
  const currentValueUsd = Number((pos.quantity * effectivePrice).toFixed(2));
  const pnlUsd = Number((currentValueUsd - pos.stakeUsd).toFixed(2));
  const pnlPct = pos.stakeUsd > 0 ? Number(((pnlUsd / pos.stakeUsd) * 100).toFixed(2)) : 0;

  const prevPeak = Number.isFinite(pos.peakPnlPct) ? pos.peakPnlPct : pnlPct;
  const peakPnlPct = Number(Math.max(prevPeak, pnlPct).toFixed(2));

  if (pos.scannerMode === 'crazy') {
    const crazyTp = Math.max(4, pos.takeProfitPct || settings.crazyTakeProfitPct || 10);
    const crazySl = Math.max(2, pos.stopLossPct || settings.crazyStopLossPct || 5);
    const maxHoldSec = Math.max(20, Math.min(300, settings.crazyMaxHoldSeconds || 60));
    const heldSec = Math.max(0, (nowMs - pos.openedAt) / 1000);
    const trailingActive = Boolean(pos.trailingActive) || peakPnlPct >= crazyTp;
    const trailingFloorPct = trailingActive
      ? Number(Math.max(2.5, peakPnlPct - 3).toFixed(2))
      : Number((-crazySl).toFixed(2));

    const updatedPosition: Position = {
      ...pos,
      currentPriceUsd: effectivePrice,
      currentValueUsd,
      pnlUsd,
      pnlPct,
      peakPnlPct,
      trailingActive,
      breakEvenActive: false,
      trailingFloorPct,
    };

    if (!settings.autoCloseTpSl) {
      return { updatedPosition, shouldSell: false, sellReason: null };
    }

    if (pnlPct >= crazyTp) {
      return {
        updatedPosition,
        shouldSell: true,
        sellReason: `Take-Profit rápido Crazy 1m (+${pnlPct.toFixed(1)}% ≥ +${crazyTp}%)`,
      };
    }

    if (trailingActive && pnlPct <= trailingFloorPct) {
      return {
        updatedPosition,
        shouldSell: true,
        sellReason: `Trailing rápido Crazy 1m tras pico +${peakPnlPct.toFixed(1)}% (venta +${pnlPct.toFixed(1)}%)`,
      };
    }

    if (pnlPct <= -crazySl) {
      return {
        updatedPosition,
        shouldSell: true,
        sellReason: `Stop Loss Crazy 1m (${pnlPct.toFixed(1)}% ≤ -${crazySl}%)`,
      };
    }

    if (heldSec >= maxHoldSec) {
      return {
        updatedPosition,
        shouldSell: true,
        sellReason: `Salida Crazy 1m por límite de tiempo (${Math.round(heldSec)}s ≥ ${maxHoldSec}s · ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`,
      };
    }

    return { updatedPosition, shouldSell: false, sellReason: null };
  }

  const activationPct = Math.max(5, pos.takeProfitPct || settings.defaultTakeProfitPct);
  const callbackPct = Math.max(3, Math.min(25, settings.trailingCallbackPct || 10));
  const stopLossPct = Math.max(3, Math.min(25, pos.stopLossPct || settings.defaultStopLossPct));

  const breakEvenTrigger = Math.max(5, Math.min(activationPct - 1, settings.breakEvenTriggerPct || 10));
  const breakEvenFloor = Math.max(0.5, Math.min(breakEvenTrigger - 1, settings.breakEvenFloorPct || 2.5));

  const trailingActive = Boolean(pos.trailingActive) || peakPnlPct >= activationPct;
  const breakEvenActive = !trailingActive && (Boolean(pos.breakEvenActive) || peakPnlPct >= breakEvenTrigger);

  // Progression: -8% SL -> +2.5% Break-Even (at +10% peak) -> Dynamic Trailing (at +18% peak)
  const trailingFloorPct = trailingActive
    ? Number(Math.max(4, peakPnlPct - callbackPct).toFixed(2))
    : breakEvenActive
    ? Number(breakEvenFloor.toFixed(2))
    : Number((-stopLossPct).toFixed(2));

  const updatedPosition: Position = {
    ...pos,
    currentPriceUsd: effectivePrice,
    currentValueUsd,
    pnlUsd,
    pnlPct,
    peakPnlPct,
    trailingActive,
    breakEvenActive,
    trailingFloorPct,
  };

  if (!settings.autoCloseTpSl) {
    return { updatedPosition, shouldSell: false, sellReason: null };
  }

  if (trailingActive && pnlPct <= trailingFloorPct) {
    return {
      updatedPosition,
      shouldSell: true,
      sellReason: `Trailing Take-Profit activado tras pico de +${peakPnlPct.toFixed(1)}% (venta en +${pnlPct.toFixed(1)}%, retroceso -${callbackPct}%)`,
    };
  }

  if (breakEvenActive && pnlPct <= breakEvenFloor) {
    return {
      updatedPosition,
      shouldSell: true,
      sellReason: `Protección Break-Even (+${breakEvenFloor.toFixed(1)}% tras pico +${peakPnlPct.toFixed(1)}%, cubre comisiones Solana)`,
    };
  }

  if (!trailingActive && !breakEvenActive && pnlPct <= -stopLossPct) {
    return {
      updatedPosition,
      shouldSell: true,
      sellReason: `Stop Loss reducido (${pnlPct.toFixed(1)}% ≤ -${stopLossPct}%)`,
    };
  }

  return { updatedPosition, shouldSell: false, sellReason: null };
}

export function formatAgeShort(ageMinutes: number): string {
  if (ageMinutes < 60) return `${Math.max(1, ageMinutes)}m`;
  if (ageMinutes < 24 * 60) {
    const hours = Math.floor(ageMinutes / 60);
    const mins = ageMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(ageMinutes / (24 * 60));
  const remHours = Math.floor((ageMinutes % (24 * 60)) / 60);
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function executeBuyOrder(
  portfolio: PortfolioState,
  token: TokenPair,
  stakeUsd: number,
  mode: 'manual' | 'auto',
  analysis: FiveHourAnalysis,
  nowMs: number = Date.now()
): { ok: true; state: PortfolioState; position: Position; trade: TradeRecord } | { ok: false; error: string } {
  const stakeCheck = validateStakeUsd(stakeUsd);
  if (!stakeCheck.valid) {
    return { ok: false, error: stakeCheck.error! };
  }
  const amount = stakeCheck.clamped;

  const feeProfile = portfolio.settings?.feeProfile || 'medio';
  const execEst = calculateExecutionEstimate(token, amount, feeProfile);
  const entrySlippageUsd = Number((amount * (execEst.slippagePct / 100)).toFixed(2));
  const totalEntryFeeUsd = Number((execEst.entryFeeUsd + entrySlippageUsd).toFixed(2));
  const totalDebitUsd = Number((amount + totalEntryFeeUsd).toFixed(2));

  if (portfolio.cashUsd < totalDebitUsd) {
    return { ok: false, error: 'Saldo virtual insuficiente para cubrir jugada y comisión Solana.' };
  }
  if (token.priceUsd <= 0) {
    return { ok: false, error: 'El precio del token no es válido.' };
  }

  const quantity = amount / token.priceUsd;
  const positionId = `pos_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
  const slPct = analysis.suggestedStopLossPct;

  const volume5hEst = Math.max(token.volume.h6 * 0.85, token.volume.h1);
  const entrySnapshot = buildEntryFeatureSnapshot({
    pair: token,
    volume5hUsd: volume5hEst,
    buyPressurePct: analysis.buyPressurePct,
    volumeAcceleration: analysis.volumeAcceleration,
    higherLowsHolding: analysis.higherLowsHolding,
    rugRiskLevel: analysis.rugRiskLevel,
    scannerMode: analysis.entryModeUsed,
    score: analysis.score,
    netExpectedReturnPct: analysis.netExpectedReturnPct,
  });

  const position: Position = {
    id: positionId,
    tokenId: token.id,
    symbol: token.baseToken.symbol,
    name: token.baseToken.name,
    chainId: token.chainId,
    pairAddress: token.pairAddress,
    entryPriceUsd: token.priceUsd,
    currentPriceUsd: token.priceUsd,
    quantity,
    stakeUsd: amount,
    currentValueUsd: amount,
    pnlUsd: 0,
    pnlPct: 0,
    peakPnlPct: 0,
    trailingActive: false,
    breakEvenActive: false,
    trailingFloorPct: -slPct,
    openedAt: nowMs,
    mode,
    scannerMode: analysis.entryModeUsed,
    takeProfitPct: analysis.suggestedTakeProfitPct,
    stopLossPct: slPct,
    analysisScore: analysis.score,
    url: token.url,
    entrySnapshot,
    entryFeeUsd: totalEntryFeeUsd,
    estimatedExitSeconds: execEst.estimatedExitSeconds,
  };

  const modeTag =
    analysis.entryModeUsed === 'crazy'
      ? 'Crazy 1m'
      : analysis.entryModeUsed === 'risky'
      ? `Risky ${portfolio.settings?.riskyMinScorePct || 70}%`
      : 'Estricto';
  const trade: TradeRecord = {
    id: `trd_${nowMs}_${Math.random().toString(36).slice(2, 7)}`,
    tokenId: token.id,
    symbol: token.baseToken.symbol,
    name: token.baseToken.name,
    chainId: token.chainId,
    side: 'BUY',
    mode,
    priceUsd: token.priceUsd,
    stakeUsd: amount,
    feeUsd: totalEntryFeeUsd,
    reason:
      mode === 'auto'
        ? `Compra auto $${amount} [${modeTag}] · tasa $${totalEntryFeeUsd.toFixed(2)} (${execEst.label}) · salida ~${execEst.estimatedExitSeconds}s`
        : `Compra manual ($${amount.toFixed(2)}) · tasa $${totalEntryFeeUsd.toFixed(2)} (${execEst.label})`,
    timestamp: nowMs,
  };

  const baseProfile = portfolio.learningProfile ?? createInitialLearningProfile();
  const nextLearningProfile = recordBuyStudy({
    profile: baseProfile,
    pair: token,
    snapshot: entrySnapshot,
    stakeUsd: amount,
    mode,
    matchedLearnedTraits: analysis.matchedLearnedTraits,
    nowMs,
  });

  const nextState: PortfolioState = {
    ...portfolio,
    cashUsd: Number((portfolio.cashUsd - totalDebitUsd).toFixed(2)),
    positions: [position, ...portfolio.positions],
    trades: [trade, ...portfolio.trades].slice(0, 1000),
    learningProfile: nextLearningProfile,
  };

  return { ok: true, state: nextState, position, trade };
}

export function executeSellOrder(
  portfolio: PortfolioState,
  positionId: string,
  exitPriceUsd: number,
  mode: 'manual' | 'auto',
  reason: string,
  nowMs: number = Date.now()
): { ok: true; state: PortfolioState; trade: TradeRecord } | { ok: false; error: string } {
  const pos = portfolio.positions.find((p) => p.id === positionId);
  if (!pos) {
    return { ok: false, error: 'Posición no encontrada.' };
  }

  const effectivePrice = exitPriceUsd > 0 ? exitPriceUsd : pos.currentPriceUsd;
  const feeProfile = portfolio.settings?.feeProfile || 'medio';
  const netEst = estimateOpenPositionNetPnl(pos, feeProfile, effectivePrice);
  const totalExitFeeUsd = netEst.estimatedExitFeeUsd;
  const netProceedsUsd = netEst.netProceedsUsd;
  const entryFeePaid = pos.entryFeeUsd ?? 0;
  const netPnlUsd = Number((netProceedsUsd - pos.stakeUsd - entryFeePaid).toFixed(2));
  const netPnlPct = pos.stakeUsd > 0 ? Number(((netPnlUsd / pos.stakeUsd) * 100).toFixed(2)) : 0;

  const trade: TradeRecord = {
    id: `trd_${nowMs}_${Math.random().toString(36).slice(2, 7)}`,
    tokenId: pos.tokenId,
    symbol: pos.symbol,
    name: pos.name,
    chainId: pos.chainId,
    side: 'SELL',
    mode,
    priceUsd: effectivePrice,
    stakeUsd: pos.stakeUsd,
    feeUsd: totalExitFeeUsd,
    proceedsUsd: netProceedsUsd,
    pnlUsd: netPnlUsd,
    pnlPct: netPnlPct,
    reason: `${reason} (tasa salida $${totalExitFeeUsd.toFixed(2)})`,
    timestamp: nowMs,
  };

  const baseProfile = portfolio.learningProfile ?? createInitialLearningProfile();
  const nextLearningProfile = recordSellStudy({
    profile: baseProfile,
    position: pos,
    pnlUsd: netPnlUsd,
    pnlPct: netPnlPct,
    sellReason: reason,
    mode,
    nowMs,
  });

  const nextState: PortfolioState = {
    ...portfolio,
    cashUsd: Number((portfolio.cashUsd + netProceedsUsd).toFixed(2)),
    positions: portfolio.positions.filter((p) => p.id !== positionId),
    trades: [trade, ...portfolio.trades].slice(0, 1000),
    learningProfile: nextLearningProfile,
  };

  return { ok: true, state: nextState, trade };
}

export function checkBotEntryGuards(
  portfolio: PortfolioState,
  tokenId: string,
  nowMs: number = Date.now()
): { allowed: boolean; reason?: string } {
  const maxOpen = Math.max(1, Math.min(30, portfolio.settings?.maxOpenPositions ?? 10));
  if (portfolio.positions.length >= maxOpen) {
    return {
      allowed: false,
      reason: `Límite de seguridad alcanzado (${portfolio.positions.length}/${maxOpen} posiciones abiertas).`,
    };
  }

  const cooldownMin = Math.max(0, Math.min(240, portfolio.settings?.reentryCooldownMinutes ?? 20));
  if (cooldownMin > 0) {
    const lastSell = portfolio.trades.find((t) => t.side === 'SELL' && t.tokenId === tokenId);
    if (lastSell && nowMs - lastSell.timestamp < cooldownMin * 60_000) {
      const waitMin = Math.ceil((cooldownMin * 60_000 - (nowMs - lastSell.timestamp)) / 60_000);
      return {
        allowed: false,
        reason: `Cooldown anti-recompra activo tras venta reciente (faltan ~${waitMin} min).`,
      };
    }
  }

  const dailyLimit = Math.max(0, portfolio.settings?.dailyMaxLossUsd ?? 0);
  if (dailyLimit > 0) {
    const dayStart = new Date(nowMs);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const todayNetPnl = portfolio.trades
      .filter((t) => t.side === 'SELL' && t.timestamp >= dayStartMs)
      .reduce((acc, t) => acc + (t.pnlUsd ?? 0), 0);
    if (todayNetPnl <= -dailyLimit) {
      return {
        allowed: false,
        reason: `Stop diario activado (pérdida hoy $${Math.abs(todayNetPnl).toFixed(2)} ≥ límite $${dailyLimit.toFixed(0)}).`,
      };
    }
  }

  return { allowed: true };
}

export function rechargePortfolio(
  portfolio: PortfolioState,
  action: { type: 'reset' } | { type: 'add'; amountUsd: number } | { type: 'set'; amountUsd: number }
): PortfolioState {
  const baseBalance = portfolio.settings?.customInitialBalanceUsd || INITIAL_VIRTUAL_BALANCE_USD;
  if (action.type === 'reset') {
    const added = Math.max(0, baseBalance - portfolio.cashUsd);
    return {
      ...portfolio,
      cashUsd: baseBalance,
      totalRechargedUsd: Number((portfolio.totalRechargedUsd + added).toFixed(2)),
    };
  }
  if (action.type === 'set') {
    const target = Number(Math.max(20, Math.min(10_000_000, action.amountUsd)).toFixed(2));
    return {
      ...portfolio,
      cashUsd: target,
      settings: {
        ...portfolio.settings,
        customInitialBalanceUsd: target,
      },
    };
  }
  const addAmount = Math.max(0, Math.min(10_000_000, action.amountUsd));
  return {
    ...portfolio,
    cashUsd: Number((portfolio.cashUsd + addAmount).toFixed(2)),
    totalRechargedUsd: Number((portfolio.totalRechargedUsd + addAmount).toFixed(2)),
  };
}

export function resetPortfolioHistory(
  portfolio: PortfolioState,
  options?: { keepSettings?: boolean; initialCashUsd?: number }
): PortfolioState {
  const keepSettings = options?.keepSettings !== false;
  const fallbackCash = keepSettings
    ? portfolio.settings?.customInitialBalanceUsd ?? INITIAL_VIRTUAL_BALANCE_USD
    : INITIAL_VIRTUAL_BALANCE_USD;
  const targetCash = Number(
    Math.max(20, Math.min(10_000_000, options?.initialCashUsd ?? fallbackCash)).toFixed(2)
  );
  const nextSettings: BotSettings = keepSettings
    ? { ...portfolio.settings, customInitialBalanceUsd: targetCash }
    : { ...DEFAULT_BOT_SETTINGS, customInitialBalanceUsd: targetCash };

  const now = Date.now();
  return {
    cashUsd: targetCash,
    totalRechargedUsd: 0,
    positions: [],
    trades: [],
    scanLogs: [],
    settings: nextSettings,
    learningProfile: createInitialLearningProfile(),
    lastScanAt: null,
    nextScanAt: nextSettings.autoScanEnabled
      ? now + Math.max(1, nextSettings.scanIntervalMinutes) * 60 * 1000
      : null,
  };
}
