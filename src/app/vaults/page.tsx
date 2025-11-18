// src/app/positions/page.tsx
'use client'

import { useState } from 'react'
import { useAppKitAccount } from '@reown/appkit/react'
import Vaults from '@/components/tables/VaultsTable/Vaults'
import MyPositions from '@/components/tables/MyPositionsTable/MyPositions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'
import { FunnelSimpleIcon } from '@phosphor-icons/react'

export default function PositionsPage() {
  const { address, isConnected } = useAppKitAccount()
  const [networkFilter, setNetworkFilter] = useState<string>('all')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [showNetworkFilter, setShowNetworkFilter] = useState(false)
  const [showProtocolFilter, setShowProtocolFilter] = useState(false)

  if (!isConnected || !address) {
    return <ConnectWalletPrompt />
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] w-full px-4">
      {/* Vaults */}
      <section className="bg-[#F9FAFB] my-4 p-4 md:p-6 rounded-xl max-w-6xl mx-auto">
        <Tabs defaultValue="vaults" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="positions">Your Positions</TabsTrigger>
            <TabsTrigger value="vaults">All Vaults</TabsTrigger>
          </TabsList>

          <TabsContent value="vaults">
            <Vaults networkFilter={networkFilter}
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
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${networkFilter !== 'all'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                        title="Filter by network"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
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
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${protocolFilter !== 'all'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                        title="Filter by protocol"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
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
              } />
          </TabsContent>

          <TabsContent value="positions">
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
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${networkFilter !== 'all'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                        title="Filter by network"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
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
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${protocolFilter !== 'all'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white hover:bg-gray-50'
                          }`}
                        title="Filter by protocol"
                      >
                        <FunnelSimpleIcon size={14} weight="bold" />
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
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
