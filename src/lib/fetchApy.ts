// src/lib/fetchApy.ts

import { aaveSupplyApy, compoundSupplyApy } from '@/lib/positions'
import { COMET_POOLS, TokenAddresses } from '@/lib/constants'

export async function fetchApy(p: {
  protocol: 'Aave v3' | 'Compound v3'
  chain:    'optimism' | 'base'
  token:    keyof typeof TokenAddresses // 'USDC' | 'USDT' | 'USDCe' | ...
}): Promise<number> {
  if (p.protocol === 'Aave v3') {
    // Only USDC and USDT are valid here
    if (p.token === 'USDC' || p.token === 'USDT') {
      const tokenMap = TokenAddresses[p.token] as Record<
        'optimism' | 'base',
        `0x${string}`
      >
      const asset = tokenMap[p.chain]
      return await aaveSupplyApy(asset, p.chain) ?? 0
    }
    // unsupported token on Aave → 0
    return 0
  } else {
    // Compound v3 (Comet) also only supports USDC/USDT
    if (p.token === 'USDC' || p.token === 'USDT') {
      const poolAddr = COMET_POOLS[p.chain][p.token]
      return await compoundSupplyApy(poolAddr, p.chain)
    }
    return 0
  }
}
