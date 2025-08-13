// src/hooks/useMerklRewards.ts
import { useQuery } from '@tanstack/react-query'
import { useWalletClient } from 'wagmi'
import { optimism, base, lisk } from 'viem/chains'
import type { Address } from 'viem'
import {
  fetchMerklRewards,
  type MerklRewardsByChain,
  type MerklRewardItem,
} from '@/lib/merkl'

export type FlatReward = MerklRewardItem & {
  chainId: number
  chainName: string
}

export function useMerklRewards(opts?: { chains?: number[] }) {
  const { data: wallet } = useWalletClient()
  const addr = wallet?.account?.address as Address | undefined
  const chainIds = opts?.chains ?? [lisk.id, optimism.id, base.id] // cover Lisk + OP/Base

  const q = useQuery<FlatReward[]>({
    queryKey: ['merkl-rewards', addr, chainIds],
    enabled: !!addr,
    queryFn: async () => {
      const byChain = await fetchMerklRewards({ user: addr!, chainIds })
      const flat: FlatReward[] = (byChain as MerklRewardsByChain[]).flatMap((row) =>
        row.rewards.map((r) => ({
          ...r,
          chainId: row.chain.id,
          chainName: row.chain.name,
        })),
      )
      // keep only strictly positive claimables
      return flat.filter((r) => BigInt(r.amount) > 0n)
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  return {
    rewards: q.data ?? [],
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
    totalCount: (q.data ?? []).length,
    totalByChain: (q.data ?? []).reduce<Record<number, number>>((acc, r) => {
      acc[r.chainId] = (acc[r.chainId] ?? 0) + 1
      return acc
    }, {}),
  }
}
