// src/lib/fetchApy.ts
import { aaveSupplyApy, compoundSupplyApy }     from '@/lib/positions'
import { COMET_POOLS, TokenAddresses } from '@/lib/constants'

export async function fetchApy(p: {
  protocol: 'Aave v3' | 'Compound v3'
  chain:    'optimism' | 'base'
  token:    keyof typeof TokenAddresses // USDC, USDT …
}) {
  if (p.protocol === 'Aave v3') {
    const asset = TokenAddresses[p.token][p.chain]
    return asset ? aaveSupplyApy(asset, p.chain) : 0
  } else {
    const comet = COMET_POOLS[p.chain][p.token]
    return comet ? compoundSupplyApy(comet, p.chain) : 0
  }
}
