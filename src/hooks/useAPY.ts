/* src/hooks/useApy.ts ------------------------------------------------ */
import { aaveSupplyApy, compoundSupplyApy } from '@/lib/positions'
import { useQuery } from '@tanstack/react-query'

export function useApy(protocol: 'Aave v3' | 'Compound v3', opts: {
  chain:  'optimism' | 'base'
  asset?: `0x${string}`   // Aave
  comet?: `0x${string}`   // Compound
}) {

  return useQuery<number>({
    queryKey: ['apy', protocol, opts.chain, opts.asset ?? opts.comet],
    enabled:  protocol === 'Aave v3' ? !!opts.asset : !!opts.comet,
    queryFn:  () =>
      protocol === 'Aave v3'
        ? aaveSupplyApy(opts.asset!, opts.chain)
        : compoundSupplyApy(opts.comet!, opts.chain),
    staleTime: 60_000,         // refresh every minute
  })
}
