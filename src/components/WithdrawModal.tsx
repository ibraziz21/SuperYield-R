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
import { optimism, base } from 'viem/chains'

import type { YieldSnapshot } from '@/hooks/useYields'
import { withdrawFromPool } from '@/lib/withdraw'
import { TokenAddresses, AAVE_POOL, COMET_POOLS } from '@/lib/constants'
import { publicOptimism, publicBase } from '@/lib/clients'
import aaveAbi from '@/lib/abi/aavePool.json'
import { erc20Abi } from 'viem'

// ──────────────────────────────────────────────────────────────────────────────

type EvmChain = 'optimism' | 'base'
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)

function clientFor(chain: EvmChain) {
  return chain === 'base' ? publicBase : publicOptimism
}

async function getAaveSuppliedBalance(params: {
  chain: EvmChain
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, token, user } = params
  const client = clientFor(chain)
  const pool   = AAVE_POOL[chain]
  const asset  = (TokenAddresses[token] as Record<EvmChain, `0x${string}`>)[chain]

  // getReserveData(asset) -> contains aTokenAddress
  const reserve = await client.readContract({
    address: pool,
    abi: aaveAbi,
    functionName: 'getReserveData',
    args: [asset],
  }) as unknown

  const aToken =
    (Array.isArray(reserve) ? reserve[7] : (reserve as { aTokenAddress?: `0x${string}` }).aTokenAddress) as
    | `0x${string}`
    | undefined

  if (!aToken) return BigInt(0)

  const bal = await client.readContract({
    address: aToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal
}

async function getCometSuppliedBalance(params: {
  chain: EvmChain
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, token, user } = params
  const comet = COMET_POOLS[chain][token]
  if (comet === '0x0000000000000000000000000000000000000000') return BigInt(0)

  const client = clientFor(chain)
  // Comet.balanceOf(user) returns base-asset balance (e.g., 6 decimals for USDC)
  const bal = await client.readContract({
    address: comet,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal
}

// ──────────────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

/**
 * Withdraws FULL balance for this position.
 * - Aave v3: uses MAX_UINT256 to withdrawAll()
 * - Compound v3: reads balance and withdraws exact amount
 */
export const WithdrawModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, isPending: switching, error: switchErr } = useSwitchChain()

  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [supplied, setSupplied] = useState<bigint | null>(null)

  const decimals = 6 // USDC/USDT on OP/Base
  const evmChain = snap.chain as EvmChain
  const needChainId = evmChain === 'base' ? base.id : optimism.id

  const title = useMemo(() => {
    return snap.protocolKey === 'aave-v3' ? 'Withdraw (Aave v3)' :
           snap.protocolKey === 'compound-v3' ? 'Withdraw (Compound v3)' :
           'Withdraw'
  }, [snap.protocolKey])

  // Load user's supplied amount for the specific protocol/chain/token
  useEffect(() => {
    if (!open || !walletClient) return
    if (snap.chain !== 'optimism' && snap.chain !== 'base') {
      setSupplied(BigInt(0))
      return
    }

    const user = walletClient.account?.address as `0x${string}` | undefined
    if (!user) return

    async function run() {
      setFetching(true)
      setError(null)
      try {
        if (snap.token !== 'USDC' && snap.token !== 'USDT') {
          setSupplied(BigInt(0))
          return
        }

        if (snap.protocolKey === 'aave-v3') {
          const bal = await getAaveSuppliedBalance({
            chain: evmChain,
            token: snap.token,
            user: user as `0x${string}`,
          })
          setSupplied(bal)
        } else if (snap.protocolKey === 'compound-v3') {
          const bal = await getCometSuppliedBalance({
            chain: evmChain,
            token: snap.token,
            user: user as `0x${string}`,
          })
          setSupplied(bal)
        } else {
          setSupplied(BigInt(0))
        }
      } catch (e) {
        console.error('[WithdrawModal] fetch supplied error', e)
        setError('Failed to load balance')
        setSupplied(BigInt(0))
      } finally {
        setFetching(false)
      }
    }

    void run()
  }, [open, walletClient, snap.protocolKey, snap.chain, snap.token, evmChain])

  async function handleWithdrawAll() {
    if (!walletClient) {
      openConnect()
      return
    }
    setError(null)
    setLoading(true)

    try {
      // switch network if needed
      if (chainId !== needChainId && switchChainAsync) {
        await switchChainAsync({ chainId: needChainId })
      }

      let amount: bigint
      if (snap.protocolKey === 'aave-v3') {
        // Aave accepts MAX_UINT256 to withdraw entire balance for the asset
        amount = MAX_UINT256
      } else if (snap.protocolKey === 'compound-v3') {
        // Withdraw exact supplied amount
        if (supplied == null) throw new Error('Balance not loaded')
        amount = supplied
      } else {
        throw new Error(`Unsupported protocol: ${snap.protocol}`)
      }

      await withdrawFromPool(snap, amount, walletClient)
      onClose()
      alert('✅ Withdrawal complete')
    } catch (e) {
      console.error('[WithdrawModal] withdraw error', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // ─────────── UI (Uniswap-style, clean & compact) ───────────
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-md overflow-hidden rounded-2xl p-0">
        {/* Header Bar */}
        <div className="flex items-center justify-between bg-gradient-to-r from-teal-600 to-emerald-500 px-5 py-4 text-white">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          </DialogHeader>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium">
            {snap.chain.toUpperCase()}
          </span>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">
          {/* Token pill */}
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
                {fetching
                  ? '…'
                  : typeof supplied === 'bigint'
                  ? formatUnits(supplied, decimals)
                  : '0'}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Action</span>
              <span className="font-medium">Withdraw full balance</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-gray-600">Network</span>
              <span className="font-medium">
                {snap.chain === 'base' ? 'Base' : 'Optimism'}
                {switching && ' (switching…)'}
              </span>
            </div>
          </div>

          {/* Errors */}
          {error && (
            <p className="rounded-md bg-red-50 p-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {switchErr && (
            <p className="rounded-md bg-red-50 p-2 text-xs text-red-600">
              {switchErr.message}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={onClose}
              title="Cancel"
              className="rounded-full"
            >
              Cancel
            </Button>
            <Button
              onClick={handleWithdrawAll}
              disabled={loading || fetching || (supplied !== null && supplied === BigInt(0))}
              title={
                loading
                  ? 'Processing…'
                  : fetching
                  ? 'Loading…'
                  : 'Withdraw All'
              }
              className="rounded-full bg-teal-600 hover:bg-teal-500"
            >
              {loading ? 'Processing…' : 'Withdraw All'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
