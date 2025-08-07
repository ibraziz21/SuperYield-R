/* components/positions/WithdrawModal.tsx
   ─────────────────────────────────────── */
   'use client'
   import {
     Dialog,
     DialogContent,
     DialogHeader,
     DialogTitle,
   } from '@/components/ui/dialog'
   import { Input } from '@/components/ui/input'
   import { Button } from '@/components/ui/button'
   
   import { getDualBalances }   from '@/lib/balances'
   import { withdrawFromPool }  from '@/lib/withdraw'
   import { TokenAddresses }    from '@/lib/constants'
   import type { YieldSnapshot } from '@/hooks/useYields'
   
   import { useEffect, useState, FC } from 'react'
   import { useAppKit } from '@reown/appkit/react'
   import { parseUnits, formatUnits } from 'viem'
   import { useWalletClient } from 'wagmi'
   
   interface Props {
     open: boolean
     onClose: () => void
     snap: YieldSnapshot          // same snapshot you pass to DepositModal
   }
   
   export const WithdrawModal: FC<Props> = ({ open, onClose, snap }) => {
     const { open: openConnect } = useAppKit()
     const { data: walletClient } = useWalletClient()
   
     const [amount, setAmount] = useState('')
     const [opBal, setOpBal]   = useState<bigint | null>(null) // wallet balance
     const [poolBal, setPoolBal] = useState<bigint | null>(null) // supplied balance
     const [busy, setBusy] = useState(false)
     const [error, setError] = useState<string | null>(null)
   
     /* fetch wallet & pool balance when modal opens */
     useEffect(() => {
       if (!open || !walletClient) return
   
       const user = walletClient.account.address
       const { optimism: tokOP } = TokenAddresses[snap.token]
   
       ;(async () => {
         const { opBal } = await getDualBalances({ optimism: tokOP, base: tokOP }, user)
         setOpBal(opBal)
   
         /* You probably have a helper to get the user’s supply for this pool */
         const supplied = await snap.getUserSupply(user)  // pseudo
         setPoolBal(supplied)
       })()
     }, [open, walletClient, snap])
   
     async function handleConfirm() {
       if (!walletClient) {
         openConnect()
         return
       }
   
       try {
         setBusy(true)
         setError(null)
   
         const amt = parseUnits(amount as `${number}`, 6)
         await withdrawFromPool(snap, amt, walletClient)
   
         onClose()
         alert(`✅ Withdrew ${amount} ${snap.token}`)
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
             <DialogTitle className="text-lg">Withdraw {snap.token}</DialogTitle>
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
             <Button variant="secondary" onClick={onClose} title={'Cancel'}>
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
   