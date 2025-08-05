import { Hop, TChain } from '@hop-protocol/sdk'
import type { Signer } from 'ethers'

const hop = new Hop('mainnet')

/**
 * Bridge via Hop Protocol
 * @param token   Symbol e.g. 'USDC','USDT','USDC.e','USDT.e'
 * @param amount  Raw smallest-unit string, e.g. '1000000' for 1 USDC
 * @param from    'optimism' | 'base'
 * @param to      'optimism' | 'base'
 * @param signer  ethers.Signer
 */
export async function bridgeTokens(
  token: string,
  amount: string,
  from: 'optimism' | 'base',
  to: 'optimism' | 'base',
  signer: Signer,
) {
  const bridge = hop.connect(signer).bridge(token)
  const recipient = await signer.getAddress()
  

  const tx = await bridge.send( amount, from, recipient )
  return tx.wait()
}