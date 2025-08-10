// src/lib/adapters.ts
import type { YieldSnapshot } from '@/hooks/useYields'
import { ADAPTER_KEYS, type AdapterKey } from './constants'

/** Map YieldSnapshot to the adapter key your router expects. */
export function adapterKeyForSnapshot(s: YieldSnapshot): AdapterKey {
  if (s.protocolKey === 'aave-v3') {
    if (s.chain === 'optimism') return ADAPTER_KEYS.aaveOptimism
    if (s.chain === 'base')     return ADAPTER_KEYS.aaveBase
    throw new Error(`Aave not supported on chain ${s.chain}`)
  }

  if (s.protocolKey === 'compound-v3') {
    if (s.chain === 'optimism') {
      if (s.token === 'USDC') return ADAPTER_KEYS.cometOpUSDC
      if (s.token === 'USDT') return ADAPTER_KEYS.cometOpUSDT
      throw new Error(`Compound(optimism) token not supported: ${s.token}`)
    }
    if (s.chain === 'base') {
      if (s.token === 'USDC') return ADAPTER_KEYS.cometBaseUSDC
      throw new Error(`Compound(base) token not supported: ${s.token}`)
    }
    throw new Error(`Compound not supported on chain ${s.chain}`)
  }

  if (s.protocolKey === 'morpho-blue') {
    if (s.chain !== 'lisk') throw new Error('Morpho Blue is only on Lisk')
    // Snapshots use base labels (USDC/USDT/WETH), but Lisk adapters want USDCe/USDT0/WETH.
    if (s.token === 'USDC') return ADAPTER_KEYS.morphoLiskUSDCe
    if (s.token === 'USDT') return ADAPTER_KEYS.morphoLiskUSDT0
    if (s.token === 'WETH') return ADAPTER_KEYS.morphoLiskWETH
    throw new Error(`Morpho(Lisk) token not supported: ${s.token}`)
  }

  throw new Error(`Unsupported protocolKey ${s.protocolKey}`)
}
