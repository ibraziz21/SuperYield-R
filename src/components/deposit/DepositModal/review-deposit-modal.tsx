'use client'

/* eslint-disable no-console */

import { FC, useMemo, useState, useEffect } from 'react'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { parseUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import lifilogo from '@/public/logo_lifi_light.png'
import { getBridgeQuote } from '@/lib/quotes'
import { switchOrAddChain, CHAINS } from '@/lib/wallet'
import { bridgeTokens } from '@/lib/bridge'
import { TokenAddresses } from '@/lib/constants'
import { readWalletBalance } from '../helpers'
import { depositMorphoOnLiskAfterBridge } from '@/lib/depositor'
import { switchOrAddChainStrict } from '@/lib/switch'
import { DepositSuccessModal } from './deposit-success-modal'

type FlowStep = 'idle' | 'bridging' | 'depositing' | 'success' | 'error'

interface ReviewDepositModalProps {
  open: boolean
  onClose: () => void
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
    snap,
    amount,
    sourceSymbol,
    destTokenLabel,
    routeLabel,
    bridgeFeeDisplay,
    receiveAmountDisplay,
    liBal,
    liBalUSDT0,
    opUsdcBal,
    baUsdcBal,
    opUsdtBal,
    baUsdtBal,
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

  // success modal
  const [showSuccess, setShowSuccess] = useState(false)

  const canStart = open && !!walletClient && Number(amount) > 0

  const feeDisplay = useMemo(() => bridgeFeeDisplay ?? 0, [bridgeFeeDisplay])
  const receiveDisplay = useMemo(
    () => receiveAmountDisplay ?? 0,
    [receiveAmountDisplay],
  )
  const amountNumber = Number(amount || 0)

  // if we are depositing using Lisk-native balance (USDCe / USDT0), the parent
  // sets routeLabel="On-chain" and fee=0. In that case, we **hide** the bridge row.
  const isOnChainDeposit = useMemo(
    () => routeLabel === 'On-chain' || bridgeFeeDisplay === 0,
    [routeLabel, bridgeFeeDisplay],
  )

  /** Ensure wallet on Lisk and return a **fresh** wallet client after switch */
  const ensureLiskWalletClient = async () => {
    if (!walletClient) throw new Error('No wallet client')
    const before = walletClient.chain?.id
    await switchOrAddChainStrict(walletClient, CHAINS.lisk)
    const refreshed = (await refetchWalletClient()).data ?? walletClient
    const after = refreshed?.chain?.id
    console.info(TAG, 'ensureLiskWalletClient', { before, after })
    return refreshed
  }

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
          setShowSuccess(true)
        }
      } catch (e) {
        console.error(TAG, '[focus] failed', e)
      }
    }
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [step, walletClient, destAddr, preBal, snap, refetchWalletClient])

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
      setShowSuccess(true)
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

      // If already have enough on Lisk, skip bridging
      const haveOnLisk =
        destTokenLabel === 'USDCe'
          ? (liBal ?? 0n)
          : destTokenLabel === 'USDT0'
          ? (liBalUSDT0 ?? 0n)
          : 0n

      if (haveOnLisk >= inputAmt) {
        setBridgeOk(true)
        setCachedMinOut(inputAmt)
        setStep('depositing')
        await switchOrAddChainStrict(walletClient, CHAINS.lisk)
        await depositMorphoOnLiskAfterBridge(snap, inputAmt, walletClient)
        setStep('success')
        setShowSuccess(true)
        return
      }

      // We ONLY support Optimism as the source now (no Base)
      const srcToken: 'USDC' | 'USDT' | 'USDT0' | 'USDCe' = sourceSymbol
      const srcChain: 'optimism' = 'optimism'

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
          onUpdate: () => {},
        },
      )

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

      // ---- Deposit what landed (cap to current balance), on Lisk ----
      setBridgeOk(true)
      setCachedMinOut(landed)
      setStep('depositing')

      await switchOrAddChainStrict(walletClient, CHAINS.lisk)

      const balNow = await readWalletBalance('lisk', _destAddr, user).catch(
        () => 0n,
      )
      const toDeposit = landed <= balNow ? landed : balNow
      if (toDeposit <= 0n) throw new Error('Nothing to deposit on Lisk')

      await depositMorphoOnLiskAfterBridge(snap, toDeposit, walletClient)

      setStep('success')
      setShowSuccess(true)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  // ---------- UI state mapping ----------
  const approveState: 'idle' | 'working' | 'done' | 'error' =
    step === 'idle' ? 'idle' : step === 'error' ? 'error' : 'done'
  const bridgeState: 'idle' | 'working' | 'done' | 'error' = isOnChainDeposit
    ? 'done'
    : step === 'bridging'
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
      void handleConfirm()
      return
    }
    if (step === 'success') {
      setShowSuccess(true)
      return
    }
    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  // ---------- Source row visuals (OP USDT0-aware, no Base in UI) ----------
  const sourceIcon = isOnChainDeposit
    ? destTokenLabel === 'USDT0'
      ? '/tokens/usdt0-icon.png'
      : destTokenLabel === 'USDCe'
      ? '/tokens/usdc-icon.png'
      : '/tokens/weth.png'
    : sourceSymbol === 'USDT'
    ? '/tokens/usdt-icon.png'
    : sourceSymbol === 'USDT0'
    ? '/tokens/usdt0-icon.png'
    : '/tokens/usdc-icon.png'

  const sourceTokenLabel = isOnChainDeposit ? destTokenLabel : sourceSymbol
  const sourceChainLabel = isOnChainDeposit ? 'Lisk' : 'OP Mainnet'

  // ---------- Step hint (intermediate status copy) ----------
  const stepHint = (() => {
    if (step === 'bridging') {
      return isOnChainDeposit
        ? 'Depositing directly on Lisk – no bridge needed.'
        : 'Bridge in progress. This can take a few minutes depending on network congestion.'
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
    return 'Review the details and confirm your deposit.'
  })()

  const isWorking = step === 'bridging' || step === 'depositing'

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-lg my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold">
              {step === 'error' ? 'Review deposit – Error' : 'Review deposit'}
            </h3>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-full"
            >
              <X size={20} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            {/* source */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={sourceIcon}
                  alt={sourceTokenLabel}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">
                  {Number(amountNumber).toString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  ${amountNumber.toFixed(2)} • {sourceTokenLabel} on{' '}
                  {sourceChainLabel}
                </div>
              </div>
              {approveState === 'done' && (
                <Check className="text-green-600" size={18} />
              )}
              {approveState === 'error' && (
                <AlertCircle className="text-red-600" size={18} />
              )}
            </div>

            {/* bridge – hidden for pure Lisk deposits */}
            {!isOnChainDeposit && (
              <div className="flex items-start gap-3">
                <div className="relative mt-0.5">
                  <Image
                    src={lifilogo.src}
                    alt="bridge"
                    width={28}
                    height={28}
                    className="rounded-full"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold">Bridging via LI.FI</div>
                  <div className="text-xs text-muted-foreground">
                    Bridge Fee: {feeDisplay.toFixed(4)} {sourceSymbol}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {routeLabel}
                  </div>
                </div>
                {bridgeState === 'done' && (
                  <a
                    href="#"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(e) => e.preventDefault()}
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
                {bridgeState === 'error' && (
                  <AlertCircle className="text-red-600" size={18} />
                )}
              </div>
            )}

            {/* destination */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={
                    destTokenLabel === 'USDT0'
                      ? '/tokens/usdt0-icon.png'
                      : destTokenLabel === 'USDCe'
                      ? '/tokens/usdc-icon.png'
                      : '/tokens/weth.png'
                  }
                  alt={destTokenLabel}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">
                  {(receiveDisplay ?? 0).toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${amountNumber.toFixed(2)} • {destTokenLabel} on Lisk
                </div>
              </div>
              {depositState === 'done' && (
                <Check className="text-green-600" size={18} />
              )}
              {depositState === 'error' && (
                <AlertCircle className="text-red-600" size={18} />
              )}
            </div>

            {/* vault */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src="/protocols/morpho-icon.png"
                  alt="Morpho"
                  width={28}
                  height={28}
                  className="rounded-lg"
                />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Depositing in Vault</div>
                <div className="text-xs text-muted-foreground">
                  Re7 {snap.token} Vault (Morpho Blue)
                </div>
              </div>
            </div>

            {stepHint && (
              <div className="text-xs text-muted-foreground">{stepHint}</div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3">
                {error}
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-12 text-white bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              disabled={isWorking || !canStart}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{primaryCta}</span>
            </Button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <DepositSuccessModal
          amount={Number(amount || 0)}
          sourceToken={
            sourceTokenLabel as 'USDC' | 'USDT' | 'USDCe' | 'USDT0'
          }
          destinationAmount={Number(receiveDisplay ?? 0)}
          destinationToken={destTokenLabel}
          vault={`Re7 ${snap.token} Vault (Morpho Blue)`}
          onClose={() => {
            setShowSuccess(false)
            onClose()
          }}
        />
      )}
    </div>
  )
}
