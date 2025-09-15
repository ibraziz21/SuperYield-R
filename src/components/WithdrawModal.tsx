// src/components/positions/WithdrawModal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import type { YieldSnapshot } from '@/hooks/useYields'
import { fetchVaultPosition } from '@/lib/positions'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

/* ──────────────────────────────────────────────────────────────── */
/* Server call: burn sAVault (OP) → router.withdraw (Lisk) → bridge */
/* ──────────────────────────────────────────────────────────────── */

async function callServerMorphoWithdrawAndBridge(params: {
  user: `0x${string}`
  sharesToBurn: bigint
}) {
  const res = await fetch('/api/withdraw/morpho', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      user: params.user,
      amount: params.sharesToBurn.toString(),   // ✅ send as `amount`
    }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Server withdraw failed (${res.status})`)
}

/* ──────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

type Status =
  | 'idle'
  | 'bridging'   // backend is burning shares + withdrawing on Lisk + bridging to OP
  | 'bridged'    // ✅ done
  | 'error'

export const WithdrawModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [shares, setShares] = useState<bigint | null>(null) // sAVault balance (18d)

  // Only Morph(lisk) path is supported now
  const isMorphoLisk = snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk'
  const shareDecimals = 18 // sAVault assumed 18d

  const title = useMemo(
    () => (isMorphoLisk ? 'Withdraw & Bridge (Morpho Lisk → Optimism)' : 'Withdraw'),
    [isMorphoLisk],
  )

  // Reset on open/snapshot change
  useEffect(() => {
    if (!open) return
    setStatus('idle')
    setError(null)
    setShares(null)
  }, [open, snap.id])

  // Load sAVault balance on OP using the new helper
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account?.address as `0x${string}` | undefined
    if (!user) return

    // If this snapshot isn't Morpho Lisk, we just show "unsupported" UI.
    if (!isMorphoLisk) { setShares(0n); return }

    ; (async () => {
      try {
        const s = await fetchVaultPosition(user)
        setShares(s ?? 0n)
      } catch (e) {
        setError('Failed to load vault shares')
        setShares(0n)
      }
    })()
  }, [open, walletClient, isMorphoLisk])

  /* ────────────────────────────────────────────────────────────────
     ACTION — Withdraw & Bridge (handled by backend relayer)
     ──────────────────────────────────────────────────────────────── */


  async function handleWithdrawAll() {
    if (!walletClient) { openConnect(); return }
    const user = walletClient.account?.address as `0x${string}`
    if (!user) { setError('Wallet not connected'); return }
    if (!isMorphoLisk) { setError('Only Morpho on Lisk is supported in this flow.'); return }
    if (!shares || shares === 0n) { setError('Nothing to withdraw'); return }

    try {
      setError(null)
      setStatus('bridging')

      console.log(shares, "Shares")
      // Until you compute exact assets, use 1:1 (same assumption as API default)
      await callServerMorphoWithdrawAndBridge({
        user,
        sharesToBurn: shares,
        // send it so API validation passes
      })

      setStatus('bridged')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  /* ─────────── UI helpers ─────────── */

  const sharesPretty =
    typeof shares === 'bigint' ? formatUnits(shares, shareDecimals) : '0'

  const canWithdraw =
    status === 'idle' && isMorphoLisk && typeof shares === 'bigint' && shares > 0n

  function HeaderBar() {
    return (
      <div className="sticky top-0 z-30 flex items-center justify-between bg-gradient-to-r from-teal-600 to-emerald-500 px-5 py-4 text-white">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold sm:text-lg">{title}</DialogTitle>
        </DialogHeader>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium">
          {snap.chain.toUpperCase()}
        </span>
      </div>
    )
  }

  function TokenCard() {
    return (
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold">
            {snap.token.slice(0, 1)}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-medium">{snap.token}</div>
            <div className="text-xs text-gray-500">{snap.protocol}</div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-500">sAVault Shares</div>
          <div className="text-lg font-semibold">
            {['bridging'].includes(status) ? '…' : sharesPretty}
          </div>
        </div>
      </div>
    )
  }

  function UnsupportedCard() {
    if (isMorphoLisk) return null
    return (
      <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-700">
        This build currently supports withdrawals only for Morpho positions on Lisk via the relayer.
      </p>
    )
  }

  function ProgressCard() {
    if (status !== 'bridging') return null
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
          <div className="text-sm font-medium">Processing on relayer…</div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Burning your sAVault shares on Optimism, withdrawing from the Safe on Lisk, then bridging USDC.e → USDC to your Optimism address.
        </p>
      </div>
    )
  }

  function SuccessCard() {
    if (status !== 'bridged') return null
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-semibold">Withdrawal & Bridge complete</span>
        </div>
        <p className="mt-2 text-xs text-emerald-700">
          Funds should now be in your Optimism wallet as USDC.
        </p>
      </div>
    )
  }

  function ErrorCard() {
    if (status !== 'error') return null
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">Something went wrong</span>
        </div>
        <p className="mt-2 break-words text-xs text-red-700">
          {error ?? 'Unknown error'}
        </p>
      </div>
    )
  }

  /* ─────────── Render ─────────── */

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="
          w-[min(100vw-1rem,40rem)] sm:w-auto sm:max-w-md
          h-[min(90dvh,640px)] sm:h-auto
          overflow-hidden rounded-xl sm:rounded-2xl p-0 shadow-xl
        "
      >
        <HeaderBar />

        {/* Body */}
        <div className="flex max-h-[calc(90dvh-56px)] flex-col overflow-hidden sm:max-h-none">
          <div className="flex-1 space-y-4 overflow-y-auto bg-white p-4 sm:p-5">
            <TokenCard />
            <UnsupportedCard />
            <ProgressCard />
            <SuccessCard />
            <ErrorCard />
          </div>

          {/* Sticky action bar */}
          <div
            className="sticky bottom-0 border-t bg-white px-4 py-3 sm:px-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              {status === 'idle' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={onClose}
                    className="h-12 w-full rounded-full sm:h-9 sm:w-auto"
                    title="Cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleWithdrawAll}
                    disabled={!canWithdraw}
                    className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                    title="Withdraw & Bridge"
                  >
                    Withdraw & Bridge
                  </Button>
                </>
              )}

              {status === 'bridging' && (
                <>
                  <Button variant="secondary" disabled className="h-12 w-full rounded-full sm:h-9 sm:w-auto" title="Cancel">
                    Cancel
                  </Button>
                  <Button disabled className="h-12 w-full rounded-full bg-teal-600 sm:h-9 sm:w-auto" title="Processing...">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing…
                    </span>
                  </Button>
                </>
              )}

              {status === 'bridged' && (
                <Button
                  onClick={onClose}
                  className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                  title="Done"
                >
                  Done
                </Button>
              )}

              {status === 'error' && (
                <div className="flex w-full gap-2 sm:justify-end">
                  <Button
                    variant="secondary"
                    onClick={onClose}
                    className="h-12 w-full rounded-full sm:h-9 sm:w-auto"
                    title="Close"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={handleWithdrawAll}
                    className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                    title="Retry"
                  >
                    Retry
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
