import { http } from 'viem'
import { cookieStorage, createStorage } from '@wagmi/core'
import { injected, walletConnect } from '@wagmi/connectors'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { optimism, base } from '@reown/appkit/networks'

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!
if (!projectId) throw new Error('REOWN project id missing')

export const networks = [optimism, base]

/**  WagmiAdapter builds the wagmi config for us  */
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,

  // viem transports (per-chain RPC URLs)
  transports: {
    [optimism.id]: http(),
    [base.id]:     http(),
  },

  // wallet connectors
  connectors: [
    injected(),                         // MetaMask / Brave / Rabby …
    walletConnect({ projectId }),       // WalletConnect v2
  ],

  // SSR cookie storage
  storage: createStorage({ storage: cookieStorage }),
})

/** Re-export the generated wagmi config */
export const wagmiConfig = wagmiAdapter.wagmiConfig
