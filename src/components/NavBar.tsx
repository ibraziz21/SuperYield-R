import { Button } from '@/components/ui/button'
import { useAppKit } from '@reown/appkit/react'
import { useAppKitAccount } from '@reown/appkit/react'
import Link from 'next/link'

export const Navbar = () => {
    const { open } = useAppKit()
    const { address } = useAppKitAccount()
    return (
  <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
    <h1 className="text-3xl font-extrabold tracking-tight text-secondary-foreground">
      <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
        SuperYield‑R
      </span>
    </h1>
    <nav className="flex items-center gap-4 text-sm font-medium">
      <Link href="#" className="opacity-80 hover:opacity-100">
        Dashboard
      </Link>
      <Link href="#" className="opacity-80 hover:opacity-100">
        Docs
      </Link>
      {address ? (
        <span className="truncate text-xs">{address.slice(0, 6)}…{address.slice(-4)}</span>
      ) : (
        <Button onClick={open} className="px-4 py-2 text-xs" title={'Connect wallet'}>
          Connect Wallet
        </Button>
      )}
    </nav>
  </header>
    
)
}