'use client'

import { createAppKit } from '@reown/appkit/react'
import { optimism, base, lisk } from '@reown/appkit/networks'
import { wagmiAdapter, projectId } from '@/config'

// Set stable, HTTPS metadata. Do NOT leave blanks.
// NEXT_PUBLIC_APP_URL must be the exact origin and be whitelisted in WC Cloud → Allowed Origins
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')
const ICON_URL = process.env.NEXT_PUBLIC_ICON_URL || `${APP_URL}/icon-512.png`

if (!APP_URL || !APP_URL.startsWith('http')) {
  // Helpful console warning; won’t crash dev, but you should set it in prod
  console.warn('[AppKit] metadata.url is missing or not https. Set NEXT_PUBLIC_APP_URL.')
}

createAppKit({
  projectId,
  adapters: [wagmiAdapter],
  networks: [optimism, base, lisk],
  defaultNetwork: optimism,
  metadata: {
    name: 'SuperYield-R',
    description: 'Cross-chain yield aggregator',
    url: APP_URL,        // must be HTTPS and whitelisted
    icons: [ICON_URL],   // must be a reachable HTTPS icon
  },
  features: { analytics: true },
})
