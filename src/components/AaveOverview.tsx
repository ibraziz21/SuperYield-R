'use client'
import { useAaveAccounts } from '@/hooks/useAaveAccounts'
import { Card, CardContent } from '@/components/ui/Card'
import { formatUnits } from 'viem'
import { Loader2 } from 'lucide-react'

export const AaveOverview = () => {
  const { data, isLoading } = useAaveAccounts()

  if (!isLoading && data?.every((d) => d.supplied === BigInt(0) && d.debt === BigInt(0)))
    return null

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {isLoading && (
        <div className="col-span-full flex justify-center py-8">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {data?.map((acc) => (
        <Card
          key={acc.chain}
          className="relative overflow-hidden rounded-2xl bg-secondary/10 p-5 backdrop-blur-sm"
        >
          <span className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/20" />
          <CardContent className="z-10 flex flex-col gap-2">
            <span className="text-xs uppercase text-secondary-foreground/70">
              Aave v3 · {acc.chain}
            </span>

            <div className="flex gap-4">
              <div>
                <p className="text-[11px] uppercase opacity-60">Supplied</p>
                <p className="text-xl font-bold">
                  ${formatUnits(acc.supplied, 8)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase opacity-60">Borrowed</p>
                <p className="text-xl font-bold">
                  ${formatUnits(acc.debt, 8)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
