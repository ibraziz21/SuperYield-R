// src/lib/bridge.ts

import { client } from './across'
import {
  configurePublicClients,
  type ConfiguredWalletClient,
} from '@across-protocol/app-sdk'

import type { WalletClient } from 'viem'
import { TokenAddresses } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import { optimism, base, lisk } from 'viem/chains'

/* ────────────────────────────────────────────────────────────────
   Across public clients (created once)
   ──────────────────────────────────────────────────────────────── */

const configuredPublicClients = configurePublicClients(
  [optimism, base, lisk],
  1000, // polling ms
  {},   // optional RPC URL overrides
  {},   // optional transport overrides
)

/* ────────────────────────────────────────────────────────────────
   Chain helpers
   ──────────────────────────────────────────────────────────────── */

const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  base: base.id,
  lisk: lisk.id,
}

/** Map a UI token symbol to the actual token symbol present on a specific chain.
 *  - On Lisk, `USDC` → `USDCe`, `USDT` → `USDT0`
 *  - `WETH` stays `WETH`
 *  - On OP/Base, only `USDC` & `USDT` are valid per your constants.
 */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC') return 'USDCe'
    if (token === 'USDT') return 'USDT0'
    return token // WETH / already USDCe/USDT0
  }
  // optimism/base
  if (token === 'USDCe') return 'USDC'
  if (token === 'USDT0') return 'USDT'
  return token
}

/** Resolve a checksummed token address for (token, chain).
 *  Throws a descriptive error if not supported on that chain.
 */
function tokenAddress(token: TokenSymbol, chain: ChainId): `0x${string}` {
  const sym = resolveSymbolForChain(token, chain)
  const map = TokenAddresses[sym] as Partial<Record<ChainId, string>>
  const addr = map?.[chain]
  if (!addr) {
    throw new Error(`Token ${sym} not supported on ${chain}`)
  }
  return addr as `0x${string}`
}

/* ────────────────────────────────────────────────────────────────
   Bridge
   ──────────────────────────────────────────────────────────────── */

/**
 * Bridge `token` for the user using Across, from -> to.
 * - `token` is your UI symbol (USDC, USDT, WETH, USDCe, USDT0)
 * - This function will automatically map to USDCe/USDT0 on Lisk for
 *   both quoting and execution.
 */
export async function bridgeTokens(
  token: TokenSymbol,
  amount: bigint,
  from: ChainId,
  to: ChainId,
  walletClient: WalletClient,
) {
  if (!walletClient.account) {
    throw new Error('No account found on WalletClient – connect a wallet first')
  }

  const originChainId      = CHAIN_ID[from]
  const destinationChainId = CHAIN_ID[to]

  // Resolve correct per-chain token addresses (handles Lisk aliasing)
  const inputToken  = tokenAddress(token, from)
  const outputToken = tokenAddress(token, to)

  // Grab Across-configured public clients for both chains
  const originClient      = configuredPublicClients.get(originChainId)
  const destinationClient = configuredPublicClients.get(destinationChainId)
  if (!originClient || !destinationClient) {
    throw new Error(
      `Across public clients not configured for ${from}(${originChainId}) or ${to}(${destinationChainId})`
    )
  }

  // Across expects a "ConfiguredWalletClient" (a thin wrapper around viem WalletClient)
  const cfgWalletClient = walletClient as unknown as ConfiguredWalletClient

  // (Optional) Fees preview — useful for logs/telemetry
  const fees = await client.getSuggestedFees({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    amount,
  })
  console.debug('[Across] suggested fees:', fees)

  // Get a route/quote for the given amount & tokens
  const quote = await client.getQuote({
    route: {
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
    },
    inputAmount: amount,
  })
  console.debug('[Across] quote:', quote)

  // Execute the quote (approval + deposit + fill tracking)
  const tx = await client.executeQuote({
    deposit: quote.deposit,
    walletClient: cfgWalletClient,
    originClient,
    destinationClient,
    infiniteApproval: true,
    onProgress: (progress) => {
      console.log(`[Across] step=${progress.step} status=${progress.status}`)
      if (progress.step === 'approve' && progress.status === 'txSuccess') {
        console.log('✅ Approved:', progress.txReceipt)
      }
      if (progress.step === 'deposit' && progress.status === 'txSuccess') {
        console.log('✅ Deposit submitted. ID:', progress.depositId)
      }
      if (progress.step === 'fill' && progress.status === 'txSuccess') {
        console.log('✅ Funds received on destination:', progress.txReceipt)
      }
    },
  })

  return tx
}
