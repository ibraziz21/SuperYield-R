// src/components/NavBar.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAppKit } from '@reown/appkit/react'                    // ⬅️ keep only useAppKit
import { useAccount, useDisconnect, useChainId, useSwitchChain } from 'wagmi'
import { Button } from '@/components/ui/button'

const CHAIN_META: Record<number, { key: 'optimism' | 'base' | 'lisk'; label: string; badge: string; bg: string; ring: string }> = {
  10:   { key: 'optimism', label: 'Optimism', badge: 'OP',   bg: 'bg-rose-600',   ring: 'ring-rose-500/30' },
  8453: { key: 'base',     label: 'Base',     badge: 'BASE', bg: 'bg-blue-600',   ring: 'ring-blue-500/30' },
  1135: { key: 'lisk',     label: 'Lisk',     badge: 'LSK',  bg: 'bg-indigo-600', ring: 'ring-indigo-500/30' },
}

function shortAddr(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''
}

function NetworkBadge({ chainId }: { chainId?: number }) {
  if (!chainId || !CHAIN_META[chainId]) return null
  const m = CHAIN_META[chainId]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${m.bg} ring-1 ${m.ring}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {m.badge}
    </span>
  )
}

function ActiveLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/' && pathname.startsWith(href))
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-sm transition ${
        active
          ? 'bg-teal-600 text-white'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
      }`}
    >
      {children}
    </Link>
  )
}

export function Navbar() {
  const pathname = usePathname()
  const { open } = useAppKit()
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()

  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
    setMobileOpen(false)
  }, [pathname])

  const currentChain = useMemo(() => (chainId ? CHAIN_META[chainId] : undefined), [chainId])

  async function copyAddress() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  async function quickSwitch(id: number) {
    try {
      await switchChainAsync?.({ chainId: id })
    } catch (e) {
      console.error('Switch chain failed:', e)
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-white/70 backdrop-blur-md dark:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-3 sm:px-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center gap-2">
            <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 shadow-sm ring-1 ring-black/5" />
            <span className="text-lg font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-600 bg-clip-text text-transparent">
                SuperYield-R
              </span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="ml-2 hidden items-center gap-1 md:flex">
            <ActiveLink href="/">Dashboard</ActiveLink>
            <ActiveLink href="/markets">Markets</ActiveLink>
            <ActiveLink href="/docs">Docs</ActiveLink>
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Mobile menu button */}
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            title="Menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-80"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>

          {/* Network badge (if connected) */}
          {address && <NetworkBadge chainId={chainId} />}

          {/* Wallet area */}
          {!address ? (
            <Button
              onClick={() => open({ view: 'Connect' })} 
              className="hidden md:inline-flex gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-500 hover:to-cyan-500"
              title="Connect Wallet"
            >
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M21 7H5a2 2 0 0 0-2 2v6a3 3 0 0 0 3 3h15V7Zm-4 6a2 2 0 1 1 0-4h2v4h-2Z"/><path fill="currentColor" d="M19 9h-2a4 4 0 0 0 0 8h2v-2h-2a2 2 0 1 1 0-4h2V9Z"/></svg>
              Connect
            </Button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-sm font-semibold hover:bg-background"
                title="Wallet menu"
              >
                <div className="h-5 w-5 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                <span>{shortAddr(address)}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" className="opacity-60"><path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-xl">
                  {/* header */}
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold">{shortAddr(address)}</span>
                        <span className="text-[10px] text-muted-foreground">{currentChain?.label ?? 'Unknown'}</span>
                      </div>
                    </div>
                    <NetworkBadge chainId={chainId} />
                  </div>

                  {/* actions */}
                  <div className="p-2 text-sm">
                    <button
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 hover:bg-muted/60"
                      onClick={copyAddress}
                      title="Copy address"
                    >
                      <span>Copy address</span>
                      <span className={`text-xs ${copied ? 'text-teal-600' : 'text-muted-foreground'}`}>
                        {copied ? 'Copied' : '⌘C'}
                      </span>
                    </button>
                    <button
                      className="mt-1 flex w-full items-center justify-between rounded-md px-3 py-2 hover:bg-muted/60"
                      onClick={() => { setMenuOpen(false); open({ view: 'Connect' }) }}  
                    >
                      <span>Switch wallet</span>
                      <span className="text-xs text-muted-foreground">Modal</span>
                    </button>

                    {/* quick network switch */}
                    <div className="mt-2 rounded-md border p-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Networks</div>
                      <div className="grid grid-cols-3 gap-1">
                        {[10, 8453, 1135].map((id) => {
                          const meta = CHAIN_META[id]
                          const active = chainId === id
                          return (
                            <button
                              key={id}
                              onClick={() => quickSwitch(id)}
                              disabled={isSwitching || active}
                              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] ${
                                active ? `${meta.bg} text-white` : 'bg-muted hover:bg-muted/80'
                              } disabled:opacity-60`}
                              title={meta.label}
                            >
                              {meta.badge}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <button
                      className="mt-2 flex w-full items-center justify-between rounded-md px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                      onClick={() => { setMenuOpen(false); disconnect() }}
                      title="Disconnect"
                    >
                      <span>Disconnect</span>
                      <span className="text-xs">⌘D</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div className="md:hidden">
          <div className="mx-auto w-full max-w-6xl px-3 pb-3">
            <nav className="mt-2 grid gap-1">
              <ActiveLink href="/">Dashboard</ActiveLink>
              <ActiveLink href="/markets"> Markets</ActiveLink>
              <ActiveLink href="/docs"> Docs</ActiveLink>
              
            </nav>

            {!address && (
              <Button
                onClick={() => open({ view: 'Connect' })} 
                className="mt-3 w-full bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-500 hover:to-cyan-500"
                title="Connect Wallet"
              >
                Connect Wallet
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
