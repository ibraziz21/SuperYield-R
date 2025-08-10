'use client'

import { FC } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import { type Position as BasePosition } from '@/lib/positions'
import { useApy } from '@/hooks/useAPY'
import { useYields } from '@/hooks/useYields'
import { TokenAddresses, COMET_POOLS } from '@/lib/constants'

type EvmChain = 'optimism' | 'lisk'
type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'
type ProtocolName = 'Aave v3' | 'Compound v3' | 'Morpho Blue'

/** Local, widened Position shape so we can render Lisk/Morpho too. */
type PositionLike =
  | BasePosition
  | {
      protocol: 'Morpho Blue'
      chain: Extract<EvmChain, 'lisk'>
      token: MorphoToken
      amount: bigint
    }

interface Props {
  p: PositionLike
  onSupply?: (p: PositionLike) => void
  onWithdraw?: (p: PositionLike) => void
}

function tokenDecimals(protocol: ProtocolName, token: string): number {
  if (protocol === 'Morpho Blue') return token === 'WETH' ? 18 : 6
  if (protocol === 'Aave v3') return 8
  return 6 // Compound v3
}

export const PositionCard: FC<Props> = ({ p, onSupply, onWithdraw }) => {
  const decs = tokenDecimals(p.protocol as ProtocolName, p.token)
  const amt = formatUnits(p.amount, decs)

  // Resolve addresses for Aave/Compound (Optimism only)
  let assetAddress: `0x${string}` | undefined
  let cometAddress: `0x${string}` | undefined

  if (p.protocol === 'Aave v3' && p.chain === 'optimism') {
    if (p.token === 'USDC' || p.token === 'USDT') {
      const tokenMap = TokenAddresses[p.token] as { optimism: `0x${string}` }
      assetAddress = tokenMap.optimism
    }
  }

  if (
    p.protocol === 'Compound v3' &&
    p.chain === 'optimism' &&
    (p.token === 'USDC' || p.token === 'USDT')
  ) {
    cometAddress = COMET_POOLS.optimism[p.token]
  }

  // APY: hook for Aave/Compound; Morpho uses yields snapshot
  const { data: apyHook } =
    p.protocol !== 'Morpho Blue'
      ? useApy(p.protocol as 'Aave v3' | 'Compound v3', {
          chain: 'optimism', // only OP is used for these hooks now
          asset: assetAddress,
          comet: cometAddress,
        })
      : { data: undefined }

  const { yields } = useYields()

  const morphoApy =
    p.protocol === 'Morpho Blue'
      ? yields?.find(
          (y) => y.protocolKey === 'morpho-blue' && y.chain === 'lisk' && y.token === p.token,
        )?.apy
      : undefined

  const apy =
    p.protocol === 'Morpho Blue'
      ? (typeof morphoApy === 'number' ? morphoApy : undefined)
      : (typeof apyHook === 'number' ? apyHook : undefined)

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-50 via-white to-gray-50 p-5 shadow transition hover:-translate-y-1 hover:shadow-lg dark:from-white/5 dark:via-gray-900 dark:to-gray-800">
      <CardContent>
        <div className="flex items-center justify-between text-xs uppercase text-gray-500 dark:text-gray-400">
          <span>{p.chain}</span>
          {typeof apy === 'number' && (
            <span className="text-teal-600 dark:text-teal-400">{apy.toFixed(2)}%</span>
          )}
        </div>

        <p className="mt-2 truncate text-3xl font-bold">
          {amt}{' '}
          <span className="text-lg font-medium text-gray-500 dark:text-gray-400">{p.token}</span>
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-500"
            onClick={() => onSupply?.(p)}
            disabled={!onSupply}
            title={onSupply ? 'Supply' : 'Supply (unavailable)'}
          >
            Supply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onWithdraw?.(p)}
            disabled={!onWithdraw}
            title={onWithdraw ? 'Withdraw' : 'Withdraw (unavailable)'}
          >
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
