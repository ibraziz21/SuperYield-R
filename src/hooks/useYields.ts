import useSWR from 'swr'

export interface YieldSnapshot {
  id: string
  chain: 'optimism' | 'base'
  protocol: string
    protocolKey: 'aave-v3' | 'compound-v3' | 'sonne-finance' | 'moonwell-lending'
  poolAddress: string  
  token: 'USDC' | 'USDT' 
  apy: number
  tvlUSD: number
  updatedAt: string
}

const fetcher = (u: string) => fetch(u).then((r) => r.json())

export function useYields() {
  const { data, error, isLoading } = useSWR<unknown>(
    '/api/yields',
    fetcher,
    { refreshInterval: 30_000 },
  )

  return {
    yields: Array.isArray(data) ? (data as YieldSnapshot[]) : [],
    isLoading,
    error,
  }
}
