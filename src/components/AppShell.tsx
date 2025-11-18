// src/components/AppShell.tsx
'use client'

import React from 'react'
import { Navbar } from '@/components/NavBar'
import { DisclaimerBanner } from '@/components/DisclaimerBanner'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DisclaimerBanner />
      <Navbar />
      <main className="min-h-[calc(100vh-3.5rem)] bg-[#F9FAFB]">{children}</main>
    </>
  )
}
