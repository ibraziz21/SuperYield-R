import { WalletClient } from 'viem'
import { optimism, base } from 'viem/chains'
import { TokenAddresses, AAVE_POOL, COMET_POOLS, type TokenSymbol } from './constants'
import { erc20Abi }  from 'viem'
import aaveAbi  from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
import { publicOptimism, publicBase } from './clients'
import type { YieldSnapshot } from '@/hooks/useYields'

/* helper */
function pub(chain: 'optimism' | 'base') {
  return chain === 'optimism' ? publicOptimism : publicBase
}
async function ensureAllowance(
  token: `0x${string}`,
  spender: `0x${string}`,
  amt: bigint,
  wallet: WalletClient,
  chain: 'optimism' | 'base',
) {
  const owner = wallet.account
  if (owner == undefined)return;
  const allowance = await pub(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner.address, spender],
  }) as bigint

  if (allowance >= amt) return
  await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amt],
    chain: chain === 'optimism' ? optimism : base,
    account: owner.address,
  })
}

/* -------- main -------- */
export async function depositToPool(
  snap: YieldSnapshot,
  amount: bigint,
  wallet: WalletClient,
) {
  const chain  = snap.chain as 'optimism' | 'base'
  const token  = snap.token as TokenSymbol    // 'USDC' | 'USDT'
  const owner = wallet.account
  if (owner == undefined)return;
  const tokenAddr = TokenAddresses[token][chain]

  /* pick the **real** supply contract from constants */
  let poolAddr: `0x${string}`



  if (snap.protocolKey === 'aave-v3') {
    poolAddr = AAVE_POOL[chain]
    await ensureAllowance(tokenAddr, poolAddr, amount, wallet, chain)

    console.log(poolAddr, tokenAddr, )

    await wallet.writeContract({
      address: poolAddr,
      abi: aaveAbi,
      functionName: 'supply',
      args: [tokenAddr, amount, owner.address, 0],
      chain: chain === 'optimism' ? optimism : base,
      account: owner.address,
    })
    return
  }

  if (snap.protocolKey === 'compound-v3') {
    poolAddr = COMET_POOLS[chain][token]
    await ensureAllowance(tokenAddr, poolAddr, amount, wallet, chain)

    await wallet.writeContract({
      address: poolAddr,
      abi: cometAbi,
      functionName: 'supply',
      args: [tokenAddr, amount],
      chain: chain === 'optimism' ? optimism : base,
      account: owner.address,
    })
    return
  }

  throw new Error(`Unsupported protocol ${snap.protocolKey}`)
}
