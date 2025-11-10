"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import Image from "next/image"

import { ChevronDown } from "lucide-react"
import { Card } from "../ui/Card"
import { SelectTokenModal } from "./select-token-modal"
import { DepositSuccessModal } from "./DepositModal/deposit-success-modal"

interface Token {
  id: string
  name: string
  symbol: string
  icon: string
  balance: number
  address: string
}

interface DepositWithdrawProps {
  initialTab?: "deposit" | "withdraw"
}

export function DepositWithdraw({ initialTab = "deposit" }: DepositWithdrawProps) {
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">(initialTab)
  const [amount, setAmount] = useState("")
  const [selectedToken, setSelectedToken] = useState<Token>({
    id: "usdc",
    name: "USD Coin",
    symbol: "USDC",
    icon: "/tokens/usdc-icon.png",
    balance: 26.83,
    address: "0x4200...0042",
  })
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [expandFees, setExpandFees] = useState(false)

  const availableTokens: Token[] = [
    {
      id: "usdc",
      name: "USD Coin",
      symbol: "USDC",
      icon: "/tokens/usdc-icon.png",
      balance: 26.83,
      address: "0x4200...0042",
    },
    {
      id: "usdt",
      name: "Tether USD",
      symbol: "USDT",
      icon: "/tokens/usdt-icon.png",
      balance: 11.68,
      address: "0x4200...0042",
    },
    {
      id: "usdt0",
      name: "Stargate USD",
      symbol: "USDT0",
      icon: "/tokens/usdt0-icon.png",
      balance: 5.42,
      address: "0x4200...0042",
    },
  ]

  const handleMaxClick = () => {
    setAmount(selectedToken.balance.toFixed(2))
  }

  const handleDeposit = () => {
    if (amount && Number.parseFloat(amount) > 0) {
      setShowSuccessModal(true)
    }
  }

  const amountNum = Number.parseFloat(amount) || 0
  const bridgeFee = 0.0025
  const receiveAmount = (amountNum - bridgeFee).toFixed(6)

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex items-center gap-8 mb-8 border-b">
          <button
            onClick={() => setActiveTab("deposit")}
            className={`pb-3 font-semibold transition-colors relative ${
              activeTab === "deposit" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Deposit
            {activeTab === "deposit" && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-t" />}
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`pb-3 font-semibold transition-colors relative ${
              activeTab === "withdraw" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
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
              {activeTab === "deposit" ? "Deposit" : "Withdraw"} {selectedToken.symbol}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {selectedToken.balance.toFixed(2)} {selectedToken.symbol}
              </span>
              <button onClick={handleMaxClick} className="text-primary text-sm font-semibold hover:underline">
                MAX
              </button>
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
                <div className="text-muted-foreground mt-2">${(amountNum * 1).toFixed(2)}</div>
              </div>

              {/* Token Selector */}
              <button
                onClick={() => setShowTokenModal(true)}
                className="flex items-center gap-2 bg-background px-4 py-2 rounded-lg hover:bg-muted transition-colors border border-border"
              >
                <div className="w-6 h-6 relative">
                  <Image
                    src={selectedToken.icon}
                    alt={selectedToken.symbol}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                </div>
                <span className="font-semibold">{selectedToken.symbol}</span>
                <ChevronDown size={20} className="text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Placeholder for Amount Entry */}
          {!amount && <div className="text-center py-8 text-muted-foreground rounded-lg bg-muted">Enter an amount</div>}

          {/* Deposit Button */}
          {amount && (
            <>
              <Button
                onClick={handleDeposit}
                size="lg"
                className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6"
              >
                {activeTab === "deposit" ? "Deposit" : "Withdraw"}
              </Button>

              {/* Route & Fees Section */}
              <div className="border border-border rounded-lg">
                <button
                  onClick={() => setExpandFees(!expandFees)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-muted transition-colors"
                >
                  <span className="font-semibold text-foreground">Route & fees</span>
                  <span className={`text-muted-foreground transition-transform ${expandFees ? "rotate-180" : ""}`}>
                    ↑
                  </span>
                </button>

                {expandFees && (
                  <div className="border-t border-border px-4 py-4 space-y-4 bg-muted">
                    {/* Route Display */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="bg-background rounded-lg p-3 flex items-center gap-2 justify-center">
                          <div className="w-4 h-4 relative">
                            <Image
                              src="/networks/op-icon.png"
                              alt="OP Mainnet"
                              width={16}
                              height={16}
                              className="rounded-full"
                            />
                          </div>
                          <span className="text-sm">OP Mainnet</span>
                          <span className="text-sm font-semibold">{selectedToken.symbol}</span>
                        </div>
                      </div>
                      <span className="text-xl text-muted-foreground">→</span>
                      <div className="flex-1">
                        <div className="bg-background rounded-lg p-3 flex items-center gap-2 justify-center">
                          <div className="w-4 h-4 relative">
                            <Image
                              src="/networks/lisk.png"
                              alt="Lisk"
                              width={16}
                              height={16}
                              className="rounded-full"
                            />
                          </div>
                          <span className="text-sm">Lisk</span>
                          <span className="text-sm font-semibold">{selectedToken.symbol}e</span>
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
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "/protocols/morpho-icon.png"
                            }}
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-muted-foreground text-sm">Routing via LI.FI bridge</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-muted-foreground text-sm">Bridge fee (estimated):</span>
                            <span className="font-semibold text-foreground">
                              {bridgeFee.toFixed(4)} {selectedToken.symbol}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-muted-foreground text-sm">
                              You'll {activeTab === "deposit" ? "deposit" : "receive"}:
                            </span>
                            <span className="font-semibold text-foreground">
                              {receiveAmount} {selectedToken.symbol}e
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Modals */}
      {showTokenModal && (
        <SelectTokenModal
          tokens={availableTokens}
          selectedToken={selectedToken}
          onSelect={(token:any) => {
            setSelectedToken(token)
            setShowTokenModal(false)
          }}
          onClose={() => setShowTokenModal(false)}
        />
      )}

      {showSuccessModal && (
        <DepositSuccessModal
          amount={amountNum}
          sourceToken={selectedToken.symbol}
          destinationAmount={Number.parseFloat(receiveAmount)}
          destinationToken={`${selectedToken.symbol}e`}
          vault="Re7 USDC Vault (Morpho Blue)"
          onClose={() => {
            setShowSuccessModal(false)
            setAmount("")
          }}
        />
      )}
    </>
  )
}
