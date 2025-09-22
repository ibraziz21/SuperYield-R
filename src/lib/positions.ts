// src/lib/positions.ts
// Morpho Blue positions only (Lisk). Keeps OP receipt-token check for pending deposits.

import { publicOptimism, publicLisk } from './clients'
import { MORPHO_POOLS, TokenAddresses, type TokenSymbol } from './constants'
import { erc20Abi } from 'viem'

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_POSITIONS !== 'false'
const dbg = (...args: any[]) => {
  if (DEBUG) console.log('[positions]', ...args)
}
const err = (...args: any[]) => console.error('[positions]', ...args)

/* ──────────────────────────────────────────────────────────────── */
/* Types                                                            */
/* ──────────────────────────────────────────────────────────────── */

export type EvmChain = 'lisk'

export interface Position {
  protocol: 'Morpho Blue'
  chain:    EvmChain
  token:    Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>
  amount:   bigint
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
    const [shares] = await Promise.all([
      publicLisk.readContract({
        address: vault,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [user],
      }) as Promise<bigint>,
    ])

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
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return 0n

  try {
    const bal = await publicOptimism.readContract({
      address: addr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user],
    }) as bigint
    dbg('fetchReceiptBalance.bal', { which, bal: bal.toString() })
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
  return maxBigint(receipt, liskAssets)
}

async function morphoUSDT0ViaReceiptOrLisk(user: `0x${string}`): Promise<bigint> {
  dbg('morphoUSDT0ViaReceiptOrLisk()', { user })
  const [receipt, liskAssets] = await Promise.all([
    fetchReceiptBalance(user, 'USDT'),
    morphoSupplyLisk('USDT0', user),
  ])
  return maxBigint(receipt, liskAssets)
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all positions                                 */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  dbg('fetchPositions.start', { user })

  const tasks: Promise<Position>[] = []

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
      .then((amt) => ({ protocol: 'Morpho Blue' as const, chain: 'lisk' as const, token: 'WETH' as const, amount: amt }))
      .catch(() => ({ protocol: 'Morpho Blue' as const, chain: 'lisk' as const, token: 'WETH' as const, amount: 0n })),
  )

  const raw = await Promise.all(tasks)
  const nonZero = raw.filter((p) => p.amount > 0n)

  return nonZero
}
