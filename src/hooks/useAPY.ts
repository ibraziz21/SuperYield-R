// src/hooks/useApy.ts

import { aaveSupplyApy, compoundSupplyApy } from '@/lib/positions'
import { useQuery, UseQueryResult } from '@tanstack/react-query'

/**
 * APY hook for Aave v3 / Compound v3 only.
 * (Morpho Blue is handled via useYields() in usePortfolioApy and in UIs.)
 */
export function useApy(
  protocol: 'Aave v3' | 'Compound v3',
  opts: {
    chain: 'optimism' 
    asset?: `0x${string}`   // for Aave
    comet?: `0x${string}`   // for Compound
  }
): UseQueryResult<number | null, Error> {
  return useQuery<number | null, Error>({
    queryKey: ['apy', protocol, opts.chain, opts.asset ?? opts.comet],
    enabled:  protocol === 'Aave v3' ? !!opts.asset : !!opts.comet,
    queryFn: async () => {
      if (protocol === 'Aave v3') {
        return await aaveSupplyApy(opts.asset!, opts.chain)   // Promise<number | null>
      } else {
        return await compoundSupplyApy(opts.comet!, opts.chain) // Promise<number>
      }
    },
    staleTime: 60_000, // 1 minute
  })
}
