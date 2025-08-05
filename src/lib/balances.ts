// lib/balances.ts
import { ethers } from 'ethers'
import { optimism, base } from '@reown/appkit/networks'

export async function getBalance(
  token: string,
  user: string,
  chain: 'optimism' | 'base',
  provider: ethers.providers.Provider
) {
  // native ETH balance? -> provider.getBalance()
  // otherwise call ERC20 balanceOf
  const erc20 = new ethers.Contract(token, ['function balanceOf(address)(uint256)'], provider)
  const bal   = await erc20.balanceOf(user)
  return bal   // BigNumber (v5) or bigint (v6)
}

export async function getDualBalances(
  tokenAddr: { optimism: string; base: string },
  user: string,
  provOptimism: ethers.providers.Provider,
  provBase: ethers.providers.Provider,
) {
  const [opBal, baseBal] = await Promise.all([
    getBalance(tokenAddr.optimism, user, 'optimism', provOptimism),
    getBalance(tokenAddr.base,     user, 'base',     provBase),
  ])
  return { opBal, baseBal }
}
