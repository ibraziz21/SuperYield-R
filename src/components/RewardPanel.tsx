// src/components/RewardsPanel.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import { useVaultRewards } from '@/hooks/useVaultRewards'
import { formatUnits } from 'viem'
import { createPublicClient, http } from 'viem'
import { optimism } from 'viem/chains'
import { useWalletClient } from 'wagmi'
import { REWARDS_VAULT } from '@/lib/constants'
import  vaultRewardsAbi  from '@/lib/abi/rewardsAbi.json'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

const publicClient = createPublicClient({ chain: optimism, transport: http() })
const DECIMALS = 6 // rewards are in USDC-like units

export const RewardsPanel: FC = () => {
  const { data, isLoading, refetch, user } = useVaultRewards()
  const { data: walletClient } = useWalletClient()
  const [status, setStatus] = useState<'idle' | 'claiming' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const earned = data?.earned ?? 0n
  const available = data?.availableRewards ?? 0n

  const earnedPretty = useMemo(() => formatUnits(earned, DECIMALS), [earned])
  const availablePretty = useMemo(() => formatUnits(available, DECIMALS), [available])

  const canClaim = !!user && earned > 0n && status !== 'claiming'

  async function claimFlow() {
    if (!walletClient || !user) return
    setStatus('claiming')
    setError(null)

    try {
      // First try: full claimRewards (reverts if pool underfunded)
      try {
        const { request } = await publicClient.simulateContract({
          address: REWARDS_VAULT.optimism,
          abi: vaultRewardsAbi,
          functionName: 'claimRewards',
          account: walletClient.account!,
        })
        const tx = await walletClient.writeContract(request)
        await publicClient.waitForTransactionReceipt({ hash: tx })
        setStatus('success')
        await refetch()
        return
      } catch (e: any) {
        // Fallback: partial claim up to available, if any
        if (available > 0n) {
          const { request } = await publicClient.simulateContract({
            address: REWARDS_VAULT.optimism,
            abi: vaultRewardsAbi,
            functionName: 'claimRewardsUpToAvailable',
            account: walletClient.account!,
          })
          const tx = await walletClient.writeContract(request)
          await publicClient.waitForTransactionReceipt({ hash: tx })
          setStatus('success')
          await refetch()
          return
        }
        throw e
      }
    } catch (e: any) {
      setError(e?.message ?? 'Claim failed')
      setStatus('error')
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4 rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur dark:from-white/5 dark:to-white/10">
        <h3 className="text-lg font-semibold">Vault Rewards</h3>
        <p className="text-xs text-muted-foreground">
          Rewards accrue linearly based on your mirrored USDC.e balance (receipt token) on Optimism.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-4 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Accrued (claimable)</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {isLoading ? '…' : `${earnedPretty} USDC`}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Vault liquidity</div>
            <div className="mt-1 text-sm font-medium tabular-nums">
              {isLoading ? '…' : `${availablePretty} USDC`}
            </div>
          </div>
        </div>

        {/* Hints */}
        {earned === 0n && (
          <p className="mt-3 text-xs text-muted-foreground">
            Nothing to claim yet. Rewards accrue continuously—check back soon.
          </p>
        )}
        {earned > 0n && available < earned && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 text-xs">
            The vault doesn’t have enough USDC to pay the full amount now. We’ll try a partial claim up to what’s available.
          </p>
        )}

        {/* Actions / status */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={claimFlow}
            disabled={!canClaim}
            className="rounded-full bg-teal-600 hover:bg-teal-500"
            title={earned > 0n ? 'Claim rewards' : 'Nothing to claim'}
          >
            {status === 'claiming' ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Claiming…
              </span>
            ) : (
              'Claim'
            )}
          </Button>

          <Button
            variant="secondary"
            disabled={status === 'claiming'}
            onClick={() => refetch()}
            title="Refresh"
            className="rounded-full"
          >
            Refresh
          </Button>
        </div>

        {status === 'success' && (
          <div className="mt-4 flex items-center gap-2 text-emerald-700 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            Rewards claimed to your wallet.
          </div>
        )}
        {status === 'error' && (
          <div className="mt-4 flex items-start gap-2 text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
