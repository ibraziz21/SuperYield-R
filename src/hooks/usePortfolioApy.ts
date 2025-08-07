/* src/hooks/usePortfolioApy.ts */
import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { usePositions } from '@/hooks/usePositions'
import { fetchApy } from '@/lib/fetchApy'

const DECIMALS = { 'Aave v3': 8, 'Compound v3': 6 } as const

export function usePortfolioApy() {
  const { data: positions } = usePositions()

  // 1️⃣ spin up one query per position
  const apyQueries = useQueries({
    queries:
      positions?.map((p) => ({
        queryKey: ['apy', p.protocol, p.chain, p.token],
        queryFn:  () => fetchApy(p),
        enabled:  Boolean(positions),
        staleTime: 60_000,
      })) ?? [],
  })

  // 2️⃣ balance-weighted average once all data ready
  return useMemo(() => {
    if (!positions) return { loading: true, apy: 0 }

    let totalUsd = 0
    let weighted = 0

    positions.forEach((pos, idx) => {
      const apy = apyQueries[idx]?.data
      if (apy == undefined) return            // still loading / errored

      const dec = DECIMALS[pos.protocol]
      const usd = Number(pos.amount) / 10 ** dec   // USDC/USDT ≈ 1 USD
      totalUsd += usd
      weighted += usd * apy
    })

    return {
      loading: apyQueries.some((q) => q.isLoading),
      apy: totalUsd ? weighted / totalUsd : 0,
      totalUsd,
    }
  }, [positions, apyQueries])
}
