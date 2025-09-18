// src/lib/positions.ts

import { publicOptimism, publicBase, publicLisk } from './clients'
import {
  AAVE_POOL,
  COMET_POOLS,
  MORPHO_POOLS,
  TokenAddresses,
  type TokenSymbol,
} from './constants'

import aaveAbi   from './abi/aavePool.json'
import cometAbi  from './abi/comet.json'
import { erc20Abi, parseUnits } from 'viem'
import type { Address } from 'viem'

// NEW: per-asset Aave balance helper (aToken balance)
import { getATokenAddress as _unused, getAaveATokenBalance } from './aave'


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

  let reserve: unknown
  try {
    reserve = await client.readContract({
      address: pool,
      abi:     aaveAbi,
      functionName: 'getReserveData',
      args: [asset],
    })
  } catch {
    return null
  }

  let liqRateRay: bigint | undefined
  if (Array.isArray(reserve)) {
    const v = reserve[2] // index where currentLiquidityRate commonly appears
    liqRateRay = typeof v === 'bigint' ? v : undefined
  } else if (reserve && typeof reserve === 'object' && 'currentLiquidityRate' in reserve) {
    const v = (reserve as Record<string, unknown>)['currentLiquidityRate']
    liqRateRay = typeof v === 'bigint' ? v : undefined
  }

  if (typeof liqRateRay !== 'bigint') return null

  const bps = (liqRateRay * BPS_MULTIPLIER) / RAY
  return Number(bps) / 100 // %
}

/* ──────────────────────────────────────────────────────────────── */
/* Compound v3 (Comet) APY (utility)                                */
/* ──────────────────────────────────────────────────────────────── */

export async function compoundSupplyApy(
  comet:  `0x${string}`,
  chain:  Extract<EvmChain, 'optimism' | 'base'>,
): Promise<number> {
  const client = pub(chain)
  const util   = await client.readContract({
    address: comet,
    abi: cometAbi,
    functionName: 'getUtilization',
  }) as bigint

  const rate   = await client.readContract({
    address: comet,
    abi: cometAbi,
    functionName: 'getSupplyRate',
    args: [util],
  }) as bigint

  // per-second 1e18 → annualized %
  return (Number(rate) / 1e18) * 31_536_000 * 100
}

/* ──────────────────────────────────────────────────────────────── */
/* Compound v3 supplied balance (Comet)                             */
/* balanceOf(user) in base token units (USDC/USDT -> 1e6)           */
/* ──────────────────────────────────────────────────────────────── */

async function cometSupply(
  chain: Extract<EvmChain, 'optimism' | 'base'>,
  token: Extract<TokenSymbol, 'USDC' | 'USDT'>,
  user:  `0x${string}`,
): Promise<bigint> {
  const pool = COMET_POOLS[chain][token]
  if (pool === '0x0000000000000000000000000000000000000000') return BigInt(0)

  const bal = await pub(chain).readContract({
    address: pool,
    abi:     cometAbi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal // 1e6
}

/* ──────────────────────────────────────────────────────────────── */
/* Morpho Blue (Lisk) – MetaMorpho vaults are ERC-4626              */
/* We read share balance, convert to assets via convertToAssets.    */
/* Returns amount in underlying units (USDCe/USDT0: 1e6, WETH: 1e18)*/
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

  // shares = balanceOf(user) on the ERC-4626 share token (vault)
  const shares = await publicLisk.readContract({
    address: vault,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  if (shares === BigInt(0)) return BigInt(0)

  // convert shares -> underlying assets
  const assets = await publicLisk.readContract({
    address: vault,
    abi: erc4626Abi,
    functionName: 'convertToAssets',
    args: [shares],
  }) as bigint

  return assets // underlying units
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all positions                                 */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  const tasks: Promise<Position>[] = []

  /* AAVE v3 */
  for (const chain of ['optimism', 'base'] as const) {
    for (const token of ['USDC', 'USDT'] as const) {
      tasks.push(
        getAaveATokenBalance(chain, token, user).then((amt) => ({
          protocol: 'Aave v3' as const,
          chain,
          token,
          amount: amt,
        })),
      )
    }
  }

  /* COMPOUND v3 */
  for (const chain of ['optimism', 'base'] as const) {
    for (const token of ['USDC', 'USDT'] as const) {
      tasks.push(
        cometSupply(chain, token, user).then((amt) => ({
          protocol: 'Compound v3' as const,
          chain,
          token,
          amount: amt,
        })),
      )
    }
  }

  /* MORPHO BLUE – Lisk vaults
     - USDCe: use OP receipt (sVault) as source of truth (6d)
     - USDT0, WETH: read from Lisk as before
  */
  tasks.push(
    morphoUSDCeViaReceiptOrLisk(user).then((amt) => ({
      protocol: 'Morpho Blue' as const,
      chain: 'lisk' as const,
      token: 'USDCe' as const,
      amount: amt,
    })),
  )
  for (const token of ['USDT0', 'WETH'] as const) {
    tasks.push(
      morphoSupplyLisk(token as 'USDT0' | 'WETH', user).then((amt) => ({
        protocol: 'Morpho Blue' as const,
        chain: 'lisk' as const,
        token: token as 'USDT0' | 'WETH',
        amount: amt,
      })),
    )
  }

  const raw = await Promise.all(tasks)
  return raw.filter((p) => p.amount > 0n)
}

// src/lib/positions.ts
export async function fetchVaultPosition(user: `0x${string}`): Promise<bigint> {
  const amount = await publicOptimism.readContract({
    address: TokenAddresses.sVault.optimism,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint
  return amount
}

// NEW: prefer OP receipt balance for USDCe; fallback to Lisk read only if needed
async function morphoUSDCeViaReceiptOrLisk(user: `0x${string}`): Promise<bigint> {
  const receipt = await fetchVaultPosition(user) // OP sVault (6 decimals)
  if (receipt > 0n) return receipt
  // fallback to Lisk vault assets if no receipt exists
  return morphoSupplyLisk('USDCe', user)
}
