// src/app/page.tsx
'use client'

import Link from 'next/link'
import { PositionsGrid } from '@/components/PositionsGrid'
import { TopYields } from '@/components/TopYields'

export default function Dashboard() {
  return (
    <div className="space-y-10">
      {/* Positions snapshot + metrics */}
      <PositionsGrid />

      {/* Compact markets preview */}
      <section className="mx-auto w-full max-w-6xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Top yields</h2>
          <Link
            href="/markets"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            See all markets →
          </Link>
        </div>
        <TopYields limit={5} />
      </section>
    </div>
  )
}
