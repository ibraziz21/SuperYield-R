// src/app/api/relayer/finish/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  encodeFunctionData,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lisk, optimism } from 'viem/chains'
import {ensureAllowanceThenDeposit} from '@/lib/ensureAllowanceThenDeposit'
import morphoAbi from '@/lib/abi/morphoLisk.json'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import {
  TokenAddresses,
  SAFEVAULT,
  MORPHO_POOLS,
  REWARDS_VAULT,
} from '@/lib/constants'

// ---------- config / env ----------
const LIFI_STATUS_URL = 'https://li.quest/v1/status'
const LISK_ID = 1135

const RELAYER_PRIVATE_KEY_RAW = (process.env.RELAYER_PRIVATE_KEY || '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
if (!RELAYER_PRIVATE_KEY_RAW) {
  console.warn('[finish] RELAYER_PRIVATE_KEY is empty or missing')
}
const RELAYER_PRIVATE_KEY = (`0x${RELAYER_PRIVATE_KEY_RAW.replace(/^0x/i, '')}`) as `0x${string}`
const liskPub = createPublicClient({ chain: lisk, transport: http(process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com') })
const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);


// Lisk (USDT0, Morpho), OP (mint)
const USDT0_LISK = TokenAddresses.USDT0.lisk as `0x${string}`
const MORPHO_POOL = "0x50cb55be8cf05480a844642cb979820c847782ae" as `0x${string}`
const OP_REWARDS_VAULT = (REWARDS_VAULT.optimismUSDT ??
  '0x1aDBe89F2887a79C64725128fd1D53b10FD6b441') as `0x${string}`

function json(x: any, s = 200) { return NextResponse.json(x, { status: s }) }
function bad(m: string, s = 400) { return json({ ok: false, error: m }, s) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ————— Li.Fi status (by tx hash) ————— */
async function getLifiStatusByTx(params: {
  fromChainId: number
  toChainId: number
  fromTxHash: `0x${string}`
  bridge?: string
}) {
  const q = new URLSearchParams({
    fromChain: String(params.fromChainId),
    toChain: String(params.toChainId),
    txHash: params.fromTxHash,
  })
  if (params.bridge) q.set('bridge', params.bridge)

  const res = await fetch(`${LIFI_STATUS_URL}?${q.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`LiFi status HTTP ${res.status}`)
  return res.json()
}

async function waitForLiFiDone(args: {
  fromChainId: number
  toChainId: number
  fromTxHash: `0x${string}`
  timeoutMs?: number
  pollMs?: number
}) {
  const { fromChainId, toChainId, fromTxHash, timeoutMs = 12 * 60_000, pollMs = 6_000 } = args
  const endAt = Date.now() + timeoutMs

  while (true) {
    const st = await getLifiStatusByTx({ fromChainId, toChainId, fromTxHash })
    const status = st?.status as string | undefined
    if (status === 'DONE') {
      const recv = st?.receiving
      const amountStr = recv?.amount as string | undefined
      const bridgedAmount = amountStr ? BigInt(amountStr) : 0n
      return { st, bridgedAmount, receiving: recv }
    }
    if (status === 'FAILED') throw new Error(`LiFi status FAILED for ${fromTxHash}`)
    if (Date.now() > endAt) throw new Error(`Timeout waiting LiFi status for ${fromTxHash}`)
    await sleep(pollMs)
  }
}

/** ————— Viem clients ————— */
function makeLiskClients() {
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY)
  const transport = http(process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com')
  const pub = createPublicClient({ chain: lisk, transport })
  const wlt = createWalletClient({ account, chain: lisk, transport })
  return { pub, wlt, account }
}
function makeOpClients() {
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY)
  const transport = http(process.env.OP_RPC_URL)
  const pub = createPublicClient({ chain: optimism, transport })
  const wlt = createWalletClient({ account, chain: optimism, transport })
  return { pub, wlt, account }
}

/** ————— Nonce-aware writer (retries) ————— */
async function writeWithRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, delayMs = 1200 }: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  let lastErr: any
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      const msg = e?.message || ''
      if (msg.includes('nonce too low') || msg.includes('replacement transaction underpriced')) {
        await sleep(delayMs)
        lastErr = e
        continue
      }
      throw e
    }
  }
  throw lastErr
}

/** ————— Local sign + raw-send (EIP-1559) ————— */
async function signAndSendRawTx(params: {
  pub: PublicClient
  wallet: WalletClient
  chain: Chain
  from: Address
  to: Address
  data?: Hex
  value?: bigint
  maxRetries?: number
  retryDelayMs?: number
}): Promise<Hex> {
  const {
    pub, wallet, chain, from, to, data,
    value = 0n, maxRetries = 3, retryDelayMs = 1200,
  } = params

  let attempt = 0
  while (true) {
    try {
      const [nonce, gas, fee] = await Promise.all([
        pub.getTransactionCount({ address: from }),
        pub.estimateGas({ to, data, value, account: from }),
        pub.estimateFeesPerGas(), // { maxFeePerGas, maxPriorityFeePerGas }
      ])

      const signed = await wallet.signTransaction({
        chain,
        account: from,              // Address is allowed here in viem
        to,
        data,
        value,
        nonce,
        gas,
        maxFeePerGas: fee.maxFeePerGas!,
        maxPriorityFeePerGas: fee.maxPriorityFeePerGas!,
      })

      const txHash = await pub.sendRawTransaction({ serializedTransaction: signed })
      await pub.waitForTransactionReceipt({ hash: txHash })
      return txHash
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      const retryable =
        msg.includes('nonce too low') ||
        msg.includes('replacement transaction underpriced') ||
        msg.includes('conflict') ||
        msg.includes('already known')

      if (retryable && attempt < maxRetries) {
        attempt++
        await new Promise((r) => setTimeout(r, retryDelayMs))
        continue
      }
      throw e
    }
  }
}

/** ————— Mint on Optimism ————— */
async function mintReceipt(user: `0x${string}`, amount: bigint) {
  const { pub, wlt, account } = makeOpClients()
  const { request } = await pub.simulateContract({
    address: OP_REWARDS_VAULT,
    abi: rewardsAbi,
    functionName: 'recordDeposit',
    args: [user, amount],
    account,
  })
  const mintTx = await writeWithRetry(() => wlt.writeContract(request))
  await pub.waitForTransactionReceipt({ hash: mintTx })
  return { mintTx }
}

async function tryLockIntent(refId: string, opts?: { force?: boolean; staleMs?: number }) {
  const force = !!opts?.force
  const staleMs = opts?.staleMs ?? 60_000  // 1 minute default, was 10 min

  // if force: take the lock unless already final
  if (force) {
    const res = await prisma.depositIntent.updateMany({
      where: {
        refId,
        status: { notIn: ['MINTED', 'SUCCESS'] },
      },
      data: { status: 'PROCESSING', error: null, updatedAt: new Date() },
    })
    if (res.count === 1) return { ok: true }
  }

  // normal path: allow lock if PENDING/BRIDGED/FAILED or if the working row is stale
  const res = await prisma.depositIntent.updateMany({
    where: {
      refId,
      OR: [
        { status: { in: ['PENDING', 'BRIDGED', 'FAILED'] } },
        { status: { in: ['PROCESSING', 'DEPOSITING', 'MINTING'] }, updatedAt: { lt: new Date(Date.now() - staleMs) } },
      ],
    },
    data: { status: 'PROCESSING', error: null, updatedAt: new Date() },
  })

  if (res.count === 1) return { ok: true }

  const row = await prisma.depositIntent.findUnique({ where: { refId } })
  if (!row) return { ok: false, reason: 'Unknown refId' }
  if (row.status === 'MINTED' || row.status === 'SUCCESS') return { ok: false, reason: 'Already done' }

  // include status & timestamp for easier debugging
  return { ok: false, reason: `Already processing`, status: row.status, updatedAt: row.updatedAt }
}
export async function POST(req: Request) {
  let refIdForCatch: string | undefined

  try {
    const body = await req.json().catch(() => ({}))
    console.log('[finish] body:', body)

    const refId = body?.refId as `0x${string}` | undefined
    refIdForCatch = refId
    if (!refId) return bad('refId required')

    const fromTxHash = body?.fromTxHash as `0x${string}` | undefined
    const fromChainId = body?.fromChainId as number | undefined
    const toChainId = (body?.toChainId as number | undefined) ?? LISK_ID
    const minAmountStr = body?.minAmount as string | undefined

    // try to lock (prevent parallel execution)
    const lock = await tryLockIntent(refId)
    if (!lock.ok) {
      if (lock.reason === 'Already done') return json({ ok: true, already: true })
      return json({ ok: true, processing: true, reason: lock.reason }, 202)
    }

    let intent = await prisma.depositIntent.findUnique({ where: { refId } })
    if (!intent) return bad('Unknown refId', 404)

    // Merge new facts
    const patch: any = {}
    if (fromTxHash && intent.fromTxHash !== fromTxHash) patch.fromTxHash = fromTxHash
    if (fromChainId && intent.fromChainId !== fromChainId) patch.fromChainId = fromChainId
    if (toChainId && intent.toChainId !== toChainId) patch.toChainId = toChainId
    if (minAmountStr && intent.minAmount !== minAmountStr) patch.minAmount = minAmountStr
    if (Object.keys(patch).length) {
      intent = await prisma.depositIntent.update({ where: { refId }, data: patch })
    }

    if (!intent.fromTxHash) {
      console.log('[finish] fromTxHash missing (capture via /route-progress)')
      // keep PROCESSING to avoid multiple workers contending, but allow re-call later
      return json({ ok: true, waiting: true }, 202)
    }

    const srcChain = intent.fromChainId ?? fromChainId
    const dstChain = intent.toChainId ?? toChainId
    if (!srcChain) return bad('fromChainId required')
    if (!dstChain) return bad('toChainId required')

    // 1) Wait for Li.Fi DONE (by user's tx hash)
    console.log('[finish] waiting Li.Fi by tx…')
    const { bridgedAmount, receiving } = await waitForLiFiDone({
      fromChainId: srcChain,
      toChainId: dstChain,
      fromTxHash: intent.fromTxHash as `0x${string}`,
    })
    const toTxHash = receiving?.txHash as `0x${string}` | undefined
    const toTokenAddr = receiving?.token?.address as `0x${string}` | undefined
    if (toTokenAddr && toTokenAddr.toLowerCase() !== USDT0_LISK.toLowerCase()) {
      throw new Error(`Unexpected dest token ${toTokenAddr}, expected ${USDT0_LISK}`)
    }

    await prisma.depositIntent.update({
      where: { refId },
      data: {
        status: 'BRIDGED',
        toTxHash: toTxHash ?? intent.toTxHash,
        toTokenAddress: toTokenAddr ?? intent.toTokenAddress ?? undefined,
        bridgedAmount: bridgedAmount.toString(),
      },
    })

    const amt = bridgedAmount
    if (amt <= 0n) throw new Error('Zero bridged amount')

    // 2) Deposit (idempotent + robust allowance) on Lisk via raw tx
    intent = await prisma.depositIntent.findUnique({ where: { refId } })
    const { pub: liskPub, wlt: liskWlt, account } = makeLiskClients()

    if (!intent?.depositTxHash) {
      await prisma.depositIntent.update({
        where: { refId },
        data: { status: 'DEPOSITING' },
      })



      const { depositTx } = await ensureAllowanceThenDeposit({
        pub: liskPub as PublicClient,
        account: relayer,
        chain: lisk,
        token: USDT0_LISK,
        vaultAddr: MORPHO_POOL,
        receiver: SAFEVAULT,
        amount: amt,          // bridgedAmount from Li.Fi status
        morphoAbi,
        log: console.log,
      })

      await prisma.depositIntent.update({
        where: { refId },
        data: {
          depositTxHash: depositTx,
          status: 'DEPOSITED',
        },
      })
    } else {
      console.log('[finish] deposit already done; skipping')
    }

    // 3) Mint on OP (idempotent)
    intent = await prisma.depositIntent.findUnique({ where: { refId } })
    if (!intent?.mintTxHash) {
      if (!intent || !intent.user) throw new Error('Missing user on intent row')
      await prisma.depositIntent.update({
        where: { refId },
        data: { status: 'MINTING' },
      })
      const { mintTx } = await mintReceipt(intent.user as `0x${string}`, amt)
      await prisma.depositIntent.update({
        where: { refId },
        data: { mintTxHash: mintTx, status: 'MINTED' },
      })
    } else {
      console.log('[finish] mint already done; skipping')
    }

    return json({ ok: true, refId, status: 'MINTED' })
  } catch (e: any) {
    console.error('[finish] failed:', e?.message || e)

    // best-effort: mark FAILED unless already MINTED
    try {
      if (refIdForCatch) {
        const current = await prisma.depositIntent.findUnique({ where: { refId: refIdForCatch } })
        if (current && current.status !== 'MINTED') {
          await prisma.depositIntent.update({
            where: { refId: refIdForCatch },
            data: { status: 'FAILED', error: e?.message || String(e) },
          })
        }
      }
    } catch {}
    return NextResponse.json({ ok: false, error: e?.message || 'finish failed' }, { status: 500 })
  }
}