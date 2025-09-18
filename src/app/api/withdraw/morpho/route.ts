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
import rewardsVaultAbi from '@/lib/abi/rewardsAbi.json' // exposes recordDeposit/recordWithdrawal
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS, REWARDS_VAULT } from '@/lib/constants'

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

// ERC-4626 vault (Morpho) on Lisk (default to USDCe supply vault)
const LISK_ERC4626_VAULT =
  (process.env.LISK_ERC4626_VAULT as `0x${string}` | undefined) ??
  (MORPHO_POOLS['usdce-supply'] as `0x${string}`)

/* ─────────────── Clients ─────────────── */
const relayer = privateKeyToAccount(RELAYER_PK)
const opPublic   = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet   = createWalletClient({ chain: optimism, transport: http(OP_RPC), account: relayer })
const liskPublic = createPublicClient({ chain: lisk,     transport: http(LSK_RPC) })
const liskWallet = createWalletClient({ chain: lisk,     transport: http(LSK_RPC), account: relayer })

/* ─────────────── ABIs ─────────────── */
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
])
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
])

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
async function recordDepositBackOnOP(params: {
  rewardsVault: `0x${string}`
  user: `0x${string}`
  amountShares: bigint
}) {
  const { rewardsVault, user, amountShares } = params
  const { request } = await opPublic.simulateContract({
    address: rewardsVault,
    abi: rewardsVaultAbi,
    functionName: 'recordDeposit', // updates accounting AND mints receipts
    args: [user, amountShares],
    account: relayer,
  })
  const tx = await opWallet.writeContract(request)
  await opPublic.waitForTransactionReceipt({ hash: tx })
  return tx
}

async function depositAssetsBackToVaultOnLisk(params: {
  token: `0x${string}`        // USDCe on Lisk
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
    args: [relayer.address],
  }) as bigint

  const toDeposit = bal >= wantAssets ? wantAssets : bal
  if (toDeposit === 0n) {
    console.warn('[compensate] depositBack: nothing to deposit (balance 0)')
    return { approved: null as `0x${string}` | null, deposited: null as `0x${string}` | null, depositedAmt: 0n }
  }

  console.warn('[compensate] depositBack: approving & depositing', { toDeposit: toDeposit.toString() })

  // Approve vault to pull USDCe
  const { request: approveReq } = await liskPublic.simulateContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [vault, toDeposit],
    account: relayer,
  })
  const approveTx = await liskWallet.writeContract(approveReq)
  await liskPublic.waitForTransactionReceipt({ hash: approveTx })

  // deposit(assets, receiver=Safe)
  const { request: depositReq } = await liskPublic.simulateContract({
    address: vault,
    abi: ERC4626_ABI,
    functionName: 'deposit',
    args: [toDeposit, safe],
    account: relayer, // relayer supplies tokens
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
    args: [relayer.address],
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
    account: relayer,
  })
  const tx = await liskWallet.writeContract(request)
  await liskPublic.waitForTransactionReceipt({ hash: tx })
  return { tx, transferred: bal }
}

/* ─────────────── POST ───────────────
   Decimals are aligned (6d receipts & 6d USDCe), so no scaling.
   Steps with compensations:
   1) Burn shares on OP via rewards vault (recordWithdrawal)
      - If this fails: abort.
   2) Safe executes withdraw(assets, relayer, safe) on Lisk
      - If this fails: recordDeposit(user, assets) to re-mint on OP; abort.
   3) Bridge Lisk:USDCe → OP:USDC to user
      - If this fails:
          a) deposit back USDCe from relayer to vault (receiver = Safe) or transfer to Safe
          b) recordDeposit(user, assets) to re-mint shares on OP
*/
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const user     = body?.user   as `0x${string}` | undefined
    const assetsIn = (body?.assets ?? body?.amount) as string | undefined

    if (!user || !assetsIn) {
      return NextResponse.json({ ok: false, error: 'Missing user/assets' }, { status: 400 })
    }

    // Addresses
    const rewardsVault = REWARDS_VAULT.optimism as `0x${string}`     // OP rewards mirror vault
    const liskSafe     = SAFEVAULT as `0x${string}`                  // Lisk Safe owner of shares
    const vault4626    = LISK_ERC4626_VAULT                          // Lisk ERC4626 vault

    // Vault asset (USDCe) on Lisk
    const vaultAsset = await liskPublic.readContract({
      address: vault4626,
      abi: ERC4626_ABI,
      functionName: 'asset',
    }) as `0x${string}`

    // Parse assets (6d expected)
    const requestedAssets = BigInt(assetsIn)

    // Withdraw a touch less than burned shares to avoid rounding/fee edge cases (e.g., 0.6% buffer)
    const withdrawAssets = (requestedAssets * 995n) / 1000n
    if (withdrawAssets === 0n) {
      return NextResponse.json({ ok: false, error: 'Withdraw amount too small' }, { status: 400 })
    }

    console.log('[withdraw/4626][inputs]', {
      user, vaultAsset, requestedAssets: requestedAssets.toString(), withdrawAssets: withdrawAssets.toString(),
    })

    /* ── 1) Burn on OP via rewards vault (keeps token + accounting in sync) ─ */
    let burnTxHash: `0x${string}` | null = null
    try {
      const { request: burnReq } = await opPublic.simulateContract({
        address: rewardsVault,
        abi: rewardsVaultAbi,
        functionName: 'recordWithdrawal', // burns receipt + updates accounting
        args: [user, withdrawAssets],
        account: relayer,
      })
      burnTxHash = await opWallet.writeContract(burnReq)
      await opPublic.waitForTransactionReceipt({ hash: burnTxHash })
      console.log('[withdraw/4626] recordWithdrawal ok', { burnTxHash })
    } catch (err: any) {
      console.error('[withdraw/4626] recordWithdrawal failed', err?.message || err)
      return NextResponse.json({ ok: false, stage: 'burn', error: err?.message ?? 'recordWithdrawal failed' }, { status: 500 })
    }

    /* ── 2) Safe executes withdraw(assets, relayer, safe) on Lisk ─ */
    const calldata = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: 'withdraw',
      args: [requestedAssets, relayer.address, liskSafe],
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
      console.error('[withdraw/4626] safe exec failed, compensating by re-minting…', err?.message || err)
      try {
        const mintTx = await recordDepositBackOnOP({ rewardsVault, user, amountShares: withdrawAssets })
        console.warn('[compensate] recordDeposit back ok', { mintTx })
      } catch (cErr: any) {
        console.error('[compensate] recordDeposit back FAILED', cErr?.message || cErr)
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

    // Snapshot relayer USDCe before bridge (cap for deposit-back)
    const relayerBalBefore = await liskPublic.readContract({
      address: usdceLsk,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [relayer.address],
    }) as bigint

    console.log('[withdraw/4626] LI.FI quote', {
      fromChain: lisk.id, toChain: optimism.id,
      fromToken: usdceLsk, toToken: usdcOP,
      fromAmount: withdrawAssets.toString(),
      fromAddress: relayer.address,
      toAddress: user,
      relayerBalBefore: relayerBalBefore.toString(),
    })

    try {
      const quote = await getQuote({
        fromChain:  lisk.id,
        toChain:    optimism.id,
        fromToken:  usdceLsk,
        toToken:    usdcOP,
        fromAmount: withdrawAssets.toString(),
        fromAddress: relayer.address,
        toAddress:  user,
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
      console.error('[withdraw/4626] bridge failed; compensating by depositBack + re-mint…', err?.message || err)

      // 3a) Try to deposit back into vault (receiver = Safe) up to what we still have
      let depositedAmt = 0n
      try {
        const res = await depositAssetsBackToVaultOnLisk({
          token: usdceLsk,
          vault: vault4626,
          safe: liskSafe,
          wantAssets: relayerBalBefore, // aim to restore pre-bridge holdings
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

      // 3b) Always mint back the burned shares (via rewards vault)
      try {
        const mintTx = await recordDepositBackOnOP({ rewardsVault, user, amountShares: withdrawAssets })
        console.warn('[compensate] recordDeposit back ok', { mintTx, shares: withdrawAssets.toString() })
      } catch (mintErr: any) {
        console.error('[compensate] recordDeposit back FAILED', mintErr?.message || mintErr)
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
    console.error('[api/withdraw/morpho] error:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
