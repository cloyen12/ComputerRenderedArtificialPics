export function formatUsd(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

export function formatTokenPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '$0.00';
  if (price >= 1) return `$${price.toFixed(3)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(3)}`;
}

export function formatSignedPct(pct: number): string {
  const safe = Number.isFinite(pct) ? pct : 0;
  const sign = safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(1)}%`;
}

export function formatAge(ageMinutes: number, ageSeconds?: number): string {
  if (ageSeconds !== undefined && ageSeconds < 60) return `${Math.max(1, ageSeconds)}s`;
  if (ageMinutes < 1) return `${Math.max(1, Math.round(ageMinutes * 60))}s`;
  const roundedMin = Math.round(ageMinutes);
  if (roundedMin < 60) return `${Math.max(1, roundedMin)}m`;
  const h = Math.floor(roundedMin / 60);
  const m = roundedMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatCountdown(targetMs: number | null, nowMs: number): string {
  if (!targetMs) return 'Pausado';
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatTimeShort(tsMs: number): string {
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(tsMs));
}

export function formatChainLabel(chainId: string): string {
  const map: Record<string, string> = {
    solana: 'SOL',
    ethereum: 'ETH',
    base: 'BASE',
    bsc: 'BSC',
    arbitrum: 'ARB',
    polygon: 'POL',
    avalanche: 'AVAX',
    optimism: 'OP',
    ton: 'TON',
    sui: 'SUI',
  };
  return map[chainId.toLowerCase()] || chainId.toUpperCase().slice(0, 5);
}
