// src/lib/depositor.ts

import { WalletClient } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import {
  TokenAddresses,
  AAVE_POOL,
  COMET_POOLS,
  MORPHO_POOLS,
  type TokenSymbol,
} from './constants'
import { erc20Abi } from 'viem'
import aaveAbi from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
import morphoAbi from './abi/morphoLisk.json'
import { publicOptimism, publicBase, publicLisk } from './clients'
import type { YieldSnapshot } from '@/hooks/useYields'

/** ----------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------*/
export type ChainId = 'optimism' | 'base' | 'lisk'

/** ----------------------------------------------------------------------
 * Public client picker
 * ---------------------------------------------------------------------*/
function pub(chain: ChainId) {
  switch (chain) {
    case 'optimism':
      return publicOptimism
    case 'base':
      return publicBase
    default:
      return publicLisk
  }
}

/** ----------------------------------------------------------------------
 * Allowance helper – checks & approves if necessary
 * ---------------------------------------------------------------------*/
export async function ensureAllowance(
  token: `0x${string}`,
  spender: `0x${string}`,
  amt: bigint,
  wallet: WalletClient,
  chain: ChainId,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) return

  const allowance = (await pub(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint

  if (allowance >= amt) return

  await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amt],
    chain: chain === 'optimism' ? optimism : chain === 'base' ? base : lisk,
    account: owner,
  })
}

/* ----------------------------------------------------------------------
   Main deposit dispatcher
---------------------------------------------------------------------*/
export async function depositToPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) return

  /* ---------- Aave v3 ---------- */
  if (snap.protocolKey === 'aave-v3') {
    const chain = snap.chain as Extract<ChainId, 'optimism' | 'base'>
    const tokenMap = TokenAddresses[snap.token] as Record<
      'optimism' | 'base',
      `0x${string}`
    >
    const tokenAddr = tokenMap[chain]
    const poolAddr = AAVE_POOL[chain]

    await ensureAllowance(tokenAddr, poolAddr, amount, wallet, chain)

    await wallet.writeContract({
      address: poolAddr,
      abi: aaveAbi,
      functionName: 'supply',
      args: [tokenAddr, amount, owner, 0],
      chain: chain === 'optimism' ? optimism : base,
      account: owner,
    })
    return
  }

  /* ---------- Compound v3 (Comet) ---------- */
  if (snap.protocolKey === 'compound-v3') {
    const chain = snap.chain as Extract<ChainId, 'optimism' | 'base'>
    const tokenMap = TokenAddresses[snap.token] as Record<
      'optimism' | 'base',
      `0x${string}`
    >
    const tokenAddr = tokenMap[chain]
    const poolAddr = COMET_POOLS[chain][snap.token as 'USDC' | 'USDT']

    await ensureAllowance(tokenAddr, poolAddr, amount, wallet, chain)

    await wallet.writeContract({
      address: poolAddr,
      abi: cometAbi,
      functionName: 'supply',
      args: [tokenAddr, amount],
      chain: chain === 'optimism' ? optimism : base,
      account: owner,
    })
    return
  }

  /* ---------- Morpho Blue (MetaMorpho vault) ---------- */
  if (snap.protocolKey === 'morpho-blue') {
    const chain: ChainId = 'lisk'
    // use snap.poolAddress instead of nonexistent snap.pool
    const vaultAddr = snap.poolAddress as `0x${string}`
    const tokenMap = TokenAddresses[snap.token as TokenSymbol] as { lisk: `0x${string}` }
    const tokenAddr = tokenMap.lisk
    const poolAddr = MORPHO_POOLS[vaultAddr as keyof typeof MORPHO_POOLS]

    await ensureAllowance(tokenAddr, poolAddr, amount, wallet, chain)

    await wallet.writeContract({
      address: poolAddr,
      abi: morphoAbi,
      functionName: 'supply',
      args: [tokenAddr, amount, owner],
      chain: lisk,
      account: owner,
    })
    return
  }

  throw new Error(`Unsupported protocol ${snap.protocolKey}`)
}
