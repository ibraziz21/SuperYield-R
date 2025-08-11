// src/lib/smartbridge.ts
import { publicOptimism, publicBase, publicLisk } from './clients'
import { erc20Abi } from 'viem'
import { TokenAddresses, type ChainId, type TokenSymbol } from './constants'
import { bridgeTokens } from './bridge'
import type { WalletClient } from 'viem'

function clientFor(chain: ChainId) {
  return chain === 'optimism'
    ? publicOptimism
    : chain === 'base'
    ? publicBase
    : publicLisk
}

/** Map a requested symbol to what exists on a chain for **balance reads**. */
function symbolOnChainForRead(symbol: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') return symbol // USDCe/USDT0/WETH/USDT all exist as declared
  // OP/Base cannot read USDCe/USDT0; map to canonical
  if (symbol === 'USDCe') return 'USDC'
  if (symbol === 'USDT0') return 'USDT'
  return symbol
}

function addressOnChain(symbol: TokenSymbol, chain: ChainId): `0x${string}` {
  const sym = symbolOnChainForRead(symbol, chain)
  const addr = (TokenAddresses[sym] as any)?.[chain]
  if (!addr) throw new Error(`Token ${sym} not supported on ${chain}`)
  return addr as `0x${string}`
}

async function getBalanceOnChain(
  chain: ChainId,
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
  return clientFor(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as Promise<bigint>
}

/** Ensure user has `amount` of the *destination token form* on `target`.
 *  - Lisk USDCe: source is USDC on OP/Base; bridge token = 'USDC'
 *  - Lisk USDT0: source is USDT on OP/Base; bridge token = 'USDT'
 */
export async function ensureLiquidity(
  symbol: TokenSymbol,   // UI selection (USDCe or USDT0 when target=lisk)
  amount: bigint,
  target: ChainId,
  wallet: WalletClient,
) {
  const user = wallet.account?.address as `0x${string}`
  if (!user) throw new Error('Wallet not connected')

  const chains: ChainId[] = ['optimism', 'base', 'lisk']
  const balances: Record<ChainId, bigint> = { optimism: BigInt(0), base: BigInt(0), lisk: BigInt(0) }

  // Read balances of the *displayed token* on each chain (mapping per-chain for OP/Base)
  await Promise.all(chains.map(async (c) => {
    try {
      const addr = addressOnChain(symbol, c)
      balances[c] = await getBalanceOnChain(c, addr, user)
    } catch {
      balances[c] = BigInt(0)
    }
  }))

  if (balances[target] >= amount) return

  const missing = amount - balances[target]

  // For bridging, decide which token should be bridged from OP/Base
  let bridgeToken: TokenSymbol = symbol
  if (target === 'lisk') {
    if (symbol === 'USDCe') bridgeToken = 'USDC'
    else if (symbol === 'USDT0') bridgeToken = 'USDT'
  }

  const sources: ChainId[] = target === 'lisk' ? ['optimism', 'base'] : ['optimism', 'base', 'lisk']

  // Check balances of the **bridge token** on OP/Base to find a source
  const sourceBalances: Record<ChainId, bigint> = { optimism: BigInt(0), base: BigInt(0), lisk: BigInt(0) }
  await Promise.all(sources.map(async (c) => {
    try {
      const addr = addressOnChain(bridgeToken, c)
      sourceBalances[c] = await getBalanceOnChain(c, addr, user)
    } catch {
      sourceBalances[c] = BigInt(0)
    }
  }))

  const from = sources.find((c) => sourceBalances[c] >= missing)
  if (!from) throw new Error(`Insufficient liquidity: need ${missing} ${symbol} on ${target}`)

  // Bridge the correct token (USDC or USDT) to Lisk
  await bridgeTokens(bridgeToken, missing, from, target, wallet)
}
