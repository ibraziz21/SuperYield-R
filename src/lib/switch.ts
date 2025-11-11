// src/lib/wallet/switchStrict.ts
import type { WalletClient } from 'viem'
import { CHAINS } from '@/lib/wallet' // your existing chain defs

// Reuse your CHAINS.lisk values to avoid hardcoding RPC/explorer here.
export async function switchOrAddChainStrict(
  walletClient: WalletClient,
  target = CHAINS.lisk // viem-style chain object you already have
) {
  const hex = `0x${target.id.toString(16)}`

  // Fast path: already there
  try {
    const currentHex = await walletClient.request({ method: 'eth_chainId' })
    if (currentHex?.toLowerCase() === hex.toLowerCase()) return
  } catch {}

  // Try switch first
  try {
    await walletClient.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    })
  } catch (e: any) {
    // 4902 = chain not added
    if (e?.code === 4902 || /unknown chain/i.test(e?.message ?? '')) {
      // Use your existing CHAINS.lisk shape
      await walletClient.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hex,
          chainName: target.name,
          nativeCurrency: target.nativeCurrency,
          rpcUrls: target.rpcUrls.default.http,
          blockExplorerUrls: target.blockExplorers ? [target.blockExplorers.default.url] : [],
        }],
      })
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hex }],
      })
    } else {
      throw e
    }
  }

  // Verify with a short poll (wallets sometimes resolve before UI updates)
  const end = Date.now() + 10_000
  while (true) {
    const idNow = await walletClient.request({ method: 'eth_chainId' })
    if (idNow?.toLowerCase() === hex.toLowerCase()) break
    if (Date.now() > end) throw new Error('Failed to switch to Lisk (timed out)')
    await new Promise(r => setTimeout(r, 350))
  }

  // Give wagmi/react a moment to refresh internal client state
  await new Promise(r => setTimeout(r, 150))
}
