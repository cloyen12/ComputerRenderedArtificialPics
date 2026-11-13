import fs from 'node:fs';
import path from 'node:path';
import {
  checkBotEntryGuards,
  createInitialPortfolioState,
  DEFAULT_BOT_SETTINGS,
  evaluateTrailingExit,
  executeBuyOrder,
  executeSellOrder,
  MAX_STAKE_USD,
  MAX_WINDOW_HOURS,
  MIN_STAKE_USD,
  rechargePortfolio,
  resetPortfolioHistory,
  resolveTimeframeToHours,
} from '../shared/analyzer.ts';
import { createInitialLearningProfile } from '../shared/learning.ts';
import type {
  BotSettings,
  ChartTimeframe,
  MarketSnapshotResponse,
  PortfolioState,
  ScanLogEntry,
  ScannerTimeframeId,
  ScanTokenDecision,
} from '../shared/types.ts';
import {
  fetchLivePricesForPairs,
  fetchTop10VolatileSnapshot,
  getCachedTokenById,
  invalidateMarketCache,
} from './marketService.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'portfolio.json');

let state: PortfolioState = loadStateFromDisk();
let scanInProgress = false;
let scannerTimer: NodeJS.Timeout | null = null;

function loadStateFromDisk(): PortfolioState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PortfolioState;
      if (parsed && typeof parsed.cashUsd === 'number' && parsed.settings) {
        return {
          ...createInitialPortfolioState(),
          ...parsed,
          settings: { ...DEFAULT_BOT_SETTINGS, ...parsed.settings, onlySolana: true },
          learningProfile: parsed.learningProfile ?? createInitialLearningProfile(),
        };
      }
    }
  } catch {
    // Ignore corrupt file and reinitialize cleanly
  }
  return createInitialPortfolioState();
}

function saveStateToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal in read-only environments
  }
}

export function getPortfolioState(): PortfolioState {
  return state;
}

export async function refreshOpenPositionsPrices(snapshot?: MarketSnapshotResponse): Promise<void> {
  if (state.positions.length === 0) return;

  const snapshotPriceMap = new Map<string, number>();
  if (snapshot) {
    for (const item of snapshot.tokens) {
      snapshotPriceMap.set(item.token.id, item.token.priceUsd);
    }
  }

  const missingPairs = state.positions
    .filter((p) => !snapshotPriceMap.has(p.tokenId))
    .map((p) => ({ chainId: p.chainId, pairAddress: p.pairAddress }));

  const fetchedPrices = await fetchLivePricesForPairs(missingPairs);
  const nowMs = Date.now();
  const autoSellQueue: Array<{ id: string; price: number; reason: string }> = [];

  state.positions = state.positions.map((pos) => {
    const nextPrice = snapshotPriceMap.get(pos.tokenId) ?? fetchedPrices.get(pos.tokenId) ?? pos.currentPriceUsd;
    const evaluation = evaluateTrailingExit(pos, nextPrice, state.settings, nowMs);

    if (evaluation.shouldSell && evaluation.sellReason) {
      autoSellQueue.push({
        id: pos.id,
        price: nextPrice,
        reason: evaluation.sellReason,
      });
    }

    return evaluation.updatedPosition;
  });

  for (const item of autoSellQueue) {
    const res = executeSellOrder(state, item.id, item.price, 'auto', item.reason, nowMs);
    if (res.ok) {
      state = res.state;
    }
  }

  saveStateToDisk();
}

export async function runMarketScanAndAutoTrade(
  trigger: 'auto-5m' | 'manual',
  executeAutoBuys = true
): Promise<{ market: MarketSnapshotResponse; scanLog: ScanLogEntry }> {
  if (scanInProgress) {
    const market = await fetchTop10VolatileSnapshot(state.settings, false, state.learningProfile);
    const fallbackLog: ScanLogEntry = state.scanLogs[0] || {
      id: `scan_${Date.now()}`,
      timestamp: Date.now(),
      trigger,
      scannerMode: state.settings.scannerMode,
      tokensEvaluated: market.tokens.length,
      tokensBought: 0,
      totalSpentUsd: 0,
      dataSourceLabel: market.sourceMessage,
      decisions: [],
    };
    return { market, scanLog: fallbackLog };
  }

  scanInProgress = true;
  try {
    const nowMs = Date.now();
    const market = await fetchTop10VolatileSnapshot(state.settings, true, state.learningProfile);
    await refreshOpenPositionsPrices(market);

    // Order candidates so tokens matching learned winning patterns and higher aptitude are prioritized
    const prioritized = [...market.tokens].sort((a, b) => {
      const scoreA = a.analysis.score + a.analysis.learnedBonusPts;
      const scoreB = b.analysis.score + b.analysis.learnedBonusPts;
      return scoreB - scoreA;
    });

    const decisions: ScanTokenDecision[] = [];
    let tokensBought = 0;
    let totalSpentUsd = 0;

    for (const item of prioritized) {
      const { token, analysis } = item;
      const alreadyHeld = state.positions.some((p) => p.tokenId === token.id);

      if (analysis.verdict === 'COMPRAR' && executeAutoBuys) {
        if (alreadyHeld) {
          decisions.push({
            tokenId: token.id,
            symbol: token.baseToken.symbol,
            chainId: token.chainId,
            ageMinutes: token.ageMinutes,
            priceUsd: token.priceUsd,
            score: analysis.score,
            aptitudePct: analysis.aptitudePct,
            rugRiskLevel: analysis.rugRiskLevel,
            verdict: analysis.verdict,
            actionTaken: 'YA_EN_CARTERA',
            reason: 'Token ya presente en posiciones abiertas.',
          });
          continue;
        }

        const guard = checkBotEntryGuards(state, token.id, nowMs);
        if (!guard.allowed) {
          decisions.push({
            tokenId: token.id,
            symbol: token.baseToken.symbol,
            chainId: token.chainId,
            ageMinutes: token.ageMinutes,
            priceUsd: token.priceUsd,
            score: analysis.score,
            aptitudePct: analysis.aptitudePct,
            rugRiskLevel: analysis.rugRiskLevel,
            verdict: analysis.verdict,
            actionTaken: 'DESCARTADO',
            reason: guard.reason || 'Bloqueado por regla de protección de riesgo.',
          });
          continue;
        }

        const stake = analysis.recommendedStakeUsd;
        if (state.cashUsd < stake) {
          decisions.push({
            tokenId: token.id,
            symbol: token.baseToken.symbol,
            chainId: token.chainId,
            ageMinutes: token.ageMinutes,
            priceUsd: token.priceUsd,
            score: analysis.score,
            aptitudePct: analysis.aptitudePct,
            rugRiskLevel: analysis.rugRiskLevel,
            verdict: analysis.verdict,
            actionTaken: 'SALDO_INSUFICIENTE',
            reason: 'Saldo virtual insuficiente para ejecutar jugada.',
          });
          continue;
        }

        const buyRes = executeBuyOrder(state, token, stake, 'auto', analysis, nowMs);
        if (buyRes.ok) {
          state = buyRes.state;
          tokensBought++;
          totalSpentUsd = Number((totalSpentUsd + stake).toFixed(2));
          decisions.push({
            tokenId: token.id,
            symbol: token.baseToken.symbol,
            chainId: token.chainId,
            ageMinutes: token.ageMinutes,
            priceUsd: token.priceUsd,
            score: analysis.score,
            aptitudePct: analysis.aptitudePct,
            rugRiskLevel: analysis.rugRiskLevel,
            verdict: analysis.verdict,
            actionTaken: 'COMPRADO',
            stakeUsd: stake,
            reason: analysis.summaryReason,
          });
        }
      } else {
        decisions.push({
          tokenId: token.id,
          symbol: token.baseToken.symbol,
          chainId: token.chainId,
          ageMinutes: token.ageMinutes,
          priceUsd: token.priceUsd,
          score: analysis.score,
          aptitudePct: analysis.aptitudePct,
          rugRiskLevel: analysis.rugRiskLevel,
          verdict: analysis.verdict,
          actionTaken: 'DESCARTADO',
          reason: analysis.summaryReason,
        });
      }
    }

    const scanLog: ScanLogEntry = {
      id: `scan_${nowMs}`,
      timestamp: nowMs,
      trigger,
      scannerMode: state.settings.scannerMode,
      tokensEvaluated: market.tokens.length,
      tokensBought,
      totalSpentUsd,
      dataSourceLabel: market.sourceMessage,
      decisions,
    };

    state = {
      ...state,
      scanLogs: [scanLog, ...state.scanLogs].slice(0, 100),
      lastScanAt: nowMs,
      nextScanAt: state.settings.autoScanEnabled
        ? nowMs + Math.max(1, state.settings.scanIntervalMinutes) * 60 * 1000
        : null,
    };

    saveStateToDisk();
    return { market, scanLog };
  } finally {
    scanInProgress = false;
  }
}

export async function manualBuyToken(
  tokenId: string,
  stakeUsd: number
): Promise<{ ok: true; state: PortfolioState } | { ok: false; error: string }> {
  let found = getCachedTokenById(tokenId);
  if (!found) {
    const market = await fetchTop10VolatileSnapshot(state.settings, false, state.learningProfile);
    found = market.tokens.find((t) => t.token.id === tokenId);
  }
  if (!found) {
    return { ok: false, error: 'El token seleccionado ya no está disponible en caché. Búscalo o refresca.' };
  }

  const res = executeBuyOrder(state, found.token, stakeUsd, 'manual', found.analysis, Date.now());
  if (!res.ok) return res;

  state = res.state;
  saveStateToDisk();
  return { ok: true, state };
}

export async function manualClosePosition(
  positionId: string
): Promise<{ ok: true; state: PortfolioState } | { ok: false; error: string }> {
  const market = await fetchTop10VolatileSnapshot(state.settings, false, state.learningProfile);
  await refreshOpenPositionsPrices(market);

  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) {
    return { ok: false, error: 'Posición no encontrada o ya cerrada.' };
  }

  const res = executeSellOrder(
    state,
    positionId,
    pos.currentPriceUsd,
    'manual',
    'Venta manual desde cartera virtual',
    Date.now()
  );
  if (!res.ok) return res;

  state = res.state;
  saveStateToDisk();
  return { ok: true, state };
}

export function applyRecharge(
  action: { type: 'reset' } | { type: 'add'; amountUsd: number } | { type: 'set'; amountUsd: number }
): PortfolioState {
  state = rechargePortfolio(state, action);
  saveStateToDisk();
  return state;
}

export function resetAllPortfolioHistory(options?: {
  keepSettings?: boolean;
  initialCashUsd?: number;
}): PortfolioState {
  state = resetPortfolioHistory(state, options);
  saveStateToDisk();
  return state;
}

export function restorePortfolioStateFromBackup(backup: PortfolioState): PortfolioState {
  if (
    state.trades.length === 0 &&
    state.positions.length === 0 &&
    state.scanLogs.length === 0 &&
    backup &&
    typeof backup.cashUsd === 'number' &&
    backup.settings
  ) {
    state = {
      ...createInitialPortfolioState(),
      ...backup,
      settings: { ...DEFAULT_BOT_SETTINGS, ...backup.settings, onlySolana: true },
      learningProfile: backup.learningProfile ?? createInitialLearningProfile(),
    };
    saveStateToDisk();
  }
  return state;
}

const VALID_SCANNER_TIMEFRAMES = new Set<ScannerTimeframeId>([
  'all',
  'new',
  '1m',
  '5m',
  '10m',
  '15m',
  '1h',
  '5h',
  '10h',
  '24h',
  '1d',
  '10d',
]);

const VALID_CHART_TIMEFRAMES = new Set<ChartTimeframe>(['15m', '1h', '5h', '10h', '24h']);

export function updateBotSettings(partial: Partial<BotSettings>): PortfolioState {
  const scannerMode =
    partial.scannerMode === 'risky' || partial.scannerMode === 'strict' || partial.scannerMode === 'crazy'
      ? partial.scannerMode
      : state.settings.scannerMode;

  const scannerSortBy =
    partial.scannerSortBy === 'volume' ||
    partial.scannerSortBy === 'liquidity' ||
    partial.scannerSortBy === 'momentum1h' ||
    partial.scannerSortBy === 'newest' ||
    partial.scannerSortBy === 'score'
      ? partial.scannerSortBy
      : state.settings.scannerSortBy || 'score';

  const feeProfile =
    partial.feeProfile === 'economico' ||
    partial.feeProfile === 'medio' ||
    partial.feeProfile === 'rapido'
      ? partial.feeProfile
      : state.settings.feeProfile || 'medio';

  const nextScanIntervalMinutes = Math.min(
    60,
    Math.max(1, Math.round(Number(partial.scanIntervalMinutes ?? state.settings.scanIntervalMinutes ?? 5)))
  );

  const nextScannerTimeframe: ScannerTimeframeId =
    partial.scannerTimeframe && VALID_SCANNER_TIMEFRAMES.has(partial.scannerTimeframe)
      ? partial.scannerTimeframe
      : state.settings.scannerTimeframe || '24h';

  const nextMaxAgeHours = (() => {
    if (partial.scannerTimeframe && VALID_SCANNER_TIMEFRAMES.has(partial.scannerTimeframe)) {
      return resolveTimeframeToHours(partial.scannerTimeframe);
    }
    const raw =
      partial.maxAgeHours !== undefined ? Number(partial.maxAgeHours) : state.settings.maxAgeHours;
    return Number.isFinite(raw) && raw <= 0
      ? 0
      : Math.min(MAX_WINDOW_HOURS, Math.max(1 / 60, Number.isFinite(raw) ? raw : 24));
  })();

  const nextChartTimeframe: ChartTimeframe =
    partial.chartTimeframe && VALID_CHART_TIMEFRAMES.has(partial.chartTimeframe)
      ? partial.chartTimeframe
      : state.settings.chartTimeframe || '5h';

  const oldBase = state.settings.customInitialBalanceUsd ?? 1_000_000;
  const newBase = Math.min(
    10_000_000,
    Math.max(20, Number(partial.customInitialBalanceUsd ?? oldBase))
  );

  const merged: BotSettings = {
    ...state.settings,
    ...partial,
    onlySolana: true,
    customInitialBalanceUsd: newBase,
    scannerMode,
    scannerTimeframe: nextScannerTimeframe,
    chartTimeframe: nextChartTimeframe,
    scannerSortBy,
    riskyMinScorePct: Math.min(
      95,
      Math.max(40, Number(partial.riskyMinScorePct ?? state.settings.riskyMinScorePct ?? 70))
    ),
    riskyMinLiquidityUsd: Math.min(
      250_000,
      Math.max(2_000, Number(partial.riskyMinLiquidityUsd ?? state.settings.riskyMinLiquidityUsd ?? 8_000))
    ),
    riskyMinAgeMinutes: Math.min(
      60,
      Math.max(1, Math.round(Number(partial.riskyMinAgeMinutes ?? state.settings.riskyMinAgeMinutes ?? 15)))
    ),
    riskyAllowHighRugRisk:
      typeof partial.riskyAllowHighRugRisk === 'boolean'
        ? partial.riskyAllowHighRugRisk
        : state.settings.riskyAllowHighRugRisk ?? true,
    crazyTakeProfitPct: Math.min(
      50,
      Math.max(4, Number(partial.crazyTakeProfitPct ?? state.settings.crazyTakeProfitPct ?? 10))
    ),
    crazyStopLossPct: Math.min(
      20,
      Math.max(2, Number(partial.crazyStopLossPct ?? state.settings.crazyStopLossPct ?? 5))
    ),
    crazyMaxHoldSeconds: Math.min(
      300,
      Math.max(20, Math.round(Number(partial.crazyMaxHoldSeconds ?? state.settings.crazyMaxHoldSeconds ?? 60)))
    ),
    crazyMinLiquidityUsd: Math.min(
      100_000,
      Math.max(2_000, Number(partial.crazyMinLiquidityUsd ?? state.settings.crazyMinLiquidityUsd ?? 5_000))
    ),
    adaptiveLearningEnabled:
      typeof partial.adaptiveLearningEnabled === 'boolean'
        ? partial.adaptiveLearningEnabled
        : state.settings.adaptiveLearningEnabled ?? true,
    feeProfile,
    simulateExecutionDelay:
      typeof partial.simulateExecutionDelay === 'boolean'
        ? partial.simulateExecutionDelay
        : state.settings.simulateExecutionDelay ?? true,
    breakEvenTriggerPct: Math.min(
      25,
      Math.max(5, Number(partial.breakEvenTriggerPct ?? state.settings.breakEvenTriggerPct ?? 10))
    ),
    breakEvenFloorPct: Math.min(
      12,
      Math.max(0.5, Number(partial.breakEvenFloorPct ?? state.settings.breakEvenFloorPct ?? 2.5))
    ),
    maxOpenPositions: Math.min(
      30,
      Math.max(1, Math.round(Number(partial.maxOpenPositions ?? state.settings.maxOpenPositions ?? 10)))
    ),
    reentryCooldownMinutes: Math.min(
      240,
      Math.max(0, Math.round(Number(partial.reentryCooldownMinutes ?? state.settings.reentryCooldownMinutes ?? 20)))
    ),
    dailyMaxLossUsd: Math.min(
      100_000,
      Math.max(0, Number(partial.dailyMaxLossUsd ?? state.settings.dailyMaxLossUsd ?? 0))
    ),
    scanIntervalMinutes: nextScanIntervalMinutes,
    maxAgeHours: nextMaxAgeHours,
    displayLimit: Math.min(40, Math.max(10, Number(partial.displayLimit ?? state.settings.displayLimit))),
    botMinStakeUsd: Math.max(
      MIN_STAKE_USD,
      Math.min(MAX_STAKE_USD, Number(partial.botMinStakeUsd ?? state.settings.botMinStakeUsd))
    ),
    botMaxStakeUsd: Math.max(
      MIN_STAKE_USD,
      Math.min(MAX_STAKE_USD, Number(partial.botMaxStakeUsd ?? state.settings.botMaxStakeUsd))
    ),
  };

  if (merged.botMinStakeUsd > merged.botMaxStakeUsd) {
    merged.botMaxStakeUsd = merged.botMinStakeUsd;
  }

  // Synchronize customInitialBalanceUsd <-> cashUsd cleanly without breaking active stakes
  let nextCashUsd = state.cashUsd;
  if (partial.customInitialBalanceUsd !== undefined && Math.abs(newBase - oldBase) >= 0.01) {
    if (state.positions.length === 0 && state.trades.length === 0) {
      nextCashUsd = newBase;
    } else {
      nextCashUsd = Number(Math.max(0, state.cashUsd + (newBase - oldBase)).toFixed(2));
    }
  }

  const nowMs = Date.now();
  const intervalChanged = nextScanIntervalMinutes !== state.settings.scanIntervalMinutes;
  state = {
    ...state,
    cashUsd: nextCashUsd,
    settings: merged,
    nextScanAt: merged.autoScanEnabled
      ? !intervalChanged && state.nextScanAt && state.nextScanAt > nowMs
        ? state.nextScanAt
        : nowMs + nextScanIntervalMinutes * 60 * 1000
      : null,
  };
  invalidateMarketCache();
  saveStateToDisk();
  return state;
}

let crazyMonitorBusy = false;

export function startAutoScannerLoop(): void {
  if (scannerTimer) return;
  scannerTimer = setInterval(async () => {
    const nowMs = Date.now();

    // Fast 5s price & time-stop check for Crazy 1-minute open positions
    if (!crazyMonitorBusy && !scanInProgress && state.positions.some((p) => p.scannerMode === 'crazy')) {
      crazyMonitorBusy = true;
      try {
        await refreshOpenPositionsPrices();
      } catch {
        // Ignore transient price fetch error
      } finally {
        crazyMonitorBusy = false;
      }
    }

    if (!state.settings.autoScanEnabled) return;
    if (!state.nextScanAt || nowMs >= state.nextScanAt) {
      try {
        await runMarketScanAndAutoTrade('auto-5m');
      } catch {
        // Keep interval alive on transient upstream errors
      }
    }
  }, 5_000);
}
