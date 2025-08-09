// src/lib/depositor.ts

import { WalletClient } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import {
  TokenAddresses,
  AAVE_POOL,
  COMET_POOLS,
  type TokenSymbol,
} from './constants'
import { erc20Abi } from 'viem'
import aaveAbi from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
// This ABI should include standard ERC-4626 functions: deposit, mint, previewDeposit
// If your existing morphoLisk.json already has them, keep using it.
// Otherwise replace import below with an ERC-4626 ABI file.
import morphoAbi from './abi/morphoLisk.json'

import { publicOptimism, publicBase, publicLisk } from './clients'
import type { YieldSnapshot } from '@/hooks/useYields'

/* ----------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------*/
export type ChainId = 'optimism' | 'base' | 'lisk'

/* ----------------------------------------------------------------------
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

/* ----------------------------------------------------------------------
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
 * Helper: map UI token → Lisk underlying for MetaMorpho vaults
 * (USDC → USDCe, USDT → USDT0, WETH → WETH)
 * ---------------------------------------------------------------------*/
function morphoUnderlyingOnLisk(sym: YieldSnapshot['token']): TokenSymbol {
  if (sym === 'USDC') return 'USDCe'
  if (sym === 'USDT') return 'USDT0'
  return 'WETH'
}

/* ----------------------------------------------------------------------
 * Main deposit dispatcher
 * ---------------------------------------------------------------------*/
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

  /* ---------- Morpho MetaMorpho v1.1 (ERC-4626 vault on Lisk) ---------- */
  if (snap.protocolKey === 'morpho-blue') {
    const chain: ChainId = 'lisk'
    const vault = snap.poolAddress as `0x${string}` // the MetaMorpho vault (ERC-4626)

    // Map UI fiat tokens to Lisk underlyings
    const underlyingSymbol = morphoUnderlyingOnLisk(snap.token)
    const tokenAddr = (TokenAddresses[underlyingSymbol] as { lisk: `0x${string}` })
      .lisk

    // Approve vault to pull underlying
    await ensureAllowance(tokenAddr, vault, amount, wallet, chain)

    // Prefer ERC-4626 `deposit(assets, receiver)`, else fall back to `mint(shares, receiver)`
    try {
      // Try deposit first (most intuitive: we have `amount` assets)
      await wallet.writeContract({
        address: vault,
        abi: morphoAbi,
        functionName: 'deposit',
        args: [amount, owner],
        chain: lisk,
        account: owner,
      })
    } catch (depositErr) {
      // If `deposit` not present/allowed, compute shares via preview and call mint
      const shares = (await publicLisk.readContract({
        address: vault,
        abi: morphoAbi,
        functionName: 'previewDeposit',
        args: [amount],
      })) as bigint

      await wallet.writeContract({
        address: vault,
        abi: morphoAbi,
        functionName: 'mint',
        args: [shares, owner],
        chain: lisk,
        account: owner,
      })
    }

    return
  }

  throw new Error(`Unsupported protocol ${snap.protocolKey}`)
}
