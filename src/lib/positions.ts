import { WalletClient, PublicClient } from 'viem'
import { optimism, base } from 'viem/chains'
import { publicOptimism, publicBase } from './clients'
import {
  AAVE_POOL,
  COMET_POOLS,
  TokenAddresses,
  type TokenSymbol,
} from './constants'
import { erc20Abi } from 'viem'
// import aaveAbi  from '@/abi/aavePool.json'
import cometAbi from './abi/comet.json'

function pub(chain: 'optimism' | 'base') {
  return chain === 'optimism' ? publicOptimism : publicBase
}

/* ────────── AAVE V3 TOTALS ────────── */
const aaveAccountAbi = [
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
] as const

export interface AaveAccount {
  chain:    'optimism' | 'base'
  supplied: bigint  // 1e8 decimals
  debt:     bigint
}

export async function fetchAaveAccount(
  chain: 'optimism' | 'base',
  user:  `0x${string}`,
): Promise<AaveAccount> {
  console.debug(`[Aave] query ${chain} for`, user)

  const [supplied, debt] = await pub(chain).readContract({
    address: AAVE_POOL[chain],
    abi:     aaveAccountAbi,
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
