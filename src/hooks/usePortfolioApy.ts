/* src/hooks/usePortfolioApy.ts */

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { usePositions } from '@/hooks/usePositions'
import { useYields } from '@/hooks/useYields'
import { fetchApy } from '@/lib/fetchApy'
import type { Position } from '@/lib/positions'

/** Decimals per protocol/token
 *  - Aave v3      : 8  (base units)
 *  - Compound v3  : 6  (USDC/USDT)
 *  - Morpho Blue  : token-based on Lisk (WETH=18, stables=6)
 */
function decimalsFor(p: Position): number {
  if (p.protocol === 'Aave v3') return 8
  if (p.protocol === 'Compound v3') return 6
  // Morpho Blue on Lisk
  return p.token === 'WETH' ? 18 : 6
}

/** Treat these as $1 for naive portfolio USD weighting */
function isStableOnAnyChain(t: Position['token']) {
  return t === 'USDC' || t === 'USDT' || t === 'USDCe' || t === 'USDT0'
}

/** Narrow Position -> valid fetchApy input (Aave/Compound on OP/Base, USDC/USDT only) */
function isAcInput(
  p: Position,
): p is Position & {
  protocol: 'Aave v3' | 'Compound v3'
  chain: 'optimism' | 'base'
  token: 'USDC' | 'USDT'
} {
  const protoOk = p.protocol === 'Aave v3' || p.protocol === 'Compound v3'
  const chainOk = p.chain === 'optimism' || p.chain === 'base'
  const tokenOk = p.token === 'USDC' || p.token === 'USDT'
  return protoOk && chainOk && tokenOk
}

/** Build a lookup from Morpho Blue (Lisk) snapshots: token -> apy */
function morphoLookupFromYields(yields: ReturnType<typeof useYields>['yields']) {
  const map = new Map<string, number>()
  if (!yields) return map
  for (const y of yields) {
    if (y.protocolKey !== 'morpho-blue' || y.chain !== 'lisk') continue
    // y.token is 'USDC' | 'USDT' | 'WETH'
    map.set(y.token, y.apy ?? 0)
  }
  return map
}

export function usePortfolioApy() {
  const { data: positions } = usePositions()
  const { yields } = useYields() // contains Morpho Blue APRs on Lisk

  // Only query APY for Aave/Compound positions that match fetchApy's input contract
  const acInputs =
    positions?.filter(isAcInput) ?? []

  // Spin up one query per Aave/Compound position
  const apyQueries = useQueries({
    queries: acInputs.map((p) => ({
      queryKey: ['apy', p.protocol, p.chain, p.token],
      queryFn: () =>
        fetchApy({
          protocol: p.protocol,
          chain: p.chain,
          token: p.token,
        }),
      enabled: true,
      staleTime: 60_000,
    })),
  })

  // Morpho Blue APY lookup
  const morphoApyLookup = useMemo(() => morphoLookupFromYields(yields), [yields])

  // Balance-weighted average APY (+ totals)
  return useMemo(() => {
    if (!positions) return { loading: true, apy: 0, totalUsd: 0 }

    // For each position, record an APY if we have it (Aave/Compound from queries; Morpho from snapshots)
    const apyPerIndex: Array<number | undefined> = Array(positions.length).fill(undefined)

    // Fill Aave/Compound results: align acInputs[i] back to its index in positions
    acInputs.forEach((p, i) => {
      const idx = positions.indexOf(p)
      const v = apyQueries[i]?.data as number | undefined
      if (idx >= 0 && typeof v === 'number') apyPerIndex[idx] = v
    })

    // Fill Morpho results from snapshots
    positions.forEach((p, idx) => {
      if (p.protocol !== 'Morpho Blue') return
      // snapshots use base symbol names for Lisk morpho: USDC, USDT, WETH
      const key = p.token === 'USDCe' ? 'USDC' : p.token === 'USDT0' ? 'USDT' : p.token
      const v = morphoApyLookup.get(key)
      if (typeof v === 'number') apyPerIndex[idx] = v
    })

    let totalUsd = 0
    let weighted = 0

    positions.forEach((pos, idx) => {
      const apy = apyPerIndex[idx]
      if (apy == null) return // skip not-yet-loaded or unsupported

      const dec = decimalsFor(pos)

      // For portfolio USD weighting, only count stablecoins (1:1)
      if (isStableOnAnyChain(pos.token)) {
        const usd = Number(pos.amount) / 10 ** dec
        totalUsd += usd
        weighted += usd * apy
      }
    })

    return {
      loading: apyQueries.some((q) => q.isLoading),
      apy: totalUsd ? weighted / totalUsd : 0,
      totalUsd,
    }
  }, [positions, acInputs, apyQueries, morphoApyLookup])
}
