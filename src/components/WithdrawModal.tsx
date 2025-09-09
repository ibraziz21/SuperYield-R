// src/components/positions/WithdrawModal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { optimism, base, lisk as liskChain } from 'viem/chains'

import type { YieldSnapshot } from '@/hooks/useYields'
import { withdrawFromPool } from '@/lib/withdraw'
import { TokenAddresses, AAVE_POOL, COMET_POOLS } from '@/lib/constants'
import { publicOptimism, publicBase, publicLisk } from '@/lib/clients'
import aaveAbi from '@/lib/abi/aavePool.json'
import { erc20Abi } from 'viem'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

// Quote + Bridge
import { getBridgeQuote } from '@/lib/quotes'
import { bridgeTokens } from '@/lib/bridge'

/* ──────────────────────────────────────────────────────────────── */

type EvmChain = 'optimism' | 'base' | 'lisk'
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)
const LOG = (...args: any[]) => console.log('[WithdrawModal]', ...args)
const WARN = (...args: any[]) => console.warn('[WithdrawModal]', ...args)
const ERR = (...args: any[]) => console.error('[WithdrawModal]', ...args)

function clientFor(chain: EvmChain) {
  if (chain === 'base') return publicBase
  if (chain === 'optimism') return publicOptimism
  return publicLisk
}

/** Minimal ERC-4626 read ABI (for Morpho Lisk vaults) */
const erc4626ReadAbi = [
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

/** ERC-4626 asset() to detect underlying token */
const erc4626AssetAbi = [
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

/** Map Lisk token address -> known symbol key in TokenAddresses */
function liskSymbolByAddress(addr: `0x${string}`): 'USDCe' | 'USDT0' | 'USDT' | 'WETH' | null {
  const TA = TokenAddresses as any
  const keys: Array<'USDCe' | 'USDT0' | 'USDT' | 'WETH'> = ['USDCe', 'USDT0', 'USDT', 'WETH']
  for (const k of keys) {
    const a = TA?.[k]?.lisk as `0x${string}` | undefined
    if (a && a.toLowerCase() === addr.toLowerCase()) return k
  }
  return null
}

/** Read wallet balance for a token on a chain */
async function readWalletBalance(
  chain: EvmChain,
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
  return await clientFor(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint
}

/* ────────────────────────────────────────────────────────────────
   Protocol-specific readers
   ──────────────────────────────────────────────────────────────── */

async function getAaveSuppliedBalance(params: {
  chain: Extract<EvmChain, 'optimism' | 'base'>
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, token, user } = params
  const client = clientFor(chain)
  const pool = AAVE_POOL[chain]
  const asset = (TokenAddresses[token] as Record<'optimism' | 'base', `0x${string}`>)[chain]

  const reserve = await client.readContract({
    address: pool,
    abi: aaveAbi,
    functionName: 'getReserveData',
    args: [asset],
  }) as unknown

  const aToken =
    (Array.isArray(reserve) ? reserve[7] : (reserve as { aTokenAddress?: `0x${string}` }).aTokenAddress) as
    | `0x${string}` | undefined

  if (!aToken) return 0n

  const bal = await client.readContract({
    address: aToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal
}

async function getCometSuppliedBalance(params: {
  chain: Extract<EvmChain, 'optimism' | 'base'>
  token: 'USDC' | 'USDT'
  user: `0x${string}`
}): Promise<bigint> {
  const { chain, token, user } = params
  const comet = COMET_POOLS[chain][token]
  if (comet === '0x0000000000000000000000000000000000000000') return 0n

  const client = clientFor(chain)
  const bal = await client.readContract({
    address: comet,
    abi: [
      { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
    ] as const,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal
}

async function getMorphoLiskSuppliedAssets(params: {
  vault: `0x${string}`
  user: `0x${string}`
}): Promise<{ assets: bigint; underlyingAddr: `0x${string}`; underlyingSym: 'USDCe' | 'USDT0' | 'USDT' | 'WETH' | null }> {
  const { vault, user } = params

  const shares = await publicLisk.readContract({
    address: vault,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  let assets = 0n
  if (shares > 0n) {
    assets = await publicLisk.readContract({
      address: vault,
      abi: erc4626ReadAbi,
      functionName: 'convertToAssets',
      args: [shares],
    }) as bigint
  }

  const underlyingAddr = await publicLisk.readContract({
    address: vault,
    abi: erc4626AssetAbi,
    functionName: 'asset',
  }) as `0x${string}`

  const underlyingSym = liskSymbolByAddress(underlyingAddr)

  return { assets, underlyingAddr, underlyingSym }
}

/* ──────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

type Status =
  | 'idle'
  | 'switching'
  | 'withdrawing'
  | 'withdrawn'     // ✅ Withdrawal complete (show quote + Bridge CTA)
  | 'quoting'
  | 'bridging'
  | 'bridged'       // ✅ Bridging complete
  | 'error'

type Destination = 'local' | 'optimism'

export const WithdrawModal: FC<Props> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync, isPending: switching, error: switchErr } = useSwitchChain()

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [supplied, setSupplied] = useState<bigint | null>(null)

  // Morpho Lisk → OP bridge UI
  const [dest, setDest] = useState<Destination>('local')
  const [route, setRoute] = useState<string | null>(null)
  const [bridgeReceive, setBridgeReceive] = useState<bigint>(0n)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [underlyingLiskSym, setUnderlyingLiskSym] = useState<'USDCe' | 'USDT0' | 'USDT' | 'WETH' | null>(null)
  const [underlyingAddr, setUnderlyingAddr] = useState<`0x${string}` | null>(null)

  // strictly measured amounts on Lisk (USDCe path)
  const [preWithdrawBal, setPreWithdrawBal] = useState<bigint | null>(null)
  const [receivedLiskAmount, setReceivedLiskAmount] = useState<bigint>(0n)
  const [quoteAttempted, setQuoteAttempted] = useState(false) // guard against loops

  const evmChain = snap.chain as EvmChain
  const needChainId =
    evmChain === 'base' ? base.id :
      evmChain === 'optimism' ? optimism.id :
        liskChain.id

  const decimals = useMemo(() => (snap.token === 'WETH' ? 18 : 6), [snap.token])

  const title = useMemo(() => {
    return snap.protocolKey === 'aave-v3' ? 'Withdraw (Aave v3)' :
      snap.protocolKey === 'compound-v3' ? 'Withdraw (Compound v3)' :
        snap.protocolKey === 'morpho-blue' ? 'Withdraw (Morpho Blue)' :
          'Withdraw'
  }, [snap.protocolKey])

  const CHAIN_NAME: Record<EvmChain, string> = { optimism: 'Optimism', base: 'Base', lisk: 'Lisk' }

  // reset per-open
  useEffect(() => {
    if (!open) return
    LOG('open modal with snapshot', { id: snap.id, chain: snap.chain, protocolKey: snap.protocolKey, token: snap.token })
    setStatus('idle')
    setError(null)
    setDest('local')
    setRoute(null)
    setBridgeReceive(0n)
    setQuoteError(null)
    setUnderlyingLiskSym(null)
    setUnderlyingAddr(null)
    setPreWithdrawBal(null)
    setReceivedLiskAmount(0n)
    setQuoteAttempted(false)
  }, [open, snap.id])

  // Load supplied amount + underlying for Morpho (and Aave/Compound on OP/Base)
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account?.address as `0x${string}` | undefined
    if (!user) return

      ; (async () => {
        try {
          if (snap.protocolKey === 'aave-v3' && (snap.chain === 'optimism' || snap.chain === 'base')) {
            LOG('loading Aave supplied balance', { chain: snap.chain, token: snap.token, user })
            if (snap.token !== 'USDC' && snap.token !== 'USDT') { setSupplied(0n); return }
            const bal = await getAaveSuppliedBalance({ chain: snap.chain, token: snap.token, user })
            LOG('Aave supplied balance loaded', formatUnits(bal, 6))
            setSupplied(bal); return
          }

          if (snap.protocolKey === 'compound-v3' && (snap.chain === 'optimism' || snap.chain === 'base')) {
            LOG('loading Comet supplied balance', { chain: snap.chain, token: snap.token, user })
            if (snap.token !== 'USDC' && snap.token !== 'USDT') { setSupplied(0n); return }
            const bal = await getCometSuppliedBalance({ chain: snap.chain, token: snap.token, user })
            LOG('Comet supplied balance loaded', formatUnits(bal, 6))
            setSupplied(bal); return
          }

          if (snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk') {
            const vault = snap.poolAddress as `0x${string}` | undefined
            LOG('loading Morpho Lisk assets', { vault, user })
            if (!vault) { setSupplied(0n); setUnderlyingLiskSym(null); setUnderlyingAddr(null); return }
            const { assets, underlyingAddr, underlyingSym } = await getMorphoLiskSuppliedAssets({ vault, user })
            LOG('Morpho Lisk assets loaded', { assets: formatUnits(assets, 6), underlyingAddr, underlyingSym })
            setSupplied(assets)
            setUnderlyingAddr(underlyingAddr)
            setUnderlyingLiskSym(underlyingSym)
            return
          }

          setSupplied(0n)
        } catch (e) {
          ERR('fetch supplied error', e)
          setError('Failed to load balance')
          setSupplied(0n)
        }
      })()
  }, [open, walletClient, snap.protocolKey, snap.chain, snap.token, snap.poolAddress])

  /* ────────────────────────────────────────────────────────────────
     STEP 1 — Withdraw (and measure actual received USDCe on Lisk)
     ──────────────────────────────────────────────────────────────── */

  async function waitForBalanceIncrease(params: {
    chain: EvmChain
    token: `0x${string}`
    user: `0x${string}`
    before: bigint
    timeoutMs?: number
    pollMs?: number
  }): Promise<bigint> {
    const { chain, token, user, before, timeoutMs = 120_000, pollMs = 5_000 } = params
    LOG('waiting for balance increase', { chain, token, user, before: before.toString(), timeoutMs, pollMs })
    const t0 = Date.now()
    while (true) {
      const nowBal = await readWalletBalance(chain, token, user)
      if (nowBal > before) {
        LOG('balance increase detected', { before: before.toString(), now: nowBal.toString(), delta: (nowBal - before).toString() })
        return nowBal - before
      }
      if (Date.now() - t0 > timeoutMs) {
        WARN('timeout waiting for balance increase')
        return 0n
      }
      await new Promise((r) => setTimeout(r, pollMs))
    }
  }

  async function doBridge(amount: bigint) {
    if (!walletClient) return
    if (!(snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism')) return
    if (!underlyingAddr || underlyingLiskSym !== 'USDCe') {
      setError('Only USDCe path supported.')
      setStatus('error')
      return
    }
    if (amount <= 0n) {
      setError('No USDCe received from withdraw yet.')
      setStatus('error')
      return
    }
  
    try {
      setError(null)
      setStatus('bridging')
      LOG('auto-bridging via LI.FI', {
        from: 'lisk', to: 'optimism', tokenDest: 'USDC', amount: amount.toString(),
      })
  
      await bridgeTokens('USDC', amount, 'lisk', 'optimism', walletClient)
  
      LOG('bridge complete')
      setStatus('bridged')
    } catch (e) {
      ERR('bridge error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  async function handleWithdrawAll() {
    if (!walletClient) { openConnect(); return }
  
    try {
      setError(null)
  
      // 1) Ensure we’re on the right chain
      if (chainId !== needChainId && switchChainAsync) {
        LOG('switch chain', { from: chainId, to: needChainId })
        setStatus('switching')
        await switchChainAsync({ chainId: needChainId })
      }
  
      // 2) Work out amount to withdraw
      let amount: bigint
      if (snap.protocolKey === 'aave-v3') {
        amount = MAX_UINT256
      } else if (snap.protocolKey === 'compound-v3' || snap.protocolKey === 'morpho-blue') {
        if (supplied == null) throw new Error('Balance not loaded')
        amount = supplied
      } else {
        throw new Error(`Unsupported protocol: ${snap.protocol}`)
      }
  
      const user = walletClient.account?.address as `0x${string}`
      LOG('withdraw begin', { protocolKey: snap.protocolKey, chain: snap.chain, amount: amount.toString(), user })
  
      // 3) Snapshot USDCe balance if we’re doing Lisk → Optimism
      let beforeBal: bigint | null = null
      const willBridgeAfter =
        snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism'
  
      if (willBridgeAfter) {
        if (!underlyingAddr || underlyingLiskSym !== 'USDCe') {
          throw new Error('Cross-chain path supports USDCe only.')
        }
        beforeBal = await readWalletBalance('lisk', underlyingAddr, user)
        setPreWithdrawBal(beforeBal)
        LOG('pre-withdraw USDCe', { before: formatUnits(beforeBal, 6) })
      }
  
      // 4) Withdraw
      setStatus('withdrawing')
      const tx = await withdrawFromPool(snap, amount, walletClient)
      LOG('withdraw tx submitted', tx)
  
      // 5) If cross-chain: wait for USDCe to land, then quote immediately
      if (willBridgeAfter) {
        if (!underlyingAddr || underlyingLiskSym !== 'USDCe' || beforeBal == null) {
          WARN('missing underlying / beforeBal; marking withdrawn without delta')
          setStatus('withdrawn')
          return
        }
  
        const delta = await waitForBalanceIncrease({
          chain: 'lisk',
          token: underlyingAddr,
          user,
          before: beforeBal,
          timeoutMs: 180_000,
          pollMs: 6_000,
        })
  
        setReceivedLiskAmount(delta)
        LOG('withdrawal delta measured', { delta: formatUnits(delta, 6) })
  
        // Show “Withdrawal complete”, then kick off quote imperatively
        setStatus('withdrawn')
        void quoteAfterWithdrawal(delta)
        return
      }
  
      // 6) Same-chain path ends here
      setStatus('bridged')
    } catch (e) {
      ERR('withdraw error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }
  
  /* ────────────────────────────────────────────────────────────────
     STEP 2 — Quote after withdrawn, for EXACT `receivedLiskAmount`
     (guarded, with timeout)
     ──────────────────────────────────────────────────────────────── */

  // put near other handlers
  async function quoteAfterWithdrawal(exactAmount: bigint) {
    if (!walletClient) return
    if (!underlyingAddr || underlyingLiskSym !== 'USDCe') {
      setRoute('—')
      setBridgeReceive(0n)
      setQuoteError('Only USDCe supported for cross-chain withdraw.')
      // still proceed to bridge the exact amount without a pre-shown quote
      return void doBridge(exactAmount)
    }
  
    const user = walletClient.account?.address as `0x${string}`
    LOG('starting LI.FI quote', {
      from: 'lisk', to: 'optimism', tokenFrom: 'USDCe', tokenTo: 'USDC',
      amount: exactAmount.toString(), fromAddress: user
    })
  
    setStatus('quoting')
    setQuoteError(null)
    setRoute(null)
    setBridgeReceive(0n)
  
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('quote-timeout')), 15_000)
    )
  
    console.time('[WithdrawModal] quote')
    try {
      const q = await Promise.race([
        getBridgeQuote({
          token: 'USDC',
          amount: exactAmount,
          from: 'lisk',
          to: 'optimism',
          fromAddress: user,
          slippage: 0.003,
          walletClient: walletClient,
        }),
        timeout,
      ])
  
      console.groupCollapsed('[WithdrawModal] LI.FI quote result')
      LOG('normalized quote', q)
      LOG('quote.estimate', q.estimate)
      LOG('quote.raw',     q.raw)
      console.groupEnd()
  
      setRoute(q.route)
      setBridgeReceive(q.bridgeOutAmount)
  
      console.timeEnd('[WithdrawModal] quote')
      // 🚀 auto-bridge immediately with the exact withdrawn amount
      return void doBridge(exactAmount)
    } catch (e) {
      console.timeEnd('[WithdrawModal] quote')
      ERR('quote failed (auto-bridging without pre-shown quote)', e)
      setRoute('—')
      setBridgeReceive(0n)
      setQuoteError('Could not fetch bridge quote.')
  
      // Still proceed to bridge; bridgeTokens will obtain its own route/quote internally.
      return void doBridge(exactAmount)
    }
  }
  

  /* ────────────────────────────────────────────────────────────────
     STEP 3 — Bridge exactly what arrived on Lisk → Optimism
     ──────────────────────────────────────────────────────────────── */

  async function handleBridge() {
    if (!walletClient) return
    if (!(snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism')) return
    if (!underlyingAddr || underlyingLiskSym !== 'USDCe') { setError('Only USDCe path supported.'); setStatus('error'); return }
    if (receivedLiskAmount <= 0n) { setError('No USDCe received from withdraw yet.'); setStatus('error'); return }

    try {
      setError(null)
      setStatus('bridging')
      LOG('bridging via LI.FI', { from: 'lisk', to: 'optimism', tokenDest: 'USDC', amount: receivedLiskAmount.toString() })

      await bridgeTokens(
        'USDC',                       // receive on Optimism
        receivedLiskAmount,           // exact credited amount
        'lisk',
        'optimism',
        walletClient,
      )

      LOG('bridge complete')
      setStatus('bridged')
    } catch (e) {
      ERR('bridge error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  /* ──────────────────────────────────────────────────────────────── */

  const suppliedPretty = typeof supplied === 'bigint' ? formatUnits(supplied, decimals) : '0'

  const canWithdraw =
    status === 'idle' &&
    !(typeof supplied === 'bigint' && supplied === 0n)

  const canBridge =
    status === 'withdrawn' &&
    dest === 'optimism' &&
    snap.protocolKey === 'morpho-blue' &&
    snap.chain === 'lisk' &&
    underlyingLiskSym === 'USDCe' &&
    receivedLiskAmount > 0n

  /* ─────────── UI helpers ─────────── */

  function HeaderBar() {
    return (
      <div className="sticky top-0 z-30 flex items-center justify-between bg-gradient-to-r from-teal-600 to-emerald-500 px-5 py-4 text-white">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold sm:text-lg">{title}</DialogTitle>
        </DialogHeader>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium">
          {snap.chain.toUpperCase()}
        </span>
      </div>
    )
  }

  function TokenCard() {
    return (
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold">
            {snap.token.slice(0, 1)}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-medium">{snap.token}</div>
            <div className="text-xs text-gray-500">{snap.protocol}</div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-500">Supplied</div>
          <div className="text-lg font-semibold">
            {['switching', 'withdrawing', 'bridging', 'quoting'].includes(status)
              ? '…'
              : suppliedPretty}
          </div>
        </div>
      </div>
    )
  }

  function DestinationCard() {
    if (!(snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk')) return null
    const showQuote = dest === 'optimism' && ['withdrawn', 'quoting'].includes(status)

    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Destination</span>
          <div className="inline-flex rounded-full border bg-white p-1">
            <button
              onClick={() => { LOG('set destination -> local'); setDest('local') }}
              disabled={status !== 'idle'}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${dest === 'local' ? 'bg-teal-600 text-white' : 'text-gray-700'} ${status !== 'idle' ? 'opacity-60' : ''}`}
            >
              Keep on Lisk
            </button>
            <button
              onClick={() => { LOG('set destination -> optimism'); setDest('optimism') }}
              disabled={status !== 'idle'}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${dest === 'optimism' ? 'bg-teal-600 text-white' : 'text-gray-700'} ${status !== 'idle' ? 'opacity-60' : ''}`}
            >
              Optimism (USDC)
            </button>
          </div>
        </div>

        {showQuote && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Route</span>
              <span className="font-medium">
                {status === 'quoting' ? 'Fetching…' : (route ?? '—')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Will receive</span>
              <span className="font-semibold">
                {status === 'quoting'
                  ? '…'
                  : bridgeReceive > 0n
                    ? `${formatUnits(bridgeReceive, 6)} USDC`
                    : '—'}
              </span>
            </div>
            {quoteError && (
              <p className="rounded-md bg-red-50 p-2 text-xs text-red-600">
                {quoteError}{' '}
                <button
                  className="ml-2 underline"
                  onClick={() => { LOG('retry quote clicked'); setQuoteAttempted(false) }}
                >
                  Try again
                </button>
              </p>
            )}
            {receivedLiskAmount > 0n && (
              <p className="mt-1 text-xs text-gray-500">
                Detected received on Lisk: <span className="font-medium">{formatUnits(receivedLiskAmount, 6)} USDCe</span>
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  function StageBanner() {
    if (status === 'withdrawn') {
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Withdrawal complete</span>
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            You can now bridge your funds to Optimism.
          </p>
        </div>
      )
    }
    if (status === 'bridged') {
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Bridging complete</span>
          </div>
        </div>
      )
    }
    return null
  }

  function SummaryCard() {
    const destLabel =
      snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk'
        ? (dest === 'optimism' ? 'Optimism (USDC)' : 'Lisk (wallet)')
        : CHAIN_NAME[evmChain]

    const actionLabel =
      (status === 'withdrawn' && dest === 'optimism')
        ? 'Bridge to Optimism'
        : (snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism'
          ? 'Withdraw, then Bridge'
          : 'Withdraw full balance')

    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Action</span>
          <span className="font-medium">{actionLabel}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-gray-600">Destination</span>
          <span className="font-medium">
            {destLabel}
            {switching && ' (switching…)'}
          </span>
        </div>
      </div>
    )
  }

  function ProgressCard() {
    const label =
      status === 'switching' ? 'Switching network…'
        : status === 'withdrawing' ? 'Withdrawing…'
          : status === 'quoting' ? 'Fetching bridge quote…'
            : status === 'bridging' ? 'Bridging liquidity…'
              : ''

    const desc =
      status === 'switching' ? 'Confirm the network switch in your wallet.'
        : status === 'withdrawing' ? 'Confirm the withdrawal transaction in your wallet.'
          : status === 'quoting' ? 'Looking for best route and estimating received amount.'
            : status === 'bridging' ? 'Confirm the bridge transaction in your wallet.'
              : ''

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
          <div className="text-sm font-medium">{label}</div>
        </div>
        {!!desc && <p className="mt-2 text-xs text-gray-500">{desc}</p>}
      </div>
    )
  }

  function ErrorCard() {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">Something went wrong</span>
        </div>
        <p className="mt-2 break-words text-xs text-red-700">
          {error ?? 'Unknown error'}
        </p>
      </div>
    )
  }

  /* ─────────── Render ─────────── */

  return (
    <Dialog open={open} onOpenChange={(v) => { LOG('onOpenChange', v); onClose() }}>
      <DialogContent
        className="
          w-[min(100vw-1rem,40rem)] sm:w-auto sm:max-w-md
          h-[min(90dvh,700px)] sm:h-auto
          overflow-hidden rounded-xl sm:rounded-2xl p-0 shadow-xl
        "
      >
        <HeaderBar />

        <div className="flex max-h-[calc(90dvh-56px)] flex-col overflow-hidden sm:max-h-none">
          <div className="flex-1 space-y-4 overflow-y-auto bg-white p-4 sm:p-5">
            <TokenCard />
            {/* Destination chooser only for Morpho on Lisk */}
            {snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && <DestinationCard />}

            {/* Stage banners */}
            <StageBanner />

            {/* Progress strips */}
            {(status === 'switching' || status === 'withdrawing' || status === 'bridging' || status === 'quoting') && (
              <ProgressCard />
            )}

            {/* Summary */}
            {['idle', 'withdrawn', 'bridged'].includes(status) && <SummaryCard />}

            {switchErr && (
              <p className="rounded-md bg-red-50 p-2 text-xs text-red-600">
                {switchErr.message}
              </p>
            )}
            {error && status === 'error' && <ErrorCard />}
          </div>

          {/* Sticky action bar */}
          <div
            className="sticky bottom-0 border-t bg-white px-4 py-3 sm:px-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">

              {/* Step 1: Withdraw */}
              {status === 'idle' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => { LOG('Cancel clicked'); onClose() }}
                    className="h-12 w-full rounded-full sm:h-9 sm:w-auto"
                    title="Cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleWithdrawAll}
                    disabled={!canWithdraw}
                    className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                    title="Withdraw"
                  >
                    {snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism'
                      ? 'Withdraw (Step 1 of 2)'
                      : 'Withdraw'}
                  </Button>
                </>
              )}

              {/* Step 2: Bridge (after withdrawal; enabled only if we measured credited amount) */}
              {canBridge && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => { LOG('Close clicked'); onClose() }}
                    className="h-12 w-full rounded-full sm:h-9 sm:w-auto"
                    title="Close"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={handleBridge}
                    className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                    title="Bridge to Optimism"
                  >
                    {quoteError ? 'Bridge without quote' : 'Bridge to Optimism (Step 2 of 2)'}
                  </Button>
                </>
              )}

              {/* Busy states */}
              {['switching', 'withdrawing', 'bridging'].includes(status) && (
                <>
                  <Button variant="secondary" disabled className="h-12 w-full rounded-full sm:h-9 sm:w-auto" title="Busy…">Cancel</Button>
                  <Button disabled className="h-12 w-full rounded-full bg-teal-600 sm:h-9 sm:w-auto" title="Processing…">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing…
                    </span>
                  </Button>
                </>
              )}

              {status === 'bridged' && (
                <Button
                  onClick={() => { LOG('Done clicked'); onClose() }}
                  className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                  title="Done"
                >
                  Done
                </Button>
              )}

              {status === 'error' && (
                <div className="flex w-full gap-2 sm:justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => { LOG('Close (error) clicked'); onClose() }}
                    className="h-12 w-full rounded-full sm:h-9 sm:w-auto"
                    title="Close"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={() => { LOG('Retry Withdraw clicked'); handleWithdrawAll() }}
                    className="h-12 w-full rounded-full bg-teal-600 hover:bg-teal-500 sm:h-9 sm:w-auto"
                    title="Retry Withdraw"
                  >
                    Retry Withdraw
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
