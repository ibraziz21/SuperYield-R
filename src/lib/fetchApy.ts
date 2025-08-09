// src/lib/fetchApy.ts
import { aaveSupplyApy, compoundSupplyApy } from '@/lib/positions'
import { COMET_POOLS, TokenAddresses } from '@/lib/constants'

type Chain = 'optimism' | 'base'
type Protocol = 'Aave v3' | 'Compound v3'
type TokenSymbol = keyof typeof TokenAddresses // 'USDC' | 'USDT' | 'USDCe' | 'USDT0' | 'WETH'

type CometToken = 'USDC' | 'USDT'
const isCometToken = (t: TokenSymbol): t is CometToken => t === 'USDC' || t === 'USDT'

/**
 * Fetches APY for a position spec. Safely narrows token types so we never
 * index COMET_POOLS with a non-existent key (USDCe, USDT0, WETH).
 */
export async function fetchApy(p: {
  protocol: Protocol
  chain: Chain
  token: TokenSymbol
}): Promise<number> {
  if (p.protocol === 'Aave v3') {
    // TokenAddresses has per-chain maps only for tokens that exist on that chain.
    const tokenMap = TokenAddresses[p.token] as Partial<Record<Chain, `0x${string}`>>
    const asset = tokenMap[p.chain]
    if (!asset) return 0
    return (await aaveSupplyApy(asset, p.chain)) ?? 0
  }

  // Compound v3 pools exist only for USDC/USDT
  if (!isCometToken(p.token)) return 0
  const comet = COMET_POOLS[p.chain][p.token]
  if (!comet || comet === '0x0000000000000000000000000000000000000000') return 0
  return await compoundSupplyApy(comet, p.chain)
}
