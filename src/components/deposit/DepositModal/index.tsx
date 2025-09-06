// src/components/DepositModal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { formatUnits, parseUnits, keccak256, toBytes, toHex } from 'viem'
import { lisk as liskChain } from 'viem/chains'

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
import {  bridgeAndDepositViaRouter,bridgeAndDepositViaRouterPush } from '@/lib/bridge'
import { adapterKeyForSnapshot } from '@/lib/adapters'

import {
  getAaveSuppliedBalance,
  getCometSuppliedBalance,
  isCometToken,
  readWalletBalance,
  symbolForWalletDisplay,
  mapCrossTokenForDest,
  tokenAddrFor,
  chainIdOf,
  clientFor,
} from '../helpers'
import type { EvmChain, FlowStep } from '../types'
import { TokenAddresses, MORPHO_POOLS, ADAPTER_KEYS, LISK_EXECUTOR_ADDRESS } from '@/lib/constants'

interface DepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, error: switchError } = useSwitchChain()

  // ── local state ─────────────────────────────────────────────────
  const [amount, setAmount] = useState('')

  // Let user choose USDC or USDT as the *source asset* on OP/Base when target is Lisk:USDT0
  const [sourceAsset, setSourceAsset] = useState<'USDC' | 'USDT'>('USDT')

  // Wallet balances (generic per displayed token)
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [liBal, setLiBal] = useState<bigint | null>(null)
  const [liBalUSDT, setLiBalUSDT] = useState<bigint | null>(null)
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null)

  // EXTRA balances for USDC/USDT on OP/Base (for correct MAX + display)
  const [opUsdcBal, setOpUsdcBal] = useState<bigint | null>(null)
  const [baUsdcBal, setBaUsdcBal] = useState<bigint | null>(null)
  const [opUsdtBal, setOpUsdtBal] = useState<bigint | null>(null)
  const [baUsdtBal, setBaUsdtBal] = useState<bigint | null>(null)

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
  useEffect(() => {
    setLiquidityEnsured(false)
    setStep('idle')
    setError(null)
  }, [open, amount, snap.chain, snap.token, snap.protocolKey])

  const tokenDecimals = useMemo(() => (snap.token === 'WETH' ? 18 : 6), [snap.token])
  const poolDecimals = useMemo(
    () => (snap.protocolKey === 'aave-v3' ? 8 : snap.protocolKey === 'compound-v3' ? 6 : tokenDecimals),
    [snap.protocolKey, tokenDecimals],
  )

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

    // Extra OP/Base USDC+USDT balances (for MAX + UX when targeting Lisk:USDT0)
    const opUsdc = addrOrNull('USDC', 'optimism')
    const baUsdc = addrOrNull('USDC', 'base')
    const opUsdt = addrOrNull('USDT', 'optimism')
    const baUsdt = addrOrNull('USDT', 'base')

    if (opUsdc) reads.push(readWalletBalance('optimism', opUsdc, user)); else reads.push(Promise.resolve(null))
    if (baUsdc) reads.push(readWalletBalance('base',     baUsdc, user)); else reads.push(Promise.resolve(null))
    if (opUsdt) reads.push(readWalletBalance('optimism', opUsdt, user)); else reads.push(Promise.resolve(null))
    if (baUsdt) reads.push(readWalletBalance('base',     baUsdt, user)); else reads.push(Promise.resolve(null))

    Promise.allSettled(reads).then((vals) => {
      // base three + (liU, liU0) + (opUSDC, baUSDC, opUSDT, baUSDT)
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

  /* ---------------- Source-asset defaulting heuristic ---------------- */
  useEffect(() => {
    if (!amount) return
    // Default USDT for USDT-family (USDT0 on Lisk), else USDC
    if (snap.chain === 'lisk' && (snap.token === 'USDT' || snap.token === 'USDT0')) {
      setSourceAsset('USDT')
    } else {
      setSourceAsset('USDC')
    }
  }, [amount, snap.chain, snap.token])

  /* ---------------- Quote (LI.FI) ---------------- */
  useEffect(() => {
    if (!walletClient || !amount) {
      setRoute(null); setFee(0n); setReceived(0n); setQuoteError(null)
      return
    }

    const dest = snap.chain as EvmChain
    const amt  = parseUnits(amount, tokenDecimals)

    // token form on destination (e.g., Lisk USDT0/USDCe)
    const destOutSymbol = mapCrossTokenForDest(snap.token, dest)

    // choose source (OP/Base) – use generic balances to pick a chain
    const op = opBal ?? 0n
    const ba = baBal ?? 0n
    const src: Extract<EvmChain, 'optimism' | 'base'> =
      op >= amt ? 'optimism' : ba >= amt ? 'base' : (op >= ba ? 'optimism' : 'base')

    if (src === dest) {
      setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null)
      return
    }

    // Lisk USDT0 path — allow USDC/USDT toggle
    if (dest === 'lisk' && destOutSymbol === 'USDT0') {
      smartQuoteUsdt0Lisk({
        amountIn: amt,
        opBal, baBal,
        fromAddress: walletClient.account!.address as `0x${string}`,
        sourceToken: sourceAsset, // << NEW
      })
        .then((q) => { setRoute(q.route); setFee(q.bridgeFee); setReceived(q.bridgeOutUSDT0); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
      return
    }

    // Lisk USDCe path (short-circuit if already enough on Lisk)
    if (dest === 'lisk' && destOutSymbol === 'USDCe') {
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

    // Generic LI.FI quote for other cross-chain cases
    getBridgeQuote({
      token: destOutSymbol as any,
      amount: amt,
      from: src,
      to: dest,
      fromAddress: walletClient.account!.address as `0x${string}`,
    })
      .then((q) => { setRoute(q.route); setFee(q.bridgeFeeTotal); setReceived(q.bridgeOutAmount); setQuoteError(null) })
      .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
  // include balances so we re-evaluate once they load
  }, [amount, walletClient, opBal, baBal, liBal, liBalUSDT, liBalUSDT0, snap.chain, snap.token, tokenDecimals, sourceAsset])

  // helper to build & sign the EIP-712 intent for the executor
  async function signDepositIntent(params: {
    user: `0x${string}`
    key:  `0x${string}`
    asset:`0x${string}`
    amount: bigint
    minAmount?: bigint
  }) {
    if (!walletClient) throw new Error('No wallet')
  
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60)
    const nonce    = BigInt(Date.now())
    const refId    = keccak256(toBytes(`${params.user}-${Date.now()}-${params.asset}-${params.amount.toString()}`))
  
    const domain = {
      name: 'SuperYLDR-LiskExecutor',
      version: '1',
      chainId: BigInt(liskChain.id),                     // MUST be Lisk
      verifyingContract: LISK_EXECUTOR_ADDRESS as `0x${string}`,
    } as const
  
    const types = {
      DepositIntent: [
        { name: 'user',      type: 'address' },
        { name: 'key',       type: 'bytes32' },
        { name: 'asset',     type: 'address' },
        { name: 'amount',    type: 'uint256' },
        { name: 'minAmount', type: 'uint256' },
        { name: 'deadline',  type: 'uint256' },
        { name: 'nonce',     type: 'uint256' },
        { name: 'refId',     type: 'bytes32' },
      ],
    } as const
  
    const message = {
      user: params.user,
      key: params.key,
      asset: params.asset,
      amount: params.amount,
      minAmount: params.minAmount ?? 0n,
      deadline,
      nonce,
      refId,
    }
  
    // ⬇️ NEW: temporarily switch the wallet to Lisk for signing
    const want = toHex(liskChain.id) as `0x${string}`
    const current = (await walletClient.request({ method: 'eth_chainId' })) as `0x${string}`
    const mustSwitch = current.toLowerCase() !== want.toLowerCase()
  
    async function ensureLisk() {
      try {
        await walletClient!.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: want }],
        })
      } catch (e: any) {
        // If Lisk isn’t added, add it then switch (optional, fill in your RPC/explorer)
        if (e?.code === 4902) {
          await walletClient!.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: want,
              chainName: 'Lisk',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: [process.env.NEXT_PUBLIC_LISK_RPC_URL ?? 'https://rpc.api.lisk.com'],
              blockExplorerUrls: ['https://blockscout.lisk.com'],
            }],
          })
          await walletClient!.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: want }],
          })
        } else {
          throw e
        }
      }
    }
  
    if (mustSwitch) await ensureLisk()
    try {
      const signature = await walletClient.signTypedData({
        account: params.user,
        domain, types, primaryType: 'DepositIntent', message,
      })
      return { message, signature }
    } finally {
      // switch back to the original chain if we changed it
      if (mustSwitch) {
        await walletClient.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: current }],
        })
      }
    }
  }

  /* ---------------- Confirm (bridge → sign intent → server relayer call) ---------------- */
  async function handleConfirm() {
    if (!walletClient) { openConnect(); return }
    setError(null)
  
    try {
      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const dest = snap.chain as EvmChain
      const user = walletClient.account!.address as `0x${string}`
  
      // ─────────────────────────────────────────────────────────────
      // NEW: 1-click route for Lisk + Morpho (bridge → router.deposit)
      // ─────────────────────────────────────────────────────────────
      if (dest === 'lisk' && snap.protocolKey === 'morpho-blue') {
        setStep('bridging') // covers the combined bridge + contract-call route
  
        const destTokenLabel = mapCrossTokenForDest(snap.token, 'lisk') as 'USDT0' | 'USDCe' | 'WETH'
        const adapterKey = adapterKeyForSnapshot(snap)
  
        // Pick source-chain **for the chosen source token**
        const pickSrcBy = (op: bigint | null, ba: bigint | null): 'optimism' | 'base' => {
          const _op = op ?? 0n
          const _ba = ba ?? 0n
          if (_op >= inputAmt) return 'optimism'
          if (_ba >= inputAmt) return 'base'
          return _op >= _ba ? 'optimism' : 'base'
        }
  
        // Source token respecting the USDT/USDC toggle for USDT0
        const srcToken =
          destTokenLabel === 'USDT0' ? sourceAsset :
          destTokenLabel === 'USDCe' ? 'USDC' :
          'WETH'
  
        // Choose the right balances to decide source chain
        let srcChain: 'optimism' | 'base'
        if (srcToken === 'USDC') {
          srcChain = pickSrcBy(opUsdcBal, baUsdcBal)
        } else if (srcToken === 'USDT') {
          srcChain = pickSrcBy(opUsdtBal, baUsdtBal)
        } else {
          // WETH fallback: use generic displayed balances
          srcChain = pickSrcBy(opBal, baBal)
        }

        console.log("From: ", srcToken, " to: ", destTokenLabel)
  
        await bridgeAndDepositViaRouterPush({
          user,
          destToken: destTokenLabel as 'USDT0' | 'USDCe' | 'WETH',
          srcChain: srcChain,                             // 'optimism' | 'base'
          srcToken: srcToken as 'USDC' | 'USDT' | 'WETH',
          amount: inputAmt,
          adapterKey,                                         // from adapterKeyForSnapshot(snap)
          walletClient,
        })
  
        setStep('success')
        return
      }
  
      // ─────────────────────────────────────────────────────────────
      // Existing path for Aave/Comet or non-Lisk destinations
      // (balance-driven bridging + on-chain deposit via Router)
      // ─────────────────────────────────────────────────────────────
      const destId = chainIdOf(dest)
      const wantDestToken = mapCrossTokenForDest(snap.token, dest)
      const finalTokenAddr = tokenAddrFor(wantDestToken, dest)
      const preBal = await readWalletBalance(dest, finalTokenAddr, user)
  
      let bridgedDelta: bigint = 0n
  
      if (!liquidityEnsured && preBal < inputAmt) {
        setStep('bridging')
        const res = await ensureLiquidity(
          wantDestToken,
          inputAmt,
          dest,
          walletClient,
          {
            onStatus: (s) => {
              if (s === 'waiting') setStep('waitingFunds')
              else if (s === 'bridging') setStep('bridging')
            },
            preferredSourceToken: (dest === 'lisk' && wantDestToken === 'USDT0') ? sourceAsset : undefined,
          }
        )
        bridgedDelta = res.delta
        setLiquidityEnsured(true)
      } else {
        setLiquidityEnsured(true)
      }
  
      if (chainId !== destId && switchChainAsync) {
        setStep('switching')
        await switchChainAsync({ chainId: destId })
      }
  
      const postBal = await readWalletBalance(dest, finalTokenAddr, user)
      const cap = inputAmt
      const toDeposit =
        bridgedDelta > 0n
          ? (bridgedDelta > cap ? cap : bridgedDelta)
          : (postBal >= cap ? cap : postBal)
  
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
                  // NEW bits:
                  sourceAsset={sourceAsset}
                  opUsdcBal={opUsdcBal}
                  baUsdcBal={baUsdcBal}
                  opUsdtBal={opUsdtBal}
                  baUsdtBal={baUsdtBal}
                />

                {/* Source-asset selector (only for Lisk:USDT0 bridging) */}
                {isLiskTarget && destTokenLabel === 'USDT0' && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">
                      Source asset on OP/Base
                    </div>
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
                  // OPTIONAL extra display (backward compatible)
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

                {(poolOp != null || poolBa != null) && (
                  <SuppliedCard
                    poolOp={poolOp}
                    poolBa={poolBa}
                    poolDecimals={poolDecimals}
                    tokenSymbol={snap.token}
                  />
                )}

                {switchError && <p className="text-xs text-red-600">Network switch failed: {switchError.message}</p>}
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
                    {snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk'
                      ? `Your ${snap.token} was bridged to Lisk and deposited via our relayer.`
                      : `Your ${snap.token} has been supplied to ${snap.protocol}.`}
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
