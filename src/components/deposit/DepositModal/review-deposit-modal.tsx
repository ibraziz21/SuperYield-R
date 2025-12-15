// src/components/DepositModal/review-deposit-modal.tsx
'use client'

import { FC, useMemo, useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle, Clock,Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { parseUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import lifilogo from '@/public/lifi.png'
import { getBridgeQuote } from '@/lib/quotes'
import { switchOrAddChain, CHAINS } from '@/lib/wallet'
import { bridgeTokens } from '@/lib/bridge'
import { TokenAddresses } from '@/lib/constants'
import { readWalletBalance } from '../helpers'
import { depositMorphoOnLiskAfterBridge } from '@/lib/depositor'
import { switchOrAddChainStrict } from '@/lib/switch'
import { DepositSuccessModal } from './deposit-success-modal'
import InfoIconModal from "../../../../public/info-icon-modal.svg"
import CheckIconModal from "../../../../public/check-icon-modal.svg"
import AlertIconModal from "../../../../public/alert-icon-modal.svg"

type FlowStep = 'idle' | 'bridging' | 'depositing' | 'success' | 'error'

interface DepositSuccessData {
  amount: number
  sourceToken: string
  destinationAmount: number
  destinationToken: string
  vault: string
}

interface ReviewDepositModalProps {
  open: boolean
  onClose: () => void
  onSuccess: (data: DepositSuccessData) => void
  snap: YieldSnapshot

  amount: string
  /** Now supports OP USDT0 + Lisk USDCe/USDT0 */
  sourceSymbol: 'USDC' | 'USDT' | 'USDCe' | 'USDT0'
  destTokenLabel: 'USDCe' | 'USDT0' | 'WETH'
  routeLabel: string
  bridgeFeeDisplay: number
  receiveAmountDisplay: number

  opBal: bigint | null
  baBal: bigint | null
  liBal: bigint | null
  liBalUSDT0: bigint | null
  opUsdcBal: bigint | null
  baUsdcBal: bigint | null
  opUsdtBal: bigint | null
  baUsdtBal: bigint | null
}

function toTokenDecimals(sym: 'USDC' | 'USDT' | 'WETH' | 'USDCe' | 'USDT0') {
  return sym === 'WETH' ? 18 : 6
}

const TAG = '[deposit]'

export const DepositModal: FC<ReviewDepositModalProps> = (props) => {
  const {
    open,
    onClose,
    onSuccess,
    snap,
    amount,
    sourceSymbol,
    destTokenLabel,
    routeLabel,
    bridgeFeeDisplay,
    receiveAmountDisplay,
  } = props

  const { open: openConnect } = useAppKit()
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient()

  const tokenDecimals = useMemo(
    () => toTokenDecimals((snap.token as any) === 'WETH' ? 'WETH' : 'USDC'),
    [snap.token],
  )

  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)

  // recovery-aware caches
  const [bridgeOk, setBridgeOk] = useState(false)
  const [cachedInputAmt, setCachedInputAmt] = useState<bigint | null>(null)
  const [cachedMinOut, setCachedMinOut] = useState<bigint | null>(null)

  // destination token (for polling/deposit)
  const [destAddr, setDestAddr] = useState<`0x${string}` | null>(null)
  const [preBal, setPreBal] = useState<bigint>(0n)

  // Track actual approval completion
  const [approvalDone, setApprovalDone] = useState(false)

  const canStart = open && !!walletClient && Number(amount) > 0

  const feeDisplay = useMemo(() => bridgeFeeDisplay ?? 0, [bridgeFeeDisplay])
  const receiveDisplay = useMemo(
    () => receiveAmountDisplay ?? 0,
    [receiveAmountDisplay],
  )
  const amountNumber = Number(amount || 0)

  /** Ensure wallet on Lisk and return a **fresh** wallet client after switch */
  const ensureLiskWalletClient = useCallback(async () => {
    if (!walletClient) throw new Error('No wallet client')
    const before = walletClient.chain?.id
    await switchOrAddChainStrict(walletClient, CHAINS.lisk)
    const refreshed = (await refetchWalletClient()).data ?? walletClient
    const after = refreshed?.chain?.id
    console.info(TAG, 'ensureLiskWalletClient', { before, after })
    return refreshed
  }, [walletClient, refetchWalletClient])

  // ---------- Focus recovery (tab hidden during bridging) ----------
  useEffect(() => {
    if (!walletClient || !destAddr) return
    const handler = async () => {
      if (step !== 'bridging') return
      try {
        const user0 = walletClient.account!.address as `0x${string}`
        const bal = await readWalletBalance('lisk', destAddr, user0).catch(
          () => 0n,
        )
        console.info(TAG, '[focus] balance check', {
          destAddr,
          preBal: preBal.toString(),
          bal: bal.toString(),
        })
        if (bal > preBal) {
          console.info(TAG, '[focus] detected landing, advancing to deposit')
          setBridgeOk(true)
          setCachedMinOut(bal - preBal)
          setStep('depositing')

          const wc = await ensureLiskWalletClient()
          const toDeposit = bal - preBal
          console.info(TAG, '[focus] deposit', {
            toDeposit: toDeposit.toString(),
            chainId: wc.chain?.id,
          })
          await depositMorphoOnLiskAfterBridge(snap, toDeposit, wc)
          setStep('success')
        }
      } catch (e) {
        console.error(TAG, '[focus] failed', e)
      }
    }
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [step, walletClient, destAddr, preBal, snap, ensureLiskWalletClient])

  // ---------- Deposit-only retry ----------
  async function depositOnlyRetry() {
    if (!walletClient || !destAddr) return
    const wc = await ensureLiskWalletClient()

    const user = wc.account!.address as `0x${string}`
    let amt =
      cachedMinOut && cachedMinOut > 0n ? cachedMinOut : (cachedInputAmt ?? 0n)
    const bal = await readWalletBalance('lisk', destAddr, user).catch(
      () => 0n,
    )
    if (amt <= 0n || amt > bal) amt = bal
    if (amt <= 0n) {
      setError('Nothing to deposit')
      setStep('error')
      return
    }

    try {
      console.info(TAG, 'retry deposit', {
        amt: amt.toString(),
        bal: bal.toString(),
        chainId: wc.chain?.id,
      })
      setError(null)
      setStep('depositing')
      await depositMorphoOnLiskAfterBridge(snap, amt, wc)
      console.info(TAG, '✅ deposit complete (retry)')
      setStep('success')
      onSuccess({
        amount: Number(amount || 0),
        sourceToken: sourceTokenLabel,
        destinationAmount: Number(receiveDisplay ?? 0),
        destinationToken: destTokenLabel,
        vault: `Re7 ${snap.token} Vault (Morpho Blue)`,
      })
      onClose()
    } catch (e: any) {
      console.error(TAG, 'retry deposit error', e)
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  async function handleConfirm() {
    if (!walletClient) {
      openConnect()
      return
    }
    setError(null)
    setBridgeOk(false)
    // Reset approval state when starting new flow
    setApprovalDone(false)

    try {
      const inputAmt = parseUnits(
        amount || '0',
        snap.token === 'WETH' ? 18 : 6,
      )
      const user = walletClient.account!.address as `0x${string}`

      if (snap.chain !== 'lisk')
        throw new Error('Only Lisk deposits are supported in this build')

      const _destAddr =
        destTokenLabel === 'USDCe'
          ? (TokenAddresses.USDCe.lisk as `0x${string}`)
          : destTokenLabel === 'USDT0'
            ? (TokenAddresses.USDT0.lisk as `0x${string}`)
            : (TokenAddresses.WETH.lisk as `0x${string}`)

      setDestAddr(_destAddr)
      setCachedInputAmt(inputAmt)

      // ── All deposits now bridge from OP → Lisk ──
      const srcToken: 'USDC' | 'USDT' | 'USDT0' | 'USDCe' = sourceSymbol
      const srcChain = 'optimism' as const

      // Baseline Lisk balance for landing detection
      const pre = (await readWalletBalance('lisk', _destAddr, user).catch(
        () => 0n,
      )) as bigint
      setPreBal(pre)

      setStep('bridging')

      // Quote (for minOut display; we still accept any positive landing)
      const q = await getBridgeQuote({
        token: destTokenLabel,
        amount: inputAmt,
        from: srcChain,
        to: 'lisk',
        fromAddress: user,
        fromTokenSym: srcToken,
      })
      const minOut = BigInt(q.estimate?.toAmountMin ?? '0')
      setCachedMinOut(minOut)

      // Execute bridge on Optimism only
      const srcViem = CHAINS.optimism
      await switchOrAddChain(walletClient, srcViem)
      await bridgeTokens(
        destTokenLabel,
        inputAmt,
        srcChain,
        'lisk',
        walletClient,
        {
          sourceToken: srcToken,
          onUpdate: () => { },
        },
      )

      // Mark approval as done only after bridgeTokens succeeds
      setApprovalDone(true)

      // ---- Grace wait (≈60s), then poll until landing or timeout ----
      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
      await sleep(60_000)

      const endAt = Date.now() + 15 * 60_000 // 15 minutes
      let landed: bigint | null = null
      let last = pre

      while (Date.now() < endAt) {
        const bal = await readWalletBalance('lisk', _destAddr, user).catch(
          () => null,
        )
        if (bal !== null) {
          last = bal
          const delta = bal - pre
          if (delta > 0n) {
            landed = delta
            break
          }
        }
        await sleep(6_000)
      }

      if (!landed || landed <= 0n) {
        throw new Error(
          `Bridging not finalized on Lisk in time. Last balance ${last.toString()}, start ${pre.toString()}.`,
        )
      }

      setBridgeOk(true)
      setCachedMinOut(landed)
      setStep('depositing')

      // Use the strict helper so we get a fresh Lisk client
      const wc = await ensureLiskWalletClient()
      const userLisk = wc.account!.address as `0x${string}`

      const balNow = await readWalletBalance('lisk', _destAddr, userLisk).catch(
        () => 0n,
      )

      const toDeposit = landed <= balNow ? landed : balNow
      if (toDeposit <= 0n) throw new Error('Nothing to deposit on Lisk')

      console.info(TAG, '[handleConfirm] deposit', {
        toDeposit: toDeposit.toString(),
        chainId: wc.chain?.id,
      })

      await depositMorphoOnLiskAfterBridge(snap, toDeposit, wc)

      // Optional: switch back to OP Mainnet
      try {
        await switchOrAddChain(wc, srcViem)
      } catch (switchErr) {
        console.warn(TAG, 'Failed to switch back to OP, ignoring', switchErr)
      }

      setStep('success')
      onSuccess({
        amount: Number(amount || 0),
        sourceToken: sourceTokenLabel,
        destinationAmount: Number(receiveDisplay ?? 0),
        destinationToken: destTokenLabel,
        vault: `Re7 ${snap.token} Vault (Morpho Blue)`,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  // ---------- UI state mapping ----------
  const approveState: 'idle' | 'working' | 'done' | 'error' =
    step === 'idle' ? 'idle' : step === 'error' ? 'error' : 'done'

  const bridgeState: 'idle' | 'working' | 'done' | 'error' =
    step === 'bridging'
      ? 'working'
      : step === 'depositing' ||
        step === 'success' ||
        (step === 'error' && bridgeOk)
        ? 'done'
        : step === 'error'
          ? 'error'
          : 'idle'

  const depositState: 'idle' | 'working' | 'done' | 'error' =
    step === 'depositing'
      ? 'working'
      : step === 'success'
        ? 'done'
        : step === 'error' && bridgeState === 'done'
          ? 'error'
          : 'idle'

  // ---------- Retry semantics ----------
  const primaryCta =
    step === 'error'
      ? bridgeOk
        ? 'Retry deposit'
        : 'Try again'
      : step === 'idle'
        ? 'Deposit'
        : step === 'bridging'
          ? `Sign bridge transaction…`
          : step === 'depositing'
            ? 'Depositing…'
            : step === 'success'
              ? 'Done'
              : 'Working…'

  const onPrimary = () => {
    if (step === 'error') {
      if (bridgeOk) {
        void depositOnlyRetry()
        return
      }
      setError(null)
      setStep('idle')
      // Reset approval state on retry
      setApprovalDone(false)
      void handleConfirm()
      return
    }
    if (step === 'success') {
      onClose()
      return
    }
    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  // ---------- Source row visuals (always OP source) ----------
  const sourceIcon =
    sourceSymbol === 'USDT'
      ? '/tokens/usdt-icon.png'
      : sourceSymbol === 'USDT0'
        ? '/tokens/usdt0-icon.png'
        : '/tokens/usdc-icon.png'

  const sourceTokenLabel = sourceSymbol
  const sourceChainLabel = 'OP Mainnet'

  // ---------- Bridge dots (UI only) ----------
  const bridgeFailedBeforeLanding = step === 'error' && !bridgeOk
  const depositFailedAfterBridge = step === 'error' && bridgeState === 'done'

  type DotState = 'pending' | 'idle' | 'active' | 'done' | 'error'

  // Dot 1: Approve spending
  const dot1: DotState = approvalDone ? 'done' : 'pending'

  // Dot 2: Bridge tx signature / confirmation
  const dot2: DotState =
    step === 'bridging' && !bridgeOk
      ? 'active'
      : bridgeFailedBeforeLanding
        ? 'error'
        : step === 'depositing' || step === 'success' || depositFailedAfterBridge
          ? 'done'
          : 'idle'

  // Dot 3: Deposit in vault
  const dot3: DotState =
    step === 'depositing'
      ? 'active'
      : step === 'success'
        ? 'done'
        : depositFailedAfterBridge
          ? 'error'
          : 'idle'

  // ---------- Step hint (intermediate status copy) ----------
  const stepHint = (() => {
    if (step === 'bridging') {
      return 'Bridge in progress. This can take a few minutes depending on network congestion.'
    }
    if (step === 'depositing') {
      return 'Your funds have arrived on Lisk. Depositing into the vault…'
    }
    if (step === 'success') {
      return 'Deposit complete. Your position will refresh shortly.'
    }
    if (step === 'error') {
      return 'Something went wrong. Check the error below and try again.'
    }
    return 'You’re depositing.'
  })()

  const isWorking = step === 'bridging' || step === 'depositing'

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'
          }`}
      />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-[400px] my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
        >
          {/* Header - Updated with ETA */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              {step === 'error' ? 'Deposit failed' : "You're depositing"}
            </h3>
            <button
              onClick={onClose}
              className=" cursor-pointer p-2 hover:bg-muted rounded-full"
            >
              <X size={20} />
            </button>
          </div>

          <div className='px-5 space-y-0'>
            {/* Status hint and error */}
            {stepHint && (
  <div className="flex items-center justify-between text-xs text-muted-foreground pt-4">
    <span className="text-muted-foreground">
      {stepHint}
    </span>
    <div className="flex items-center gap-1 text-muted-foreground">
      <Clock className="w-4 h-4" strokeWidth={1.5} />
      <span className="font-normal">
        ~5 min
      </span>
    </div>
  </div>
)}

          
          </div>
          <div className="px-5 py-5 space-y-0">
            {/* Step 1: Source */}
            <div className="flex items-start gap-3 pb-5 relative">
              {/* Flow line connector */}
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

              {/* Icon with adjusted network badge position */}
              <div className="relative mt-0.5 shrink-0">
                <Image
                  src={sourceIcon}
                  alt={sourceTokenLabel}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
                {/* Network badge - moved further right */}
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image
                    src="/networks/op-icon.png"
                    alt={sourceChainLabel}
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="text-2xl font-bold">
                  {Number(amountNumber).toString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  ${amountNumber.toFixed(2)} • {sourceTokenLabel} on {' '}
                  {sourceChainLabel}
                </div>
              </div>
            </div>

            {/* Step 2: Bridge */}
            <div className="flex items-start gap-3 pb-5 relative">
              {/* Flow line connector */}
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

              {/* LI.FI icon */}
              <div className="relative mt-0.5 shrink-0">
                <Image
                  src={lifilogo.src}
                  alt="bridge"
                  width={40}
                  height={40}
                  className="rounded-full"
                />
              </div>

              {/* Content - REMOVED Explorer link */}
              <div className="flex-1 space-y-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-lg font-semibold">Bridging via LI.FI</div>
                    <div className="text-xs text-muted-foreground">
                      Bridge Fee: {feeDisplay.toFixed(4)} {sourceSymbol}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-step 1: Approve spending - Show only when bridging, before approval is done */}
            {step === 'bridging' && !approvalDone && (
              <div className="flex items-start gap-3 pb-5 relative">
                {/* Flow line connector */}
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

                {/* Icon column - status indicator */}
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    <div className='bg-[#EBF1FF] rounded-full p-1'>
                      <Image src={InfoIconModal} alt="" className='w-4 h-4' />
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 mt-3">
                  <div className="text-xs">
                    Approve {sourceTokenLabel} spending
                  </div>
                </div>
              </div>
            )}

            {/* Sub-step 1: Approval complete - Show when approval is done */}
            {(step === 'bridging' && approvalDone) || (step !== 'idle' && step !== 'bridging') && (
              <div className="flex items-start gap-3 pb-5 relative">
                {/* Flow line connector */}
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

                {/* Icon column - status indicator */}
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    <div className='bg-[#E7F8F0] rounded-full p-1'>
                      <Image src={CheckIconModal} alt="" className='w-4 h-4' />
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 mt-3">
                  <div className="text-xs">
                    {sourceTokenLabel} spending approved
                  </div>
                </div>
              </div>
            )}

            {/* Sub-step 2: Bridge transaction - Show only when relevant, aligned like main steps */}
            {(step === 'bridging' || step === 'depositing' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                {/* Flow line connector */}
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

                {/* Icon column - status indicator */}
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {dot2 === 'error' ? (
                      <div className='bg-[#FEECEB] rounded-full p-1'>
                        <Image src={AlertIconModal} alt="" className='w-4 h-4' />
                      </div>
                    ) : dot2 === 'done' ? (
                      <div className='bg-[#E7F8F0] rounded-full p-1'>
                        <Image src={CheckIconModal} alt="" className='w-4 h-4' />
                      </div>
                    ) : dot2 === 'active' ? (
                      <div className='bg-[#EBF1FF] rounded-full p-1'>
                        <Image src={InfoIconModal} alt="" className='w-4 h-4' />
                      </div>
                    ) : (
                      <div className='bg-[#EBF1FF] rounded-full p-1'>
                        <Image src={InfoIconModal} alt="" className='w-4 h-4' />
                      </div>
                    )}
                  </div>
                </div>

                {/* Content - WITH justify-between and Explorer link */}
                <div className="flex-1 mt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs">
                      {dot2 === 'error'
                        ? 'Signature required'
                        : dot2 === 'done'
                          ? 'Bridge transaction confirmed'
                          : 'Sign bridge transaction'}
                    </div>
                    {/* Explorer link moved here */}
                    {dot2 === 'done' && (
                      <a
                        href="#"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.preventDefault()}
                        title="View on explorer"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Destination */}
            <div className="flex items-start gap-3 pb-5 relative">
              {/* Flow line connector */}
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

              {/* Icon with adjusted network badge position */}
              <div className="relative mt-0.5 shrink-0">
                <Image
                  src={
                    destTokenLabel === 'USDT0'
                      ? '/tokens/usdt0-icon.png'
                      : destTokenLabel === 'USDCe'
                        ? '/tokens/usdc-icon.png'
                        : '/tokens/weth.png'
                  }
                  alt={destTokenLabel}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
                {/* Network badge - moved further right */}
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image
                    src="/networks/lisk.png"
                    alt="Lisk"
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="text-2xl font-bold">
                  {(receiveDisplay ?? 0).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground">
                  ${amountNumber.toFixed(2)} • {destTokenLabel} on Lisk
                </div>

                {/* Deposit failed status */}
                {depositFailedAfterBridge && (
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0">
                      <div className='bg-[#E7F8F0] rounded-full p-1'>
                        <Image src={AlertIconModal} alt="" className='w-4 h-4' />
                      </div>
                    </div>
                    <div className="flex-1 text-red-500">
                      Deposit failed
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sub-step 3: Vault deposit - Show only when relevant, aligned like main steps */}
            {(step === 'depositing' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                {/* Flow line connector */}
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />

                {/* Icon column - status indicator */}
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {dot3 === 'error' ? (
                      <div className='bg-[#FEECEB] rounded-full p-1'>
                        <Image src={AlertIconModal} alt="" className='w-4 h-4' />
                      </div>
                    ) : dot3 === 'done' ? (
                      <div className='bg-[#E7F8F0] rounded-full p-1'>
                        <Image src={CheckIconModal} alt="" className='w-4 h-4' />
                      </div>
                    ) : dot3 === 'active' ? (
                      <div className='bg-[#EBF1FF] rounded-full p-1'>
                        <Image src={InfoIconModal} alt="" className='w-4 h-4' />
                      </div>
                    ) : (
                      <div className='bg-[#EBF1FF] rounded-full p-1'>
                        <Image src={InfoIconModal} alt="" className='w-4 h-4' />
                      </div>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 mt-3">
                  <div className="text-xs">
                    {dot3 === 'error'
                      ? 'Vault deposit failed'
                      : dot3 === 'done'
                        ? 'Successfully deposited in vault'
                        : dot3 === 'active'
                          ? 'Depositing in vault…'
                          : 'Waiting for deposit…'}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Vault */}
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="relative mt-0.5 shrink-0">
                <Image
                  src="/protocols/morpho-icon.png"
                  alt="Morpho"
                  width={40}
                  height={40}
                  className="rounded-[6px]"
                />
              </div>

              {/* Content */}
              <div className="flex-1 space-y-0">
                <div className="text-lg font-semibold">Depositing in Vault</div>
                <div className="text-xs text-muted-foreground">
                  Re7 {snap.token} Vault (Morpho Blue)
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3 mt-2">
                {error}
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-10 text-white bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              disabled={isWorking || !canStart}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{primaryCta}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}