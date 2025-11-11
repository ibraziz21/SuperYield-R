"use client"

import { X } from "lucide-react"
import Image from "next/image"

interface Token {
  id: string
  name: string
  symbol: string
  icon: string
  balance: number
  address: string
}

interface SelectTokenModalProps {
  tokens: Token[]
  selectedToken: Token
  onSelect: (token: Token) => void
  onClose: () => void
}

export function SelectTokenModal({ tokens, selectedToken, onSelect, onClose }: SelectTokenModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-2xl w-full max-w-sm mx-4 shadow-lg border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-2xl font-bold">Select a token</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X size={24} className="text-foreground" />
          </button>
        </div>

        {/* Token List */}
        <div className="divide-y divide-border">
          {tokens.map((token) => (
            <button
              key={token.id}
              onClick={() => onSelect(token)}
              className="w-full px-6 py-4 hover:bg-muted transition-colors flex items-center justify-between group"
            >
              <div className="flex items-center gap-4 flex-1 text-left">
                <div className="w-8 h-8 relative">
                  <Image src={token.icon} alt={token.symbol} width={32} height={32} className="rounded-full" />
                </div>
                <div>
                  <p className="font-semibold text-lg text-foreground">{token.name}</p>
                  <p className="text-sm text-muted-foreground">{token.address}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground text-lg">{token.balance.toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">${token.balance.toFixed(2)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
