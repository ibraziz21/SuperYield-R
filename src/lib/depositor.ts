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

  if (allowance >= amt) return // already approved enough

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
   --------------------------------------------------------------------*/
export async function depositToPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) return

  /* ---------- Aave v3 ---------- */
  if (snap.protocolKey === 'aave-v3') {
    const chain = snap.chain as ChainId // optimistic | base only
    if (chain === 'lisk') throw new Error('Aave v3 not supported on Lisk')

    const tokenAddr = TokenAddresses[snap.token][chain]
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
    const chain = snap.chain as ChainId
    if (chain === 'lisk') throw new Error('Compound v3 not supported on Lisk')

    const tokenSym = snap.token 
    const tokenAddr = TokenAddresses[tokenSym][chain]
    const poolAddr = COMET_POOLS[chain][tokenSym]

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
    const tokenAddr = TokenAddresses[snap.token as TokenSymbol][chain]
    const poolAddr = MORPHO_POOLS[snap.pool as keyof typeof MORPHO_POOLS]

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
