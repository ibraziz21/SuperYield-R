// src/lib/fetchYields.ts

import { YieldSnapshot } from '@/hooks/useYields'
import { createPublicClient, http, formatUnits, parseUnits } from 'viem'
import { lisk } from 'viem/chains'

// ─── Constants ────────────────────────────────────────────────────────────────

const LLAMA_ENDPOINT           = 'https://yields.llama.fi/pools'
const MERKL_CAMPAIGNS_ENDPOINT = 'https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK'

const CHAINS = ['Optimism', 'Base'] as const
const TOKENS = ['USDC', 'USDT', 'USDC.E', 'USDT.E'] as const
const CHAIN_MAP = { Optimism: 'optimism', Base: 'base' } as const
const ALLOWED    = ['aave-v3', 'compound-v3'] as const

export const MORPHO_POOLS = {
  'usdce-supply': '0xd92f564a29992251297980187a6b74faa3d50699',
  'usdt0-supply': '0x50cb55be8cf05480a844642cb979820c847782ae',
  'weth-supply':  '0x7cbaa98bd5e171a658fdf761ed1db33806a0d346',
} as const

const morphoClient = createPublicClient({ chain: lisk, transport: http() })
const erc4626Abi = [
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalAssets',      type: 'function', stateMutability: 'view', inputs: [],                        outputs: [{ type: 'uint256' }] },
]

// ─── JSON‐safety helpers ──────────────────────────────────────────────────────

type JsonObj = Record<string, unknown>
function isJsonObj(x: unknown): x is JsonObj {
  return typeof x === 'object' && x !== null
}

// ─── Llama pool type‐guard ───────────────────────────────────────────────────

interface LlamaPoolRaw {
  chain:   string
  symbol:  string
  project: string
  pool:    string
  apyBase?: number
  tvlUsd?:  number
}
function isLlamaPoolRaw(x: unknown): x is LlamaPoolRaw {
  if (!isJsonObj(x)) return false
  const { chain, symbol, project, pool, apyBase, tvlUsd } = x
  if (
    typeof chain   !== 'string' ||
    typeof symbol  !== 'string' ||
    typeof project !== 'string' ||
    typeof pool    !== 'string'
  ) return false
  if (apyBase !== undefined && typeof apyBase !== 'number') return false
  if (tvlUsd  !== undefined && typeof tvlUsd  !== 'number') return false
  return true
}

// ─── Fetch Merkl LSK campaigns ────────────────────────────────────────────────

async function fetchMerklLiskMorphoRewards(): Promise<Record<string, number>> {
  const res = await fetch(MERKL_CAMPAIGNS_ENDPOINT)
  const raw = await res.json()
  if (!Array.isArray(raw)) return {}
  const rewardsMap: Record<string, number> = {}
  for (const item of raw) {
    if (!isJsonObj(item)) continue
    const rewardToken = item['rewardToken']
    const params      = item['params']
    const apr         = item['apr']
    if (
      isJsonObj(rewardToken) &&
      typeof rewardToken.symbol === 'string' &&
      isJsonObj(params) &&
      typeof params.targetToken === 'string' &&
      typeof apr === 'number' &&
      rewardToken.symbol === 'LSK'
    ) {
      rewardsMap[params.targetToken.toLowerCase()] = apr
    }
  }
  return rewardsMap
}

// ─── Fetch current ETH price ──────────────────────────────────────────────────

async function fetchETHPrice(): Promise<number> {
  const res  = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
  )
  const json = await res.json()
  return isJsonObj(json) &&
         isJsonObj(json.ethereum) &&
         typeof json.ethereum.usd === 'number'
    ? json.ethereum.usd
    : 0
}

// ─── Read a single Morpho vault ───────────────────────────────────────────────

async function readMorphoVault(
  vault: `0x${string}`,
  symbol: YieldSnapshot['token'],
  merklRewards: Record<string, number>
): Promise<YieldSnapshot> {
  const decimals = symbol === 'WETH' ? 18 : 6
  const shares   = parseUnits('1', decimals)

  // only need totalAssets
  const [, totalAssetsRaw] = await morphoClient.multicall({
    contracts: [
      { address: vault, abi: erc4626Abi, functionName: 'convertToAssets', args: [shares] },
      { address: vault, abi: erc4626Abi, functionName: 'totalAssets' }
    ]
  })

  // ensure result is bigint
  const rawAssets = typeof totalAssetsRaw.result === 'bigint'
    ? totalAssetsRaw.result
    : BigInt(0)

  const tvlRaw = Number(formatUnits(rawAssets, decimals))
  const price  = symbol === 'WETH' ? await fetchETHPrice() : 1
  const tvlUSD = tvlRaw * price
  const apy    = merklRewards[vault.toLowerCase()] ?? 0

  return {
    id:          `lisk-morpho-${symbol.toLowerCase()}`,
    chain:       'lisk',
    protocol:    'Morpho Blue',
    protocolKey: 'morpho-blue',
    poolAddress: vault,
    token:       symbol,
    apy,
    tvlUSD,
    updatedAt:   new Date().toISOString(),
    underlying:  ''
  }
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

export async function fetchYields(): Promise<YieldSnapshot[]> {
  // fetch Llama
  const resp = await fetch(LLAMA_ENDPOINT, { cache: 'no-store' })
  if (!resp.ok) throw new Error('Llama down')
  const raw = await resp.json()

  let candidates: unknown[] = []
  if (Array.isArray(raw)) {
    candidates = raw
  } else if (isJsonObj(raw) && Array.isArray(raw.data)) {
    candidates = raw.data
  }

  const llamaYields = candidates
    .filter(isLlamaPoolRaw)
    .filter(p =>
      CHAINS.includes(p.chain as any) &&
      TOKENS.includes(p.symbol as any) &&
      ALLOWED.includes(p.project as any)
    )
    .map(p => {
      const chain       = CHAIN_MAP[p.chain as keyof typeof CHAIN_MAP]
      const poolAddress = p.pool.slice(0, 42).toLowerCase()
      return {
        id:          `${chain}-${p.project}-${p.symbol.toLowerCase()}`,
        chain,
        protocol:    p.project.replace(/-/g, ' '),
        protocolKey: p.project as typeof ALLOWED[number],
        poolAddress,
        token:       p.symbol as YieldSnapshot['token'],
        apy:         p.apyBase ?? 0,
        tvlUSD:      p.tvlUsd  ?? 0,
        updatedAt:   new Date().toISOString(),
        underlying:  ''
      } satisfies YieldSnapshot
    })

  const merklRewards  = await fetchMerklLiskMorphoRewards()
  const morphoYields  = await Promise.all([
    readMorphoVault(MORPHO_POOLS['usdce-supply'], 'USDC', merklRewards),
    readMorphoVault(MORPHO_POOLS['usdt0-supply'], 'USDT', merklRewards),
    readMorphoVault(MORPHO_POOLS['weth-supply'],  'WETH',   merklRewards),
  ])

  return [...llamaYields, ...morphoYields]
}
