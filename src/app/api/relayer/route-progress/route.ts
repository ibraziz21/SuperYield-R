// Next.js App Router API - Node runtime
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function json(data: any, status = 200) {
  return NextResponse.json(data, { status })
}
function bad(msg: string, code = 400) {
  console.error('[route-progress] error:', msg)
  return json({ ok: false, error: msg }, code)
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    refId: `0x${string}`
    fromTxHash?: `0x${string}` | null
    toTxHash?: `0x${string}` | null
    fromChainId?: number | null
    toChainId?: number | null
    toAddress?: `0x${string}` | null
    toTokenAddress?: `0x${string}` | null
    toTokenSymbol?: string | null
  }

  if (!body?.refId) return bad('refId required')

  const data: any = {
    updatedAt: new Date(),
  }
  if (body.fromTxHash) data.fromTxHash = body.fromTxHash
  if (body.toTxHash) data.toTxHash = body.toTxHash
  if (body.fromChainId) data.fromChainId = body.fromChainId
  if (body.toChainId) data.toChainId = body.toChainId
  if (body.toAddress) data.toAddress = body.toAddress
  if (body.toTokenAddress) data.toTokenAddress = body.toTokenAddress
  if (body.toTokenSymbol) data.toTokenSymbol = body.toTokenSymbol

  const intent = await prisma.depositIntent.update({
    where: { refId: body.refId },
    data,
  }).catch(() => null)

  if (!intent) return bad('intent not found', 404)
  return json({ ok: true })
}