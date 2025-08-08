// src/lib/withdraw.ts

import { WalletClient } from 'viem'
import { YieldSnapshot } from '@/hooks/useYields'
import { AAVE_POOL, COMET_POOLS } from '@/lib/constants'
import aaveAbi from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
import { optimism, base } from 'viem/chains'

export async function withdrawFromPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) {
    throw new Error('Wallet not connected')
  }

  /* ─── Aave v3 ─────────────────────────────────────────────────────────────── */
  if (snap.protocol === 'Aave v3') {
    // Aave only on optimism|base
    const chain = snap.chain as Extract<typeof snap.chain, 'optimism' | 'base'>
    const poolAddr = AAVE_POOL[chain]
    // the underlying token address must be provided on "snap.underlying"
    const tokenAddr = snap.underlying as `0x${string}`
    return wallet.writeContract({
      address: poolAddr,
      abi: aaveAbi,
      functionName: 'withdraw',
      args: [ tokenAddr, amount, owner ],
      chain: chain === 'base' ? base : optimism,
      account: owner,
    })
  }

  /* ─── Compound v3 (Comet) ─────────────────────────────────────────────────── */
  if (snap.protocol === 'Compound v3') {
    // Compound only on optimism|base and only USDC/USDT
    const chain = snap.chain as Extract<typeof snap.chain, 'optimism' | 'base'>
    // ensure token is USDC or USDT
    if (snap.token !== 'USDC' && snap.token !== 'USDT') {
      throw new Error(`Unsupported token for Compound v3: ${snap.token}`)
    }
    const poolAddr = COMET_POOLS[chain][snap.token]
    return wallet.writeContract({
      address: poolAddr,
      abi: cometAbi,
      functionName: 'withdraw',
      // Comet withdraw signature: withdraw(address to, uint256 amount)
      args: [ owner, amount ],
      chain: chain === 'base' ? base : optimism,
      account: owner,
    })
  }

  /* ─── Other protocols ─────────────────────────────────────────────────────── */
  throw new Error(`Unsupported protocol for withdraw: ${snap.protocol}`)
}
