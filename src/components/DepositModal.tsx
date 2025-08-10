// src/components/DepositModal.tsx
'use client'

import { FC, useEffect, useMemo, useRef, useState } from 'react'
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
import { TokenAddresses, COMET_POOLS, AAVE_POOL } from '@/lib/constants'
import type { YieldSnapshot } from '@/hooks/useYields'

import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { base, optimism, lisk as liskChain } from 'viem/chains'
import { client as acrossClient } from '@/lib/across'
import aaveAbi from '@/lib/abi/aavePool.json'
import { publicOptimism, publicBase, publicLisk } from '@/lib/clients'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { erc20Abi } from 'viem'

type EvmChain = 'optimism' | 'base' | 'lisk'

/* ---------------------------------------------------------------- */
/* Helpers                                                          */
/* ---------------------------------------------------------------- */

const isCometToken = (t: YieldSnapshot['token']): t is 'USDC' | 'USDT' =>
  t === 'USDC' || t === 'USDT'

function clientFor(chain: EvmChain) {
  if (chain === 'optimism') return publicOptimism
  if (chain === 'base') return publicBase
  return publicLisk
}

/** Aave: totalCollateralBase (1e8) – for supplied display */
async function getAaveSuppliedBalance(params: {
  chain: Extract<EvmChain, 'optimism' | 'base'>
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, user } = params
  const data = await clientFor(chain).readContract({
    address: AAVE_POOL[chain],
    abi: aaveAbi,
    functionName: 'getUserAccountData',
    args: [user],
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]
  return data[0] // 1e8
}

/** Comet: balanceOf (1e6) */
async function getCometSuppliedBalance(params: {
  chain: Extract<EvmChain, 'optimism' | 'base'>
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, token, user } = params
  const comet = COMET_POOLS[chain][token]
  if (comet === '0x0000000000000000000000000000000000000000') return BigInt(0)
  const bal = await clientFor(chain).readContract({
    address: comet,
    abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint
  return bal
}

/** Lisk mapping for bridge preview */
function mapCrossTokenForDest(
  symbol: YieldSnapshot['token'],
  dest: EvmChain,
): YieldSnapshot['token'] {
  if (dest !== 'lisk') return symbol
  if (symbol === 'USDC') return 'USDCe'
  if (symbol === 'USDT') return 'USDT0'
  return symbol
}

/** Resolve token address for a chain */
function tokenAddrFor(
  symbol: YieldSnapshot['token'],
  chain: EvmChain,
): `0x${string}` {
  const m = TokenAddresses[symbol] as Partial<Record<EvmChain, `0x${string}`>>
  const addr = m?.[chain]
  if (!addr) throw new Error(`Token ${symbol} not supported on ${chain}`)
  return addr
}

function chainIdOf(chain: EvmChain) {
  if (chain === 'optimism') return optimism.id
  if (chain === 'base') return base.id
  return liskChain.id
}

/** Read wallet balance for a token on a chain */
async function readWalletBalance(
  chain: EvmChain,
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
  return await clientFor(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint
}

/* ---------------------------------------------------------------- */
/* Modal                                                            */
/* ---------------------------------------------------------------- */

interface DepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

/** Visual step states */
type FlowStep =
  | 'idle'
  | 'bridging'
  | 'waitingFunds'
  | 'switching'
  | 'depositing'
  | 'success'
  | 'error'

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, isPending: isSwitching, error: switchError } = useSwitchChain()

  const [amount, setAmount] = useState('')
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)

  const [poolOp, setPoolOp] = useState<bigint | null>(null)
  const [poolBa, setPoolBa] = useState<bigint | null>(null)

  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(BigInt(0))
  const [received, setReceived] = useState<bigint>(BigInt(0))
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)

  // gate so ensureLiquidity only runs once
  const [liquidityEnsured, setLiquidityEnsured] = useState(false)

  // bridge tracking (baseline and latest dest balance)
  const destStartBal = useRef<bigint>(BigInt(0))
  const destCurrBal  = useRef<bigint>(BigInt(0))

  // reset gate/steps when modal/amount/protocol changes
  useEffect(() => {
    setLiquidityEnsured(false)
    setStep('idle')
    setError(null)
  }, [open, amount, snap.chain, snap.token, snap.protocolKey])

  const tokenDecimals = useMemo(() => (snap.token === 'WETH' ? 18 : 6), [snap.token])

  const poolDecimals = useMemo(() => {
    if (snap.protocolKey === 'aave-v3') return 8
    if (snap.protocolKey === 'compound-v3') return 6
    return tokenDecimals
  }, [snap.protocolKey, tokenDecimals])

  // Wallet balances (OP/BASE)
  useEffect(() => {
    if (!open || !walletClient) return
    const tb = TokenAddresses[snap.token] as Partial<Record<'optimism' | 'base', `0x${string}`>>
    const user = walletClient.account.address as `0x${string}`

    if (tb?.optimism && tb?.base) {
      getDualBalances({ optimism: tb.optimism, base: tb.base }, user).then(({ opBal, baBal }) => {
        setOpBal(opBal)
        setBaBal(baBal)
      })
    } else {
      ;(async () => {
        const [op, ba] = await Promise.all([
          tb?.optimism
            ? getDualBalances({ optimism: tb.optimism, base: tb.optimism }, user).then((r) => r.opBal)
            : Promise.resolve<bigint | null>(null),
          tb?.base
            ? getDualBalances({ optimism: tb.base, base: tb.base }, user).then((r) => r.baBal)
            : Promise.resolve<bigint | null>(null),
        ])
        setOpBal(op)
        setBaBal(ba)
      })()
    }
  }, [open, walletClient, snap.token])

  // Supplied balances (display)
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account.address as `0x${string}`

    if (snap.protocolKey === 'aave-v3') {
      Promise.allSettled([
        getAaveSuppliedBalance({ chain: 'optimism', user }),
        getAaveSuppliedBalance({ chain: 'base', user }),
      ]).then((rs) => {
        const [op, ba] = rs.map((r) => (r.status === 'fulfilled' ? r.value : BigInt(0)))
        setPoolOp(op)
        setPoolBa(ba)
      })
    } else if (snap.protocolKey === 'compound-v3') {
      if (isCometToken(snap.token)) {
        Promise.allSettled([
          getCometSuppliedBalance({ chain: 'optimism', token: snap.token, user }),
          getCometSuppliedBalance({ chain: 'base',     token: snap.token, user }),
        ]).then((rs) => {
          const [op, ba] = rs.map((r) => (r.status === 'fulfilled' ? r.value : BigInt(0)))
          setPoolOp(op)
          setPoolBa(ba)
        })
      } else {
        setPoolOp(BigInt(0)); setPoolBa(BigInt(0))
      }
    } else {
      setPoolOp(null); setPoolBa(null)
    }
  }, [open, walletClient, snap.protocolKey, snap.token])

  // Bridge quote (only if cross-chain)
  useEffect(() => {
    if (!walletClient || !amount) {
      setRoute(null); setFee(BigInt(0)); setReceived(BigInt(0)); setQuoteError(null)
      return
    }

    const dest = snap.chain as EvmChain
    const amt  = parseUnits(amount, tokenDecimals)

    // choose source: prefer enough on OP, then Base, else the larger one
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

    const outSymbol = mapCrossTokenForDest(snap.token, dest)
    const inputToken  = tokenAddrFor(snap.token, src)
    const outputToken = tokenAddrFor(outSymbol, dest)

    const srcId  = src === 'optimism' ? optimism.id : base.id
    const destId = chainIdOf(dest)

    acrossClient.getQuote({
      route: { originChainId: srcId, destinationChainId: destId, inputToken, outputToken },
      inputAmount: amt,
    })
    .then((q) => {
      setRoute(`${src.toUpperCase()} → ${dest.toUpperCase()}`)
      const feeTotal =
        typeof q.fees?.totalRelayFee?.total === 'string'
          ? BigInt(q.fees.totalRelayFee.total)
          : BigInt(q.fees.totalRelayFee.total ?? 0)
      setFee(feeTotal)
      setReceived(BigInt(q.deposit.outputAmount))
      setQuoteError(null)
    })
    .catch(() => {
      setRoute(null); setFee(BigInt(0)); setReceived(BigInt(0))
      setQuoteError('Could not fetch bridge quote')
    })
  }, [amount, walletClient, opBal, baBal, snap.chain, snap.token, tokenDecimals])

  async function handleConfirm() {
    if (!walletClient) {
      openConnect()
      return
    }

    setError(null)

    try {
      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const dest = snap.chain as EvmChain
      const destId = chainIdOf(dest)
      const user = walletClient.account!.address as `0x${string}`

      if (!liquidityEnsured && route && route !== 'On-chain') {
        setStep('bridging')

        const outSymbol = mapCrossTokenForDest(snap.token, dest)
        const destToken = tokenAddrFor(outSymbol, dest)
        destStartBal.current = await readWalletBalance(dest, destToken, user)

        await ensureLiquidity(snap.token, inputAmt, dest, walletClient)
        setLiquidityEnsured(true)

        setStep('waitingFunds')
        await waitForFunds(dest, destToken, user, destStartBal, destCurrBal)
      } else {
        setLiquidityEnsured(true)
      }

      if (chainId !== destId && switchChainAsync) {
        setStep('switching')
        await switchChainAsync({ chainId: destId })
      }

      let toDeposit: bigint
      if (route && route !== 'On-chain') {
        const delta = destCurrBal.current - destStartBal.current
        toDeposit = delta > BigInt(0) ? delta : received > BigInt(0) ? received : inputAmt
      } else {
        toDeposit = received > BigInt(0) ? received : inputAmt
      }

      setStep('depositing')
      await depositToPool(snap, toDeposit, walletClient)

      setStep('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  async function waitForFunds(
    dest: EvmChain,
    token: `0x${string}`,
    user: `0x${string}`,
    startRef: React.MutableRefObject<bigint>,
    currRef: React.MutableRefObject<bigint>,
  ) {
    const timeoutMs = 15 * 60 * 1000
    const intervalMs = 10_000
    const started = Date.now()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now()
      if (now - started > timeoutMs) throw new Error('Timeout waiting for bridged funds')

      const bal = await readWalletBalance(dest, token, user)
      currRef.current = bal
      if (bal > startRef.current) break
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  /* -------------------------------------------------------------- */
  /* UI                                                             */
  /* -------------------------------------------------------------- */

  const prettyToken = (bn: bigint | null | undefined) =>
    bn != null ? formatUnits(bn, tokenDecimals) : '…'
  const prettyPool = (bn: bigint | null | undefined) =>
    bn != null ? formatUnits(bn, poolDecimals) : '…'
  const combinedPool = useMemo(() => {
    if (poolOp == null && poolBa == null) return null
    return (poolOp ?? BigInt(0)) + (poolBa ?? BigInt(0))
  }, [poolOp, poolBa])

  const hasAmount = amount.trim().length > 0 && Number(amount) > 0
  const confirmDisabled =
    step !== 'idle' ? true : !hasAmount || Boolean(quoteError)

  const showForm = step === 'idle'
  const showProgress = step !== 'idle' && step !== 'success' && step !== 'error'
  const showSuccess = step === 'success'
  const showError = step === 'error'

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        // Mobile-friendly sizing: nearly full-height with internal scroller
        className="
          p-0 overflow-hidden shadow-xl
          w-[min(100vw-1rem,40rem)] sm:w-auto sm:max-w-md
          h-[min(90dvh,680px)] sm:h-auto
          rounded-xl sm:rounded-2xl
        "
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-cyan-500 px-5 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="text-white text-base font-semibold sm:text-lg">
              Deposit {snap.token}
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <div className="flex max-h-[calc(90dvh-56px)] flex-col overflow-hidden sm:max-h-none">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 bg-white">
            {/* ───────── Input Form (idle) ───────── */}
            {showForm && (
              <>
                {/* Amount */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-gray-500">
                    <span>Amount</span>
                    <span>OP: {prettyToken(opBal)} • Base: {prettyToken(baBal)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Input
                      // better mobile keyboard
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      placeholder="0.0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                      className="h-12 text-2xl font-bold border-0 bg-white focus-visible:ring-0"
                      autoFocus
                    />
                    <span className="text-gray-600 font-semibold">{snap.token}</span>
                  </div>
                </div>

                {/* Protocol balances */}
                {(poolOp != null || poolBa != null) && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 text-xs font-medium text-gray-500">Your supplied balance</div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Optimism</span>
                      <span className="font-medium">{prettyPool(poolOp)} {snap.token}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span>Base</span>
                      <span className="font-medium">{prettyPool(poolBa)} {snap.token}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
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
                        <span className="font-medium">{formatUnits(fee, tokenDecimals)} {snap.token}</span>
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="text-gray-500">Will deposit</span>
                      <span className="font-semibold">{formatUnits(received, tokenDecimals)} {snap.token}</span>
                    </div>
                    {quoteError && <p className="mt-2 text-xs text-red-600">{quoteError}</p>}
                  </div>
                )}

                {switchError && <p className="text-xs text-red-600">Network switch failed: {switchError.message}</p>}
                {error && <p className="text-xs text-red-600">{error}</p>}
              </>
            )}

            {/* ───────── Progress (bridge / wait / switch / deposit) ───────── */}
            {showProgress && (
              <div className="space-y-4">
                <Stepper
                  current={step}
                  items={[
                    { key: 'bridging',     label: 'Bridging liquidity',     visible: route && route !== 'On-chain' ? true : false },
                    { key: 'waitingFunds', label: 'Waiting for funds',      visible: route && route !== 'On-chain' ? true : false },
                    { key: 'switching',    label: 'Switching network',      visible: true },
                    { key: 'depositing',   label: 'Depositing to protocol', visible: true },
                  ]}
                />
              </div>
            )}

            {/* ───────── Success ───────── */}
            {showSuccess && (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
                <div className="text-center">
                  <div className="text-lg font-semibold">Deposit successful</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Your {snap.token} has been supplied to {snap.protocol}.
                  </div>
                </div>
              </div>
            )}

            {/* ───────── Error ───────── */}
            {showError && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="text-lg font-semibold text-red-600">Transaction failed</div>
                <div className="text-sm text-muted-foreground">{error}</div>
              </div>
            )}
          </div>

          {/* Sticky action bar (mobile-first) */}
          <div
            className="sticky bottom-0 border-t bg-white px-4 py-3 sm:px-6"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              {showForm && (
                <>
                  <Button
                    variant="outline"
                    onClick={onClose}
                    title="Cancel"
                    className="h-12 w-full sm:h-9 sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={confirmDisabled}
                    title="Confirm"
                    className="h-12 w-full sm:h-9 sm:w-auto"
                  >
                    Confirm
                  </Button>
                </>
              )}

              {showProgress && (
                <Button
                  variant="outline"
                  onClick={onClose}
                  title="Close"
                  className="h-12 w-full sm:h-9 sm:w-auto"
                >
                  Close
                </Button>
              )}

              {showSuccess && (
                <Button
                  onClick={onClose}
                  title="Done"
                  className="h-12 w-full sm:h-9 sm:w-auto"
                >
                  Done
                </Button>
              )}

              {showError && (
                <div className="flex w-full gap-2 sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setStep('idle')}
                    title="Try Again"
                    className="h-12 w-full sm:h-9 sm:w-auto"
                  >
                    Try again
                  </Button>
                  <Button
                    onClick={onClose}
                    title="Close"
                    className="h-12 w-full sm:h-9 sm:w-auto"
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- */
/* Tiny Stepper                                                     */
/* ---------------------------------------------------------------- */

function Stepper(props: {
  current: FlowStep
  items: { key: Exclude<FlowStep, 'idle' | 'success' | 'error'>; label: string; visible?: boolean }[]
}) {
  const order: FlowStep[] = ['bridging', 'waitingFunds', 'switching', 'depositing']
  const idx = order.indexOf(props.current)
  return (
    <div className="space-y-2">
      {props.items.filter((i) => i.visible).map((item) => {
        const myIndex = order.indexOf(item.key)
        const done = idx > myIndex
        const active = idx === myIndex
        return (
          <div key={item.key} className="flex items-center gap-3 rounded-lg border p-3 sm:p-3.5">
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : active ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <span className="h-4 w-4 rounded-full border" />
            )}
            <span className={`text-sm ${done ? 'text-green-700' : active ? 'text-primary' : 'text-muted-foreground'}`}>
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
