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
}> = ({ tokenDecimals, snap, isLiskTarget, isUsdtFamily, symbolForWalletDisplay, opBal, baBal, liBal, liBalUSDT, liBalUSDT0 }) => {
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
        </div>
        {/* Base */}
        <div className="rounded-lg border bg-white p-3">
          <div className="flex items-center justify-between">
            <ChainPill label="BASE" />
            <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'base')}</span>
          </div>
          <div className="mt-1 text-base font-semibold">{pretty(baBal, tokenDecimals)}</div>
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