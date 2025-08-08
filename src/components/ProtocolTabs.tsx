/* components/positions/ProtocolTabs.tsx */
'use client'
import { useState } from 'react'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { PositionsDashboardInner } from './PositionsDashboardInner'

const PROTOCOLS = [
  { value: 'Aave v3',     label: 'Aave'     },
  { value: 'Compound v3', label: 'Compound' },
] as const

export function ProtocolTabs() {
  const [tab, setTab] = useState<(typeof PROTOCOLS)[number]['value']>(
    'Aave v3',
  )

  return (
    <Tabs
    value={tab}
    onValueChange={(value) => setTab(value as typeof tab)}
    className="mx-auto w-full max-w-6xl"
  >
      {/* pill triggers */}
      <TabsList className="inline-flex rounded-full bg-gray-100 p-1 dark:bg-gray-900/40">
        {PROTOCOLS.map(({ value, label }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="rounded-full px-4 py-1.5 text-sm text-gray-600
                       transition data-[state=active]:bg-teal-600 data-[state=active]:text-white
                       dark:text-gray-300 dark:data-[state=active]:bg-teal-500"
          >
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* tab panels */}
      {PROTOCOLS.map(({ value }) => (
        <TabsContent value={value} key={value} className="mt-6">
          <PositionsDashboardInner protocol={value} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
