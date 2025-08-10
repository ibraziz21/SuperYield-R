// src/components/positions/YieldTable.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useYields } from '@/hooks/useYields'
import { isAaveMarketSupported } from '@/lib/tvl'
import { YieldRow } from './YieldRow'

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

  // UI: search / filters / sort
  const [query, setQuery] = useState('')
  const [activeProto, setActiveProto] = useState<'all' | Proto>('all')
  const [chainEnabled, setChainEnabled] = useState<Record<Chain, boolean>>({
    optimism: true,
    base: true,
    lisk: true,
  })
  const [sort, setSort] = useState<'apy_desc' | 'apy_asc' | 'tvl_desc' | 'tvl_asc'>('apy_desc')

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

      if (activeProto !== 'all' && y.protocolKey !== activeProto) return false
      if (!chainEnabled[y.chain as Chain]) return false

      if (q) {
        const hay = `${y.token} ${y.protocol} ${y.chain}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const sorted = filtered.slice().sort((a, b) => {
      const apyA = a.apy ?? 0
      const apyB = b.apy ?? 0
      const tvlA = a.tvlUSD ?? 0
      const tvlB = b.tvlUSD ?? 0
      switch (sort) {
        case 'apy_desc': return apyB - apyA
        case 'apy_asc':  return apyA - apyB
        case 'tvl_desc': return tvlB - tvlA
        case 'tvl_asc':  return tvlA - tvlB
      }
    })

    // Keep protocol grouping stable
    return sorted.sort((a, b) => {
      const ia = PROTO_ORDER.indexOf(a.protocolKey as Proto)
      const ib = PROTO_ORDER.indexOf(b.protocolKey as Proto)
      return ia - ib
    })
  }, [yields, query, activeProto, chainEnabled, sort])

  const toggleChain = (c: Chain) => setChainEnabled((prev) => ({ ...prev, [c]: !prev[c] }))

  return (
    <Card className="mx-auto w-full max-w-6xl overflow-hidden rounded-xl md:rounded-2xl">
      {/* Top bar (sticky on mobile) */}
      <div className="sticky top-0 z-30 flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-white to-white/60 p-3 backdrop-blur md:static md:flex-row md:items-center md:justify-between md:p-4 dark:from-white/5 dark:to-white/10">
        <div className="flex items-center gap-2 md:gap-3">
          <h2 className="text-base font-semibold md:text-lg">Markets</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground md:text-xs">
            {rows.length} {rows.length === 1 ? 'pool' : 'pools'}
          </span>
        </div>

        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:flex-wrap md:items-center md:justify-end">
          {/* protocol filter chips (scrollable on mobile) */}
          <div className="flex gap-1 overflow-x-auto rounded-full bg-muted/60 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(['all', ...PROTO_ORDER] as const).map((p) => (
              <button
                key={p}
                onClick={() => setActiveProto(p)}
                className={`rounded-full px-3 py-1 text-[11px] transition md:text-xs ${
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
                className="h-8 px-3 text-[11px] md:h-8 md:text-xs"
              >
                {CHAIN_LABEL[c]}
              </Button>
            ))}
          </div>

          {/* search */}
          <div className="w-full md:w-64">
            <Input
              placeholder="Search token, protocol, chain…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search markets"
              className="h-9 text-sm"
            />
          </div>

          {/* sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort markets"
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
        {/* Responsive scrollers:
            - x-axis for table width on phones
            - y-axis for rows */}
        <div className="w-full overflow-x-auto">
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="min-w-[720px] text-xs sm:min-w-full sm:text-sm">
              <thead className="sticky top-0 z-10 bg-secondary/10 uppercase tracking-wide backdrop-blur dark:bg-white/5">
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold md:px-4 md:py-3">Token</th>
                  <th className="px-3 py-2 text-left font-semibold md:px-4 md:py-3">Chain</th>
                  <th className="px-3 py-2 text-left font-semibold md:px-4 md:py-3">Protocol</th>
                  <th className="px-3 py-2 text-right font-semibold md:px-4 md:py-3">APY</th>
                  <th className="px-3 py-2 text-right font-semibold md:px-4 md:py-3">TVL&nbsp;(USD)</th>
                  <th className="px-3 py-2 text-right font-semibold md:px-4 md:py-3">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-secondary/30">
                {/* loading */}
                {isLoading && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="animate-pulse">
                        <td className="px-3 py-3 md:px-4 md:py-4"><div className="h-3 w-20 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 md:px-4 md:py-4"><div className="h-3 w-24 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 md:px-4 md:py-4"><div className="h-3 w-28 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 text-right md:px-4 md:py-4"><div className="ml-auto h-3 w-14 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 text-right md:px-4 md:py-4"><div className="ml-auto h-3 w-24 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 text-right md:px-4 md:py-4"><div className="ml-auto h-7 w-20 rounded bg-muted md:h-8" /></td>
                      </tr>
                    ))}
                  </>
                )}

                {/* error */}
                {error && !isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-red-500 md:px-4">Failed to load yields</td>
                  </tr>
                )}

                {/* empty */}
                {!isLoading && !error && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground md:px-4">
                      No pools match your filters.
                    </td>
                  </tr>
                )}

                {/* data */}
                {!isLoading && !error && rows.map((snap) => (
                  <YieldRow key={snap.id} snap={snap} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!isLoading && !error && (
          <div className="flex items-center justify-between border-t px-3 py-3 text-[11px] text-muted-foreground md:px-4 md:text-xs">
            <span>Showing <strong>{rows.length}</strong> pool{rows.length === 1 ? '' : 's'}</span>
            <span className="hidden md:block">Tip: Filter by protocol and chain, then sort by APY or TVL.</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
