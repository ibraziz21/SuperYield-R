// src/lib/positions.ts

import { publicOptimism, publicBase, publicLisk } from './clients'
import {
  AAVE_POOL,
  COMET_POOLS,
  MORPHO_POOLS,
  type TokenSymbol,
} from './constants'

import aaveAbi   from './abi/aavePool.json'
import cometAbi  from './abi/comet.json'
import { erc20Abi } from 'viem'
import type { Address } from 'viem'

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

export interface AaveAccount {
  chain:    Extract<EvmChain, 'optimism' | 'base'>
  supplied: bigint  // 1e8 base units (see Aave v3 getUserAccountData)
  debt:     bigint
}

/** Unified position type across protocols & chains. */
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

  // reserve data can be tuple or named struct (viem returns both)
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

  // pick currentLiquidityRate (RAY)
  let liqRateRay: bigint | undefined
  if (Array.isArray(reserve)) {
    // empirically index 2 is currentLiquidityRate in Aave v3 ReserveData
    const v = reserve[2]
    liqRateRay = typeof v === 'bigint' ? v : undefined
  } else if (reserve && typeof reserve === 'object' && 'currentLiquidityRate' in reserve) {
    const v = (reserve as Record<string, unknown>)['currentLiquidityRate']
    liqRateRay = typeof v === 'bigint' ? v : undefined
  }

  if (typeof liqRateRay !== 'bigint') return null

  const bps  = (liqRateRay * BPS_MULTIPLIER) / RAY
  const apy  = Number(bps) / 100 // % with two decimals notionally
  return apy
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

  // rate is per-second (1e18), annualize (seconds per year)
  return (Number(rate) / 1e18) * 31_536_000 * 100
}

/* ──────────────────────────────────────────────────────────────── */
/* Aave v3 supplied balance (per chain, user)                       */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchAaveAccount(
  chain: Extract<EvmChain, 'optimism' | 'base'>,
  user:  `0x${string}`,
): Promise<AaveAccount> {
  const data = await pub(chain).readContract({
    address: AAVE_POOL[chain],
    abi:     aaveAbi,
    functionName: 'getUserAccountData',
    args: [user],
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]

  const supplied = data[0] // Aave v3: totalCollateralBase (1e8)
  const debt     = data[1] // totalDebtBase (1e8)
  return { chain, supplied, debt }
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

/** Map lisk tokens → MetaMorpho vault address */
const MORPHO_VAULT_BY_TOKEN: Record<
  Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>,
  `0x${string}`
> = {
  USDCe: MORPHO_POOLS['usdce-supply'] as Address,
  USDT0: MORPHO_POOLS['usdt0-supply'] as Address,
  WETH:  MORPHO_POOLS['weth-supply']  as Address,
}

async function morphoSupplyLisk(
  token: Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>,
  user:  `0x${string}`,
): Promise<bigint> {
  const vault = MORPHO_VAULT_BY_TOKEN[token]

  // 1) shares = balanceOf(user) on the ERC-4626 share token (vault)
  const shares = await publicLisk.readContract({
    address: vault,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  if (shares === BigInt(0)) return BigInt(0)

  // 2) convert shares -> underlying assets
  const assets = await publicLisk.readContract({
    address: vault,
    abi: erc4626Abi,
    functionName: 'convertToAssets',
    args: [shares],
  }) as bigint

  return assets // underlying units: WETH 1e18, USDCe/USDT0 1e6
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all positions                                 */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  const tasks: Promise<Position>[] = []

  /* AAVE v3 – chain-level "total supplied" (1e8) – bucket under USDC */
  for (const chain of ['optimism', 'base'] as const) {
    tasks.push(
      fetchAaveAccount(chain, user).then(({ supplied }) => ({
        protocol: 'Aave v3' as const,
        chain,
        token: 'USDC' as const, // display under USDC bucket
        amount: supplied,       // 1e8 units (base currency)
      })),
    )
  }

  /* COMPOUND v3 – per token (USDC/USDT) on optimism|base (1e6) */
  for (const chain of ['optimism', 'base'] as const) {
    for (const token of ['USDC', 'USDT'] as const) {
      tasks.push(
        cometSupply(chain, token, user).then((amt) => ({
          protocol: 'Compound v3' as const,
          chain,
          token,
          amount: amt, // 1e6
        })),
      )
    }
  }

  /* MORPHO BLUE – Lisk vaults (ERC-4626 -> assets) */
  for (const token of ['USDCe', 'USDT0', 'WETH'] as const) {
    tasks.push(
      morphoSupplyLisk(token, user).then((amt) => ({
        protocol: 'Morpho Blue' as const,
        chain: 'lisk' as const,
        token,
        amount: amt, // WETH: 1e18, USDCe/USDT0: 1e6
      })),
    )
  }

  const raw = await Promise.all(tasks)
  return raw.filter((p) => p.amount > BigInt(0))
}
