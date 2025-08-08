'use client'

import { FC, useMemo } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast } from '@/lib/rewardForecast'
import { formatUnits } from 'viem'

import { Card, CardContent } from '@/components/ui/Card'
import { Loader2 } from 'lucide-react'

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

import type { Position } from '@/lib/positions'
import { TokenAddresses, COMET_POOLS } from '@/lib/constants'
import { useApy } from '@/hooks/useAPY'
import { Button } from '@/components/ui/button'

// ─────── Constants ───────────────────────────────────────────────────────────

const PIE_COLORS = ['#16a34a', '#7c3aed', '#f97316', '#38bdf8', '#ef4444']

const DECIMALS: Record<Position['protocol'], number> = {
  'Aave v3': 8,
  'Compound v3': 6,
}

// helper to convert bigint → number given decimals
const bnToNum = (bn: bigint, decimals: number) => Number(bn) / 10 ** decimals

// ─────── Main Dashboard ──────────────────────────────────────────────────────

export const PositionsDashboard: FC = () => {
  const { data, isLoading } = usePositions()
  const {
    apy: portfolioApy,
    loading: apyLoading,
    totalUsd,
  } = usePortfolioApy()

  const forecast =
    !apyLoading && totalUsd != null
      ? rewardForecast(totalUsd, portfolioApy)
      : null

  // aggregate totals & pie data
  const { totalSupplied, protocolTotals, pieData } = useMemo(() => {
    if (!data) {
      return {
        totalSupplied: 0,
        protocolTotals: {} as Record<string, number>,
        pieData: [] as { name: string; value: number }[],
      }
    }
    const totals: Record<string, number> = {}
    let sum = 0
    data.forEach((p) => {
      const num = bnToNum(p.amount, DECIMALS[p.protocol])
      totals[p.protocol] = (totals[p.protocol] ?? 0) + num
      sum += num
    })
    return {
      totalSupplied: sum,
      protocolTotals: totals,
      pieData: Object.entries(totals).map(([name, value]) => ({ name, value })),
    }
  }, [data])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-6 py-10">
        <Loader2 className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Fetching on-chain balances…
        </p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-center text-sm opacity-60">No active positions.</p>
    )
  }

  return (
    <div className="space-y-12">
      {/* headline stats */}
      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          title="Total Supplied"
          value={`$${totalSupplied.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}`}
        />
        <StatCard
          title="Total APY"
          value={
            apyLoading ? '—' : `${portfolioApy.toFixed(2)}%`
          }
          sub={apyLoading ? 'fetching…' : undefined}
        />
        <StatCard
          title="Forecast (yr)"
          value={
            apyLoading || !forecast
              ? '—'
              : `≈ $${forecast.yearly.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}`
          }
          sub="at current APY"
        />
      </div>

      {/* protocol allocation pie */}
      <Card className="p-6">
        <CardContent className="flex flex-col items-center">
          <h3 className="mb-4 text-sm font-medium text-muted-foreground">
            Protocol allocation
          </h3>
          <div className="h-64 w-full max-w-md">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={100}
                  paddingAngle={4}
                  strokeWidth={0}
                >
                  {pieData.map((_, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={PIE_COLORS[idx % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) =>
                    `$${v.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}`
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* per-protocol breakdown */}
      <div className="space-y-8">
        {Object.entries(protocolTotals).map(([protocol, _]) => (
          <div key={protocol} className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight">
              {protocol}
            </h3>
            <p className="text-sm text-muted-foreground">
              $
              {protocolTotals[protocol].toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{' '}
              supplied
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data
                .filter((p) => p.protocol === protocol)
                .map((p, idx) => (
                  <AssetCard
                    key={idx}
                    p={p}
                    onSupply={() => {}}
                    onWithdraw={() => {}}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────── sub-components ──────────────────────────────────────────────────────

interface StatProps {
  title: string
  value: string
  sub?: string
}
export const StatCard: FC<StatProps> = ({ title, value, sub }) => (
  <Card className="rounded-2xl bg-card p-6">
    <CardContent className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="text-3xl font-extrabold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent>
  </Card>
)

interface AssetCardProps {
  p: Position
  onSupply?: (p: Position) => void
  onWithdraw?: (p: Position) => void
}
const AssetCard: FC<AssetCardProps> = ({ p, onSupply, onWithdraw }) => {
  // format amount
  const decimals = DECIMALS[p.protocol]
  const amt = formatUnits(p.amount, decimals)

  // derive Aave asset address if needed
  let assetAddress: `0x${string}` | undefined
  if (p.protocol === 'Aave v3') {
    const map = TokenAddresses[p.token] as {
      optimism: `0x${string}`
      base: `0x${string}`
    }
    assetAddress = map[p.chain]
  }

  // derive Comet pool address if needed
   // --- derive correct Compound v3 pool address ---
   let cometAddress: `0x${string}` | undefined
   if (
     p.protocol === 'Compound v3' &&
     (p.token === 'USDC' || p.token === 'USDT')
   ) {
     cometAddress = COMET_POOLS[p.chain][p.token]
   }

  // --- *** HERE *** --- useApy at top‐level of this component
  const { data: apyData } = useApy(p.protocol, {
    chain: p.chain,
    asset: assetAddress,
    comet: cometAddress,
  })
  const apy = apyData ?? 0

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-secondary/10 p-5 backdrop-blur-sm">
      <span className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/20" />
      <CardContent className="z-10 flex flex-col gap-1">
        <span className="text-xs uppercase text-muted-foreground">
          {p.chain}
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tracking-tight">{amt}</span>
          <span className="font-semibold">{p.token}</span>
        </div>
        <span className="text-xs text-primary/80">
          {apy.toFixed(2)}% APY
        </span>
        <div className="mt-4 flex gap-2">
          {onSupply && (
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-500"
              onClick={() => onSupply(p)}
              title="Supply"
            >
              Supply
            </Button>
          )}
          {onWithdraw && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onWithdraw(p)}
              title="Withdraw"
            >
              Withdraw
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}



