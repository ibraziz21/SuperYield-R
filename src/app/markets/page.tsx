// src/app/positions/page.tsx
'use client'

import { MetricBar } from '@/components/MetricBar'
import { ProtocolTabs } from '@/components/ProtocolTabs'
import { YieldTable } from '@/components/YieldTable'

export default function PositionsPage() {
  return (
    <div className="space-y-12">
      {/* 1 ▸ high-level metrics */}
      <MetricBar />

      {/* 2 ▸ per-protocol positions */}
      <ProtocolTabs />

      {/* 3 ▸ full markets table (filters, sorting, etc.) */}
      <section className="mx-auto w-full max-w-6xl">
        <h2 className="mb-3 text-base font-semibold tracking-tight">All markets</h2>
        <YieldTable />
      </section>
    </div>
  )
}
