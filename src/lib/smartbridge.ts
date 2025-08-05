// lib/smartBridge.ts
import { BigNumber, ethers } from 'ethers'
import { bridgeTokens } from './bridge'          // your Hop wrapper
import { getDualBalances } from './balances'
import { TokenAddresses } from './constants'

export async function ensureLiquidity(
  symbol: keyof typeof TokenAddresses,
  amount: BigNumber,
  target: 'optimism' | 'base',
  signer: ethers.Signer,
  provOptimism: ethers.providers.Provider,
  provBase: ethers.providers.Provider,
) {
  const user = await signer.getAddress()
  const { opBal, baseBal } = await getDualBalances(
    TokenAddresses[symbol],
    user,
    provOptimism,
    provBase,
  )

  const have = target === 'optimism' ? opBal : baseBal
  if (have.gte(amount)) {
    // already enough on target chain
    return
  }

  // need to bridge missingAmount from the other chain
  const missing = amount.sub(have)
  const from = target === 'optimism' ? 'base' : 'optimism'
  await bridgeTokens(String(symbol), missing.toString(), from, target, signer)
}
