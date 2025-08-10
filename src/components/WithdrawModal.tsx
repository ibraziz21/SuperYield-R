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
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { optimism } from 'viem/chains'

import type { YieldSnapshot } from '@/hooks/useYields'
import { withdrawFromPool } from '@/lib/withdraw'
import { TokenAddresses, AAVE_POOL, COMET_POOLS } from '@/lib/constants'
import { publicOptimism } from '@/lib/clients'
import aaveAbi from '@/lib/abi/aavePool.json'
import { erc20Abi } from 'viem'
import { Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'

/* ──────────────────────────────────────────────────────────────── */

const EXPLORER_TX_BASE = 'https://optimistic.etherscan.io/tx/'
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)

async function getAaveSuppliedBalance(params: {
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { token, user } = params

  const pool  = AAVE_POOL.optimism
  const asset = (TokenAddresses[token] as { optimism: `0x${string}` }).optimism

  // getReserveData(asset) -> contains aTokenAddress (slot index differs by ABI variants)
  const reserve = await publicOptimism.readContract({
    address: pool,
    abi: aaveAbi,
    functionName: 'getReserveData',
    args: [asset],
  }) as unknown

  const aToken =
    (Array.isArray(reserve) ? reserve[7] :
      (reserve as { aTokenAddress?: `0x${string}` }).aTokenAddress) as
    | `0x${string}`
    | undefined

  if (!aToken) return BigInt(0)

  const bal = await publicOptimism.readContract({
    address: aToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  // aToken balance is in token units (USDC/USDT -> 6)
  return bal
}

async function getCometSuppliedBalance(params: {
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { token, user } = params
  const comet = COMET_POOLS.optimism[token]


  const bal = await publicOptimism.readContract({
    address: comet,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal
}

/* ──────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

/**
 * OP-only withdraw modal for Aave v3 / Compound v3.
 */
export const WithdrawModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, isPending: switching, error: switchErr } = useSwitchChain()

  type Status = 'idle' | 'switching' | 'withdrawing' | 'success' | 'error'
  const [status, setStatus] = useState<Status>('idle')

  const [error, setError] = useState<string | null>(null)
  const [supplied, setSupplied] = useState<bigint | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)

  // USDC/USDT on OP
  const decimals = 6
  const needChainId = optimism.id

  const title = useMemo(() => {
    return snap.protocolKey === 'aave-v3' ? 'Withdraw (Aave v3)'
      : snap.protocolKey === 'compound-v3' ? 'Withdraw (Compound v3)'
      : 'Withdraw'
  }, [snap.protocolKey])

  // Reset transient UI when modal opens/changes
  useEffect(() => {
    if (!open) return
    setStatus('idle')
    setError(null)
    setTxHash(null)
  }, [open, snap.id])

  // Load user's supplied amount for the specific protocol/token on OP
  useEffect(() => {
    if (!open || !walletClient) return

    // Only support Optimism here; return 0 for anything else
    if (snap.chain !== 'optimism') {
      setSupplied(BigInt(0))
      return
    }

    const user = walletClient.account?.address as `0x${string}` | undefined
    if (!user) return

    ;(async () => {
      try {
        if (snap.token !== 'USDC' && snap.token !== 'USDT') {
          setSupplied(BigInt(0))
          return
        }

        if (snap.protocolKey === 'aave-v3') {
          const bal = await getAaveSuppliedBalance({ token: snap.token, user })
          setSupplied(bal)
        } else if (snap.protocolKey === 'compound-v3') {
          const bal = await getCometSuppliedBalance({ token: snap.token, user })
          setSupplied(bal)
        } else {
          setSupplied(BigInt(0))
        }
      } catch (e) {
        console.error('[WithdrawModal] fetch supplied error', e)
        setError('Failed to load balance')
        setSupplied(BigInt(0))
      }
    })()
  }, [open, walletClient, snap.protocolKey, snap.chain, snap.token])

  async function handleWithdrawAll() {
    if (!walletClient) {
      openConnect()
      return
    }

    try {
      setError(null)
      setTxHash(null)

      // Step 1: switch if needed
      if (chainId !== needChainId && switchChainAsync) {
        setStatus('switching')
        await switchChainAsync({ chainId: needChainId })
      }

      // Step 2: withdraw
      setStatus('withdrawing')

      let amount: bigint
      if (snap.protocolKey === 'aave-v3') {
        amount = MAX_UINT256 // withdraw all for that asset on Aave
      } else if (snap.protocolKey === 'compound-v3') {
        if (supplied == null) throw new Error('Balance not loaded')
        amount = supplied // exact asset balance for Comet
      } else {
        throw new Error(`Unsupported protocol: ${snap.protocol}`)
      }

      const maybeHash = await withdrawFromPool(snap, amount, walletClient)
      if (typeof maybeHash === 'string' && maybeHash.startsWith('0x')) {
        setTxHash(maybeHash as `0x${string}`)
      }

      setStatus('success')
    } catch (e) {
      console.error('[WithdrawModal] withdraw error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const suppliedPretty =
    typeof supplied === 'bigint' ? formatUnits(supplied, decimals) : '0'

  const isActionDisabled =
    status === 'switching' ||
    status === 'withdrawing' ||
    (typeof supplied === 'bigint' && supplied === BigInt(0))

  /* ─────────── UI bits ─────────── */

  function HeaderBar() {
    return (
      <div className="flex items-center justify-between bg-gradient-to-r from-teal-600 to-emerald-500 px-5 py-4 text-white">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium">
          OPTIMISM
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
          <div className="text-xs text-gray-500">Supplied</div>
          <div className="text-lg font-semibold">
            {status === 'switching' || status === 'withdrawing' ? '…' : suppliedPretty}
          </div>
        </div>
      </div>
    )
  }

  function SummaryCard() {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Action</span>
          <span className="font-medium">Withdraw full balance</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-gray-600">Network</span>
          <span className="font-medium">
            Optimism
            {switching && ' (switching…)'}
          </span>
        </div>
      </div>
    )
  }

  function ProgressCard() {
    const isSwitch = status === 'switching'
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
          <div className="text-sm font-medium">
            {isSwitch ? 'Switching network…' : 'Withdrawing…'}
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {isSwitch
            ? 'Confirm the network switch in your wallet.'
            : 'Confirm the withdrawal transaction in your wallet.'}
        </p>
      </div>
    )
  }

  function SuccessCard() {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-semibold">Withdrawal complete</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Token</span>
            <span className="font-medium">{snap.token}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Network</span>
            <span className="font-medium">Optimism</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Amount</span>
            <span className="font-medium">{suppliedPretty} {snap.token}</span>
          </div>
        </div>

        {txHash && (
          <a
            href={`${EXPLORER_TX_BASE}${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
          >
            View on explorer
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    )
  }

  function ErrorCard() {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">Withdrawal failed</span>
        </div>
        <p className="mt-2 text-xs text-red-700 break-words">{error ?? 'Unknown error'}</p>
      </div>
    )
  }

  /* ─────────── Render ─────────── */

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-md overflow-hidden rounded-2xl p-0">
        <HeaderBar />

        <div className="space-y-4 p-5">
          <TokenCard />

          {(status === 'idle' || status === 'switching' || status === 'withdrawing') && (
            <>
              <SummaryCard />
              {(status === 'switching' || status === 'withdrawing') && <ProgressCard />}
              {switchErr && (
                <p className="rounded-md bg-red-50 p-2 text-xs text-red-600">{switchErr.message}</p>
              )}
              {error && (
                <p className="rounded-md bg-red-50 p-2 text-xs text-red-600">{error}</p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="rounded-full"
                  title="Cancel"
                  disabled={status === 'switching' || status === 'withdrawing'}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleWithdrawAll}
                  disabled={isActionDisabled}
                  title={
                    status === 'switching'
                      ? 'Switching…'
                      : status === 'withdrawing'
                      ? 'Withdrawing…'
                      : 'Withdraw All'
                  }
                  className="rounded-full bg-teal-600 hover:bg-teal-500"
                >
                  {status === 'switching' ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Switching…
                    </span>
                  ) : status === 'withdrawing' ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Withdrawing…
                    </span>
                  ) : (
                    'Withdraw All'
                  )}
                </Button>
              </div>
            </>
          )}

          {status === 'success' && (
            <>
              <SuccessCard />
              <div className="flex items-center justify-end pt-2">
                <Button onClick={onClose} className="rounded-full bg-teal-600 hover:bg-teal-500" title="Done">
                  Done
                </Button>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <ErrorCard />
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={onClose} className="rounded-full" title="Close">
                  Close
                </Button>
                <Button onClick={handleWithdrawAll} className="rounded-full bg-teal-600 hover:bg-teal-500" title="Try Again">
                  Try again
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
