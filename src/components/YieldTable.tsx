// src/components/positions/YieldTable.tsx

'use client'

import { FC, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useYields } from '@/hooks/useYields'
import { YieldRow } from './YieldRow'
import { isAaveMarketSupported } from '@/lib/tvl'

import { Loader2 } from 'lucide-react'

type Chain = 'optimism' | 'base' | 'lisk'
type Proto = 'aave-v3' | 'compound-v3' | 'morpho-blue'

const CHAIN_LABEL: Record<Chain, string> = {
  optimism: 'Optimism',
  base: 'Base',
  lisk: 'Lisk',
}

const PROTO_LABEL: Record<Proto, string> = {
  'aave-v3': 'Aave v3',
  'compound-v3': 'Compound v3',
  'morpho-blue': 'Morpho Blue',
}

const PROTO_ORDER: Proto[] = ['aave-v3', 'compound-v3', 'morpho-blue']

export const YieldTable: FC = () => {
  const { yields, isLoading, error } = useYields()

  // ── UI state: search / filters / sort
  const [query, setQuery] = useState('')
  const [activeProto, setActiveProto] = useState<'all' | Proto>('all')
  const [chainEnabled, setChainEnabled] = useState<Record<Chain, boolean>>({
    optimism: true,
    base: true,
    lisk: true,
  })
  const [sort, setSort] = useState<'apy_desc' | 'apy_asc' | 'tvl_desc' | 'tvl_asc'>('apy_desc')

  // ── derived rows
  const rows = useMemo(() => {
    if (!yields) return []

    const q = query.trim().toLowerCase()

    const filtered = yields.filter((y) => {
      // Hide unsupported Aave markets (e.g., Base + USDT)
      if (
        y.protocolKey === 'aave-v3' &&
        (y.chain === 'optimism' || y.chain === 'base') &&
        (y.token === 'USDC' || y.token === 'USDT') &&
        !isAaveMarketSupported(y.chain, y.token)
      ) return false
    
      // protocol filter
      if (activeProto !== 'all' && y.protocolKey !== activeProto) return false
      // chain filter
      if (!chainEnabled[y.chain as Chain]) return false
      // search
      if (q) {
        const hay = `${y.token} ${y.protocol} ${y.chain}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    // sort
    const sorted = filtered.slice().sort((a, b) => {
      const apyA = a.apy ?? 0
      const apyB = b.apy ?? 0
      const tvlA = a.tvlUSD ?? 0
      const tvlB = b.tvlUSD ?? 0
      switch (sort) {
        case 'apy_desc':
          return apyB - apyA
        case 'apy_asc':
          return apyA - apyB
        case 'tvl_desc':
          return tvlB - tvlA
        case 'tvl_asc':
          return tvlA - tvlB
      }
    })

    // nice: keep groups by protocol (optional)
    const grouped = sorted.sort((a, b) => {
      const ia = PROTO_ORDER.indexOf(a.protocolKey as Proto)
      const ib = PROTO_ORDER.indexOf(b.protocolKey as Proto)
      return ia - ib
    })

    return grouped
  }, [yields, query, activeProto, chainEnabled, sort])

  const toggleChain = (c: Chain) =>
    setChainEnabled((prev) => ({ ...prev, [c]: !prev[c] }))

  return (
    <Card className="mx-auto w-full max-w-6xl overflow-hidden">
      {/* Top bar */}
      <div className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur md:flex-row md:items-center md:justify-between dark:from-white/5 dark:to-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Markets</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'pool' : 'pools'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {/* protocol filter chips */}
          <div className="flex gap-1 rounded-full bg-muted/60 p-1">
            {(['all', ...PROTO_ORDER] as const).map((p) => (
              <button
                key={p}
                onClick={() => setActiveProto(p)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  activeProto === p
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                title={p === 'all' ? 'All protocols' : PROTO_LABEL[p]}
              >
                {p === 'all' ? 'All' : PROTO_LABEL[p]}
              </button>
            ))}
          </div>

          {/* chain toggles */}
          <div className="flex gap-1">
            {(Object.keys(CHAIN_LABEL) as Chain[]).map((c) => (
              <Button
                key={c}
                size="sm"
                variant={chainEnabled[c] ? 'default' : 'outline'}
                onClick={() => toggleChain(c)}
                title={CHAIN_LABEL[c]}
                className="h-8"
              >
                {CHAIN_LABEL[c]}
              </Button>
            ))}
          </div>

          {/* search */}
          <div className="w-full min-w-[200px] md:w-64">
            <Input
              placeholder="Search token, protocol, chain…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9"
            />
          </div>

          {/* sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            title="Sort"
          >
            <option value="apy_desc">APY: High → Low</option>
            <option value="apy_asc">APY: Low → High</option>
            <option value="tvl_desc">TVL: High → Low</option>
            <option value="tvl_asc">TVL: Low → High</option>
          </select>
        </div>
      </div>

      <CardContent className="p-0">
        <div className="max-h-[620px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-secondary/10 text-xs uppercase tracking-wide backdrop-blur dark:bg-white/5">
              <tr className="text-muted-foreground">
                <th className="px-4 py-3 text-left font-semibold">Token</th>
                <th className="px-4 py-3 text-left font-semibold">Chain</th>
                <th className="px-4 py-3 text-left font-semibold">Protocol</th>
                <th className="px-4 py-3 text-right font-semibold">APY</th>
                <th className="px-4 py-3 text-right font-semibold">TVL&nbsp;(USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary/30">
              {/* loading */}
              {isLoading && (
                <>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="animate-pulse">
                      <td className="px-4 py-4">
                        <div className="h-4 w-20 rounded bg-muted" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-4 w-24 rounded bg-muted" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-4 w-28 rounded bg-muted" />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="ml-auto h-4 w-14 rounded bg-muted" />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="ml-auto h-4 w-24 rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
                </>
              )}

              {/* error */}
              {error && !isLoading && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-red-500">
                    Failed to load yields
                  </td>
                </tr>
              )}

              {/* empty */}
              {!isLoading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-muted-foreground">
                    No pools match your filters.
                  </td>
                </tr>
              )}

              {/* data */}
              {!isLoading &&
                !error &&
                rows.map((snap) => (
                  <YieldRow key={snap.id} snap={snap} />
                ))}
            </tbody>
          </table>
        </div>

        {/* footer metrics */}
        {!isLoading && !error && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing <strong>{rows.length}</strong> pool{rows.length === 1 ? '' : 's'}
            </span>
            <span className="hidden md:block">
              Tip: Filter by protocol and chain, then sort by APY or TVL.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
