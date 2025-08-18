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

/**
 * Ensure user has `amount` of the **destination token form** on `target`
 * and wait until funds actually arrive (single call).
 *
 * - If target=Lisk + USDT0 → we source USDT on OP/Base, but **bridge to USDT0** directly (LI.FI).
 * - If target=Lisk + USDCe → we source USDC on OP/Base, but **bridge to USDCe**.
 *
 * `onStatus`: 'bridging' | 'waiting' | 'done'
 */
export async function ensureLiquidity(
  symbol: TokenSymbol,   // desired token on the target chain (e.g., 'USDT0' on Lisk)
  amount: bigint,
  target: ChainId,
  wallet: WalletClient,
  opts?: {
    timeoutMs?: number
    pollMs?: number
    onStatus?: (s: 'bridging' | 'waiting' | 'done') => void
  }
) {
  const user = wallet.account?.address as `0x${string}`
  if (!user) throw new Error('Wallet not connected')

  const timeoutMs = opts?.timeoutMs ?? 15 * 60 * 1000
  const pollMs    = opts?.pollMs    ?? 10_000

  // Destination token & starting balance snapshot
  const destTokenAddr = addressOnChain(symbol, target)
  const startBal = await getBalanceOnChain(target, destTokenAddr, user)

  // Already enough? Done.
  if (startBal >= amount) {
    opts?.onStatus?.('done')
    return { finalBalance: startBal, delta: 0n }
  }

  // Determine source side token & chain balances
  const chains: ChainId[] = ['optimism', 'base', 'lisk']
  const balances: Record<ChainId, bigint> = { optimism: 0n, base: 0n, lisk: 0n }

  // Read displayed token on each chain (for target, it's the final form e.g. USDT0)
  await Promise.all(chains.map(async (c) => {
    try {
      const addr = addressOnChain(symbol, c)
      balances[c] = await getBalanceOnChain(c, addr, user)
    } catch {
      balances[c] = 0n
    }
  }))

  const missing = amount - balances[target]

  if (missing > 0n) {
    // For bridging, decide which **source representation** to use on OP/Base
    // (USDT0 → USDT, USDCe → USDC)
    let bridgeTokenForSource: TokenSymbol = symbol
    if (target === 'lisk') {
      if (symbol === 'USDCe') bridgeTokenForSource = 'USDC'
      else if (symbol === 'USDT0') bridgeTokenForSource = 'USDT'
    }

    const sources: ChainId[] = target === 'lisk' ? ['optimism', 'base'] : ['optimism', 'base', 'lisk']
    const sourceBalances: Record<ChainId, bigint> = { optimism: 0n, base: 0n, lisk: 0n }
    await Promise.all(sources.map(async (c) => {
      try {
        const addr = addressOnChain(bridgeTokenForSource, c)
        sourceBalances[c] = await getBalanceOnChain(c, addr, user)
      } catch {
        sourceBalances[c] = 0n
      }
    }))

    const from = sources.find((c) => sourceBalances[c] >= missing)
    if (!from) throw new Error(`Insufficient liquidity: need ${missing} ${symbol} on ${target}`)

    // Which token should we **receive** on the target chain?
    const tokenToReceiveOnDest: TokenSymbol =
      target === 'lisk' && symbol === 'USDT0' ? 'USDT0'
      : target === 'lisk' && symbol === 'USDCe' ? 'USDCe'
      : symbol

    // Execute LI.FI (single call)
    opts?.onStatus?.('bridging')
    await bridgeTokens(tokenToReceiveOnDest, missing, from, target, wallet)
  }

  // Wait until balance increases on target
  opts?.onStatus?.('waiting')
  const started = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timeout waiting for bridged funds')
    }
    const bal = await getBalanceOnChain(target, destTokenAddr, user)
    if (bal > startBal) {
      opts?.onStatus?.('done')
      return { finalBalance: bal, delta: bal - startBal }
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
