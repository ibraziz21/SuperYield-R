'use client'

import '@/app/globals.css'
import { ReactNode } from 'react'
import { WagmiProvider, cookieToInitialState } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { wagmiConfig } from '@/config'
import '@/lib/appkit'            // initializes Reown modal once
import { Navbar } from '@/components/NavBar'

const queryClient = new QueryClient()

export default function RootLayout({
  children,
  cookies,
}: {
  children: ReactNode
  cookies: string | null
}) {
  const initialState = cookieToInitialState(wagmiConfig, cookies)

  return (
    <html lang="en">
      <body className="bg-surface-light text-secondary-foreground antialiased">
        <WagmiProvider config={wagmiConfig} initialState={initialState}>
          <QueryClientProvider client={queryClient}>
            <Navbar/>
            {children}
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  )
}
