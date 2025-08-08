// src/hooks/useApy.ts

import { aaveSupplyApy, compoundSupplyApy } from '@/lib/positions'
import { useQuery, UseQueryResult } from '@tanstack/react-query'

export function useApy(
  protocol: 'Aave v3' | 'Compound v3',
  opts: {
    chain: 'optimism' | 'base'
    asset?: `0x${string}`   // for Aave
    comet?: `0x${string}`   // for Compound
  }
): UseQueryResult<number | null, Error> {
  return useQuery<number | null, Error>({
    queryKey: ['apy', protocol, opts.chain, opts.asset ?? opts.comet],
    enabled:  protocol === 'Aave v3' ? !!opts.asset : !!opts.comet,
    queryFn: async () => {
      // aaveSupplyApy returns Promise<number | null>
      if (protocol === 'Aave v3') {
        return await aaveSupplyApy(opts.asset!, opts.chain)
      } else {
        // compoundSupplyApy returns Promise<number>
        return await compoundSupplyApy(opts.comet!, opts.chain)
      }
    },
    staleTime: 60_000, // 1 minute
  })
}
