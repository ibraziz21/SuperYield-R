/* ────────── hooks/useAaveAccounts.ts ────────── */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAaveAccount, type AaveAccount } from '@/lib/positions'
import { useWalletClient } from 'wagmi'

export function useAaveAccounts() {
  const { data: walletClient } = useWalletClient()

  /* wrapped in a var so we can inspect it later */
  const query = useQuery<AaveAccount[]>({
    queryKey: ['aaveAccount', walletClient?.account.address],
    enabled:  !!walletClient?.account.address,
    queryFn:  async () => {
      const user = walletClient!.account.address
      console.log('[useAaveAccounts] 🔄 queryFn fired for', user)

      /* measure the network round-trip */
      console.time('[useAaveAccounts] fetch time')

      const result = await Promise.all([
        fetchAaveAccount('optimism', user),
        fetchAaveAccount('base',     user),
      ])

      console.timeEnd('[useAaveAccounts] fetch time')
      console.log('[useAaveAccounts] ✅ queryFn result', result)
      return result
    },
    refetchInterval: 30_000,
  
  })

  /* log every state change */
  useEffect(() => {
    console.log('[useAaveAccounts] state →', {
      status:        query.status,
      isFetching:    query.isFetching,
      data:          query.data,
      error:         query.error,
      fetchStatus:   query.fetchStatus,
      isStale:       query.isStale,
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
