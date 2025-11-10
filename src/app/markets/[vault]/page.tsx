'use client'

import { useParams, useRouter } from 'next/navigation'
import { vaultsData } from '@/lib/vaultsData'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Card, CardContent } from '@/components/ui/Card'
import { DepositWithdraw } from '@/components/deposit/deposit-withdraw'

// Token icon mapping
const tokenIcons: Record<string, string> = {
  USDC: "/tokens/usdc-icon.png",
  USDT: "/tokens/usdt-icon.png",
  USDT0: "/tokens/usdt0-icon.png",
  WETH: "/tokens/weth.png",
  DAI: "/tokens/dai.png",
};

// Network icon mapping
const networkIcons: Record<string, string> = {
  Ethereum: "/networks/ethereum.png",
  Lisk: "/networks/lisk.png",
  Arbitrum: "/networks/arbitrum.png",
  Optimism: "/networks/op-icon.png",
  Base: "/networks/base.png",
};

// Protocol icon mapping
const protocolIcons: Record<string, string> = {
  "Aave V3": "/protocols/aave.png",
  "Morpho Blue": "/protocols/morpho-icon.png",
  Compound: "/protocols/compound.png",
  Yearn: "/protocols/yearn.png",
  Merkle: "/protocols/merkle.png",
};

export default function VaultDetailPage() {
  const params = useParams()
  const router = useRouter()
  const vaultName = params.vault as string

  // Filter all vaults matching this vault name
  const vaultVariants = vaultsData.filter(v => v.vault === vaultName)

  if (vaultVariants.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Vault Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The vault "{vaultName}" does not exist.
          </p>
          <Button onClick={() => router.push('/markets')}>
            Back to Markets
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] p-4 md:p-6">
      {/* Header with back button */}
      <div className="max-w-7xl mx-auto mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push('/markets')}
          className="mb-4"
        >
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back to Vaults
        </Button>

        <div className="flex items-center gap-4">
          <div className="w-12 h-12 md:w-16 md:h-16 relative">
            <Image
              src={tokenIcons[vaultName] || "/tokens/default.svg"}
              alt={vaultName}
              width={64}
              height={64}
              className="rounded-full"
            />
          </div>
          <div>
            <h1 className="text-2xl md:text-4xl font-bold">{vaultName} Vault</h1>
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
              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Total TVL</p>
                  <p className="text-2xl font-semibold">${vaultVariants.reduce((sum, v) => sum + parseFloat(v.tvl.replace(/,/g, '')), 0).toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Average APY</p>
                  <p className="text-2xl font-semibold">{(vaultVariants.reduce((sum, v) => sum + parseFloat(v.apy), 0) / vaultVariants.length).toFixed(2)}%</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Networks</p>
                  <p className="text-2xl font-semibold">{vaultVariants.length}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                <CardContent className="space-y-1 p-4">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Your Balance</p>
                  <p className="text-2xl font-semibold">$0.00</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* My Positions */}
          <div className="bg-white rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">My Positions</h2>
            <div className="text-center py-8 text-muted-foreground text-sm">
              No positions yet. Deposit to start earning.
            </div>
          </div>

          {/* Network Variants */}
          <div className="bg-white rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Available Networks</h2>
            <div className="space-y-3">
              {vaultVariants.map((vault, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 relative">
                      <Image
                        src={networkIcons[vault.network] || "/networks/default.svg"}
                        alt={vault.network}
                        width={32}
                        height={32}
                        className="rounded-full"
                      />
                    </div>
                    <div>
                      <p className="font-semibold">{vault.network}</p>
                      <p className="text-xs text-muted-foreground">{vault.protocol}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-blue-600">{vault.apy}% APY</p>
                    <p className="text-xs text-muted-foreground">${vault.tvl} TVL</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Deposit/Withdraw */}
        <div className="lg:sticky lg:top-6 h-fit">
          <DepositWithdraw initialTab="deposit" />
        </div>
      </div>
    </div>
  )
}
