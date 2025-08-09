// src/hooks/useYields.ts
//
// React Query hook that returns a list of YieldSnapshot objects built
// on-chain (see src/lib/fetchYields). Exporting the YieldSnapshot type
// here keeps your app’s imports consistent.

import { useQuery } from '@tanstack/react-query'
import { fetchYields } from '@/lib/fetchYields'

export type Chain = 'optimism' | 'base' | 'lisk'
export type Protocol = 'Aave v3' | 'Compound v3' | 'Morpho Blue'
export type ProtocolKey = 'aave-v3' | 'compound-v3' | 'morpho-blue'
export type TokenSym = 'USDC' | 'USDT' | 'USDCe' | 'USDT0' | 'WETH'

export interface YieldSnapshot {
  id: string
  chain: Chain
  protocol: Protocol
  protocolKey: ProtocolKey
  poolAddress: `0x${string}`
  token: TokenSym
  apy: number
  tvlUSD: number
  updatedAt: string
  /** Underlying ERC-20 for Aave/Comet or vault asset on Lisk (or '' if n/a) */
  underlying: `0x${string}` | ''
}

export function useYields() {
  const query = useQuery<YieldSnapshot[], Error>({
    queryKey: ['yields'],
    queryFn: fetchYields,
    staleTime: 60_000, // 1 min
    refetchOnWindowFocus: false,
  })

  return {
    yields: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
