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
import { Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'

// LI.FI-backed bridge orchestrator
import { ensureLiquidity } from '@/lib/smartbridge'
import { getQuote } from '@lifi/sdk'

/* ──────────────────────────────────────────────────────────────── */

type EvmChain = 'optimism' | 'base' | 'lisk'
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)

function clientFor(chain: EvmChain) {
  if (chain === 'base') return publicBase
  if (chain === 'optimism') return publicOptimism
  return publicLisk
}

function explorerTxBaseUrl(chain: EvmChain) {
  if (chain === 'base') return 'https://basescan.org/tx/'
  if (chain === 'optimism') return 'https://optimistic.etherscan.io/tx/'
  return 'https://blockscout.lisk.com/tx/'
}

/** Minimal ERC-4626 read ABI (for Morpho Lisk vaults) */
const erc4626ReadAbi = [
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

/** ERC-4626 asset() to detect underlying token */
const erc4626AssetAbi = [
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

/** token address lookup from constants */
function tokenAddrFor(sym: string, chain: EvmChain): `0x${string}` {
  const addr = (TokenAddresses as any)?.[sym]?.[chain]
  if (!addr) throw new Error(`Token ${sym} not supported on ${chain}`)
  return addr as `0x${string}`
}

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
  | 'waitingFunds'
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
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)

  // Morpho Lisk → OP bridge UI
  const [dest, setDest] = useState<Destination>('local')
  const [route, setRoute] = useState<string | null>(null)
  const [bridgeReceive, setBridgeReceive] = useState<bigint>(0n)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [underlyingLiskSym, setUnderlyingLiskSym] = useState<'USDCe' | 'USDT0' | 'USDT' | 'WETH' | null>(null)
  const [underlyingAddr, setUnderlyingAddr] = useState<`0x${string}` | null>(null)
  const [withdrawnAmount, setWithdrawnAmount] = useState<bigint>(0n)

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
    setStatus('idle')
    setError(null)
    setTxHash(null)
    setDest('local')
    setRoute(null)
    setBridgeReceive(0n)
    setQuoteError(null)
    setUnderlyingLiskSym(null)
    setUnderlyingAddr(null)
    setWithdrawnAmount(0n)
  }, [open, snap.id])

  // Load supplied amount + underlying for Morpho (and Aave/Compound on OP/Base)
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account?.address as `0x${string}` | undefined
    if (!user) return

    ;(async () => {
      try {
        // Aave OP/Base
        if (snap.protocolKey === 'aave-v3' && (snap.chain === 'optimism' || snap.chain === 'base')) {
          if (snap.token !== 'USDC' && snap.token !== 'USDT') { setSupplied(0n); return }
          const bal = await getAaveSuppliedBalance({ chain: snap.chain, token: snap.token, user })
          setSupplied(bal); return
        }

        // Compound OP/Base
        if (snap.protocolKey === 'compound-v3' && (snap.chain === 'optimism' || snap.chain === 'base')) {
          if (snap.token !== 'USDC' && snap.token !== 'USDT') { setSupplied(0n); return }
          const bal = await getCometSuppliedBalance({ chain: snap.chain, token: snap.token, user })
          setSupplied(bal); return
        }

        // Morpho Lisk (ERC-4626)
        if (snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk') {
          const vault = snap.poolAddress as `0x${string}` | undefined
          if (!vault) { setSupplied(0n); setUnderlyingLiskSym(null); setUnderlyingAddr(null); return }
          const { assets, underlyingAddr, underlyingSym } = await getMorphoLiskSuppliedAssets({ vault, user })
          setSupplied(assets)
          setUnderlyingAddr(underlyingAddr)
          setUnderlyingLiskSym(underlyingSym)
          return
        }

        setSupplied(0n)
      } catch (e) {
        console.error('[WithdrawModal] fetch supplied error', e)
        setError('Failed to load balance')
        setSupplied(0n)
      }
    })()
  }, [open, walletClient, snap.protocolKey, snap.chain, snap.token, snap.poolAddress])

  /* ────────────────────────────────────────────────────────────────
     STEP 1 — Withdraw
     ──────────────────────────────────────────────────────────────── */

  async function handleWithdrawAll() {
    if (!walletClient) { openConnect(); return }

    try {
      setError(null)
      setTxHash(null)

      // switch to chain of the position
      if (chainId !== needChainId && switchChainAsync) {
        setStatus('switching')
        await switchChainAsync({ chainId: needChainId })
      }

      // compute amount
      let amount: bigint
      if (snap.protocolKey === 'aave-v3') {
        amount = MAX_UINT256
      } else if (snap.protocolKey === 'compound-v3') {
        if (supplied == null) throw new Error('Balance not loaded')
        amount = supplied
      } else if (snap.protocolKey === 'morpho-blue') {
        if (supplied == null) throw new Error('Balance not loaded')
        amount = supplied
      } else {
        throw new Error(`Unsupported protocol: ${snap.protocol}`)
      }

      // withdraw
      setStatus('withdrawing')
      const hash = await withdrawFromPool(snap, amount, walletClient)
      if (typeof hash === 'string' && hash.startsWith('0x')) setTxHash(hash as `0x${string}`)

      // Cross-chain path: stop at "Withdrawal complete", then quote & show Bridge CTA
      if (snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism') {
        setWithdrawnAmount(amount)
        setStatus('withdrawn')
        return
      }

      // Same-chain: finished
      setStatus('bridged') // use same banner style for "complete"
    } catch (e) {
      console.error('[WithdrawModal] withdraw error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  /* ────────────────────────────────────────────────────────────────
     STEP 2 — Quote (after withdrawn) & Bridge
     ──────────────────────────────────────────────────────────────── */

  // Quote only AFTER we’re in 'withdrawn' state on Morpho-Lisk → Optimism
  useEffect(() => {
    if (!open) return
    if (status !== 'withdrawn') return
    if (snap.protocolKey !== 'morpho-blue' || snap.chain !== 'lisk' || dest !== 'optimism') return

    if (!underlyingAddr || !(underlyingLiskSym === 'USDCe' || underlyingLiskSym === 'USDT0')) {
      setRoute(null); setBridgeReceive(0n); setQuoteError('Only USDCe/USDT0 supported for cross-chain withdraw'); return
    }

    let cancelled = false
    const QUOTE_TIMEOUT_MS = 15000

    const fetchQuote = async () => {
      setStatus('quoting')
      setQuoteError(null)
      setRoute(null)
      setBridgeReceive(0n)

      const fromAmount =
        (withdrawnAmount && withdrawnAmount > 0n) ? withdrawnAmount : (supplied ?? 0n)

      const quotePromise = getQuote({
        fromChain: liskChain.id,
        toChain: optimism.id,
        fromToken: underlyingAddr,                    // underlying asset(), not the vault
        toToken: tokenAddrFor('USDC', 'optimism'),
        fromAmount: fromAmount.toString(),
        fromAddress: walletClient?.account?.address as `0x${string}`, // Add fromAddress
        slippage: 0.003,
      })

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LI.FI quote timeout')), QUOTE_TIMEOUT_MS)
      )

      try {
        const q: any = await Promise.race([quotePromise, timeoutPromise])
        if (cancelled) return
        setRoute('LI.FI • Lisk → Optimism')
        setBridgeReceive(BigInt(q.toAmount ?? '0'))
        setQuoteError(null)
      } catch (e) {
        if (cancelled) return
        console.debug('[LI.FI quote failed after withdraw]', (e as any)?.message ?? e)
        setRoute('—')
        setBridgeReceive(0n)
        setQuoteError('Could not fetch LI.FI quote (you can still bridge).')
      } finally {
        if (!cancelled) setStatus('withdrawn') // return to "Withdrawal complete" + Bridge CTA
      }
    }

    fetchQuote()
    return () => { cancelled = true }
  }, [open, status, dest, underlyingAddr, underlyingLiskSym, withdrawnAmount, supplied, snap.protocolKey, snap.chain])

  async function handleBridge() {
    if (!walletClient) return
    if (!(snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk' && dest === 'optimism')) return

    try {
      setError(null)
      setStatus('bridging')

      const amount =
        (withdrawnAmount && withdrawnAmount > 0n)
          ? withdrawnAmount
          : (supplied ?? 0n)

      await ensureLiquidity('USDC', amount, 'optimism', walletClient, {
        onStatus: (s) => {
          if (s === 'bridging') setStatus('bridging')
          else if (s === 'waiting') setStatus('waitingFunds')
        },
        preferredSourceToken: 'USDC',
      })

      setStatus('bridged')
    } catch (e) {
      console.error('[WithdrawModal] bridge error', e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  /* ──────────────────────────────────────────────────────────────── */

  const suppliedPretty = typeof supplied === 'bigint' ? formatUnits(supplied, decimals) : '0'

  const canWithdraw =
    status === 'idle' &&
    !(typeof supplied === 'bigint' && supplied === 0n)

  // Allow bridging both in 'withdrawn' and while 'quoting' (so the user isn't blocked)
  const canBridge =
    (status === 'withdrawn' || status === 'quoting') &&
    (dest === 'optimism') &&
    (snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk') &&
    (underlyingLiskSym === 'USDCe' || underlyingLiskSym === 'USDT0')

  /* ─────────── UI ─────────── */

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
            {['switching','withdrawing','bridging','waitingFunds','quoting'].includes(status)
              ? '…'
              : suppliedPretty}
          </div>
        </div>
      </div>
    )
  }

  function DestinationCard() {
    if (!(snap.protocolKey === 'morpho-blue' && snap.chain === 'lisk')) return null
    const showQuote = dest === 'optimism' && ['withdrawn','quoting'].includes(status)

    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Destination</span>
          <div className="inline-flex rounded-full border bg-white p-1">
            <button
              onClick={() => setDest('local')}
              disabled={status !== 'idle'}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${dest === 'local' ? 'bg-teal-600 text-white' : 'text-gray-700'} ${status !== 'idle' ? 'opacity-60' : ''}`}
            >
              Keep on Lisk
            </button>
            <button
              onClick={() => setDest('optimism')}
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
                {quoteError}
              </p>
            )}
            {underlyingLiskSym && (
              <p className="mt-1 text-xs text-gray-500">
                Underlying on Lisk: <span className="font-medium">{underlyingLiskSym}</span> → Receiving on Optimism: <span className="font-medium">USDC</span>
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
      (['withdrawn','quoting'].includes(status) && dest === 'optimism')
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
      status === 'switching'    ? 'Switching network…'
    : status === 'withdrawing'  ? 'Withdrawing…'
    : status === 'quoting'      ? 'Fetching LI.FI quote…'
    : status === 'bridging'     ? 'Bridging liquidity…'
    : status === 'waitingFunds' ? 'Waiting for funds on Optimism…'
    : ''

    const desc =
      status === 'switching' ? 'Confirm the network switch in your wallet.'
      : status === 'withdrawing' ? 'Confirm the withdrawal transaction in your wallet.'
      : status === 'quoting' ? 'Looking for best route and estimating received amount.'
      : status === 'bridging' ? 'Confirm the bridge transaction in your wallet.'
      : 'This can take a few minutes depending on the bridge.'

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
          <div className="text-sm font-medium">{label}</div>
        </div>
        <p className="mt-2 text-xs text-gray-500">{desc}</p>
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
    <Dialog open={open} onOpenChange={onClose}>
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
            {(status === 'switching' || status === 'withdrawing' || status === 'bridging' || status === 'waitingFunds' || status === 'quoting') && (
              <ProgressCard />
            )}

            {/* Summary */}
            {['idle','withdrawn','bridged'].includes(status) && <SummaryCard />}

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
                    onClick={onClose}
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

              {/* Step 2: Bridge (after withdrawal — allow even while quoting) */}
              {canBridge && (
                <>
                  <Button
                    variant="secondary"
                    onClick={onClose}
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
                    {status === 'quoting'
                      ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Bridge to Optimism</span>
                      : 'Bridge to Optimism (Step 2 of 2)'}
                  </Button>
                </>
              )}

              {/* Busy states */}
              {['switching','withdrawing','bridging','waitingFunds'].includes(status) && (
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
                  onClick={onClose}
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
                    onClick={onClose}
                    className="h-12 w-full rounded-full sm:h-9 sm:w-auto"
                    title="Close"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={handleWithdrawAll}
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
