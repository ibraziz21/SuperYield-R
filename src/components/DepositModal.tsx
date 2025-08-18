// src/components/DepositModal.tsx
'use client'

import { quoteUsdceOnLisk, smartQuoteUsdt0Lisk } from '@/lib/quotes'
// imports (add)
import { getSugarPlanUsdtToUsdt0, executeSugarPlan, ensureAllowanceTo } from '@/lib/sugar'
import type { Address } from 'viem'

import { FC, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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
import { CheckCircle2, Loader2, ArrowRight, ShieldCheck, AlertTriangle, RefreshCw, Network } from 'lucide-react'
import { erc20Abi } from 'viem'

/* =============================================================================
   Types / Helpers
   ============================================================================= */

type EvmChain = 'optimism' | 'base' | 'lisk'

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

/** For display: map chosen token to per-chain wallet token symbol. */
function symbolForWalletDisplay(
  symbol: YieldSnapshot['token'],
  chain: EvmChain,
): YieldSnapshot['token'] {
  if (chain === 'lisk') {
    if (symbol === 'USDC') return 'USDCe'
    if (symbol === 'USDT') return 'USDT0'
    return symbol // already USDCe/USDT0/WETH
  } else {
    if (symbol === 'USDCe') return 'USDC'
    if (symbol === 'USDT0') return 'USDT'
    return symbol
  }
}

/* =============================================================================
   UI Subcomponents (pills/cards)
   ============================================================================= */

const ChainPill: FC<{ label: string; active?: boolean; subtle?: boolean }> = ({ label, active, subtle }) => (
  <span
    className={[
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
      active ? 'bg-teal-600 text-white' : subtle ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-700',
    ].join(' ')}
  >
    <Network className="h-3.5 w-3.5" />
    {label}
  </span>
)

const StatRow: FC<{ label: string; value: string; emphasize?: boolean }> = ({ label, value, emphasize }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-gray-500">{label}</span>
    <span className={emphasize ? 'font-semibold' : 'font-medium'}>{value}</span>
  </div>
)

/* =============================================================================
   Main Modal
   ============================================================================= */

interface DepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

type FlowStep = 'idle' | 'bridging' | 'waitingFunds' | 'switching' | 'depositing' | 'success' | 'error' 

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, error: switchError } = useSwitchChain()

  const [amount, setAmount] = useState('')

  // Wallet balances

const [sugarAmountOut, setSugarAmountOut] = useState<bigint | null>(null)
const [sugarPlan, setSugarPlan] = useState<null | { to: Address; commands: `0x${string}`; inputs: `0x${string}`[]; value: string }>(null)

  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [liBal, setLiBal] = useState<bigint | null>(null)
  const [liBalUSDT, setLiBalUSDT] = useState<bigint | null>(null)
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null)

  // Supplied balances (Aave/Comet display only)
  const [poolOp, setPoolOp] = useState<bigint | null>(null)
  const [poolBa, setPoolBa] = useState<bigint | null>(null)

  // Routing / fees / flow
  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(BigInt(0))
  const [received, setReceived] = useState<bigint>(BigInt(0))
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [liquidityEnsured, setLiquidityEnsured] = useState(false)

  // bridge tracking (baseline and latest dest balance)
  const destStartBal = useRef<bigint>(BigInt(0))
  const destCurrBal  = useRef<bigint>(BigInt(0))

  // Reset when inputs change
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

  /* ---------------- Wallet balances (OP/Base/Lisk) ---------------- */
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account.address as `0x${string}`

    const opSym = symbolForWalletDisplay(snap.token, 'optimism')
    const baSym = symbolForWalletDisplay(snap.token, 'base')
    const liSym = symbolForWalletDisplay(snap.token, 'lisk')

    const addrOrNull = (sym: YieldSnapshot['token'], ch: EvmChain) => {
      try { return tokenAddrFor(sym, ch) } catch { return null }
    }

    const opAddr = addrOrNull(opSym, 'optimism')
    const baAddr = addrOrNull(baSym, 'base')
    const liAddr = addrOrNull(liSym, 'lisk')

    const reads: Promise<bigint | null>[] = [
      opAddr ? readWalletBalance('optimism', opAddr, user) : Promise.resolve(null),
      baAddr ? readWalletBalance('base',     baAddr, user) : Promise.resolve(null),
      liAddr ? readWalletBalance('lisk',     liAddr, user) : Promise.resolve(null),
    ]

    const liskUSDTAddr  = (TokenAddresses.USDT  as any)?.lisk as `0x${string}` | undefined
    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)?.lisk as `0x${string}` | undefined
    const isUsdtFamily = snap.token === 'USDT' || snap.token === 'USDT0'

    if (isUsdtFamily) {
      reads.push(liskUSDTAddr  ? readWalletBalance('lisk', liskUSDTAddr,  user) : Promise.resolve(null))
      reads.push(liskUSDT0Addr ? readWalletBalance('lisk', liskUSDT0Addr, user) : Promise.resolve(null))
    } else {
      reads.push(Promise.resolve(null), Promise.resolve(null))
    }

    Promise.allSettled(reads).then((vals) => {
      const [op, ba, li, liU, liU0] = vals.map((r) => (r.status === 'fulfilled' ? r.value as bigint | null : null))
      setOpBal(op ?? null)
      setBaBal(ba ?? null)
      setLiBal(li ?? null)
      setLiBalUSDT(liU ?? null)
      setLiBalUSDT0(liU0 ?? null)
    })
  }, [open, walletClient, snap.token])

  /* ---------------- Supplied balances (display only) ---------------- */
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

  useEffect(() => {
    if (!walletClient || !amount) {
      setRoute(null); setFee(BigInt(0)); setReceived(BigInt(0)); setQuoteError(null)
      return
    }
  
    const dest = snap.chain as EvmChain
    const amt  = parseUnits(amount, tokenDecimals)
  
    // what the token becomes on the destination chain (crucial for Lisk)
    const destOutSymbol = mapCrossTokenForDest(snap.token, dest)
  
    // choose source (OP/Base) exactly as you had
    const src: Extract<EvmChain, 'optimism' | 'base'> =
      (opBal ?? BigInt(0)) >= amt ? 'optimism'
      : (baBal ?? BigInt(0)) >= amt ? 'base'
      : ((opBal ?? BigInt(0)) >= (baBal ?? BigInt(0)) ? 'optimism' : 'base')
  
    // if user is already on the destination chain, it's purely on-chain
    if (src === dest) {
      setRoute('On-chain')
      setFee(BigInt(0))
      setReceived(amt)
      setQuoteError(null)
      return
    }
  
    // ── LISK: USDT0 path (USDT bridge + Velodrome USDT->USDT0) ───────────────
    if (dest === 'lisk' && destOutSymbol === 'USDT0') {
      const need = amt
      const have0 = liBalUSDT0 ?? BigInt(0)
      const toSwap = need > have0 ? (need - have0) : BigInt(0)
    
      if (toSwap === BigInt(0)) {
        setRoute('On-chain')
        setFee(BigInt(0))
        setReceived(need)
        setSugarAmountOut(null)
        setSugarPlan(null)
        setQuoteError(null)
        return
      }
    
      const acct = walletClient.account!.address as Address
      getSugarPlanUsdtToUsdt0(toSwap, acct, { slippage: 0.003 })
        .then(({ amountOut, plan }) => {
          setRoute('On-chain') // swap is local on Lisk
          setFee(BigInt(0))
          setSugarAmountOut(amountOut)
          setSugarPlan(plan)
          setReceived(have0 + amountOut) // show final expected USDT0
          setQuoteError(null)
        })
        .catch(() => {
          setRoute(null)
          setFee(BigInt(0))
          setReceived(BigInt(0))
          setSugarAmountOut(null)
          setSugarPlan(null)
          setQuoteError('Could not fetch swap plan')
        })
      return
    }
  
    // ── LISK: USDCe path (Across USDC → USDCe) ───────────────────────────────
    if (dest === 'lisk' && destOutSymbol === 'USDCe') {
      // if you already have enough USDCe on Lisk, no bridge
      if ((liBal ?? BigInt(0)) >= amt) {
        setRoute('On-chain')
        setFee(BigInt(0))
        setReceived(amt)
        setQuoteError(null)
        return
      }
      quoteUsdceOnLisk({ amountIn: amt, opBal, baBal })
        .then(q => {
          setRoute(q.route)
          setFee(q.bridgeFee)
          setReceived(q.bridgeOutUSDCe)
          setQuoteError(null)
        })
        .catch(() => {
          setRoute(null); setFee(BigInt(0)); setReceived(BigInt(0))
          setQuoteError('Could not fetch bridge quote')
        })
      return
    }
  
    // ── Generic fallback (unchanged) ─────────────────────────────────────────
    const inputToken  = tokenAddrFor(snap.token, src)
    const outputToken = tokenAddrFor(destOutSymbol, dest)
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
  
  // include Lisk balances so we re-evaluate once they load
  }, [amount, walletClient, opBal, baBal, liBal, liBalUSDT, liBalUSDT0, snap.chain, snap.token, tokenDecimals])
  


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
  
         // 1) Single call: bridge (if needed) AND wait for funds to land
      if (!liquidityEnsured && route && route !== 'On-chain') {
          setStep('bridging')
          const wantDestToken = mapCrossTokenForDest(snap.token, dest) // e.g., 'USDT0' on Lisk
          await ensureLiquidity(wantDestToken, inputAmt, dest, walletClient, {
            onStatus: (s) => {
              if (s === 'waiting') setStep('waitingFunds')
              else if (s === 'bridging') setStep('bridging')
            },
          })
          setLiquidityEnsured(true)
        } else {
          setLiquidityEnsured(true)
        }
      // 2) If target is USDT0 on Lisk and we don't have enough yet → swap USDT→USDT0 using Sugar (user signs)
      // const destTokenLabel = mapCrossTokenForDest(snap.token, dest)
      // if (dest === 'lisk' && mapCrossTokenForDest(snap.token, dest) === 'USDT0') {
      //   const usdt0Addr = tokenAddrFor('USDT0', 'lisk')
      //   const have0Now = await readWalletBalance('lisk', usdt0Addr, user)
      //   if (have0Now < inputAmt) {
      //     const toSwap = inputAmt - have0Now
      //     // ensure we have a fresh plan for exactly toSwap
      //     let plan = sugarPlan
      //     if (!plan || (sugarAmountOut == null)) {
      //       const acct = walletClient.account!.address as Address
      //       const { amountOut, plan: freshPlan } = await getSugarPlanUsdtToUsdt0(toSwap, acct, { slippage: 0.003 })
      //       setSugarAmountOut(amountOut); setSugarPlan(freshPlan)
      //       plan = freshPlan
      //     }
  
      //     // Approve swapper if needed (planner uses router that pulls tokens from msg.sender)
      //     const usdtAddr = tokenAddrFor('USDT', 'lisk')
      //     await ensureAllowanceTo(walletClient, usdtAddr as Address, user, plan!.to, toSwap)
  
      //     setStep('swapping')
      //     await executeSugarPlan(walletClient, plan!)
  
      //     // wait until USDT0 increases
      //     destStartBal.current = have0Now
      //     setStep('waitingFunds')
      //     await waitForFunds('lisk', usdt0Addr, user, destStartBal, destCurrBal)
      //   }
      // }


  
      // 3) Switch to destination chain (if needed)
      if (chainId !== destId && switchChainAsync) {
        setStep('switching')
        await switchChainAsync({ chainId: destId })
      }
  
   // 3) Deposit: read fresh balance of the destination token and deposit up to the intended amount
      const finalTokenAddr = tokenAddrFor(mapCrossTokenForDest(snap.token, dest), dest)
      const finalBal = await readWalletBalance(dest, finalTokenAddr, user)
      const cap = inputAmt
      const toDeposit = finalBal >= cap ? cap : finalBal
  
      setStep('depositing')
      await depositToPool(snap, toDeposit, walletClient)
  
      setStep('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }
  



  /* =============================================================================
     Derived UI values
     ============================================================================= */
  const pretty = (bn: bigint | null | undefined, dec = tokenDecimals) => bn != null ? formatUnits(bn, dec) : '…'

  const hasAmount = amount.trim().length > 0 && Number(amount) > 0
  const confirmDisabled = step !== 'idle' ? true : !hasAmount || Boolean(quoteError)

  const showForm = step === 'idle'
  const showProgress = step !== 'idle' && step !== 'success' && step !== 'error'
  const showSuccess = step === 'success'
  const showError = step === 'error'

  const isLiskTarget = snap.chain === 'lisk'
  const isUsdtFamily = snap.token === 'USDT' || snap.token === 'USDT0'
  const destTokenLabel = mapCrossTokenForDest(snap.token, snap.chain as EvmChain)

  /* =============================================================================
     Render
     ============================================================================= */
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="p-0 overflow-hidden shadow-xl w-[min(100vw-1rem,44rem)] sm:max-w-2xl rounded-xl"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-cyan-500 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="text-white text-base font-semibold sm:text-lg flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white text-xs font-bold">
                {destTokenLabel}
              </span>
              Deposit to {snap.protocol} on <span className="underline decoration-white/40 underline-offset-4">{(snap.chain as string).toUpperCase()}</span>
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 bg-white">
            {showForm && (
              <>
                {/* Amount Card */}
                <div className="rounded-xl border border-gray-200 bg-white">
                  <div className="p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">Amount</div>
                      <div className="flex items-center gap-2">
                        <ChainPill label={(snap.chain as string).toUpperCase()} subtle />
                        <span className="text-[11px] text-gray-500">Destination token: {destTokenLabel}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                        className="h-12 text-2xl font-bold border-0 bg-gray-50 focus-visible:ring-0"
                        autoFocus
                      />
                      <span className="text-gray-600 font-semibold">{snap.token}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setAmount('')} title={'Clear'}>Clear</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // set MAX based on best available source (OP/Base) or Lisk if same-chain
                          const amt = (() => {
                            const dec = tokenDecimals
                            if (isLiskTarget && destTokenLabel === 'USDT0' && isUsdtFamily) {
                              // choose larger of Lisk USDT or USDT0 for convenience
                              const a = liBalUSDT ?? BigInt(0)
                              const b = liBalUSDT0 ?? BigInt(0)
                              return formatUnits(a > b ? a : b, dec)
                            }
                            if (isLiskTarget && destTokenLabel !== 'USDT0') {
                              return formatUnits(liBal ?? BigInt(0), dec)
                            }
                            // choose larger of OP/Base for cross-chain sourcing
                            const a = opBal ?? BigInt(0)
                            const b = baBal ?? BigInt(0)
                            return formatUnits(a > b ? a : b, dec)
                          })()
                          setAmount(amt === '0' ? '' : amt)
                        } } title={'Max'}                      >
                        MAX
                      </Button>
                    </div>
                  </div>

                  {/* Balance strip */}
                  <div className="border-t bg-gray-50 p-3 sm:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* OP */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between">
                          <ChainPill label="OP" />
                          <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'optimism')}</span>
                        </div>
                        <div className="mt-1 text-base font-semibold">{pretty(opBal)}</div>
                      </div>
                      {/* Base */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between">
                          <ChainPill label="BASE" />
                          <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'base')}</span>
                        </div>
                        <div className="mt-1 text-base font-semibold">{pretty(baBal)}</div>
                      </div>
                      {/* Lisk */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between">
                          <ChainPill label="LISK" />
                          <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'lisk')}</span>
                        </div>
                        {isLiskTarget && isUsdtFamily ? (
                          <div className="mt-1 space-y-1">
                            <div className="flex items-center justify-between text-sm"><span className="text-gray-500">USDT</span><span className="font-medium">{pretty(liBalUSDT)}</span></div>
                            <div className="flex items-center justify-between text-sm"><span className="text-gray-500">USDT0</span><span className="font-medium">{pretty(liBalUSDT0)}</span></div>
                          </div>
                        ) : (
                          <div className="mt-1 text-base font-semibold">{pretty(liBal)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Route & Fees */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4" />
                      Route & Fees
                    </div>
                    {route && route !== 'On-chain' ? (
                      <span className="inline-flex items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-md bg-gray-100 px-2 py-1">Bridging via Li.Fi</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">On-chain</span>
                    )}
                  </div>

                  {/* Pretty route line */}
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <ChainPill label={(route?.split(' ')[0] ?? 'OP').replace('→','').trim()} subtle />
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                    <ChainPill label={(snap.chain as string).toUpperCase()} subtle />
                    <span className="ml-auto text-xs text-gray-500">{snap.token} → {destTokenLabel}</span>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {fee > BigInt(0) && (
                      <StatRow label="Bridge fee" value={`${formatUnits(fee, tokenDecimals)} ${snap.token}`} />
                    )}
                    <StatRow label="Will deposit" value={`${formatUnits(received, tokenDecimals)} ${snap.token}`} emphasize />
                    {quoteError && <div className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {quoteError}</div>}
                  </div>

                  {isLiskTarget && (
                    <div className="mt-3 text-[11px] text-gray-500">
                      Funds arrive as <span className="font-medium">{destTokenLabel}</span> on Lisk.
                    </div>
                  )}
                </div>

                {/* Supplied (protocol) balances */}
                {(poolOp != null || poolBa != null) && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <RefreshCw className="h-4 w-4" /> Current supplied
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-lg border bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">Optimism</div>
                        <div className="text-base font-semibold">{poolOp != null ? formatUnits(poolOp, poolDecimals) : '…'} {snap.token}</div>
                      </div>
                      <div className="rounded-lg border bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">Base</div>
                        <div className="text-base font-semibold">{poolBa != null ? formatUnits(poolBa, poolDecimals) : '…'} {snap.token}</div>
                      </div>
                      <div className="rounded-lg border bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">Total</div>
                        <div className="text-base font-semibold">
                          {(() => {
                            if (poolOp == null && poolBa == null) return '…'
                            const sum = (poolOp ?? BigInt(0)) + (poolBa ?? BigInt(0))
                            return `${formatUnits(sum, poolDecimals)} ${snap.token}`
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {switchError && <p className="text-xs text-red-600">Network switch failed: {switchError.message}</p>}
                {error && <p className="text-xs text-red-600">{error}</p>}
              </>
            )}

            {/* Progress */}
            {showProgress && (
              <div className="space-y-3">
                <StepCard current={step} label="Bridging liquidity"   k="bridging"     visible={(route !== 'On-chain')} />
                <StepCard current={step} label="Waiting for funds"    k="waitingFunds" visible={ route !== 'On-chain'} />
                <StepCard current={step} label="Switching network"    k="switching"    visible />
                <StepCard current={step} label="Depositing to protocol" k="depositing"   visible />
              </div>
            )}

            {/* Success */}
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

            {/* Error */}
            {showError && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="text-lg font-semibold text-red-600">Transaction failed</div>
                <div className="text-sm text-muted-foreground">{error}</div>
              </div>
            )}
          </div>

          {/* Sticky action bar */}
          <div className="sticky bottom-0 border-t bg-white px-4 py-3 sm:px-6">
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

/* =============================================================================
   Tiny Step Card
   ============================================================================= */

function StepCard(props: { current: FlowStep, k: Exclude<FlowStep, 'idle'|'success'|'error'>, label: string, visible?: boolean }) {
  if (!props.visible) return null
  const order: FlowStep[] = ['bridging', 'waitingFunds', 'switching', 'depositing']
  const idx = order.indexOf(props.current)
  const my  = order.indexOf(props.k)
  const done = idx > my
  const active = idx === my
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : active ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : (
        <span className="h-4 w-4 rounded-full border" />)
      }
      <span className={`text-sm ${done ? 'text-green-700' : active ? 'text-primary' : 'text-muted-foreground'}`}>
        {props.label}
      </span>
    </div>
  )
}
