// src/app/api/withdraw/morpho/route.ts
import { NextResponse } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism, lisk } from 'viem/chains'

// ---- Safe Protocol Kit (v4+): init() API (no EthersAdapter) ----
import Safe from '@safe-global/protocol-kit'
import type { MetaTransactionData } from '@safe-global/types-kit'
import { OperationType } from '@safe-global/types-kit'

// ---- Contracts / constants ----
import vaultAbi from '@/lib/abi/vaultToken.json' // sVault on OP (has burn(address,uint256))
import { TokenAddresses, SAFEVAULT , MORPHO_POOLS} from '@/lib/constants'

// ---- LI.FI (server) ----
import { configureLifiWith } from '@/lib/bridge'
import { createConfig, EVM, getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ──────────────────────────────────────────────────────────────────
   ENV / Clients
   ────────────────────────────────────────────────────────────────── */
   const LIFI_API = process.env.LIFI_API || ' '
const RELAYER_PK_RAW = process.env.RELAYER_PRIVATE_KEY || ''
if (!RELAYER_PK_RAW) throw new Error('RELAYER_PRIVATE_KEY is missing')
const RELAYER_PK = (RELAYER_PK_RAW.startsWith('0x') ? RELAYER_PK_RAW : `0x${RELAYER_PK_RAW}`) as `0x${string}`

const OP_RPC  = process.env.OP_RPC_URL   || 'https://mainnet.optimism.io'
const LSK_RPC = process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com'

// ⚠️ ERC-4626 vault holding the position on Lisk (set this!)
const LISK_ERC4626_VAULT =
  (process.env.LISK_ERC4626_VAULT as `0x${string}` | undefined) ??
  ( MORPHO_POOLS['usdce-supply'] as `0x${string}`) // ← replace if not using ENV

// viem accounts/clients (server-side)
const relayerViem = privateKeyToAccount(RELAYER_PK)
const opPublic   = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet   = createWalletClient({ chain: optimism, transport: http(OP_RPC), account: relayerViem })
const liskPublic = createPublicClient({ chain: lisk,     transport: http(LSK_RPC) })
const liskWallet = createWalletClient({ chain: lisk,     transport: http(LSK_RPC), account: relayerViem })



/* ──────────────────────────────────────────────────────────────────
   ABIs
   ────────────────────────────────────────────────────────────────── */
// Minimal ERC-4626 (plus balanceOf from ERC20)
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256 shares)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
])

/* ──────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────── */
const VAULT_SHARES_DECIMALS = 18
const USDC_DECIMALS = 6
const pow10 = (n: number) => BigInt(10) ** BigInt(n)
const scaleAmount = (amt: bigint, fromDec: number, toDec: number) => {
  if (toDec === fromDec) return amt
  return toDec > fromDec ? amt * pow10(toDec - fromDec) : amt / pow10(fromDec - toDec)
}

export type Rounding = 'floor' | 'ceil' | 'round'

async function to6dFrom18d(
  input: string | bigint,
  rounding: Rounding = 'floor'
): Promise<bigint> {
  const x = typeof input === 'string' ? BigInt(input) : input
  if (x < 0n) throw new Error('amount cannot be negative')

  const DENOM = 1_000_000_000_000n // 10^(18-6)

  switch (rounding) {
    case 'floor':
      return x / DENOM
    case 'ceil':
      return (x + (DENOM - 1n)) / DENOM
    case 'round':
      return (x + DENOM / 2n) / DENOM // half-up
    default:
      return x / DENOM
  }
}


let LIFI_READY = false
function ensureLifiServer() {
  if (LIFI_READY) return
  createConfig({
    integrator: 'superYLDR',
    apiKey: LIFI_API,
    providers: [
      EVM({
        // any WalletClient; executeRoute will still use switchChainHook
        getWalletClient: async () => liskWallet,
        switchChain: async (chainId: number) => {
          if (chainId === lisk.id) return liskWallet
          if (chainId === optimism.id) return opWallet
          throw new Error(`Unsupported chainId: ${chainId}`)
        },
      }),
    ],
  })
  LIFI_READY = true
}

/* ──────────────────────────────────────────────────────────────────
   POST { user, amount }
   amount := assets (USDC units, 6d) to deliver to the user on OP.
   Flow:
   1) Burn sVault shares on OP from the user (18d) for accounting
   2) Preflight ERC-4626.withdraw(assets, relayer, safe) on Lisk AS THE SAFE
   3) Execute Safe tx to withdraw assets to relayer
   4) Bridge Lisk:USDC.e → OP:USDC to the user
   ────────────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const user     = body?.user   as `0x${string}` | undefined
    // Accept `assets` or legacy `amount`
    const assetsIn = (body?.assets ?? body?.amount) as string | undefined

    if (!user || !assetsIn) {
      return NextResponse.json({ ok: false, error: 'Missing user/assets' }, { status: 400 })
    }

    const assets = BigInt(assetsIn) // 6d USDC units
    if (assets <= 0n) {
      return NextResponse.json({ ok: false, error: 'Zero assets' }, { status: 400 })
    }

    // Addresses
    const sVaultOP  = TokenAddresses.sVault.optimism as `0x${string}`      // your 18d receipt token on OP
    const liskSafe  = SAFEVAULT as `0x${string}`                            // Safe that owns the Lisk 4626 shares
    const usdceLsk  = TokenAddresses.USDCe.lisk as `0x${string}`
    const usdcOP    = TokenAddresses.USDC.optimism as `0x${string}`
    const vault4626 = LISK_ERC4626_VAULT

    /* ── 1) Burn user’s sVault (18d) on Optimism ─────────────────── */
    const sharesToBurn = scaleAmount(assets, USDC_DECIMALS, VAULT_SHARES_DECIMALS)
    console.log('[withdraw/4626] burn sVault on OP', { user, assets: assets.toString(), sharesToBurn: assets.toString() })

    const { request: burnReq } = await opPublic.simulateContract({
      address: sVaultOP,
      abi: vaultAbi,
      functionName: 'burn', // burn(address who, uint256 amount)
      args: [user, assets],
      account: relayerViem,
    })
    const burnTx = await opWallet.writeContract(burnReq)
    await opPublic.waitForTransactionReceipt({ hash: burnTx })
    console.log('[withdraw/4626] burnTx hash', burnTx)
    const assetForWithdraw = await to6dFrom18d(assets)

    try {
      await liskPublic.simulateContract({
        address: vault4626,
        abi: ERC4626_ABI,
        functionName: 'withdraw',
        args: [assetForWithdraw, relayerViem.address, liskSafe],
        account: liskSafe, // crucial: msg.sender = Safe
      })
    } catch (err: any) {
      const short = err?.shortMessage || err?.message || 'Inner call would revert'
      const reason = err?.reason || err?.data?.message
      console.error('[withdraw/4626] preflight failed:', short, reason, err?.data)
      return NextResponse.json({
        ok: false,
        stage: 'preflight',
        error: short,
        reason
      }, { status: 400 })
    }

    /* ── 3) Safe executes: ERC-4626.withdraw(assets, relayer, safe) ─ */
    const calldata = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: 'withdraw',
      args: [assetForWithdraw, relayerViem.address, liskSafe],
    })

    const protocolKit = await Safe.init({
      provider: LSK_RPC,
      signer: RELAYER_PK,     // relayer must be a Safe owner (or gather enough owner sigs separately)
      safeAddress: liskSafe,
    })

    const tx: MetaTransactionData = {
      to: vault4626,
      value: '0',
      data: calldata,
      operation: OperationType.Call,
    }

    const safeTx  = await protocolKit.createTransaction({ transactions: [tx] })
    const signed  = await protocolKit.signTransaction(safeTx)
    const execRes = await protocolKit.executeTransaction(signed)
    const safeExecHash =
      (execRes as any)?.hash ??
      (execRes as any)?.transactionResponse?.hash ??
      null
    console.log('[withdraw/4626] safe exec result', { safeExecHash })

    ensureLifiServer() // << server-side LI.FI config (no client code)

    console.log('[withdraw/4626] LI.FI quote', {
      fromChain: lisk.id,
      toChain: optimism.id,
      fromToken: usdceLsk,
      toToken: usdcOP,
      fromAmount: assets.toString(),
      fromAddress: relayerViem.address,
      toAddress: user,
    })

    try {
      const quote = await getQuote({
        fromChain: lisk.id,
        toChain: optimism.id,
        fromToken: usdceLsk,
        toToken:   usdcOP,
        fromAmount: assets.toString(),
        fromAddress: relayerViem.address,
        toAddress: user
      })
      const route = convertQuoteToRoute(quote)

      await executeRoute(route, {
        switchChainHook: async (chainId: number) => {
          if (chainId === lisk.id) return liskWallet
          if (chainId === optimism.id) return opWallet
          throw new Error(`Unsupported chainId: ${chainId}`)
        },
        acceptExchangeRateUpdateHook: async () => true,
      })
      console.log('[withdraw/4626] LI.FI executed', { toAmount: route.toAmount, bridgedTo: user })

      return NextResponse.json({
        ok: true,
        safeExecHash,
        bridgedFrom: 'Lisk:USDCe',
        bridgedTo:   'Optimism:USDC',
        toAmount: route.toAmount,
        receiver: user,
      })
    } catch (err: any) {
      console.error('[withdraw/4626] bridge failed', err?.message || err)
      return NextResponse.json({
        ok: false,
        stage: 'bridge',
        error: err?.message ?? 'Bridge failed',
        safeExecHash,
      }, { status: 500 })
    }
  } catch (e: any) {
    console.error('[api/withdraw/morpho/minimal] error:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}