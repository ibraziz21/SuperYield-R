// src/hooks/useVaultRewards.ts
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http } from 'viem'
import { optimism } from 'viem/chains'
import { useWalletClient } from 'wagmi'
import { REWARDS_VAULT } from '@/lib/constants'
import vaultRewardsAbi  from '@/lib/abi/rewardsAbi.json'

const publicClient = createPublicClient({ chain: optimism, transport: http() })

export function useVaultRewards() {
  const { data: walletClient } = useWalletClient()
  const user = walletClient?.account?.address as `0x${string}` | undefined

  const query = useQuery({
    queryKey: ['vault-rewards', user],
    enabled: !!user,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [earned, avail] = await Promise.all([
        publicClient.readContract({
          address: REWARDS_VAULT.optimism,
          abi: vaultRewardsAbi,
          functionName: 'earned',
          args: [user!],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: REWARDS_VAULT.optimism,
          abi: vaultRewardsAbi,
          functionName: 'availableRewards',
        }) as Promise<bigint>,
      ])
      return { earned, availableRewards: avail }
    },
  })

  return { ...query, user }
}
