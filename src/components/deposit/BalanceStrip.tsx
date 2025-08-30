// src/components/BalanceStrip.tsx
'use client'
import { FC } from 'react'
import { ChainPill } from './ui'
import { formatUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'

const pretty = (bn: bigint | null | undefined, dec = 6) => (bn != null ? formatUnits(bn, dec) : '…')

export const BalanceStrip: FC<{
  tokenDecimals: number
  snap: YieldSnapshot
  isLiskTarget: boolean
  isUsdtFamily: boolean
  symbolForWalletDisplay: (s: YieldSnapshot['token'], c: 'optimism' | 'base' | 'lisk') => YieldSnapshot['token']
  opBal: bigint | null
  baBal: bigint | null
  liBal: bigint | null
  liBalUSDT: bigint | null
  liBalUSDT0: bigint | null
  /** OPTIONAL: extra source-asset balances for nicer UX when Lisk:USDT0 */
  opUsdcBal?: bigint | null
  baUsdcBal?: bigint | null
  opUsdtBal?: bigint | null
  baUsdtBal?: bigint | null
}> = ({
  tokenDecimals, snap, isLiskTarget, isUsdtFamily, symbolForWalletDisplay,
  opBal, baBal, liBal, liBalUSDT, liBalUSDT0,
  opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal,
}) => {
  const showDualForSource = isLiskTarget && isUsdtFamily && (opUsdcBal != null || baUsdcBal != null || opUsdtBal != null || baUsdtBal != null)

  return (
    <div className="border-t bg-gray-50 p-3 sm:p-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* OP */}
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between">
            <ChainPill label="OP" />
            <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'optimism')}</span>
          </div>
          <div className="mt-1 text-base font-semibold">{pretty(opBal, tokenDecimals)}</div>

          {showDualForSource && (
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              <div className="flex items-center justify-between"><span>USDC</span><span className="font-medium">{pretty(opUsdcBal, tokenDecimals)}</span></div>
              <div className="flex items-center justify-between"><span>USDT</span><span className="font-medium">{pretty(opUsdtBal, tokenDecimals)}</span></div>
            </div>
          )}
        </div>

        {/* Base */}
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between">
            <ChainPill label="BASE" />
            <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'base')}</span>
          </div>
          <div className="mt-1 text-base font-semibold">{pretty(baBal, tokenDecimals)}</div>

          {showDualForSource && (
            <div className="mt-2 space-y-1 text-xs text-gray-600">
              <div className="flex items-center justify-between"><span>USDC</span><span className="font-medium">{pretty(baUsdcBal, tokenDecimals)}</span></div>
              <div className="flex items-center justify-between"><span>USDT</span><span className="font-medium">{pretty(baUsdtBal, tokenDecimals)}</span></div>
            </div>
          )}
        </div>

        {/* Lisk */}
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between">
            <ChainPill label="LISK" />
            <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'lisk')}</span>
          </div>
          {isLiskTarget && isUsdtFamily ? (
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between text-sm"><span className="text-gray-500">USDT</span><span className="font-medium">{pretty(liBalUSDT, tokenDecimals)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-gray-500">USDT0</span><span className="font-medium">{pretty(liBalUSDT0, tokenDecimals)}</span></div>
            </div>
          ) : (
            <div className="mt-1 text-base font-semibold">{pretty(liBal, tokenDecimals)}</div>
          )}
        </div>
      </div>
    </div>
  )
}
