// src/lib/smartbridge.ts

import { publicOptimism, publicBase, publicLisk } from './clients'
import { erc20Abi } from 'viem'
import { TokenAddresses, type ChainId, type TokenSymbol } from './constants'
import type { WalletClient } from 'viem'

type EvmChain = ChainId

function clientFor(chain: EvmChain) {
  return chain === 'optimism' ? publicOptimism : chain === 'base' ? publicBase : publicLisk
}

/** Token address resolver – maps USDC/USDT to USDCe/USDT0 on Lisk */
export function addressFor(
  chain: EvmChain,
  symbol: TokenSymbol,
): `0x${string}` | null {
  if (chain === 'optimism' || chain === 'base') {
    if (symbol === 'USDC' || symbol === 'USDT')
      return TokenAddresses[symbol][chain] as `0x${string}`
    return null
  }
  // lisk
  if (symbol === 'USDC') return TokenAddresses.USDCe.lisk
  if (symbol === 'USDT') return TokenAddresses.USDT0.lisk
  if (symbol === 'WETH') return TokenAddresses.WETH.lisk
  if (symbol === 'USDCe') return TokenAddresses.USDCe.lisk
  if (symbol === 'USDT0') return TokenAddresses.USDT0.lisk
  return null
}

async function erc20Balance(
  chain: EvmChain,
  token: `0x${string}`,
  user: `0x${string}`
): Promise<bigint> {
  const client = clientFor(chain)
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as Promise<bigint>
}

/**
 * Ensure the user has `amount` of `symbol` on the `target` chain.
 * Will bridge only the shortfall. Valid routes:
 *  - OP ⇄ Base
 *  - OP/Base → Lisk
 */
export async function ensureLiquidity(
  symbol: TokenSymbol,
  amount: bigint,
  target: EvmChain,
  wallet: WalletClient,
) {
  const user = wallet.account?.address as `0x${string}`
  if (!user) throw new Error('Wallet not connected')

  // resolve per-chain token addresses (including Lisk aliases)
  const tokens: Partial<Record<EvmChain, `0x${string}`>> = {}
  for (const chain of ['optimism', 'base', 'lisk'] as const) {
    const addr = addressFor(chain, symbol)
    if (addr) tokens[chain] = addr
  }

  // read balances where token exists
  const balances: Record<EvmChain, bigint> = {
    optimism: BigInt(0),
    base: BigInt(0),
    lisk: BigInt(0),
  }
  await Promise.all(
    (Object.keys(balances) as EvmChain[]).map(async (c) => {
      const addr = tokens[c]
      if (addr) balances[c] = await erc20Balance(c, addr, user)
    })
  )

  const destBal = balances[target]
  if (destBal >= amount) return // already enough

  const missing = amount - destBal

  // choose routes
  const candidates: EvmChain[] =
    target === 'lisk' ? ['optimism', 'base']
    : target === 'optimism' ? ['base']
    : ['optimism']

  const from = candidates.find((c) => balances[c] >= missing)
  if (!from) {
    throw new Error(
      `Insufficient liquidity: need ${missing} ${symbol} on ${target}, but no source chain has enough`
    )
  }

  // Perform the bridge (your bridgeTokens should understand the aliasing on Lisk)
  const { bridgeTokens } = await import('./bridge')
  await bridgeTokens(symbol, missing, from, target, wallet)
}
