/* ───────── src/app/positions/page.tsx ───────── */
'use client'

import { MetricBar }    from '@/components/MetricBar'
import { ProtocolTabs } from '@/components/ProtocolTabs'
import { YieldTable }   from '@/components/YieldTable'

export default function PositionsPage() {
  return (
    <div className="space-y-12">
      {/* 1 ▸ high-level metrics */}
      <MetricBar />

      {/* 2 ▸ per-protocol positions (cards with hover actions) */}
      <ProtocolTabs />

      {/* 3 ▸ power-user table */}
      <YieldTable />
    </div>
  )
}
