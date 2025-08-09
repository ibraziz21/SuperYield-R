'use client'

import { useState, useMemo } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PositionsDashboardInner } from './PositionsDashboardInner'
import { usePositions } from '@/hooks/usePositions'

const PROTOCOLS = [
  { value: 'Aave v3', label: 'Aave' },
  { value: 'Compound v3', label: 'Compound' },
  { value: 'Morpho Blue', label: 'Morpho' },
] as const

type TabValue = (typeof PROTOCOLS)[number]['value']

export function ProtocolTabs() {
  const [tab, setTab] = useState<TabValue>('Aave v3')
  const { data: positions } = usePositions()

  // counts per protocol for nice badges on triggers
  const counts = useMemo(() => {
    const map = new Map<TabValue, number>()
    for (const p of PROTOCOLS) map.set(p.value, 0)
    if (positions) {
      positions.forEach((pos) => {
        const key = pos.protocol as TabValue
        if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1)
      })
    }
    return map
  }, [positions])

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Fancy heading */}
      <div className="mb-4 rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur dark:from-white/5 dark:to-white/10">
        <h2 className="text-lg font-semibold">Your Positions</h2>
        <p className="text-xs text-muted-foreground">
          Browse balances by protocol. Use filters inside each section to refine further.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabValue)}
        className="w-full"
      >
        {/* Triggers with badges */}
        <TabsList
          className="
            inline-flex rounded-full bg-muted/50 p-1 ring-1 ring-border/60
            dark:bg-white/10
          "
        >
          {PROTOCOLS.map(({ value, label }) => {
            const count = counts.get(value) ?? 0
            return (
              <TabsTrigger
                key={value}
                value={value}
                className="
                  rounded-full px-4 py-1.5 text-sm text-muted-foreground transition
                  data-[state=active]:bg-primary data-[state=active]:text-primary-foreground
                "
              >
                <span>{label}</span>
                <span
                  className="
                    ml-2 rounded-full bg-black/5 px-2 py-[2px] text-[10px]
                    data-[state=active]:bg-white/20
                    dark:bg-white/10
                  "
                >
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Panels */}
        {PROTOCOLS.map(({ value }) => (
          <TabsContent value={value} key={value} className="mt-6">
            <PositionsDashboardInner protocol={value} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
