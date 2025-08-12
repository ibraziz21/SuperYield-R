// src/components/NavBar.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { useAppKit } from '@reown/appkit/react' // keep only useAppKit
import { useAccount, useDisconnect, useChainId, useSwitchChain } from 'wagmi'
import { Button } from '@/components/ui/button'
import socialImg from '@/public/logo_horizontal.svg'

/* ──────────────────────────────────────────────────────────────── */

const CHAIN_META: Record<number, { key: 'optimism' | 'base' | 'lisk'; label: string; badge: string; bg: string; ring: string }> = {
  10: { key: 'optimism', label: 'Optimism', badge: 'OP', bg: 'bg-rose-600', ring: 'ring-rose-500/30' },
  8453: { key: 'base', label: 'Base', badge: 'BASE', bg: 'bg-blue-600', ring: 'ring-blue-500/30' },
  1135: { key: 'lisk', label: 'Lisk', badge: 'LSK', bg: 'bg-indigo-600', ring: 'ring-indigo-500/30' },
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
      className={`rounded-full px-3 py-1 text-sm transition ${active ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        }`}
    >
      {children}
    </Link>
  )
}

/* ──────────────────────────────────────────────────────────────── */

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
  const [elevated, setElevated] = useState(false)

  const mobileRef = useRef<HTMLDivElement | null>(null)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMenuOpen(false)
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 6)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    // Lock body scroll when mobile sheet is open
    const body = document.body
    if (mobileOpen) {
      const prev = body.style.overflow
      body.style.overflow = 'hidden'
      return () => { body.style.overflow = prev }
    }
  }, [mobileOpen])

  useEffect(() => {
    // Close menus on outside click
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (accountMenuRef.current && !accountMenuRef.current.contains(t)) setMenuOpen(false)
      if (mobileRef.current && !mobileRef.current.contains(t) && mobileOpen) setMobileOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setMenuOpen(false); setMobileOpen(false) }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [mobileOpen])

  const currentChain = useMemo(() => (chainId ? CHAIN_META[chainId] : undefined), [chainId])

  async function copyAddress() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { }
  }

  async function quickSwitch(id: number) {
    try {
      await switchChainAsync?.({ chainId: id })
    } catch (e) {
      console.error('Switch chain failed:', e)
    }
  }

  return (
    <>
      {/* Top App Bar */}
      <header
        className={`sticky top-0 z-50 w-full border-b border-border/60 backdrop-blur-md supports-[backdrop-filter]:bg-white/55 dark:supports-[backdrop-filter]:bg-background/60 ${elevated ? 'shadow-[0_1px_0_0_rgba(0,0,0,0.02)]' : ''
          }`}
      >
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-3 sm:px-4">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="group inline-flex items-center gap-2 min-w-0">
              <Image
                src={socialImg}
                alt="SuperYield-R"
                width={160}
                height={28}
                priority
                className="h-7 w-auto"
              />
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
            {/* Mobile: hamburger */}
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 md:hidden active:scale-95"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              title="Menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-80"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
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
                <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M21 7H5a2 2 0 0 0-2 2v6a3 3 0 0 0 3 3h15V7Zm-4 6a2 2 0 1 1 0-4h2v4h-2Z" /><path fill="currentColor" d="M19 9h-2a4 4 0 0 0 0 8h2v-2h-2a2 2 0 1 1 0-4h2V9Z" /></svg>
                Connect
              </Button>
            ) : (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-sm font-semibold hover:bg-background active:scale-[.98]"
                  title="Wallet menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <div className="h-5 w-5 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                  <span className="max-w-[92px] truncate">{shortAddr(address)}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" className={`transition ${menuOpen ? 'rotate-180 opacity-80' : 'opacity-60'}`}><path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-xl focus:outline-none" role="menu">
                    {/* header */}
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-semibold" title={address}>{shortAddr(address)}</span>
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
                        <span className={`text-xs ${copied ? 'text-teal-600' : 'text-muted-foreground'}`}>{copied ? 'Copied' : '⌘C'}</span>
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
                                className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] ${active ? `${meta.bg} text-white` : 'bg-muted hover:bg-muted/80'
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
      </header>

      {/* Mobile Sheet (Slide-over) */}
      <div
        className={`md:hidden fixed inset-0 z-[60] ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        {/* overlay */}
        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileOpen(false)}
        />

        {/* panel */}
        <div
          ref={mobileRef}
          role="dialog"
          aria-modal="true"
          className={`absolute right-0 top-0 h-full w-[86%] max-w-sm bg-background shadow-2xl ring-1 ring-border/60 transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          <div className="flex h-14 items-center justify-between border-b px-3">
            <div className="inline-flex items-center gap-2">
              <Image
                src={socialImg}
                alt="SuperYield-R"
                width={140}
                height={24}
                className="h-6 w-auto"
                priority
              />
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 active:scale-95"
              aria-label="Close menu"
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-80"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>

          <div className="flex h-[calc(100%-56px)] flex-col justify-between">
            <div className="p-3">
              {/* wallet box */}
              <div className="rounded-2xl border p-3">
                {!address ? (
                  <>
                    <div className="mb-2 text-sm">You&rsquo;re not connected</div>
                    <Button
                      onClick={() => open({ view: 'Connect' })}
                      className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-500 hover:to-cyan-500" title={''}                    >
                      Connect Wallet
                    </Button>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Works with WalletConnect & injected wallets
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        <div className="text-sm font-semibold">{shortAddr(address)}</div>
                      </div>
                      <NetworkBadge chainId={chainId} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button variant="secondary" className="w-full" onClick={copyAddress} title={copied ? 'Copied' : 'Copy'}>
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                      <Button variant="secondary" className="w-full" onClick={() => open({ view: 'Connect' })} title={'Switch'}>
                        Switch
                      </Button>
                      <Button variant="destructive" className="col-span-2" onClick={() => { disconnect(); setMobileOpen(false) }} title={'Disconnect'}>
                        Disconnect
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* nav links */}
              <nav className="mt-3 grid gap-1">
                <ActiveLink href="/">Dashboard</ActiveLink>
                <ActiveLink href="/markets">Markets</ActiveLink>
                <ActiveLink href="/docs">Docs</ActiveLink>
              </nav>

              {/* quick network switch */}
              <div className="mt-4 rounded-2xl border p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">Networks</div>
                <div className="grid grid-cols-3 gap-2">
                  {[10, 8453, 1135].map((id) => {
                    const meta = CHAIN_META[id]
                    const active = chainId === id
                    return (
                      <button
                        key={id}
                        onClick={() => quickSwitch(id)}
                        disabled={isSwitching || active}
                        className={`h-9 rounded-xl text-[12px] font-semibold ring-1 ${active ? `${meta.bg} text-white ring-transparent` : 'bg-muted/60 hover:bg-muted ring-border/60'} disabled:opacity-60`}
                        title={meta.label}
                      >
                        {meta.badge}
                      </button>
                    )
                  })}
                </div>
                {isSwitching && <div className="mt-2 text-[11px] text-muted-foreground">Switching…</div>}
              </div>
            </div>

            {/* safe‑area bottom padding + tabbar */}
            <div className="pb-[max(12px,env(safe-area-inset-bottom))]">
              <MobileTabbar />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Tabbar (always visible on mobile, optional) */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40">
        <MobileTabbar />
      </div>
    </>
  )
}

/* ──────────────────────────────────────────────────────────────── */

function MobileTabbar() {
  const pathname = usePathname()
  const tabs = [
    {
      href: '/', label: 'Dashboard', icon: (
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" fill="currentColor" /></svg>
      )
    },
    {
      href: '/markets', label: 'Markets', icon: (
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 10h4v10h-4zM16 7h4v13h-4z" fill="currentColor" /></svg>
      )
    },
    {
      href: '/docs', label: 'Docs', icon: (
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm8 0v4h4" stroke="currentColor" strokeWidth="1.7" fill="none" /></svg>
      )
    },
  ]

  return (
    <nav className="mx-auto mb-1 w-full max-w-6xl px-2">
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/70">
        {tabs.map((t) => {
          const active = pathname === t.href || (t.href !== '/' && pathname.startsWith(t.href))
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-[11px] font-medium ${active ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="opacity-90">{t.icon}</span>
              <span className="leading-none">{t.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
