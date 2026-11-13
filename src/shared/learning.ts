import type {
  BotLearningProfile,
  EntryFeatureSnapshot,
  PatternStat,
  Position,
  RugRiskLevel,
  ScannerMode,
  TokenPair,
  TradeStudyEntry,
} from './types.ts';

const TRAIT_LABELS: Record<string, string> = {
  'age:<15m': 'Edad <15m (Ultra reciente)',
  'age:15m-1h': 'Edad 15m–1h (reciente)',
  'age:1h-5h': 'Edad 1h–5h (impulso)',
  'age:5h-24h': 'Edad 5h–24h (consolidación)',
  'age:1d-10d': 'Edad 1d–10d (maduro)',
  'liq:<30k': 'Liquidez <$30K',
  'liq:30k-100k': 'Liquidez $30K–$100K',
  'liq:100k+': 'Liquidez ≥$100K',
  'buy:<55%': 'Presión compradora <55%',
  'buy:55-62%': 'Presión compradora 55%–62%',
  'buy:62%+': 'Presión compradora ≥62%',
  'accel:yes': 'Aceleración de volumen ≥1.2x',
  'higherlows:yes': 'Mínimos crecientes',
  'mode:risky': 'Entrada en modo Risky',
  'mode:crazy': 'Entrada en modo Crazy (1m)',
  'mode:strict': 'Entrada en modo Estricto',
};

export function createInitialLearningProfile(): BotLearningProfile {
  return {
    totalBuysStudied: 0,
    totalSellsStudied: 0,
    winsCount: 0,
    lossesCount: 0,
    activeDirective:
      'Sin operaciones cerradas aún: tras cada compra y venta el bot estudiará qué rasgos comunes generan más beneficio.',
    boostedTraits: [],
    penalizedTraits: [],
    patternStats: [],
    recentStudies: [],
  };
}

export function getAgeBucket(ageMinutes: number): EntryFeatureSnapshot['ageBucket'] {
  if (ageMinutes < 15) return '<15m';
  if (ageMinutes <= 60) return '15m-1h';
  if (ageMinutes <= 300) return '1h-5h';
  if (ageMinutes <= 1440) return '5h-24h';
  return '1d-10d';
}

export function getLiquidityBucket(liquidityUsd: number): EntryFeatureSnapshot['liquidityBucket'] {
  if (liquidityUsd < 30_000) return '<30k';
  if (liquidityUsd < 100_000) return '30k-100k';
  return '100k+';
}

export function getBuyPressureBucket(buyPressurePct: number): EntryFeatureSnapshot['buyPressureBucket'] {
  if (buyPressurePct < 55) return '<55%';
  if (buyPressurePct < 62) return '55-62%';
  return '62%+';
}

export function buildEntryFeatureSnapshot(params: {
  pair: TokenPair;
  volume5hUsd: number;
  buyPressurePct: number;
  volumeAcceleration: number;
  higherLowsHolding: boolean;
  rugRiskLevel: RugRiskLevel;
  scannerMode: ScannerMode;
  score: number;
  netExpectedReturnPct: number;
}): EntryFeatureSnapshot {
  return {
    ageMinutes: params.pair.ageMinutes,
    ageBucket: getAgeBucket(params.pair.ageMinutes),
    liquidityUsd: params.pair.liquidityUsd,
    liquidityBucket: getLiquidityBucket(params.pair.liquidityUsd),
    volume5hUsd: params.volume5hUsd,
    buyPressurePct: params.buyPressurePct,
    buyPressureBucket: getBuyPressureBucket(params.buyPressurePct),
    volumeAcceleration: params.volumeAcceleration,
    acceleratingVolume: params.volumeAcceleration >= 1.2,
    higherLowsHolding: params.higherLowsHolding,
    rugRiskLevel: params.rugRiskLevel,
    scannerMode: params.scannerMode,
    score: params.score,
    netExpectedReturnPct: params.netExpectedReturnPct,
  };
}

export function getTraitKeysFromSnapshot(snap: EntryFeatureSnapshot): string[] {
  const keys: string[] = [
    `age:${snap.ageBucket}`,
    `liq:${snap.liquidityBucket}`,
    `buy:${snap.buyPressureBucket}`,
    `mode:${snap.scannerMode}`,
  ];
  if (snap.acceleratingVolume) keys.push('accel:yes');
  if (snap.higherLowsHolding) keys.push('higherlows:yes');
  return keys;
}

export function getTraitLabel(key: string): string {
  return TRAIT_LABELS[key] || key;
}

function computeWeightAdjustment(stat: PatternStat): number {
  if (stat.tradesCount < 2) return 0;
  const winRate = stat.winsCount / stat.tradesCount;

  // Positive profitable edge
  if (winRate >= 0.55 && stat.avgPnlPct > 2) {
    const edge = Math.min(12, Math.round(winRate * 8 + Math.min(4, stat.avgPnlPct / 8)));
    return Math.max(4, edge);
  }
  if (stat.avgPeakPnlPct >= 25 && stat.avgPnlPct > 0) {
    return 5;
  }

  // Consistently losing setup
  if (winRate <= 0.4 && stat.avgPnlPct < -1.5) {
    const penalty = Math.min(10, Math.round((1 - winRate) * 7 + Math.min(3, Math.abs(stat.avgPnlPct) / 4)));
    return -Math.max(4, penalty);
  }

  return 0;
}

function rebuildDirective(
  profile: BotLearningProfile,
  stats: PatternStat[]
): {
  activeDirective: string;
  boostedTraits: string[];
  penalizedTraits: string[];
} {
  const boosted = stats
    .filter((s) => s.weightAdjustment > 0)
    .sort((a, b) => b.weightAdjustment - a.weightAdjustment || b.avgPnlPct - a.avgPnlPct);
  const penalized = stats
    .filter((s) => s.weightAdjustment < 0)
    .sort((a, b) => a.weightAdjustment - b.weightAdjustment || a.avgPnlPct - b.avgPnlPct);

  const boostedTraits = boosted.slice(0, 4).map((s) => s.label);
  const penalizedTraits = penalized.slice(0, 3).map((s) => s.label);

  if (profile.totalSellsStudied === 0) {
    return {
      activeDirective:
        profile.totalBuysStudied > 0
          ? `Estudiando ${profile.totalBuysStudied} compra(s) abiertas: se calibrarán prioridades de beneficio al cerrar las primeras ventas.`
          : 'Sin operaciones cerradas aún: tras cada compra y venta el bot estudiará qué rasgos comunes generan más beneficio.',
      boostedTraits,
      penalizedTraits,
    };
  }

  if (boosted.length === 0 && penalized.length === 0) {
    const topObserved = [...stats]
      .filter((s) => s.tradesCount >= 1)
      .sort((a, b) => b.avgPnlPct - a.avgPnlPct)[0];
    return {
      activeDirective: topObserved
        ? `Muestra inicial (${profile.totalSellsStudied} venta/s): mejor rendimiento parcial en "${topObserved.label}" (${topObserved.avgPnlPct >= 0 ? '+' : ''}${topObserved.avgPnlPct.toFixed(1)}% prom.). Confirmando con más cierres.`
        : `Muestra inicial (${profile.totalSellsStudied} venta/s): recopilando más cierres para activar sesgos de compra.`,
      boostedTraits,
      penalizedTraits,
    };
  }

  const parts: string[] = [];
  if (boosted[0]) {
    const winPct = Math.round((boosted[0].winsCount / boosted[0].tradesCount) * 100);
    parts.push(
      `Patrón común ganador: "${boosted[0].label}" (${winPct}% acierto, +${boosted[0].avgPnlPct.toFixed(1)}% prom., pico +${boosted[0].avgPeakPnlPct.toFixed(0)}%) -> prioridad +${boosted[0].weightAdjustment} pts`
    );
  }
  if (penalized[0]) {
    parts.push(
      `Evitar rasgo perdedor: "${penalized[0].label}" (${penalized[0].avgPnlPct.toFixed(1)}% prom.) -> penalización ${penalized[0].weightAdjustment} pts`
    );
  }

  return {
    activeDirective: parts.join(' · '),
    boostedTraits,
    penalizedTraits,
  };
}

export function evaluateLearnedBonus(params: {
  pair: TokenPair;
  buyPressurePct: number;
  volumeAcceleration: number;
  higherLowsHolding: boolean;
  scannerMode: ScannerMode;
  profile?: BotLearningProfile;
  enabled: boolean;
}): { bonusPts: number; matchedTraits: string[]; learnedReasons: string[] } {
  const { profile, enabled } = params;
  if (!enabled || !profile || profile.patternStats.length === 0) {
    return { bonusPts: 0, matchedTraits: [], learnedReasons: [] };
  }

  const candidateKeys = [
    `age:${getAgeBucket(params.pair.ageMinutes)}`,
    `liq:${getLiquidityBucket(params.pair.liquidityUsd)}`,
    `buy:${getBuyPressureBucket(params.buyPressurePct)}`,
    `mode:${params.scannerMode}`,
  ];
  if (params.volumeAcceleration >= 1.2) candidateKeys.push('accel:yes');
  if (params.higherLowsHolding) candidateKeys.push('higherlows:yes');

  const statMap = new Map(profile.patternStats.map((s) => [s.key, s]));
  let totalDelta = 0;
  const matchedTraits: string[] = [];
  const learnedReasons: string[] = [];

  for (const key of candidateKeys) {
    const stat = statMap.get(key);
    if (!stat || stat.weightAdjustment === 0) continue;
    totalDelta += stat.weightAdjustment;
    matchedTraits.push(stat.label);
    if (stat.weightAdjustment > 0) {
      learnedReasons.push(
        `Estudio interno favorable (+${stat.weightAdjustment} pts): "${stat.label}" promedia +${stat.avgPnlPct.toFixed(1)}% en ${stat.tradesCount} cierre(s).`
      );
    } else {
      learnedReasons.push(
        `Advertencia de estudio (${stat.weightAdjustment} pts): "${stat.label}" promedia ${stat.avgPnlPct.toFixed(1)}% en ${stat.tradesCount} cierre(s).`
      );
    }
  }

  const bonusPts = Math.max(-15, Math.min(18, totalDelta));
  return { bonusPts, matchedTraits, learnedReasons };
}

export function recordBuyStudy(params: {
  profile: BotLearningProfile;
  pair: TokenPair;
  snapshot: EntryFeatureSnapshot;
  stakeUsd: number;
  mode: 'manual' | 'auto';
  matchedLearnedTraits: string[];
  nowMs?: number;
}): BotLearningProfile {
  const nowMs = params.nowMs ?? Date.now();
  const traitKeys = getTraitKeysFromSnapshot(params.snapshot);
  const keyLabels = traitKeys.map(getTraitLabel);

  // Check common traits across prior buy studies
  const prevBuys = params.profile.recentStudies.filter((s) => s.side === 'BUY').slice(0, 8);
  const freq = new Map<string, number>();
  for (const study of prevBuys) {
    for (const t of study.matchedTraits) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  const commonRepeated = keyLabels.filter((lbl) => (freq.get(lbl) ?? 0) >= 1);

  const commonObservation =
    commonRepeated.length > 0
      ? `Rasgo común repetido en monedas compradas: ${commonRepeated.slice(0, 2).join(' + ')}.`
      : `Perfil de entrada registrado: ${keyLabels.slice(0, 3).join(' · ')}.`;

  const nextActionRule =
    params.matchedLearnedTraits.length > 0
      ? `Entrada reforzada por estudio previo (${params.matchedLearnedTraits[0]}). Vigilando Trailing / SL automático.`
      : `Midiendo evolución de precio desde ${params.snapshot.buyPressurePct.toFixed(0)}% compras (${
          params.snapshot.scannerMode === 'crazy'
            ? 'Crazy 1m'
            : params.snapshot.scannerMode === 'risky'
            ? 'Risky'
            : 'Estricto'
        }) para calibrar futuras compras.`;

  const study: TradeStudyEntry = {
    id: `study_buy_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowMs,
    side: 'BUY',
    symbol: params.pair.baseToken.symbol,
    tokenId: params.pair.id,
    mode: params.mode,
    scannerMode: params.snapshot.scannerMode,
    stakeUsd: params.stakeUsd,
    summary: `Estudio de compra ${params.pair.baseToken.symbol} ($${params.stakeUsd.toFixed(0)} · Score ${params.snapshot.score}/100)`,
    commonObservation,
    nextActionRule,
    matchedTraits: keyLabels,
  };

  const nextProfile: BotLearningProfile = {
    ...params.profile,
    totalBuysStudied: params.profile.totalBuysStudied + 1,
    recentStudies: [study, ...params.profile.recentStudies].slice(0, 40),
  };
  const directiveInfo = rebuildDirective(nextProfile, nextProfile.patternStats);
  return {
    ...nextProfile,
    ...directiveInfo,
  };
}

export function recordSellStudy(params: {
  profile: BotLearningProfile;
  position: Position;
  pnlUsd: number;
  pnlPct: number;
  sellReason: string;
  mode: 'manual' | 'auto';
  nowMs?: number;
}): BotLearningProfile {
  const nowMs = params.nowMs ?? Date.now();
  const isWin = params.pnlUsd > 0;
  const isLoss = params.pnlUsd < 0;
  const peakPnl = Math.max(params.position.peakPnlPct ?? 0, params.pnlPct);

  const fallbackSnap: EntryFeatureSnapshot = params.position.entrySnapshot ?? {
    ageMinutes: 120,
    ageBucket: '1h-5h',
    liquidityUsd: 35_000,
    liquidityBucket: '30k-100k',
    volume5hUsd: 40_000,
    buyPressurePct: 56,
    buyPressureBucket: '55-62%',
    volumeAcceleration: 1.1,
    acceleratingVolume: false,
    higherLowsHolding: true,
    rugRiskLevel: 'MEDIO',
    scannerMode: params.position.scannerMode ?? 'strict',
    score: params.position.analysisScore,
    netExpectedReturnPct: 6,
  };

  const traitKeys = getTraitKeysFromSnapshot(fallbackSnap);
  const statMap = new Map<string, PatternStat>(
    params.profile.patternStats.map((s) => [s.key, { ...s }])
  );

  for (const key of traitKeys) {
    const existing = statMap.get(key) ?? {
      key,
      label: getTraitLabel(key),
      tradesCount: 0,
      winsCount: 0,
      avgPnlPct: 0,
      avgPeakPnlPct: 0,
      totalPnlUsd: 0,
      weightAdjustment: 0,
    };

    const nextCount = existing.tradesCount + 1;
    const nextWins = existing.winsCount + (isWin ? 1 : 0);
    const nextAvgPnl = Number(
      ((existing.avgPnlPct * existing.tradesCount + params.pnlPct) / nextCount).toFixed(2)
    );
    const nextAvgPeak = Number(
      ((existing.avgPeakPnlPct * existing.tradesCount + peakPnl) / nextCount).toFixed(2)
    );
    const nextTotalUsd = Number((existing.totalPnlUsd + params.pnlUsd).toFixed(2));

    const updated: PatternStat = {
      ...existing,
      tradesCount: nextCount,
      winsCount: nextWins,
      avgPnlPct: nextAvgPnl,
      avgPeakPnlPct: nextAvgPeak,
      totalPnlUsd: nextTotalUsd,
      weightAdjustment: 0,
    };
    updated.weightAdjustment = computeWeightAdjustment(updated);
    statMap.set(key, updated);
  }

  const nextStats = Array.from(statMap.values()).sort(
    (a, b) => b.weightAdjustment - a.weightAdjustment || b.avgPnlPct - a.avgPnlPct
  );

  // Pick standout traits from this trade
  const keyLabels = traitKeys.map(getTraitLabel);
  const bestTraitForTrade = nextStats.find((s) => traitKeys.includes(s.key) && s.weightAdjustment > 0);
  const worstTraitForTrade = nextStats.find((s) => traitKeys.includes(s.key) && s.weightAdjustment < 0);

  let commonObservation: string;
  let nextActionRule: string;

  if (isWin) {
    commonObservation = bestTraitForTrade
      ? `Patrón rentable confirmado: "${bestTraitForTrade.label}" alcanza +${bestTraitForTrade.avgPnlPct.toFixed(1)}% medio (${bestTraitForTrade.winsCount}/${bestTraitForTrade.tradesCount} ganadas, pico +${bestTraitForTrade.avgPeakPnlPct.toFixed(0)}%).`
      : `Operación ganadora (+${params.pnlPct.toFixed(1)}%, pico +${peakPnl.toFixed(1)}%): ${keyLabels.slice(0, 2).join(' + ')}.`;
    nextActionRule = bestTraitForTrade
      ? `A partir de ahora se prioriza comprar tokens con "${bestTraitForTrade.label}" (+${bestTraitForTrade.weightAdjustment} pts en escáner).`
      : `Rasgo guardado como positivo; con 2+ cierres similares recibirá prioridad automática.`;
  } else if (!isLoss) {
    commonObservation = `Cierre plano / break-even (${params.pnlPct.toFixed(1)}%): ${params.sellReason}. Rasgos: ${keyLabels.slice(0, 2).join(' + ')}.`;
    nextActionRule = `Sin variación neta de capital; los rasgos quedan en observación para el próximo movimiento.`;
  } else {
    commonObservation = worstTraitForTrade
      ? `Patrón de pérdida detectado: "${worstTraitForTrade.label}" acumula ${worstTraitForTrade.avgPnlPct.toFixed(1)}% medio en ${worstTraitForTrade.tradesCount} cierres.`
      : `Cierre en pérdida (${params.pnlPct.toFixed(1)}%): ${params.sellReason}. Rasgos: ${keyLabels.slice(0, 2).join(' + ')}.`;
    nextActionRule = worstTraitForTrade
      ? `Se reduce prioridad (${worstTraitForTrade.weightAdjustment} pts) a tokens con "${worstTraitForTrade.label}" para proteger capital.`
      : `Stop Loss / salida registrada; si el patrón repite pérdida se bloqueará prioridad en próximas compras.`;
  }

  const study: TradeStudyEntry = {
    id: `study_sell_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowMs,
    side: 'SELL',
    symbol: params.position.symbol,
    tokenId: params.position.tokenId,
    mode: params.mode,
    scannerMode: fallbackSnap.scannerMode,
    stakeUsd: params.position.stakeUsd,
    pnlUsd: params.pnlUsd,
    pnlPct: params.pnlPct,
    peakPnlPct: peakPnl,
    summary: `Estudio de venta ${params.position.symbol} (${params.pnlPct >= 0 ? '+' : ''}${params.pnlPct.toFixed(1)}% · ${params.pnlUsd >= 0 ? '+' : ''}$${params.pnlUsd.toFixed(2)})`,
    commonObservation,
    nextActionRule,
    matchedTraits: keyLabels,
  };

  const nextTotalSells = params.profile.totalSellsStudied + 1;
  const draftProfile: BotLearningProfile = {
    ...params.profile,
    totalSellsStudied: nextTotalSells,
    winsCount: params.profile.winsCount + (isWin ? 1 : 0),
    lossesCount: params.profile.lossesCount + (isLoss ? 1 : 0),
    activeDirective: '',
    boostedTraits: [],
    penalizedTraits: [],
    patternStats: nextStats,
    recentStudies: [study, ...params.profile.recentStudies].slice(0, 40),
  };

  const directiveInfo = rebuildDirective(draftProfile, nextStats);
  return {
    ...draftProfile,
    ...directiveInfo,
  };
}
