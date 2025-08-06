import { useQuery } from '@tanstack/react-query'
import { fetchAaveAccount, AaveAccount } from '@/lib/positions'
import { useWalletClient } from 'wagmi'

export function useAaveAccounts() {
  const { data: wallet } = useWalletClient()
  return useQuery<AaveAccount[]>({
    queryKey: ['aaveAccount', wallet?.account.address],
    enabled:  !!wallet?.account.address,
    queryFn:  async () => {
      const user = wallet!.account.address
      return Promise.all([
        fetchAaveAccount('optimism', user),
        fetchAaveAccount('base',     user),
      ])
    },
    refetchInterval: 30_000,
  })
}
