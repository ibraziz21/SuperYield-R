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
    const weekly = loading ? null : rewardForecast(total, apy).weekly
    const yearly = loading ? null : rewardForecast(total, apy).yearly
    const count = positions?.length ?? 0
    return { total, daily, yearly, apy, count, weekly }
  }, [totalUsd, apy, loading, positions])

  return (
    <div className="sticky top-0 z-20 bg-[#F9FAFB] m-4 rounded-xl">
      <h3 className='p-4 font-semibold'>Overview</h3>
      <div className="mx-auto grid w-full max-w-6xl gap-3 p-3 sm:grid-cols-4 sm:p-4">
        <Kpi title="My Deposits" value={
          kpis.total ? `$${kpis.total.toLocaleString(undefined,{maximumFractionDigits:2})}` : '—'
        } />
        <Kpi title="Average APY" value={loading ? '—' : `${kpis.apy.toFixed(2)}%`} />
        <Kpi title="Est. Weekly Yield" value={
          loading || kpis.weekly == null ? '—' : `≈ $${kpis.weekly.toLocaleString(undefined,{maximumFractionDigits:2})}`
        } sub="at current APY" />
        <Kpi title="Ecovaults TVL" value={
          loading || kpis.yearly == null ? '—' : `≈ $${kpis.yearly.toLocaleString(undefined,{maximumFractionDigits:2})}`
        } sub={`${kpis.count} position${kpis.count===1?'':'s'}`} />
      </div>
    </div>
  )
}

const Kpi = ({ title, value, sub }: { title:string; value:string; sub?:string }) => (
  <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
    <CardContent className="space-y-1 p-4">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent>
  </Card>
)
