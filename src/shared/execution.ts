import type { ExecutionEstimate, FeeProfile, Position, TokenPair } from './types.ts';

export interface FeeProfileMeta {
  id: FeeProfile;
  label: string;
  shortLabel: string;
  priorityPerSideUsd: number;
  ammFeePctPerSide: number;
  baseEntrySec: number;
  baseExitSec: number;
}

export const FEE_PROFILE_CONFIGS: Record<FeeProfile, FeeProfileMeta> = {
  economico: {
    id: 'economico',
    label: 'Económico (~$0.05 gas + AMM · salida lenta)',
    shortLabel: 'Económico',
    priorityPerSideUsd: 0.05,
    ammFeePctPerSide: 0.25,
    baseEntrySec: 6.5,
    baseExitSec: 11.5,
  },
  medio: {
    id: 'medio',
    label: 'Punto medio (~$0.17 gas + AMM · óptimo $20)',
    shortLabel: 'Punto medio',
    priorityPerSideUsd: 0.17,
    ammFeePctPerSide: 0.25,
    baseEntrySec: 2.8,
    baseExitSec: 4.8,
  },
  rapido: {
    id: 'rapido',
    label: 'Turbo Jito ($1.00 entrada + $1.00 salida · 1–2s)',
    shortLabel: 'Turbo ($1+$1)',
    priorityPerSideUsd: 0.95,
    ammFeePctPerSide: 0.25,
    baseEntrySec: 1.2,
    baseExitSec: 1.6,
  },
};

/**
 * Estimates real Solana execution fees, slippage, and entry/exit settlement latency
 * based on the chosen fee tier ("Punto medio" by default for $20 plays), pool liquidity, and 5m congestion.
 */
export function calculateExecutionEstimate(
  pairOrParams:
    | TokenPair
    | { liquidityUsd: number; txns5mCount: number; priceChange5mPct: number },
  stakeUsd: number,
  feeProfile: FeeProfile = 'medio'
): ExecutionEstimate {
  const cfg = FEE_PROFILE_CONFIGS[feeProfile] ?? FEE_PROFILE_CONFIGS.medio;
  const effectiveStake = Math.max(20, Math.min(100, Number.isFinite(stakeUsd) ? stakeUsd : 20));

  const liquidityUsd =
    'liquidityUsd' in pairOrParams ? pairOrParams.liquidityUsd : 25_000;
  const txns5mCount =
    'txns' in pairOrParams
      ? pairOrParams.txns.m5.buys + pairOrParams.txns.m5.sells
      : pairOrParams.txns5mCount;
  const absM5Move =
    'priceChange' in pairOrParams
      ? Math.abs(pairOrParams.priceChange.m5 || 0)
      : Math.abs(pairOrParams.priceChange5mPct || 0);

  const ammFeePerSide = effectiveStake * (cfg.ammFeePctPerSide / 100);
  const entryFeeUsd = Number((cfg.priorityPerSideUsd + ammFeePerSide).toFixed(2));
  // Exit often needs slightly higher compute units / route retries under volatility
  const exitPriorityBoost = feeProfile === 'medio' ? 0.03 : feeProfile === 'economico' ? 0.02 : 0.05;
  const exitFeeUsd = Number((cfg.priorityPerSideUsd + exitPriorityBoost + ammFeePerSide).toFixed(2));
  const roundTripFeeUsd = Number((entryFeeUsd + exitFeeUsd).toFixed(2));
  const roundTripFeePct = Number(((roundTripFeeUsd / effectiveStake) * 100).toFixed(2));

  // Pool depth + volatility slippage impact per side
  const depthImpact = liquidityUsd > 0 ? (effectiveStake / liquidityUsd) * 180 : 6;
  const volImpact = Math.min(2.2, absM5Move * 0.04);
  const slippagePct = Number(Math.max(0.15, Math.min(8, depthImpact + volImpact)).toFixed(2));

  const totalFrictionPct = Number((roundTripFeePct + slippagePct * 2).toFixed(2));

  // Congestion & liquidity penalty on confirmation seconds
  const congestionLevel: ExecutionEstimate['congestionLevel'] =
    txns5mCount >= 90 || absM5Move >= 15
      ? 'Alta'
      : txns5mCount >= 35 || absM5Move >= 6
      ? 'Media'
      : 'Baja';

  const congestionDelay =
    congestionLevel === 'Alta'
      ? feeProfile === 'rapido'
        ? 0.5
        : feeProfile === 'medio'
        ? 2.2
        : 5.5
      : congestionLevel === 'Media'
      ? feeProfile === 'rapido'
        ? 0.2
        : feeProfile === 'medio'
        ? 1.0
        : 2.5
      : 0;

  const thinPoolRetryDelay =
    liquidityUsd < 15_000
      ? feeProfile === 'rapido'
        ? 0.4
        : feeProfile === 'medio'
        ? 1.5
        : 3.5
      : liquidityUsd < 30_000 && feeProfile !== 'rapido'
      ? 0.6
      : 0;

  const estimatedEntrySeconds = Number((cfg.baseEntrySec + congestionDelay * 0.6).toFixed(1));
  const estimatedExitSeconds = Number(
    (cfg.baseExitSec + congestionDelay + thinPoolRetryDelay).toFixed(1)
  );

  return {
    feeProfile,
    label: cfg.shortLabel,
    entryFeeUsd,
    exitFeeUsd,
    roundTripFeeUsd,
    roundTripFeePct,
    slippagePct,
    totalFrictionPct,
    estimatedEntrySeconds,
    estimatedExitSeconds,
    congestionLevel,
  };
}

export interface OpenPositionNetPnl {
  grossProceedsUsd: number;
  grossPnlUsd: number;
  entryFeeUsd: number;
  estimatedExitFeeUsd: number;
  totalRoundTripCostUsd: number;
  netProceedsUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
}

/**
 * Estimates real approximate PnL of an open (or closing) position including both
 * entry gas/slippage already paid and estimated exit gas/slippage at current market value.
 */
export function estimateOpenPositionNetPnl(
  pos: Position,
  feeProfile: FeeProfile = 'medio',
  overridePriceUsd?: number
): OpenPositionNetPnl {
  const effectivePrice =
    overridePriceUsd !== undefined && overridePriceUsd > 0 ? overridePriceUsd : pos.currentPriceUsd;
  const grossProceedsUsd =
    overridePriceUsd !== undefined && overridePriceUsd > 0
      ? Number((pos.quantity * effectivePrice).toFixed(2))
      : Number(pos.currentValueUsd.toFixed(2));
  const grossPnlUsd = Number((grossProceedsUsd - pos.stakeUsd).toFixed(2));

  const execEst = calculateExecutionEstimate(
    {
      liquidityUsd: pos.entrySnapshot?.liquidityUsd ?? 30_000,
      txns5mCount: 45,
      priceChange5mPct: Math.abs(pos.pnlPct) * 0.25,
    },
    pos.stakeUsd,
    feeProfile
  );

  const entrySlippageFallback = Number((pos.stakeUsd * (execEst.slippagePct / 100)).toFixed(2));
  const entryFeeUsd =
    pos.entryFeeUsd !== undefined
      ? Number(pos.entryFeeUsd.toFixed(2))
      : Number((execEst.entryFeeUsd + entrySlippageFallback).toFixed(2));

  const exitSlippageUsd = Number((grossProceedsUsd * (execEst.slippagePct / 100)).toFixed(2));
  const estimatedExitFeeUsd = Number((execEst.exitFeeUsd + exitSlippageUsd).toFixed(2));
  const totalRoundTripCostUsd = Number((entryFeeUsd + estimatedExitFeeUsd).toFixed(2));

  const netProceedsUsd = Number(Math.max(0, grossProceedsUsd - estimatedExitFeeUsd).toFixed(2));
  const netPnlUsd = Number((netProceedsUsd - pos.stakeUsd - entryFeeUsd).toFixed(2));
  const netPnlPct = pos.stakeUsd > 0 ? Number(((netPnlUsd / pos.stakeUsd) * 100).toFixed(2)) : 0;

  return {
    grossProceedsUsd,
    grossPnlUsd,
    entryFeeUsd,
    estimatedExitFeeUsd,
    totalRoundTripCostUsd,
    netProceedsUsd,
    netPnlUsd,
    netPnlPct,
  };
}

