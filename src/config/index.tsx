import { http } from 'viem'
import { cookieStorage, createStorage } from '@wagmi/core'
import { injected, walletConnect } from '@wagmi/connectors'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import {lisk} from 'viem/chains'
import { optimism, base } from '@reown/appkit/networks'

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!
if (!projectId) throw new Error('REOWN project id missing')

export const networks = [optimism, lisk]

/** WagmiAdapter builds the wagmi config for us */
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage
  }),
  ssr: true,
  projectId,
  networks,

  transports: {
    [optimism.id]: http("https://mainnet.optimism.io"),
    [lisk.id]:     http('https://rpc.api.lisk.com'),
  }

})

export const wagmiConfig = wagmiAdapter.wagmiConfig
