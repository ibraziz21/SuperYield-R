'use client'

import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Card, CardContent } from '@/components/ui/Card'
import { DepositWithdraw } from '@/components/deposit/deposit-withdraw'
import { useMemo } from 'react'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { usePositions } from '@/hooks/usePositions'
import { formatUnits } from 'viem'
import { useAppKitAccount } from '@reown/appkit/react'
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'

// Accept both canonical and alias slugs, normalize for lookups
const CANONICAL: Record<string, 'USDC' | 'USDT'> = {
  USDC: 'USDC',
  USDCE: 'USDC',
  'USDC.E': 'USDC',
  USDT: 'USDT',
  USDT0: 'USDT',
}

// Token icon mapping (include aliases)
const tokenIcons: Record<string, string> = {
  USDC: '/tokens/usdc-icon.png',
  USDCe: '/tokens/usdc-icon.png',
  USDT: '/tokens/usdt-icon.png',
  USDT0: '/tokens/usdt0-icon.png',
  WETH: '/tokens/weth.png',
  DAI: '/tokens/dai.png',
}

// Network icon mapping
const networkIcons: Record<string, string> = {
  Ethereum: '/networks/ethereum.png',
  Lisk: '/networks/lisk.png',
  Arbitrum: '/networks/arbitrum.png',
  Optimism: '/networks/op-icon.png',
  Base: '/networks/base.png',
}

// Normalize for display parity with YieldRow (underlying → canonical)
const DISPLAY_TOKEN: Record<string, string> = {
  USDCe: 'USDC',
  USDT0: 'USDT',
  USDC: 'USDC',
  USDT: 'USDT',
  WETH: 'WETH',
}

// Only Lisk + Morpho Blue + (USDC/USDT)
const HARD_FILTER = (y: Pick<YieldSnapshot, 'chain' | 'protocolKey' | 'token'>) =>
  y.chain === 'lisk' &&
  y.protocolKey === 'morpho-blue' &&
  (y.token === 'USDC' || y.token === 'USDT')

export default function VaultDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { address, isConnected } = useAppKitAccount()

  // Raw slug from URL (preserve for header/icon); also build a canonical token for queries
  const vaultSlugRaw = ((params.vault as string) || '').toUpperCase()
  const vaultSlugKey = vaultSlugRaw.replace(/\./g, '')
  const vaultCanonical: 'USDC' | 'USDT' | undefined = CANONICAL[vaultSlugKey]
  const headerLabel = vaultSlugKey || 'Vault'

  const { yields, isLoading, error } = useYields()

  // Show wallet prompt if not connected
  if (!isConnected || !address) {
    return <ConnectWalletPrompt />
  }

  // Derive variants using the canonical token (so USDT0/USDCe work)
  const vaultVariants = useMemo(() => {
    if (!yields || !vaultCanonical) return []
    const filtered = yields.filter(HARD_FILTER)
    const forThisVault = filtered.filter(
      (s) => (DISPLAY_TOKEN[s.token] ?? s.token) === vaultCanonical
    )
    return forThisVault.map((s) => ({
      vault: DISPLAY_TOKEN[s.token] ?? s.token, // canonical view (USDC/USDT)
      network: 'Lisk',
      protocol: 'Morpho Blue',
      apy: (Number(s.apy) || 0).toFixed(2),
      tvl: Number.isFinite(s.tvlUSD) ? Math.round(s.tvlUSD).toLocaleString() : '0',
    }))
  }, [yields, vaultCanonical])

  const primaryVariant = vaultVariants[0] // we only have Lisk/Morpho for now

  const { data: positionsRaw } = usePositions()

  // User shares: on Morpho Lisk, the share token is 18d; map header label to underlying
  const userShares = useMemo(() => {
    const positions = (positionsRaw ?? []) as any[]
    // If user visited alias, keep it; otherwise map canonical to underlying alias
    const morphoToken =
      vaultSlugKey === 'USDT0' || vaultSlugKey === 'USDCe'
        ? vaultSlugKey
        : vaultCanonical === 'USDC'
        ? 'USDCe'
        : vaultCanonical === 'USDT'
        ? 'USDT0'
        : vaultSlugKey

    const pos = positions.find(
      (p) =>
        p?.protocol === 'Morpho Blue' &&
        String(p?.chain).toLowerCase() === 'lisk' &&
        String(p?.token) === morphoToken
    )
    return (pos?.amount ?? 0n) as bigint
  }, [positionsRaw, vaultCanonical, vaultSlugKey])

  const userSharesHuman = useMemo(() => {
    const num = Number(formatUnits(userShares, 18))
    return Number.isFinite(num) ? num : 0
  }, [userShares])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading vault…
      </div>
    )
  }

  // If the slug is unknown or we couldn't find a matching Lisk/Morpho vault for it
  if (error || !vaultCanonical || vaultVariants.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Vault Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The vault &quot;{headerLabel}&quot; does not exist.
          </p>
          <Button onClick={() => router.push('/vaults')}>Back to Markets</Button>
        </div>
      </div>
    )
  }

  // Choose the snapshot by canonical token (works for USDT0/USDCe routes)
  const snapCandidate = (yields ?? []).find(
    (s) => s.chain === 'lisk' && s.protocolKey === 'morpho-blue' && (DISPLAY_TOKEN[s.token] ?? s.token) === vaultCanonical
  )

  return (
    <div className="min-h-screen bg-[#F9FAFB] p-4 md:p-6">
      {/* Header with back button */}
      <div className="max-w-7xl mx-auto mb-6">
        <Button variant="ghost" onClick={() => router.push('/vaults')} className="mb-4">
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back to Vaults
        </Button>

        <div className="flex items-center gap-4">
          <div className="w-12 h-12 md:w-16 md:h-16 relative">
            <Image
              src={tokenIcons[headerLabel] || tokenIcons[vaultCanonical] || '/tokens/usdc-icon.png'}
              alt={headerLabel}
              width={64}
              height={64}
              className="rounded-full"
            />
          </div>
          <div>
            <h1 className="text-2xl md:text-4xl font-bold">
              {headerLabel} Vault
            </h1>
            <p className="text-sm text-muted-foreground">
              Available across {vaultVariants.length} network{vaultVariants.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Overview & Positions */}
        <div className="space-y-6">
          {/* Overview Stats */}
          <div className="bg-white rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Network card mirrors "Available Networks" styling and data */}
              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Network</p>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 relative">
                      <Image
                        src={networkIcons[primaryVariant.network] || '/networks/default.svg'}
                        alt={primaryVariant.network}
                        width={32}
                        height={32}
                        className="rounded-full"
                      />
                    </div>
                    <div>
                      <p className="font-semibold">{primaryVariant.network}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Protocol</p>
                  <p className="font-semibold">{primaryVariant.protocol}</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
              <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Total TVL</p>
                  <p className="text-2xl font-semibold">
                    $
                    {vaultVariants
                      .reduce((sum, v) => sum + Number((v.tvl || '0').toString().replace(/,/g, '')), 0)
                      .toLocaleString()}
                  </p>
                </CardContent>

              </Card>

              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
              <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">APY</p>
                  <p className="text-2xl font-semibold">
                    {(
                      vaultVariants.reduce((sum, v) => sum + Number(v.apy || 0), 0) / vaultVariants.length
                    ).toFixed(2)}%
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* My Positions */}
          <div className="bg-white rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">My Positions</h2>
            <div className="text-center py-8 text-sm">
              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-2xl font-semibold ">
                   $ {userSharesHuman.toLocaleString(undefined, { maximumFractionDigits: 2 })} 
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

         
        </div>

        {/* Right Column - Deposit/Withdraw */}
        <div className="lg:sticky lg:top-6 h-fit">
          {snapCandidate && <DepositWithdraw initialTab="deposit" snap={snapCandidate} />}
        </div>
      </div>
    </div>
  )
}
