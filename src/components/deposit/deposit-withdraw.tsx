"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "../ui/Card"

import { SelectTokenModal } from "./select-token-modal"
import { DepositSuccessModal } from "./DepositModal/deposit-success-modal"
import { ReviewDepositModal } from "./DepositModal/review-deposit-modal"

import { useAppKit } from "@reown/appkit/react"
import { useWalletClient } from "wagmi"
import { parseUnits } from "viem"
import { lisk as liskChain } from "viem/chains"

import type { YieldSnapshot } from "@/hooks/useYields"
import { usePositions } from "@/hooks/usePositions"

import { getBridgeQuote, quoteUsdceOnLisk } from "@/lib/quotes"
import { switchOrAddChain, CHAINS } from "@/lib/wallet"
import { bridgeTokens } from "@/lib/bridge"
import { TokenAddresses } from "@/lib/constants"
import { depositMorphoOnLiskAfterBridge } from "@/lib/depositor"
import { publicLisk } from "@/lib/clients"
import {
  readWalletBalance,
  symbolForWalletDisplay,
  tokenAddrFor,
} from "./helpers"

type EvmChain = "optimism" | "base" | "lisk"
type FlowStep = "idle" | "bridging" | "depositing" | "success" | "error"

interface Token {
  id: "usdc" | "usdt"
  name: "USD Coin" | "Tether USD"
  symbol: "USDC" | "USDT"
  icon: string
  balance: number
  address: string
}

interface DepositWithdrawProps {
  initialTab?: "deposit" | "withdraw"
  snap?: YieldSnapshot
}

function toLiskDestLabel(src: YieldSnapshot["token"] | "USDC" | "USDT" | "WETH"): "USDCe" | "USDT0" | "WETH" {
  if (src === "USDC") return "USDCe"
  if (src === "USDT") return "USDT0"
  return "WETH"
}
async function ensureWalletChain(walletClient: any, chainId: number) {
  try { if ((walletClient as any)?.chain?.id === chainId) return } catch {}
  await walletClient.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] })
}
async function waitForLiskBalanceAtLeast(args: {
  user: `0x${string}`; tokenAddr: `0x${string}`; target: bigint; start?: bigint; pollMs?: number; timeoutMs?: number
}) {
  const { user, tokenAddr, target, start = 0n, pollMs = 6000, timeoutMs = 15 * 60_000 } = args
  const deadline = Date.now() + timeoutMs
  while (true) {
    const bal = (await publicLisk.readContract({
      address: tokenAddr,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [user],
    })) as bigint
    if (bal >= target) return
    if (Date.now() > deadline) throw new Error("Timeout waiting for bridged funds on Lisk")
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

function formatAmountBigint(amount: bigint, decimals: number): string {
  const neg = amount < 0n
  const abs = neg ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (frac === 0n) return `${neg ? "-" : ""}${wholeStr}`
  let fracStr = frac.toString().padStart(decimals, "0")
  fracStr = fracStr.slice(0, Math.min(6, fracStr.length)).replace(/0+$/, "")
  return `${neg ? "-" : ""}${wholeStr}${fracStr ? "." + fracStr : ""}`
}
function formatPlain(amount: bigint, decimals: number): string {
  const neg = amount < 0n
  const abs = neg ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base
  if (frac === 0n) return `${neg ? "-" : ""}${whole.toString()}`
  let fracStr = frac.toString().padStart(decimals, "0")
  fracStr = fracStr.slice(0, 6).replace(/0+$/, "")
  return `${neg ? "-" : ""}${whole.toString()}${fracStr ? "." + fracStr : ""}`
}

export function DepositWithdraw({ initialTab = "deposit", snap }: DepositWithdrawProps) {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()
  const { data: positionsRaw } = usePositions()

  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">(initialTab)
  const [amount, setAmount] = useState("")

  const [selectedToken, setSelectedToken] = useState<Token>({
    id: "usdc",
    name: "USD Coin",
    symbol: "USDC",
    icon: "/tokens/usdc-icon.png",
    balance: 0,
    address: "0x0000...0000",
  })

  const [showTokenModal, setShowTokenModal] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const [step, setStep] = useState<FlowStep>("idle")
  const [error, setError] = useState<string | null>(null)

  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [liBal, setLiBal] = useState<bigint | null>(null)
  const [liBalUSDT, setLiBalUSDT] = useState<bigint | null>(null)
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null)

  const [opUsdcBal, setOpUsdcBal] = useState<bigint | null>(null)
  const [baUsdcBal, setBaUsdcBal] = useState<bigint | null>(null)
  const [opUsdtBal, setOpUsdtBal] = useState<bigint | null>(null)
  const [baUsdtBal, setBaUsdtBal] = useState<bigint | null>(null)

  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(0n)
  const [received, setReceived] = useState<bigint>(0n)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const vaultToken: "USDC" | "USDT" | "WETH" = (snap?.token as any) ?? "USDC"
  const tokenDecimals = vaultToken === "WETH" ? 18 : 6
  const destTokenLabel = toLiskDestLabel(vaultToken)
  const isUsdtFamily = vaultToken === "USDT" || destTokenLabel === "USDT0"

  const positionShares = useMemo(() => {
    if (!positionsRaw) return 0n
    const tokenOnLisk = destTokenLabel
    const morpho = (positionsRaw as any[]).filter(
      (p) => p?.protocol === "Morpho Blue" && p?.chain === "lisk" && String(p?.token) === tokenOnLisk
    )
    return morpho.reduce<bigint>((acc, p) => acc + (p?.amount ?? 0n), 0n)
  }, [positionsRaw, destTokenLabel])
  const positionDisplay = useMemo(() => formatAmountBigint(positionShares, 18), [positionShares])
  const positionPlainForMax = useMemo(() => formatPlain(positionShares, 18), [positionShares])

  useEffect(() => {
    if (!snap) return
    const isUSDT = snap.token === "USDT"
    setSelectedToken((prev) => ({
      ...prev,
      id: isUSDT ? "usdt" : "usdc",
      name: isUSDT ? "Tether USD" : "USD Coin",
      symbol: isUSDT ? "USDT" : "USDC",
      icon: isUSDT ? "/tokens/usdt-icon.png" : "/tokens/usdc-icon.png",
    }))
  }, [snap])

  useEffect(() => { setStep("idle"); setError(null) }, [amount, snap?.chain, snap?.token, snap?.protocolKey])

  useEffect(() => {
    if (!walletClient || !snap) return
    const user = walletClient.account?.address as `0x${string}`

    const opSym = symbolForWalletDisplay(snap.token, "optimism")
    const baSym = symbolForWalletDisplay(snap.token, "base")
    const liSym = symbolForWalletDisplay(snap.token, "lisk")

    const addrOrNull = (sym: YieldSnapshot["token"], ch: EvmChain) => {
      try { return tokenAddrFor(sym, ch) } catch { return null }
    }

    const opAddr = addrOrNull(opSym, "optimism")
    const baAddr = addrOrNull(baSym, "base")
    const liAddr = addrOrNull(liSym, "lisk")

    const reads: Promise<bigint | null>[] = [
      opAddr ? readWalletBalance("optimism", opAddr, user) : Promise.resolve(null),
      baAddr ? readWalletBalance("base", baAddr, user) : Promise.resolve(null),
      liAddr ? readWalletBalance("lisk", liAddr, user) : Promise.resolve(null),
    ]

    const liskUSDTAddr = (TokenAddresses.USDT as any)?.lisk as `0x${string}` | undefined
    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)?.lisk as `0x${string}` | undefined
    if (isUsdtFamily) {
      reads.push(liskUSDTAddr ? readWalletBalance("lisk", liskUSDTAddr, user) : Promise.resolve(null))
      reads.push(liskUSDT0Addr ? readWalletBalance("lisk", liskUSDT0Addr, user) : Promise.resolve(null))
    } else {
      reads.push(Promise.resolve(null), Promise.resolve(null))
    }

    const opUsdc = addrOrNull("USDC", "optimism")
    const baUsdc = addrOrNull("USDC", "base")
    const opUsdt = addrOrNull("USDT", "optimism")
    const baUsdt = addrOrNull("USDT", "base")

    if (opUsdc) reads.push(readWalletBalance("optimism", opUsdc, user)); else reads.push(Promise.resolve(null))
    if (baUsdc) reads.push(readWalletBalance("base", baUsdc, user)); else reads.push(Promise.resolve(null))
    if (opUsdt) reads.push(readWalletBalance("optimism", opUsdt, user)); else reads.push(Promise.resolve(null))
    if (baUsdt) reads.push(readWalletBalance("base", baUsdt, user)); else reads.push(Promise.resolve(null))

    Promise.allSettled(reads).then((vals) => {
      const v = vals.map((r) => (r.status === "fulfilled" ? (r as any).value as bigint | null : null))
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
  }, [walletClient, snap, isUsdtFamily])

  useEffect(() => {
    if (!amount) return
    if (isUsdtFamily) {
      setSelectedToken((t) => ({ ...t, id: "usdt", name: "Tether USD", symbol: "USDT", icon: "/tokens/usdt-icon.png" }))
    } else {
      setSelectedToken((t) => ({ ...t, id: "usdc", name: "USD Coin", symbol: "USDC", icon: "/tokens/usdc-icon.png" }))
    }
  }, [amount, isUsdtFamily])

  useEffect(() => {
    const pickSrcBy = (o?: bigint | null, b?: bigint | null): "optimism" | "base" => {
      const need = parseUnits(amount || "0", 6)
      const op = o ?? 0n
      const ba = b ?? 0n
      if (need > 0n) {
        if (op >= need) return "optimism"
        if (ba >= need) return "base"
      }
      return op >= ba ? "optimism" : "base"
    }
    const toNum6 = (x?: bigint | null) => Number((x ?? 0n)) / 1e6
    const short = (addr?: `0x${string}` | null) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "0x0000…0000")

    if (selectedToken.symbol === "USDC") {
      const chosen = pickSrcBy(opUsdcBal, baUsdcBal)
      const bal = chosen === "optimism" ? toNum6(opUsdcBal) : toNum6(baUsdcBal)
      const addr = chosen === "optimism" ? (tokenAddrFor("USDC", "optimism") as `0x${string}` | null) : (tokenAddrFor("USDC", "base") as `0x${string}` | null)
      setSelectedToken((prev) => ({ ...prev, balance: bal, address: short(addr ?? null) }))
    }
    if (selectedToken.symbol === "USDT") {
      const chosen = pickSrcBy(opUsdtBal, baUsdtBal)
      const bal = chosen === "optimism" ? toNum6(opUsdtBal) : toNum6(baUsdtBal)
      const addr = chosen === "optimism" ? (tokenAddrFor("USDT", "optimism") as `0x${string}` | null) : (tokenAddrFor("USDT", "base") as `0x${string}` | null)
      setSelectedToken((prev) => ({ ...prev, balance: bal, address: short(addr ?? null) }))
    }
  }, [selectedToken.symbol, opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal, amount])

  useEffect(() => {
    if (!walletClient || !amount || !snap) {
      setRoute(null); setFee(0n); setReceived(0n); setQuoteError(null)
      return
    }
    const dest = snap.chain as EvmChain
    if (dest !== "lisk") {
      setRoute(null); setFee(0n); setReceived(0n); setQuoteError("Only Lisk deposits are supported")
      return
    }
    const amt = parseUnits(amount, tokenDecimals)

    const pickSrcBy = (o?: bigint | null, b?: bigint | null): "optimism" | "base" => {
      const op = o ?? 0n
      const ba = b ?? 0n
      if (op >= amt) return "optimism"
      if (ba >= amt) return "base"
      return op >= ba ? "optimism" : "base"
    }

    if (toLiskDestLabel(vaultToken) === "USDT0") {
      const src = selectedToken.symbol === "USDC" ? pickSrcBy(opUsdcBal, baUsdcBal) : pickSrcBy(opUsdtBal, baUsdtBal)
      getBridgeQuote({
        token: "USDT0",
        amount: amt,
        from: src,
        to: dest,
        fromAddress: walletClient.account!.address as `0x${string}`,
        fromTokenSym: selectedToken.symbol,
      })
        .then((q) => {
          const minOut = BigInt(q.estimate?.toAmountMin ?? "0")
          const fee = BigInt(q.bridgeFeeTotal ?? "0")
          setRoute(q.route ?? `Bridge ${selectedToken.symbol} → USDT0`)
          setFee(fee)
          setReceived(minOut)
          setQuoteError(null)
        })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError("Could not fetch bridge quote") })
      return
    }

    if (toLiskDestLabel(vaultToken) === "USDCe") {
      if ((liBal ?? 0n) >= amt) { setRoute("On-chain"); setFee(0n); setReceived(amt); setQuoteError(null); return }
      quoteUsdceOnLisk({
        amountIn: amt,
        opBal, baBal,
        fromAddress: walletClient.account!.address as `0x${string}`,
      })
        .then((q) => { setRoute(q.route ?? "Bridge → USDCe"); setFee(q.bridgeFee ?? 0n); setReceived(q.bridgeOutUSDCe ?? 0n); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError("Could not fetch bridge quote") })
      return
    }

    setRoute("On-chain"); setFee(0n); setReceived(amt); setQuoteError(null)
  }, [
    amount, walletClient, tokenDecimals, snap, vaultToken,
    opBal, baBal, liBal, liBalUSDT, liBalUSDT0,
    selectedToken.symbol, opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal,
  ])

  const handleConfirm = async () => {
    if (!walletClient) { openConnect(); return }
    if (!amount || Number(amount) <= 0) return
    if (!snap) { alert("Vault not ready"); return }

    try {
      setError(null)
      const inputAmt = parseUnits(amount, tokenDecimals)
      const user = walletClient.account!.address as `0x${string}`

      if (snap.chain !== "lisk") throw new Error("Only Lisk deposits are supported in this build")

      const destLabel = toLiskDestLabel(snap.token)
      const destTokenAddr =
        destLabel === "USDCe" ? (TokenAddresses.USDCe.lisk as `0x${string}`) :
        destLabel === "USDT0" ? (TokenAddresses.USDT0.lisk as `0x${string}`) :
        (TokenAddresses.WETH.lisk as `0x${string}`)

      if (destLabel === "USDCe" && (liBal ?? 0n) >= inputAmt) {
        setStep("depositing")
        await ensureWalletChain(walletClient, liskChain.id)
        await depositMorphoOnLiskAfterBridge(snap, inputAmt, walletClient)
        setStep("success"); setShowSuccessModal(true); setAmount(""); setShowReview(false); return
      }
      if (destLabel === "USDT0" && (liBalUSDT0 ?? 0n) >= inputAmt) {
        setStep("depositing")
        await ensureWalletChain(walletClient, liskChain.id)
        await depositMorphoOnLiskAfterBridge(snap, inputAmt, walletClient)
        setStep("success"); setShowSuccessModal(true); setAmount(""); setShowReview(false); return
      }

      const pickSrcBy = (o?: bigint | null, b?: bigint | null): "optimism" | "base" => {
        const op = o ?? 0n, ba = b ?? 0n
        if (op >= inputAmt) return "optimism"
        if (ba >= inputAmt) return "base"
        return op >= ba ? "optimism" : "base"
      }

      const srcToken: "USDC" | "USDT" | "WETH" =
        destLabel === "USDT0" ? selectedToken.symbol : destLabel === "USDCe" ? "USDC" : "WETH"

      const srcChain: "optimism" | "base" =
        srcToken === "USDC" ? pickSrcBy(opUsdcBal, baUsdcBal)
        : srcToken === "USDT" ? pickSrcBy(opUsdtBal, baUsdtBal)
        : pickSrcBy(opBal, baBal)

      setStep("bridging")

      const preBal = (await publicLisk.readContract({
        address: destTokenAddr,
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "balanceOf",
        args: [user],
      })) as bigint

      const q = await getBridgeQuote({
        token: destLabel, amount: inputAmt, from: srcChain, to: "lisk",
        fromAddress: user, fromTokenSym: srcToken === "WETH" ? undefined : srcToken,
      })
      const minOut = BigInt(q.estimate?.toAmountMin ?? "0")

      await switchOrAddChain(walletClient, srcChain === "optimism" ? CHAINS.optimism : CHAINS.base)
      await bridgeTokens(destLabel, inputAmt, srcChain, "lisk", walletClient, {
        sourceToken: srcToken === "WETH" ? undefined : srcToken,
        onUpdate: () => {},
      })

      await waitForLiskBalanceAtLeast({
        user,
        tokenAddr: destTokenAddr,
        target: preBal + (minOut > 0n ? minOut : 1n),
        start: preBal,
      })

      setStep("depositing")
      await switchOrAddChain(walletClient, CHAINS.lisk)
      await ensureWalletChain(walletClient, liskChain.id)

      await depositMorphoOnLiskAfterBridge(snap, minOut > 0n ? minOut : inputAmt, walletClient)

      setStep("success")
      setShowSuccessModal(true)
      setAmount("")
      setShowReview(false)
    } catch (e: any) {
      console.error("[ui] deposit error", e)
      setError(e?.message || String(e))
      setStep("error")
    }
  }

  const amountNum = Number.parseFloat(amount) || 0

  const bridgeFeeDisplay = useMemo(() => {
    if (!amount || Number(amount) <= 0) return 0
    if (fee === 0n) return 0.0025
    return Number(fee) / 10 ** tokenDecimals
  }, [amount, fee, tokenDecimals])

  const receiveAmountDisplay = useMemo(() => {
    if (!amount) return 0
    if (received === 0n) return Math.max(amountNum - 0.0025, 0)
    return Number(received) / 10 ** tokenDecimals
  }, [amount, amountNum, received, tokenDecimals])

  const previewDeltaPct = useMemo(() => {
    const a = Number(amount || "0")
    if (!a || a <= 0) return 0
    const diff = receiveAmountDisplay - a
    return (diff / a) * 100
  }, [amount, receiveAmountDisplay])

  const previewSourceChainLabel = useMemo(() => {
    const need = parseUnits(amount || "0", tokenDecimals)
    const pickSrcBy = (o?: bigint | null, b?: bigint | null): "optimism" | "base" => {
      const op = o ?? 0n
      const ba = b ?? 0n
      if (op >= need) return "optimism"
      if (ba >= need) return "base"
      return op >= ba ? "optimism" : "base"
    }
    const src =
      selectedToken.symbol === "USDC"
        ? pickSrcBy(opUsdcBal, baUsdcBal)
        : selectedToken.symbol === "USDT"
        ? pickSrcBy(opUsdtBal, baUsdtBal)
        : pickSrcBy(opBal, baBal)
    return src === "optimism" ? "OP Mainnet" : "Base"
  }, [amount, tokenDecimals, selectedToken.symbol, opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal, opBal, baBal])

  const toNum6 = (x?: bigint | null) => Number((x ?? 0n)) / 1e6
  const usdcChosenIsOp = (opUsdcBal ?? 0n) >= (baUsdcBal ?? 0n)
  const usdtChosenIsOp = (opUsdtBal ?? 0n) >= (baUsdtBal ?? 0n)
  const availableTokens: Token[] = [
    {
      id: "usdc",
      name: "USD Coin",
      symbol: "USDC",
      icon: "/tokens/usdc-icon.png",
      balance: usdcChosenIsOp ? toNum6(opUsdcBal) : toNum6(baUsdcBal),
      address: (usdcChosenIsOp
        ? tokenAddrFor("USDC", "optimism")
        : tokenAddrFor("USDC", "base"))?.replace(/^(.{6}).+(.{4})$/, "$1…$2") || "0x0000…0000",
    },
    {
      id: "usdt",
      name: "Tether USD",
      symbol: "USDT",
      icon: "/tokens/usdt-icon.png",
      balance: usdtChosenIsOp ? toNum6(opUsdtBal) : toNum6(baUsdtBal),
      address: (usdtChosenIsOp
        ? tokenAddrFor("USDT", "optimism")
        : tokenAddrFor("USDT", "base"))?.replace(/^(.{6}).+(.{4})$/, "$1…$2") || "0x0000…0000",
    },
  ]

  const confirmDisabled = !(amountNum > 0) || Boolean(quoteError) || !snap
  const isConfirmingNow = step === "bridging" || step === "depositing"

  if (!snap) {
    return (
      <Card className="w-full max-w-2xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
          <div className="h-10 bg-muted rounded" />
        </div>
      </Card>
    )
  }

  const topRightBalance =
    activeTab === "withdraw"
      ? `${positionDisplay} ${toLiskDestLabel(vaultToken)}`
      : `${selectedToken.balance.toFixed(2)} ${selectedToken.symbol}`

  const onMaxClick = () => {
    if (activeTab === "withdraw") setAmount(positionPlainForMax)
    else setAmount(selectedToken.balance.toFixed(2))
  }

  const vaultLabel = `Re7 ${vaultToken} Vault (Morpho Blue)`
  const routeLabel = route ?? (activeTab === "withdraw" ? "Redeem from vault" : "Routing via LI.FI bridge")

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex items-center gap-8 mb-8 border-b">
          <button
            onClick={() => setActiveTab("deposit")}
            className={`pb-3 font-semibold transition-colors relative ${activeTab === "deposit" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Deposit
            {activeTab === "deposit" && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />}
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`pb-3 font-semibold transition-colors relative ${activeTab === "withdraw" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Withdraw
            {activeTab === "withdraw" && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />}
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {/* Label and Balance */}
          <div className="flex items-center justify-between">
            <label className="text-muted-foreground">
              {activeTab === "deposit" ? "Deposit" : "Withdraw"} {activeTab === "withdraw" ? toLiskDestLabel(vaultToken) : selectedToken.symbol}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">{topRightBalance}</span>
              <button onClick={onMaxClick} className="text-primary text-sm font-semibold hover:underline">MAX</button>
            </div>
          </div>

          {/* Amount Input Section */}
          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-3xl font-semibold bg-transparent outline-none w-full placeholder:text-muted-foreground"
                />
                <div className="text-muted-foreground mt-2">
                  {activeTab === "deposit" ? `$${(Number.parseFloat(amount || "0") * 1).toFixed(2)}` : `${toLiskDestLabel(vaultToken)} shares`}
                </div>
              </div>

              {/* Token Selector (deposit only) */}
              {activeTab === "deposit" && (
                <button
                  onClick={() => setShowTokenModal(true)}
                  className="flex items-center gap-2 bg-background px-4 py-2 rounded-lg hover:bg-muted transition-colors border border-border"
                >
                  <div className="w-6 h-6 relative">
                    <Image src={selectedToken.icon} alt={selectedToken.symbol} width={24} height={24} className="rounded-full" />
                  </div>
                  <span className="font-semibold">{selectedToken.symbol}</span>
                  <ChevronDown size={20} className="text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Placeholder */}
          {!amount && <div className="text-center py-8 text-muted-foreground rounded-lg bg-muted">Enter an amount</div>}

          {/* Primary actions */}
          {amount && activeTab === "deposit" && (
            <Button
              onClick={() => setShowReview(true)}
              size="lg"
              disabled={confirmDisabled}
              className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6 disabled:opacity-60"
              title={quoteError ?? "Deposit"}
            >
              Review deposit
            </Button>
          )}
          {amount && activeTab === "withdraw" && (
            <Button
              size="lg"
              disabled
              className="w-full text-white bg-blue-600 text-lg font-semibold py-6 opacity-60"
              title="Withdraw flow coming soon"
            >
              Withdraw
            </Button>
          )}

          {/* Route & Fees — now shown for BOTH tabs */}
          {amount && (
            <div className="border border-border rounded-lg">
              <details open className="group">
                <summary className="list-none w-full px-4 py-4 flex items-center justify-between hover:bg-muted transition-colors cursor-pointer">
                  <span className="font-semibold text-foreground">Route & fees</span>
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">↑</span>
                </summary>

                <div className="border-t border-border px-4 py-4 space-y-4 bg-muted">
                  {/* Route Display */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="bg-background rounded-lg p-3 flex items-center gap-2 justify-center">
                        <div className="w-4 h-4 relative">
                          <Image src="/networks/op-icon.png" alt="OP Mainnet" width={16} height={16} className="rounded-full" />
                        </div>
                        <span className="text-sm">OP Mainnet</span>
                        <span className="text-sm font-semibold">{activeTab === "deposit" ? selectedToken.symbol : destTokenLabel}</span>
                      </div>
                    </div>
                    <span className="text-xl text-muted-foreground">→</span>
                    <div className="flex-1">
                      <div className="bg-background rounded-lg p-3 flex items-center gap-2 justify-center">
                        <div className="w-4 h-4 relative">
                          <Image src="/networks/lisk.png" alt="Lisk" width={16} height={16} className="rounded-full" />
                        </div>
                        <span className="text-sm">Lisk</span>
                        <span className="text-sm font-semibold">{destTokenLabel}</span>
                      </div>
                    </div>
                  </div>

                  {/* Fee Details */}
                  <div className="bg-background rounded-lg p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 relative flex-shrink-0">
                        <Image
                          src="/protocols/bridge-icon.png"
                          alt="Bridge"
                          width={24}
                          height={24}
                          className="rounded-full"
                          onError={(e) => { (e.target as HTMLImageElement).src = "/protocols/morpho-icon.png" }}
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-muted-foreground text-sm">{routeLabel}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-muted-foreground text-sm">Bridge fee (estimated):</span>
                          <span className="font-semibold text-foreground">
                            {bridgeFeeDisplay.toFixed(6)} {activeTab === "deposit" ? selectedToken.symbol : destTokenLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-muted-foreground text-sm">
                            You&apos;ll {activeTab === "deposit" ? "deposit" : "receive"}:
                          </span>
                          <span className="font-semibold text-foreground">
                            {receiveAmountDisplay.toFixed(6)} {destTokenLabel}
                          </span>
                        </div>
                        {quoteError && <div className="mt-2 text-xs text-red-600">Quote error: {quoteError}</div>}
                        {error && <div className="mt-2 text-xs text-red-600">Error: {error}</div>}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </Card>

      {showTokenModal && activeTab === "deposit" && (
        <SelectTokenModal
          tokens={availableTokens}
          selectedToken={selectedToken}
          onSelect={(token: any) => {
            setSelectedToken(token)
            setShowTokenModal(false)
          }}
          onClose={() => setShowTokenModal(false)}
        />
      )}

      {showReview && (
        <ReviewDepositModal
          open={showReview}
          onClose={() => (isConfirmingNow ? null : setShowReview(false))}
          onConfirm={handleConfirm}
          amountInput={amount}
          sourceToken={selectedToken.symbol}
          destToken={destTokenLabel}
          sourceChainLabel={previewSourceChainLabel}
          bridgeFeeTokenAmount={bridgeFeeDisplay}
          destAmount={receiveAmountDisplay}
          estDeltaPct={previewDeltaPct}
          vaultLabel={vaultLabel}
          confirming={isConfirmingNow}
          errorText={error}
        />
      )}

      {showSuccessModal && (
        <DepositSuccessModal
          amount={amountNum}
          sourceToken={selectedToken.symbol}
          destinationAmount={receiveAmountDisplay}
          destinationToken={toLiskDestLabel(vaultToken)}
          vault={vaultLabel}
          onClose={() => {
            setShowSuccessModal(false)
            setAmount("")
            setStep("idle")
          }}
        />
      )}
    </>
  )
}
