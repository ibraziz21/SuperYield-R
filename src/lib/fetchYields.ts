import { YieldSnapshot } from '@/hooks/useYields'

const LLAMA_ENDPOINT = 'https://yields.llama.fi/pools'

const CHAINS = ['Optimism', 'Base'] as const
const TOKENS  = ['USDC', 'USDT', 'USDC.E', 'USDT.E'] as const
const CHAIN_MAP = { Optimism: 'optimism', Base: 'base' } as const
const ALLOWED = ['aave-v3', 'compound-v3', 'sonne-finance', 'moonwell-lending'] as const

export async function fetchYields(): Promise<YieldSnapshot[]> {
  const res = await fetch(LLAMA_ENDPOINT, { cache: 'no-store' })
  if (!res.ok) throw new Error('llama down')

  const payload: unknown = await res.json()
  const pools: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : []

  return pools
    .filter(
      (p) =>
        CHAINS.includes(p.chain) &&
        TOKENS.includes(p.symbol) &&
        ALLOWED.includes(p.project as any),
       
    )
    .map((p) => {
        const addr = p.pool.slice(0, 42).toLowerCase()
      const chain = CHAIN_MAP[p.chain as keyof typeof CHAIN_MAP]
      return {
        id: `${chain}-${p.project}-${p.symbol.toLowerCase()}`,
        chain,
        protocol: p.project.replace(/-/g, ' '),
        protocolKey: p.project as typeof ALLOWED[number],
        poolAddress: addr,     
        token: p.symbol as YieldSnapshot['token'],
        apy: p.apyBase ?? 0,
        tvlUSD: p.tvlUsd ?? 0,
        updatedAt: new Date().toISOString(),
      } satisfies YieldSnapshot
    })
}
