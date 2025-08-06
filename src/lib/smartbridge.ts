import { getDualBalances } from './balances'
import { TokenAddresses } from './constants'
import { bridgeTokens } from './bridge'
import { WalletClient } from 'viem'

export async function ensureLiquidity(
  symbol: keyof typeof TokenAddresses,
  amount: bigint,
  target: 'optimism' | 'base',
  wallet: WalletClient,
) {
  /* 1 — definite user address */
  const user = wallet.account?.address as `0x${string}`

  /* 2 — read both balances */
  const { opBal, baBal } = await getDualBalances(TokenAddresses[symbol], user)

  /* 3 — decide if bridging is needed */
  const have = target === 'optimism' ? opBal : baBal
  if (have >= amount) return

  const missing = amount - have           // bigint − bigint ➜ bigint

  /* 4 — bridge the shortfall */
  const from = target === 'optimism' ? 'base' : 'optimism'
  await bridgeTokens(symbol, missing, from, target, wallet)
}
