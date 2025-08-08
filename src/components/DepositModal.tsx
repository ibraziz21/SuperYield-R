// src/components/DepositModal.tsx

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
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'

import { parseUnits, formatUnits } from 'viem'
import { optimism, base } from 'viem/chains'

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const DepositModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openModal } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const currentChainId = useChainId()
  const {
    switchChainAsync,
    isPending: isSwitching,
    error: switchError,
  } = useSwitchChain()

  const [amount, setAmount] = useState('')
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch balances whenever modal opens
  useEffect(() => {
    if (!open || !walletClient) return

    const user = walletClient.account.address
    // TokenAddresses has optimism & base for USDC/USDT
    const tokenMap = TokenAddresses[snap.token] as {
      optimism: `0x${string}`
      base: `0x${string}`
    }
    const tokOP = tokenMap.optimism
    const tokBA = tokenMap.base

    ;(async () => {
      const { opBal, baBal } = await getDualBalances(
        { optimism: tokOP, base: tokBA },
        user as `0x${string}`
      )
      setOpBal(opBal)
      setBaBal(baBal)
    })()
  }, [open, walletClient, snap.token])

  async function handleConfirm() {
    if (!walletClient) {
      openModal()
      return
    }

    setBusy(true)
    setError(null)

    try {
      const amt = parseUnits(amount, 6)
      const dest = snap.chain as 'optimism' | 'base'
      const destChainId = dest === 'optimism' ? optimism.id : base.id

      // 1️⃣ ensure liquidity (bridging if needed)
      await ensureLiquidity(snap.token, amt, dest, walletClient)

      // 2️⃣ if wallet is on wrong chain, switch it
      if (currentChainId !== destChainId && switchChainAsync) {
        await switchChainAsync({chainId: destChainId})
        setError(
          `Switched your wallet to ${
            dest === 'optimism' ? 'Optimism' : 'Base'
          }. Please click Confirm again to complete the deposit.`
        )
        setBusy(false)
        return
      }

      // 3️⃣ deposit once on correct chain
      await depositToPool(snap, amt, walletClient)

      onClose()
      alert(`✅ Deposited ${amount} ${snap.token}`)
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message)
      else setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg">
            Deposit {snap.token}
          </DialogTitle>
        </DialogHeader>

        {/* Balances */}
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

        {/* Amount input */}
        <Input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {error && <p className="text-xs text-red-500">{error}</p>}
        {switchError && (
          <p className="text-xs text-red-500">
            Switch error: {switchError.message}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={onClose} title="Cancel">
            Cancel
          </Button>
          <Button
            disabled={busy || !amount || isSwitching}
            onClick={handleConfirm}
            title={
              isSwitching
                ? 'Switching network…'
                : busy
                ? 'Processing…'
                : 'Confirm'
            }
          >
            {isSwitching
              ? 'Switching…'
              : busy
              ? 'Processing…'
              : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
