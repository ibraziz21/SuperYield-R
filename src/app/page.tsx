'use client'

import Link from 'next/link'
import { useState } from 'react'
import { PortfolioHeader } from '@/components/dashboard/PortfolioHeader'
import { TopYields } from '@/components/TopYields'
import { DepositModal } from '@/components/deposit/DepositModal'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { MORPHO_VAULTS } from '@/lib/tvl'
import ClaimRewards from '@/components/tables/ClaimRewardTable/ClaimReward'
import MyPositions from '@/components/tables/MyPositionsTable/MyPositions'

/** Morpho-only helper: Lisk positions → YieldSnapshot */
function toSnapshotFromPosition(p: {
  protocol: 'Morpho Blue'
  chain: 'lisk'
  token: 'USDCe' | 'USDT0' | 'WETH'
}): YieldSnapshot {
  // normalize for app-wide token label (bridging logic expects base symbols)
  const token: YieldSnapshot['token'] =
    p.token === 'USDCe' ? 'USDC' :
    p.token === 'USDT0' ? 'USDT' : 'WETH'

  const poolAddress: `0x${string}` =
    p.token === 'USDCe' ? MORPHO_VAULTS.USDCe
  : p.token === 'USDT0' ? MORPHO_VAULTS.USDT0
  : MORPHO_VAULTS.WETH

  const underlying: `0x${string}` =
    p.token === 'USDCe' ? TokenAddresses.USDCe.lisk
  : p.token === 'USDT0' ? TokenAddresses.USDT0.lisk
  : TokenAddresses.WETH.lisk

  return {
    id: `lisk-morpho-blue-${token.toLowerCase()}`,
    chain: 'lisk',
    protocol: 'Morpho Blue',
    protocolKey: 'morpho-blue',
    poolAddress,
    token,
    apy: 0,
    tvlUSD: 0,
    updatedAt: new Date().toISOString(),
    underlying,
  }
}

export default function Dashboard() {
  const [depositSnap, setDepositSnap] = useState<YieldSnapshot | null>(null)
  const [withdrawSnap, setWithdrawSnap] = useState<YieldSnapshot | null>(null)

  return (
    <div className="space-y-6">
      <PortfolioHeader />

    

      {/* Action modals */}
      {depositSnap && (
        <DepositModal
          open
          onClose={() => setDepositSnap(null)}
          snap={depositSnap}
        />
      )}

      {/* Claimable Rewards */}
      <section className="bg-[#F9FAFB] m-4 p-4 rounded-xl">
        <div className="mb-3">
          <h2 className="text-base font-semibold tracking-tight">Claimable Rewards</h2>
        </div>
        <ClaimRewards />
      </section>

      {/* My Positions */}
      <section className="bg-[#F9FAFB] m-4 p-4 rounded-xl">
        <div className="mb-3">
          <h2 className="text-base font-semibold tracking-tight">My Positions</h2>
        </div>
        <MyPositions />
      </section>

      {/* Keep withdraw open for Morpho (the modal guards unsupported flows itself)
      {withdrawSnap && (
        <WithdrawModal
          open
          onClose={() => setWithdrawSnap(null)}
          snap={withdrawSnap}
        />
      )} */}
    </div>
  )
}
