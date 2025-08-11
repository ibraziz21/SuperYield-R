// src/lib/tvl.ts
//
// Robust TVL helpers for Aave/Comet/Morpho + tiny utility to hide unsupported
// Aave markets (e.g. USDT on Base).
//
// Aave v3 (OP/Base):
//   TVL = aToken.scaledTotalSupply * liquidityIndex / 1e27  (fallback totalSupply())
//   Underlying detection is resilient to USDC vs USDbC symbol differences.
//   Heavy lookups memoized; reserve scans use multicall.
// Comet (OP/Base):
//   TVL = totalsBasic().totalSupplyBase  (stables ≈ $1)
// Morpho (Lisk):
//   TVL = ERC-4626 totalAssets (WETH uses Coingecko price; price memoized).
//

import { erc20Abi, formatUnits } from 'viem'
import { publicOptimism, publicBase, publicLisk } from '@/lib/clients'
import { AAVE_POOL, COMET_POOLS, TokenAddresses, type TokenSymbol } from '@/lib/constants'
import aavePoolAbi from '@/lib/abi/aavePool.json'
import { memo } from './memo'

/* ─────────────────────────────────────────────────────────────────────────── */
/* Aave helpers & addresses                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

export const AAVE_UI_POOL_DATA_PROVIDER: Record<'optimism' | 'base', `0x${string}`> = {
  optimism: '0xE92cd6164CE7DC68e740765BC1f2a091B6CBc3e4',
  base:     '0x68100bD5345eA474D93577127C11F39FF8463e93',
}

const aavePoolListAbi = [
  { type: 'function', name: 'getReservesList', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
] as const

const erc20MetaAbi = [
  { type: 'function', name: 'symbol',   stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8'  }] },
] as const

const aTokenExtraAbi = [
  { type: 'function', name: 'scaledTotalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

/* ─────────────────────────────────────────────────────────────────────────── */
/* Comet & Morpho ABIs                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

const cometTotalsAbi = [
  {
    type: 'function',
    name: 'totalsBasic',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'baseSupplyIndex',     type: 'uint64'  },
      { name: 'baseBorrowIndex',     type: 'uint64'  },
      { name: 'trackingSupplyIndex', type: 'uint64'  },
      { name: 'trackingBorrowIndex', type: 'uint64'  },
      { name: 'totalSupplyBase',     type: 'uint104' },
      { name: 'totalBorrowBase',     type: 'uint104' },
      { name: 'lastAccrualTime',     type: 'uint40'  },
    ],
  },
] as const

const erc4626Abi = [
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

/* ─────────────────────────────────────────────────────────────────────────── */
/* Morpho vaults (Lisk)                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

export const MORPHO_VAULTS: Record<'USDCe' | 'USDT0' | 'WETH', `0x${string}`> = {
  USDCe: '0xd92f564a29992251297980187a6b74faa3d50699',
  USDT0: '0x50cb55be8cf05480a844642cb979820c847782ae',
  WETH:  '0x7cbaa98bd5e171a658fdf761ed1db33806a0d346',
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Utils                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function rpc(chain: 'optimism' | 'base' | 'lisk') {
  return chain === 'optimism' ? publicOptimism : chain === 'base' ? publicBase : publicLisk
}

const RAY = BigInt(1e27)

/** Normalize token symbols to compare case-insensitively & without punctuation. */
function normSym(sym: string) {
  return sym.replace(/[^a-z0-9]/gi, '').toLowerCase() // e.g., 'USDbC' -> 'usdbc'
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Memoized helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** ETH/USD price (Coingecko) – memoized 60s to avoid rate limits. */
async function getEthUsdPrice(): Promise<number> {
  return memo('price:eth-usd', 60_000, async () => {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { cache: 'no-store' },
      )
      const j = await res.json()
      return typeof j?.ethereum?.usd === 'number' ? j.ethereum.usd : 0
    } catch {
      return 0
    }
  })
}

/** Cache Aave reserveData for 5 minutes per (chain, underlying). */
async function getAaveReserveDataCached(
  chain: 'optimism'|'base',
  underlying: `0x${string}`,
): Promise<any> {
  return memo(`aave:reserveData:${chain}:${underlying}`, 5 * 60_000, async () => {
    const c = rpc(chain)
    return c.readContract({
      address: AAVE_POOL[chain],
      abi: aavePoolAbi,
      functionName: 'getReserveData',
      args: [underlying],
    })
  })
}

/**
 * Detect the correct Aave underlying for stables (USDC or USDT) on a chain.
 * Memoized for 24h. Scans reserves via multicall only on cache miss.
 */
async function resolveAaveUnderlying(
  chain: 'optimism' | 'base',
  desired: 'USDC' | 'USDT',
): Promise<`0x${string}` | null> {
  return memo(`aave:underlying:${chain}:${desired}`, 24 * 60 * 60 * 1000, async () => {
    const c  = rpc(chain)
    const pl = AAVE_POOL[chain]

    // 1) Configured address fast-path (works on OP and Base native USDC)
    try {
      const addr = (TokenAddresses[desired] as Record<'optimism' | 'base', `0x${string}`>)[chain]
      await c.readContract({ address: pl, abi: aavePoolAbi, functionName: 'getReserveData', args: [addr] })
      return addr
    } catch { /* fallthrough */ }

    // 2) Enumerate reserves; fetch (symbol,decimals) in one multicall round
    try {
      const reserves = await c.readContract({
        address: pl,
        abi: aavePoolListAbi,
        functionName: 'getReservesList',
        args: [],
      }) as readonly `0x${string}`[]

      const calls = reserves.flatMap((addr) => ([
        { address: addr, abi: erc20MetaAbi, functionName: 'symbol'   } as const,
        { address: addr, abi: erc20MetaAbi, functionName: 'decimals' } as const,
      ]))

      const batched = await (c as any).multicall({
        allowFailure: true,
        contracts: calls,
      }) as Array<{ status: 'success'|'reverted'; result?: unknown }>

      const targetSet = desired === 'USDC'
        ? new Set(['usdc', 'usdbc', 'usdce', 'usdcnative'])
        : new Set(['usdt'])

      let best: `0x${string}` | null = null
      let bestScore = -1

      for (let i = 0; i < reserves.length; i++) {
        const symRes = batched[i * 2]
        const decRes = batched[i * 2 + 1]
        if (symRes?.status !== 'success' || decRes?.status !== 'success') continue

        const sym = normSym(String(symRes.result))
        const dec = Number(decRes.result)
        if (dec !== 6) continue
        if (!targetSet.has(sym)) continue

        // score exact symbol highest
        let score = 1
        if (desired === 'USDC') {
          if (sym === 'usdc') score = 3
          else if (sym === 'usdbc' || sym === 'usdce') score = 2
        } else if (desired === 'USDT') {
          if (sym === 'usdt') score = 3
        }

        if (score > bestScore) {
          best = reserves[i]
          bestScore = score
        }
      }
      return best
    } catch {
      return null
    }
  })
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* TVL calculators                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Aave TVL in USD for stables = scaledTotalSupply * liquidityIndex / RAY (decimals=6) */
async function aaveStableTvlUsd(chain: 'optimism' | 'base', token: 'USDC' | 'USDT'): Promise<number> {
  try {
    const c    = rpc(chain)
    const pool = AAVE_POOL[chain]
    const underlying = await resolveAaveUnderlying(chain, token)
    if (!underlying) return 0

    const res = await getAaveReserveDataCached(chain, underlying)

    // liquidityIndex at [1], aTokenAddress at [8] (or named fields)
    const liquidityIndex: bigint =
      Array.isArray(res) ? (res[1] as bigint) : (res.liquidityIndex as bigint)
    const aToken: `0x${string}` =
      Array.isArray(res) ? (res[8] as `0x${string}`) : (res.aTokenAddress as `0x${string}`)

    // Prefer scaledTotalSupply path
    let underlyingSupply: bigint
    try {
      const scaled = await c.readContract({
        address: aToken,
        abi: aTokenExtraAbi,
        functionName: 'scaledTotalSupply',
      }) as bigint
      if (scaled > BigInt(0)) {
        underlyingSupply = (scaled * liquidityIndex) / RAY
      } else {
        const total = await c.readContract({
          address: aToken,
          abi: erc20Abi,
          functionName: 'totalSupply',
        }) as bigint
        underlyingSupply = total
      }
    } catch {
      const total = await c.readContract({
        address: aToken,
        abi: erc20Abi,
        functionName: 'totalSupply',
      }) as bigint
      underlyingSupply = total
    }

    // Stables ~ $1 → decimals 6 == USD
    return Number(formatUnits(underlyingSupply, 6))
  } catch {
    return 0
  }
}

async function cometTvlUsd(chain: 'optimism' | 'base', token: 'USDC' | 'USDT'): Promise<number> {
  try {
    const c = rpc(chain)
    const comet = COMET_POOLS[chain][token]
    if (!comet || comet.toLowerCase() === '0x0000000000000000000000000000000000000000') return 0

    const totals = await c.readContract({
      address: comet,
      abi: cometTotalsAbi,
      functionName: 'totalsBasic',
    }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, number]

    const totalSupplyBase = totals[4]
    return Number(formatUnits(totalSupplyBase, 6))
  } catch {
    return 0
  }
}

async function morphoTvlUsd(token: 'USDCe' | 'USDT0' | 'WETH'): Promise<number> {
  try {
    const v = MORPHO_VAULTS[token]
    const totalAssets = await publicLisk.readContract({
      address: v,
      abi: erc4626Abi,
      functionName: 'totalAssets',
    }) as bigint

    if (token === 'WETH') {
      const price = await getEthUsdPrice()
      return Number(formatUnits(totalAssets, 18)) * price
    }
    return Number(formatUnits(totalAssets, 6))
  } catch {
    return 0
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/** Helper you can use in lists to hide unsupported Aave markets. */
export function isAaveMarketSupported(chain: 'optimism' | 'base', token: 'USDC' | 'USDT') {
  // There is no Aave USDT market on Base
  if (chain === 'base' && token === 'USDT') return false
  return true
}

export async function getTvlUsd(p: {
  protocol: 'Aave v3' | 'Compound v3' | 'Morpho Blue'
  chain: 'optimism' | 'base' | 'lisk'
  token: TokenSymbol
}): Promise<number> {
  try {
    if (p.protocol === 'Aave v3' && (p.chain === 'optimism' || p.chain === 'base')) {
      // Only stables (USDC/USDT) for this path; skip unsupported combo.
      const t = (p.token === 'USDT' ? 'USDT' : 'USDC') as 'USDC' | 'USDT'
      if (!isAaveMarketSupported(p.chain, t)) return 0
      return await aaveStableTvlUsd(p.chain, t)
    }

    if (p.protocol === 'Compound v3' && (p.chain === 'optimism' || p.chain === 'base')) {
      if (p.token !== 'USDC' && p.token !== 'USDT') return 0
      return await cometTvlUsd(p.chain, p.token)
    }

    if (p.protocol === 'Morpho Blue' && p.chain === 'lisk') {
      const t = p.token === 'WETH' ? 'WETH' : (p.token === 'USDT0' ? 'USDT0' : 'USDCe')
      return await morphoTvlUsd(t)
    }

    return 0
  } catch {
    return 0
  }
}
