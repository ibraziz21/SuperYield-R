// src/components/positions/WithdrawModal.tsx
'use client'

import { useEffect, useState, FC } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { parseUnits, formatUnits } from 'viem'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'

import { getDualBalances } from '@/lib/balances'
import { withdrawFromPool } from '@/lib/withdraw'
import { TokenAddresses } from '@/lib/constants'
import type { YieldSnapshot } from '@/hooks/useYields'

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const WithdrawModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()

  const [amount, setAmount] = useState('')
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [poolBal, setPoolBal] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !walletClient) return

    const user = walletClient.account.address as `0x${string}`

    // Narrow the token map so TS knows it has optimism & base keys
    const tokenMap = TokenAddresses[snap.token] as {
      optimism: `0x${string}`
      base:     `0x${string}`
    }

    // Fetch wallet balances
    getDualBalances(
      { optimism: tokenMap.optimism, base: tokenMap.base },
      user,
    ).then(({ opBal }) => setOpBal(opBal))

    // Fetch pool (supplied) balance by reusing getDualBalances on the vault address
    const vaultAddr = snap.poolAddress as `0x${string}`
    getDualBalances(
      { optimism: vaultAddr, base: vaultAddr },
      user,
    ).then(({ opBal: vOp }) => {
      // choose the relevant side
      setPoolBal(snap.chain === 'optimism' ? vOp : vOp)
    })
  }, [open, walletClient, snap])

  async function handleConfirm() {
    if (!walletClient) {
      openConnect()
      return
    }

    try {
      setBusy(true)
      setError(null)

      const amt = parseUnits(amount, 6)
      await withdrawFromPool(snap, amt, walletClient)

      onClose()
      alert(`✅ Withdrew ${amount} ${snap.token}`)
    } catch {
      setError('Tx failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Withdraw {snap.token}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <p>Supplied balance:</p>
          <p>
            {poolBal !== null ? formatUnits(poolBal, 6) : '…'} {snap.token}
          </p>
          <p className="pt-2">Wallet balance:</p>
          <p>
            {opBal !== null ? formatUnits(opBal, 6) : '…'} {snap.token}
          </p>
        </div>

        <Input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={onClose} title="Cancel">
            Cancel
          </Button>
          <Button
            disabled={busy || !amount}
            onClick={handleConfirm}
            title={busy ? 'Processing…' : 'Confirm'}
          >
            {busy ? 'Processing…' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
