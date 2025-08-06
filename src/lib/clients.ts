// lib/clients.ts
import { http, createPublicClient, createWalletClient } from 'viem'
import { optimism, base } from 'viem/chains'

export const publicOptimism = createPublicClient({
  chain: optimism,
  transport: http(),          // or Alchemy / Infura URL
})

export const publicBase = createPublicClient({
  chain: base,
  transport: http(),
})

/* the signer (wallet client) comes from wagmi’s useWalletClient() */
