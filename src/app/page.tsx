'use client'
import { YieldTable } from '@/components/YieldTable'
import { PositionsGrid } from '@/components/PositionsGrid'
import { AaveOverview }  from '@/components/AaveOverview'

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-extrabold mb-6">SuperYield-R Live Yields</h1>

      <section>
        <h2 className="mb-4 text-2xl font-extrabold">Aave Overview</h2>
        <AaveOverview />
      </section>
      <PositionsGrid />
      <YieldTable />
    </main>
  )
}
