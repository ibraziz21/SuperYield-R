// src/components/DepositModal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { parseUnits } from 'viem'

import type { YieldSnapshot } from '@/hooks/useYields'
import { quoteUsdceOnLisk, getBridgeQuote } from '@/lib/quotes'

import { AmountCard } from '../AmountCard'
import { BalanceStrip } from '../BalanceStrip'
import { RouteFeesCard } from '../RouteFeesCard'
import { ProgressSteps } from '../Progress'
import { ActionBar } from '../ActionBar'
import { bridgeAndDepositViaRouterPush, bridgeTokens } from '@/lib/bridge'
import { adapterKeyForSnapshot } from '@/lib/adapters'

import {
  readWalletBalance,
  symbolForWalletDisplay,
  tokenAddrFor,
} from '../helpers'
import type { EvmChain, FlowStep } from '../types'
import { TokenAddresses } from '@/lib/constants'

/* ── helpers ───────────────────────────────────────────────────── */
const VAULT_TOKEN_DECIMALS = 6
const pow10 = (n: number) => BigInt(10) ** BigInt(n)
const scaleAmount = (amt: bigint, fromDec: number, toDec: number) => {
  if (toDec === fromDec) return amt
  if (toDec > fromDec) return amt * pow10(toDec - fromDec)
  return amt / pow10(fromDec - toDec)
}
const applyBuffer998 = (amt: bigint) => (amt * 997n) / 1000n

// Since this modal is Lisk-only now, force the Lisk representation explicitly.
function toLiskDestLabel(src: YieldSnapshot['token']): 'USDCe' | 'USDT0' | 'WETH' {
  if (src === 'USDC') return 'USDCe'
  if (src === 'USDT') return 'USDT0'
  return 'WETH'
}

async function postJSON<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`POST ${url} failed: ${res.status} ${res.statusText} ${txt}`)
  }
  return res.json() as Promise<T>
}

interface DepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()

  // local state
  const [amount, setAmount] = useState('')
  const [sourceAsset, setSourceAsset] = useState<'USDC' | 'USDT'>('USDT')

  // balances
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [liBal, setLiBal] = useState<bigint | null>(null)
  const [liBalUSDT, setLiBalUSDT] = useState<bigint | null>(null)
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null)

  // extra source balances for quoting/MAX
  const [opUsdcBal, setOpUsdcBal] = useState<bigint | null>(null)
  const [baUsdcBal, setBaUsdcBal] = useState<bigint | null>(null)
  const [opUsdtBal, setOpUsdtBal] = useState<bigint | null>(null)
  const [baUsdtBal, setBaUsdtBal] = useState<bigint | null>(null)

  // routing/fee
  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(0n)
  const [received, setReceived] = useState<bigint>(0n)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  // flow state
  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStep('idle')
    setError(null)
  }, [open, amount, snap.chain, snap.token, snap.protocolKey])

  const tokenDecimals = useMemo(() => (snap.token === 'WETH' ? 18 : 6), [snap.token])

  // Lisk dest label (authoritative)
  const destTokenLabel = useMemo(() => toLiskDestLabel(snap.token), [snap.token])

  // treat as USDT-family if src is USDT or dest is USDT0
  const isUsdtFamily = useMemo(() => snap.token === 'USDT' || destTokenLabel === 'USDT0', [snap.token, destTokenLabel])

  /* -------- Wallet balances (OP/Base/Lisk) -------- */
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account.address as `0x${string}`

    const opSym = symbolForWalletDisplay(snap.token, 'optimism')
    const baSym = symbolForWalletDisplay(snap.token, 'base')
    const liSym = symbolForWalletDisplay(snap.token, 'lisk')

    const addrOrNull = (sym: YieldSnapshot['token'], ch: EvmChain) => {
      try { return tokenAddrFor(sym, ch) } catch { return null }
    }

    const opAddr = addrOrNull(opSym, 'optimism')
    const baAddr = addrOrNull(baSym, 'base')
    const liAddr = addrOrNull(liSym, 'lisk')

    const reads: Promise<bigint | null>[] = [
      opAddr ? readWalletBalance('optimism', opAddr, user) : Promise.resolve(null),
      baAddr ? readWalletBalance('base',     baAddr, user) : Promise.resolve(null),
      liAddr ? readWalletBalance('lisk',     liAddr, user) : Promise.resolve(null),
    ]

    // Lisk USDT & USDT0 extra
    const liskUSDTAddr  = (TokenAddresses.USDT  as any)?.lisk as `0x${string}` | undefined
    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)?.lisk as `0x${string}` | undefined
    if (isUsdtFamily) {
      reads.push(liskUSDTAddr  ? readWalletBalance('lisk', liskUSDTAddr,  user) : Promise.resolve(null))
      reads.push(liskUSDT0Addr ? readWalletBalance('lisk', liskUSDT0Addr, user) : Promise.resolve(null))
    } else {
      reads.push(Promise.resolve(null), Promise.resolve(null))
    }

    // extra OP/Base USDC+USDT
    const opUsdc = addrOrNull('USDC', 'optimism')
    const baUsdc = addrOrNull('USDC', 'base')
    const opUsdt = addrOrNull('USDT', 'optimism')
    const baUsdt = addrOrNull('USDT', 'base')

    if (opUsdc) reads.push(readWalletBalance('optimism', opUsdc, user)); else reads.push(Promise.resolve(null))
    if (baUsdc) reads.push(readWalletBalance('base',     baUsdc, user)); else reads.push(Promise.resolve(null))
    if (opUsdt) reads.push(readWalletBalance('optimism', opUsdt, user)); else reads.push(Promise.resolve(null))
    if (baUsdt) reads.push(readWalletBalance('base',     baUsdt, user)); else reads.push(Promise.resolve(null))

    Promise.allSettled(reads).then((vals) => {
      const v = vals.map((r) => (r.status === 'fulfilled' ? (r as any).value as bigint | null : null))
      const [op, ba, li, liU, liU0, _opUsdc, _baUsdc, _opUsdt, _baUsdt] = v
      setOpBal(op ?? null)
      setBaBal(ba ?? null)
      setLiBal(li ?? null)
      setLiBalUSDT(liU ?? null)
      setLiBalUSDT0(liU0 ?? null)
      setOpUsdcBal(_opUsdc ?? null)
      setBaUsdcBal(_baUsdc ?? null)
      setOpUsdtBal(_opUsdt ?? null)
      setBaUsdtBal(_baUsdt ?? null)
    })
  }, [open, walletClient, snap.token, isUsdtFamily])

  /* -------- Source-asset defaulting heuristic -------- */
  useEffect(() => {
    if (!amount) return
    if (snap.chain === 'lisk' && isUsdtFamily) setSourceAsset('USDT')
    else setSourceAsset('USDC')
  }, [amount, snap.chain, isUsdtFamily])

  /* -------- Quote (Lisk-only) -------- */
  useEffect(() => {
    if (!walletClient || !amount) {
      setRoute(null); setFee(0n); setReceived(0n); setQuoteError(null)
      return
    }

    const dest = snap.chain as EvmChain
    if (dest !== 'lisk') {
      setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Only Lisk deposits are supported')
      return
    }

    const amt = parseUnits(amount, tokenDecimals)

    const pickSrcBy = (o?: bigint | null, b?: bigint | null): 'optimism' | 'base' => {
      const op = o ?? 0n
      const ba = b ?? 0n
      if (op >= amt) return 'optimism'
      if (ba >= amt) return 'base'
      return op >= ba ? 'optimism' : 'base'
    }

    if (destTokenLabel === 'USDT0') {
      const src = sourceAsset === 'USDC' ? pickSrcBy(opUsdcBal, baUsdcBal) : pickSrcBy(opUsdtBal, baUsdtBal)
      getBridgeQuote({
        token: 'USDT0',
        amount: amt,
        from: src,
        to: dest,
        fromAddress: walletClient.account!.address as `0x${string}`,
        fromTokenSym: sourceAsset, // << important
      })
        .then((q) => { setRoute(q.route); setFee(q.bridgeFeeTotal); setReceived(q.bridgeOutAmount); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
      return
    }

    if (destTokenLabel === 'USDCe') {
      if ((liBal ?? 0n) >= amt) { setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null); return }
      quoteUsdceOnLisk({
        amountIn: amt,
        opBal, baBal,
        fromAddress: walletClient.account!.address as `0x${string}`,
      })
        .then((q) => { setRoute(q.route); setFee(q.bridgeFee); setReceived(q.bridgeOutUSDCe); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
      return
    }

    // WETH to Lisk (no receipts)
    setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null)
  }, [
    amount, walletClient, tokenDecimals, snap.chain, snap.token, destTokenLabel,
    opBal, baBal, liBal, liBalUSDT, liBalUSDT0,
    sourceAsset, opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal,
  ])

  async function handleConfirm() {
    if (!walletClient) { openConnect(); return }
    setError(null)
  
    try {
      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const amtToMint = applyBuffer998(inputAmt)
      const user = walletClient.account!.address as `0x${string}`
  
      if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')
  
      // Decide once, then use everywhere
      const dest = 'lisk' as const
      const destLabelForBridge = (snap.token === 'USDC' ? 'USDCe' : snap.token === 'USDT' ? 'USDT0' : 'WETH') as
        | 'USDCe' | 'USDT0' | 'WETH'
      const mustMint = destLabelForBridge !== 'WETH'
  
      // Helper for OP/Base source selection
      const pickSrcBy = (o?: bigint | null, b?: bigint | null): 'optimism' | 'base' => {
        const op = o ?? 0n, ba = b ?? 0n
        if (op >= inputAmt) return 'optimism'
        if (ba >= inputAmt) return 'base'
        return op >= ba ? 'optimism' : 'base'
      }
  
      setStep('bridging')
  
      if (destLabelForBridge === 'USDT0') {
        // USDT0 path: bridge to relayer (respect the selected source asset), then mint 1:1 USDT receipts
        const src = sourceAsset === 'USDC'
          ? pickSrcBy(opUsdcBal, baUsdcBal)
          : pickSrcBy(opUsdtBal, baUsdtBal)
  
          const adapterKey = adapterKeyForSnapshot(snap)
          await bridgeAndDepositViaRouterPush({
            user,
            destToken: 'USDT0',
            srcChain: src,
            srcToken: sourceAsset,       // 'USDC' or 'USDT' as selected
            amount: inputAmt,
            adapterKey,
            walletClient,
          })
  
        // MUST mint (USDT vault), no success until this resolves
        const mintBody = { userAddress: user, tokenAmt: amtToMint.toString(), tokenKind: 'USDT' as const }
        console.info('[mint] POST /api/mintVault (USDT0→USDT)', mintBody)
        const res = await fetch('/api/mintVault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mintBody),
        })
        if (!res.ok) throw new Error(`/api/mintVault failed: ${res.status} ${await res.text().catch(()=>'')}`)
        const json = await res.json()
        if (!json?.success) throw new Error(json?.message || 'Minting failed')
  
        setStep('success')
        return
      }
  
      // Router-push deposit for USDCe/WETH
      const adapterKey = adapterKeyForSnapshot(snap)
      const srcToken = destLabelForBridge === 'USDCe' ? 'USDC' : 'WETH'
      const srcChain: 'optimism' | 'base' =
        srcToken === 'USDC' ? pickSrcBy(opUsdcBal, baUsdcBal) : pickSrcBy(opBal, baBal)
  
      await bridgeAndDepositViaRouterPush({
        user,
        destToken: destLabelForBridge,
        srcChain,
        srcToken: srcToken as 'USDC' | 'WETH',
        amount: inputAmt,
        adapterKey,
        walletClient,
      })
  
      // Mint receipts for USDCe only (WETH skips mint)
      if (mustMint && destLabelForBridge === 'USDCe') {
        const effectiveBase = applyBuffer998(inputAmt)
        const sharesToMint = scaleAmount(effectiveBase, tokenDecimals, VAULT_TOKEN_DECIMALS)
        const mintBody = { userAddress: user, tokenAmt: sharesToMint.toString(), tokenKind: 'USDC' as const }
        console.info('[mint] POST /api/mintVault (USDCe→USDC)', mintBody)
        const res = await fetch('/api/mintVault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mintBody),
        })
        if (!res.ok) throw new Error(`/api/mintVault failed: ${res.status} ${await res.text().catch(()=>'')}`)
        const json = await res.json()
        if (!json?.success) throw new Error(json?.message || 'Minting failed')
      }
  
      setStep('success')
    } catch (e: any) {
      console.error('[ui] deposit error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }
  

  /* -------- UI flags -------- */
  const hasAmount = amount.trim().length > 0 && Number(amount) > 0
  const confirmDisabled = step !== 'idle' ? true : !hasAmount || Boolean(quoteError)
  const showForm = step === 'idle'
  const showProgress = step !== 'idle' && step !== 'success' && step !== 'error'
  const showSuccess = step === 'success'
  const showError = step === 'error'
  const isLiskTarget = snap.chain === 'lisk'

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="p-0 overflow-hidden shadow-xl w-[min(100vw-1rem,44rem)] sm:max-w-2xl rounded-xl">
        <div className="bg-gradient-to-r from-teal-600 to-cyan-500 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="text-white text-base font-semibold sm:text-lg flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white text-xs font-bold">
                {destTokenLabel}
              </span>
              Deposit to {snap.protocol} on <span className="underline decoration-white/40 underline-offset-4">
                {(snap.chain as string).toUpperCase()}
              </span>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 bg-white">
            {showForm && (
              <>
                <AmountCard
                  amount={amount}
                  setAmount={setAmount}
                  tokenDecimals={tokenDecimals}
                  snap={snap}
                  isLiskTarget={isLiskTarget}
                  destTokenLabel={destTokenLabel}
                  isUsdtFamily={isUsdtFamily}
                  opBal={opBal}
                  baBal={baBal}
                  liBal={liBal}
                  liBalUSDT={liBalUSDT}
                  liBalUSDT0={liBalUSDT0}
                  sourceAsset={sourceAsset}
                  opUsdcBal={opUsdcBal}
                  baUsdcBal={baUsdcBal}
                  opUsdtBal={opUsdtBal}
                  baUsdtBal={baUsdtBal}
                />

                {isLiskTarget && destTokenLabel === 'USDT0' && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Source asset on OP/Base</div>
                    <div className="inline-flex rounded-md bg-gray-100 p-1">
                      {(['USDC','USDT'] as const).map(a => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setSourceAsset(a)}
                          className={`px-3 py-1 text-xs rounded ${sourceAsset === a ? 'bg-white shadow font-medium' : 'opacity-70'}`}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <BalanceStrip
                  tokenDecimals={tokenDecimals}
                  snap={snap}
                  isLiskTarget={isLiskTarget}
                  isUsdtFamily={isUsdtFamily}
                  symbolForWalletDisplay={symbolForWalletDisplay}
                  opBal={opBal}
                  baBal={baBal}
                  liBal={liBal}
                  liBalUSDT={liBalUSDT}
                  liBalUSDT0={liBalUSDT0}
                  opUsdcBal={opUsdcBal}
                  baUsdcBal={baUsdcBal}
                  opUsdtBal={opUsdtBal}
                  baUsdtBal={baUsdtBal}
                />

                <RouteFeesCard
                  route={route}
                  fee={fee}
                  received={received}
                  tokenDecimals={tokenDecimals}
                  tokenSymbol={snap.token}
                  quoteError={quoteError}
                  destChainLabel={(snap.chain as string).toUpperCase()}
                  destTokenLabel={destTokenLabel}
                  sourceAsset={isLiskTarget && destTokenLabel === 'USDT0' ? sourceAsset : undefined}
                />

                {error && <p className="text-xs text-red-600">{error}</p>}
              </>
            )}

            <ProgressSteps step={step} show={showProgress} crossChain />

            {showSuccess && (
              <div className="flex flex-col items-center gap-3 py-6">
                <svg className="h-10 w-10 text-green-600" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" stroke="currentColor" strokeWidth="2"/>
                </svg>
                <div className="text-center">
                  <div className="text-lg font-semibold">Deposit successful</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Your {snap.token} was bridged to Lisk and deposited via our relayer.
                  </div>
                </div>
              </div>
            )}

            {showError && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="text-lg font-semibold text-red-600">Transaction failed</div>
                <div className="text-sm text-muted-foreground">{error}</div>
              </div>
            )}
          </div>

          <ActionBar
            step={step}
            confirmDisabled={confirmDisabled}
            onConfirm={handleConfirm}
            onClose={onClose}
            onRetry={() => setStep('idle')}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
