import { Hop } from '@hop-protocol/sdk'
import { ethers } from 'ethers'
import { erc20Abi, WalletClient } from 'viem'
import { TokenAddresses } from './constants'
import type { TokenSymbol } from './constants'

const hop = new Hop('mainnet')

export async function bridgeTokens(
  token: TokenSymbol,
  amount: bigint,
  from: 'optimism' | 'base',
  to: 'optimism' | 'base',
  walletClient: WalletClient,
) {
  const signer = new ethers.providers.Web3Provider(
    walletClient.transport as any,
  ).getSigner()

  const bridge = hop.connect(signer).bridge(token)
  const spender     =  bridge.getSendApprovalAddress(from)
  const userAddress = signer.getAddress()
  const tokenAddr : `0x${string}` = TokenAddresses[token][from] 

  /* 2️⃣  check / ensure allowance */
  const erc20 = new ethers.Contract(tokenAddr, erc20Abi, signer)
  const currentAllowance: bigint = await erc20
    .allowance(userAddress, spender)
    .then((x: ethers.BigNumber) => BigInt(x.toString()))

  if (currentAllowance < amount) {
    const approveTx = await erc20.approve(spender, amount.toString())
    await approveTx.wait()

  const tx = await bridge.send(amount.toString(), from, to)
  return tx.wait()
}
}
