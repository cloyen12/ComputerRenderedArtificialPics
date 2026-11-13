import { VersionedTransaction } from '@solana/web3.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const RPC_STORAGE_KEY = 'victorinox_local_rpc_v1';

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string; toString(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(
    transaction: VersionedTransaction,
    options?: { skipPreflight?: boolean; maxRetries?: number }
  ): Promise<{ signature: string }>;
  on(event: 'connect' | 'disconnect' | 'accountChanged', handler: (arg?: unknown) => void): void;
  off?(event: 'connect' | 'disconnect' | 'accountChanged', handler: (arg?: unknown) => void): void;
}

export interface PhantomBalances {
  publicKey: string;
  solBalance: number;
  usdcBalance: number;
  solPriceUsd: number;
  totalUsd: number;
  rpcUsed: string;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan?: Array<{ swapInfo?: { label?: string } }>;
}

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  };
  if (win.phantom?.solana?.isPhantom) return win.phantom.solana;
  if (win.solana?.isPhantom) return win.solana;
  return null;
}

export function isPhantomInstalled(): boolean {
  return getPhantomProvider() !== null;
}

export function getSavedRpcUrl(): string {
  try {
    return localStorage.getItem(RPC_STORAGE_KEY) || DEFAULT_SOLANA_RPC;
  } catch {
    return DEFAULT_SOLANA_RPC;
  }
}

export function saveRpcUrl(url: string): string {
  const clean = url.trim() || DEFAULT_SOLANA_RPC;
  try {
    localStorage.setItem(RPC_STORAGE_KEY, clean);
  } catch {
    // Ignore storage errors
  }
  return clean;
}

export function shortenAddress(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

export async function connectPhantomWallet(onlyIfTrusted = false): Promise<string> {
  const provider = getPhantomProvider();
  if (!provider) {
    throw new Error(
      'Extensión Phantom no detectada. Abre victorinOX en Chrome/Brave local con Phantom instalado.'
    );
  }
  const resp = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
  return resp.publicKey.toBase58();
}

export async function disconnectPhantomWallet(): Promise<void> {
  const provider = getPhantomProvider();
  if (provider) {
    await provider.disconnect();
  }
}

export async function fetchPhantomBalances(
  publicKey: string,
  rpcUrl?: string
): Promise<PhantomBalances> {
  const params = new URLSearchParams();
  if (rpcUrl?.trim()) params.set('rpc', rpcUrl.trim());
  const res = await fetch(
    `/api/phantom/balance/${encodeURIComponent(publicKey)}?${params.toString()}`
  );
  const data = (await res.json()) as PhantomBalances & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo consultar el saldo en Solana RPC.');
  }
  return data;
}

export async function fetchJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
}): Promise<JupiterQuoteResponse> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amountAtomic,
    slippageBps: String(params.slippageBps),
  });
  const res = await fetch(`/api/phantom/quote?${qs.toString()}`);
  const data = (await res.json()) as JupiterQuoteResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Error al obtener cotización en Jupiter.');
  }
  return data;
}

export async function executePhantomJupiterSwap(params: {
  userPublicKey: string;
  quoteResponse: JupiterQuoteResponse;
  priorityFeeLamports?: number;
}): Promise<{ signature: string }> {
  const provider = getPhantomProvider();
  if (!provider) {
    throw new Error('Conecta tu billetera Phantom local antes de firmar.');
  }
  const res = await fetch('/api/phantom/swap-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userPublicKey: params.userPublicKey,
      quoteResponse: params.quoteResponse,
      priorityFeeLamports: params.priorityFeeLamports ?? 100_000,
    }),
  });
  const data = (await res.json()) as { swapTransaction?: string; error?: string };
  if (!res.ok || !data.swapTransaction) {
    throw new Error(data.error || 'No se pudo construir la transacción en Jupiter.');
  }

  const binary = atob(data.swapTransaction);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const tx = VersionedTransaction.deserialize(bytes);
  return provider.signAndSendTransaction(tx);
}
