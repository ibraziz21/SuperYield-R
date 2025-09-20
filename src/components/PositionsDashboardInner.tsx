// src/components/PositionsDashboardInner.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { type Position as BasePosition } from '@/lib/positions'
import { PositionCard } from './PositionCard'
import { DepositModal } from '@/components/DepositModal'
import { WithdrawModal } from '@/components/WithdrawModal'
import { Input } from '@/components/ui/input'
import { MORPHO_POOLS } from '@/lib/constants'

type EvmChain = 'optimism' | 'base' | 'lisk'
type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_POSITIONS !== 'false'
const dbg = (...a: any[]) => { if (DEBUG) console.log('[PositionsDashboardInner]', ...a) }

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
  'Aave v3': { title: 'Aave v3', hint: 'Supply & borrow across Optimism and Base.' },
  'Compound v3': { title: 'Compound v3', hint: 'Isolated markets on Optimism and Base.' },
  'Morpho Blue': { title: 'Morpho Blue (Lisk)', hint: 'MetaMorpho vaults live on Lisk.' },
}

const CHAIN_LABEL: Record<EvmChain, string> = {
  optimism: 'Optimism',
  base: 'Base',
  lisk: 'Lisk',
}

function normalizeTokenSymbol(t: string) {
  return t.replace(/\./g, '').replace(/\s+/g, '').toLowerCase()
}

const MORPHO_VAULT_BY_TOKEN: Record<MorphoToken, `0x${string}`> = {
  USDCe: MORPHO_POOLS['usdce-supply'] as `0x${string}`,
  USDT0: MORPHO_POOLS['usdt0-supply'] as `0x${string}`,
  WETH:  MORPHO_POOLS['weth-supply']  as `0x${string}`,
}

export const PositionsDashboardInner: FC<Props> = ({ protocol }) => {
  const { data: positionsRaw } = usePositions()
  const { yields: snapshots, isLoading: yieldsLoading } = useYields()

  dbg('hook.positionsRaw', positionsRaw)

  const positions = (positionsRaw ?? []) as unknown as PositionLike[]

  const defaultChains: Record<EvmChain, boolean> = {
    optimism: protocol !== 'Morpho Blue',
    base: protocol !== 'Morpho Blue',
    lisk: protocol === 'Morpho Blue',
  }

  const [query, setQuery] = useState('')
  const [chainEnabled, setChainEnabled] = useState<Record<EvmChain, boolean>>(
    () => ({ ...defaultChains }),
  )
  const [sort, setSort] = useState<'amount_desc' | 'amount_asc'>('amount_desc')

  const toggleChain = (c: EvmChain) =>
    setChainEnabled((prev) => ({ ...prev, [c]: !prev[c] }))

  const positionsForProtocol: PositionLike[] = useMemo(() => {
    if (protocol !== 'Morpho Blue') return positions
    const morpho = positions.filter((p) => p.protocol === 'Morpho Blue') as PositionLike[]
    if (morpho.length > 0) {
      dbg('morphoPositions', morpho.map(p => ({ ...p, amount: p.amount.toString() })))
      return morpho
    }
    const fallback: PositionLike[] = [
      { protocol: 'Morpho Blue', chain: 'lisk', token: 'USDCe', amount: 0n },
      { protocol: 'Morpho Blue', chain: 'lisk', token: 'USDT0', amount: 0n },
      // { protocol: 'Morpho Blue', chain: 'lisk', token: 'WETH',  amount: 0n },
    ]
    dbg('fallback.morphoPositions', fallback)
    return fallback
  }, [positions, protocol])

  const subset = useMemo(() => {
    const q = query.trim().toLowerCase()

    const filtered = positionsForProtocol.filter(
      (p) =>
        p.protocol === protocol &&
        chainEnabled[p.chain as EvmChain] &&
        (q ? `${p.token} ${p.chain} ${p.protocol}`.toLowerCase().includes(q) : true),
    )

    const sorted = filtered.slice().sort((a, b) => {
      if (sort === 'amount_desc') return Number((b.amount ?? 0n) - (a.amount ?? 0n))
      return Number((a.amount ?? 0n) - (b.amount ?? 0n))
    })

    dbg('subset.filtered', filtered.map(p => ({ ...p, amount: p.amount.toString() })))
    dbg('subset.sorted',   sorted.map(p => ({ ...p, amount: p.amount.toString() })))
    return sorted
  }, [positionsForProtocol, protocol, chainEnabled, query, sort])

  // Deposit / Withdraw modals
  const [depositSnap, setDepositSnap] = useState<YieldSnapshot | null>(null)
  const [withdrawSnap, setWithdrawSnap] = useState<YieldSnapshot | null>(null)

  const protoKey: Record<Props['protocol'], YieldSnapshot['protocolKey']> = {
    'Aave v3': 'aave-v3',
    'Compound v3': 'compound-v3',
    'Morpho Blue': 'morpho-blue',
  }

  function findSnapshotForPosition(p: PositionLike): YieldSnapshot {
    const pkey = protoKey[p.protocol as Props['protocol']]
    const normPosToken = normalizeTokenSymbol(String(p.token))

    const direct =
      snapshots?.find(
        (y) =>
          y.chain === p.chain &&
          y.protocolKey === pkey &&
          normalizeTokenSymbol(String(y.token)) === normPosToken,
      )
    if (direct) {
      dbg('snapshot.direct', { token: p.token, chain: p.chain, addr: direct.poolAddress })
      return direct
    }

    if (p.protocol === 'Morpho Blue') {
      const vault = MORPHO_VAULT_BY_TOKEN[p.token as MorphoToken]
      if (vault) {
        const byVault = snapshots?.find(
          (y) =>
            y.protocolKey === 'morpho-blue' &&
            y.chain === 'lisk' &&
            y.poolAddress?.toLowerCase() === vault.toLowerCase(),
        )
        if (byVault) {
          dbg('snapshot.byVault', { token: p.token, chain: p.chain, addr: byVault.poolAddress })
          return byVault
        }
      }
    }

    const fallback: YieldSnapshot = {
      id: `fallback-${p.protocol}-${p.chain}-${String(p.token)}`,
      chain: p.chain as any,
      protocol: p.protocol as any,
      protocolKey: pkey,
      poolAddress:
        p.protocol === 'Morpho Blue'
          ? (MORPHO_VAULT_BY_TOKEN[p.token as MorphoToken] ?? '0x0000000000000000000000000000000000000000')
          : '0x0000000000000000000000000000000000000000',
      token: p.token as any,
      apy: 0,
      tvlUSD: 0,
      updatedAt: new Date().toISOString(),
      underlying: '' as const,
    }
    dbg('snapshot.fallback', { token: p.token, chain: p.chain, addr: fallback.poolAddress })
    return fallback
  }

  const { title, hint } = PROTOCOL_TAG[protocol]
  const totalPositions = subset.length

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur dark:from-white/5 dark:to-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {totalPositions} {totalPositions === 1 ? 'position' : 'positions'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full bg-muted/60 p-1">
              {(Object.keys(CHAIN_LABEL) as EvmChain[])
                .filter((c) => (protocol === 'Morpho Blue' ? c === 'lisk' : c !== 'lisk'))
                .map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      dbg('toggleChain', { c, next: !chainEnabled[c] })
                      return setChainEnabled((prev) => ({ ...prev, [c]: !prev[c] }))
                    }}
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

            <div className="w-40 sm:w-56">
              <Input
                placeholder="Search token / chain…"
                value={query}
                onChange={(e) => { dbg('query', e.target.value); setQuery(e.target.value) }}
                className="h-8"
              />
            </div>

            <select
              value={sort}
              onChange={(e) => { dbg('sort', e.target.value); setSort(e.target.value as typeof sort) }}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              title="Sort"
            >
              <option value="amount_desc">Balance: High → Low</option>
              <option value="amount_asc">Balance: Low → High</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {hint}{yieldsLoading ? ' • Loading yields…' : ''}
        </p>
      </div>

      {subset.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
          No positions match your filters.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subset.map((p, idx) => {
              dbg('render.card', {
                idx,
                protocol: String(p.protocol),
                chain: String(p.chain),
                token: String(p.token),
                amount: (p as any).amount?.toString?.() ?? String((p as any).amount),
              })
              return (
                <PositionCard
                  key={`${String(p.protocol)}-${String(p.chain)}-${String(p.token)}-${idx}`}
                  p={p as any}
                  onSupply={(pos) => {
                    dbg('onSupply', {
                      token: String((pos as any).token),
                      chain: String((pos as any).chain),
                      amount: (pos as any).amount?.toString?.(),
                    })
                    setDepositSnap(findSnapshotForPosition(pos as any))
                  }}
                  onWithdraw={(pos) => {
                    dbg('onWithdraw', {
                      token: String((pos as any).token),
                      chain: String((pos as any).chain),
                      amount: (pos as any).amount?.toString?.(),
                    })
                    setWithdrawSnap(findSnapshotForPosition(pos as any))
                  }}
                />
              )
            })}
          </div>

        </>
      )}

      {depositSnap && (
        <DepositModal open={true} snap={depositSnap} onClose={() => { dbg('close.deposit'); setDepositSnap(null) }} />
      )}
      {withdrawSnap && (
        <WithdrawModal open={true} snap={withdrawSnap} onClose={() => { dbg('close.withdraw'); setWithdrawSnap(null) }} />
      )}
    </>
  )
}
