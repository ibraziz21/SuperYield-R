// src/components/WithdrawModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { lisk as liskChain } from 'viem/chains'
import type { Address } from 'viem'
import { useAccount, useWalletClient } from 'wagmi'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { TokenAddresses } from '@/lib/constants'
import { withdrawMorphoOnLisk } from '@/lib/withdrawer'

type Props = {
  open: boolean
  onClose: () => void
  /** Only USDCe or USDT0 on Lisk are supported here */
  snap: { token: 'USDCe' | 'USDT0'; chain: 'lisk'; poolAddress: `0x${string}` }
  /** Max withdrawable shares (already computed by caller) */
  shares: bigint
}

function fmtAmount(x: bigint, decimals = 6) {
  const s = x.toString().padStart(decimals + 1, '0')
  const head = s.slice(0, -decimals) || '0'
  const tail = s.slice(-decimals).replace(/0+$/, '')
  return tail ? `${head}.${tail}` : head
}

const STEP_ORDER = ['signing', 'settling', 'done'] as const
type VisualStep = (typeof STEP_ORDER)[number] | 'error' | 'idle'

function stepIndex(s: VisualStep): number {
  const i = STEP_ORDER.indexOf(s as any)
  return i === -1 ? -1 : i
}

function StepRow({
  label,
  state,
}: {
  label: string
  state: 'pending' | 'active' | 'done' | 'error'
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
        state === 'done' && 'border-emerald-400/40 bg-emerald-500/5',
        state === 'active' && 'border-blue-400/40 bg-blue-500/5',
        state === 'pending' && 'border-border/60',
        state === 'error' && 'border-destructive/40 bg-destructive/10'
      )}
    >
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          state === 'done' && 'bg-emerald-500',
          state === 'active' && 'bg-blue-500 animate-pulse',
          state === 'pending' && 'bg-muted-foreground/40',
          state === 'error' && 'bg-destructive'
        )}
      />
      <span className="flex-1">{label}</span>
      {state === 'done' && <span className="text-xs text-emerald-600">done</span>}
      {state === 'active' && <span className="text-xs text-blue-600">working…</span>}
    </div>
  )
}

async function ensureWalletChain(walletClient: any, chainId: number) {
  try {
    if ((walletClient as any)?.chain?.id === chainId) return
  } catch {}
  await walletClient.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  })
}

export default function WithdrawModal({ open, onClose, snap, shares }: Props) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<'idle' | 'signing' | 'settling' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const tokenSym = snap.token // 'USDCe' | 'USDT0'
  const underlyingOnLisk: Address = useMemo(() => {
    return tokenSym === 'USDT0'
      ? (TokenAddresses.USDT0.lisk as Address)
      : (TokenAddresses.USDCe.lisk as Address)
  }, [tokenSym])

  useEffect(() => {
    if (!open) {
      setSubmitting(false)
      setStep('idle')
      setError(null)
    }
  }, [open])

  const visualActive: VisualStep = (() => {
    if (step === 'error') return 'error'
    if (step === 'idle') return 'idle'
    if (step === 'signing') return 'signing'
    if (step === 'settling') return 'settling'
    if (step === 'done') return 'done'
    return 'idle'
  })()

  const currentIdx = stepIndex(visualActive)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Withdraw {snap.token}</span>
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              Lisk vault shares → {snap.token === 'USDT0' ? 'USDT0' : 'USDCe'} to you (Lisk)
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 rounded-lg border bg-card p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Max shares</span>
            <span className="font-medium">{fmtAmount(shares, 6)} shares</span>
          </div>
          <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-700">
            This will transfer your vault shares to the adapter, redeem underlying to the router,
            apply the router’s withdraw fee (if any), and send net {snap.token} to your Lisk wallet.
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <StepRow
            label="Confirm on Lisk"
            state={
              visualActive === 'error'
                ? 'pending'
                : currentIdx < stepIndex('signing')
                ? 'done'
                : visualActive === 'signing'
                ? 'active'
                : currentIdx > stepIndex('signing')
                ? 'done'
                : 'pending'
            }
          />
          <StepRow
            label="Redeem & transfer"
            state={
              visualActive === 'error'
                ? 'pending'
                : currentIdx < stepIndex('settling')
                ? 'pending'
                : visualActive === 'settling'
                ? 'active'
                : currentIdx > stepIndex('settling')
                ? 'done'
                : 'pending'
            }
          />
          <StepRow
            label="Withdrawal complete"
            state={visualActive === 'done' ? 'done' : 'pending'}
          />
        </div>

        <div
          className={cn(
            'mt-3 rounded-md border p-2 text-xs',
            step === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border/60 text-muted-foreground'
          )}
        >
          {step === 'idle' && 'Ready to withdraw.'}
          {step === 'signing' && 'Please confirm the transaction on Lisk…'}
          {step === 'settling' && 'Redeeming shares and sending net underlying to you…'}
          {step === 'done' && 'All set.'}
          {step === 'error' && error}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button title="Cancel" onClick={onClose} disabled={submitting} variant="ghost">
            Cancel
          </Button>

          <Button
            title="Withdraw now"
            onClick={() => {
              if (!walletClient || !address) return
              setError(null)
              setStep('signing')

              ;(async () => {
                try {
                  await ensureWalletChain(walletClient, liskChain.id)

                  setStep('settling')
                  await withdrawMorphoOnLisk({
                    token: snap.token,                 // 'USDCe' | 'USDT0'
                    shares,                            // SHARES amount (no scaling)
                    shareToken: snap.poolAddress,      // Vault (ERC-4626) address
                    underlying: underlyingOnLisk as `0x${string}`,      // Lisk underlying token
                    to: address as `0x${string}`,      // receiver on Lisk
                    wallet: walletClient,
                  })

                  setStep('done')
                } catch (e: any) {
                  setError(e?.message || String(e))
                  setStep('error')
                }
              })()
            }}
            disabled={submitting || shares === 0n}
          >
            {submitting ? 'Working…' : 'Withdraw now'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
