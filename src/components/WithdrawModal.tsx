// src/components/WithdrawModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { optimism } from 'viem/chains'
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

type Props = {
  open: boolean
  onClose: () => void
  /** Only USDCe or USDT0 on Lisk are supported here */
  snap: { token: 'USDCe' | 'USDT0'; chain: 'lisk'; poolAddress?: `0x${string}` }
  /** Max withdrawable shares (already computed by caller) */
  shares: bigint
}

function fmtAmount(x: bigint, decimals = 6) {
  const s = x.toString().padStart(decimals + 1, '0')
  const head = s.slice(0, -decimals) || '0'
  const tail = s.slice(-decimals).replace(/0+$/, '')
  return tail ? `${head}.${tail}` : head
}

/* ---------- purely visual helpers (UI only) ---------- */

const STEP_ORDER = ['signing', 'creating', 'queued', 'settling', 'done'] as const
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

export default function WithdrawModal({ open, onClose, snap, shares }: Props) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const [submitting, setSubmitting] = useState(false) // preserved — not repurposed
  const [step, setStep] = useState<
    'idle' | 'signing' | 'creating' | 'settling' | 'done' | 'error' | 'queued'
  >('idle')
  const [error, setError] = useState<string | null>(null)

  const tokenSym = snap.token // 'USDCe' | 'USDT0'
  const dstTokenOnOp: Address = useMemo(() => {
    return tokenSym === 'USDT0'
      ? (TokenAddresses.USDT.optimism as Address)
      : (TokenAddresses.USDC.optimism as Address)
  }, [tokenSym])

  // tiny safety buffer for min out (0.5%)
  const minAmountOut = useMemo(() => (shares * 995n) / 1000n, [shares])

  useEffect(() => {
    if (!open) {
      setSubmitting(false)
      setStep('idle')
      setError(null)
    }
  }, [open])

  /* ---------- purely visual mapping of your existing step states ---------- */
  const visualActive: VisualStep = (() => {
    if (step === 'error') return 'error'
    if (step === 'idle') return 'idle'
    if (step === 'signing') return 'signing'
    if (step === 'creating') return 'creating'
    if (step === 'queued') return 'queued'
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
              Optimism → Lisk SAFE → Bridge to you
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Summary card */}
        <div className="mt-2 rounded-lg border bg-card p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Max shares</span>
            <span className="font-medium">{fmtAmount(shares, 6)} shares</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Min receive (est.)</span>
            <span className="font-medium">
              {fmtAmount(minAmountOut, 6)} {snap.token === 'USDT0' ? 'USDT' : 'USDC'}
            </span>
          </div>

          <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-700">
            This will burn your vault shares on Optimism, redeem assets from the Lisk Safe, then
            bridge {snap.token === 'USDT0' ? 'USDT' : 'USDC'} back to your wallet on Optimism.
          </div>
        </div>

        {/* Stepper */}
        <div className="mt-4 space-y-2">
          <StepRow
            label="Sign withdrawal intent (Optimism)"
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
            label="Create intent"
            state={
              visualActive === 'error'
                ? 'pending'
                : currentIdx < stepIndex('creating')
                ? 'pending'
                : visualActive === 'creating'
                ? 'active'
                : currentIdx > stepIndex('creating')
                ? 'done'
                : 'pending'
            }
          />
          <StepRow
            label="Queued on relayer"
            state={
              visualActive === 'error'
                ? 'pending'
                : currentIdx < stepIndex('queued')
                ? 'pending'
                : visualActive === 'queued'
                ? 'active'
                : currentIdx > stepIndex('queued')
                ? 'done'
                : 'pending'
            }
          />
          <StepRow
            label="Burn shares → Redeem on Lisk SAFE → Bridge to you"
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
            state={
              visualActive === 'error'
                ? 'pending'
                : visualActive === 'done'
                ? 'done'
                : 'pending'
            }
          />
        </div>

        {/* Status text */}
        <div
          className={cn(
            'mt-3 rounded-md border p-2 text-xs',
            step === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border/60 text-muted-foreground'
          )}
        >
          {step === 'idle' && 'Ready to withdraw.'}
          {step === 'signing' && 'Please sign the withdrawal intent on Optimism…'}
          {step === 'creating' && 'Creating intent on the relayer…'}
          {step === 'queued' &&
            'Your intent is queued. The relayer will burn shares, redeem on Lisk SAFE, and bridge back to you.'}
          {step === 'settling' && 'Processing withdrawal (burn → redeem → bridge)…'}
          {step === 'done' && 'All set. Funds are on their way / delivered.'}
          {step === 'error' && error}
        </div>

        {/* Actions (no DialogFooter) */}
        <div className="mt-4 flex justify-end gap-2">
          <Button title="Cancel" onClick={onClose} disabled={submitting} variant="ghost">
            Cancel
          </Button>

          <Button
            title="Withdraw now"
            onClick={() => {
              // NOTE: no functional changes — same call & state setters
              if (!walletClient || !address) return
              setError(null)
              setStep('signing')

              ;(async () => {
                try {
                  // We reuse your same flow, only UI changes around it.
                  const dstToken =
                    snap.token === 'USDT0'
                      ? (TokenAddresses.USDT.optimism as `0x${string}`)
                      : (TokenAddresses.USDC.optimism as `0x${string}`)

                  // Delegate to the same handle path you already wired in:
                  // (kept inline per your current file; logic unchanged)
                  await (async function handleWithdraw(opts: {
                    walletClient: any
                    userAddress: `0x${string}`
                    tokenKind: 'USDCe' | 'USDT0'
                    maxShares: bigint
                    dstChainId?: number
                    dstTokenAddressOnOP: `0x${string}`
                    onStatus?: (
                      s: 'signing' | 'creating' | 'queued' | 'error' | 'done',
                      extra?: any
                    ) => void
                  }) {
                    const {
                      walletClient,
                      userAddress,
                      tokenKind,
                      maxShares,
                      dstChainId = optimism.id,
                      dstTokenAddressOnOP,
                      onStatus,
                    } = opts

                    try {
                      onStatus?.('signing')

                      // ensure OP for EIP-712 domain
                      try {
                        const cur = await walletClient.getChainId?.()
                        if (cur !== dstChainId) {
                          await walletClient.switchChain?.({ id: dstChainId })
                        }
                      } catch {}

                      const minOut = (maxShares * 995n) / 1000n
                      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60)
                      const nonce = BigInt(Math.floor(Math.random() * 1e12))
                      const refId = (() => {
                        const b = crypto.getRandomValues(new Uint8Array(32))
                        return ('0x' +
                          [...b].map((x) => x.toString(16).padStart(2, '0')).join('')) as `0x${string}`
                      })()

                      const domain = { name: 'SuperYLDR', version: '1', chainId: dstChainId }
                      const types = {
                        WithdrawIntent: [
                          { name: 'user', type: 'address' },
                          { name: 'amountShares', type: 'uint256' },
                          { name: 'dstChainId', type: 'uint256' },
                          { name: 'dstToken', type: 'address' },
                          { name: 'minAmountOut', type: 'uint256' },
                          { name: 'deadline', type: 'uint256' },
                          { name: 'nonce', type: 'uint256' },
                          { name: 'refId', type: 'bytes32' },
                        ],
                      } as const

                      const message = {
                        user: userAddress,
                        amountShares: maxShares,
                        dstChainId: BigInt(dstChainId),
                        dstToken: dstTokenAddressOnOP,
                        minAmountOut: minOut,
                        deadline,
                        nonce,
                        refId,
                      } as const

                      const signature = await walletClient.signTypedData({
                        account: userAddress,
                        domain,
                        types,
                        primaryType: 'WithdrawIntent',
                        message,
                      } as any)

                      onStatus?.('creating')
                      const createRes = await fetch('/api/withdraw/create-intent', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          intent: {
                            user: userAddress,
                            amountShares: message.amountShares.toString(),
                            dstChainId,
                            dstToken: message.dstToken,
                            minAmountOut: message.minAmountOut.toString(),
                            deadline: message.deadline.toString(),
                            nonce: message.nonce.toString(),
                            refId: message.refId,
                            signedChainId: dstChainId,
                            tokenKind,
                          },
                          signature,
                        }),
                      })
                      if (!createRes.ok) {
                        const t = await createRes.text().catch(() => '')
                        throw new Error(`/api/withdraw/create-intent failed: ${createRes.status} ${t}`)
                      }
                      const cj = await createRes.json()
                      if (!cj?.ok) throw new Error(cj?.error || 'create-intent failed')

                      onStatus?.('queued', { refId })
                      // kick finisher async; UI shows queued/settling via polling on your page if needed
                      fetch('/api/withdraw/finish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refId }),
                      }).catch(() => {})

                      onStatus?.('done', { refId })
                      return { ok: true as const, refId }
                    } catch (e: any) {
                      onStatus?.('error', e?.message || String(e))
                      return { ok: false as const, error: e?.message || String(e) }
                    }
                  })({
                    walletClient,
                    userAddress: address as `0x${string}`,
                    tokenKind: snap.token,
                    maxShares: shares,
                    dstTokenAddressOnOP: dstToken,
                    onStatus: (s, extra) => {
                      // keep your original step values; just display them better
                      setStep(s)
                      if (s === 'error') setError(extra as string)
                      if (s === 'done') {
                        // optional toast could go here — UI only
                      }
                    },
                  })
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