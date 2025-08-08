import {client} from './across'
import { configurePublicClients,ConfiguredWalletClient } from '@across-protocol/app-sdk'

import {  WalletClient } from 'viem'
import { TokenAddresses } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import { optimism, base, lisk } from 'viem/chains'


// Initialize Across public clients for all chains
const configuredPublicClients = configurePublicClients(
  [optimism, base, lisk],
  1000,    // optional polling interval in milliseconds
  {},      // optional RPC URL overrides
  {}       // optional transport overrides
)


function getTokenAddress(
  token: TokenSymbol,
  chain: ChainId
): `0x${string}` {
  const tokenMap = TokenAddresses[token]
  const address = (tokenMap as Partial<Record<ChainId, string>>)[chain]

  if (!address) {
    throw new Error(`Token ${token} not supported on ${chain}`)
  }

  return address as `0x${string}`
}

export async function bridgeTokens(
token: TokenSymbol,
amount: bigint,
from: 'optimism' | 'base' | 'lisk',
to: 'optimism' | 'base' | 'lisk',
walletClient: WalletClient,
) {

const originChainId =
  from === 'optimism' ? optimism.id : from === 'base' ? base.id : lisk.id
const destinationChainId =
  to === 'optimism' ? optimism.id : to === 'base' ? base.id : lisk.id
  if (!walletClient.account) {
    throw new Error('No account found on WalletClient – user must connect first')
  }

  // 2️⃣ Cast for the SDK
const cfgWalletClient = walletClient as unknown as ConfiguredWalletClient
  // Resolve token addresses
  const inputToken  = getTokenAddress(token, from)
  const outputToken = getTokenAddress(token, to)

  // Retrieve configured public clients
  const originClient      = configuredPublicClients.get(originChainId)
  const destinationClient = configuredPublicClients.get(destinationChainId)

  // Wrap the viem wallet client for Across
 



  
  const fees = await client.getSuggestedFees({
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
    amount: amount,  // this is your bigint in wei (e.g. parseUnits('0.07937', 18))
  })

  console.log("fees: ", fees)
const quote = await client.getQuote({
  route:{
  originChainId: originChainId,
  destinationChainId: destinationChainId,
  inputToken,
  outputToken,
  },
  inputAmount: amount,
})

console.log("Quote: ",quote)



// wrap once
  // get previously configured public clients

const tx = await client.executeQuote({
  deposit: quote.deposit,
  walletClient: cfgWalletClient,
  originClient: originClient,
  destinationClient: destinationClient,
  infiniteApproval: true,
  onProgress: (progress) => {
    console.log(`[Across] Step: ${progress.step}, Status: ${progress.status}`)
    if (progress.step === 'approve' && progress.status === 'txSuccess') {
      console.log('✅ Approved:', progress.txReceipt)
    }
    if (progress.step === 'deposit' && progress.status === 'txSuccess') {
      console.log('✅ Deposit submitted. ID:', progress.depositId)
    }
    if (progress.step === 'fill' && progress.status === 'txSuccess') {
      console.log('✅ Funds received on destination:', progress.txReceipt)
    }
  }
})

return tx
}