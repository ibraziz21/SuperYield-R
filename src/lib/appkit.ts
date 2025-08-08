import { createAppKit } from '@reown/appkit/react'
import { optimism, base } from '@reown/appkit/networks'
import { wagmiAdapter, projectId } from '@/config'

/* ONE global instance – no Provider property */
createAppKit({
  projectId,
  adapters: [wagmiAdapter],   // WalletConnect + injected
  networks: [optimism, base],
  defaultNetwork: optimism,
  metadata: {
    name: 'SuperYield-R',
    description: 'Cross-chain yield aggregator',
    url: typeof window !== 'undefined' ? window.location.origin : '',
    icons: ['']
  },
  features: { analytics: true },
})
