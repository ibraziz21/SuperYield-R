// src/components/PositionCard.tsx
'use client'

import { FC, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits, type Address } from 'viem'
import { erc20Abi } from 'viem'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { type Position as BasePosition } from '@/lib/positions'
import { useApy } from '@/hooks/useAPY'
import { useYields } from '@/hooks/useYields'
import { TokenAddresses, COMET_POOLS } from '@/lib/constants'
import { publicOptimism } from '@/lib/clients'

type EvmChain = 'optimism' | 'base' | 'lisk'
type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'
type ProtocolName = 'Aave v3' | 'Compound v3' | 'Morpho Blue'

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
  if (protocol === 'Aave v3') return 6
  return 6
}

export const PositionCard: FC<Props> = ({ p, onSupply, onWithdraw }) => {
  const { address: user } = useAccount()

  // quick render log
  useEffect(() => {
    console.log('[PositionCard] render', {
      protocol: p.protocol,
      chain: p.chain,
      token: String(p.token),
      amount: (p as any)?.amount?.toString?.() ?? undefined,
    })
  }, [p])

  useEffect(() => {
    console.log('[PositionCard] user address', user)
  }, [user])

  // ----- SVault balance (Morpho Blue only) -----
  const [svtBal, setSvtBal] = useState<bigint | null>(null)
  const [svtDec, setSvtDec] = useState<number>(18)

  const VAULT_ADDR: Address | undefined =
  ((TokenAddresses as any)?.sVault?.optimism as Address | undefined) ??
  ('0xD56eE57eD7906b8558db9926578879091391Fbb7' as Address)
  

  useEffect(() => {
    if (p.protocol !== 'Morpho Blue') {
      setSvtBal(null)
      console.debug('[PositionCard] skip SVault read (not Morpho Blue)')
      return
    }
    if (!user) {
      setSvtBal(null)
      console.debug('[PositionCard] skip SVault read (no user)')
      return
    }
    if (!VAULT_ADDR) {
      console.error('[PositionCard] VAULT_ADDR missing (TokenAddresses.sVault.optimism)')
      setSvtBal(0n)
      return
    }

    let cancelled = false
    console.log('[PositionCard] fetching SVault balance', { user, vault: VAULT_ADDR })

    ;(async () => {
      try {
        const [dec, bal] = await Promise.all([
          publicOptimism.readContract({
            address: VAULT_ADDR,
            abi: erc20Abi,
            functionName: 'decimals',
          }) as Promise<number>,
          publicOptimism.readContract({
            address: VAULT_ADDR,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [user],
          }) as Promise<bigint>,
        ])

        if (!cancelled) {
          setSvtDec(dec ?? 18)
          setSvtBal(bal ?? 0n)
          console.log('[PositionCard] SVault read ok', {
            decimals: dec,
            balance: bal.toString(),
          })
        }
      } catch (err) {
        if (!cancelled) {
          setSvtBal(0n)
          console.error('[PositionCard] SVault read failed', err)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [p.protocol, user, VAULT_ADDR])

  // ----- Amount to display -----
  const decs = tokenDecimals(p.protocol as ProtocolName, p.token as string)
  const displayAmt =
    p.protocol === 'Morpho Blue'
      ? svtBal == null
        ? '…'
        : formatUnits(svtBal, svtDec)
      : formatUnits(p.amount, decs)

  useEffect(() => {
    console.debug('[PositionCard] display amount resolved', {
      protocol: p.protocol,
      svaultDecimals: svtDec,
      svaultBalance: svtBal?.toString(),
      decimalsUsed: decs,
      displayAmt,
    })
  }, [displayAmt, decs, p.protocol, svtBal, svtDec])

  // ----- Aave/Compound address resolution (unchanged) -----
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

  // ----- APY (keep existing behavior) -----
  const { data: apyHook } = useApy(
    p.protocol === 'Morpho Blue' ? 'Aave v3' : (p.protocol as 'Aave v3' | 'Compound v3'),
    { chain: (p.chain === 'lisk' ? 'base' : p.chain) as 'optimism' | 'base', asset: assetAddress, comet: cometAddress },
  )
  const { yields } = useYields()
  const morphoApy =
    p.protocol === 'Morpho Blue'
      ? yields?.find(y => y.protocolKey === 'morpho-blue' && y.chain === 'lisk' && y.token === p.token)?.apy
      : undefined
  const apy =
    p.protocol === 'Morpho Blue'
      ? typeof morphoApy === 'number' ? morphoApy : undefined
      : typeof apyHook === 'number' ? apyHook : undefined

  useEffect(() => {
    console.debug('[PositionCard] APY resolved', {
      protocol: p.protocol,
      apyHook,
      morphoApy,
      finalApy: apy,
    })
  }, [apy, apyHook, morphoApy, p.protocol])

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
          {displayAmt}{' '}
          <span className="text-lg font-medium text-gray-500 dark:text-gray-400">
            {String(p.token)}
          </span>
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-500"
            onClick={() => {
              console.log('[PositionCard] Supply clicked', {
                protocol: p.protocol,
                chain: p.chain,
                token: String(p.token),
              })
              onSupply?.(p)
            }}
            disabled={!onSupply}
            title={onSupply ? 'Supply' : 'Supply (unavailable)'}
          >
            Supply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              console.log('[PositionCard] Withdraw clicked', {
                protocol: p.protocol,
                chain: p.chain,
                token: String(p.token),
              })
              onWithdraw?.(p)
            }}
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
