// src/components/DepositModal.tsx

'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

import { getDualBalances } from '@/lib/balances'
import { ensureLiquidity } from '@/lib/smartbridge'
import { depositToPool } from '@/lib/depositor'
import {
  TokenAddresses,
  COMET_POOLS,
  AAVE_POOL,
} from '@/lib/constants'
import type { YieldSnapshot } from '@/hooks/useYields'

import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { base, optimism, lisk as liskChain } from 'viem/chains'
import { client as acrossClient } from '@/lib/across'
import aaveAbi from '@/lib/abi/aavePool.json'
import { publicOptimism, publicBase } from '@/lib/clients'

type EvmChain = 'optimism' | 'base' | 'lisk'

/* ──────────────────────────────────────────────────────────────── */
/* Helpers                                                          */
/* ──────────────────────────────────────────────────────────────── */

const isCometToken = (t: YieldSnapshot['token']): t is 'USDC' | 'USDT' =>
  t === 'USDC' || t === 'USDT'

function clientFor(chain: Extract<EvmChain, 'optimism' | 'base'>) {
  return chain === 'optimism' ? publicOptimism : publicBase
}

/** Aave supplied balance (getUserAccountData), returned in 1e8 units. */
async function getAaveSuppliedBalance(params: {
  chain: Extract<EvmChain, 'optimism' | 'base'>
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, user } = params
  const client = clientFor(chain)
  const data = await client.readContract({
    address: AAVE_POOL[chain],
    abi: aaveAbi,
    functionName: 'getUserAccountData',
    args: [user],
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]
  const supplied = data[0] // 1e8
  return supplied
}

/** Comet (Compound v3) supplied balance uses 1e6 for USDC/USDT. */
async function getCometSuppliedBalance(params: {
  chain: Extract<EvmChain, 'optimism' | 'base'>
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, token, user } = params
  const comet = COMET_POOLS[chain][token]
  if (comet === '0x0000000000000000000000000000000000000000') return BigInt(0)

  const client = clientFor(chain)
  const bal = await client.readContract({
    address: comet,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal // 1e6
}

/** Map cross-chain tokens for Lisk:
 *  - If bridging to Lisk and token is USDC/USDT, we output USDCe/USDT0.
 *  - For OP/Base, keep tokens as-is.
 */
function mapCrossTokenForDest(
  symbol: YieldSnapshot['token'],
  dest: EvmChain,
): YieldSnapshot['token'] {
  if (dest !== 'lisk') return symbol
  if (symbol === 'USDC') return 'USDCe'
  if (symbol === 'USDT') return 'USDT0'
  return symbol
}

/** Resolve a token address on a given chain; throws if unsupported. */
function tokenAddrFor(
  symbol: YieldSnapshot['token'],
  chain: EvmChain,
): `0x${string}` {
  const m = TokenAddresses[symbol] as Partial<Record<EvmChain, `0x${string}`>>
  const addr = m?.[chain]
  if (!addr) throw new Error(`Token ${symbol} not supported on ${chain}`)
  return addr
}

/** Convert chain string to chainId */
function chainIdOf(chain: EvmChain) {
  if (chain === 'optimism') return optimism.id
  if (chain === 'base') return base.id
  return liskChain.id
}

/* ──────────────────────────────────────────────────────────────── */

interface DepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, isPending: isSwitching, error: switchError } = useSwitchChain()

  const [amount, setAmount] = useState('')
  const [opBal, setOpBal] = useState<bigint | null>(null) // wallet balance (token decimals)
  const [baBal, setBaBal] = useState<bigint | null>(null)

  // protocol supplied balances (Aave: 1e8, Comet: 1e6). Morpho shown on Lisk UI elsewhere.
  const [poolOp, setPoolOp] = useState<bigint | null>(null)
  const [poolBa, setPoolBa] = useState<bigint | null>(null)

  // Bridge preview
  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(BigInt(0))
  const [received, setReceived] = useState<bigint>(BigInt(0))
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Token decimals for wallet amounts & deposit input
  const tokenDecimals = useMemo(() => {
    if (snap.token === 'WETH') return 18
    return 6 // USDC/USDT(/e/0)
  }, [snap.token])

  // Pool decimals for supplied balances:
  // Aave v3: 1e8 (base currency units)
  // Comet v3: 1e6 (token units)
  const poolDecimals = useMemo(() => {
    if (snap.protocolKey === 'aave-v3') return 8
    if (snap.protocolKey === 'compound-v3') return 6
    return tokenDecimals // fallback
  }, [snap.protocolKey, tokenDecimals])

  // Load wallet balances (OP/BASE) if applicable for the token
  useEffect(() => {
    if (!open || !walletClient) return

    // Only fetch for tokens that exist on OP/BASE map
    const tb = TokenAddresses[snap.token] as Partial<Record<'optimism' | 'base', `0x${string}`>>
    if (!tb?.optimism && !tb?.base) {
      setOpBal(null)
      setBaBal(null)
      return
    }

    const user = walletClient.account.address as `0x${string}`
    if (tb.optimism && tb.base) {
      getDualBalances(
        { optimism: tb.optimism, base: tb.base },
        user,
      ).then(({ opBal, baBal }) => {
        setOpBal(opBal)
        setBaBal(baBal)
      })
    } else {
      // one side missing – read whichever exists
      (async () => {
        const [op, ba] = await Promise.all([
          tb.optimism
            ? getDualBalances({ optimism: tb.optimism, base: tb.optimism }, user).then((r) => r.opBal)
            : Promise.resolve<bigint | null>(null),
          tb.base
            ? getDualBalances({ optimism: tb.base, base: tb.base }, user).then((r) => r.baBal)
            : Promise.resolve<bigint | null>(null),
        ])
        setOpBal(op)
        setBaBal(ba)
      })()
    }
  }, [open, walletClient, snap.token])

  // Load user’s supplied balance on this protocol (Aave/Comet), per chain
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account.address as `0x${string}`

    if (snap.protocolKey === 'aave-v3') {
      Promise.allSettled([
        getAaveSuppliedBalance({ chain: 'optimism', user }),
        getAaveSuppliedBalance({ chain: 'base', user }),
      ]).then((results) => {
        const [op, ba] = results.map((r) => (r.status === 'fulfilled' ? r.value : BigInt(0)))
        setPoolOp(op)
        setPoolBa(ba)
      })
    } else if (snap.protocolKey === 'compound-v3') {
      if (isCometToken(snap.token)) {
        Promise.allSettled([
          getCometSuppliedBalance({ chain: 'optimism', token: snap.token, user }),
          getCometSuppliedBalance({ chain: 'base',     token: snap.token, user }),
        ]).then((results) => {
          const [op, ba] = results.map((r) => (r.status === 'fulfilled' ? r.value : BigInt(0)))
          setPoolOp(op)
          setPoolBa(ba)
        })
      } else {
        setPoolOp(BigInt(0))
        setPoolBa(BigInt(0))
      }
    } else {
      // morpho/lisk – not shown here (different units/pool)
      setPoolOp(null)
      setPoolBa(null)
    }
  }, [open, walletClient, snap.protocolKey, snap.token])

  // Bridge quote (only if cross-chain is needed)
  useEffect(() => {
    if (!walletClient || !amount) {
      setRoute(null)
      setFee(BigInt(0))
      setReceived(BigInt(0))
      setQuoteError(null)
      return
    }

    const dest = snap.chain as EvmChain
    const amt = parseUnits(amount, tokenDecimals)

    // figure source chain for funds (OP/BASE first; Lisk not a source for these tokens)
    // priority: enough balance on OP, then BASE, otherwise pick the max side
    const src: Extract<EvmChain, 'optimism' | 'base'> =
      (opBal ?? BigInt(0)) >= amt ? 'optimism'
      : (baBal ?? BigInt(0)) >= amt ? 'base'
      : ((opBal ?? BigInt(0)) >= (baBal ?? BigInt(0)) ? 'optimism' : 'base')

    if (src === dest) {
      setRoute('On-chain')
      setFee(BigInt(0))
      setReceived(amt)
      setQuoteError(null)
      return
    }

    // Prepare tokens for cross-chain, map to Lisk representations
    const outSymbol = mapCrossTokenForDest(snap.token, dest)
    const inputToken  = tokenAddrFor(snap.token, src)
    const outputToken = tokenAddrFor(outSymbol, dest)

    const srcId  = chainIdOf(src)
    const destId = chainIdOf(dest)

    acrossClient.getQuote({
      route: {
        originChainId: srcId,
        destinationChainId: destId,
        inputToken,
        outputToken,
      },
      inputAmount: amt,
    })
    .then((q) => {
      setRoute(`${src.toUpperCase()} → ${dest.toUpperCase()}`)
      // Across SDK fee shape: use the total (string/number) → to BigInt
      const feeTotal =
        typeof q.fees?.totalRelayFee?.total === 'string'
          ? BigInt(q.fees.totalRelayFee.total)
          : BigInt(q.fees.totalRelayFee.total ?? 0)
      setFee(feeTotal)
      setReceived(BigInt(q.deposit.outputAmount))
      setQuoteError(null)
    })
    .catch(() => {
      setRoute(null)
      setFee(BigInt(0))
      setReceived(BigInt(0))
      setQuoteError('Could not fetch bridge quote')
    })
  }, [amount, walletClient, opBal, baBal, snap.chain, snap.token, tokenDecimals])

  async function handleConfirm() {
    if (!walletClient) {
      openConnect()
      return
    }

    setBusy(true)
    setError(null)
    try {
      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const dest = snap.chain as EvmChain
      const destId = chainIdOf(dest)

      // 1) Ensure liquidity (bridge if needed)
      await ensureLiquidity(
        // Note: ensureLiquidity expects the *input* symbol.
        // When dest is Lisk, the internal bridge adapts to USDCe/USDT0 as needed.
        snap.token,
        inputAmt,
        dest,
        walletClient,
      )

      // 2) Switch chain if wallet isn’t on the destination
      if (chainId !== destId && switchChainAsync) {
        await switchChainAsync({ chainId: destId })
        setError(
          `Switched wallet to ${
            dest === 'optimism' ? 'Optimism' : dest === 'base' ? 'Base' : 'Lisk'
          }. Click Confirm again.`,
        )
        setBusy(false)
        return
      }

      // 3) Deposit *received* (after fees) if route existed, else input
      const toDeposit = received > BigInt(0) ? received : inputAmt
      await depositToPool(snap, toDeposit, walletClient)

      onClose()
      alert(`✅ Deposited ${formatUnits(toDeposit, tokenDecimals)} ${snap.token}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // ── pretty formatters ───────────────────────────────────────────
  const prettyToken = (bn: bigint | null | undefined) =>
    bn != null ? formatUnits(bn, tokenDecimals) : '…'

  const prettyPool = (bn: bigint | null | undefined) =>
    bn != null ? formatUnits(bn, poolDecimals) : '…'

  const combinedPool = useMemo(() => {
    if (poolOp == null && poolBa == null) return null
    return (poolOp ?? BigInt(0)) + (poolBa ?? BigInt(0))
  }, [poolOp, poolBa])

  // Strict boolean for Button.disabled (fixes TS error)
  const hasAmount: boolean =
    amount.trim().length > 0 && Number(amount) > 0

  const confirmDisabled: boolean =
    Boolean(busy) ||
    Boolean(isSwitching) ||
    !hasAmount ||
    Boolean(quoteError)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden shadow-xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-cyan-500 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-semibold">
              Deposit {snap.token}
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 bg-white">
          {/* Amount */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Amount</span>
              <span>
                OP: {prettyToken(opBal)} • Base: {prettyToken(baBal)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Input
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-2xl font-bold border-0 bg-white focus-visible:ring-0"
              />
              <span className="text-gray-600 font-semibold">{snap.token}</span>
            </div>
          </div>

          {/* Protocol balances (Aave uses 1e8; Comet uses 1e6) */}
          {(poolOp != null || poolBa != null) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-xs text-gray-500 font-medium mb-2">Your supplied balance</div>
              <div className="flex items-center justify-between text-sm">
                <span>Optimism</span>
                <span className="font-medium">{prettyPool(poolOp)} {snap.token}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span>Base</span>
                <span className="font-medium">{prettyPool(poolBa)} {snap.token}</span>
              </div>
              <div className="mt-2 border-t pt-2 flex items-center justify-between text-sm">
                <span>Total</span>
                <span className="font-semibold">
                  {combinedPool != null ? formatUnits(combinedPool, poolDecimals) : '…'} {snap.token}
                </span>
              </div>
            </div>
          )}

          {/* Route & Fees */}
          {route && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Route</span>
                <span className="font-medium">{route}</span>
              </div>
              {fee > BigInt(0) && (
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Bridge fee</span>
                  <span className="font-medium">
                    {formatUnits(fee, tokenDecimals)} {snap.token}
                  </span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-gray-500">Will deposit</span>
                <span className="font-semibold">
                  {formatUnits(received, tokenDecimals)} {snap.token}
                </span>
              </div>
              {quoteError && <p className="mt-2 text-xs text-red-600">{quoteError}</p>}
            </div>
          )}

          {/* Errors */}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {switchError && (
            <p className="text-xs text-red-600">Network switch failed: {switchError.message}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} title="Cancel">
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={confirmDisabled}
              title={isSwitching ? 'Switching…' : busy ? 'Processing…' : 'Confirm'}
            >
              {isSwitching ? 'Switching…' : busy ? 'Processing…' : 'Confirm'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
