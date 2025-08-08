import useSWR from 'swr'

export interface YieldSnapshot {
  underlying: unknown
  id: string
  chain: 'optimism' | 'base' | 'lisk'
  protocol: string
  protocolKey: 'aave-v3' | 'compound-v3' | 'morpho-blue' | 'moonwell-lending'
  poolAddress: string
  token: 'USDC' | 'USDT' | 'WETH' | 'USDT0' | 'USDCe'
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
