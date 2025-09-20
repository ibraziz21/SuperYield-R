// src/lib/positions.ts

import { publicOptimism, publicBase, publicLisk } from './clients'
import {
  AAVE_POOL,
  COMET_POOLS,
  MORPHO_POOLS,
  TokenAddresses,
  type TokenSymbol,
} from './constants'

import aaveAbi from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
import { erc20Abi } from 'viem'
import { getATokenAddress as _unused, getAaveATokenBalance } from './aave'

/* ──────────────────────────────────────────────────────────────── */
/* Debug helpers                                                    */
/* ──────────────────────────────────────────────────────────────── */

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_POSITIONS !== 'false'
const dbg = (...args: any[]) => {
  if (DEBUG) console.log('[positions]', ...args)
}
const warn = (...args: any[]) => console.warn('[positions]', ...args)
const err = (...args: any[]) => console.error('[positions]', ...args)

/* ──────────────────────────────────────────────────────────────── */
/* Chains & helpers                                                 */
/* ──────────────────────────────────────────────────────────────── */

export type EvmChain = 'optimism' | 'base' | 'lisk'

function pub(chain: EvmChain) {
  switch (chain) {
    case 'optimism': return publicOptimism
    case 'base':     return publicBase
    default:         return publicLisk
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Types                                                            */
/* ──────────────────────────────────────────────────────────────── */

export interface Position {
  protocol: 'Aave v3' | 'Compound v3' | 'Morpho Blue'
  chain:    EvmChain
  token:    TokenSymbol
  amount:   bigint
}

/* ──────────────────────────────────────────────────────────────── */
/* Aave v3 APY (utility)                                            */
/* ──────────────────────────────────────────────────────────────── */

const RAY            = BigInt(10 ** 27)  // 1e27
const BPS_MULTIPLIER = BigInt(10_000)    // basis points

export async function aaveSupplyApy(
  asset: `0x${string}`,
  chain: Extract<EvmChain, 'optimism' | 'base'>,
): Promise<number | null> {
  const client = pub(chain)
  const pool   = AAVE_POOL[chain]
  dbg('aaveSupplyApy()', { chain, asset, pool })

  try {
    const reserve = await client.readContract({
      address: pool,
      abi:     aaveAbi,
      functionName: 'getReserveData',
      args: [asset],
    }) as any

    const liqRateRay: bigint | undefined =
      Array.isArray(reserve) ? (typeof reserve[2] === 'bigint' ? reserve[2] : undefined)
      : (reserve && typeof reserve === 'object' && typeof reserve.currentLiquidityRate === 'bigint'
          ? reserve.currentLiquidityRate : undefined)

    dbg('aaveSupplyApy.reserve', { liqRateRay: liqRateRay?.toString?.() })

    if (typeof liqRateRay !== 'bigint') return null
    const bps = (liqRateRay * BPS_MULTIPLIER) / RAY
    return Number(bps) / 100
  } catch (e) {
    err('aaveSupplyApy.error', e)
    return null
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Compound v3 (Comet) utils                                        */
/* ──────────────────────────────────────────────────────────────── */

export async function compoundSupplyApy(
  comet:  `0x${string}`,
  chain:  Extract<EvmChain, 'optimism' | 'base'>,
): Promise<number> {
  const client = pub(chain)
  dbg('compoundSupplyApy()', { chain, comet })

  const util = await client.readContract({
    address: comet,
    abi: cometAbi,
    functionName: 'getUtilization',
  }) as bigint

  const rate = await client.readContract({
    address: comet,
    abi: cometAbi,
    functionName: 'getSupplyRate',
    args: [util],
  }) as bigint

  dbg('compoundSupplyApy.util/rate', { util: util.toString(), rate: rate.toString() })
  return (Number(rate) / 1e18) * 31_536_000 * 100
}

async function cometSupply(
  chain: Extract<EvmChain, 'optimism' | 'base'>,
  token: Extract<TokenSymbol, 'USDC' | 'USDT'>,
  user:  `0x${string}`,
): Promise<bigint> {
  const pool = COMET_POOLS[chain][token]
  dbg('cometSupply()', { chain, token, user, pool })
  if (pool === '0x0000000000000000000000000000000000000000') return 0n

  try {
    const bal = await pub(chain).readContract({
      address: pool,
      abi:     cometAbi,
      functionName: 'balanceOf',
      args: [user],
    }) as bigint
    dbg('cometSupply.balance', { bal: bal.toString() })
    return bal
  } catch (e) {
    err('cometSupply.error', e)
    return 0n
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Morpho Blue (Lisk) – ERC-4626 vaults                             */
/* ──────────────────────────────────────────────────────────────── */

const erc4626Abi = [
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs:   [{ name: 'shares', type: 'uint256' }],
    outputs:  [{ type: 'uint256' }],
  },
] as const

const MORPHO_VAULT_BY_TOKEN: Record<
  Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>,
  `0x${string}`
> = {
  USDCe: MORPHO_POOLS['usdce-supply'] as `0x${string}`,
  USDT0: MORPHO_POOLS['usdt0-supply'] as `0x${string}`,
  WETH:  MORPHO_POOLS['weth-supply']  as `0x${string}`,
}

async function morphoSupplyLisk(
  token: Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>,
  user:  `0x${string}`,
): Promise<bigint> {
  const vault = MORPHO_VAULT_BY_TOKEN[token]
  dbg('morphoSupplyLisk()', { token, user, vault })

  try {
    const [shares, shareDec] = await Promise.all([
      publicLisk.readContract({
        address: vault,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [user],
      }) as Promise<bigint>,
      publicLisk.readContract({
        address: vault,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
    ])
    dbg('morphoSupplyLisk.shares', { shares: shares.toString(), shareDec })

    if (shares === 0n) return 0n

    const assets = await publicLisk.readContract({
      address: vault,
      abi: erc4626Abi,
      functionName: 'convertToAssets',
      args: [shares],
    }) as bigint
    dbg('morphoSupplyLisk.assets', { assets: assets.toString() })

    return assets
  } catch (e) {
    err('morphoSupplyLisk.error', e)
    return 0n
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Optimism receipt tokens (sVault)                                 */
/* ──────────────────────────────────────────────────────────────── */

const maxBigint = (a: bigint, b: bigint) => (a > b ? a : b)

async function fetchReceiptBalance(
  user: `0x${string}`,
  which: 'USDC' | 'USDT',
): Promise<bigint> {
  const addr =
    which === 'USDC'
      ? (TokenAddresses.sVault.optimismUSDC as `0x${string}`)
      : (TokenAddresses.sVault.optimismUSDT as `0x${string}`)

  dbg('fetchReceiptBalance()', { which, addr, user })

  if (!addr || addr === '0x0000000000000000000000000000000000000000') {
    warn('fetchReceiptBalance.missingAddr', { which, addr })
    return 0n
  }

  try {
    const [dec, bal] = await Promise.all([
      publicOptimism.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
      publicOptimism.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [user],
      }) as Promise<bigint>,
    ])
    dbg('fetchReceiptBalance.dec/bal', { which, dec, bal: bal.toString() })
    return bal ?? 0n
  } catch (e) {
    err('fetchReceiptBalance.error', { which, e })
    return 0n
  }
}

async function morphoUSDCeViaReceiptOrLisk(user: `0x${string}`): Promise<bigint> {
  dbg('morphoUSDCeViaReceiptOrLisk()', { user })
  const [receipt, liskAssets] = await Promise.all([
    fetchReceiptBalance(user, 'USDC'),
    morphoSupplyLisk('USDCe', user),
  ])
  dbg('morphoUSDCeViaReceiptOrLisk.result', { receipt: receipt.toString(), liskAssets: liskAssets.toString() })
  return maxBigint(receipt, liskAssets)
}

async function morphoUSDT0ViaReceiptOrLisk(user: `0x${string}`): Promise<bigint> {
  dbg('morphoUSDT0ViaReceiptOrLisk()', { user })
  const [receipt, liskAssets] = await Promise.all([
    fetchReceiptBalance(user, 'USDT'),
    morphoSupplyLisk('USDT0', user),
  ])
  dbg('morphoUSDT0ViaReceiptOrLisk.result', { receipt: receipt.toString(), liskAssets: liskAssets.toString() })
  return maxBigint(receipt, liskAssets)
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all positions                                 */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  dbg('fetchPositions.start', { user })

  const tasks: Promise<Position>[] = []

  // AAVE v3
  for (const chain of ['optimism', 'base'] as const) {
    for (const token of ['USDC', 'USDT'] as const) {
      tasks.push(
        getAaveATokenBalance(chain, token, user)
          .then((amt) => {
            dbg('AAVE.balance', { chain, token, amt: amt.toString() })
            return { protocol: 'Aave v3' as const, chain, token, amount: amt }
          })
          .catch((e) => {
            err('AAVE.read.error', { chain, token, e })
            return { protocol: 'Aave v3' as const, chain, token, amount: 0n }
          }),
      )
    }
  }

  // COMPOUND v3
  for (const chain of ['optimism', 'base'] as const) {
    for (const token of ['USDC', 'USDT'] as const) {
      tasks.push(
        cometSupply(chain, token, user)
          .then((amt) => {
            dbg('COMET.balance', { chain, token, amt: amt.toString() })
            return { protocol: 'Compound v3' as const, chain, token, amount: amt }
          })
          .catch((e) => {
            err('COMET.read.error', { chain, token, e })
            return { protocol: 'Compound v3' as const, chain, token, amount: 0n }
          }),
      )
    }
  }

  // MORPHO BLUE – Lisk
  tasks.push(
    morphoUSDCeViaReceiptOrLisk(user)
      .then((amt) => ({ protocol: 'Morpho Blue' as const, chain: 'lisk' as const, token: 'USDCe' as const, amount: amt })),
  )
  tasks.push(
    morphoUSDT0ViaReceiptOrLisk(user)
      .then((amt) => ({ protocol: 'Morpho Blue' as const, chain: 'lisk' as const, token: 'USDT0' as const, amount: amt })),
  )
  tasks.push(
    morphoSupplyLisk('WETH', user)
      .then((amt) => {
        dbg('MORPHO.WETH.assets', { amt: amt.toString() })
        return { protocol: 'Morpho Blue' as const, chain: 'lisk' as const, token: 'WETH' as const, amount: amt }
      })
      .catch((e) => {
        err('MORPHO.WETH.error', e)
        return { protocol: 'Morpho Blue' as const, chain: 'lisk' as const, token: 'WETH' as const, amount: 0n }
      }),
  )

  const raw = await Promise.all(tasks)
  dbg('fetchPositions.raw', raw.map((p) => ({ ...p, amount: p.amount.toString() })))

  const nonZero = raw.filter((p) => p.amount > 0n)
  dbg('fetchPositions.nonZero', nonZero.map((p) => ({ ...p, amount: p.amount.toString() })))

  return nonZero
}
