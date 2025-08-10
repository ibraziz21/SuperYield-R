// src/components/AppShell.tsx
'use client'

import React from 'react'
import { Navbar } from '@/components/NavBar'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
    </>
  )
}
