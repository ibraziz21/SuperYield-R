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
export const configuredPublicClients = configurePublicClients(
  [optimism, base, lisk],
  1000, // polling ms
  {},
  {},
)

/* ────────────────────────────────────────────────────────────────
   Chain helpers
   ──────────────────────────────────────────────────────────────── */
const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  base: base.id,
  lisk: lisk.id,
}

/** Map UI symbol to symbol that actually exists on a given chain. */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC') return 'USDCe'
    if (token === 'USDT') return 'USDT'
    return token // USDCe/USDT0/WETH pass through
  }
  // OP/Base cannot have USDCe/USDT0
  if (token === 'USDCe') return 'USDC'
  if (token === 'USDT0') return 'USDT'
  return token
}

/** Address for (token, chain). Throws if unsupported. */
function tokenAddress(token: TokenSymbol, chain: ChainId): `0x${string}` {
  const sym = resolveSymbolForChain(token, chain)
  const map = TokenAddresses[sym] as Partial<Record<ChainId, string>>
  const addr = map?.[chain]
  if (!addr) throw new Error(`Token ${sym} not supported on ${chain}`)
  return addr as `0x${string}`
}

/* ────────────────────────────────────────────────────────────────
   Bridge
   ──────────────────────────────────────────────────────────────── */

/**
 * Bridge `token` from -> to (token is a UI/canonical symbol).
 * - For Lisk:
 *    - USDC paths resolve to USDCe on Lisk
 *    - USDT paths resolve to USDT on Lisk (not USDT0)
 */
export async function bridgeTokens(
  token: TokenSymbol,
  amount: bigint,
  from: ChainId,
  to: ChainId,
  walletClient: WalletClient,
) {
  if (!walletClient.account) throw new Error('No account found on WalletClient – connect a wallet first')

  const originChainId      = CHAIN_ID[from]
  const destinationChainId = CHAIN_ID[to]

  const inputToken  = tokenAddress(token, from)
  const outputToken = tokenAddress(token, to)

  const originClient      = configuredPublicClients.get(originChainId)
  const destinationClient = configuredPublicClients.get(destinationChainId)
  if (!originClient || !destinationClient) {
    throw new Error(`Across public clients not configured for ${from}(${originChainId}) or ${to}(${destinationChainId})`)
  }

  const cfgWalletClient = walletClient as unknown as ConfiguredWalletClient

  const fees = await client.getSuggestedFees({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    amount,
  })
  console.debug('[Across] suggested fees:', fees)

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
