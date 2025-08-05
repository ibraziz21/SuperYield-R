'use client'
import { FC } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { useYields } from '@/hooks/useYields'
import { YieldRow } from './YieldRow'
import { Loader2 } from 'lucide-react'


export const YieldTable: FC = () => {
  const { yields, isLoading, error } = useYields()

  return (
    <Card className="mx-auto w-full max-w-6xl">
      <CardContent className="p-0">
        <table className="min-w-full divide-y divide-secondary/40 text-sm">
          <thead className="bg-secondary/10 backdrop-blur">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Token</th>
              <th className="px-4 py-3 text-left font-semibold">Chain</th>
              <th className="px-4 py-3 text-left font-semibold">Protocol</th>
              <th className="px-4 py-3 text-right font-semibold">APY</th>
              <th className="px-4 py-3 text-right font-semibold">TVL&nbsp;(USD)</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-red-500">Failed to load yields</td>
              </tr>
            )}
            {!isLoading && !error && yields.map((snap) => <YieldRow key={snap.id} snap={snap} />)}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}