import type { WalletClient } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses, AAVE_POOL, COMET_POOLS } from './constants'
import aaveAbi   from './abi/aavePool.json'
import cometAbi  from './abi/comet.json'

/** Minimal ERC-4626 withdraw ABI (for Morpho vaults) */
const erc4626WithdrawAbi = [
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets',   type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner',    type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

type OpBase = 'optimism' | 'base'

export async function withdrawFromPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  /** prefer protocolKey if present */
  const key = snap.protocolKey ?? (
    snap.protocol === 'Aave v3'     ? 'aave-v3' :
    snap.protocol === 'Compound v3' ? 'compound-v3' :
    snap.protocol === 'Morpho Blue' ? 'morpho-blue' :
    (snap.protocol as string)
  )

  /* ─────────────────────────── AAVE v3 (OP/Base) ─────────────────────────── */
  if (key === 'aave-v3') {
    const chain = snap.chain as OpBase
    if (chain !== 'optimism' && chain !== 'base')
      throw new Error(`Aave withdraw only on OP/Base, got ${snap.chain}`)

    // Underlying token (USDC/USDT) on that chain
    const tokenMap = TokenAddresses[snap.token as 'USDC' | 'USDT'] as
      Record<OpBase, `0x${string}`>
    const underlying = tokenMap?.[chain]
    if (!underlying)
      throw new Error(`Unsupported Aave underlying on ${chain}: ${snap.token}`)

    const poolAddr = AAVE_POOL[chain]

    return wallet.writeContract({
      address: poolAddr,
      abi: aaveAbi,
      functionName: 'withdraw',               // Pool.withdraw(underlying, amount, to)
      args: [underlying, amount, owner],
      chain: chain === 'base' ? base : optimism,
      account: owner,
    })
  }

  if (key === 'compound-v3') {
    const chain = snap.chain as OpBase
    if (chain !== 'optimism' && chain !== 'base')
      throw new Error(`Comet withdraw only on OP/Base, got ${snap.chain}`)
  
    if (snap.token !== 'USDC' && snap.token !== 'USDT')
      throw new Error(`Unsupported Comet token: ${snap.token}`)
  
    const comet = COMET_POOLS[chain][snap.token]
    if (comet === '0x0000000000000000000000000000000000000000')
      throw new Error(`Comet market not available for ${snap.token} on ${chain}`)
  
    // underlying ERC20 (USDC/USDT) for this chain
    const asset = TokenAddresses[snap.token][chain] as `0x${string}`
  
    // Option A: send to msg.sender (owner)
    return wallet.writeContract({
      address: comet,
      abi: cometAbi,
      functionName: 'withdraw',              // withdraw(address asset, uint256 amount)
      args: [asset, amount],
      chain: chain === 'base' ? base : optimism,
      account: owner,
    })
  }

  /* ───────────────────────── MORPHO BLUE (Lisk, ERC-4626) ─────────────────── */
  if (key === 'morpho-blue') {
    // Withdraw underlying assets from the vault (snap.poolAddress is the ERC-4626)
    const vault = snap.poolAddress as `0x${string}`
    if (!vault) throw new Error('Missing vault address for Morpho Blue snapshot')

    return wallet.writeContract({
      address: vault,
      abi: erc4626WithdrawAbi,
      functionName: 'withdraw',               // withdraw(assets, receiver, owner)
      args: [amount, owner, owner],
      chain: lisk,
      account: owner,
    })
  }

  throw new Error(`Unsupported protocol for direct withdraw: ${key}`)
}
