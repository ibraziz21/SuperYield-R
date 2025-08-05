'use client'
import { YieldTable } from '@/components/YieldTable'

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-extrabold mb-6">SuperYield-R Live Yields</h1>
      <YieldTable />
    </main>
  )
}
