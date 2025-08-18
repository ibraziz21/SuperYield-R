'use client'

import Link from 'next/link'
import { useState } from 'react'
import { PortfolioHeader } from '@/components/dashboard/PortfolioHeader'
import { RewardsStrip } from '@/components/dashboard/RewardStrip'
import { PositionsBoard } from '@/components/dashboard/PositionsBoard'
import { TopYields } from '@/components/TopYields'
import { DepositModal } from '@/components/DepositModal'
import { WithdrawModal } from '@/components/WithdrawModal'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses, AAVE_POOL, COMET_POOLS } from '@/lib/constants'
import { MORPHO_VAULTS } from '@/lib/tvl'


function toSnapshotFromPosition(p: {
  protocol: 'Aave v3' | 'Compound v3' | 'Morpho Blue'
  chain: 'optimism' | 'base' | 'lisk'
  token: 'USDC' | 'USDT' | 'USDCe' | 'USDT0' | 'WETH'
}): YieldSnapshot {
  const chain = p.chain
  const protocolKey =
    p.protocol === 'Aave v3'
      ? 'aave-v3'
      : p.protocol === 'Compound v3'
      ? 'compound-v3'
      : 'morpho-blue'

  let token: YieldSnapshot['token']
  let poolAddress: `0x${string}`
  let underlying: `0x${string}`

  if (protocolKey === 'aave-v3') {
    // OP/Base only — token is USDC | USDT
    token = p.token as 'USDC' | 'USDT'
    poolAddress = AAVE_POOL[chain as 'optimism' | 'base']
    underlying = (TokenAddresses[token] as Record<'optimism' | 'base', `0x${string}`>)[
      chain as 'optimism' | 'base'
    ]
  } else if (protocolKey === 'compound-v3') {
    // OP/Base only — token is USDC | USDT (USDT may be 0x0 on Base if unsupported)
    token = p.token as 'USDC' | 'USDT'
    poolAddress = COMET_POOLS[chain as 'optimism' | 'base'][token]
    underlying = (TokenAddresses[token] as Record<'optimism' | 'base', `0x${string}`>)[
      chain as 'optimism' | 'base'
    ]
  } else {
    // Morpho Blue on Lisk — incoming tokens are USDCe | USDT0 | WETH
    if (p.token === 'WETH') {
      token = 'WETH'
      poolAddress = MORPHO_VAULTS.WETH
      underlying = TokenAddresses.WETH.lisk
    } else if (p.token === 'USDCe') {
      token = 'USDC'
      poolAddress = MORPHO_VAULTS.USDCe
      underlying = TokenAddresses.USDCe.lisk
    } else {
      token = 'USDT'
      poolAddress = MORPHO_VAULTS.USDT0
      underlying = TokenAddresses.USDT0.lisk
    }
  }

  return {
    id: `${chain}-${protocolKey}-${token.toLowerCase()}`,
    chain,
    protocol: p.protocol,
    protocolKey,
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

  
      {/* Markets preview */}
      <section className="mx-auto w-full max-w-6xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Top yields</h2>
          <Link href="/markets" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            See all markets →
          </Link>
        </div>
        <TopYields limit={5} />
      </section>

      {/* Action modals (your existing, mobile-friendly flows) */}
      {depositSnap && (
        <DepositModal
          open
          onClose={()=>setDepositSnap(null)}
          snap={depositSnap}
        />
      )}
      {withdrawSnap && (withdrawSnap.chain === 'optimism' || withdrawSnap.chain === 'base') && (
        <WithdrawModal
          open
          onClose={()=>setWithdrawSnap(null)}
          snap={withdrawSnap}
        />
      )}
    </div>
  )
}
