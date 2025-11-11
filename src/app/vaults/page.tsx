// src/app/positions/page.tsx
'use client'

import { ProtocolTabs } from '@/components/ProtocolTabs'
import { YieldTable } from '@/components/YieldTable'
import { ResumeDepositsBanner } from '@/components/ResumeDepositsBanner'
import { useAccount } from 'wagmi'
import Vaults from '@/components/tables/VaultsTable/Vaults'

export default function PositionsPage() {
  const { address } = useAccount() // wallet address (undefined if not connected)

  return (
    // <div className="space-y-12">
    //   <ProtocolTabs />

    //   {/* Recovery banner nudges unfinished deposits */}
    //   <ResumeDepositsBanner user={address as `0x${string}` | undefined} />

    //   {/* 3 ▸ full markets table (filters, sorting, etc.) */}
    //   <section className="mx-auto w-full max-w-6xl">
    //     <h2 className="mb-3 text-base font-semibold tracking-tight">All markets</h2>
    //     <YieldTable />
    //   </section>
    // </div>

    <div>

      {/* Vaults */}
      <section className="bg-[#F9FAFB] m-4 p-4 rounded-xl">
        <div className="mb-3">
          <h2 className="text-base font-semibold tracking-tight">Vaults</h2>
        </div>
        <Vaults />

      </section>
    </div>
  )
}
