// src/components/NavBar.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'

export function Navbar() {
  const { open }       = useAppKit()
  const { address }    = useAppKitAccount()
  const { disconnect } = useDisconnect()
  const [menuOpen, setMenuOpen] = useState(false)

  const short = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : ''

  return (
    <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-extrabold tracking-tight text-secondary-foreground">
        <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
          SuperYield-R
        </span>
      </h1>
      <nav className="flex items-center gap-4 text-sm font-medium">
        <Link href="/" className="opacity-80 hover:opacity-100">Dashboard</Link>
        <Link href="#" className="opacity-80 hover:opacity-100">Docs</Link>

        {!address ? (
          <Button onClick={open} className="px-4 py-2 text-xs" title={'Connect Wallet'}>
            Connect Wallet
          </Button>
        ) : (
          <>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-full bg-secondary/10 px-3 py-1 text-xs font-semibold"
            >
              {short}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 w-40 rounded-md border border-secondary/20 bg-white p-2 text-sm shadow-lg">
                <button
                  className="block w-full rounded px-3 py-2 text-left hover:bg-secondary/10"
                  onClick={() => { setMenuOpen(false); open() }}
                >
                  Switch wallet
                </button>
                <button
                  className="mt-1 block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50"
                  onClick={() => { setMenuOpen(false); disconnect() }}
                >
                  Disconnect
                </button>
              </div>
            )}
          </>
        )}
      </nav>
    </header>
  )
}
