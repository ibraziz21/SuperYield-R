// src/components/ProvidersWrapper.tsx
'use client'

import '@/lib/appkit' // ensure createAppKit runs in the browser
import { ReactNode } from 'react'
import { WagmiProvider, cookieToInitialState } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/config'
import { Navbar } from '@/components/NavBar'

const queryClient = new QueryClient()

interface Props {
  initialState?: string
  children: ReactNode
}

export function ProvidersWrapper({ initialState, children }: Props) {
  const wagmiState = cookieToInitialState(wagmiConfig, initialState)

  return (
    <WagmiProvider config={wagmiConfig} initialState={wagmiState}>
      <QueryClientProvider client={queryClient}>
        <Navbar />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
