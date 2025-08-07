/* src/components/positions/PositionsDashboardInner.tsx */
'use client'
import { FC } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { PositionCard } from './PositionCard' // rename of AssetCard

interface Props {
  protocol: 'Aave v3' | 'Compound v3'
}

export const PositionsDashboardInner: FC<Props> = ({ protocol }) => {
  const { data } = usePositions()

  if (!data) return null
  const subset = data.filter((p) => p.protocol === protocol)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {subset.map((p, i) => (
        <PositionCard key={i} p={p} />
      ))}
    </div>
  )
}
