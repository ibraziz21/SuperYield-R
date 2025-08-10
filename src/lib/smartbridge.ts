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

// Map a canonical symbol to the token that actually exists on each chain
function symbolOnChain(symbol: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain !== 'lisk') return symbol
  if (symbol === 'USDC') return 'USDCe'
  if (symbol === 'USDT') return 'USDT0'
  return symbol // WETH stays WETH
}

function addressOnChain(symbol: TokenSymbol, chain: ChainId): `0x${string}` {
  const s = symbolOnChain(symbol, chain)
  const addr = (TokenAddresses[s] as any)?.[chain]
  if (!addr) throw new Error(`Token ${s} not supported on ${chain}`)
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

/** Ensure the user has `amount` of the *correct token on that chain* (USDCe/USDT0 on Lisk). */
export async function ensureLiquidity(
  symbol: TokenSymbol,          // canonical input, e.g. USDC
  amount: bigint,               // required *destination* amount (post-fee if bridging)
  target: ChainId,
  wallet: WalletClient,
) {
  const user = wallet.account?.address as `0x${string}`
  if (!user) throw new Error('Wallet not connected')

  // compute balances of the *right token per chain*
  const chains: ChainId[] = ['optimism', 'base', 'lisk']
  const balances: Record<ChainId, bigint> = { optimism: BigInt(0), base: BigInt(0), lisk: BigInt(0) }

  await Promise.all(chains.map(async (c) => {
    try {
      const addr = addressOnChain(symbol, c)
      balances[c] = await getBalanceOnChain(c, addr, user)
    } catch {
      balances[c] = BigInt(0) // not supported on that chain
    }
  }))

  if (balances[target] >= amount) return

  const missing = amount - balances[target]

  // Prefer OP → Lisk or Base → Lisk when target is Lisk
  const sources: ChainId[] =
    target === 'lisk' ? ['optimism', 'base'] : ['optimism', 'base', 'lisk']

  const from = sources.find((c) => balances[c] >= missing)
  if (!from) {
    throw new Error(`Insufficient liquidity: need ${missing} ${symbolOnChain(symbol, target)} on ${target}`)
  }

  // bridge canonical; bridgeTokens will map output to USDCe/USDT0 on Lisk
  await bridgeTokens(symbol, missing, from, target, wallet)
}
