// src/lib/positions.ts

import { publicOptimism, publicBase } from './clients'
import {
  AAVE_POOL,
  COMET_POOLS,
  type TokenSymbol,
} from './constants'

import aaveAbi  from './abi/aavePool.json'
import cometAbi from './abi/comet.json'

function pub(chain: 'optimism' | 'base') {
  return chain === 'optimism' ? publicOptimism : publicBase
}

export interface AaveAccount {
  chain:    'optimism' | 'base'
  supplied: bigint
  debt:     bigint
}

const RAY            = BigInt(10 ** 27)
const BPS_MULTIPLIER = BigInt(10_000)

export async function aaveSupplyApy(
  asset: `0x${string}`,
  chain: 'optimism' | 'base',
): Promise<number | null> {
  const client = pub(chain)
  const pool   = AAVE_POOL[chain]

  let reserve: any
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

  const liqRateRay: bigint = Array.isArray(reserve)
    ? reserve[2]
    : (reserve.currentLiquidityRate as bigint)

  if (typeof liqRateRay !== 'bigint') return null

  const bps = (liqRateRay * BPS_MULTIPLIER) / RAY
  return Number(bps) / 100
}

export async function compoundSupplyApy(
  comet:  `0x${string}`,
  chain:  'optimism' | 'base',
): Promise<number> {
  const client = pub(chain)
  const util   = (await client.readContract({
    address: comet,
    abi:     cometAbi,
    functionName: 'getUtilization',
  })) as bigint
  const rate   = (await client.readContract({
    address: comet,
    abi:     cometAbi,
    functionName: 'getSupplyRate',
    args: [util],
  })) as bigint

  return (Number(rate) / 1e18) * 31_536_000 * 100
}

export async function fetchAaveAccount(
  chain: 'optimism' | 'base',
  user:  `0x${string}`,
): Promise<AaveAccount> {
  const [supplied, debt] = (await pub(chain).readContract({
    address: AAVE_POOL[chain],
    abi:     aaveAbi,
    functionName: 'getUserAccountData',
    args: [user],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]

  return { chain, supplied, debt }
}

// ────────── COMPOUND V3 BALANCE ──────────
async function cometSupply(
  chain: 'optimism' | 'base',
  token: 'USDC' | 'USDT',
  user:  `0x${string}`,
): Promise<bigint> {
  const pool = COMET_POOLS[chain][token]
  if (pool === '0x0000000000000000000000000000000000000000') {
    return BigInt(0)
  }
  return (await pub(chain).readContract({
    address: pool,
    abi:     cometAbi,
    functionName: 'balanceOf',
    args: [user],
  })) as bigint
}

export interface Position {
  protocol: 'Aave v3' | 'Compound v3'
  chain:    'optimism' | 'base'
  token:    TokenSymbol
  amount:   bigint
}

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  const tasks: Promise<Position>[] = []

  for (const chain of ['optimism', 'base'] as const) {
    // Aave position
    tasks.push(
      fetchAaveAccount(chain, user).then(({ supplied }) => ({
        protocol: 'Aave v3',
        chain,
        token: 'USDC',
        amount: supplied,
      })),
    )

    // Compound positions for USDC and USDT only
    for (const token of ['USDC', 'USDT'] as const) {
      tasks.push(
        cometSupply(chain, token, user).then((amt) => ({
          protocol: 'Compound v3',
          chain,
          token,
          amount: amt,
        })),
      )
    }
  }

  const raw = await Promise.all(tasks)
  return raw.filter((p) => p.amount > BigInt(0))
}
