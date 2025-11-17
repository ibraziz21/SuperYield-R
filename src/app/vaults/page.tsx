// src/app/positions/page.tsx
'use client'

import { useAppKitAccount } from '@reown/appkit/react'
import Vaults from '@/components/tables/VaultsTable/Vaults'
import MyPositions from '@/components/tables/MyPositionsTable/MyPositions'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'

export default function PositionsPage() {
  const { address, isConnected } = useAppKitAccount()

  if (!isConnected || !address) {
    return <ConnectWalletPrompt />
  }

  return (
    <div>
      {/* Vaults */}
      <section className="bg-[#F9FAFB] m-4 p-4 rounded-xl">
        <Tabs defaultValue="vaults" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="positions">Your Positions</TabsTrigger>
            <TabsTrigger value="vaults">All Vaults</TabsTrigger>
          </TabsList>

          <TabsContent value="vaults">
            <Vaults />
          </TabsContent>

          <TabsContent value="positions">
            <MyPositions />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}