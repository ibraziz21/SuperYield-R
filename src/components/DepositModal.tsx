'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { providerBase, providerOptimism } from '@/lib/rpc'
import { getBalance } from '@/lib/balances'
import { ensureLiquidity } from '@/lib/smartbridge'
import { depositToPool } from '@/lib/depositor'
import { TokenAddresses } from '@/lib/constants'
import type { YieldSnapshot } from '@/hooks/useYields'
import { FC, useEffect, useState } from 'react'
import {  ethers } from 'ethers'
import { useAppKitProvider } from '@reown/appkit/react'

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const DepositModal: FC<Props> = ({ open, onClose, snap }) => {
  const { walletProvider } = useAppKitProvider('eip155')

  const [amount, setAmount] = useState('')
  const [opBal, setOpBal]   = useState<ethers.BigNumber | null>(null)
  const [baBal, setBaBal]   = useState<ethers.BigNumber | null>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  /* fetch balances whenever modal opens */
  useEffect(() => {
    if (!open || !walletProvider) return
    ;(async () => {
      const provider = new ethers.providers.Web3Provider(walletProvider as any)
      const user     = await provider.getSigner().getAddress()
      const tokAddr  = TokenAddresses[snap.token]
      const [op, ba] = await Promise.all([
        getBalance(tokAddr.optimism, user, 'optimism', providerOptimism),
        getBalance(tokAddr.base,     user, 'base',     providerBase),
      ])
      setOpBal(op); setBaBal(ba)
    })()
  }, [open, walletProvider, snap.token])

  async function handleConfirm() {
    if (!walletProvider) return
    const provider = new ethers.providers.Web3Provider(walletProvider as any)
    const signer   = provider.getSigner()

    try {
      setBusy(true); setError(null)
      const amt = ethers.utils.parseUnits(amount, 6)
      const dest = snap.chain as 'optimism' | 'base'

      await ensureLiquidity(snap.token, amt, dest, signer, providerOptimism, providerBase)
      await depositToPool(snap, amt, signer)

      onClose()
      alert(`✅ Deposited ${amount} ${snap.token}`)
    } catch (e: any) {
      setError(e.message || 'Tx failed')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">Deposit {snap.token}</DialogTitle>
        </DialogHeader>

        {/* balances */}
        <div className="space-y-1 text-sm">
          <p>Balances:</p>
          <p>Optimism: {opBal ? ethers.utils.formatUnits(opBal, 6) : '…'} {snap.token}</p>
          <p>Base:      {baBal ? ethers.utils.formatUnits(baBal, 6) : '…'} {snap.token}</p>
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
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="secondary" onClick={onClose} title={'Cancel'}>Cancel</Button>
          <Button disabled={busy || !amount} onClick={handleConfirm} title={busy ? 'Processing…' : 'Confirm'}>
            {busy ? 'Processing…' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
