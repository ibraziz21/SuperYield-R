'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PortfolioHeader } from '@/components/dashboard/PortfolioHeader'
import { DepositModal } from '@/components/deposit/DepositModal'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { MORPHO_VAULTS } from '@/lib/tvl'
import ClaimRewards from '@/components/tables/ClaimRewardTable/ClaimReward'
import MyPositions from '@/components/tables/MyPositionsTable/MyPositions'
import { useAppKitAccount } from '@reown/appkit/react'
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'
import { FunnelSimple, ArrowRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

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
  const { address, isConnected } = useAppKitAccount()

  const [networkFilter, setNetworkFilter] = useState<string>('all')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [showNetworkFilter, setShowNetworkFilter] = useState(false)
  const [showProtocolFilter, setShowProtocolFilter] = useState(false)

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      {
        isConnected && address ? (
          <div className="w-full px-4">
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
            <section className="bg-white my-4 p-4 md:p-6 rounded-xl max-w-6xl mx-auto">
              <div className="mb-3">
                <h2 className="text-base md:text-lg font-semibold tracking-tight">Claimable Rewards</h2>
              </div>
              <ClaimRewards />
            </section>

            {/* My Positions */}
            <section className="bg-white my-4 p-4 md:p-6 rounded-xl max-w-6xl mx-auto">
              <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-base md:text-lg font-semibold tracking-tight">My Positions</h2>
                <Link href="/vaults">
                  <Button variant="ghost" className="flex items-center gap-2 text-sm font-medium hover:bg-gray-100" title="Explore Vaults">
                    Explore Vaults
                    <ArrowRight size={18} weight="bold" />
                  </Button>
                </Link>
              </div>

              <MyPositions
                networkFilter={networkFilter}
                protocolFilter={protocolFilter}
                filterUI={
                  <div className="flex items-center gap-3 md:gap-4 px-2 py-3 flex-wrap">
                    {/* Network Filter */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Network:</span>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowNetworkFilter(!showNetworkFilter)
                            setShowProtocolFilter(false)
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${
                            networkFilter !== 'all'
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                          title="Filter by network"
                        >
                          <FunnelSimple size={14} weight="bold" />
                          {networkFilter === 'all' ? 'All' : networkFilter}
                        </button>
                        {showNetworkFilter && (
                          <div className="absolute left-0 top-full mt-1 z-10 w-36 rounded-lg border border-gray-200 bg-white shadow-lg">
                            <button
                              onClick={() => {
                                setNetworkFilter('all')
                                setShowNetworkFilter(false)
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 first:rounded-t-lg"
                            >
                              All
                            </button>
                            <button
                              onClick={() => {
                                setNetworkFilter('Lisk')
                                setShowNetworkFilter(false)
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 last:rounded-b-lg"
                            >
                              Lisk
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Protocol Filter */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Protocol:</span>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowProtocolFilter(!showProtocolFilter)
                            setShowNetworkFilter(false)
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${
                            protocolFilter !== 'all'
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                          title="Filter by protocol"
                        >
                          <FunnelSimple size={14} weight="bold" />
                          {protocolFilter === 'all' ? 'All' : protocolFilter}
                        </button>
                        {showProtocolFilter && (
                          <div className="absolute left-0 top-full mt-1 z-10 w-36 rounded-lg border border-gray-200 bg-white shadow-lg">
                            <button
                              onClick={() => {
                                setProtocolFilter('all')
                                setShowProtocolFilter(false)
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 first:rounded-t-lg"
                            >
                              All
                            </button>
                            <button
                              onClick={() => {
                                setProtocolFilter('Morpho Blue')
                                setShowProtocolFilter(false)
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 last:rounded-b-lg"
                            >
                              Morpho Blue
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                }
              />
            </section>
          </div>
        ) : (
          <ConnectWalletPrompt />
        )
      }

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
