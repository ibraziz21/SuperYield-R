'use client'

import { FC, useMemo, useState } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { type Position as BasePosition } from '@/lib/positions'
import { PositionCard } from './PositionCard'
import { DepositModal } from '@/components/DepositModal'
import { WithdrawModal } from '@/components/WithdrawModal'

type EvmChain = 'optimism' | 'base' | 'lisk'
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

export const PositionsDashboardInner: FC<Props> = ({ protocol }) => {
  const { data: positionsRaw } = usePositions()
  const { yields: snapshots } = useYields()

  const positions = (positionsRaw ?? []) as unknown as PositionLike[]

  const subset = useMemo(() => {
    return positions.filter((p) => p.protocol === protocol)
  }, [positions, protocol])

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

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subset.map((p, idx) => {
          // For Morpho Blue (Lisk), we still allow Deposit; Withdraw may be disabled until supported.
          const allowWithdraw = p.protocol !== 'Morpho Blue'

          return (
            <PositionCard
              key={idx}
              p={p}
              onSupply={(pos) => {
                const snap = findSnapshotForPosition(pos)
                setDepositSnap(snap)
              }}
              onWithdraw={
                allowWithdraw
                  ? (pos) => {
                      const snap = findSnapshotForPosition(pos)
                      setWithdrawSnap(snap)
                    }
                  : undefined
              }
            />
          )
        })}
      </div>

      {/* Deposit */}
      {depositSnap && (
        <DepositModal open={true} snap={depositSnap} onClose={() => setDepositSnap(null)} />
      )}

      {/* Withdraw (disabled for Morpho Blue until implemented in lib/withdraw) */}
      {withdrawSnap && (
        <WithdrawModal open={true} snap={withdrawSnap} onClose={() => setWithdrawSnap(null)} />
      )}
    </>
  )
}
