import {
  analyzeFiveHourMovements,
  buildSynthetic5hCandlesFromPair,
  selectTopVolatileTokens,
} from '../shared/analyzer.ts';
import type {
  AnalyzedToken,
  BotLearningProfile,
  BotSettings,
  Candle5m,
  ChartTimeframe,
  MarketSnapshotResponse,
  PoolTrade,
  TokenLiveDetailResponse,
  TokenPair,
} from '../shared/types.ts';

const FETCH_TIMEOUT_MS = 7500;
const DETAIL_TIMEOUT_MS = 6500;
const SNAPSHOT_CACHE_TTL_MS = 18_000;

let cachedSnapshot: {
  data: MarketSnapshotResponse;
  settingsKey: string;
} | null = null;

// Cache searched tokens so manual buy works seamlessly for any contract found via DexScreener search
const searchedTokenCache = new Map<string, AnalyzedToken>();

// Rate-limit friendly caches for GeckoTerminal OHLCV & live trades
const ohlcvCache = new Map<string, { candles: Candle5m[]; fetchedAt: number }>();
const tradesCache = new Map<
  string,
  { trades: PoolTrade[]; source: 'geckoterminal' | 'geckoterminal-token-pool'; fetchedAt: number }
>();

export function invalidateMarketCache(): void {
  cachedSnapshot = null;
}

export function getCachedTokenById(tokenId: string): AnalyzedToken | undefined {
  const fromSnap = cachedSnapshot?.data.tokens.find((t) => t.token.id === tokenId);
  if (fromSnap) return fromSnap;
  return searchedTokenCache.get(tokenId);
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const isGecko = url.includes('geckoterminal.com');
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: isGecko ? 'application/json;version=20230302' : 'application/json',
        'User-Agent': 'victorinOX/1.0',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface DexScreenerProfileItem {
  chainId?: string;
  tokenAddress?: string;
}

interface DexScreenerPairRaw {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    symbol: string;
  };
  priceUsd?: string;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
  };
}

function normalizeDexScreenerPair(raw: DexScreenerPairRaw, nowMs: number): TokenPair | null {
  if ((raw.chainId || '').toLowerCase() !== 'solana') return null;
  const priceUsd = Number(raw.priceUsd || 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const createdAt = Number(raw.pairCreatedAt || 0);
  const effectiveCreatedAt = createdAt > 0 ? createdAt : nowMs - 24 * 3600_000;

  const ageMs = Math.max(1000, nowMs - effectiveCreatedAt);
  const ageSeconds = Math.max(1, Math.round(ageMs / 1000));
  const ageMinutes = Math.max(0.05, Number((ageMs / 60000).toFixed(2)));
  return {
    id: `solana:${raw.pairAddress}`,
    chainId: 'solana',
    dexId: raw.dexId || 'raydium',
    pairAddress: raw.pairAddress,
    baseToken: {
      address: raw.baseToken?.address || raw.pairAddress,
      name: raw.baseToken?.name || raw.baseToken?.symbol || 'Solana Token',
      symbol: raw.baseToken?.symbol || 'SOLTOK',
    },
    quoteToken: {
      symbol: raw.quoteToken?.symbol || 'SOL',
    },
    priceUsd,
    priceChange: {
      m5: Number(raw.priceChange?.m5 ?? 0),
      h1: Number(raw.priceChange?.h1 ?? 0),
      h6: Number(raw.priceChange?.h6 ?? 0),
      h24: Number(raw.priceChange?.h24 ?? 0),
    },
    volume: {
      m5: Number(raw.volume?.m5 ?? 0),
      h1: Number(raw.volume?.h1 ?? 0),
      h6: Number(raw.volume?.h6 ?? 0),
      h24: Number(raw.volume?.h24 ?? 0),
    },
    txns: {
      m5: { buys: Number(raw.txns?.m5?.buys ?? 0), sells: Number(raw.txns?.m5?.sells ?? 0) },
      h1: { buys: Number(raw.txns?.h1?.buys ?? 0), sells: Number(raw.txns?.h1?.sells ?? 0) },
      h6: { buys: Number(raw.txns?.h6?.buys ?? 0), sells: Number(raw.txns?.h6?.sells ?? 0) },
      h24: { buys: Number(raw.txns?.h24?.buys ?? 0), sells: Number(raw.txns?.h24?.sells ?? 0) },
    },
    liquidityUsd: Number(raw.liquidity?.usd ?? 0),
    fdv: Number(raw.fdv ?? raw.marketCap ?? 0),
    marketCap: Number(raw.marketCap ?? raw.fdv ?? 0),
    pairCreatedAt: effectiveCreatedAt,
    ageMinutes,
    ageSeconds,
    url: raw.url || `https://dexscreener.com/solana/${raw.pairAddress}`,
    imageUrl: raw.info?.imageUrl,
    source: 'dexscreener',
  };
}

interface GeckoNewPoolsResponse {
  data?: Array<{
    id: string;
    attributes: {
      address: string;
      name: string;
      base_token_price_usd?: string;
      pool_created_at?: string;
      fdv_usd?: string;
      market_cap_usd?: string | null;
      reserve_in_usd?: string;
      price_change_percentage?: {
        m5?: string;
        h1?: string;
        h6?: string;
        h24?: string;
      };
      volume_usd?: {
        m5?: string;
        h1?: string;
        h6?: string;
        h24?: string;
      };
      transactions?: {
        m5?: { buys?: number; sells?: number };
        h1?: { buys?: number; sells?: number };
        h6?: { buys?: number; sells?: number };
        h24?: { buys?: number; sells?: number };
      };
    };
    relationships?: {
      dex?: { data?: { id?: string } };
      base_token?: { data?: { id?: string } };
    };
  }>;
}

function normalizeGeckoSolanaPools(res: GeckoNewPoolsResponse | null, nowMs: number): TokenPair[] {
  if (!res?.data) return [];
  const list: TokenPair[] = [];
  for (const item of res.data) {
    const attrs = item.attributes;
    if (!attrs?.pool_created_at || !attrs.base_token_price_usd) continue;
    const priceUsd = Number(attrs.base_token_price_usd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

    const createdMs = Date.parse(attrs.pool_created_at);
    if (!Number.isFinite(createdMs) || createdMs <= 0) continue;

    const pairAddress = attrs.address;
    const nameParts = (attrs.name || 'TOKEN / SOL').split('/').map((s) => s.trim());
    const baseSymbol = nameParts[0] || 'SOLTOK';
    const quoteSymbol = nameParts[1] || 'SOL';
    const rawBaseId = item.relationships?.base_token?.data?.id || '';
    const baseAddress = rawBaseId.includes('_') ? rawBaseId.split('_').slice(1).join('_') : pairAddress;

    list.push({
      id: `solana:${pairAddress}`,
      chainId: 'solana',
      dexId: item.relationships?.dex?.data?.id || 'raydium',
      pairAddress,
      baseToken: {
        address: baseAddress,
        name: baseSymbol,
        symbol: baseSymbol,
      },
      quoteToken: { symbol: quoteSymbol },
      priceUsd,
      priceChange: {
        m5: Number(attrs.price_change_percentage?.m5 ?? 0),
        h1: Number(attrs.price_change_percentage?.h1 ?? 0),
        h6: Number(attrs.price_change_percentage?.h6 ?? 0),
        h24: Number(attrs.price_change_percentage?.h24 ?? 0),
      },
      volume: {
        m5: Number(attrs.volume_usd?.m5 ?? 0),
        h1: Number(attrs.volume_usd?.h1 ?? 0),
        h6: Number(attrs.volume_usd?.h6 ?? 0),
        h24: Number(attrs.volume_usd?.h24 ?? 0),
      },
      txns: {
        m5: {
          buys: Number(attrs.transactions?.m5?.buys ?? 0),
          sells: Number(attrs.transactions?.m5?.sells ?? 0),
        },
        h1: {
          buys: Number(attrs.transactions?.h1?.buys ?? 0),
          sells: Number(attrs.transactions?.h1?.sells ?? 0),
        },
        h6: {
          buys: Number(attrs.transactions?.h6?.buys ?? 0),
          sells: Number(attrs.transactions?.h6?.sells ?? 0),
        },
        h24: {
          buys: Number(attrs.transactions?.h24?.buys ?? 0),
          sells: Number(attrs.transactions?.h24?.sells ?? 0),
        },
      },
      liquidityUsd: Number(attrs.reserve_in_usd ?? 0),
      fdv: Number(attrs.fdv_usd ?? 0),
      marketCap: Number(attrs.market_cap_usd ?? attrs.fdv_usd ?? 0),
      pairCreatedAt: createdMs,
      ageMinutes: Math.max(0.05, Number((Math.max(1000, nowMs - createdMs) / 60000).toFixed(2))),
      ageSeconds: Math.max(1, Math.round(Math.max(1000, nowMs - createdMs) / 1000)),
      url: `https://dexscreener.com/solana/${pairAddress}`,
      source: 'geckoterminal',
    });
  }
  return list;
}

async function fetchDexScreenerSolanaPairs(nowMs: number): Promise<TokenPair[]> {
  const [profiles, boosts] = await Promise.all([
    fetchJsonWithTimeout<DexScreenerProfileItem[]>(
      'https://api.dexscreener.com/token-profiles/latest/v1',
      FETCH_TIMEOUT_MS
    ),
    fetchJsonWithTimeout<DexScreenerProfileItem[]>(
      'https://api.dexscreener.com/token-boosts/latest/v1',
      FETCH_TIMEOUT_MS
    ),
  ]);

  const combined = [...(Array.isArray(profiles) ? profiles : []), ...(Array.isArray(boosts) ? boosts : [])];
  const uniqueSolanaAddrs: string[] = [];
  const seen = new Set<string>();
  for (const item of combined) {
    if ((item?.chainId || '').toLowerCase() !== 'solana') continue;
    if (item?.tokenAddress && !seen.has(item.tokenAddress)) {
      seen.add(item.tokenAddress);
      uniqueSolanaAddrs.push(item.tokenAddress);
    }
    if (uniqueSolanaAddrs.length >= 60) break;
  }

  if (uniqueSolanaAddrs.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueSolanaAddrs.length; i += 25) {
    chunks.push(uniqueSolanaAddrs.slice(i, i + 25));
  }

  const pairResponses = await Promise.all(
    chunks.map((chunk) =>
      fetchJsonWithTimeout<{ pairs?: DexScreenerPairRaw[] }>(
        `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
        FETCH_TIMEOUT_MS
      )
    )
  );

  const pairs: TokenPair[] = [];
  for (const resp of pairResponses) {
    if (!resp?.pairs) continue;
    for (const raw of resp.pairs) {
      const normalized = normalizeDexScreenerPair(raw, nowMs);
      if (normalized) pairs.push(normalized);
    }
  }
  return pairs;
}

function getGeckoOhlcvParams(tf: ChartTimeframe = '5h'): { aggregate: number; limit: number } {
  switch (tf) {
    case '15m':
      return { aggregate: 1, limit: 30 };
    case '1h':
      return { aggregate: 1, limit: 60 };
    case '5h':
      return { aggregate: 5, limit: 60 };
    case '10h':
      return { aggregate: 15, limit: 40 };
    case '24h':
      return { aggregate: 15, limit: 96 };
    default:
      return { aggregate: 5, limit: 60 };
  }
}

async function fetchSolana5hCandlesFromGecko(
  pairAddress: string,
  chartTimeframe: ChartTimeframe = '5h'
): Promise<Candle5m[]> {
  const cacheKey = `${pairAddress}:${chartTimeframe}`;
  const cached = ohlcvCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 20_000) {
    return cached.candles;
  }

  const { aggregate, limit } = getGeckoOhlcvParams(chartTimeframe);
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}/ohlcv/minute?aggregate=${aggregate}&limit=${limit}&currency=usd`;
  const res = await fetchJsonWithTimeout<{
    data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
  }>(url, DETAIL_TIMEOUT_MS);

  const list = res?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length === 0) return cached?.candles ?? [];

  const candles = list
    .map(([tsSec, open, high, low, close, volumeUsd]) => ({
      timestamp: tsSec * 1000,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volumeUsd: Number(volumeUsd),
    }))
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (candles.length > 0) {
    ohlcvCache.set(cacheKey, { candles, fetchedAt: Date.now() });
  }
  return candles;
}

interface GeckoPoolTradesResponse {
  data?: Array<{
    id: string;
    attributes: {
      tx_hash: string;
      kind: 'buy' | 'sell';
      block_timestamp: string;
      volume_in_usd?: string;
      from_token_amount?: string;
      to_token_amount?: string;
      price_to_in_usd?: string;
      price_from_in_usd?: string;
      tx_from_address?: string;
    };
  }>;
}

function normalizeGeckoTrades(res: GeckoPoolTradesResponse | null): PoolTrade[] {
  if (!Array.isArray(res?.data) || res.data.length === 0) return [];
  return res.data
    .slice(0, 40)
    .map((item) => {
      const a = item.attributes;
      const ts = Date.parse(a.block_timestamp);
      const priceFrom = Number(a.price_from_in_usd || 0);
      const priceTo = Number(a.price_to_in_usd || 0);
      const price = a.kind === 'buy' ? priceTo || priceFrom : priceFrom || priceTo;
      let volumeUsd = Number(a.volume_in_usd || 0);
      if (!Number.isFinite(volumeUsd) || volumeUsd <= 0) {
        const amt = Number(a.from_token_amount || 0);
        if (amt > 0 && priceFrom > 0) {
          volumeUsd = amt * priceFrom;
        }
      }
      return {
        id: item.id || a.tx_hash,
        txHash: a.tx_hash,
        type: a.kind === 'sell' ? ('sell' as const) : ('buy' as const),
        priceUsd: Number.isFinite(price) ? price : 0,
        volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : 0,
        timestamp: Number.isFinite(ts) ? ts : Date.now(),
        maker: a.tx_from_address || 'SolanaWallet',
      };
    })
    .filter((t) => t.volumeUsd > 0 || t.priceUsd > 0)
    .sort((a, b) => b.timestamp - a.timestamp);
}

async function fetchSolanaPoolRecentTrades(
  pairAddress: string,
  baseTokenAddress?: string
): Promise<{ trades: PoolTrade[]; source: 'geckoterminal' | 'geckoterminal-token-pool' | 'summary' }> {
  const cached = tradesCache.get(pairAddress);
  if (cached && Date.now() - cached.fetchedAt < 6_000) {
    return { trades: cached.trades, source: cached.source };
  }

  const directUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}/trades?trade_volume_in_usd_greater_than=0`;
  const directRes = await fetchJsonWithTimeout<GeckoPoolTradesResponse>(directUrl, DETAIL_TIMEOUT_MS);
  const directTrades = normalizeGeckoTrades(directRes);
  if (directTrades.length > 0) {
    tradesCache.set(pairAddress, {
      trades: directTrades,
      source: 'geckoterminal',
      fetchedAt: Date.now(),
    });
    return { trades: directTrades, source: 'geckoterminal' };
  }

  // Fallback: discover GeckoTerminal pool via token mint address if DexScreener pairAddress differs
  if (baseTokenAddress && baseTokenAddress !== pairAddress) {
    const poolsUrl = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${baseTokenAddress}/pools?page=1`;
    const poolsRes = await fetchJsonWithTimeout<GeckoNewPoolsResponse>(poolsUrl, DETAIL_TIMEOUT_MS);
    const altPoolAddr = poolsRes?.data?.find(
      (p) => p.attributes?.address && p.attributes.address !== pairAddress
    )?.attributes?.address;

    if (altPoolAddr) {
      const altUrl = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${altPoolAddr}/trades?trade_volume_in_usd_greater_than=0`;
      const altRes = await fetchJsonWithTimeout<GeckoPoolTradesResponse>(altUrl, DETAIL_TIMEOUT_MS);
      const altTrades = normalizeGeckoTrades(altRes);
      if (altTrades.length > 0) {
        tradesCache.set(pairAddress, {
          trades: altTrades,
          source: 'geckoterminal-token-pool',
          fetchedAt: Date.now(),
        });
        return { trades: altTrades, source: 'geckoterminal-token-pool' };
      }
    }
  }

  // Return recently cached tape on transient 429 rate-limit instead of wiping live flow blank
  if (cached && Date.now() - cached.fetchedAt < 60_000) {
    return { trades: cached.trades, source: cached.source };
  }

  return { trades: [], source: 'summary' };
}

export async function fetchTop10VolatileSnapshot(
  settings: BotSettings,
  forceRefresh = false,
  learningProfile?: BotLearningProfile
): Promise<MarketSnapshotResponse> {
  const nowMs = Date.now();
  const chartTimeframe = settings.chartTimeframe || '5h';
  const settingsKey = JSON.stringify({
    scannerMode: settings.scannerMode,
    scannerTimeframe: settings.scannerTimeframe || '24h',
    chartTimeframe,
    scannerSortBy: settings.scannerSortBy || 'score',
    riskyMinScorePct: settings.riskyMinScorePct,
    riskyMinLiquidityUsd: settings.riskyMinLiquidityUsd,
    riskyMinAgeMinutes: settings.riskyMinAgeMinutes,
    riskyAllowHighRugRisk: settings.riskyAllowHighRugRisk,
    crazyTakeProfitPct: settings.crazyTakeProfitPct,
    crazyStopLossPct: settings.crazyStopLossPct,
    crazyMaxHoldSeconds: settings.crazyMaxHoldSeconds,
    crazyMinLiquidityUsd: settings.crazyMinLiquidityUsd,
    adaptiveLearningEnabled: settings.adaptiveLearningEnabled,
    feeProfile: settings.feeProfile,
    learnedSells: learningProfile?.totalSellsStudied ?? 0,
    maxAgeHours: settings.maxAgeHours,
    displayLimit: settings.displayLimit,
    minLiquidityUsd: settings.minLiquidityUsd,
    minVolume5hUsd: settings.minVolume5hUsd,
    minTxnsCount: settings.minTxnsCount,
    minBuyRatio: settings.minBuyRatio,
    minVolatilityPct: settings.minVolatilityPct,
    minExpectedProfitPct: settings.minExpectedProfitPct,
    botMinStakeUsd: settings.botMinStakeUsd,
    botMaxStakeUsd: settings.botMaxStakeUsd,
    defaultTakeProfitPct: settings.defaultTakeProfitPct,
    defaultStopLossPct: settings.defaultStopLossPct,
  });

  if (
    !forceRefresh &&
    cachedSnapshot &&
    cachedSnapshot.settingsKey === settingsKey &&
    nowMs - cachedSnapshot.data.fetchedAt < SNAPSHOT_CACHE_TTL_MS
  ) {
    return cachedSnapshot.data;
  }

  const [dexSolanaPairs, geckoNew1, geckoNew2, geckoTrend1, geckoTrend2] = await Promise.all([
    fetchDexScreenerSolanaPairs(nowMs),
    fetchJsonWithTimeout<GeckoNewPoolsResponse>(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
      FETCH_TIMEOUT_MS
    ),
    fetchJsonWithTimeout<GeckoNewPoolsResponse>(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=2',
      FETCH_TIMEOUT_MS
    ),
    fetchJsonWithTimeout<GeckoNewPoolsResponse>(
      'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1',
      FETCH_TIMEOUT_MS
    ),
    settings.maxAgeHours <= 0 || settings.maxAgeHours > 24
      ? fetchJsonWithTimeout<GeckoNewPoolsResponse>(
          'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=2',
          FETCH_TIMEOUT_MS
        )
      : Promise.resolve(null),
  ]);

  const combinedPairs = [
    ...dexSolanaPairs,
    ...normalizeGeckoSolanaPools(geckoNew1, nowMs),
    ...normalizeGeckoSolanaPools(geckoNew2, nowMs),
    ...normalizeGeckoSolanaPools(geckoTrend1, nowMs),
    ...normalizeGeckoSolanaPools(geckoTrend2, nowMs),
  ];

  const limit = settings.displayLimit || 25;
  const topList = selectTopVolatileTokens(combinedPairs, nowMs, settings.maxAgeHours, true, limit);

  const windowLabel =
    settings.maxAgeHours <= 0
      ? 'todos los plazos'
      : settings.maxAgeHours < 1
      ? `últimos ${Math.max(1, Math.round(settings.maxAgeHours * 60))}m`
      : settings.maxAgeHours >= 240
      ? 'últimos 10 días'
      : `últimas ${settings.maxAgeHours}h`;

  let sourceStatus: MarketSnapshotResponse['sourceStatus'] = 'live';
  let sourceMessage = `Solo Solana · Datos reales en vivo (DexScreener + GeckoTerminal, ${windowLabel})`;

  if (topList.length === 0) {
    sourceStatus = 'fallback';
    sourceMessage = `Sin pares activos en Solana (${windowLabel}). Prueba ampliar la ventana o reintentar.`;
  } else if (dexSolanaPairs.length === 0) {
    sourceStatus = 'partial';
    sourceMessage = `Solo Solana · Datos reales vía GeckoTerminal (${windowLabel})`;
  }

  // Fetch OHLCV for top 8 pools cleanly to avoid exhausting GeckoTerminal rate limit for live trade tape
  const candlesList: Candle5m[][] = [];
  for (let i = 0; i < topList.length; i += 4) {
    const batch = topList.slice(i, i + 4);
    const batchCandles = await Promise.all(
      batch.map(async (pair, batchIdx) => {
        const globalIdx = i + batchIdx;
        if (globalIdx < 8) {
          const geckoCandles = await fetchSolana5hCandlesFromGecko(pair.pairAddress, chartTimeframe);
          if (geckoCandles.length >= 3) return geckoCandles;
        }
        return buildSynthetic5hCandlesFromPair(pair, nowMs);
      })
    );
    candlesList.push(...batchCandles);
  }

  const analyzed: AnalyzedToken[] = topList.map((token, idx) => ({
    token,
    analysis: analyzeFiveHourMovements(token, candlesList[idx], settings, nowMs, learningProfile),
  }));

  const sortBy = settings.scannerSortBy || 'score';
  analyzed.sort((a, b) => {
    if (sortBy === 'liquidity') return b.token.liquidityUsd - a.token.liquidityUsd;
    if (sortBy === 'volume') return b.token.volume.h6 - a.token.volume.h6;
    if (sortBy === 'momentum1h') return b.token.priceChange.h1 - a.token.priceChange.h1;
    if (sortBy === 'newest') return a.token.ageMinutes - b.token.ageMinutes;
    return b.analysis.aptitudePct - a.analysis.aptitudePct || b.analysis.score - a.analysis.score;
  });

  const snapshot: MarketSnapshotResponse = {
    tokens: analyzed,
    fetchedAt: nowMs,
    sourceStatus,
    sourceMessage,
  };

  cachedSnapshot = {
    data: snapshot,
    settingsKey,
  };

  return snapshot;
}

/**
 * Searches DexScreener by Solana contract address, pair address, or token symbol/name.
 */
export async function searchSolanaTokensDexScreener(
  rawQuery: string,
  settings: BotSettings,
  learningProfile?: BotLearningProfile
): Promise<AnalyzedToken[]> {
  const q = rawQuery.trim();
  if (!q) return [];
  const nowMs = Date.now();

  const looksLikeAddress = /^[1-9A-HJ-NP-Za-km-z]{30,50}$/.test(q);
  const requests: Array<Promise<{ pairs?: DexScreenerPairRaw[]; pair?: DexScreenerPairRaw } | null>> = [
    fetchJsonWithTimeout<{ pairs?: DexScreenerPairRaw[] }>(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      FETCH_TIMEOUT_MS
    ),
  ];

  if (looksLikeAddress) {
    requests.push(
      fetchJsonWithTimeout<{ pairs?: DexScreenerPairRaw[] }>(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`,
        FETCH_TIMEOUT_MS
      ),
      fetchJsonWithTimeout<{ pairs?: DexScreenerPairRaw[]; pair?: DexScreenerPairRaw }>(
        `https://api.dexscreener.com/latest/dex/pairs/solana/${encodeURIComponent(q)}`,
        FETCH_TIMEOUT_MS
      )
    );
  }

  const responses = await Promise.all(requests);
  const rawPairs: DexScreenerPairRaw[] = [];
  for (const res of responses) {
    if (!res) continue;
    if (res.pair) rawPairs.push(res.pair);
    if (Array.isArray(res.pairs)) rawPairs.push(...res.pairs);
  }

  const byPair = new Map<string, TokenPair>();
  for (const raw of rawPairs) {
    const normalized = normalizeDexScreenerPair(raw, nowMs);
    if (!normalized) continue;
    if (!byPair.has(normalized.id)) {
      byPair.set(normalized.id, normalized);
    }
  }

  const sorted = Array.from(byPair.values())
    .sort((a, b) => b.liquidityUsd + b.volume.h24 - (a.liquidityUsd + a.volume.h24))
    .slice(0, 12);

  // Relax age check temporarily for explicit contract search so any searched token is analyzed
  const searchSettings: BotSettings = {
    ...settings,
    maxAgeHours: Math.max(settings.maxAgeHours, 24000),
  };

  const chartTimeframe = settings.chartTimeframe || '5h';
  const results = await Promise.all(
    sorted.map(async (token, idx) => {
      const candles =
        idx < 5 ? await fetchSolana5hCandlesFromGecko(token.pairAddress, chartTimeframe) : [];
      const effectiveCandles =
        candles.length >= 3 ? candles : buildSynthetic5hCandlesFromPair(token, nowMs);
      const analysis = analyzeFiveHourMovements(
        token,
        effectiveCandles,
        searchSettings,
        nowMs,
        learningProfile
      );
      const item: AnalyzedToken = { token, analysis };
      searchedTokenCache.set(token.id, item);
      return item;
    })
  );

  return results;
}

export async function fetchSolanaPoolLiveDetail(
  pairAddress: string,
  settings: BotSettings,
  learningProfile?: BotLearningProfile
): Promise<TokenLiveDetailResponse | null> {
  const nowMs = Date.now();
  const chartTimeframe = settings.chartTimeframe || '5h';

  const dexResp = await fetchJsonWithTimeout<{ pair?: DexScreenerPairRaw; pairs?: DexScreenerPairRaw[] }>(
    `https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`,
    DETAIL_TIMEOUT_MS
  );

  const rawPair = dexResp?.pair || dexResp?.pairs?.[0];
  let pair: TokenPair | null = rawPair ? normalizeDexScreenerPair(rawPair, nowMs) : null;

  if (!pair && cachedSnapshot) {
    pair = cachedSnapshot.data.tokens.find((t) => t.token.pairAddress === pairAddress)?.token ?? null;
  }
  if (!pair) {
    pair = searchedTokenCache.get(`solana:${pairAddress}`)?.token ?? null;
  }

  if (!pair) return null;

  const [candles, tradesPayload] = await Promise.all([
    fetchSolana5hCandlesFromGecko(pairAddress, chartTimeframe),
    fetchSolanaPoolRecentTrades(pairAddress, pair.baseToken.address),
  ]);

  const effectiveCandles =
    candles.length >= 3 ? candles : buildSynthetic5hCandlesFromPair(pair, nowMs);
  const analysis = analyzeFiveHourMovements(pair, effectiveCandles, settings, nowMs, learningProfile);

  return {
    token: pair,
    analysis,
    recentTrades: tradesPayload.trades,
    tradesSource: tradesPayload.source,
    chartTimeframe,
    fetchedAt: nowMs,
  };
}

export async function fetchLivePricesForPairs(
  pairs: Array<{ chainId: string; pairAddress: string }>
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (pairs.length === 0) return prices;

  const solanaPairs = pairs.filter((p) => p.chainId.toLowerCase() === 'solana');
  await Promise.all(
    solanaPairs.slice(0, 15).map(async (p) => {
      const data = await fetchJsonWithTimeout<{ pair?: DexScreenerPairRaw; pairs?: DexScreenerPairRaw[] }>(
        `https://api.dexscreener.com/latest/dex/pairs/solana/${p.pairAddress}`,
        4000
      );
      const raw = data?.pair || data?.pairs?.[0];
      const price = Number(raw?.priceUsd || 0);
      if (Number.isFinite(price) && price > 0) {
        prices.set(`solana:${p.pairAddress}`, price);
      }
    })
  );

  return prices;
}
