"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import { X } from "lucide-react"
import React from "react"

type ChainLabel = "OP Mainnet" | "Base" | string

interface ReviewDepositModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  /** Decimal user input as string (e.g. "10") */
  amountInput: string
  /** Source token on source chain (USDC | USDT) */
  sourceToken: "USDC" | "USDT"
  /** Destination token label on Lisk (USDCe | USDT0 | WETH) */
  destToken: "USDCe" | "USDT0" | "WETH"
  /** Source chain label for display */
  sourceChainLabel?: ChainLabel
  /** Bridge fee in *source token* units (e.g. 0.0025 USDC) */
  bridgeFeeTokenAmount?: number
  /** Expected amount on Lisk after fees/slippage (dest token units) */
  destAmount?: number
  /** A small %-delta display like -0.04 (pass negative for -0.04%) */
  estDeltaPct?: number
  /** Vault label – e.g. "Re7 USDC Vault (Morpho Blue)" */
  vaultLabel: string
  /** Busy while executing */
  confirming?: boolean
  /** Optional error to surface inline */
  errorText?: string | null
}

const tokenIcons: Record<string, string> = {
  USDC: "/tokens/usdc-icon.png",
  USDT: "/tokens/usdt-icon.png",
  USDT0: "/tokens/usdt0-icon.png",
  USDCe: "/tokens/usdc-icon.png",
  WETH: "/tokens/weth.png",
}

export const ReviewDepositModal: React.FC<ReviewDepositModalProps> = ({
  open,
  onClose,
  onConfirm,
  amountInput,
  sourceToken,
  destToken,
  sourceChainLabel = "OP Mainnet",
  bridgeFeeTokenAmount = 0,
  destAmount = 0,
  estDeltaPct = -0.04,
  vaultLabel,
  confirming = false,
  errorText,
}) => {
  const srcIcon = tokenIcons[sourceToken] || "/tokens/usdc-icon.png"
  const dstIcon = tokenIcons[destToken] || srcIcon

  return (
    <Dialog open={open} onOpenChange={(v) => !confirming && !v ? onClose() : null}>
      <DialogContent className="w-[min(92vw,520px)] overflow-hidden rounded-2xl p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <DialogHeader className="p-0">
            <DialogTitle className="text-xl font-semibold">Review deposit</DialogTitle>
          </DialogHeader>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-muted"
            disabled={confirming}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pb-5">
          <div className="text-sm text-muted-foreground mb-3">You’re depositing</div>

          {/* Row 1: Source */}
          <div className="flex items-center gap-3 py-3">
            <div className="relative h-10 w-10 overflow-hidden rounded-full border bg-white">
              <Image src={srcIcon} alt={sourceToken} width={40} height={40} className="object-contain" />
              <div className="absolute -bottom-1 -right-1 rounded-full border bg-white p-0.5">
                <Image src="/networks/op-icon.png" alt="OP" width={16} height={16} />
              </div>
            </div>
            <div className="flex-1">
              <div className="text-lg font-semibold leading-5">
                {Number.isFinite(Number(amountInput)) ? Number(amountInput).toString() : amountInput}
              </div>
              <div className="text-xs text-muted-foreground">
                ${Number(amountInput || "0").toFixed(2)} • {sourceToken} on {sourceChainLabel}
              </div>
            </div>
          </div>

          {/* Row 2: Bridge */}
          <div className="relative ml-[20px] border-l border-dashed border-border pl-6">
            <div className="flex items-center gap-3 py-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-full border bg-white">
                <Image src="/protocols/lifi.png" alt="LI.FI" width={40} height={40} className="object-contain" />
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold leading-5">Bridging via LI.FI</div>
                <div className="text-xs text-muted-foreground">
                  Bridge Fee: {bridgeFeeTokenAmount.toFixed(4)} {sourceToken}
                </div>
              </div>
            </div>

            {/* Row 3: Destination preview */}
            <div className="flex items-center gap-3 py-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-full border bg-white">
                <Image src={dstIcon} alt={destToken} width={40} height={40} className="object-contain" />
                <div className="absolute -bottom-1 -right-1 rounded-full border bg-white p-0.5">
                  <Image src="/networks/lisk.png" alt="Lisk" width={16} height={16} />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold leading-5">{destAmount.toFixed(6)}</div>
                <div className="text-xs text-muted-foreground">
                  ${Number(amountInput || "0").toFixed(2)} •{" "}
                  {estDeltaPct < 0 ? `${estDeltaPct.toFixed(2)}%` : `+${estDeltaPct.toFixed(2)}%`} • {destToken} on Lisk
                </div>
              </div>
            </div>
          </div>

          {/* Row 4: Vault */}
          <div className="mt-2 flex items-center gap-3 rounded-xl bg-muted/60 p-3">
            <div className="relative h-10 w-10 overflow-hidden rounded-xl border bg-white">
              <Image src="/protocols/morpho-icon.png" alt="Vault" width={40} height={40} className="object-contain" />
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold leading-5">Depositing in Vault</div>
              <div className="text-xs text-muted-foreground">{vaultLabel}</div>
            </div>
          </div>

          {/* Error (if any) */}
          {!!errorText && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorText}
            </div>
          )}

          {/* CTA */}
          <div className="mt-5">
            <Button
              onClick={onConfirm}
              disabled={confirming}
              className="h-11 w-full text-base bg-blue-600 font-semibold"
            >
              {confirming ? "Confirming…" : "Confirm deposit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
