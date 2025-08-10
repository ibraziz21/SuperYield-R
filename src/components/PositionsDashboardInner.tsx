'use client'

import { FC, useMemo, useState } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { type Position as BasePosition } from '@/lib/positions'
import { PositionCard } from './PositionCard'
import { DepositModal } from '@/components/DepositModal'
import { WithdrawModal } from '@/components/WithdrawModal'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type EvmChain = 'optimism'| 'lisk'
type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'

/** Extend the base Position shape locally to allow Morpho/Lisk too. */
type PositionLike =
  | BasePosition
  | {
      protocol: 'Morpho Blue'
      chain: Extract<EvmChain, 'lisk'>
      token: MorphoToken
      amount: bigint
    }

interface Props {
  protocol: 'Aave v3' | 'Compound v3' | 'Morpho Blue'
}

const PROTOCOL_TAG: Record<Props['protocol'], { title: string; hint: string }> = {
  'Aave v3': {
    title: 'Aave v3',
    hint: 'Supply & borrow across Optimism',
  },
  'Compound v3': {
    title: 'Compound v3',
    hint: 'Isolated markets on Optimism',
  },
  'Morpho Blue': {
    title: 'Morpho Blue (Lisk)',
    hint: 'MetaMorpho vaults live on Lisk.',
  },
}

const CHAIN_LABEL: Record<EvmChain, string> = {
  optimism: 'Optimism',
  lisk: 'Lisk',
}

export const PositionsDashboardInner: FC<Props> = ({ protocol }) => {
  const { data: positionsRaw } = usePositions()
  const { yields: snapshots } = useYields()

  const positions = (positionsRaw ?? []) as unknown as PositionLike[]

  /** Default chains per protocol */
  const defaultChains: Record<EvmChain, boolean> = {
    optimism: protocol !== 'Morpho Blue',
    lisk: protocol === 'Morpho Blue',
  }

  // ── UI state
  const [query, setQuery] = useState('')
  const [chainEnabled, setChainEnabled] = useState<Record<EvmChain, boolean>>(
    () => ({ ...defaultChains }),
  )
  const [sort, setSort] = useState<'amount_desc' | 'amount_asc'>('amount_desc')

  const toggleChain = (c: EvmChain) =>
    setChainEnabled((prev) => ({ ...prev, [c]: !prev[c] }))

  // ── Filter positions for this protocol, chain chips & search
  const subset = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = positions.filter(
      (p) =>
        p.protocol === protocol &&
        chainEnabled[p.chain as EvmChain] &&
        (q
          ? `${p.token} ${p.chain} ${p.protocol}`.toLowerCase().includes(q)
          : true),
    )

    const sorted = filtered.slice().sort((a, b) => {
      if (sort === 'amount_desc') return Number(b.amount - a.amount)
      return Number(a.amount - b.amount)
    })

    return sorted
  }, [positions, protocol, chainEnabled, query, sort])

  // ── Deposit / Withdraw modals
  const [depositSnap, setDepositSnap] = useState<YieldSnapshot | null>(null)
  const [withdrawSnap, setWithdrawSnap] = useState<YieldSnapshot | null>(null)

  /** Map protocol label → protocolKey used in YieldSnapshot */
  const protoKey: Record<Props['protocol'], YieldSnapshot['protocolKey']> = {
    'Aave v3': 'aave-v3',
    'Compound v3': 'compound-v3',
    'Morpho Blue': 'morpho-blue',
  }

  /** Given a PositionLike, find matching YieldSnapshot (for APY, addresses, etc). */
  function findSnapshotForPosition(p: PositionLike): YieldSnapshot {
    const pkey = protoKey[p.protocol as Props['protocol']]
    const snap = snapshots?.find(
      (y) =>
        y.chain === p.chain &&
        y.token === (p.token as YieldSnapshot['token']) &&
        y.protocolKey === pkey,
    )
    if (!snap) throw new Error('Could not find yield snapshot for position')
    return snap
  }

  const { title, hint } = PROTOCOL_TAG[protocol]
  const totalPositions = subset.length

  return (
    <>
      {/* Section header / controls */}
      <div
        className="
          mb-4 flex flex-col gap-3 rounded-2xl border border-border/60
          bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur
          dark:from-white/5 dark:to-white/10
        "
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {totalPositions} {totalPositions === 1 ? 'position' : 'positions'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* chain chips */}
            <div className="flex gap-1 rounded-full bg-muted/60 p-1">
              {(Object.keys(CHAIN_LABEL) as EvmChain[])
                .filter((c) =>
                  protocol === 'Morpho Blue' ? c === 'lisk' : c !== 'lisk',
                )
                .map((c) => (
                  <button
                    key={c}
                    onClick={() => toggleChain(c)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      chainEnabled[c]
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    title={CHAIN_LABEL[c]}
                  >
                    {CHAIN_LABEL[c]}
                  </button>
                ))}
            </div>

            {/* search */}
            <div className="w-40 sm:w-56">
              <Input
                placeholder="Search token / chain…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8"
              />
            </div>

            {/* sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              title="Sort"
            >
              <option value="amount_desc">Balance: High → Low</option>
              <option value="amount_asc">Balance: Low → High</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      {/* Cards */}
      {subset.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
          No positions match your filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subset.map((p, idx) => {
            // Withdraw disabled for Morpho Blue until implemented in lib/withdraw
            const allowWithdraw = p.protocol !== 'Morpho Blue'

            return (
              <PositionCard
                key={idx}
                p={p as any}
                onSupply={(pos) => {
                  const snap = findSnapshotForPosition(pos as PositionLike)
                  setDepositSnap(snap)
                }}
                onWithdraw={
                  allowWithdraw
                    ? (pos) => {
                        const snap = findSnapshotForPosition(pos as PositionLike)
                        setWithdrawSnap(snap)
                      }
                    : undefined
                }
              />
            )
          })}
        </div>
      )}

      {/* Deposit */}
      {depositSnap && (
        <DepositModal open={true} snap={depositSnap} onClose={() => setDepositSnap(null)} />
      )}

      {/* Withdraw */}
      {withdrawSnap && (
        <WithdrawModal open={true} snap={withdrawSnap} onClose={() => setWithdrawSnap(null)} />
      )}
    </>
  )
}
