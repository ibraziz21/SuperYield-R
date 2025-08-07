/* src/app/page.tsx */
'use client'
import { PositionsGrid } from '@/components/PositionsGrid'
import { YieldTable } from '@/components/YieldTable'
import Link from 'next/link'

export default function Dashboard() {
  return (
    <div className="space-y-12">
       <div className="flex justify-end">
        <Link
          href="/positions"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          View more →
        </Link>
      </div>
      <PositionsGrid />

      <YieldTable />
    </div>
  )
}
