"use client"

import { useState, useEffect } from "react"
import { Check, AlertCircle, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import Image from "next/image"

interface Reward {
  token: string
  symbol: string
  amount: number
  usdValue: number
  icon: string
  color: string
  checked: boolean
}

interface ClaimRewardsModalProps {
  isOpen: boolean
  onClose: () => void
  onClaim?: (selectedRewards: Reward[]) => Promise<void>
  rewards?: Reward[]
}

type ModalState = "initial" | "signing" | "claiming" | "error" | "success"

const DEFAULT_REWARDS: Reward[] = [
  {
    token: "OP",
    symbol: "14.27 OP",
    amount: 14.27,
    usdValue: 5.16,
    icon: "/tokens/op-icon.png",
    color: "bg-red-100 dark:bg-red-900/30",
    checked: true,
  },
  {
    token: "USDT",
    symbol: "4.20 USDT",
    amount: 4.2,
    usdValue: 4.2,
    icon: "/tokens/usdt-icon.png",
    color: "bg-cyan-100 dark:bg-cyan-900/30",
    checked: true,
  },
  {
    token: "USDC",
    symbol: "1.87 USDC",
    amount: 1.87,
    usdValue: 1.87,
    icon: "/tokens/usdc-icon.png",
    color: "bg-blue-100 dark:bg-blue-900/30",
    checked: false,
  },
]

export function ClaimRewardsModal({ isOpen, onClose, onClaim, rewards: initialRewards }: ClaimRewardsModalProps) {
  const [state, setState] = useState<ModalState>("initial")
  const [rewards, setRewards] = useState<Reward[]>(initialRewards || DEFAULT_REWARDS)

  useEffect(() => {
    if (initialRewards) {
      setRewards(initialRewards)
    }
  }, [initialRewards])

  if (!isOpen) return null

  const selectedRewards = rewards.filter((r) => r.checked)
  const totalUsd = selectedRewards.reduce((sum, r) => sum + r.usdValue, 0)
  const allSelected = rewards.every((r) => r.checked)

  const handleToggleReward = (token: string) => {
    setRewards((prev) => prev.map((r) => (r.token === token ? { ...r, checked: !r.checked } : r)))
  }

  const handleSelectAll = () => {
    setRewards((prev) => prev.map((r) => ({ ...r, checked: !allSelected })))
  }

  const handleClaim = async () => {
    try {
      setState("signing")
      // Simulate wallet signing
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setState("claiming")
      // Call the onClaim callback if provided
      if (onClaim) {
        await onClaim(selectedRewards)
      } else {
        // Simulate claim process
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }

      setState("success")
    } catch (error) {
      setState("error")
    }
  }

  const handleTryAgain = () => {
    setState("initial")
  }

  const handleExploreVaults = () => {
    onClose()
    // Navigate to vaults page
  }

  const handleBackToDashboard = () => {
    setState("initial")
    onClose()
  }

  // SUCCESS STATE
  if (state === "success") {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-2xl w-full max-w-sm mx-4 shadow-lg border border-border overflow-hidden">
          {/* Header with Success Icon */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-2xl font-bold">Rewards claimed</h2>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <Check size={24} className="text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            <p className="text-muted-foreground">You can view your claimed tokens in your wallet.</p>

            {/* Summary Box */}
            <div className="bg-muted rounded-xl p-4 space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-foreground font-semibold">Total value claimed</span>
                <span className="text-lg font-bold text-foreground">${totalUsd.toFixed(2)}</span>
              </div>

              {/* Claimed Tokens */}
              {selectedRewards.map((reward) => (
                <div key={reward.token} className="flex justify-between items-center py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 relative">
                      <Image
                        src={reward.icon}
                        alt={reward.token}
                        width={24}
                        height={24}
                        className="rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/tokens/default.svg"
                        }}
                      />
                    </div>
                    <span className="text-foreground font-medium">{reward.token}</span>
                    <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded">
                      {reward.symbol}
                    </span>
                  </div>
                  <span className="text-foreground font-semibold">${reward.usdValue.toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl p-4">
              <div className="flex gap-3">
                <Sparkles size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <p className="font-semibold text-blue-600 dark:text-blue-400">Earn more with your rewards</p>
                  <p className="text-sm text-foreground mt-1">
                    Put your rewards to work in active vaults and keep growing your earnings.
                  </p>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="space-y-3">
              <Button
                onClick={handleExploreVaults}
                size="lg"
                className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6"
              >
                Explore vaults
              </Button>
              <Button
                onClick={handleBackToDashboard}
                variant="outline"
                size="lg"
                className="w-full text-lg font-semibold py-6 bg-transparent"
              >
                Back to dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // INITIAL, SIGNING, CLAIMING, OR ERROR STATE
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-2xl w-full max-w-sm mx-4 shadow-lg border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-2xl font-bold">Claim rewards</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <p className="text-muted-foreground">Claim your Merkl rewards on OP Mainnet</p>

          {/* Rewards List */}
          <div className="bg-muted rounded-xl overflow-hidden divide-y divide-border">
            {/* Select All */}
            <div className="flex items-center justify-between p-4 hover:bg-background/50 transition-colors cursor-pointer">
              <label className="flex items-center gap-3 cursor-pointer flex-1">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  className="w-5 h-5 rounded accent-blue-600"
                />
                <span className="font-semibold text-foreground">Select all</span>
              </label>
              <span className="text-foreground font-semibold">
                ${rewards.reduce((sum, r) => sum + r.usdValue, 0).toFixed(2)}
              </span>
            </div>

            {/* Individual Rewards */}
            {rewards.map((reward) => (
              <div
                key={reward.token}
                className="flex items-center justify-between p-4 hover:bg-background/50 transition-colors cursor-pointer"
                onClick={() => handleToggleReward(reward.token)}
              >
                <label className="flex items-center gap-3 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={reward.checked}
                    onChange={() => handleToggleReward(reward.token)}
                    className="w-5 h-5 rounded accent-blue-600"
                  />
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 relative">
                      <Image
                        src={reward.icon}
                        alt={reward.token}
                        width={24}
                        height={24}
                        className="rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/tokens/default.svg"
                        }}
                      />
                    </div>
                    <span className="font-semibold text-foreground">{reward.token}</span>
                    <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded">
                      {reward.symbol}
                    </span>
                  </div>
                </label>
                <span className="text-foreground font-semibold">${reward.usdValue.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Error Message */}
          {state === "error" && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg">
              <AlertCircle size={18} className="text-red-600 dark:text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-600 dark:text-red-400">Claim failed. Please try again.</span>
            </div>
          )}

          {/* Action Button */}
          <Button
            onClick={state === "error" ? handleTryAgain : handleClaim}
            disabled={selectedRewards.length === 0 || state === "claiming" || state === "signing"}
            size="lg"
            className="w-full text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-lg font-semibold py-6 flex items-center justify-center gap-2"
          >
            {state === "signing" && (
              <>
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                Sign wallet transaction...
              </>
            )}
            {state === "claiming" && (
              <>
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                Claiming rewards...
              </>
            )}
            {state === "initial" && "Claim rewards"}
            {state === "error" && "Try again"}
          </Button>
        </div>
      </div>
    </div>
  )
}
