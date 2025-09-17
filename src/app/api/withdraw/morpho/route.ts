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
import vaultAbi from '@/lib/abi/vaultToken.json' // sVault on OP (mint/burn/decimals)
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS } from '@/lib/constants'

// LI.FI (server-side)
import { createConfig, EVM, getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ─────────────── Env & helpers ─────────────── */
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

// ERC-4626 vault (Morpho) on Lisk
const LISK_ERC4626_VAULT =
  (process.env.LISK_ERC4626_VAULT as `0x${string}` | undefined) ??
  (MORPHO_POOLS['usdce-supply'] as `0x${string}`)

/* ─────────────── Clients ─────────────── */
const relayerViem = privateKeyToAccount(RELAYER_PK)
const opPublic   = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet   = createWalletClient({ chain: optimism, transport: http(OP_RPC), account: relayerViem })
const liskPublic = createPublicClient({ chain: lisk,     transport: http(LSK_RPC) })
const liskWallet = createWalletClient({ chain: lisk,     transport: http(LSK_RPC), account: relayerViem })

/* ─────────────── ABIs ─────────────── */
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
])
const ERC20_META = parseAbi(['function decimals() view returns (uint8)'])
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
])

/* ─────────────── Utils ─────────────── */
const pow10 = (n: number) => BigInt(10) ** BigInt(n)
const scaleAmount = (amt: bigint, fromDec: number, toDec: number) =>
  toDec === fromDec ? amt : (toDec > fromDec ? amt * pow10(toDec - fromDec) : amt / pow10(fromDec - toDec))

/** If caller accidentally sends 18d when asset has 6d, normalize by /1e12 if exactly divisible. */
function maybeNormalize18to6(assets: bigint, assetDecimals: number) {
  if (assetDecimals !== 6) return assets
  const k = pow10(12)
  if (assets % k === 0n) {
    const fixed = assets / k
    if (fixed <= pow10(18)) {
      console.warn('[withdraw/4626] normalized assets 18d → 6d', { raw: assets.toString(), fixed: fixed.toString() })
      return fixed
    }
  }
  return assets
}

/* ─────────────── LI.FI server configuration ─────────────── */
let LIFI_READY = false
function ensureLifiServer() {
  if (LIFI_READY) return
  createConfig({
    integrator: 'superYLDR',
    apiKey: LIFI_API || undefined,
    providers: [
      EVM({
        getWalletClient: async () => liskWallet, // executeRoute will still use switchChainHook
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

/* ─────────────── Compensating actions ─────────────── */
async function mintBackSharesOnOP(params: {
  sVaultOP: `0x${string}`
  user: `0x${string}`
  amountShares: bigint
}) {
  const { sVaultOP, user, amountShares } = params
  console.warn('[compensate] mintBackSharesOnOP', { user, amountShares: amountShares.toString() })
  const { request } = await opPublic.simulateContract({
    address: sVaultOP,
    abi: vaultAbi,
    functionName: 'mint', // assumes relayer has MINTER role
    args: [user, amountShares],
    account: relayerViem,
  })
  const tx = await opWallet.writeContract(request)
  await opPublic.waitForTransactionReceipt({ hash: tx })
  return tx
}

async function depositAssetsBackToVaultOnLisk(params: {
  token: `0x${string}`        // USDC.e on Lisk
  vault: `0x${string}`        // ERC-4626 vault
  safe: `0x${string}`         // Safe to receive shares
  wantAssets: bigint          // target assets to put back
}) {
  const { token, vault, safe, wantAssets } = params

  // Relayer balance (what we *can* put back)
  const bal = await liskPublic.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [relayerViem.address],
  }) as bigint

  const toDeposit = bal >= wantAssets ? wantAssets : bal
  if (toDeposit === 0n) {
    console.warn('[compensate] depositBack: nothing to deposit (balance 0)')
    return { approved: null as `0x${string}` | null, deposited: null as `0x${string}` | null, depositedAmt: 0n }
  }

  console.warn('[compensate] depositBack: approving & depositing', { toDeposit: toDeposit.toString() })

  // Approve vault to pull USDC.e
  const { request: approveReq } = await liskPublic.simulateContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [vault, toDeposit],
    account: relayerViem,
  })
  const approveTx = await liskWallet.writeContract(approveReq)
  await liskPublic.waitForTransactionReceipt({ hash: approveTx })

  // deposit(assets, receiver=Safe)
  const { request: depositReq } = await liskPublic.simulateContract({
    address: vault,
    abi: ERC4626_ABI,
    functionName: 'deposit',
    args: [toDeposit, safe],
    account: relayerViem, // relayer supplies tokens
  })
  const depositTx = await liskWallet.writeContract(depositReq)
  await liskPublic.waitForTransactionReceipt({ hash: depositTx })

  return { approved: approveTx, deposited: depositTx, depositedAmt: toDeposit }
}

async function transferAssetsBackToSafeOnLisk(params: {
  token: `0x${string}`
  safe: `0x${string}`
}) {
  const { token, safe } = params
  const bal = await liskPublic.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [relayerViem.address],
  }) as bigint
  if (bal === 0n) {
    console.warn('[compensate] transferBack: nothing to transfer (balance 0)')
    return { tx: null as `0x${string}` | null, transferred: 0n }
  }
  console.warn('[compensate] transferBack: sending remaining to Safe', { bal: bal.toString() })
  const { request } = await liskPublic.simulateContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [safe, bal],
    account: relayerViem,
  })
  const tx = await liskWallet.writeContract(request)
  await liskPublic.waitForTransactionReceipt({ hash: tx })
  return { tx, transferred: bal }
}

/* ─────────────── POST ───────────────
   Steps with compensations:
   1) Burn ALL corresponding sVault shares on OP
   2) Safe executes withdraw(assets, relayer, safe)
      - If this fails, mint back burned shares on OP and exit
   3) Bridge Lisk:USDCe → OP:USDC to user
      - If this fails:
          a) deposit back USDCe from relayer to vault (receiver = Safe)
          b) mint back burned shares on OP
          c) if (a) fails, fallback: transfer remaining USDCe to Safe
*/
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

    // Vault asset & decimals
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

    // sVault decimals (don’t assume 18)
    const sVaultDecimals = await opPublic.readContract({
      address: sVaultOP,
      abi: ERC20_META,
      functionName: 'decimals',
    }) as number

    // Normalize input assets if 18d arrived for a 6d asset
    const requestedAssetsRaw = BigInt(assetsIn)
    const assets = maybeNormalize18to6(requestedAssetsRaw, assetDecimals)

    console.log('[withdraw/4626][inputs]', {
      user, vaultAsset, assetDecimals, sVaultDecimals,
      requestedAssetsRaw: requestedAssetsRaw.toString(),
      assets: assets.toString(),
    })

    /* ── 1) Burn ALL sVault shares (scaled 1:1 to assets) ─ */
    const sharesToBurn = scaleAmount(assets, assetDecimals, sVaultDecimals)
    let burnTxHash: `0x${string}` | null = null
    try {
      const { request: burnReq } = await opPublic.simulateContract({
        address: sVaultOP,
        abi: vaultAbi,
        functionName: 'burn', // burn(address who, uint256 amount)
        args: [user, sharesToBurn],
        account: relayerViem,
      })
      burnTxHash = await opWallet.writeContract(burnReq)
      await opPublic.waitForTransactionReceipt({ hash: burnTxHash })
      console.log('[withdraw/4626] burn ok', { burnTxHash, sharesToBurn: sharesToBurn.toString() })
    } catch (err: any) {
      console.error('[withdraw/4626] burn failed', err?.message || err)
      return NextResponse.json({ ok: false, stage: 'burn', error: err?.message ?? 'Burn failed' }, { status: 500 })
    }

    /* ── 2) Safe executes withdraw(assets, relayer, safe) ─ */
    const assetsWithdraw = (assets * 994n)/1000n
    const calldata = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: 'withdraw',
      args: [assetsWithdraw, relayerViem.address, liskSafe],
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
      console.error('[withdraw/4626] safe exec failed, compensating by minting back shares…', err?.message || err)
      try {
        const mintTx = await mintBackSharesOnOP({ sVaultOP, user, amountShares: sharesToBurn })
        console.warn('[compensate] mint back shares ok', { mintTx })
      } catch (cErr: any) {
        console.error('[compensate] mint back shares FAILED', cErr?.message || cErr)
      }
      return NextResponse.json({
        ok: false,
        stage: 'safe-exec',
        error: err?.message ?? 'Safe execution failed',
        compensated: { sharesMintedBack: true },
      }, { status: 500 })
    }

    /* ── 3) Bridge Lisk:USDCe → OP:USDC ─ */
    ensureLifiServer()

    const usdceLsk = vaultAsset
    const usdcOP   = TokenAddresses.USDC.optimism as `0x${string}`

    // snapshot relayer USDC.e before bridge (cap for deposit-back)
    const relayerBalBefore = await liskPublic.readContract({
      address: usdceLsk,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [relayerViem.address],
    }) as bigint

    console.log('[withdraw/4626] LI.FI quote', {
      fromChain: lisk.id, toChain: optimism.id,
      fromToken: usdceLsk, toToken: usdcOP,
      fromAmount: assetsWithdraw.toString(),
      fromAddress: relayerViem.address,
      toAddress: user,
      relayerBalBefore: relayerBalBefore.toString(),
    })

    try {
      const quote = await getQuote({
        fromChain: lisk.id,
        toChain: optimism.id,
        fromToken: usdceLsk,
        toToken:   usdcOP,
        fromAmount: assetsWithdraw.toString(),
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
        burnTxHash,
        safeExecHash,
        bridgedFrom: 'Lisk:USDCe',
        bridgedTo:   'Optimism:USDC',
        toAmount: route.toAmount,
        receiver: user,
      })
    } catch (err: any) {
      console.error('[withdraw/4626] bridge failed; compensating by depositBack + mintBack…', err?.message || err)
      // 3a) Try to deposit back into vault (receiver = Safe) up to what we still have
      let depositedAmt = 0n
      try {
        const res = await depositAssetsBackToVaultOnLisk({
          token: usdceLsk,
          vault: vault4626,
          safe: liskSafe,
          wantAssets: relayerBalBefore, // we aim to restore pre-bridge holdings
        })
        depositedAmt = res.depositedAmt
        console.warn('[compensate] depositBack result', res)
      } catch (depErr: any) {
        console.error('[compensate] depositBack FAILED; falling back to transferBack', depErr?.message || depErr)
        try {
          const xfer = await transferAssetsBackToSafeOnLisk({ token: usdceLsk, safe: liskSafe })
          console.warn('[compensate] transferBack result', xfer)
        } catch (xfErr: any) {
          console.error('[compensate] transferBack FAILED', xfErr?.message || xfErr)
        }
      }

      // 3b) Always mint back the burned sVault shares
      try {
        const mintTx = await mintBackSharesOnOP({ sVaultOP, user, amountShares: sharesToBurn })
        console.warn('[compensate] mintBackShares ok', { mintTx, shares: sharesToBurn.toString() })
      } catch (mintErr: any) {
        console.error('[compensate] mintBackShares FAILED', mintErr?.message || mintErr)
      }

      return NextResponse.json({
        ok: false,
        stage: 'bridge',
        error: err?.message ?? 'Bridge failed',
        compensated: {
          depositBackTried: true,
          depositedAmt: depositedAmt.toString(),
          sharesMintedBack: true,
        },
        burnTxHash,
        safeExecHash,
      }, { status: 500 })
    }
  } catch (e: any) {
    console.error('[api/withdraw/morpho/saga] error:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
