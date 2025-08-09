// src/lib/withdraw.ts

import { WalletClient } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import { AAVE_POOL, COMET_POOLS, TokenAddresses } from '@/lib/constants'
import aaveAbi from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
import { optimism, base } from 'viem/chains'

type EvmChain = 'optimism' | 'base'

function asChainObj(chain: EvmChain) {
  return chain === 'base' ? base : optimism
}

/** Normalize protocol to a stable key like 'aave-v3' or 'compound-v3'. */
function normalizeProtocolKey(snap: YieldSnapshot): string {
  if (snap.protocolKey) return snap.protocolKey
  if (typeof snap.protocol === 'string') {
    return snap.protocol.trim().toLowerCase().replace(/\s+/g, '-')
  }
  return 'unknown'
}

/**
 * Withdraw base asset from a supported pool.
 * - Aave v3:     IPool.withdraw(address asset, uint256 amount, address to)
 * - Compound v3: Comet.withdraw(address asset, uint256 amount)
 */
export async function withdrawFromPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const key = normalizeProtocolKey(snap)

  /* ─── Aave v3 ─────────────────────────────────────────────────────────────── */
  if (key === 'aave-v3') {
    const chain = snap.chain as EvmChain
    // Resolve the ERC-20 asset address from constants (do not rely on snap.underlying)
    const tokenMap = TokenAddresses[snap.token] as Record<EvmChain, `0x${string}`>
    const asset    = tokenMap[chain]
    const pool     = AAVE_POOL[chain]

    return wallet.writeContract({
      address: pool,
      abi: aaveAbi,
      functionName: 'withdraw',
      args: [asset, amount, owner],
      chain: asChainObj(chain),
      account: owner,
    })
  }

  /* ─── Compound v3 (Comet) ─────────────────────────────────────────────────── */
  if (key === 'compound-v3') {
    const chain = snap.chain as EvmChain
    // Only USDC/USDT are supported on OP/Base
    if (snap.token !== 'USDC' && snap.token !== 'USDT') {
      throw new Error(`Unsupported token for Compound v3: ${snap.token}`)
    }

    const comet    = COMET_POOLS[chain][snap.token]
    const tokenMap = TokenAddresses[snap.token] as Record<EvmChain, `0x${string}`>
    const asset    = tokenMap[chain]

    // Correct signature: withdraw(address asset, uint256 amount)
    return wallet.writeContract({
      address: comet,
      abi: cometAbi,
      functionName: 'withdraw',
      args: [asset, amount],
      chain: asChainObj(chain),
      account: owner,
    })
  }

  throw new Error(`Unsupported protocol for withdraw: ${snap.protocol ?? key}`)
}
