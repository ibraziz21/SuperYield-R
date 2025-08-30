// src/lib/bridge.ts
'use client'

import {
  createConfig,
  EVM,
  getQuote,
  convertQuoteToRoute,
  executeRoute
} from '@lifi/sdk'
import type { WalletClient } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import { TokenAddresses } from './constants'
import type { ChainId, TokenSymbol } from './constants'

/* ────────────────────────────────────────────────────────────────
   Chain + symbol helpers
   ──────────────────────────────────────────────────────────────── */
const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  base: base.id,
  lisk: lisk.id,
}

/** Map UI symbol to the *actual* representation on a chain. */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC')  return 'USDCe'
    // Lisk has both USDT and USDT0; keep as provided
    return token
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

const toHexChain = (id: number) => `0x${id.toString(16)}`

/* ────────────────────────────────────────────────────────────────
   LI.FI provider wiring (idempotent)
   ──────────────────────────────────────────────────────────────── */
let _configured = false
let _activeWallet: WalletClient | null = null

export function configureLifiWith(walletClient: WalletClient) {
  _activeWallet = walletClient
  if (_configured) return
  createConfig({
    integrator: 'superyldr',
    providers: [
      EVM({
        getWalletClient: async () => {
          if (!_activeWallet) throw new Error('Wallet not set for LI.FI')
          return _activeWallet
        },
        switchChain: async (chainId) => {
          if (!_activeWallet) throw new Error('Wallet not set for LI.FI')
          await _activeWallet.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: toHexChain(chainId) }],
          })
          return _activeWallet
        },
      }),
    ],
  })
  _configured = true
}

/* ────────────────────────────────────────────────────────────────
   Public API: bridgeTokens
   ──────────────────────────────────────────────────────────────── */

/**
 * Bridge in one shot (bridge+swap if needed).
 * Examples:
 *   - USDT (OP/Base) -> USDT0 (Lisk)   ✅
 *   - USDC (OP/Base) -> USDCe (Lisk)   ✅
 *   - USDT/USDC between OP/Base        ✅ (single-asset)
 */
export async function bridgeTokens(
  token: TokenSymbol,        // token you want to receive on `to`
  amount: bigint,
  from: ChainId,
  to: ChainId,
  walletClient: WalletClient,
  opts?: {
    slippage?: number
    allowBridges?: string[]
    allowExchanges?: string[]
    onUpdate?: (route: any) => void
    onRateChange?: (nextToAmount: string) => Promise<boolean> | boolean
    /** NEW: force the source-side token (e.g. 'USDC') even if dest wants 'USDT0' */
    sourceToken?: Extract<TokenSymbol, 'USDC' | 'USDT'>
  }
) {
  const account = walletClient.account?.address as `0x${string}` | undefined
  if (!account) throw new Error('No account found on WalletClient – connect a wallet first')

  configureLifiWith(walletClient)

  const originChainId      = CHAIN_ID[from]
  const destinationChainId = CHAIN_ID[to]

  // 👉 if sourceToken is provided, use it for fromToken; else keep the current mapping logic
  const inputToken  = tokenAddress(opts?.sourceToken ?? token, from)
  const outputToken = tokenAddress(token, to)

  const quote = await getQuote({
    fromChain: originChainId,
    toChain: destinationChainId,
    fromToken: inputToken,
    toToken: outputToken,
    fromAmount: amount.toString(),
    fromAddress: account,
    slippage: opts?.slippage ?? 0.003,
    allowBridges: opts?.allowBridges,
    allowExchanges: opts?.allowExchanges,
  })

  const route = convertQuoteToRoute(quote)

  const executed = await executeRoute(route, {
    updateRouteHook: (updated) => opts?.onUpdate?.(updated),
    switchChainHook: async (chainId) => {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHexChain(chainId) }],
      })
      return walletClient
    },
    acceptExchangeRateUpdateHook: async (p) => {
      if (opts?.onRateChange) return await opts.onRateChange(p.newToAmount)
      return true
    },
  })

  return executed
}