/* ────────── usePositions.ts ────────── */
import { useQuery } from '@tanstack/react-query'
import { fetchPositions, type Position } from '@/lib/positions'
import { useWalletClient } from 'wagmi'

export function usePositions() {
  const { data: walletClient } = useWalletClient()

  return useQuery<Position[]>({
    queryKey: ['positions', walletClient?.account.address],
    enabled:  !!walletClient?.account.address,
    queryFn:  () => fetchPositions(walletClient!.account.address),
    refetchInterval: 30_000,
  })
}
