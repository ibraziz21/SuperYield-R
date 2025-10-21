// src/app/api/create-intent/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyTypedData } from 'viem'
import { optimism, base } from 'viem/chains'
import { prisma } from '@/lib/db'

type ChainSrc = 'optimism' | 'base'

function json(x: any, s = 200) { return NextResponse.json(x, { status: s }) }
function bad(m: string, s = 400) { return json({ ok: false, error: m }, s) }

export async function POST(req: Request) {
  const { intent, signature } = await req.json().catch(() => ({})) as {
    intent?: {
      user: `0x${string}`
      // optional in your current schema — we’ll write it only if present
      adapterKey?: `0x${string}`
      asset: `0x${string}`           // Lisk USDT0
      amount: string                 // minAmount (decimal string)
      deadline: string
      nonce: string
      refId: `0x${string}`
      // non-signed, just context
      fromChain?: ChainSrc
      srcToken?: 'USDC' | 'USDT'
    }
    signature?: `0x${string}`
  }

  if (!intent || !signature) return bad('intent/signature required')
  if (!intent.user || !intent.asset || !intent.amount || !intent.deadline || !intent.nonce || !intent.refId) {
    return bad('missing intent fields')
  }

  // EIP-712 domain/types/message — sign on the source chain’s id (OP/Base)
  const chainId = intent.fromChain === 'base' ? base.id : optimism.id
  const domain = { name: 'SuperYLDR', version: '1', chainId }
  const types = {
    DepositIntent: [
      { name: 'user',     type: 'address' },
      { name: 'key',      type: 'bytes32' },   // adapterKey (can be 0x0 if you’re not storing it yet)
      { name: 'asset',    type: 'address' },
      { name: 'amount',   type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce',    type: 'uint256' },
      { name: 'refId',    type: 'bytes32' },
    ],
  } as const

  // If your current signer typed data used a real adapterKey, pass it; otherwise use 0x00…00
  const adapterKeyForSig = (intent.adapterKey ??
    '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`

  const ok = await verifyTypedData({
    address: intent.user,
    domain,
    types,
    primaryType: 'DepositIntent',
    message: {
      user: intent.user,
      key: adapterKeyForSig,
      asset: intent.asset,
      amount: BigInt(intent.amount),
      deadline: BigInt(intent.deadline),
      nonce: BigInt(intent.nonce),
      refId: intent.refId,
    },
    signature,
  }).catch(() => false)

  if (!ok) return bad('invalid signature', 401)

  // Build minimal upsert payloads.
  // NOTE: We cast to `any` so this continues compiling even if your Prisma model
  // doesn’t include some optional fields like `adapterKey` yet.
  const baseCreate = {
    refId: intent.refId,
    user: intent.user,
    asset: intent.asset,
    amount: intent.amount,   // store as string
    minAmount: intent.amount, // mirror for convenience
    deadline: intent.deadline,
    nonce: intent.nonce,
    status: 'PENDING',
  } as any

  const baseUpdate = {
    user: intent.user,
    asset: intent.asset,
    amount: intent.amount,
    minAmount: intent.amount,
    deadline: intent.deadline,
    nonce: intent.nonce,
    status: 'PENDING',
    updatedAt: new Date(),
  } as any

  // Optionally include adapterKey if:
  //  a) you signed with a real key, and
  //  b) your schema contains this column (safe to leave — extra keys are ignored at runtime by Postgres,
  //     but Prisma types would complain, hence the `any` cast above).
  if (intent.adapterKey) {
    baseCreate.adapterKey = intent.adapterKey
    baseUpdate.adapterKey = intent.adapterKey
  }

  // Also store non-signed context if you added these columns later (optional)
  if (intent.fromChain) {
    baseCreate.fromChainId = intent.fromChain === 'base' ? base.id : optimism.id
    baseUpdate.fromChainId = intent.fromChain === 'base' ? base.id : optimism.id
  }
  // if (intent.srcToken) {
  //   baseCreate.srcToken = intent.srcToken
  //   baseUpdate.srcToken = intent.srcToken
  // }

  const row = await prisma.depositIntent.upsert({
    where: { refId: intent.refId },
    create: baseCreate,
    update: baseUpdate,
  })

  return json({ ok: true, refId: row.refId })
}