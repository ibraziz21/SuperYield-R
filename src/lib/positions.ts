
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
  supplied: bigint  // 1e8 decimals
  debt:     bigint
}
const RAY            = BigInt(10 ** 27)       // 1e27
const BPS_MULTIPLIER = BigInt(10_000)         // 1 % = 100 bp, so 1 bp = 0.01 %

export async function aaveSupplyApy(
  asset: `0x${string}`,
  chain: 'optimism' | 'base',
): Promise<number | null> {
  const client = chain === 'optimism' ? publicOptimism : publicBase
  const pool   = AAVE_POOL[chain]

  console.log('[aaveSupplyApy] ➜ querying', chain, 'pool', pool, 'asset', asset)

  /* ----- contract call ----- */
  let reserve: any
  try {
    console.time(`[aaveSupplyApy] RPC ${chain}`)
    reserve = await client.readContract({
      address: pool,
      abi:     aaveAbi,
      functionName: 'getReserveData',
      args: [asset],
    })
    console.timeEnd(`[aaveSupplyApy] RPC ${chain}`)
  } catch (err: any) {
    console.error('[aaveSupplyApy] ❌ readContract failed:', err.shortMessage ?? err.message ?? err)
    return null
  }

  /* Pretty-print the tuple / object (BigInts -> strings). */
  console.log(
    '[aaveSupplyApy] raw reserveData:',
    JSON.stringify(reserve, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  )

  /* currentLiquidityRate is index 2 in the tuple OR named key */
  const liqRateRay: bigint = Array.isArray(reserve)
    ? reserve[2]
    : (reserve.currentLiquidityRate as bigint)

  if (typeof liqRateRay !== 'bigint') {
    console.warn('[aaveSupplyApy] liquidityRate not bigint:', liqRateRay)
    return null
  }

  /* APY%  =  rateRay * 100 / 1e27
     Basis-points (bp) = rateRay * 10_000 / 1e27            */
  const bps  = (liqRateRay * BPS_MULTIPLIER) / RAY          // bigint math
  const apy: number = Number(bps) / 100                            // two-decimal %

  console.log('[aaveSupplyApy] ✓ liquidityRate (RAY):', liqRateRay.toString())
  console.log('[aaveSupplyApy] ✓ basis-points       :', bps.toString())
  console.log('[aaveSupplyApy] ✓ final % APY        :', apy)

  return apy
}

export async function compoundSupplyApy(
  comet:  `0x${string}`,
  chain:  'optimism' | 'base',
): Promise<number> {
  const client = chain === 'optimism' ? publicOptimism : publicBase
  const util   = await client.readContract({ address: comet, abi: cometAbi, functionName: 'getUtilization' }) as bigint
  const rate   = await client.readContract({ address: comet, abi: cometAbi, functionName: 'getSupplyRate', args: [util] }) as bigint
  return Number(rate) / 1e18 * 31_536_000 * 100   // % APY
}


export async function fetchAaveAccount(
  chain: 'optimism' | 'base',
  user:  `0x${string}`,
): Promise<AaveAccount> {
  console.debug(`[Aave] query ${chain} for`, user)

  const [supplied, debt] = await pub(chain).readContract({
    address: AAVE_POOL[chain],
    abi:     aaveAbi,
    functionName: 'getUserAccountData',
    args: [user],
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]

  console.debug(`[Aave] ${chain} supplied=${supplied} debt=${debt}`)
  return { chain, supplied, debt }
}

/* ────────── COMPOUND V3 BALANCE ────────── */
async function cometSupply(
  chain: 'optimism' | 'base',
  token: TokenSymbol,
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

  console.debug(`[Comet] ${chain} ${token} = ${bal}`)
  return bal
}

/* ────────── POSITIONS AGGREGATOR ────────── */
export interface Position {
  protocol: 'Aave v3' | 'Compound v3'
  chain:    'optimism' | 'base'
  token:    TokenSymbol
  amount:   bigint
}

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  const tasks: Promise<Position>[] = []

  for (const chain of ['optimism', 'base'] as const) {
    /* Aave supplies are chain-level, one per chain & token */
    tasks.push(
      fetchAaveAccount(chain, user).then(({ supplied }) => ({
        protocol: 'Aave v3',
        chain,
        token: 'USDC',          // show under USDC bucket
        amount: supplied,
      })),
    )

    /* Comet balances are per token */
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
  return raw.filter((p) => p.amount > BigInt(0))   // bigint literal
}
