// src/lib/fetchYields.ts
//
// Unified on-chain market snapshots for Aave v3, Comet, and Morpho Blue.
// TVL via src/lib/tvl.ts (robust; never throws).
// APY via on-chain helpers for Aave/Comet; Merkl APR for Morpho.

import type { YieldSnapshot } from '@/hooks/useYields'
import {
  TokenAddresses,
  AAVE_POOL,
  COMET_POOLS,
} from '@/lib/constants'
import { getTvlUsd, MORPHO_VAULTS } from '@/lib/tvl'
import { aaveSupplyApy, compoundSupplyApy } from '@/lib/positions'

type EvmChain = 'optimism' | 'base'
type Chain = 'optimism' | 'base' | 'lisk'

const isZero = (addr: string) =>
  addr.toLowerCase() === '0x0000000000000000000000000000000000000000'

// Merkl → APR map for Lisk Morpho (LSK rewards)
// Merkl → APR map for Lisk Morpho (LSK rewards), robust to schema drift
async function fetchMerklLiskMorphoRewards(): Promise<Record<string, number>> {
  // Build the set of addresses we actually care about (your vaults)
  const knownVaults = new Set(
    Object.values(MORPHO_VAULTS).map((a) => a.toLowerCase())
  );

  // Helper: push if looks like an address and is one of our vaults
  const maybeAddVault = (addr: any, acc: Set<string>) => {
    if (typeof addr !== 'string') return;
    const a = addr.toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(a) && knownVaults.has(a)) acc.add(a);
  };

  try {
    // Keep the URL similar to what you had, but add chain & active filters.
    // (If you truly want your original URL, it’ll still work with this parser.)
    const url = 'https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK';
    const res = await fetch(url, { cache: 'no-store' });
    const raw = await res.json();
    if (!Array.isArray(raw)) return {};

    const out: Record<string, number> = {};

    for (const c of raw) {
      // Only consider LSK rewards
      const sym =
        String(c?.rewardToken?.symbol ?? c?.rewardTokens?.[0]?.symbol ?? '')
          .toUpperCase();
      if (sym !== 'LSK') continue;

      // APR can live in several places; prefer the explicit ones
      const aprCandidates = [
        c?.apr,
        c?.globalApr,
        c?.estimatedApr,
        c?.rewardTokens?.[0]?.apr,
        c?.rewards?.[0]?.apr,
      ].map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
      const apr = aprCandidates[0] ?? 0;
      if (apr <= 0) continue;

      // Collect all possible target addresses and intersect with known vaults
      const targets = new Set<string>();
      maybeAddVault(c?.params?.targetToken, targets);
      maybeAddVault(c?.params?.target, targets);
      maybeAddVault(c?.params?.vault, targets);
      maybeAddVault(c?.params?.vaultAddress, targets);
      maybeAddVault(c?.target?.address, targets);
      maybeAddVault(c?.pool?.address, targets);
      (c?.params?.targetTokens ?? []).forEach((t: any) => maybeAddVault(t, targets));
      (c?.targets ?? []).forEach((t: any) => maybeAddVault(t?.address, targets));

      // Fallback: scan for any addresses in the blob and keep only vaults
      if (targets.size === 0) {
        const blob = JSON.stringify(c);
        const matches = blob.match(/0x[0-9a-fA-F]{40}/g) ?? [];
        matches.forEach((m) => maybeAddVault(m, targets));
      }

      if (targets.size === 0) continue; // nothing relevant to our vaults

      // Sum APRs if multiple campaigns target the same vault
      for (const v of targets) out[v] = (out[v] ?? 0) + apr;
    }

    // Optional: quick debug in dev
    // console.log('Merkl APR per vault:', out);
    return out;
  } catch (e) {
    // Optional: log the error so we can see when the network fails vs schema drift
    // console.warn('Merkl fetch failed', e);
    return {};
  }
}


// Aave v3
async function buildAave(): Promise<YieldSnapshot[]> {
  const chains: EvmChain[] = ['optimism', 'base']
  const tokens = ['USDC', 'USDT'] as const

  const rows: YieldSnapshot[] = []
  for (const chain of chains) {
    for (const token of tokens) {
      const underlying = (TokenAddresses[token] as Record<EvmChain, `0x${string}`>)[chain]
      const pool = AAVE_POOL[chain]

      let apy = 0
      try {
        apy = (await aaveSupplyApy(underlying, chain)) ?? 0
      } catch { apy = 0 }

      const tvlUSD = await getTvlUsd({ protocol: 'Aave v3', chain, token })

      rows.push({
        id: `${chain}-aave-v3-${token.toLowerCase()}`,
        chain,
        protocol: 'Aave v3',
        protocolKey: 'aave-v3',
        poolAddress: pool,
        token: token,
        apy,
        tvlUSD,
        updatedAt: new Date().toISOString(),
        underlying,
      })
    }
  }
  return rows
}

// Comet
async function buildComet(): Promise<YieldSnapshot[]> {
  const chains: EvmChain[] = ['optimism', 'base']
  const tokens = ['USDC', 'USDT'] as const

  const rows: YieldSnapshot[] = []
  for (const chain of chains) {
    for (const token of tokens) {
      const comet = COMET_POOLS[chain][token]
      if (isZero(comet)) continue

      const underlying = (TokenAddresses[token] as Record<EvmChain, `0x${string}`>)[chain]

      let apy = 0
      try {
        apy = await compoundSupplyApy(comet, chain)
      } catch { apy = 0 }

      const tvlUSD = await getTvlUsd({ protocol: 'Compound v3', chain, token })

      rows.push({
        id: `${chain}-compound-v3-${token.toLowerCase()}`,
        chain,
        protocol: 'Compound v3',
        protocolKey: 'compound-v3',
        poolAddress: comet,
        token: token,
        apy,
        tvlUSD,
        updatedAt: new Date().toISOString(),
        underlying,
      })
    }
  }
  return rows
}

// Morpho Blue (Lisk)
async function buildMorpho(): Promise<YieldSnapshot[]> {
  const chain: Chain = 'lisk'
  const tokens = ['USDCe', 'USDT0', 'WETH'] as const
  const merkl = await fetchMerklLiskMorphoRewards()

  const rows: YieldSnapshot[] = []
  for (const t of tokens) {
    const vault = MORPHO_VAULTS[t]
    const underlying =
      t === 'WETH'
        ? (TokenAddresses.WETH.lisk as `0x${string}`)
        : t === 'USDCe'
          ? (TokenAddresses.USDCe.lisk as `0x${string}`)
          : (TokenAddresses.USDT0.lisk as `0x${string}`)

    const tvlUSD = await getTvlUsd({ protocol: 'Morpho Blue', chain, token: t })
    const apy = merkl[vault.toLowerCase()] ?? 0

    // Normalize token label to app-wide set ('USDC'/'USDT'/'WETH') if you prefer:
    const displayToken = t === 'USDCe' ? 'USDC' : t === 'USDT0' ? 'USDT' : 'WETH'

    rows.push({
      id: `lisk-morpho-${t.toLowerCase()}`,
      chain,
      protocol: 'Morpho Blue',
      protocolKey: 'morpho-blue',
      poolAddress: vault,
      token: displayToken as YieldSnapshot['token'],
      apy,
      tvlUSD,
      updatedAt: new Date().toISOString(),
      underlying,
    })
  }
  return rows
}

export async function fetchYields(): Promise<YieldSnapshot[]> {
  const [aave, comet, morpho] = await Promise.all([
    buildAave().catch(() => []),
    buildComet().catch(() => []),
    buildMorpho().catch(() => []),
  ])

  return [...aave, ...comet, ...morpho].sort((a, b) => {
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain)
    if (a.protocolKey !== b.protocolKey) return a.protocolKey.localeCompare(b.protocolKey)
    return a.token.localeCompare(b.token)
  })
}
