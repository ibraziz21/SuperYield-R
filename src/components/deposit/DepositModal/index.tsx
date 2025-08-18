'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { base, optimism, lisk as liskChain } from 'viem/chains'
import type { YieldSnapshot } from '@/hooks/useYields'
import { ensureLiquidity } from '@/lib/smartbridge'
import { depositToPool } from '@/lib/depositor'
import { quoteUsdceOnLisk, smartQuoteUsdt0Lisk, getBridgeQuote } from '@/lib/quotes'

import { AmountCard } from '../AmountCard'
import { BalanceStrip } from '../BalanceStrip'
import { RouteFeesCard } from '../RouteFeesCard'
import { SuppliedCard } from '../SuppliedCard'
import { ProgressSteps } from '../Progress'
import { ActionBar } from '../ActionBar'

import { ChainPill } from '../ui'
import { getAaveSuppliedBalance, getCometSuppliedBalance, isCometToken, clientFor, readWalletBalance, symbolForWalletDisplay, mapCrossTokenForDest, tokenAddrFor, chainIdOf } from '../helpers'
import type { EvmChain, FlowStep } from '../types'
import { TokenAddresses } from '@/lib/constants'

interface DepositModalProps { open: boolean; onClose: () => void; snap: YieldSnapshot }

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, error: switchError } = useSwitchChain()

  const [amount, setAmount] = useState('')

  // Wallet balances
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [liBal, setLiBal] = useState<bigint | null>(null)
  const [liBalUSDT, setLiBalUSDT] = useState<bigint | null>(null)
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null)

  // Supplied balances (Aave/Comet display only)
  const [poolOp, setPoolOp] = useState<bigint | null>(null)
  const [poolBa, setPoolBa] = useState<bigint | null>(null)

  // Routing / fees / flow
  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(0n)
  const [received, setReceived] = useState<bigint>(0n)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [liquidityEnsured, setLiquidityEnsured] = useState(false)

  // Reset when inputs change
  useEffect(() => { setLiquidityEnsured(false); setStep('idle'); setError(null) }, [open, amount, snap.chain, snap.token, snap.protocolKey])

  const tokenDecimals = useMemo(() => (snap.token === 'WETH' ? 18 : 6), [snap.token])
  const poolDecimals = useMemo(() => (snap.protocolKey === 'aave-v3' ? 8 : snap.protocolKey === 'compound-v3' ? 6 : tokenDecimals), [snap.protocolKey, tokenDecimals])

  /* ---------------- Wallet balances (OP/Base/Lisk) ---------------- */
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

    // Lisk USDT & USDT0 extra (display convenience)
    const liskUSDTAddr  = (TokenAddresses.USDT  as any)?.lisk as `0x${string}` | undefined
    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)?.lisk as `0x${string}` | undefined
    const isUsdtFamily = snap.token === 'USDT' || snap.token === 'USDT0'
    if (isUsdtFamily) {
      reads.push(liskUSDTAddr  ? readWalletBalance('lisk', liskUSDTAddr,  user) : Promise.resolve(null))
      reads.push(liskUSDT0Addr ? readWalletBalance('lisk', liskUSDT0Addr, user) : Promise.resolve(null))
    } else {
      reads.push(Promise.resolve(null), Promise.resolve(null))
    }

    Promise.allSettled(reads).then((vals) => {
      const [op, ba, li, liU, liU0] = vals.map((r) => (r.status === 'fulfilled' ? (r as any).value as bigint | null : null))
      setOpBal(op ?? null)
      setBaBal(ba ?? null)
      setLiBal(li ?? null)
      setLiBalUSDT(liU ?? null)
      setLiBalUSDT0(liU0 ?? null)
    })
  }, [open, walletClient, snap.token])

  /* ---------------- Supplied balances (display only) ---------------- */
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account.address as `0x${string}`

    if (snap.protocolKey === 'aave-v3') {
      Promise.allSettled([
        getAaveSuppliedBalance({ chain: 'optimism', user }),
        getAaveSuppliedBalance({ chain: 'base', user }),
      ]).then((rs) => {
        const [op, ba] = rs.map((r) => (r.status === 'fulfilled' ? (r as any).value : 0n))
        setPoolOp(op)
        setPoolBa(ba)
      })
    } else if (snap.protocolKey === 'compound-v3') {
      if (isCometToken(snap.token)) {
        Promise.allSettled([
          getCometSuppliedBalance({ chain: 'optimism', token: snap.token as any, user }),
          getCometSuppliedBalance({ chain: 'base',     token: snap.token as any, user }),
        ]).then((rs) => {
          const [op, ba] = rs.map((r) => (r.status === 'fulfilled' ? (r as any).value : 0n))
          setPoolOp(op); setPoolBa(ba)
        })
      } else { setPoolOp(0n); setPoolBa(0n) }
    } else { setPoolOp(null); setPoolBa(null) }
  }, [open, walletClient, snap.protocolKey, snap.token])

  /* ---------------- Quote (LI.FI) ---------------- */
  useEffect(() => {
    if (!walletClient || !amount) { setRoute(null); setFee(0n); setReceived(0n); setQuoteError(null); return }

    const dest = snap.chain as EvmChain
    const amt  = parseUnits(amount, tokenDecimals)

    // token form on destination (e.g., Lisk USDT0/USDCe)
    const destOutSymbol = mapCrossTokenForDest(snap.token, dest)

    // choose source (OP/Base)
    const src: Extract<EvmChain, 'optimism' | 'base'> =
      (opBal ?? 0n) >= amt ? 'optimism' : (baBal ?? 0n) >= amt ? 'base' : ( (opBal ?? 0n) >= (baBal ?? 0n) ? 'optimism' : 'base')

    if (src === dest) { setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null); return }

    // Lisk USDT0 wrapper
    if (dest === 'lisk' && destOutSymbol === 'USDT0') {
      smartQuoteUsdt0Lisk({ amountIn: amt, opBal, baBal, fromAddress: walletClient.account!.address })
        .then((q) => { setRoute(q.route); setFee(q.bridgeFee); setReceived(q.bridgeOutUSDT0); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
      return
    }

    // Lisk USDCe wrapper (short-circuit if already enough on Lisk)
    if (dest === 'lisk' && destOutSymbol === 'USDCe') {
      if ((liBal ?? 0n) >= amt) { setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null); return }
      quoteUsdceOnLisk({ amountIn: amt, opBal, baBal, fromAddress: walletClient.account!.address })
        .then((q) => { setRoute(q.route); setFee(q.bridgeFee); setReceived(q.bridgeOutUSDCe); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
      return
    }

    // Generic LI.FI quote for other cross-chain cases
    getBridgeQuote({ token: destOutSymbol as any, amount: amt, from: src, to: dest, fromAddress: walletClient.account!.address })
      .then((q) => { setRoute(q.route); setFee(q.bridgeFeeTotal); setReceived(q.bridgeOutAmount); setQuoteError(null) })
      .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
  // include balances so we re-evaluate once they load
  }, [amount, walletClient, opBal, baBal, liBal, liBalUSDT, liBalUSDT0, snap.chain, snap.token, tokenDecimals])

  async function handleConfirm() {
    if (!walletClient) { openConnect(); return }
    setError(null)

    try {
      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const dest = snap.chain as EvmChain
      const destId = chainIdOf(dest)
      const user = walletClient.account!.address as `0x${string}`

      let bridgedDelta: bigint = 0n

      // 1) Single call: bridge (if needed) AND wait for funds to land
      if (!liquidityEnsured && route && route !== 'On-chain') {
        setStep('bridging')
        const wantDestToken = mapCrossTokenForDest(snap.token, dest) // e.g., 'USDT0' on Lisk
        const res = await ensureLiquidity(wantDestToken, inputAmt, dest, walletClient, {
          onStatus: (s) => { if (s === 'waiting') setStep('waitingFunds'); else if (s === 'bridging') setStep('bridging') },
        })
        bridgedDelta = res.delta
        setLiquidityEnsured(true)
      } else { setLiquidityEnsured(true) }

      // 2) Switch to destination chain (if needed)
      if (chainId !== destId && switchChainAsync) { setStep('switching'); await switchChainAsync({ chainId: destId }) }

      // 3) Deposit: read fresh balance of the destination token and deposit up to the intended amount
      const finalTokenAddr = tokenAddrFor(mapCrossTokenForDest(snap.token, dest), dest)
      const finalBal = await readWalletBalance(dest, finalTokenAddr, user)
      const cap = inputAmt
           const toDeposit =
             route !== 'On-chain'
               ? (bridgedDelta > 0n ? (bridgedDelta > cap ? cap : bridgedDelta) : (finalBal >= cap ? cap : finalBal))
               : (finalBal >= cap ? cap : finalBal)
      
           if (toDeposit === 0n) throw new Error('No funds available to deposit yet')

      setStep('depositing')
      await depositToPool(snap, toDeposit, walletClient)

      setStep('success')
    } catch (e: any) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  /* =============================================================================
     Derived UI flags
     ============================================================================= */
  const hasAmount = amount.trim().length > 0 && Number(amount) > 0
  const confirmDisabled = step !== 'idle' ? true : !hasAmount || Boolean(quoteError)

  const showForm = step === 'idle'
  const showProgress = step !== 'idle' && step !== 'success' && step !== 'error'
  const showSuccess = step === 'success'
  const showError = step === 'error'

  const isLiskTarget = snap.chain === 'lisk'
  const isUsdtFamily = snap.token === 'USDT' || snap.token === 'USDT0'
  const destTokenLabel = mapCrossTokenForDest(snap.token, snap.chain as EvmChain)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="p-0 overflow-hidden shadow-xl w-[min(100vw-1rem,44rem)] sm:max-w-2xl rounded-xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-cyan-500 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="text-white text-base font-semibold sm:text-lg flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white text-xs font-bold">{destTokenLabel}</span>
              Deposit to {snap.protocol} on <span className="underline decoration-white/40 underline-offset-4">{(snap.chain as string).toUpperCase()}</span>
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Body */}
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
                />

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
                />

                {(poolOp != null || poolBa != null) && (
                  <SuppliedCard poolOp={poolOp} poolBa={poolBa} poolDecimals={poolDecimals} tokenSymbol={snap.token} />
                )}

                {switchError && <p className="text-xs text-red-600">Network switch failed: {switchError.message}</p>}
                {error && <p className="text-xs text-red-600">{error}</p>}
              </>
            )}

            <ProgressSteps step={step} show={showProgress} crossChain={route !== 'On-chain'} />

            {showSuccess && (
              <div className="flex flex-col items-center gap-3 py-6">
                <svg className="h-10 w-10 text-green-600" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" stroke="currentColor" strokeWidth="2"/></svg>
                <div className="text-center">
                  <div className="text-lg font-semibold">Deposit successful</div>
                  <div className="mt-1 text-sm text-muted-foreground">Your {snap.token} has been supplied to {snap.protocol}.</div>
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