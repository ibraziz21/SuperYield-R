'use client'

import { FC, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { usePositions } from '@/hooks/usePositions'
import { useApy } from '@/hooks/useAPY'
import { formatUnits } from 'viem'

type ProtocolName = 'Aave v3' | 'Compound v3' | 'Morpho Blue'

export const PositionsBoard: FC<{
  onDeposit?: (p: any) => void
  onWithdraw?: (p: any) => void
}> = ({ onDeposit, onWithdraw }) => {
  const { data } = usePositions()
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const by: Record<ProtocolName, any[]> = { 'Aave v3': [], 'Compound v3': [], 'Morpho Blue': [] }
    for (const p of data ?? []) by[p.protocol as ProtocolName]?.push(p)
    return by
  }, [data])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {(Object.keys(groups) as ProtocolName[]).map((proto) => {
        const items = groups[proto] || []
        if (!items.length) return null
        const subtotal = items.reduce((s, p) => s + Number(formatUnits(p.amount, p.protocol==='Morpho Blue' ? (p.token==='WETH'?18:6) : (p.protocol==='Aave v3'?8:6))), 0)

        const id = `sec-${proto}`
        const isOpen = open[id] ?? true
        return (
          <section key={proto} className="space-y-3">
            <header className="flex items-center justify-between">
              <div className="flex items-baseline gap-3">
                <h3 className="text-lg font-semibold tracking-tight">{proto}</h3>
                <span className="text-sm text-muted-foreground">
                  ${subtotal.toLocaleString(undefined,{ maximumFractionDigits: 2 })} supplied
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))} title={''}>
                  {isOpen ? 'Collapse' : 'Expand'}
                </Button>
              </div>
            </header>

            {isOpen && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((p, i) => <PositionCard key={i} p={p} onDeposit={onDeposit} onWithdraw={onWithdraw} />)}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

const PositionCard: FC<{ p: any; onDeposit?: (p:any)=>void; onWithdraw?: (p:any)=>void }> = ({ p, onDeposit, onWithdraw }) => {
  const decimals = p.protocol === 'Aave v3' ? 8 : p.protocol === 'Compound v3' ? 6 : (p.token==='WETH'?18:6)
  const amount = formatUnits(p.amount, decimals)

  // Normalize for hook like you did in AssetCard to avoid conditional-hook issues
  const normalizedProto: 'Aave v3' | 'Compound v3' = p.protocol === 'Compound v3' ? 'Compound v3' : 'Aave v3'
  const chainForHook: 'optimism' | 'base' = (p.chain === 'base' ? 'base' : 'optimism')
  const { data: apyMaybe } = useApy(normalizedProto, { chain: chainForHook })

  return (
    <Card className="rounded-2xl border bg-secondary/10 p-4">
      <CardContent className="space-y-2 p-0">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold">{amount}</span>
            <span className="font-semibold">{p.token}</span>
          </div>
          <span className="rounded-full border px-2 py-0.5 text-[11px] uppercase">{p.chain}</span>
        </div>
        <div className="text-xs text-muted-foreground">{p.protocol}</div>
        <div className="text-xs">
          {typeof apyMaybe === 'number' ? (
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700">
              {apyMaybe.toFixed(2)}% APY
            </span>
          ) : (
            <span className="text-muted-foreground">APY —</span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="bg-teal-600 hover:bg-teal-500" onClick={() => onDeposit?.(p)} title={'Deposit'}>Deposit</Button>
          <Button size="sm" variant="outline" onClick={() => onWithdraw?.(p)} title={'Withdraw'}>Withdraw</Button>
        </div>
      </CardContent>
    </Card>
  )
}
