// src/lib/depositor.ts
// Morpho-only app: user-initiated Lisk deposits are executed by the relayer.
// We keep allowance helpers (useful for OP/Base funding flows), but block direct Lisk deposits.

import type { WalletClient } from 'viem'
import { erc20Abi, maxUint256 } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import { ROUTERS, TokenAddresses } from './constants'
import aggregatorRouterAbi from './abi/AggregatorRouter.json'
import { publicOptimism, publicBase, publicLisk } from './clients'
import type { YieldSnapshot } from '@/hooks/useYields'
import { adapterKeyForSnapshot } from './adapters'

type ChainId = 'optimism' | 'base' | 'lisk'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

function pub(chain: ChainId) {
  return chain === 'optimism' ? publicOptimism : chain === 'base' ? publicBase : publicLisk
}
function chainObj(chain: ChainId) {
  return chain === 'optimism' ? optimism : chain === 'base' ? base : lisk
}
function isUSDT(addr: `0x${string}`) {
  const a = addr.toLowerCase()
  return (
    a === '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'.toLowerCase() || // OP USDT
    a === '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'.toLowerCase()    // Base USDT
  )
}
async function waitReceipt(chain: ChainId, hash: `0x${string}`) {
  await pub(chain).waitForTransactionReceipt({ hash })
}

async function getAdapterAddress(
  chain: ChainId,
  key: `0x${string}`,
): Promise<`0x${string}`> {
  const router = ROUTERS[chain]
  const addr = await pub(chain).readContract({
    address: router,
    abi: aggregatorRouterAbi as any,
    functionName: 'adapters',
    args: [key],
  }) as `0x${string}`
  return addr
}

async function readAllowance(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
  chain: ChainId,
) {
  return (await pub(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint
}

export async function ensureAllowanceForRouter(
  token: `0x${string}`,
  router: `0x${string}`,
  amount: bigint,
  wallet: WalletClient,
  chain: ChainId,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const current = await readAllowance(token, owner, router, chain)
  if (current >= amount) return

  // USDT quirk: reset to 0 first if non-zero
  if (current > BigInt(0) && isUSDT(token)) {
    const resetHash = await wallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [router, BigInt(0)],
      chain: chainObj(chain),
      account: owner,
    })
    await waitReceipt(chain, resetHash)
  }

  const approveHash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [router, maxUint256],
    chain: chainObj(chain),
    account: owner,
  })
  await waitReceipt(chain, approveHash)
}

/**
 * Resolve the on-chain asset given a Morpho snapshot.
 * For Morpho (Lisk): map display tokens to the actual Lisk asset addresses.
 */
export function resolveAssetForSnapshot(
  snap: YieldSnapshot,
  chain: ChainId,
): `0x${string}` {
  if (snap.protocolKey === 'morpho-blue') {
    // Lisk: USDC -> USDCe, USDT -> USDT0 (WETH is the same)
    const morphoToken =
      snap.token === 'USDC' ? 'USDCe' :
      snap.token === 'USDT' ? 'USDT0' :
      snap.token
    return (TokenAddresses as any)[morphoToken].lisk as `0x${string}`
  }

  // No other protocols supported in morpho-only build.
  throw new Error('Unsupported protocol in resolveAssetForSnapshot')
}

/** Router.deposit(adapterKey, asset, amount, onBehalfOf, data)
 *  NOTE: Morpho (Lisk) deposits are executed server-side by the relayer.
 */
export async function depositToPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  if (snap.protocolKey === 'morpho-blue') {
    throw new Error('Lisk deposits are executed by the relayer; no user action on Lisk required.')
  }

  // If you ever re-enable non-Lisk user deposits, the code below remains a reference.
  const chain: ChainId = snap.chain as ChainId
  const router = ROUTERS[chain]
  if (!router || router.toLowerCase() === ZERO_ADDR) throw new Error(`Router missing for ${chain}`)

  const key = adapterKeyForSnapshot(snap)
  const adapter = await getAdapterAddress(chain, key)
  if (!adapter || adapter.toLowerCase() === ZERO_ADDR)
    throw new Error(`Adapter not registered for key on ${chain}: ${key}`)

  const asset = resolveAssetForSnapshot(snap, chain)

  // approve router (router does transferFrom)
  await ensureAllowanceForRouter(asset, router, amount, wallet, chain)

  // simulate then write (kept for completeness)
  const { request } = await pub(chain).simulateContract({
    address: router,
    abi: aggregatorRouterAbi as any,
    functionName: 'deposit',
    args: [key, asset, amount, owner, '0x'],
    account: owner,
  })

  const tx = await wallet.writeContract(request)
  await waitReceipt(chain, tx)
}
