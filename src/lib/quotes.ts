// src/lib/quotes.ts
import { client as acrossClient } from '@/lib/across'
import { publicLisk } from '@/lib/clients'
import { TokenAddresses } from '@/lib/constants'
import { optimism, base, lisk as liskChain } from 'viem/chains'
import type { Abi } from 'viem'

type Src = 'optimism' | 'base'

const VELODROME = {
  quoter:      '0x3FA596fAC2D6f7d16E01984897Ac04200Cb9cA05' as `0x${string}`,
  mixedQuoter: '0x2f7150B288ef1cc553207bD9fbd40D4e0e093B24' as `0x${string}`,
}

function tokenAddrFor(
  symbol: 'USDC' | 'USDCe' | 'USDT' | 'USDT0',
  chain: 'optimism' | 'base' | 'lisk'
): `0x${string}` {
  const addr = (TokenAddresses as any)[symbol]?.[chain]
  if (!addr) throw new Error(`Token ${symbol} not supported on ${chain}`)
  return addr
}

function chooseSrc(opBal?: bigint | null, baBal?: bigint | null, need?: bigint): Src {
  const a = opBal ?? BigInt(0)
  const b = baBal ?? BigInt(0)
  if (need != null) {
    if (a >= need) return 'optimism'
    if (b >= need) return 'base'
  }
  return a >= b ? 'optimism' : 'base'
}

/** -------- USDCe (Lisk) quoting: USDC (OP/Base) -> USDCe (Lisk) -------- */
export async function quoteUsdceOnLisk(params: {
  amountIn: bigint
  opBal?: bigint | null
  baBal?: bigint | null
}): Promise<{
  src: Src
  route: string
  bridgeFee: bigint
  bridgeOutUSDCe: bigint
}> {
  const { amountIn, opBal, baBal } = params
  const src = chooseSrc(opBal, baBal, amountIn)
  const inputToken  = tokenAddrFor('USDC',  src)     // USDC on OP/Base
  const outputToken = tokenAddrFor('USDCe', 'lisk')  // USDCe on Lisk
  const originChainId = src === 'optimism' ? optimism.id : base.id
  const destinationChainId = liskChain.id

  const q = await acrossClient.getQuote({
    route: { originChainId, destinationChainId, inputToken, outputToken },
    inputAmount: amountIn,
  })

  const fee =
    typeof q.fees?.totalRelayFee?.total === 'string'
      ? BigInt(q.fees.totalRelayFee.total)
      : BigInt(q.fees.totalRelayFee.total ?? 0)

  return {
    src,
    route: `${src.toUpperCase()} → LISK`,
    bridgeFee: fee,
    bridgeOutUSDCe: BigInt(q.deposit.outputAmount),
  }
}


async function quoteAcrossUSDTtoLiskUSDT(amountIn: bigint, src: Src) {
  const inputToken  = tokenAddrFor('USDT', src)
  const outputToken = tokenAddrFor('USDT', 'lisk')
  const originChainId = src === 'optimism' ? optimism.id : base.id
  const destinationChainId = liskChain.id

  const q = await acrossClient.getQuote({
    route: { originChainId, destinationChainId, inputToken, outputToken },
    inputAmount: amountIn,
  })

  const fee = typeof q.fees?.totalRelayFee?.total === 'string'
    ? BigInt(q.fees.totalRelayFee.total)
    : BigInt(q.fees.totalRelayFee.total ?? 0)

  return { route: `${src.toUpperCase()} → LISK`, fee, outUSDT: BigInt(q.deposit.outputAmount) }
}

async function quoteVelodromeUSDTtoUSDT0(amountIn: bigint): Promise<bigint | null> {
  const usdt  = tokenAddrFor('USDT',  'lisk')
  const usdt0 = tokenAddrFor('USDT0', 'lisk')

  // A) quoteExactInputSingle(address,address,uint256)
  const abiA: Abi = [{
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'view',
    inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }]
  try {
    return await publicLisk.readContract({ address: VELODROME.quoter, abi: abiA, functionName: 'quoteExactInputSingle', args: [usdt, usdt0, amountIn] }) as bigint
  } catch {}

  // B) tuple version
  const abiB: Abi = [{
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'view',
    inputs: [{
      name: 'params', type: 'tuple', components: [
        { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
        { name: 'amountIn', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }]
  try {
    return await publicLisk.readContract({
      address: VELODROME.mixedQuoter, abi: abiB, functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: usdt, tokenOut: usdt0, fee: 0, sqrtPriceLimitX96: BigInt(0), amountIn }],
    }) as bigint
  } catch {}

  // C) path version
  const abiC: Abi = [{
    type: 'function', name: 'quoteExactInput', stateMutability: 'view',
    inputs: [{ name: 'path', type: 'address[]' }, { name: 'amountIn', type: 'uint256' }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  }]
  try {
    return await publicLisk.readContract({
      address: VELODROME.quoter, abi: abiC, functionName: 'quoteExactInput',
      args: [[usdt, usdt0], amountIn],
    }) as bigint
  } catch {}

  return null
}

/**
 * Smart quote for USDT0 on Lisk.
 * - If USDT0 balance alone covers amount → on-chain, no swap/bridge.
 * - Else if USDT0 + USDT(Lisk) covers → swap-only (Velodrome).
 * - Else → bridge missing USDT from OP/Base, then swap (estimate).
 *
 * Returns a single object the modal can use without changing UI.
 */
// Helper: call our Sugar-backed API to quote USDT -> USDT0 on Lisk
async function quoteSugarUSDTtoUSDT0(amountIn: bigint): Promise<bigint | null> {
  try {
    const r = await fetch('/api/sugar-quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountInWei: amountIn.toString() }),
    })
    const j = await r.json()
    if (!j?.ok) return null
    return BigInt(j.amountOut ?? 0)
  } catch {
    return null
  }
}

/**
 * Smart quote for USDT0 on Lisk using Sugar (swap) + Across (bridge if needed).
 *
 * Rules:
 * 1) If liUSDT0 alone covers amount → no bridge, no swap.
 * 2) Else if (liUSDT0 + liUSDT) covers → swap-only on Lisk (Sugar).
 * 3) Else → bridge missing USDT from OP/Base (Across), then swap the available on Lisk (Sugar).
 *
 * Returns one object the modal can consume directly.
 */
export async function smartQuoteUsdt0Lisk(params: {
  amountIn: bigint
  opBal?: bigint | null
  baBal?: bigint | null
  liUSDT?: bigint | null
  liUSDT0?: bigint | null
}): Promise<{
  route: string
  bridgeFee: bigint
  receivedUSDT0: bigint
  error: string | null
}> {
  const need  = params.amountIn
  const have0 = params.liUSDT0 ?? BigInt(0)
  const haveU = params.liUSDT  ?? BigInt(0)

  // 1) Already have enough USDT0 on Lisk
  if (have0 >= need) {
    return { route: 'On-chain', bridgeFee: BigInt(0), receivedUSDT0: need, error: null }
  }

  // 2) Swap-only on Lisk (no bridge)
  if (have0 + haveU >= need) {
    const swapAmount = need - have0
    const est = await quoteSugarUSDTtoUSDT0(swapAmount)
    if (est == null) {
      // Couldn’t fetch Sugar quote — return what we have and surface an error
      return { route: 'On-chain', bridgeFee: BigInt(0), receivedUSDT0: have0, error: 'Swap quote unavailable' }
    }
    return { route: 'On-chain', bridgeFee: BigInt(0), receivedUSDT0: have0 + est, error: null }
  }

  // 3) Bridge missing USDT, then swap the available amount on Lisk
  const deficit = need - (have0 + haveU)
  const src = chooseSrc(params.opBal, params.baBal, deficit) // 'optimism' | 'base'
  const { route, fee, outUSDT } = await quoteAcrossUSDTtoLiskUSDT(deficit, src)

  // After bridging, how much can we actually swap?
  const totalUSDTOnLisk = haveU + outUSDT
  const swapNeeded = need - have0
  const maxSwappable = totalUSDTOnLisk < swapNeeded ? totalUSDTOnLisk : swapNeeded

  const est = await quoteSugarUSDTtoUSDT0(maxSwappable)
  if (est == null) {
    // Bridge quote OK but swap quote failed — report only existing USDT0
    return { route, bridgeFee: fee, receivedUSDT0: have0, error: 'Swap quote unavailable' }
  }

  return { route, bridgeFee: fee, receivedUSDT0: have0 + est, error: null }
}

