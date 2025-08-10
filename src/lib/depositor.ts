// src/lib/depositor.ts
import { WalletClient } from 'viem'
// at top
import { erc20Abi, maxUint256 } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import { ROUTERS, TokenAddresses, type TokenSymbol } from './constants'
import aggregatorRouterAbi from './abi/AggregatorRouter.json'
import { publicOptimism, publicBase, publicLisk } from './clients'
import type { YieldSnapshot } from '@/hooks/useYields'
import { adapterKeyForSnapshot } from './adaptors'

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
    functionName: 'adapters', // adjust if your getter differs
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

async function ensureAllowanceForRouter(
  token: `0x${string}`,
  router: `0x${string}`,
  amount: bigint,
  wallet: WalletClient,
  chain: ChainId,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const current = await readAllowance(token, owner, router, chain)
  // If we already have enough allowance for this call, do nothing.
  if (current >= amount) return

  // USDT quirk: must set to 0 before changing a non-zero allowance
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

  // Approve infinite
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

function resolveAssetForSnapshot(
  snap: YieldSnapshot,
  chain: ChainId,
): `0x${string}` {
  if (snap.protocolKey === 'morpho-blue') {
    // Lisk: USDC -> USDCe, USDT -> USDT0
    const morphoToken =
      snap.token === 'USDC' ? 'USDCe' :
      snap.token === 'USDT' ? 'USDT0' :
      snap.token              // WETH passthrough
    return (TokenAddresses as any)[morphoToken].lisk as `0x${string}`
  }
  // Aave/Comet on OP/Base
  const tokenMap = TokenAddresses[
    snap.token as Extract<TokenSymbol, 'USDC' | 'USDT'>
  ] as Record<'optimism' | 'base', `0x${string}`>
  return tokenMap[chain as 'optimism' | 'base']
}

/** Router.deposit(adapterKey, asset, amount, onBehalfOf, data) */
export async function depositToPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const chain: ChainId = snap.protocolKey === 'morpho-blue' ? 'lisk' : (snap.chain as ChainId)
  const router = ROUTERS[chain]
  if (!router || router.toLowerCase() === ZERO_ADDR) throw new Error(`Router missing for ${chain}`)

  const key = adapterKeyForSnapshot(snap)
  const adapter = await getAdapterAddress(chain, key)
  if (!adapter || adapter.toLowerCase() === ZERO_ADDR)
    throw new Error(`Adapter not registered for key on ${chain}: ${key}`)

  const asset = resolveAssetForSnapshot(snap, chain)

  // helpful preflight logs
  const [allowToRouter, allowToAdapter] = await Promise.all([
    readAllowance(asset, owner, router, chain),
    readAllowance(asset, owner, adapter, chain),
  ])
  console.log(`[deposit] chain=${chain} asset=${asset}
  key=${key}
  allowance → router:  ${allowToRouter}
  allowance → adapter: ${allowToAdapter}`)

  // ✅ Approve the ROUTER as spender (router does transferFrom)
  await ensureAllowanceForRouter(asset, router, amount, wallet, chain)

  // ▶️ Call router.deposit
  const tx = await wallet.writeContract({
    address: router,
    abi: aggregatorRouterAbi as any,
    functionName: 'deposit',
    args: [key, asset, amount, owner, '0x'],
    chain: chainObj(chain),
    account: owner,
  })
  await waitReceipt(chain, tx)
}
