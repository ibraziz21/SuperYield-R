// src/lib/bridge.ts
'use client'

import {
  createConfig,
  EVM,
  getQuote,
  getContractCallsQuote,
  convertQuoteToRoute,
  executeRoute,
  ContractCall,
} from '@lifi/sdk'
import type { WalletClient } from 'viem'
import { parseAbi, encodeFunctionData } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import { ADAPTER_KEYS, ROUTERS, TokenAddresses, SAFEVAULT } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import { BigNumber, BigNumberish } from 'ethers'
import 'dotenv/config'


const API = process.env.LIFI_API as string

export type RouterPushResult = {
  txHash: `0x${string}`              // user's bridge/send tx (if any)
  routerTxHash?: `0x${string}`       // L2 router tx that emitted Deposited
  received?: bigint                  // <-- actual tokens router delivered to adapter/safe
  fee?: bigint                       // optional, if you compute it
}

/* ────────────────────────────────────────────────────────────────
   Chain + symbol helpers
   ──────────────────────────────────────────────────────────────── */
const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  base: base.id,
  lisk: lisk.id,
}

function requiredDestForAdapter(key: `0x${string}`): 'USDT0' | 'USDCe' | 'WETH' {
  switch (key) {
    case ADAPTER_KEYS.morphoLiskUSDT0: return 'USDT0'
    case ADAPTER_KEYS.morphoLiskUSDCe: return 'USDCe'
    case ADAPTER_KEYS.morphoLiskWETH:  return 'WETH'
    default:                           return 'USDCe' // fallback for non-morpho routes
  }
}

/** Map UI symbol to the *actual* representation on a chain. */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC') return 'USDCe'
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
    integrator: 'superYLDR',
    apiKey: API,
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
   Simple bridge (existing)
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
    /** Force the source-side token (e.g. 'USDC') even if dest wants 'USDT0' */
    sourceToken?: Extract<TokenSymbol, 'USDC' | 'USDT'>
  }
) {
  const account = walletClient.account?.address as `0x${string}` | undefined
  if (!account) throw new Error('No account found on WalletClient – connect a wallet first')

  configureLifiWith(walletClient)

  const originChainId      = CHAIN_ID[from]
  const destinationChainId = CHAIN_ID[to]

  // if sourceToken is provided, use it for fromToken; else keep mapping logic
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

/* ────────────────────────────────────────────────────────────────
   NEW: 1-click bridge → approve router → call router.deposit(...)
   (targets your AggregatorRouter directly on Lisk)
   ──────────────────────────────────────────────────────────────── */

const ROUTER_ABI = parseAbi([
  'function deposit(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes data) external',
])
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) external returns (bool)',
])

/**
 * One-click contract-call route:
 *  - LI.FI bridges to Lisk and makes ≥ `amount` of `destToken` available
 *  - Approves your Lisk router to spend it (USDT0 uses approve(0)->approve(amount))
 *  - Calls `AggregatorRouter.deposit(key, asset, amount, user, '0x')`
 * Router then pulls tokens from LI.FI executor and deposits via your adapter.
 */
export async function bridgeAndDepositViaRouter(params: {
  user: `0x${string}`
  destToken: 'USDT0' | 'USDCe' | 'WETH'
  srcChain: 'optimism' | 'base'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  minBps?: number
  walletClient: WalletClient
}) {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, minBps = 30, walletClient } = params
  if (!user) throw new Error('user missing')

  // enforce adapter ↔ dest token match
  const must = requiredDestForAdapter(adapterKey)
  if (must !== destToken) throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)

  configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[srcChain]
  const toChainId   = CHAIN_ID.lisk
  const fromToken   = tokenAddress(srcToken, srcChain)
  const toToken     = tokenAddress(destToken, 'lisk')
  const routerAddr  = ROUTERS.lisk

  // BigNumberish as HEX (removes any ambiguity)
  const amountHex = `0x${amount.toString(16)}`
  const zeroHex   = '0x0'

  // router.deposit(...)
  const depositCalldata = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'deposit',
    args: [adapterKey, toToken, amount, user, '0x'],
  })

  const needsUsdtFix = destToken === 'USDT0'

  const contractCalls: any[] = []

  if (needsUsdtFix) {
    // USDT-style allowance reset — every call includes fromAmount/fromTokenAddress/toTokenAddress
    const approve0 = encodeFunctionData({
      abi: ERC20_ABI, functionName: 'approve', args: [routerAddr, 0n],
    })
    const approveN = encodeFunctionData({
      abi: ERC20_ABI, functionName: 'approve', args: [routerAddr, amount],
    })

    contractCalls.push(
      {
        fromAmount: '1000000000000000000' as BigNumberish,            // HEX BigNumberish
        fromTokenAddress: toToken,
        toTokenAddress: toToken,
        toContractAddress: toToken,
        toContractCallData: approve0,
        toContractGasLimit: '80000',
      },
      {
        fromAmount: '1000000000000000000' as BigNumberish,            // HEX BigNumberish
        fromTokenAddress: toToken,
        toTokenAddress: toToken,
        toContractAddress: toToken,
        toContractCallData: approveN,
        toContractGasLimit: '80000',
      },
    )
  }

  // The only call that actually consumes tokens
  contractCalls.push({
    fromAmount: amount.toString() as BigNumberish,              // HEX BigNumberish
    fromTokenAddress: toToken,
    toTokenAddress: toToken,
    toContractAddress: routerAddr,
    toContractCallData: depositCalldata,
    toContractGasLimit: '300000',
    ...(needsUsdtFix ? {} : { toApprovalAddress: routerAddr }), // simple path for USDCe/WETH
  })

  console.log('contractCalls sent to LI.FI:', JSON.stringify(contractCalls, null, 2))
  // Optional: guard slack (LI.FI still enforces toAmount >= requested)
  const _min = amount - (amount * BigInt(minBps)) / 10_000n
  void _min

  const quote = await getContractCallsQuote({
    fromAddress: user,
    fromChain: fromChainId,
    fromToken,
    toChain: toChainId,
    toToken: toToken,
    toAmount: amount.toString(),                // HEX BigNumberish is accepted too
    contractCalls,
  })

  const route = convertQuoteToRoute(quote)
  return executeRoute(route, {
    updateRouteHook: () => {},
    switchChainHook: async (chainId) => {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      })
      return walletClient
    },
    acceptExchangeRateUpdateHook: async () => true,
  })
}
const ROUTER_ABI_PUSH = parseAbi([
  'function depositFromBalance(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes data) external',
])

export async function bridgeAndDepositViaRouterPush(params: {
  user: `0x${string}`
  destToken: 'USDT0' | 'USDCe' | 'WETH'
  srcChain: 'optimism' | 'base'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  walletClient: WalletClient
})  {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, walletClient } = params

  const must =
    adapterKey === ADAPTER_KEYS.morphoLiskUSDT0 ? 'USDT0' :
    adapterKey === ADAPTER_KEYS.morphoLiskUSDCe ? 'USDCe' : 'WETH'
  if (must !== destToken) throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)

  configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[srcChain]
  const toChainId   = CHAIN_ID.lisk
  const fromToken   = tokenAddress(srcToken, srcChain)
  const toToken     = tokenAddress(destToken, 'lisk')
  const routerAddr  = ROUTERS.lisk

  // LI.FI likes DECIMAL strings for amounts
  const amt = amount.toString(10)

  // 1) executor → token: transfer(router, amount)  (consumes `amount`)
  const transferCalldata = encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 value) external returns (bool)']),
    functionName: 'transfer',
    args: [routerAddr, amount],
  })

  // 2) executor → router: depositFromBalance(...)   (no token spend)
  const depositCalldata = encodeFunctionData({
    abi: ROUTER_ABI_PUSH,
    functionName: 'depositFromBalance',
    args: [adapterKey, toToken, amount, SAFEVAULT, '0x'],
  })

  const contractCalls:ContractCall[] = [
    {
      fromAmount: amt ,                     // spends dest token
      fromTokenAddress: toToken,
      toContractAddress: toToken,
      toContractCallData: transferCalldata,
      toContractGasLimit: '90000',
    },
    {
      fromAmount: BigInt(1).toString() ,                     // no spend here
      fromTokenAddress: toToken,
      toContractAddress: routerAddr,
      toContractCallData: depositCalldata,
      toContractGasLimit: '300000',
    },
  ]

  const quote = await getContractCallsQuote({
    fromAddress: user,
    fromChain: fromChainId,
    fromToken,
    toChain: toChainId,
    toToken,
    toAmount: amt,                         // ensure ≥ amount bridged
    contractCalls,
  })



  const route = convertQuoteToRoute(quote)
  return executeRoute(route, {
    updateRouteHook: () => {},
    switchChainHook: async (chainId) => {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      })
      return walletClient
    },
    acceptExchangeRateUpdateHook: async () => true,
  }

)
}


