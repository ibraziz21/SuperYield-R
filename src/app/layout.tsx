// src/app/layout.tsx
import '@/app/globals.css'
import { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import  ContextProvider  from '@/config/appkit'
import AppShell from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  // runs on the server; cookies() is async in Next 13.4+
  const cookies = (await headers()).get('cookie')

  return (
    <html lang="en">
      <body className="bg-surface-light font-DM text-secondary-foreground antialiased">
        <ContextProvider cookies={cookies}>
          <AppShell>{children}</AppShell>
          <Toaster />
        </ContextProvider>
      </body>
    </html>
  )
}
