import { http } from 'viem'
import { cookieStorage, createStorage } from '@wagmi/core'
import { injected, walletConnect } from '@wagmi/connectors'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import {lisk} from 'viem/chains'
import { optimism, base } from '@reown/appkit/networks'

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!
if (!projectId) throw new Error('REOWN project id missing')

export const networks = [optimism, base, lisk]

// Prefer explicit HTTPS RPCs (public or your own)
// You can swap these for your provider URLs
const rpc = {
  [optimism.id]: optimism.rpcUrls.default.http[0],
  [base.id]:     base.rpcUrls.default.http[0],
  [lisk.id]:     lisk.rpcUrls.default.http[0],
}

/** WagmiAdapter builds the wagmi config for us */
export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,

  transports: {
    [optimism.id]: http(rpc[optimism.id]),
    [base.id]:     http(rpc[base.id]),
    [lisk.id]:     http(rpc[lisk.id]),
  },

  connectors: [
    injected(),
    walletConnect({ projectId }),
  ],

  storage: createStorage({ storage: cookieStorage }),
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
