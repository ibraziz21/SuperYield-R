// src/lib/withdraw.ts
import { WalletClient } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import { ROUTERS } from './constants'
import aggregatorRouterAbi from './abi/AggregatorRouter.json'
import type { YieldSnapshot } from '@/hooks/useYields'
import { adapterKeyForSnapshot } from './adaptors'

export async function withdrawFromPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const adapterKey = adapterKeyForSnapshot(snap)
  const chain = (snap.protocolKey === 'morpho-blue' ? 'lisk' : snap.chain) as 'optimism'|'base'|'lisk'
  const router = ROUTERS[chain]

  await wallet.writeContract({
    address: router,
    abi: aggregatorRouterAbi as any,
    functionName: 'withdraw',
    args: [adapterKey, amount, owner, '0x'],
    chain: chain === 'optimism' ? optimism : chain === 'base' ? base : lisk,
    account: owner,
  })
}
