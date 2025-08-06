import { useQuery } from '@tanstack/react-query'
import { fetchPositions, Position } from '@/lib/positions'
import { useWalletClient } from 'wagmi'

export function usePositions() {

  const { data: wallet } = useWalletClient()
  return useQuery<Position[]>({
    queryKey: ['positions', wallet?.account.address],
    enabled:  !!wallet?.account.address,
    queryFn:  () => fetchPositions(wallet!.account.address),
    refetchInterval: 30_000,           // refresh every 30 s
  })
  
}
