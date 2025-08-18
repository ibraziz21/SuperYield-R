'use client'

import { FC, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { usePositions } from '@/hooks/usePositions'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast } from '@/lib/rewardForecast'

export const PortfolioHeader: FC = () => {
  const { data: positions } = usePositions()
  const { apy, loading, totalUsd } = usePortfolioApy()

  const kpis = useMemo(() => {
    const total = totalUsd ?? 0
    const daily = loading ? null : rewardForecast(total, apy).daily
    const yearly = loading ? null : rewardForecast(total, apy).yearly
    const count = positions?.length ?? 0
    return { total, daily, yearly, apy, count }
  }, [totalUsd, apy, loading, positions])

  return (
    <div className="sticky top-0 z-20 bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <div className="mx-auto grid w-full max-w-6xl gap-3 p-3 sm:grid-cols-4 sm:p-4">
        <Kpi title="Total Supplied" value={
          kpis.total ? `$${kpis.total.toLocaleString(undefined,{maximumFractionDigits:2})}` : '—'
        } />
        <Kpi title="Blended APY" value={loading ? '—' : `${kpis.apy.toFixed(2)}%`} />
        <Kpi title="Est. Daily Yield" value={
          loading || kpis.daily == null ? '—' : `≈ $${kpis.daily.toLocaleString(undefined,{maximumFractionDigits:2})}`
        } sub="at current APY" />
        <Kpi title="Forecast (1y)" value={
          loading || kpis.yearly == null ? '—' : `≈ $${kpis.yearly.toLocaleString(undefined,{maximumFractionDigits:2})}`
        } sub={`${kpis.count} position${kpis.count===1?'':'s'}`} />
      </div>
    </div>
  )
}

const Kpi = ({ title, value, sub }: { title:string; value:string; sub?:string }) => (
  <Card className="rounded-2xl">
    <CardContent className="space-y-1 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-2xl font-extrabold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent>
  </Card>
)
