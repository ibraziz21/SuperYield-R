// src/app/dashboard/page.tsx
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
import { FunnelSimple, ArrowRight, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useMerklRewards } from '@/hooks/useMerklRewards'

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
  const { address, isConnected } = useAppKitAccount()
  const { refetch } = useMerklRewards();
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>(['all'])
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>(['all'])
  const [showNetworkFilter, setShowNetworkFilter] = useState(false)
  const [showProtocolFilter, setShowProtocolFilter] = useState(false)

  const handleNetworkToggle = (network: string) => {
    if (network === 'all') {
      setSelectedNetworks(['all'])
    } else {
      setSelectedNetworks(prev => {
        const filtered = prev.filter(n => n !== 'all')
        if (filtered.includes(network)) {
          const newSelection = filtered.filter(n => n !== network)
          return newSelection.length > 0 ? newSelection : ['all']
        } else {
          return [...filtered, network]
        }
      })
    }
  }

  // ✅ Toggle handler for Protocol
  const handleProtocolToggle = (protocol: string) => {
    if (protocol === 'all') {
      setSelectedProtocols(['all'])
    } else {
      setSelectedProtocols(prev => {
        const filtered = prev.filter(p => p !== 'all')
        if (filtered.includes(protocol)) {
          const newSelection = filtered.filter(p => p !== protocol)
          return newSelection.length > 0 ? newSelection : ['all']
        } else {
          return [...filtered, protocol]
        }
      })
    }
  }

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
            <section className="bg-white p-5 rounded-[20px] max-w-6xl mx-auto">
              <div className="mb-3 flex justify-between items-center gap-2 ">
                <div className="flex">
                  <h2 className="text-base md:text-lg font-semibold tracking-tight text-center">Claimable Rewards</h2>
                  <div className="px-2 py-1 bg-[#E5E7EB] text-[#4B5563] text-[12px] rounded-full">
                    $13.46
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={() => refetch()} title="Refresh" className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </div>
              <ClaimRewards />
            </section>

            {/* My Positions */}
            <section className="bg-white my-4 p-5 rounded-[20px] max-w-6xl mx-auto">
              <div className="mb-3 flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-base md:text-lg font-semibold tracking-tight">My Positions</h2>
                <Link href="/vaults">
                  <Button variant="ghost" className="flex items-center gap-2 text-sm font-medium hover:bg-gray-100" title="Explore Vaults">
                    Explore Vaults
                    <svg width="10" height="9" viewBox="0 0 10 9" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5.61111 0.75L9.08333 4.39583M9.08333 4.39583L5.61111 8.04167M9.08333 4.39583L0.75 4.39583" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>

                  </Button>
                </Link>
              </div>

              <MyPositions
                networkFilter={selectedNetworks}
                protocolFilter={selectedProtocols}
                filterUI={
                  <div className="flex items-center gap-3 md:gap-4 px-2 py-3 flex-wrap mx-4">
                    {/* Network Filter with Checkboxes */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Network:</span>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowNetworkFilter(!showNetworkFilter)
                            setShowProtocolFilter(false)
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors ${selectedNetworks.length > 0 && !selectedNetworks.includes('all')
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                            }`}
                          title="Filter by network"
                        >
                          <FunnelSimple size={14} weight="bold" />
                          {selectedNetworks.includes('all') || selectedNetworks.length === 0
                            ? 'All'
                            : selectedNetworks.join(', ')}
                        </button>

                        {showNetworkFilter && (
                          <div className="absolute left-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                            <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                checked={selectedNetworks.includes('all')}
                                onChange={() => handleNetworkToggle('all')}
                              />
                              All Networks
                            </label>
                            <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                checked={selectedNetworks.includes('Lisk')}
                                onChange={() => handleNetworkToggle('Lisk')}
                              />
                              Lisk
                            </label>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Protocol Filter with Checkboxes */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Protocol:</span>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowProtocolFilter(!showProtocolFilter)
                            setShowNetworkFilter(false)
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors ${selectedProtocols.length > 0 && !selectedProtocols.includes('all')
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                            }`}
                          title="Filter by protocol"
                        >
                          <FunnelSimple size={14} weight="bold" />
                          {selectedProtocols.includes('all') || selectedProtocols.length === 0
                            ? 'All'
                            : selectedProtocols.join(', ')}
                        </button>

                        {showProtocolFilter && (
                          <div className="absolute left-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                            <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                checked={selectedProtocols.includes('all')}
                                onChange={() => handleProtocolToggle('all')}
                              />
                              All Protocols
                            </label>
                            <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer rounded">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                checked={selectedProtocols.includes('Morpho Blue')}
                                onChange={() => handleProtocolToggle('Morpho Blue')}
                              />
                              Morpho Blue
                            </label>
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
    </div>
  )
}