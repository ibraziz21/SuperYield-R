'use client'
import { FC } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import { Position } from '@/lib/positions'
import { useApy } from '@/hooks/useAPY'
import { TokenAddresses, COMET_POOLS } from '@/lib/constants'

const DECIMALS: Record<Position['protocol'], number> = {
  'Aave v3':      8,
  'Compound v3':  6,
}

interface Props {
  p: Position
  onSupply?: (p: Position) => void
  onWithdraw?: (p: Position) => void
}

export const PositionCard: FC<Props> = ({ p, onSupply, onWithdraw }) => {
  const decimals = DECIMALS[p.protocol]
  const amt      = formatUnits(p.amount, decimals)

  // --- Safely resolve the Aave asset address ---
  let assetAddress: `0x${string}` | undefined
  if (p.protocol === 'Aave v3') {
    // Aave only uses USDC/USDT on optimism & base
    const tokenMap = TokenAddresses[p.token] as {
      optimism: `0x${string}`
      base:     `0x${string}`
    }
    assetAddress = tokenMap[p.chain]
  }

  // --- Safely resolve the Comet pool address ---
  let cometAddress: `0x${string}` | undefined
  if (
    p.protocol === 'Compound v3' &&
    (p.token === 'USDC' || p.token === 'USDT')
  ) {
    // now TS knows p.token is USDC|USDT
    cometAddress = COMET_POOLS[p.chain][p.token]
  }

  // --- Calculate APY ---
  const { data: apy } = useApy(p.protocol, {
    chain: p.chain,
    asset: assetAddress,
    comet: cometAddress,
  })

  return (
    <Card className="
      group relative overflow-hidden rounded-2xl bg-gradient-to-br
      from-teal-50 via-white to-gray-50 p-5 shadow
      transition hover:-translate-y-1 hover:shadow-lg
      dark:from-white/5 dark:via-gray-900 dark:to-gray-800
    ">
      <CardContent>
        <div className="
          flex items-center justify-between text-xs uppercase
          text-gray-500 dark:text-gray-400
        ">
          {p.chain}
           {typeof apy === 'number' && (
            <span className="text-teal-600 dark:text-teal-400">
              {apy.toFixed(2)}%
            </span>
          )}
        </div>

        <p className="mt-2 truncate text-3xl font-bold">
          {amt}{' '}
          <span className="
            text-lg font-medium text-gray-500 dark:text-gray-400
          ">
            {p.token}
          </span>
        </p>

        <div className="mt-4 flex gap-2 opacity-0 transition group-hover:opacity-100">
          {onSupply && (
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-500"
              onClick={() => onSupply(p)}
              title="Supply"
            >
              Supply
            </Button>
          )}
          {onWithdraw && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onWithdraw(p)}
              title="Withdraw"
            >
              Withdraw
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
