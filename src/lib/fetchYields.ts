import { YieldSnapshot } from '@/hooks/useYields'
import { createPublicClient, http, formatUnits, parseUnits } from 'viem'
import { lisk } from 'viem/chains'

const LLAMA_ENDPOINT = 'https://yields.llama.fi/pools'
const MERKL_CAMPAIGNS_ENDPOINT = 'https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK'

const CHAINS = ['Optimism', 'Base'] as const
const TOKENS = ['USDC', 'USDT', 'USDC.E', 'USDT.E'] as const
const CHAIN_MAP = { Optimism: 'optimism', Base: 'base' } as const
const ALLOWED = ['aave-v3', 'compound-v3'] as const

export const MORPHO_POOLS = {
  'usdce-supply': '0xd92f564a29992251297980187a6b74faa3d50699',
  'usdt0-supply': '0x50cb55be8cf05480a844642cb979820c847782ae',
  'weth-supply': '0x7cbaa98bd5e171a658fdf761ed1db33806a0d346',
} as const

const morphoClient = createPublicClient({ chain: lisk, transport: http() })

const erc4626Abi = [
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]

async function fetchMerklLiskMorphoRewards(): Promise<Record<string, number>> {
  const res = await fetch(MERKL_CAMPAIGNS_ENDPOINT)
  const data = await res.json()
  const rewardsMap: Record<string, number> = {}

  for (const campaign of data) {
    const symbol = campaign.rewardToken.symbol
    const vaultAddress = campaign.params.targetToken.toLowerCase()
    const apr = campaign?.apr ?? 0

    if (
      symbol === 'LSK' &&
      vaultAddress &&
      typeof apr === 'number'
    ) {
      rewardsMap[vaultAddress] = apr
    }
  }

  return rewardsMap
}

async function fetchETHPrice(): Promise<number> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
  const data = await res.json()
  return data.ethereum.usd
}


async function readMorphoVault(
  vault: `0x${string}`,
  symbol: YieldSnapshot['token'],
  merklRewards: Record<string, number>
): Promise<YieldSnapshot> {
  const decimals = symbol === 'WETH' ? 18 : 6
  const shares = parseUnits('1', decimals)

  const [ , totalAssetsRaw] = await morphoClient.multicall({
    contracts: [
      { address: vault, abi: erc4626Abi, functionName: 'convertToAssets', args: [shares] },
      { address: vault, abi: erc4626Abi, functionName: 'totalAssets' },
    ],
  })



  const tvlRaw = Number(formatUnits(totalAssetsRaw.result ?? 0n, decimals))
  const price = symbol === 'WETH' ? await fetchETHPrice() : 1
  const tvlUSD = (tvlRaw * price)
  const rewardApy = merklRewards[vault.toLowerCase()] ?? 0

  return {
    id: `lisk-morpho-${symbol.toLowerCase()}`,
    chain: 'lisk',
    protocol: 'Morpho Blue',
    protocolKey: 'morpho-blue',
    poolAddress: vault,
    token: symbol,
    apy: rewardApy,
    tvlUSD,
    updatedAt: new Date().toISOString(),
    underlying: ''
  }
}

export async function fetchYields(): Promise<YieldSnapshot[]> {
  const res = await fetch(LLAMA_ENDPOINT, { cache: 'no-store' })
  if (!res.ok) throw new Error('llama down')
  const payload: unknown = await res.json()

  const pools: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : []

  const llamaYields = pools
    .filter(
      (p) =>
        CHAINS.includes(p.chain) &&
        TOKENS.includes(p.symbol) &&
        ALLOWED.includes(p.project as any)
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
        underlying: ''
      } satisfies YieldSnapshot
    })

  const merklRewards = await fetchMerklLiskMorphoRewards()

  const morphoYields = await Promise.all([
    readMorphoVault(MORPHO_POOLS['usdce-supply'], 'USDC', merklRewards),
    readMorphoVault(MORPHO_POOLS['usdt0-supply'], 'USDT', merklRewards),
    readMorphoVault(MORPHO_POOLS['weth-supply'], 'WETH', merklRewards),
  ])

  return [...llamaYields, ...morphoYields]
}
