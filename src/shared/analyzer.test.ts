import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFiveHourMovements,
  checkBotEntryGuards,
  createInitialPortfolioState,
  DEFAULT_BOT_SETTINGS,
  evaluateTrailingExit,
  executeBuyOrder,
  executeSellOrder,
  filterVolatileNewTokens,
  INITIAL_VIRTUAL_BALANCE_USD,
  rechargePortfolio,
  resetPortfolioHistory,
  selectTopVolatileTokens,
  validateStakeUsd,
} from './analyzer';
import { calculateExecutionEstimate, estimateOpenPositionNetPnl } from './execution';
import type { Candle5m, TokenPair } from './types';

function makePair(overrides: Partial<TokenPair> = {}): TokenPair {
  const now = 1_760_000_000_000;
  return {
    id: 'solana:pair1',
    chainId: 'solana',
    dexId: 'raydium',
    pairAddress: 'pair1',
    baseToken: { address: 'mint1', name: 'Alpha Volatile', symbol: 'ALPH' },
    quoteToken: { symbol: 'SOL' },
    priceUsd: 0.015,
    priceChange: { m5: 4.5, h1: 18.2, h6: 35.0, h24: 48.0 },
    volume: { m5: 12_000, h1: 68_000, h6: 180_000, h24: 220_000 },
    txns: {
      m5: { buys: 35, sells: 15 },
      h1: { buys: 190, sells: 90 },
      h6: { buys: 620, sells: 340 },
      h24: { buys: 700, sells: 390 },
    },
    liquidityUsd: 85_000,
    fdv: 420_000,
    marketCap: 420_000,
    pairCreatedAt: now - 6 * 60 * 60 * 1000,
    ageMinutes: 360,
    url: 'https://dexscreener.com/solana/pair1',
    source: 'dexscreener',
    ...overrides,
  };
}

function makeBullish5hCandles(nowMs: number, count = 60, startPrice = 0.01): Candle5m[] {
  const candles: Candle5m[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const step = i % 4 === 0 ? -0.008 : 0.015;
    const close = Number((open * (1 + step)).toFixed(6));
    const high = Number((Math.max(open, close) * 1.022).toFixed(6));
    const low = Number((Math.min(open, close) * 0.985).toFixed(6));
    candles.push({
      timestamp: nowMs - (count - 1 - i) * 5 * 60 * 1000,
      open,
      high,
      low,
      close,
      volumeUsd: 3200 + i * 95,
    });
    price = close;
  }
  return candles;
}

test('validateStakeUsd strictly enforces $20 to $100 bounds and bot defaults to $20', () => {
  assert.equal(DEFAULT_BOT_SETTINGS.botMinStakeUsd, 20);
  assert.equal(DEFAULT_BOT_SETTINGS.botMaxStakeUsd, 20);
  assert.equal(DEFAULT_BOT_SETTINGS.defaultStopLossPct, 8);
  assert.equal(validateStakeUsd(19.99).valid, false);
  assert.equal(validateStakeUsd(100.01).valid, false);
  assert.equal(validateStakeUsd(20).valid, true);
  assert.equal(validateStakeUsd(100).valid, true);
});

test('filterVolatileNewTokens supports 1h, 5h, 24h, and 10-day (240h) windows on Solana only', () => {
  const now = 1_760_000_000_000;
  const age30m = makePair({ id: 'solana:m30', pairAddress: 'm30', baseToken: { address: 'a1', name: 'A1', symbol: 'A1' }, pairCreatedAt: now - 30 * 60_000 });
  const age4h = makePair({ id: 'solana:h4', pairAddress: 'h4', baseToken: { address: 'a2', name: 'A2', symbol: 'A2' }, pairCreatedAt: now - 4 * 3600_000 });
  const age5d = makePair({ id: 'solana:d5', pairAddress: 'd5', baseToken: { address: 'a3', name: 'A3', symbol: 'A3' }, pairCreatedAt: now - 5 * 24 * 3600_000 });
  const ethPair = makePair({ id: 'ethereum:e1', chainId: 'ethereum', pairAddress: 'e1', pairCreatedAt: now - 30 * 60_000 });

  assert.equal(filterVolatileNewTokens([age30m, age4h, age5d, ethPair], now, 1, true).length, 1);
  assert.equal(filterVolatileNewTokens([age30m, age4h, age5d, ethPair], now, 5, true).length, 2);
  assert.equal(filterVolatileNewTokens([age30m, age4h, age5d, ethPair], now, 240, true).length, 3);

  const many: TokenPair[] = Array.from({ length: 30 }, (_, idx) =>
    makePair({
      id: `solana:p${idx}`,
      pairAddress: `p${idx}`,
      baseToken: { address: `m${idx}`, name: `Tok ${idx}`, symbol: `T${idx}` },
      pairCreatedAt: now - (idx + 1) * 3600_000,
    })
  );
  assert.equal(selectTopVolatileTokens(many, now, 240, true, 25).length, 25);
});

test('analyzeFiveHourMovements recommends strictly $20 for automatic bot orders by default', () => {
  const now = 1_760_000_000_000;
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const lastPrice = candles[candles.length - 1].close;
  const pair = makePair({ priceUsd: lastPrice, pairCreatedAt: now - 8 * 3600_000 });

  const result = analyzeFiveHourMovements(pair, candles, DEFAULT_BOT_SETTINGS, now);
  assert.equal(result.verdict, 'COMPRAR');
  assert.equal(result.recommendedStakeUsd, 20);
});

test('evaluateTrailingExit cuts fast at -8% SL and lets +50%/+80% rallies run before selling on pullback', () => {
  const now = 1_760_000_000_000;
  const state = createInitialPortfolioState();
  const pair = makePair({ priceUsd: 1.0 });
  const analysis = analyzeFiveHourMovements(pair, makeBullish5hCandles(now), DEFAULT_BOT_SETTINGS, now);

  const buy = executeBuyOrder(state, pair, 20, 'auto', analysis, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;

  let pos = buy.position;

  // 1. Price climbs +50% ($1.50) -> trailing activates, MUST NOT sell yet!
  const step1 = evaluateTrailingExit(pos, 1.5, DEFAULT_BOT_SETTINGS);
  assert.equal(step1.shouldSell, false);
  assert.equal(step1.updatedPosition.trailingActive, true);
  assert.equal(step1.updatedPosition.peakPnlPct, 50);
  assert.equal(step1.updatedPosition.trailingFloorPct, 40); // 50 - 10 callback
  pos = step1.updatedPosition;

  // 2. Continues climbing to +80% ($1.80) -> floor rises to +70%, STILL holds!
  const step2 = evaluateTrailingExit(pos, 1.8, DEFAULT_BOT_SETTINGS);
  assert.equal(step2.shouldSell, false);
  assert.equal(step2.updatedPosition.peakPnlPct, 80);
  assert.equal(step2.updatedPosition.trailingFloorPct, 70);
  pos = step2.updatedPosition;

  // 3. Pulls back 10% from peak to +69% ($1.69) -> triggers Trailing Take-Profit!
  const step3 = evaluateTrailingExit(pos, 1.69, DEFAULT_BOT_SETTINGS);
  assert.equal(step3.shouldSell, true);
  assert.ok(step3.sellReason?.includes('+80.0%'));

  // 4. Separate losing position hits tighter -8% Stop Loss ($0.91)
  const losingPos = buy.position;
  const lossStep = evaluateTrailingExit(losingPos, 0.91, DEFAULT_BOT_SETTINGS);
  assert.equal(lossStep.shouldSell, true);
  assert.ok(lossStep.sellReason?.includes('-8%'));
});

test('virtual portfolio recharge and sell accounting deduct realistic Punto Medio Solana fees', () => {
  const now = 1_760_000_000_000;
  let state = createInitialPortfolioState();
  assert.equal(state.cashUsd, INITIAL_VIRTUAL_BALANCE_USD);

  const pair = makePair({ priceUsd: 0.02 });
  const est = calculateExecutionEstimate(pair, 20, 'medio');
  assert.ok(est.roundTripFeeUsd < 0.75, 'Punto medio round-trip fee must stay far below $2.00 Turbo');
  assert.ok(est.estimatedExitSeconds >= 4 && est.estimatedExitSeconds <= 12);

  const analysis = analyzeFiveHourMovements(pair, makeBullish5hCandles(now), DEFAULT_BOT_SETTINGS, now);
  const buy = executeBuyOrder(state, pair, 20, 'auto', analysis, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;

  assert.ok((buy.position.entryFeeUsd ?? 0) > 0 && (buy.position.entryFeeUsd ?? 0) < 0.5);
  state = buy.state;
  const sell = executeSellOrder(state, buy.position.id, 0.03, 'auto', 'Trailing TP', now + 60_000);
  assert.equal(sell.ok, true);
  if (!sell.ok) return;

  // $10 gross gain minus entry & exit Punto Medio fees + slippage
  assert.ok((sell.trade.pnlUsd ?? 0) > 9 && (sell.trade.pnlUsd ?? 0) < 10);
  const recharged = rechargePortfolio(sell.state, { type: 'add', amountUsd: 100_000 });
  assert.equal(
    recharged.cashUsd,
    Number((INITIAL_VIRTUAL_BALANCE_USD + (sell.trade.pnlUsd ?? 0) + 100_000).toFixed(2))
  );
});

test('risky mode (70%) buys solid >=70% aptitude tokens skipped in strict mode while rejecting crashes', () => {
  const now = 1_760_000_000_000;
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const lastPrice = candles[candles.length - 1].close;

  // Slightly below strict volume ($18k < $25k) and txns (32 < 40), but healthy pool & bullish 6/8 checks
  const borderlinePair = makePair({
    priceUsd: lastPrice,
    liquidityUsd: 42_000,
    fdv: 210_000,
    marketCap: 210_000,
    volume: { m5: 4_500, h1: 16_000, h6: 21_000, h24: 28_000 },
    txns: {
      m5: { buys: 12, sells: 5 },
      h1: { buys: 22, sells: 10 },
      h6: { buys: 22, sells: 10 },
      h24: { buys: 28, sells: 14 },
    },
    pairCreatedAt: now - 4 * 3600_000,
  });

  const strictRes = analyzeFiveHourMovements(
    borderlinePair,
    candles,
    { ...DEFAULT_BOT_SETTINGS, scannerMode: 'strict' },
    now
  );
  assert.equal(strictRes.verdict, 'DESCARTAR');
  assert.ok(strictRes.aptitudePct >= 70);

  const riskyRes = analyzeFiveHourMovements(
    borderlinePair,
    candles,
    { ...DEFAULT_BOT_SETTINGS, scannerMode: 'risky', riskyMinScorePct: 70 },
    now
  );
  assert.equal(riskyRes.verdict, 'COMPRAR');
  assert.equal(riskyRes.entryModeUsed, 'risky');

  // Crashing token must STILL be rejected in Risky mode
  const crashingPair = makePair({
    priceUsd: lastPrice,
    priceChange: { m5: -24, h1: -38, h6: -40, h24: -40 },
  });
  const riskyCrashRes = analyzeFiveHourMovements(
    crashingPair,
    candles,
    { ...DEFAULT_BOT_SETTINGS, scannerMode: 'risky', riskyMinScorePct: 70 },
    now
  );
  assert.equal(riskyCrashRes.verdict, 'DESCARTAR');
});

test('internal study records notes after every buy and sell and boosts winning patterns in future scans', () => {
  const now = 1_760_000_000_000;
  let state = createInitialPortfolioState();
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const lastPrice = candles[candles.length - 1].close;

  // High buy pressure (>62%) winning pair
  const strongPairA = makePair({
    id: 'solana:winA',
    pairAddress: 'winA',
    baseToken: { address: 'winMintA', name: 'WinA', symbol: 'WINA' },
    priceUsd: lastPrice,
    txns: {
      m5: { buys: 40, sells: 10 },
      h1: { buys: 240, sells: 80 }, // 75% buys -> buy:62%+
      h6: { buys: 500, sells: 200 },
      h24: { buys: 520, sells: 210 },
    },
  });

  const analysisA = analyzeFiveHourMovements(strongPairA, candles, DEFAULT_BOT_SETTINGS, now);
  const buy1 = executeBuyOrder(state, strongPairA, 20, 'auto', analysisA, now);
  assert.equal(buy1.ok, true);
  if (!buy1.ok) return;
  state = buy1.state;
  assert.equal(state.learningProfile.totalBuysStudied, 1);
  assert.equal(state.learningProfile.recentStudies[0].side, 'BUY');

  const sell1 = executeSellOrder(state, buy1.position.id, lastPrice * 1.4, 'auto', 'Trailing TP', now + 120_000);
  assert.equal(sell1.ok, true);
  if (!sell1.ok) return;
  state = sell1.state;
  assert.equal(state.learningProfile.totalSellsStudied, 1);
  assert.equal(state.learningProfile.recentStudies[0].side, 'SELL');

  // Second winning trade with same buy:62%+ profile activates positive weight bonus
  const buy2 = executeBuyOrder(state, strongPairA, 20, 'auto', analysisA, now + 180_000);
  assert.equal(buy2.ok, true);
  if (!buy2.ok) return;
  state = buy2.state;

  const sell2 = executeSellOrder(state, buy2.position.id, lastPrice * 1.35, 'auto', 'Trailing TP', now + 240_000);
  assert.equal(sell2.ok, true);
  if (!sell2.ok) return;
  state = sell2.state;

  assert.equal(state.learningProfile.winsCount, 2);
  assert.ok(state.learningProfile.boostedTraits.length > 0);

  // Next candidate sharing winning traits gets positive learnedBonusPts
  const candidate = makePair({
    id: 'solana:cand',
    pairAddress: 'cand',
    priceUsd: lastPrice,
    txns: strongPairA.txns,
  });
  const learnedAnalysis = analyzeFiveHourMovements(
    candidate,
    candles,
    DEFAULT_BOT_SETTINGS,
    now + 300_000,
    state.learningProfile
  );
  assert.ok(learnedAnalysis.learnedBonusPts > 0);
  assert.ok(learnedAnalysis.matchedLearnedTraits.length > 0);
});

test('auto break-even locks +2.5% floor at +10% peak and Anti-FOMO penalizes exhausted pumps', () => {
  const now = 1_760_000_000_000;
  const state = createInitialPortfolioState();
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const lastPrice = candles[candles.length - 1].close;

  const pair = makePair({ priceUsd: 1.0 });
  const analysis = analyzeFiveHourMovements(pair, candles, DEFAULT_BOT_SETTINGS, now);
  const buy = executeBuyOrder(state, pair, 20, 'auto', analysis, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;

  // Climbs to +11% -> triggers Break-Even (+2.5%) before Trailing (+18%)
  const stepBe = evaluateTrailingExit(buy.position, 1.11, DEFAULT_BOT_SETTINGS);
  assert.equal(stepBe.shouldSell, false);
  assert.equal(stepBe.updatedPosition.breakEvenActive, true);
  assert.equal(stepBe.updatedPosition.trailingFloorPct, 2.5);

  // Pulls back to +2.2% -> closes in small profit covering Punto Medio fees instead of hitting -8% SL
  const stepBeExit = evaluateTrailingExit(stepBe.updatedPosition, 1.022, DEFAULT_BOT_SETTINGS);
  assert.equal(stepBeExit.shouldSell, true);
  assert.ok(stepBeExit.sellReason?.includes('Break-Even'));

  // Anti-FOMO guard: parabolic +140% in 1h stalled at -1% in 5m gets flagged and scored lower
  const fomoTop = makePair({ priceUsd: lastPrice, priceChange: { m5: -1.2, h1: 145, h6: 180, h24: 180 } });
  const healthy = makePair({ priceUsd: lastPrice, priceChange: { m5: 3.0, h1: 28, h6: 45, h24: 60 } });
  const fomoRes = analyzeFiveHourMovements(fomoTop, candles, DEFAULT_BOT_SETTINGS, now);
  const healthyRes = analyzeFiveHourMovements(healthy, candles, DEFAULT_BOT_SETTINGS, now);
  assert.ok(fomoRes.rugReasons.some((r) => r.includes('Anti-FOMO')));
  assert.ok(healthyRes.score > fomoRes.score);
});

test('estimateOpenPositionNetPnl includes entry + exit gas/slippage and matches executeSellOrder', () => {
  const now = 1_760_000_000_000;
  const state = createInitialPortfolioState();
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const pair = makePair({ priceUsd: 1.0, liquidityUsd: 40_000 });
  const analysis = analyzeFiveHourMovements(pair, candles, DEFAULT_BOT_SETTINGS, now);

  const buy = executeBuyOrder(state, pair, 20, 'auto', analysis, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;

  // At flat price (0% price move), real PnL must already be negative due to entry + exit gas & slippage
  const flatNet = estimateOpenPositionNetPnl(buy.position, 'medio');
  assert.equal(flatNet.grossPnlUsd, 0);
  assert.ok(flatNet.totalRoundTripCostUsd > 0.35 && flatNet.totalRoundTripCostUsd < 1.0);
  assert.equal(flatNet.netPnlUsd, Number((-flatNet.totalRoundTripCostUsd).toFixed(2)));

  // At +15% price rise, open net estimate must match executeSellOrder realized net PnL exactly
  const marked = evaluateTrailingExit(buy.position, 1.15, DEFAULT_BOT_SETTINGS).updatedPosition;
  const markedState = { ...buy.state, positions: [marked] };
  const openAt15 = estimateOpenPositionNetPnl(marked, 'medio');
  const sellAt15 = executeSellOrder(markedState, marked.id, 1.15, 'manual', 'Venta manual', now + 30_000);
  assert.equal(sellAt15.ok, true);
  if (!sellAt15.ok) return;

  assert.equal(openAt15.netPnlUsd, sellAt15.trade.pnlUsd);
  assert.equal(openAt15.netPnlPct, sellAt15.trade.pnlPct);
});

test('customizable balance set and resetPortfolioHistory zero all metrics while preserving custom base balance', () => {
  const now = 1_760_000_000_000;
  let state = createInitialPortfolioState();
  state = rechargePortfolio(state, { type: 'set', amountUsd: 1_500 });
  assert.equal(state.cashUsd, 1_500);
  assert.equal(state.settings.customInitialBalanceUsd, 1_500);

  const pair = makePair({ priceUsd: 1.0 });
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const analysis = analyzeFiveHourMovements(pair, candles, state.settings, now);
  const buy = executeBuyOrder(state, pair, 20, 'auto', analysis, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;

  const sell = executeSellOrder(buy.state, buy.position.id, 1.25, 'manual', 'Venta', now + 10_000);
  assert.equal(sell.ok, true);
  if (!sell.ok) return;
  assert.equal(sell.state.trades.length, 2);

  const reset = resetPortfolioHistory(sell.state, { keepSettings: true });
  assert.equal(reset.cashUsd, 1_500);
  assert.equal(reset.totalRechargedUsd, 0);
  assert.equal(reset.positions.length, 0);
  assert.equal(reset.trades.length, 0);
  assert.equal(reset.scanLogs.length, 0);
  assert.equal(reset.learningProfile.totalBuysStudied, 0);
  assert.equal(reset.learningProfile.totalSellsStudied, 0);
  assert.equal(reset.learningProfile.winsCount, 0);
  assert.equal(reset.lastScanAt, null);
});

test('customizable Risky mode filters and checkBotEntryGuards enforce safety limits', () => {
  const now = 1_760_000_000_000;
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const lastPrice = candles[candles.length - 1].close;

  // Pool with $12,000 liquidity and 8m age (ALTO risk due to age<15m + liq<15k, not CRITICO)
  const youngPair = makePair({
    priceUsd: lastPrice,
    liquidityUsd: 12_000,
    fdv: 45_000,
    marketCap: 45_000,
    ageMinutes: 8,
    pairCreatedAt: now - 8 * 60_000,
  });

  // Blocked when riskyMinAgeMinutes=15, blocked when riskyAllowHighRugRisk=false, allowed when age>=5 + allowHigh=true
  const blockedByAge = analyzeFiveHourMovements(
    youngPair,
    candles,
    { ...DEFAULT_BOT_SETTINGS, scannerMode: 'risky', riskyMinScorePct: 50, riskyMinAgeMinutes: 15, riskyMinLiquidityUsd: 8_000, riskyAllowHighRugRisk: true },
    now
  );
  assert.equal(blockedByAge.verdict, 'DESCARTAR');

  const blockedByHighRiskToggle = analyzeFiveHourMovements(
    youngPair,
    candles,
    { ...DEFAULT_BOT_SETTINGS, scannerMode: 'risky', riskyMinScorePct: 50, riskyMinAgeMinutes: 5, riskyMinLiquidityUsd: 8_000, riskyAllowHighRugRisk: false },
    now
  );
  assert.equal(blockedByHighRiskToggle.verdict, 'DESCARTAR');

  const allowedCustomRisky = analyzeFiveHourMovements(
    youngPair,
    candles,
    { ...DEFAULT_BOT_SETTINGS, scannerMode: 'risky', riskyMinScorePct: 50, riskyMinAgeMinutes: 5, riskyMinLiquidityUsd: 8_000, riskyAllowHighRugRisk: true },
    now
  );
  assert.equal(allowedCustomRisky.verdict, 'COMPRAR');

  // Check entry guards: maxOpenPositions, cooldown, dailyMaxLossUsd
  let state = createInitialPortfolioState(1_000);
  state.settings.maxOpenPositions = 1;
  state.settings.reentryCooldownMinutes = 30;
  state.settings.dailyMaxLossUsd = 10;

  const buy = executeBuyOrder(state, makePair({ priceUsd: lastPrice }), 20, 'auto', allowedCustomRisky, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;
  state = buy.state;

  const guardMaxPos = checkBotEntryGuards(state, 'solana:other', now + 5_000);
  assert.equal(guardMaxPos.allowed, false);
  assert.ok(guardMaxPos.reason?.includes('1/1'));

  // Close at loss (-$12 after fees) -> triggers BOTH cooldown for same token AND dailyMaxLossUsd
  const sell = executeSellOrder(state, buy.position.id, lastPrice * 0.4, 'auto', 'SL', now + 60_000);
  assert.equal(sell.ok, true);
  if (!sell.ok) return;

  const guardCooldown = checkBotEntryGuards(sell.state, buy.position.tokenId, now + 120_000);
  assert.equal(guardCooldown.allowed, false);
  assert.ok(guardCooldown.reason?.includes('Cooldown'));

  const guardDailyLoss = checkBotEntryGuards(sell.state, 'solana:freshToken', now + 120_000);
  assert.equal(guardDailyLoss.allowed, false);
  assert.ok(guardDailyLoss.reason?.includes('Stop diario'));
});

test('maxAgeHours=0 (Todos) includes active Solana pairs across 1h, 24h, and >10d windows', () => {
  const now = 1_760_000_000_000;
  const fresh1h = makePair({ id: 'solana:fresh1h', pairAddress: 'fresh1h', pairCreatedAt: now - 30 * 60_000 });
  const old20d = makePair({
    id: 'solana:old20d',
    pairAddress: 'old20d',
    pairCreatedAt: now - 20 * 24 * 3600_000,
    ageMinutes: 20 * 24 * 60,
  });

  const restricted10d = filterVolatileNewTokens([fresh1h, old20d], now, 240, true);
  assert.equal(restricted10d.length, 1);

  const allWindows = filterVolatileNewTokens([fresh1h, old20d], now, 0, true);
  assert.equal(allWindows.length, 2);

  const candles = makeBullish5hCandles(now, 60, 0.01);
  const analysisOldAll = analyzeFiveHourMovements(
    old20d,
    candles,
    { ...DEFAULT_BOT_SETTINGS, maxAgeHours: 0 },
    now
  );
  const ageCheck = analysisOldAll.checks.find((c) => c.key === 'age');
  assert.equal(ageCheck?.passed, true);
});

test('sub-hour timeframe resolution handles New, 1m, 5m, 10m, 15m and filters accurately', () => {
  const now = 1_760_000_000_000;
  const age45s = makePair({
    id: 'solana:s45',
    pairAddress: 's45',
    pairCreatedAt: now - 45_000,
    ageMinutes: 0.75,
    ageSeconds: 45,
  });
  const age4m = makePair({
    id: 'solana:m4',
    pairAddress: 'm4',
    pairCreatedAt: now - 4 * 60_000,
    ageMinutes: 4,
    ageSeconds: 240,
  });
  const age12m = makePair({
    id: 'solana:m12',
    pairAddress: 'm12',
    pairCreatedAt: now - 12 * 60_000,
    ageMinutes: 12,
    ageSeconds: 720,
  });

  // 1m (1/60h) includes only 45s
  assert.equal(filterVolatileNewTokens([age45s, age4m, age12m], now, 1 / 60, true).length, 1);
  // New (2/60h) includes only 45s
  assert.equal(filterVolatileNewTokens([age45s, age4m, age12m], now, 2 / 60, true).length, 1);
  // 5m (5/60h) includes 45s and 4m
  assert.equal(filterVolatileNewTokens([age45s, age4m, age12m], now, 5 / 60, true).length, 2);
  // 15m (15/60h) includes all three
  assert.equal(filterVolatileNewTokens([age45s, age4m, age12m], now, 15 / 60, true).length, 3);
  // 0 (Todos) includes all three
  assert.equal(filterVolatileNewTokens([age45s, age4m, age12m], now, 0, true).length, 3);
});

test('risky mode obeys riskyMinScorePct even when token has ALTO rugRiskLevel', () => {
  const now = 1_760_000_000_000;
  const candles = makeBullish5hCandles(now, 60, 0.01);
  const lastPrice = candles[candles.length - 1].close;

  // Token aged 12m (<15m -> +30 rugPts) with $12k liquidity (<$15k min -> +25 rugPts) => 55 rugPts = ALTO risk, yet >= 55% aptitude!
  const altoPair = makePair({
    priceUsd: lastPrice,
    liquidityUsd: 12_000,
    fdv: 190_000,
    marketCap: 190_000,
    ageMinutes: 12,
    pairCreatedAt: now - 12 * 60_000,
  });

  // With riskyMinScorePct=55 and riskyAllowHighRugRisk=true, MUST buy (score not artificially capped at 48!)
  const buyAt55 = analyzeFiveHourMovements(
    altoPair,
    candles,
    {
      ...DEFAULT_BOT_SETTINGS,
      scannerMode: 'risky',
      riskyMinScorePct: 55,
      riskyMinLiquidityUsd: 8_000,
      riskyMinAgeMinutes: 10,
      riskyAllowHighRugRisk: true,
    },
    now
  );
  assert.equal(buyAt55.rugRiskLevel, 'ALTO');
  assert.ok(buyAt55.aptitudePct >= 55, `Expected aptitudePct >= 55, got ${buyAt55.aptitudePct}`);
  assert.equal(buyAt55.verdict, 'COMPRAR');

  // With riskyMinScorePct=92, MUST reject
  const rejectAt92 = analyzeFiveHourMovements(
    altoPair,
    candles,
    {
      ...DEFAULT_BOT_SETTINGS,
      scannerMode: 'risky',
      riskyMinScorePct: 92,
      riskyMinLiquidityUsd: 8_000,
      riskyMinAgeMinutes: 10,
      riskyAllowHighRugRisk: true,
    },
    now
  );
  assert.equal(rejectAt92.verdict, 'DESCARTAR');
});

test('crazy 1-minute mode enters low-range rebounds and closes at TP, SL, or 60s time-stop', () => {
  const now = 1_760_000_000_000;
  // Build candles that pull back into lower ~35% of range then bounce upward on last candle
  const candles: Candle5m[] = [];
  for (let i = 0; i < 20; i++) {
    let close = 0.015;
    if (i < 6) close = 0.012 + i * 0.0012; // peaks near 0.018
    else if (i < 16) close = 0.018 - (i - 5) * 0.00075; // dips near 0.0105
    else close = 0.0105 + (i - 15) * 0.00045; // bounces off bottom to ~0.0123 (~24% of range!)
    candles.push({
      timestamp: now - (20 - i) * 5 * 60_000,
      open: Number((close * 0.985).toFixed(6)),
      high: Number((i === 5 ? 0.0185 : close * 1.02).toFixed(6)),
      low: Number((i === 15 ? 0.0102 : close * 0.98).toFixed(6)),
      close: Number(close.toFixed(6)),
      volumeUsd: 6000 + i * 250,
    });
  }
  const reboundPrice = candles[candles.length - 1].close;
  const crazyPair = makePair({
    priceUsd: reboundPrice,
    liquidityUsd: 35_000,
    fdv: 150_000,
    marketCap: 150_000,
    priceChange: { m5: 4.8, h1: 12.0, h6: 18.0, h24: 25.0 },
    txns: {
      m5: { buys: 42, sells: 18 },
      h1: { buys: 140, sells: 80 },
      h6: { buys: 300, sells: 190 },
      h24: { buys: 360, sells: 220 },
    },
  });

  const crazySettings = {
    ...DEFAULT_BOT_SETTINGS,
    scannerMode: 'crazy' as const,
    crazyTakeProfitPct: 10,
    crazyStopLossPct: 5,
    crazyMaxHoldSeconds: 60,
    crazyMinLiquidityUsd: 5_000,
  };

  const crazyAnalysis = analyzeFiveHourMovements(crazyPair, candles, crazySettings, now);
  assert.equal(crazyAnalysis.entryModeUsed, 'crazy');
  assert.equal(crazyAnalysis.verdict, 'COMPRAR');
  assert.ok(crazyAnalysis.crazySignalNote?.includes('Crazy 1m'));

  const state = createInitialPortfolioState(1_000);
  const buy = executeBuyOrder(state, crazyPair, 20, 'auto', crazyAnalysis, now);
  assert.equal(buy.ok, true);
  if (!buy.ok) return;
  assert.equal(buy.position.scannerMode, 'crazy');

  // 1) At +3% after 25s -> still holds
  const holdAt25s = evaluateTrailingExit(buy.position, reboundPrice * 1.03, crazySettings, now + 25_000);
  assert.equal(holdAt25s.shouldSell, false);

  // 2) At +11% after 30s -> triggers Crazy TP (+10%)
  const tpExit = evaluateTrailingExit(buy.position, reboundPrice * 1.11, crazySettings, now + 30_000);
  assert.equal(tpExit.shouldSell, true);
  assert.ok(tpExit.sellReason?.includes('Take-Profit rápido Crazy 1m'));

  // 3) At -5.5% after 20s -> triggers Crazy SL (-5%)
  const slExit = evaluateTrailingExit(buy.position, reboundPrice * 0.945, crazySettings, now + 20_000);
  assert.equal(slExit.shouldSell, true);
  assert.ok(slExit.sellReason?.includes('Stop Loss Crazy 1m'));

  // 4) At +2% after 62s -> triggers Crazy 60s time-stop
  const timeExit = evaluateTrailingExit(buy.position, reboundPrice * 1.02, crazySettings, now + 62_000);
  assert.equal(timeExit.shouldSell, true);
  assert.ok(timeExit.sellReason?.includes('Salida Crazy 1m por límite de tiempo'));
});

