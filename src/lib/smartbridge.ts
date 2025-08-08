import { publicOptimism, publicBase, publicLisk } from './clients'
import { erc20Abi } from 'viem'
import { TokenAddresses, type ChainId, type TokenSymbol } from './constants'
import { bridgeTokens } from './bridge'
import type { WalletClient } from 'viem'

/**
 * Fetch ERC-20 balance of user on a given chain
 */
async function getBalanceOnChain(
  chain: ChainId,
  token: `0x${string}`,
  user: `0x${string}`
): Promise<bigint> {
  const client =
    chain === 'optimism'
      ? publicOptimism
      : chain === 'base'
      ? publicBase
      : publicLisk
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as Promise<bigint>
}

/**
 * Ensure the user has enough token on the target chain,
 * bridging a shortfall from another chain if needed.
 */
export async function ensureLiquidity(
  symbol: TokenSymbol,
  amount: bigint,
  target: ChainId,
  wallet: WalletClient,
) {
  // 1 — require connected wallet
  const user = wallet.account?.address as `0x${string}`
  if (!user) throw new Error('Wallet not connected')

  // 2 — compute balances across all chains
  const tokenMap = TokenAddresses[symbol] as unknown as Record<ChainId, `0x${string}`>
  const balances: Record<ChainId, bigint> = {
    optimism: BigInt(0),
    base: BigInt(0),
    lisk: BigInt(0),
  }
  for (const chain of Object.keys(balances) as ChainId[]) {
    if (tokenMap[chain]) {
      balances[chain] = await getBalanceOnChain(
        chain,
        tokenMap[chain],
        user,
      )
    }
  }

  // 3 — if already enough on target, nothing to do
  if (balances[target] >= amount) return

  // 4 — amount missing
  const missing = amount - balances[target]

  // 5 — pick a source chain with sufficient balance
  const sourceChains = (['optimism', 'base', 'lisk'] as ChainId[]).filter(
    (c) => c !== target,
  )
  const from = sourceChains.find((c) => balances[c] >= missing)
  if (!from) {
    throw new Error(
      `Insufficient liquidity: need ${missing} ${symbol} on ${target},` +
        ` but no other chain has enough`,
    )
  }

  // 6 — perform bridge
  await bridgeTokens(symbol, missing, from, target, wallet)
}
