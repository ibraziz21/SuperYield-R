'use client'

import { FC, useMemo } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { formatUnits } from 'viem'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast } from '@/lib/rewardForecast'

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
import { Button } from './ui/button'

// ─────── Constants ───────────────────────────────────────────────────────────

const PIE_COLORS = ['#16a34a', '#7c3aed', '#f97316', '#38bdf8', '#ef4444']

const DECIMALS: Record<Position['protocol'], number> = {
  'Aave v3':      8,
  'Compound v3':  6,
}

// convert bigint to number with decimals
const bnToNum = (bn: bigint, decimals: number) => Number(bn) / 10 ** decimals

// ─────── Main Dashboard ──────────────────────────────────────────────────────

export const PositionsDashboard: FC = () => {
  const { data, isLoading } = usePositions()
  const { apy: portfolioApy, loading: apyLoading, totalUsd } = usePortfolioApy()

  const forecast = !apyLoading && totalUsd != null
    ? rewardForecast(totalUsd, portfolioApy)
    : null

  // aggregate totals & pie data
  const { totalSupplied, protocolTotals, pieData } = useMemo(() => {
    if (!data) {
      return { totalSupplied: 0, protocolTotals: {} as Record<string, number>, pieData: [] }
    }

    const protoTotals: Record<string, number> = {}
    let total = 0

    data.forEach((p) => {
      const num = bnToNum(p.amount, DECIMALS[p.protocol])
      protoTotals[p.protocol] = (protoTotals[p.protocol] ?? 0) + num
      total += num
    })

    const pie = Object.entries(protoTotals).map(([name, value]) => ({ name, value }))
    return { totalSupplied: total, protocolTotals: protoTotals, pieData: pie }
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
      <p className="text-center text-sm opacity-60">
        No active positions.
      </p>
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
            apyLoading
              ? '—'
              : `${portfolioApy.toFixed(2)}%`
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
                  formatter={(value) =>
                    `$${Number(value).toLocaleString(undefined, {
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
        {Object.entries(protocolTotals).map(([protocol, total]) => (
          <div key={protocol} className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight">
              {protocol}
            </h3>
            <p className="text-sm text-muted-foreground">
              ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} supplied
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data
                .filter((p) => p.protocol === protocol)
                .map((p, idx) => {
                  // --- derive correct Aave asset address ---
                  let assetAddress: `0x${string}` | undefined
                  if (
                    p.protocol === 'Aave v3' &&
                    (p.token === 'USDC' || p.token === 'USDT')
                  ) {
                    const tokenMap = TokenAddresses[p.token] as {
                      optimism: `0x${string}`
                      base:     `0x${string}`
                    }
                    assetAddress = tokenMap[p.chain]
                  }

                  // --- derive correct Compound v3 pool address ---
                  let cometAddress: `0x${string}` | undefined
                  if (
                    p.protocol === 'Compound v3' &&
                    (p.token === 'USDC' || p.token === 'USDT')
                  ) {
                    cometAddress = COMET_POOLS[p.chain][p.token]
                  }

                  const { data: apy } = useApy(p.protocol, {
                    chain: p.chain,
                    asset: assetAddress,
                    comet: cometAddress,
                  })

                  return (
                    <AssetCard
                      key={idx}
                      p={p}
                      apy={Number(apy)}
                      onSupply={() => {}}
                      onWithdraw={() => {}}
                    />
                  )
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────── Sub-components ───────────────────────────────────────────────────────

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
  apy?: number | null
  onSupply?: (p: Position) => void
  onWithdraw?: (p: Position) => void
}

const AssetCard: FC<AssetCardProps> = ({ p, apy, onSupply, onWithdraw }) => {
  const decimals = DECIMALS[p.protocol]
  const amt = formatUnits(p.amount, decimals)

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
        {typeof apy === 'number' && (
          <span className="text-xs text-primary/80">
            {apy.toFixed(2)}% APY
          </span>
        )}
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
