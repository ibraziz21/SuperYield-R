/* src/hooks/useAaveAccounts.ts */
'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWalletClient } from 'wagmi'

import { fetchPositions, type Position } from '@/lib/positions'

export type AaveAccount = {
  chain: 'optimism' | 'base'
  /** Sum of Aave supplied balances on this chain (aToken/underlying units: USDC/USDT = 1e6) */
  supplied: bigint
  /** We’re not fetching per-user debt right now – keep as 0 for compatibility */
  debt: bigint
}

function toAaveAccounts(positions: Position[]): AaveAccount[] {
  const sums: Record<'optimism' | 'base', bigint> = {
    optimism: BigInt(0),
    base: BigInt(0),
  }

  for (const p of positions) {
    if (p.protocol !== 'Aave v3') continue
    if (p.chain === 'optimism' || p.chain === 'base') {
      sums[p.chain] += p.amount // amount already in underlying units (1e6)
    }
  }

  return (['optimism', 'base'] as const).map((chain) => ({
    chain,
    supplied: sums[chain],
    debt: BigInt(0),
  }))
}

export function useAaveAccounts() {
  const { data: walletClient } = useWalletClient()

  const query = useQuery<AaveAccount[]>({
    queryKey: ['aaveAccount', walletClient?.account.address],
    enabled: !!walletClient?.account.address,
    queryFn: async () => {
      const user = walletClient!.account.address as `0x${string}`
      console.time('[useAaveAccounts] fetch time')
      const positions = await fetchPositions(user)
      const result = toAaveAccounts(positions)
      console.timeEnd('[useAaveAccounts] fetch time')
      return result
    },
    refetchInterval: 30_000,
  })

  useEffect(() => {
    console.log('[useAaveAccounts] state →', {
      status: query.status,
      isFetching: query.isFetching,
      data: query.data,
      error: query.error,
      fetchStatus: query.fetchStatus,
      isStale: query.isStale,
    })
  }, [
    query.status,
    query.isFetching,
    query.data,
    query.error,
    query.fetchStatus,
    query.isStale,
  ])

  return query
}
