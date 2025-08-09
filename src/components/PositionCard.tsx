'use client'

import { FC } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import { type Position as BasePosition } from '@/lib/positions'
import { useApy } from '@/hooks/useAPY'
import { useYields } from '@/hooks/useYields'
import { TokenAddresses, COMET_POOLS } from '@/lib/constants'

type EvmChain = 'optimism' | 'base' | 'lisk'
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
  if (protocol === 'Morpho Blue') {
    return token === 'WETH' ? 18 : 6 // lisk tokens: WETH 18, USDCe/USDT0 6
  }
  if (protocol === 'Aave v3') return 8 // aToken-style reporting (1e8 base units)
  return 6 // Compound v3 balances in token units (USDC/USDT)
}

export const PositionCard: FC<Props> = ({ p, onSupply, onWithdraw }) => {
  const decs = tokenDecimals(p.protocol as ProtocolName, p.token)
  const amt = formatUnits(p.amount, decs)

  // Resolve addresses for Aave/Compound (never for Lisk/Morpho)
  let assetAddress: `0x${string}` | undefined
  let cometAddress: `0x${string}` | undefined

  if (p.protocol === 'Aave v3' && (p.chain === 'optimism' || p.chain === 'base')) {
    if (p.token === 'USDC' || p.token === 'USDT') {
      const tokenMap = TokenAddresses[p.token] as {
        optimism: `0x${string}`
        base: `0x${string}`
      }
      assetAddress = tokenMap[p.chain]
    }
  }

  if (
    p.protocol === 'Compound v3' &&
    (p.chain === 'optimism' || p.chain === 'base') &&
    (p.token === 'USDC' || p.token === 'USDT')
  ) {
    cometAddress = COMET_POOLS[p.chain][p.token]
  }

  // APY: use hook for Aave/Compound; for Morpho, read from yields snapshot
  const { data: apyHook } = useApy(
    p.protocol === 'Morpho Blue' ? 'Aave v3' : (p.protocol as 'Aave v3' | 'Compound v3'),
    // for Morpho we won't use these values anyway
    { chain: (p.chain === 'lisk' ? 'base' : p.chain) as 'optimism' | 'base', asset: assetAddress, comet: cometAddress },
  )
  const { yields } = useYields()

  const morphoApy =
    p.protocol === 'Morpho Blue'
      ? yields?.find(
          (y) => y.protocolKey === 'morpho-blue' && y.chain === 'lisk' && y.token === p.token,
        )?.apy
      : undefined

  const apy =
    p.protocol === 'Morpho Blue'
      ? typeof morphoApy === 'number'
        ? morphoApy
        : undefined
      : typeof apyHook === 'number'
      ? apyHook
      : undefined

  return (
    <Card
      className="
        relative overflow-hidden rounded-2xl bg-gradient-to-br
        from-teal-50 via-white to-gray-50 p-5 shadow
        transition hover:-translate-y-1 hover:shadow-lg
        dark:from-white/5 dark:via-gray-900 dark:to-gray-800
      "
    >
      <CardContent>
        <div
          className="
            flex items-center justify-between text-xs uppercase
            text-gray-500 dark:text-gray-400
          "
        >
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
