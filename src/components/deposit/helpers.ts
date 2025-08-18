// ─────────────────────────────────────────────────────────────────────────────
// file: src/components/deposit/helpers.ts
// ─────────────────────────────────────────────────────────────────────────────
'use client'
import { erc20Abi, type Address } from 'viem'
import { base, optimism, lisk as liskChain } from 'viem/chains'
import { publicOptimism, publicBase, publicLisk } from '@/lib/clients'
import { TokenAddresses, COMET_POOLS, AAVE_POOL } from '@/lib/constants'
import aaveAbi from '@/lib/abi/aavePool.json'
import type { YieldSnapshot } from '@/hooks/useYields'
import type { EvmChain } from './types'

export const isCometToken = (t: YieldSnapshot['token']): t is 'USDC' | 'USDT' =>
  t === 'USDC' || t === 'USDT'

export function clientFor(chain: EvmChain) {
  if (chain === 'optimism') return publicOptimism
  if (chain === 'base') return publicBase
  return publicLisk
}

export function chainIdOf(chain: EvmChain) {
  if (chain === 'optimism') return optimism.id
  if (chain === 'base') return base.id
  return liskChain.id
}

/** Lisk mapping for bridge preview */
export function mapCrossTokenForDest(symbol: YieldSnapshot['token'], dest: EvmChain): YieldSnapshot['token'] {
  if (dest !== 'lisk') return symbol
  if (symbol === 'USDC') return 'USDCe'
  if (symbol === 'USDT') return 'USDT0'
  return symbol
}

/** Resolve token address for a chain */
export function tokenAddrFor(symbol: YieldSnapshot['token'], chain: EvmChain): `0x${string}` {
  const m = TokenAddresses[symbol] as Partial<Record<EvmChain, `0x${string}`>>
  const addr = m?.[chain]
  if (!addr) throw new Error(`Token ${symbol} not supported on ${chain}`)
  return addr
}

/** For display: map chosen token to per-chain wallet token symbol. */
export function symbolForWalletDisplay(symbol: YieldSnapshot['token'], chain: EvmChain): YieldSnapshot['token'] {
  if (chain === 'lisk') {
    if (symbol === 'USDC') return 'USDCe'
    if (symbol === 'USDT') return 'USDT0'
    return symbol
  } else {
    if (symbol === 'USDCe') return 'USDC'
    if (symbol === 'USDT0') return 'USDT'
    return symbol
  }
}

/** Read wallet balance for a token on a chain */
export async function readWalletBalance(chain: EvmChain, token: `0x${string}`, user: `0x${string}`): Promise<bigint> {
  return (await clientFor(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  })) as bigint
}

/** Aave: totalCollateralBase (1e8) – for supplied display */
export async function getAaveSuppliedBalance(params: { chain: Extract<EvmChain, 'optimism' | 'base'>; user: `0x${string}` }): Promise<bigint> {
  const { chain, user } = params
  const data = (await clientFor(chain).readContract({
    address: AAVE_POOL[chain],
    abi: aaveAbi as any,
    functionName: 'getUserAccountData',
    args: [user],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]
  return data[0]
}

/** Comet: balanceOf (1e6) */
export async function getCometSuppliedBalance(params: { chain: Extract<EvmChain, 'optimism' | 'base'>; token: 'USDC' | 'USDT'; user: `0x${string}` }): Promise<bigint> {
  const { chain, token, user } = params
  const comet = COMET_POOLS[chain][token]
  if (comet === '0x0000000000000000000000000000000000000000') return 0n
  const bal = (await clientFor(chain).readContract({
    address: comet as Address,
    abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
    functionName: 'balanceOf',
    args: [user],
  })) as bigint
  return bal
}