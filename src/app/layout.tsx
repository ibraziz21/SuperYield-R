// src/app/layout.tsx
import '@/app/globals.css'
import { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { ProvidersWrapper } from '@/components/ProvidersWrapper'

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  // runs on the server; cookies() is async in Next 13.4+
  const cookieStore = await cookies()
  const raw = cookieStore.get('wagmi.store')?.value
  const wagmiCookie = raw ? decodeURIComponent(raw) : undefined

  return (
    <html lang="en">
      <body className="bg-surface-light text-secondary-foreground antialiased">
        <ProvidersWrapper initialState={wagmiCookie}>
          {children}
        </ProvidersWrapper>
      </body>
    </html>
  )
}
