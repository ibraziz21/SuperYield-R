'use client'

import { FC, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { usePositions } from '@/hooks/usePositions'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast } from '@/lib/rewardForecast'
import { formatAmountBigint } from '@/components/tables/MyPositionsTable/MyPositions'

export const PortfolioHeader: FC = () => {
  const { data: positions } = usePositions()
  const { apy, loading, totalUsd } = usePortfolioApy()

  // totalUsd comes as 18-decimals (bigint or decimal string). Convert ONCE to a number.
  const totalNum = useMemo<number>(() => {
    try {
      if (typeof totalUsd === 'bigint') {
        return Number(formatAmountBigint(totalUsd, 18) ?? 0)
      }
      if (typeof totalUsd === 'string') {
        return Number(formatAmountBigint(BigInt(totalUsd), 18) ?? 0)
      }
      if (typeof totalUsd === 'number') {
        return totalUsd
      }
    } catch {}
    return 0
  }, [totalUsd])

  const kpis = useMemo(() => {
    const daily  = loading ? null : rewardForecast(totalNum, apy).daily
    const yearly = loading ? null : rewardForecast(totalNum, apy).yearly
    const count  = positions?.length ?? 0
    return { total: totalNum, daily, yearly, apy, count }
  }, [totalNum, apy, loading, positions])

  return (
    <div className="sticky top-0 z-20 bg-[#F9FAFB] m-4 rounded-xl">
      <h3 className='p-4 font-semibold'>Overview</h3>
      <div className="mx-auto grid w-full max-w-6xl gap-3 p-3 sm:grid-cols-4 sm:p-4">
        <Kpi
          title="Total Supplied"
          value={
            kpis.total
              ? `$${kpis.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : '—'
          }
        />
        <Kpi
          title="Blended APY"
          value={loading ? '—' : `${kpis.apy.toFixed(2)}%`}
        />
        <Kpi
          title="Est. Daily Yield"
          value={
            loading || kpis.daily == null
              ? '—'
              : `≈ $${kpis.daily.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          }
          sub="at current APY"
        />
        <Kpi
          title="Forecast (1y)"
          value={
            loading || kpis.yearly == null
              ? '—'
              : `≈ $${kpis.yearly.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          }
          sub={`${kpis.count} position${kpis.count === 1 ? '' : 's'}`}
        />
      </div>
    </div>
  )
}

const Kpi = ({ title, value, sub }: { title: string; value: string; sub?: string }) => (
  <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
    <CardContent className="space-y-1 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent>
  </Card>
)
