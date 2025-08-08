'use client'
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
import { TokenAddresses } from '@/lib/constants'
import type { YieldSnapshot } from '@/hooks/useYields'

import { useEffect, useState, FC } from 'react'
import {  useAppKit } from '@reown/appkit/react'

import {
 
  parseUnits,
  formatUnits,
} from 'viem'

import { useWalletClient } from 'wagmi'

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const DepositModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openModal } = useAppKit()
  const { data: walletClient } = useWalletClient()

  const [amount, setAmount] = useState('')
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* fetch balances whenever the modal opens */
  useEffect(() => {
    if (!open || !walletClient) return          // <- guard
  
    const user = walletClient.account.address  
    console.log(user) // 0x… string
  
    const { optimism: tokOP, base: tokBA } = TokenAddresses[snap.token]
  
    ;(async () => {
      const { opBal, baBal } = await getDualBalances(
        { optimism: tokOP, base: tokBA },
        user as `0x${string}`,
      )
      setOpBal(opBal)
      setBaBal(baBal)
      console.log(opBal, baBal);
    })()
  }, [open, walletClient, snap.token])

  async function handleConfirm() {
    if (!walletClient) {            // user not connected
      openModal()                   // open Reown modal
      return
    }
  
    try {
      setBusy(true)
      setError(null)
  
      /* amount as bigint */
      const amt  = parseUnits(amount as `${number}`, 6)
      const dest = snap.chain as 'optimism' | 'base'
  
      /* bridge if needed, then deposit */
      await ensureLiquidity(snap.token, amt, dest, walletClient)
      await depositToPool(snap, amt, walletClient)
  
      onClose()
      alert(`✅ Deposited ${amount} ${snap.token}`)
    } catch (e: any) {
      setError(e.shortMessage ?? e.message ?? 'Tx failed')
    } finally {
      setBusy(false)
    }
  }
  

  /* ---------- render ---------- */
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Deposit {snap.token}
          </DialogTitle>
        </DialogHeader>

        {/* balances */}
        <div className="space-y-1 text-sm">
          <p>Balances:</p>
          <p>
            Optimism:{' '}
            {opBal !== null ? formatUnits(opBal, 6) : '…'} {snap.token}
          </p>
          <p>
            Base:{' '}
            {baBal !== null ? formatUnits(baBal, 6) : '…'} {snap.token}
          </p>
        </div>

        {/* amount input */}
        <Input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={onClose} title={'Cancel'}>
            Cancel
          </Button>
          <Button
                      disabled={busy || !amount}
                      onClick={handleConfirm} title={busy ? 'Processing…' : 'Confirm'}          >
            {busy ? 'Processing…' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
