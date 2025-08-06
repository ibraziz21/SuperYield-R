'use client'
import { usePositions } from '@/hooks/usePositions'
import { formatUnits } from 'viem'
import { Card, CardContent } from '@/components/ui/Card'
import { Loader2 } from 'lucide-react'

export const PositionsGrid = () => {
  const { data, isLoading } = usePositions()

  if (!isLoading && (!data || data.length === 0))
    return <p className="text-center text-sm opacity-70">No active positions.</p>

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {isLoading && (
        <div className="col-span-full flex justify-center py-8">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {data?.map((p, i) => (
        <Card
          key={i}
          className="relative overflow-hidden rounded-2xl bg-secondary/10 p-5 backdrop-blur-sm"
        >
          {/* neon gradient edge */}
          <span className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/20" />

          <CardContent className="z-10 flex flex-col gap-2">
            <span className="text-xs uppercase text-secondary-foreground/70">
              {p.protocol} · {p.chain}
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold tracking-tight">
                {formatUnits(p.amount, 6)}
              </span>
              <span className="font-semibold">{p.token}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
