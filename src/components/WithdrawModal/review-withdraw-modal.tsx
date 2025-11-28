// src/components/WithdrawModal/review-withdraw-modal.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletClient } from 'wagmi'
import type { Address } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { withdrawMorphoOnLisk } from '@/lib/withdrawer'
import { bridgeWithdrawal } from '@/lib/bridge'
import { publicLisk } from '@/lib/clients'
import { erc20Abi } from 'viem'
import { CHAINS } from '@/lib/wallet'
import { switchOrAddChainStrict } from '@/lib/switch'
import lifi from '@/public/logo_lifi_light_vertical.png'
import { WithdrawSuccessModal } from './withdraw-success-modal'

type ChainSel = 'lisk' | 'optimism' | 'base'
type Visual =
  | 'idle'
  | 'withdrawing'      // trigger 1
  | 'sign-bridge'      // trigger 2
  | 'bridging'         // trigger 3
  | 'success'
  | 'error'

interface Props {
  open: boolean
  onClose: () => void
  snap: Pick<YieldSnapshot, 'token' | 'chain'> & { poolAddress: `0x${string}` } // token: 'USDC' | 'USDT', chain: 'lisk'
  shares: bigint
  // amount user typed (approximate pre-fee amount on Lisk, in token units)
  amountOnLiskDisplay: number
  // estimated bridge fee in dest token units (0 when dest === 'lisk')
  bridgeFeeDisplay: number
  // (old prop – now superseded by internal net calculation, but kept for compatibility)
  receiveOnDestDisplay: number
  dest: ChainSel
  user: `0x${string}`
}

function tokenLabelOnLisk(src: 'USDC' | 'USDT'): 'USDCe' | 'USDT0' {
  return src === 'USDC' ? 'USDCe' : 'USDT0'
}

const ICON = {
  mor: '/protocols/morpho-icon.png',
  bridge: lifi,
  USDC: '/tokens/usdc-icon.png',
  USDT: '/tokens/usdt-icon.png',
  USDCe: '/tokens/usdc-icon.png',
  USDT0: '/tokens/usdt0-icon.png',
} as const

async function readLiskBalance(token: `0x${string}`, user: `0x${string}`): Promise<bigint> {
  try {
    return (await publicLisk.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user],
    })) as bigint
  } catch {
    return 0n
  }
}

export const ReviewWithdrawModal: FC<Props> = ({
  open, onClose, snap, shares,
  amountOnLiskDisplay, bridgeFeeDisplay, receiveOnDestDisplay, // receiveOnDestDisplay kept but not trusted anymore
  dest, user,
}) => {
  const { data: walletClient } = useWalletClient()

  const [state, setState] = useState<Visual>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  // remember whether withdraw succeeded, and how much to bridge
  const [withdrawOk, setWithdrawOk] = useState(false)
  const [bridgableAmount, setBridgableAmount] = useState<bigint | null>(null)

  const liskToken: 'USDCe' | 'USDT0' = tokenLabelOnLisk(snap.token as 'USDC' | 'USDT')
  const destSymbol: 'USDC' | 'USDT' = liskToken === 'USDT0' ? 'USDT' : 'USDC'

  const liskTokenAddr = useMemo(
    () =>
      liskToken === 'USDCe'
        ? (TokenAddresses.USDCe.lisk as Address)
        : (TokenAddresses.USDT0.lisk as Address),
    [liskToken]
  )

  // ----- Fee math (UI-only, estimates) ---------------------------------------
  const grossAmount = amountOnLiskDisplay || 0
  const protocolFeePct = 0.005 // 0.5% vault withdraw fee
  const protocolFeeAmount = grossAmount > 0 ? grossAmount * protocolFeePct : 0
  const bridgeFeeAmount = dest === 'lisk' ? 0 : (bridgeFeeDisplay || 0)

  // Net amounts (approximate)
  const netOnLisk = Math.max(grossAmount - protocolFeeAmount, 0)
  const netOnDest = Math.max(grossAmount - protocolFeeAmount - bridgeFeeAmount, 0)

  // Visual helpers
  const trigger1Done =
    withdrawOk ||
    state === 'sign-bridge' ||
    state === 'bridging' ||
    state === 'success'
  const trigger2InError = state === 'error' && err?.toLowerCase().includes('signature')
  const trigger3InError = state === 'error' && !trigger2InError && withdrawOk

  const primaryLabel =
    state === 'success' ? 'Done'
      : state === 'withdrawing' ? 'Withdrawing…'
        : state === 'sign-bridge' ? 'Sign bridge transaction…'
          : state === 'bridging' ? 'Bridging…'
            : state === 'error' && withdrawOk ? 'Try bridge again'
              : state === 'error' ? 'Try again'
                : 'Withdraw now'

  // --- Flow pieces -----------------------------------------------------------

  async function doWithdraw(): Promise<bigint> {
    if (!walletClient) throw new Error('Wallet not connected')
    await switchOrAddChainStrict(walletClient, CHAINS.lisk)
    setState('withdrawing')

    // measure delta received from the withdraw
    const pre = await readLiskBalance(liskTokenAddr as `0x${string}`, user)

    await withdrawMorphoOnLisk({
      token: liskToken,                   // 'USDCe' | 'USDT0'
      shares,                             // bigint shares
      shareToken: snap.poolAddress,       // pool/shares token
      underlying: liskTokenAddr as `0x${string}`,
      to: user,
      wallet: walletClient,
    })

    // wait landing
    let tries = 0
    while (tries++ < 40) {
      const cur = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
      if (cur > pre) {
        const delta = cur - pre
        return delta
      }
      await new Promise(r => setTimeout(r, 1500))
    }

    // fallback: read once more and compute delta
    const cur = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
    if (cur <= pre) throw new Error('Withdrawal did not arrive on Lisk')
    return cur - pre
  }

  async function doBridge(amount: bigint) {
    if (!walletClient) throw new Error('Wallet not connected')
    if (dest === 'lisk') {
      setState('success')
      setShowSuccess(true)
      return
    }

    setState('sign-bridge')
    setState('bridging')

    const toChain: 'optimism' | 'base' = dest === 'optimism' ? 'optimism' : 'base'

    await bridgeWithdrawal({
      srcVaultToken: liskToken,   // 'USDCe' | 'USDT0'
      destToken: destSymbol,      // 'USDC' | 'USDT'
      amount,
      to: toChain,
      walletClient,
    })

    setState('success')
    setShowSuccess(true)
  }

  // Full flow
  async function startFullFlow() {
    if (!walletClient) return
    setErr(null)

    try {
      // 1) Withdraw
      const delta = await doWithdraw()
      setWithdrawOk(true)
      setBridgableAmount(delta)

      if (dest === 'lisk') {
        setState('success')
        return
      }

      // 2) Bridge
      await doBridge(delta)

    } catch (e: any) {
      const code = e?.code ?? e?.error?.code
      // user cancelled a signature during bridging → keep withdrawOk so we can resume bridge only
      if (code === 4001) {
        setErr('Signature was cancelled. You can try again.')
        if (withdrawOk) {
          setState('error') // shows "Try bridge again"
          return
        }
        setState('idle')
        return
      }

      setErr(e?.message ?? String(e))
      setState('error')
    }
  }

  // Bridge-only resume
  async function resumeBridgeOnly() {
    if (!walletClient) return
    setErr(null)

    try {
      let amount = bridgableAmount
      if (!amount || amount <= 0n) {
        amount = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
      }
      if (!amount || amount <= 0n) throw new Error('No funds available on Lisk to bridge')

      await doBridge(amount)
    } catch (e: any) {
      const code = e?.code ?? e?.error?.code
      if (code === 4001) {
        setErr('Signature was cancelled. You can try again.')
        setState('error')
        return
      }
      setErr(e?.message ?? String(e))
      setState('error')
    }
  }

  function onPrimary() {
    if (state === 'success') {
      setShowSuccess(true)
      return
    }
    if (state === 'error') {
      if (withdrawOk) {
        void resumeBridgeOnly()
      } else {
        setState('idle')
        void startFullFlow()
      }
      return
    }
    if (state === 'idle') {
      void startFullFlow()
      return
    }
  }

  // Disable only while actively working
  const isWorking =
    state === 'withdrawing' ||
    state === 'sign-bridge' ||
    state === 'bridging'

  const disabled = !walletClient || isWorking

  // Convenience for display
  const destChainLabel =
    dest === 'lisk' ? 'Lisk' : dest === 'optimism' ? 'OP Mainnet' : 'Base'

  const finalTokenOnDest = dest === 'lisk' ? liskToken : destSymbol
  const finalNetAmount = dest === 'lisk' ? netOnLisk : netOnDest

  // Step hint (intermediate copy)
  const stepHint = (() => {
    if (state === 'withdrawing') {
      return 'Withdrawing from the vault on Lisk. This usually takes under a minute.'
    }
    if (state === 'sign-bridge') {
      return 'Please confirm the bridge transaction in your wallet.'
    }
    if (state === 'bridging') {
      return 'Bridge in progress. Final arrival time depends on network congestion.'
    }
    if (state === 'success') {
      return 'Withdrawal complete. Your balances should update shortly.'
    }
    if (state === 'error') {
      return 'Something went wrong. Check the error below and retry.'
    }
    return 'Review the details and confirm your withdrawal.'
  })()

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div className={`w-full max-w-md my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
          {/* header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-lg font-semibold">
              {state === 'error' ? 'Review withdrawal – Error' : 'Review withdrawal'}
            </h3>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-full">
              <X size={20} />
            </button>
          </div>

          {/* body */}
          <div className="px-5 py-4 space-y-5">

            {/* row 1: withdrawing from vault */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src={ICON.mor} alt="Morpho" width={28} height={28} className="rounded-lg" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Withdrawing from Vault</div>
                <div className="text-xs text-muted-foreground">Re7 {snap.token} Vault (Morpho Blue)</div>
              </div>
              {trigger1Done && <Check className="text-green-600" size={18} />}
              {state === 'error' && !trigger1Done && <AlertCircle className="text-red-600" size={18} />}
            </div>

            {/* row 2: amount on Lisk (pre-fee estimate) */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src={ICON[liskToken]} alt={liskToken} width={28} height={28} className="rounded-full" />
                {/* Square network badge */}
                <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                  <Image
                    src="/networks/lisk.png"
                    alt="Lisk"
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{amountOnLiskDisplay}</div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${amountOnLiskDisplay.toFixed(2)} • {liskToken} on Lisk (before fees)
                </div>
              </div>
            </div>

            {/* row 3: bridging via LI.FI (or none if Lisk dest) */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src={ICON.bridge} alt="LI.FI" width={28} height={28} className="rounded-full" />
              // src/components/WithdrawModal/review-withdraw-modal.tsx (continued)
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">
                  {dest === 'lisk' ? 'No bridge needed' : 'Bridging via LI.FI'}
                </div>
                {dest !== 'lisk' && (
                  <div className="text-xs text-muted-foreground">
                    Bridge fee (est.): {bridgeFeeAmount.toFixed(6)} {destSymbol}
                  </div>
                )}

                {dest !== 'lisk' && (
                  <div className="mt-2 space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${trigger1Done ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                          }`}
                      />
                      <span>{destSymbol} spending approved</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${state === 'sign-bridge'
                            ? 'bg-blue-500 animate-pulse'
                            : state === 'bridging' || state === 'success'
                              ? 'bg-emerald-500'
                              : trigger2InError
                                ? 'bg-red-500'
                                : 'bg-muted-foreground/40'
                          }`}
                      />
                      <span>
                        {trigger2InError ? 'Signature required' : 'Sign bridge transaction'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${state === 'bridging'
                            ? 'bg-blue-500 animate-pulse'
                            : state === 'success'
                              ? 'bg-emerald-500'
                              : trigger3InError
                                ? 'bg-red-500'
                                : 'bg-muted-foreground/40'
                          }`}
                      />
                      <span>{trigger3InError ? 'Bridge failed' : 'Bridge transaction confirmed'}</span>
                    </div>
                  </div>
                )}
              </div>
              {(state === 'bridging' || state === 'success') && dest !== 'lisk' && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink size={16} />
                </a>
              )}
            </div>

            {/* row 4: final destination amount + fee breakdown */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={ICON[finalTokenOnDest]}
                  alt={finalTokenOnDest}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
                {dest !== 'lisk' && (
                  <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                    <Image
                      src={dest === 'optimism' ? '/networks/op-icon.png' : '/networks/base.png'}
                      alt={destChainLabel}
                      width={16}
                      height={16}
                      className="rounded-sm"
                    />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">
                  {finalNetAmount}
                </div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${finalNetAmount.toFixed(2)} • {finalTokenOnDest} on {destChainLabel}
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                  <div>
                    • 0.5% vault withdraw fee (~{protocolFeeAmount.toFixed(6)}{' '}
                    {dest === 'lisk' ? liskToken : destSymbol})
                  </div>
                  {dest !== 'lisk' && (
                    <div>
                      • Bridge fee (est.) ~{bridgeFeeAmount.toFixed(6)} {destSymbol}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {state === 'error' && (
              <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3">
                {err}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-12 text-base bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              disabled={disabled}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{primaryLabel}</span>
            </Button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <WithdrawSuccessModal
          liskAmount={netOnLisk}
          liskToken={liskToken}
          destAmount={dest === 'lisk' ? undefined : netOnDest}
          destToken={dest === 'lisk' ? undefined : destSymbol}
          destChain={dest}
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