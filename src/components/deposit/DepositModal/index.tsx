// src/components/DepositModal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { keccak256, parseUnits } from 'viem'
import { getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'
import { optimism, base, lisk as liskChain } from 'viem/chains'

import type { YieldSnapshot } from '@/hooks/useYields'
import { quoteUsdceOnLisk, getBridgeQuote } from '@/lib/quotes'

import { AmountCard } from '../AmountCard'
import { BalanceStrip } from '../BalanceStrip'
import { RouteFeesCard } from '../RouteFeesCard'
import { ProgressSteps } from '../Progress'
import { ActionBar } from '../ActionBar'
import { bridgeAndDepositViaRouterPush, configureLifiWith } from '@/lib/bridge'
import { adapterKeyForSnapshot } from '@/lib/adapters'

import {
  readWalletBalance,
  symbolForWalletDisplay,
  tokenAddrFor,
} from '../helpers'
import type { EvmChain, FlowStep } from '../types'
import { TokenAddresses, RELAYER_LISK } from '@/lib/constants'

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
async function ensureWalletChain(walletClient: any, chainId: number) {
  // no-op if already on this chain
  try {
    // Some wallet clients expose .chain.id; if not, the switch will just be idempotent
    if ((walletClient as any)?.chain?.id === chainId) return
  } catch {}
  await walletClient.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  })
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

  // routing/fee (UI only)
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

  const VAULT_TOKEN_DECIMALS = 6
  const pow10 = (n: number) => BigInt(10) ** BigInt(n)
  const scaleAmount = (amt: bigint, fromDec: number, toDec: number) => {
    if (toDec === fromDec) return amt
    if (toDec > fromDec) return amt * pow10(toDec - fromDec)
    return amt / pow10(fromDec - toDec)
  }
  const applyBuffer998 = (amt: bigint) => (amt * 997n) / 1000n
  
  // quick 32-byte random refId
  function randomRefId(): `0x${string}` {
    const b = new Uint8Array(32)
    crypto.getRandomValues(b)
    // tiny hash to uniformize
    const h = keccak256(b)
    return h as `0x${string}`
  }
  
  // tap hashes from a Li.Fi route update (origin/dest)
  function tapHashes(route: any) {
    const steps = route?.steps || []
    const first = steps[0]
    const last = steps[steps.length - 1]
  
    const originProc = first?.execution?.process?.find((p: any) => p?.txHash)
    const destProc   = last?.execution?.process?.find((p: any) => p?.txHash)
  
    return {
      fromTxHash: originProc?.txHash as `0x${string}` | undefined,
      toTxHash: destProc?.txHash as `0x${string}` | undefined,
      fromChainId: route?.fromChainId ?? first?.action?.fromChainId,
      toChainId: route?.toChainId ?? last?.action?.toChainId,
      toAddress: last?.action?.toAddress,
      toTokenAddress: last?.action?.toToken?.address,
      toTokenSymbol: last?.action?.toToken?.symbol,
    }
  }
  
  async function handleConfirm() {
    if (!walletClient) { openConnect(); return }
    setError(null)
  
    try {
      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const user = walletClient.account!.address as `0x${string}`
      if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')
  
      // Which Lisk asset are we targeting?
      const destLabelForBridge =
        snap.token === 'USDC' ? 'USDCe' :
        snap.token === 'USDT' ? 'USDT0' :
        'WETH' as 'USDCe'|'USDT0'|'WETH'
  
      // Helper for OP/Base selection
      const pickSrcBy = (o?: bigint | null, b?: bigint | null): 'optimism' | 'base' => {
        const op = o ?? 0n, ba = b ?? 0n
        if (op >= inputAmt) return 'optimism'
        if (ba >= inputAmt) return 'base'
        return op >= ba ? 'optimism' : 'base'
      }
  
      /* ──────────────────────────────────────────────────────────
         PATH A: USDT0 → Intent + tx-hash based settlement
         ────────────────────────────────────────────────────────── */
      if (destLabelForBridge === 'USDT0') {
        if (!RELAYER_LISK || RELAYER_LISK === '0xREPLACE_ME') {
          throw new Error('Relayer address not configured (NEXT_PUBLIC_LISK_RELAYER)')
        }
  
        // choose src chain & token for bridge (USDC or USDT)
        const srcToken = sourceAsset // 'USDC' | 'USDT' (picked in UI)
        const fromChain: 'optimism' | 'base' =
          srcToken === 'USDC' ? pickSrcBy(opUsdcBal, baUsdcBal) : pickSrcBy(opUsdtBal, baUsdtBal)
  
        // 1) Sign intent (anti-spoofing)
        const adapterKey = adapterKeyForSnapshot(snap)
        const assetLisk  = tokenAddrFor('USDT0', 'lisk')
        const minAmount  = applyBuffer998(inputAmt) // 0.3% slack
        const deadline   = BigInt(Math.floor(Date.now()/1000) + 20*60) // 20m
        const nonce      = BigInt(Math.floor(Math.random() * 1e12))
        const refId      = randomRefId()
  
        // EIP-712 domain/types/message (sign on the src chain’s id)
        const chainIdForSig = fromChain === 'optimism' ? optimism.id : base.id

        await ensureWalletChain(walletClient, chainIdForSig)
        const domain = { name: 'SuperYLDR', version: '1', chainId: chainIdForSig }
        const types = {
          DepositIntent: [
            { name: 'user',     type: 'address'  },
            { name: 'key',      type: 'bytes32'  },
            { name: 'asset',    type: 'address'  },
            { name: 'amount',   type: 'uint256'  },
            { name: 'deadline', type: 'uint256'  },
            { name: 'nonce',    type: 'uint256'  },
            { name: 'refId',    type: 'bytes32'  },
          ],
        } as const
        const message = {
          user,
          key: adapterKey,
          asset: assetLisk,
          amount: minAmount,
          deadline,
          nonce,
          refId,
        } as const
  
        // NB: wagmi/viem signTypedData requires explicit type assertions
        const signature = await walletClient.signTypedData({
          account: user,
          domain,
          types,
          primaryType: 'DepositIntent',
          message,
        } as any)
  
        // 2) Create intent (server verifies signature, stores row)
        const createRes = await fetch('/api/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: {
              user,
              adapterKey,
              asset: assetLisk,
              amount: minAmount.toString(),
              deadline: deadline.toString(),
              nonce: nonce.toString(),
              refId,
              // helpful context (not signed): fromChain, srcToken
              fromChain,
              srcToken,
            },
            signature,
          }),
        })
        if (!createRes.ok) throw new Error(`/api/create-intent failed: ${createRes.status} ${await createRes.text().catch(()=> '')}`)
        const created = await createRes.json()
        if (!created?.ok) throw new Error(created?.error || 'Failed to create intent')
  
        // 3) Bridge with Li.Fi → toAddress = RELAYER (USDT0 only)
        configureLifiWith(walletClient)
        setStep('bridging')
  
        const { id: fromChainId } = fromChain === 'optimism' ? optimism : base
        const { id: toChainId }   = liskChain
        const fromToken = tokenAddrFor(srcToken, fromChain)
        const toToken   = tokenAddrFor('USDT0', 'lisk')
  
        const quote = await getQuote({
          fromChain: fromChainId,
          toChain: toChainId,
          fromToken,
          toToken,                     // enforce USDT0
          fromAmount: inputAmt.toString(),
          fromAddress: user,
          toAddress: RELAYER_LISK,     // enforce relayer receiver
          slippage: 0.003,
        })
        const routeObj = convertQuoteToRoute(quote)
  
        // pre-kick finisher with refId (it will wait for tx hash update)
        fetch('/api/relayer/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refId,
            fromChainId,
            toChainId: 1135,
            minAmount: minAmount.toString(),
          }),
        }).catch(()=>{})
  
        let seenFromTx: `0x${string}` | undefined
  
        await executeRoute(routeObj, {
          updateRouteHook: async (updated) => {
            // capture tx hashes and persist (idempotent)
            const snap = tapHashes(updated)
            if (snap.fromTxHash && snap.fromTxHash !== seenFromTx) {
              seenFromTx = snap.fromTxHash
              // upsert progress snapshot
              fetch('/api/relayer/route-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refId, ...snap }),
              }).catch(()=>{})
              // nudge finisher with concrete tx hash (tx-hash based status)
              fetch('/api/relayer/finish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  refId,
                  fromTxHash: snap.fromTxHash,
                  fromChainId: snap.fromChainId,
                  toChainId: 1135,
                  minAmount: minAmount.toString(),
                }),
              }).catch(()=>{})
            }
          },
          switchChainHook: async (chainId) => {
            await walletClient.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${chainId.toString(16)}` }],
            })
            return walletClient
          },
          acceptExchangeRateUpdateHook: async () => true,
        })
  
        // 4) Block until backend finishes deposit+mint (optional UI)
        setStep('depositing')
        const finishRes = await fetch('/api/relayer/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refId,
            ...(seenFromTx ? { fromTxHash: seenFromTx } : { fromChainId }),
            toChainId: 1135,
            minAmount: minAmount.toString(),
          }),
        })
        if (!finishRes.ok) throw new Error(`/api/relayer/finish failed: ${finishRes.status} ${await finishRes.text().catch(()=> '')}`)
        const finishJson = await finishRes.json()
        if (!finishJson?.ok) throw new Error(finishJson?.error || 'Settlement failed')
  
        setStep('success')
        return
      }
  
      /* ──────────────────────────────────────────────────────────
         PATH B: USDCe / WETH (router-push + (optional) OP mint)
         ────────────────────────────────────────────────────────── */
      const adapterKey = adapterKeyForSnapshot(snap)
      const srcToken =
        destLabelForBridge === 'USDCe' ? 'USDC' : 'WETH'
      const srcChain: 'optimism' | 'base' =
        srcToken === 'USDC' ? pickSrcBy(opUsdcBal, baUsdcBal) : pickSrcBy(opBal, baBal)
  
      setStep('bridging')
      await bridgeAndDepositViaRouterPush({
        user,
        destToken: destLabelForBridge,
        srcChain,
        srcToken: srcToken as 'USDC' | 'WETH',
        amount: inputAmt,
        adapterKey,
        walletClient,
      })
  
      if (destLabelForBridge === 'USDCe') {
        setStep('depositing')
        const sharesToMint = scaleAmount(applyBuffer998(inputAmt), tokenDecimals, VAULT_TOKEN_DECIMALS)
        const mintRes = await fetch('/api/mintVault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: user,
            tokenAmt: sharesToMint.toString(),
            tokenKind: 'USDC',
          }),
        })
        if (!mintRes.ok) throw new Error(`/api/mintVault failed: ${mintRes.status} ${await mintRes.text().catch(()=> '')}`)
        const j = await mintRes.json()
        if (!j?.success) throw new Error(j?.message || 'Minting failed')
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
