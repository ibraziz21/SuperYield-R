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

type EvmChain = 'optimism' 
type Chain = 'optimism' | 'lisk'

const isZero = (addr: string) =>
  addr.toLowerCase() === '0x0000000000000000000000000000000000000000'

// Merkl → APR map for Lisk Morpho (LSK rewards)
async function fetchMerklLiskMorphoRewards(): Promise<Record<string, number>> {
  try {
    const res = await fetch(
      'https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK',
      { cache: 'no-store' },
    )
    const raw = await res.json()
    if (!Array.isArray(raw)) return {}
    const m: Record<string, number> = {}
    for (const it of raw) {
      if (!it || typeof it !== 'object') continue
      const r = (it as any).rewardToken
      const params = (it as any).params
      const apr = (it as any).apr
      if (r?.symbol === 'LSK' && typeof params?.targetToken === 'string' && typeof apr === 'number') {
        m[params.targetToken.toLowerCase()] = apr
      }
    }
    return m
  } catch {
    return {}
  }
}

// Aave v3
async function buildAave(): Promise<YieldSnapshot[]> {
  const chains: EvmChain[] = ['optimism']
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
  const chains: EvmChain[] = ['optimism']
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
