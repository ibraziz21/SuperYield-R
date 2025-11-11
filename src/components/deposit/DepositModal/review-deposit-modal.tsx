// src/components/DepositModal/review-deposit-modal.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { parseUnits } from 'viem'
import { lisk as liskChain } from 'viem/chains'
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

  // from parent
  amount: string
  sourceSymbol: 'USDC' | 'USDT'
  destTokenLabel: 'USDCe' | 'USDT0' | 'WETH'
  routeLabel: string
  bridgeFeeDisplay: number
  receiveAmountDisplay: number

  // balances to decide source chain
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

export const DepositModal: FC<ReviewDepositModalProps> = (props) => {
  const {
    open, onClose, snap,
    amount, sourceSymbol, destTokenLabel,
    routeLabel, bridgeFeeDisplay, receiveAmountDisplay,
    liBal, liBalUSDT0,
    opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal,
  } = props

  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()

  const tokenDecimals = useMemo(
    () => toTokenDecimals((snap.token as any) === 'WETH' ? 'WETH' : 'USDC'),
    [snap.token]
  )

  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)

  // recovery-aware caches for retry behavior
  const [bridgeOk, setBridgeOk] = useState(false)
  const [cachedInputAmt, setCachedInputAmt] = useState<bigint | null>(null)
  const [cachedMinOut, setCachedMinOut] = useState<bigint | null>(null)
  const [cachedDestAddr, setCachedDestAddr] = useState<`0x${string}` | null>(null)

  // success modal
  const [showSuccess, setShowSuccess] = useState(false)

  const canStart = open && !!walletClient && Number(amount) > 0

  const feeDisplay = useMemo(() => bridgeFeeDisplay ?? 0, [bridgeFeeDisplay])
  const receiveDisplay = useMemo(() => receiveAmountDisplay ?? 0, [receiveAmountDisplay])
  const amountNumber = Number(amount || 0)

  function pickSrcBy(target: bigint, o?: bigint | null, b?: bigint | null): 'optimism' | 'base' {
    const amt = target
    const op = o ?? 0n
    const ba = b ?? 0n
    if (op >= amt) return 'optimism'
    if (ba >= amt) return 'base'
    return op >= ba ? 'optimism' : 'base'
  }

  async function ensureWalletChain(chainId: number) {
    try {
      if ((walletClient as any)?.chain?.id === chainId) return
    } catch {}
    await walletClient!.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    })
  }

  async function waitForLiskBalanceAtLeast(opts: {
    user: `0x${string}`
    tokenAddr: `0x${string}`
    target: bigint
    start?: bigint
    pollMs?: number
    timeoutMs?: number
  }) {
    const { user, tokenAddr, target, start = 0n, pollMs = 6000, timeoutMs = 15 * 60_000 } = opts
    const endAt = Date.now() + timeoutMs
    let last = start
    while (true) {
      const bal = await readWalletBalance('lisk', tokenAddr, user).catch(() => null)
      if (bal !== null) {
        last = bal
        if (bal >= target) return bal
      }
      if (Date.now() > endAt) throw new Error(`Bridging not finalized on Lisk: balance ${last} < required ${target}`)
      await new Promise(r => setTimeout(r, pollMs))
    }
  }

  // deposit-only retry path (when bridge already succeeded)
  async function depositOnlyRetry() {
    if (!walletClient) return
    if (!cachedDestAddr) throw new Error('Missing cached destination token')
    const amt = (cachedMinOut && cachedMinOut > 0n) ? cachedMinOut : (cachedInputAmt ?? 0n)
    if (amt <= 0n) throw new Error('Nothing to deposit')

    try {
      setError(null)
      setStep('depositing')
      await switchOrAddChainStrict(walletClient) // verified hop to Lisk
      await depositMorphoOnLiskAfterBridge(snap, amt, walletClient)
      setStep('success')
      setShowSuccess(true)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  async function handleConfirm() {
    if (!walletClient) { openConnect(); return }
    setError(null)
    setBridgeOk(false) // reset per run

    try {
      const inputAmt = parseUnits(amount || '0', snap.token === 'WETH' ? 18 : 6)
      const user = walletClient.account!.address as `0x${string}`

      if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')

      // pick dest token + address
      const destAddr =
        destTokenLabel === 'USDCe' ? (TokenAddresses.USDCe.lisk as `0x${string}`) :
        destTokenLabel === 'USDT0' ? (TokenAddresses.USDT0.lisk as `0x${string}`) :
        (TokenAddresses.WETH.lisk as `0x${string}`)

      // cache for recovery
      setCachedInputAmt(inputAmt)
      setCachedDestAddr(destAddr)

      // short-circuit: already on Lisk with enough balance (counts as "bridge ok")
      const haveOnLisk =
        destTokenLabel === 'USDCe' ? (liBal ?? 0n) :
        destTokenLabel === 'USDT0' ? (liBalUSDT0 ?? 0n) : 0n

      if (haveOnLisk >= inputAmt) {
        setBridgeOk(true)
        setCachedMinOut(inputAmt)
        setStep('depositing')
        await ensureWalletChain(liskChain.id)
        await depositMorphoOnLiskAfterBridge(snap, inputAmt, walletClient)
        setStep('success')
        setShowSuccess(true)
        return
      }

      // choose source token/chain for the bridge
      const srcToken: 'USDC' | 'USDT' = destTokenLabel === 'USDT0' ? sourceSymbol : 'USDC'
      const srcChain: 'optimism' | 'base' =
        srcToken === 'USDC'
          ? pickSrcBy(inputAmt, opUsdcBal, baUsdcBal)
          : pickSrcBy(inputAmt, opUsdtBal, baUsdtBal)

      setStep('bridging')

      const preBal = (await readWalletBalance('lisk', destAddr, user).catch(() => 0n)) as bigint

      // conservative minOut via fresh quote
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

      // switch to src chain & execute bridge
      const srcViem = srcChain === 'optimism' ? CHAINS.optimism : CHAINS.base
      await switchOrAddChain(walletClient, srcViem)
      await bridgeTokens(destTokenLabel, inputAmt, srcChain, 'lisk', walletClient, {
        sourceToken: srcToken,
        onUpdate: (u) => {
          try { console.info('[bridge/update]', JSON.stringify(u)) }
          catch { console.info('[bridge/update]', u) }
        },
      })

      // wait until tokens land on user's Lisk wallet
      await waitForLiskBalanceAtLeast({
        user,
        tokenAddr: destAddr,
        target: preBal + (minOut > 0n ? minOut : 1n),
        start: preBal,
        pollMs: 6000,
        timeoutMs: 15 * 60_000,
      })

      // mark bridge success for recovery and proceed to deposit
      setBridgeOk(true)

      setStep('depositing')
      await switchOrAddChainStrict(walletClient)
      await depositMorphoOnLiskAfterBridge(snap, minOut > 0n ? minOut : inputAmt, walletClient)

      setStep('success')
      setShowSuccess(true)
    } catch (e: any) {
      console.error('[deposit] error', e)
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  // ---------- UI state mapping ----------
  const approveState: 'idle' | 'working' | 'done' | 'error' =
    step === 'idle' ? 'idle' : step === 'error' ? 'error' : 'done'
  const bridgeState: 'idle' | 'working' | 'done' | 'error' =
    step === 'bridging' ? 'working'
      : step === 'depositing' || step === 'success' || (step === 'error' && bridgeOk) ? 'done'
      : step === 'error' ? 'error'
      : 'idle'
  const depositState: 'idle' | 'working' | 'done' | 'error' =
    step === 'depositing' ? 'working'
      : step === 'success' ? 'done'
      : step === 'error' && bridgeState === 'done' ? 'error'
      : 'idle'

  // ---------- Retry semantics ----------
  // If the flow fails BEFORE successful bridging → restart entire flow.
  // If bridging succeeded but deposit failed → retry deposit only.
  const primaryCta =
    step === 'error' ? (bridgeOk ? 'Retry deposit' : 'Try again')
      : step === 'idle' ? 'Deposit'
      : step === 'bridging' ? 'Sign bridge transaction…'
      : step === 'depositing' ? 'Depositing…'
      : step === 'success' ? 'Done'
      : 'Working…'

  const onPrimary = () => {
    if (step === 'error') {
      if (bridgeOk) { void depositOnlyRetry(); return }
      // restart full flow
      setError(null)
      setStep('idle')
      void handleConfirm()
      return
    }
    if (step === 'success') { setShowSuccess(true); return }
    if (step === 'idle') { void handleConfirm(); return }
  }

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-start justify-center p-3 sm:p-4">
        <div className={`w-full max-w-lg rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold">{step === 'error' ? 'Review deposit – Error' : 'Review deposit'}</h3>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-full"><X size={20} /></button>
          </div>

          <div className="px-5 py-4 space-y-5">
            <p className="text-sm text-muted-foreground">You&apos;re depositing</p>

            {/* row: source */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={sourceSymbol === 'USDT' ? '/tokens/usdt-icon.png' : '/tokens/usdc-icon.png'}
                  alt={sourceSymbol}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{Number(amountNumber).toString()}</div>
                <div className="text-xs text-muted-foreground">
                  ${amountNumber.toFixed(2)} • {sourceSymbol} on OP/Base
                </div>
              </div>
              {approveState === 'done' && <Check className="text-green-600" size={18} />}
              {approveState === 'error' && <AlertCircle className="text-red-600" size={18} />}
            </div>

            {/* row: bridging */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src={lifilogo.src} alt="bridge" width={28} height={28} className="rounded-full" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Bridging via LI.FI</div>
                <div className="text-xs text-muted-foreground">
                  Bridge Fee: {feeDisplay.toFixed(4)} {sourceSymbol}
                </div>
                <div className="text-xs text-muted-foreground">{routeLabel}</div>
              </div>
              {bridgeState === 'done' && (
                <a href="#" className="text-muted-foreground hover:text-foreground" onClick={(e) => e.preventDefault()}>
                  <ExternalLink size={16} />
                </a>
              )}
              {bridgeState === 'error' && <AlertCircle className="text-red-600" size={18} />}
            </div>

            {/* row: dest */}
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
                <div className="text-2xl font-bold">{(receiveDisplay ?? 0).toFixed(4)}</div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${amountNumber.toFixed(2)} • {destTokenLabel} on Lisk
                </div>
              </div>
              {depositState === 'done' && <Check className="text-green-600" size={18} />}
              {depositState === 'error' && <AlertCircle className="text-red-600" size={18} />}
            </div>

            {/* row: vault */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src="/protocols/morpho-icon.png" alt="Morpho" width={28} height={28} className="rounded-lg" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Depositing in Vault</div>
                <div className="text-xs text-muted-foreground">Re7 {snap.token} Vault (Morpho Blue)</div>
              </div>
            </div>

            {error && <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3">{error}</div>}
          </div>

          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-12 text-base"
              disabled={step === 'bridging' || step === 'depositing' || !canStart}
            >
              {primaryCta}
            </Button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <DepositSuccessModal
          amount={Number(amount || 0)}
          sourceToken={sourceSymbol}
          destinationAmount={Number(receiveDisplay ?? 0)}
          destinationToken={destTokenLabel}
          vault={`Re7 ${snap.token} Vault (Morpho Blue)`}
          onClose={() => { setShowSuccess(false); onClose() }}
        />
      )}
    </div>
  )
}
