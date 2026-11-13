export type ChainId = 'solana' | string;

export type TimeframeOptionHours = number;

export type ScannerTimeframeId =
  | 'all'
  | 'new'
  | '1m'
  | '5m'
  | '10m'
  | '15m'
  | '1h'
  | '5h'
  | '10h'
  | '24h'
  | '1d'
  | '10d';

export type ChartTimeframe = '15m' | '1h' | '5h' | '10h' | '24h';

export interface Candle5m {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
  buys?: number;
  sells?: number;
}

export interface PoolTrade {
  id: string;
  txHash: string;
  type: 'buy' | 'sell';
  priceUsd: number;
  volumeUsd: number;
  timestamp: number;
  maker: string;
}

export interface TokenPair {
  id: string; // `${chainId}:${pairAddress}`
  chainId: ChainId;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    symbol: string;
  };
  priceUsd: number;
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  liquidityUsd: number;
  fdv: number;
  marketCap: number;
  pairCreatedAt: number; // Unix ms
  ageMinutes: number;
  ageSeconds?: number;
  url: string;
  imageUrl?: string;
  source: 'dexscreener' | 'geckoterminal' | 'simulado';
}

export interface ThresholdCheck {
  key: string;
  label: string;
  passed: boolean;
  actualFormatted: string;
  requiredFormatted: string;
}

export type RugRiskLevel = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';

export type ScannerMode = 'strict' | 'risky' | 'crazy';

export type ScannerSortBy = 'score' | 'volume' | 'liquidity' | 'momentum1h' | 'newest';

export type FeeProfile = 'economico' | 'medio' | 'rapido';

export interface ExecutionEstimate {
  feeProfile: FeeProfile;
  label: string;
  entryFeeUsd: number;
  exitFeeUsd: number;
  roundTripFeeUsd: number;
  roundTripFeePct: number;
  slippagePct: number;
  totalFrictionPct: number;
  estimatedEntrySeconds: number;
  estimatedExitSeconds: number;
  congestionLevel: 'Baja' | 'Media' | 'Alta';
}

export interface EntryFeatureSnapshot {
  ageMinutes: number;
  ageBucket: '<15m' | '15m-1h' | '1h-5h' | '5h-24h' | '1d-10d';
  liquidityUsd: number;
  liquidityBucket: '<30k' | '30k-100k' | '100k+';
  volume5hUsd: number;
  buyPressurePct: number;
  buyPressureBucket: '<55%' | '55-62%' | '62%+';
  volumeAcceleration: number;
  acceleratingVolume: boolean;
  higherLowsHolding: boolean;
  rugRiskLevel: RugRiskLevel;
  scannerMode: ScannerMode;
  score: number;
  netExpectedReturnPct: number;
}

export interface PatternStat {
  key: string;
  label: string;
  tradesCount: number;
  winsCount: number;
  avgPnlPct: number;
  avgPeakPnlPct: number;
  totalPnlUsd: number;
  weightAdjustment: number; // -12 to +14 score bonus/penalty
}

export interface TradeStudyEntry {
  id: string;
  timestamp: number;
  side: 'BUY' | 'SELL';
  symbol: string;
  tokenId: string;
  mode: 'manual' | 'auto';
  scannerMode: ScannerMode;
  stakeUsd: number;
  pnlUsd?: number;
  pnlPct?: number;
  peakPnlPct?: number;
  summary: string;
  commonObservation: string;
  nextActionRule: string;
  matchedTraits: string[];
}

export interface BotLearningProfile {
  totalBuysStudied: number;
  totalSellsStudied: number;
  winsCount: number;
  lossesCount: number;
  activeDirective: string;
  boostedTraits: string[];
  penalizedTraits: string[];
  patternStats: PatternStat[];
  recentStudies: TradeStudyEntry[];
}

export interface FiveHourAnalysis {
  tokenId: string;
  candlesCount: number;
  expectedWindowCandles: number;
  coveragePct: number;
  volatility5hPct: number;
  momentum5hPct: number;
  bullishCandlesPct: number;
  buyPressurePct: number;
  m5BuyPressurePct: number;
  volumeAcceleration: number;
  higherLowsHolding: boolean;
  liquidityToFdvPct: number;
  estimatedFrictionPct: number;
  expectedUpsidePct: number;
  netExpectedReturnPct: number;
  score: number; // 0 to 100
  aptitudePct: number; // 0 to 100 readiness % (e.g., >= 70% in Risky mode)
  learnedBonusPts: number;
  matchedLearnedTraits: string[];
  entryModeUsed: ScannerMode;
  rugRiskLevel: RugRiskLevel;
  rugReasons: string[];
  aptitudeReasons: string[];
  passesMinimums: boolean;
  saleACuenta: boolean;
  verdict: 'COMPRAR' | 'DESCARTAR';
  recommendedStakeUsd: number; // Strictly [20, 100]
  suggestedTakeProfitPct: number;
  suggestedStopLossPct: number;
  checks: ThresholdCheck[];
  summaryReason: string;
  candles: Candle5m[];
  chartTimeframe?: ChartTimeframe;
  crazySignalNote?: string;
}

export interface AnalyzedToken {
  token: TokenPair;
  analysis: FiveHourAnalysis;
}

export interface TokenLiveDetailResponse {
  token: TokenPair;
  analysis: FiveHourAnalysis;
  recentTrades: PoolTrade[];
  tradesSource: 'geckoterminal' | 'geckoterminal-token-pool' | 'summary';
  chartTimeframe?: ChartTimeframe;
  fetchedAt: number;
}

export interface Position {
  id: string;
  tokenId: string;
  symbol: string;
  name: string;
  chainId: string;
  pairAddress: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  quantity: number;
  stakeUsd: number; // Strictly [20, 100]
  currentValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  peakPnlPct: number;
  trailingActive: boolean;
  trailingFloorPct: number;
  openedAt: number;
  mode: 'manual' | 'auto';
  scannerMode?: ScannerMode;
  takeProfitPct: number;
  stopLossPct: number;
  analysisScore: number;
  url: string;
  entrySnapshot?: EntryFeatureSnapshot;
  entryFeeUsd?: number;
  estimatedExitSeconds?: number;
  breakEvenActive?: boolean;
}

export interface TradeRecord {
  id: string;
  tokenId: string;
  symbol: string;
  name: string;
  chainId: string;
  side: 'BUY' | 'SELL';
  mode: 'manual' | 'auto';
  priceUsd: number;
  stakeUsd: number;
  feeUsd?: number;
  proceedsUsd?: number;
  pnlUsd?: number;
  pnlPct?: number;
  reason: string;
  timestamp: number;
}

export interface ScanTokenDecision {
  tokenId: string;
  symbol: string;
  chainId: string;
  ageMinutes: number;
  priceUsd: number;
  score: number;
  aptitudePct?: number;
  rugRiskLevel: RugRiskLevel;
  verdict: 'COMPRAR' | 'DESCARTAR';
  actionTaken: 'COMPRADO' | 'YA_EN_CARTERA' | 'SALDO_INSUFICIENTE' | 'DESCARTADO';
  stakeUsd?: number;
  reason: string;
}

export interface ScanLogEntry {
  id: string;
  timestamp: number;
  trigger: 'auto-5m' | 'manual';
  scannerMode?: ScannerMode;
  tokensEvaluated: number;
  tokensBought: number;
  totalSpentUsd: number;
  dataSourceLabel: string;
  decisions: ScanTokenDecision[];
}

export interface BotSettings {
  onlySolana: boolean;
  customInitialBalanceUsd: number; // Customizable base portfolio balance (default $1,000,000)
  scannerMode: ScannerMode; // 'strict' (100%), 'risky' (customizable %), or 'crazy' (1-min trajectory scalp)
  scannerTimeframe: ScannerTimeframeId; // 'all' | 'new' | '1m' | '5m' | '10m' | '15m' | '1h' | '5h' | '10h' | '24h' | '1d' | '10d'
  chartTimeframe: ChartTimeframe; // Customizable price chart window in settings ('15m' | '1h' | '5h' | '10h' | '24h')
  scannerSortBy: ScannerSortBy; // Customizable market table sorting
  riskyMinScorePct: number; // Default 70 (customizable 40..95)
  riskyMinLiquidityUsd: number; // Default 8000 (customizable)
  riskyMinAgeMinutes: number; // Default 15 (customizable 3..60)
  riskyAllowHighRugRisk: boolean; // Allow ALTO risk in Risky (still blocks CRITICO)
  crazyTakeProfitPct: number; // Default 10% quick scalp TP
  crazyStopLossPct: number; // Default 5% tight SL
  crazyMaxHoldSeconds: number; // Default 60s max hold for 1-minute scalping
  crazyMinLiquidityUsd: number; // Default $5,000 min liquidity for Crazy scalps
  adaptiveLearningEnabled: boolean;
  feeProfile: FeeProfile; // Default 'medio' (balanced midpoint fee vs $1+$1 turbo)
  simulateExecutionDelay: boolean; // Simulate realistic Solana confirmation time on manual buy/sell
  breakEvenTriggerPct: number; // Move SL to profit lock once peak hits e.g. +10%
  breakEvenFloorPct: number; // Floor covering round-trip fees (e.g. +2.5%)
  maxOpenPositions: number; // Essential risk guard: cap simultaneous open trades
  reentryCooldownMinutes: number; // Essential guard: avoid immediate re-buying after a close
  dailyMaxLossUsd: number; // Daily kill-switch for auto buys (0 = disabled)
  autoScanEnabled: boolean;
  scanIntervalMinutes: number; // Customizable 1..60 min (default 5)
  maxAgeHours: number; // 0 = Todos, fractional hours supported for sub-hour (e.g. 1/60 = 1m, 5/60 = 5m) up to 240 (10d)
  displayLimit: number; // 10, 15, 25, or 40
  minLiquidityUsd: number;
  minVolume5hUsd: number;
  minTxnsCount: number;
  minBuyRatio: number; // 0.50 - 0.85
  minVolatilityPct: number;
  minExpectedProfitPct: number;
  botMinStakeUsd: number; // Default 20
  botMaxStakeUsd: number; // Default 20 (fixed $20 auto orders)
  autoCloseTpSl: boolean;
  defaultTakeProfitPct: number; // Trailing activation threshold (e.g. 18%)
  defaultStopLossPct: number; // Tighter initial SL (e.g. 8%)
  trailingCallbackPct: number; // Pullback from peak before selling (e.g. 10%)
}

export interface PortfolioState {
  cashUsd: number;
  totalRechargedUsd: number;
  positions: Position[];
  trades: TradeRecord[];
  scanLogs: ScanLogEntry[];
  settings: BotSettings;
  learningProfile: BotLearningProfile;
  lastScanAt: number | null;
  nextScanAt: number | null;
}

export interface MarketSnapshotResponse {
  tokens: AnalyzedToken[];
  fetchedAt: number;
  sourceStatus: 'live' | 'partial' | 'fallback';
  sourceMessage: string;
}

export interface AppStateResponse {
  portfolio: PortfolioState;
  market: MarketSnapshotResponse;
}
