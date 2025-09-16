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

// Safe Protocol Kit v4+
import Safe from '@safe-global/protocol-kit'
import type { MetaTransactionData } from '@safe-global/types-kit'
import { OperationType } from '@safe-global/types-kit'

// Contracts / constants
import vaultAbi from '@/lib/abi/vaultToken.json' // sVault on OP (balanceOf/burn/decimals)
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS } from '@/lib/constants'

// LI.FI (server-side)
import { createConfig, EVM, getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ──────────────────────────────────────────────────────────────────
   Env & helpers
   ────────────────────────────────────────────────────────────────── */
const PK_RE = /^0x[0-9a-fA-F]{64}$/
function normalizePrivateKey(raw?: string): `0x${string}` {
  const s = (raw ?? '').trim().replace(/^['"]|['"]$/g, '')
  if (!s) throw new Error('RELAYER_PRIVATE_KEY is missing')
  const with0x = ('0x' + s.replace(/^0x/i, '')).toLowerCase() as `0x${string}`
  if (!PK_RE.test(with0x)) throw new Error('RELAYER_PRIVATE_KEY format invalid')
  return with0x
}

const RELAYER_PK = normalizePrivateKey(process.env.RELAYER_PRIVATE_KEY)
const LIFI_API   = process.env.LIFI_API || ''
const OP_RPC     = process.env.OP_RPC_URL   || 'https://mainnet.optimism.io'
const LSK_RPC    = process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com'

// ERC-4626 vault holding the position on Lisk
const LISK_ERC4626_VAULT =
  (process.env.LISK_ERC4626_VAULT as `0x${string}` | undefined) ??
  (MORPHO_POOLS['usdce-supply'] as `0x${string}`)

/* ──────────────────────────────────────────────────────────────────
   Clients
   ────────────────────────────────────────────────────────────────── */
const relayerViem = privateKeyToAccount(RELAYER_PK)
const opPublic   = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet   = createWalletClient({ chain: optimism, transport: http(OP_RPC), account: relayerViem })
const liskPublic = createPublicClient({ chain: lisk,     transport: http(LSK_RPC) })
const liskWallet = createWalletClient({ chain: lisk,     transport: http(LSK_RPC), account: relayerViem })

/* ──────────────────────────────────────────────────────────────────
   Minimal ABIs
   ────────────────────────────────────────────────────────────────── */
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
])
const ERC20_META = parseAbi(['function decimals() view returns (uint8)'])

/* ──────────────────────────────────────────────────────────────────
   Utils
   ────────────────────────────────────────────────────────────────── */
const MINT_BPS = 995n // 0.995 × assets rule

const pow10 = (n: number) => BigInt(10) ** BigInt(n)
const scaleAmount = (amt: bigint, fromDec: number, toDec: number) =>
  toDec === fromDec ? amt : (toDec > fromDec ? amt * pow10(toDec - fromDec) : amt / pow10(fromDec - toDec))

/** If caller accidentally sends 18d when asset has 6d, normalize by /1e12 (only if exactly divisible). */
function maybeNormalize18to6(assets: bigint, assetDecimals: number) {
  if (assetDecimals !== 6) return assets
  const k = pow10(12)
  if (assets % k === 0n) {
    const fixed = assets / k
    // sanity: avoid shrinking real 6d tiny amounts
    if (fixed <= pow10(18)) {
      console.warn('[withdraw/4626] normalized assets 18d → 6d', { raw: assets.toString(), fixed: fixed.toString() })
      return fixed
    }
  }
  return assets
}

/* ──────────────────────────────────────────────────────────────────
   LI.FI server configuration (singletons)
   ────────────────────────────────────────────────────────────────── */
let LIFI_READY = false
function ensureLifiServer() {
  if (LIFI_READY) return
  createConfig({
    integrator: 'superYLDR',
    apiKey: LIFI_API || undefined,
    providers: [
      EVM({
        getWalletClient: async () => liskWallet, // any; executeRoute will use switchChainHook
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
   POST { user, assets? (6d) }  // accepts legacy `amount` too
   Flow (no previews / no simulate preflight):
   1) Read vault asset + decimals, sVault decimals; normalize input units
   2) Safe executes: vault.withdraw(assets, relayer, safe)
   3) Burn sVault shares on OP: sharesToBurn = 0.995 × scale(assets, assetDec → sVaultDec)
   4) Bridge Lisk:USDCe → OP:USDC to user via LI.FI
   ────────────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const user     = body?.user   as `0x${string}` | undefined
    const assetsIn = (body?.assets ?? body?.amount) as string | undefined

    if (!user || !assetsIn) {
      return NextResponse.json({ ok: false, error: 'Missing user/assets' }, { status: 400 })
    }

    const sVaultOP  = TokenAddresses.sVault.optimism as `0x${string}`
    const liskSafe  = SAFEVAULT as `0x${string}`
    const vault4626 = LISK_ERC4626_VAULT

    // Read vault asset & decimals (for scaling + bridge)
    const vaultAsset = await liskPublic.readContract({
      address: vault4626,
      abi: ERC4626_ABI,
      functionName: 'asset',
    }) as `0x${string}`

    const assetDecimals = await liskPublic.readContract({
      address: vaultAsset,
      abi: ERC20_META,
      functionName: 'decimals',
    }) as number

    // Read sVault decimals (don’t assume 18)
    const sVaultDecimals = await opPublic.readContract({
      address: sVaultOP,
      abi: ERC20_META,
      functionName: 'decimals',
    }) as number

    // Normalize input assets if 18d were sent for a 6d asset
    const requestedAssetsRaw = BigInt(assetsIn)
    const assets = maybeNormalize18to6(requestedAssetsRaw, assetDecimals)

    console.log('[withdraw/4626][inputs]', {
      user,
      vaultAsset,
      assetDecimals,
      sVaultDecimals,
      requestedAssetsRaw: requestedAssetsRaw.toString(),
      assets: assets.toString(),
    })

    /* ── 2) Safe executes: ERC-4626.withdraw(assets, relayer, safe) ─ */
    const calldata = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: 'withdraw',
      args: [assets, relayerViem.address, liskSafe],
    })

    const protocolKit = await Safe.init({
      provider: LSK_RPC,
      signer: RELAYER_PK,   // relayer must be a Safe owner
      safeAddress: liskSafe,
    })

    let safeExecHash: `0x${string}` | null = null
    try {
      const tx: MetaTransactionData = {
        to: vault4626,
        value: '0',
        data: calldata,
        operation: OperationType.Call,
      }
      const safeTx  = await protocolKit.createTransaction({ transactions: [tx] })
      const signed  = await protocolKit.signTransaction(safeTx)
      const execRes = await protocolKit.executeTransaction(signed)
      safeExecHash =
        (execRes as any)?.hash ??
        (execRes as any)?.transactionResponse?.hash ??
        null
      console.log('[withdraw/4626] safe exec ok', { safeExecHash })
    } catch (err: any) {
      console.error('[withdraw/4626] safe exec failed', err?.message || err)
      return NextResponse.json({
        ok: false,
        stage: 'safe-exec',
        error: err?.message ?? 'Safe execution failed',
      }, { status: 500 })
    }

    /* ── 3) Burn sVault shares on OP (0.995 × assets, scaled) ─ */
    const sharesToBurn = (scaleAmount(assets, assetDecimals, sVaultDecimals) * MINT_BPS) / 1000n

    console.log('[withdraw/4626] burn sVault on OP', {
      user,
      assets: assets.toString(),
      sharesToBurn: sharesToBurn.toString(),
      sVaultDecimals,
    })

    try {
      const { request: burnReq } = await opPublic.simulateContract({
        address: sVaultOP,
        abi: vaultAbi,
        functionName: 'burn', // burn(address who, uint256 amount)
        args: [user, sharesToBurn], // ✅ burn correct amount
        account: relayerViem,
      })
      const burnTx = await opWallet.writeContract(burnReq)
      await opPublic.waitForTransactionReceipt({ hash: burnTx })
      console.log('[withdraw/4626] burnTx hash', burnTx)
    } catch (err: any) {
      console.error('[withdraw/4626] burn failed', err?.message || err)
      // Keep going to bridge; flip to hard-fail if you prefer.
    }

    /* ── 4) Bridge Lisk:USDCe → OP:USDC ─ */
    ensureLifiServer()

    const usdceLsk = vaultAsset
    const usdcOP   = TokenAddresses.USDC.optimism as `0x${string}`

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
        toAddress: user,
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
