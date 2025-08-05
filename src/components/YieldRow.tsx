'use client'

import { FC, useState } from 'react'
import { TokenBadge } from './TokenBadge'
import { DepositModal } from './DepositModal'
import type { YieldSnapshot } from '@/hooks/useYields'
import { Button } from './ui/button'
import { useAppKitAccount, useAppKitProvider, useAppKit } from '@reown/appkit/react'
import { bridgeTokens } from '@/lib/bridge'
import { ethers } from 'ethers'
import { depositToPool } from '@/lib/depositor'
import { providerOptimism, providerBase } from '@/lib/rpc'

export const YieldRow: FC<{ snap: YieldSnapshot }> = ({ snap }) => {
    const { address } = useAppKitAccount()
    const { walletProvider } = useAppKitProvider('eip155')
    const { open } = useAppKit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState(false)

   function openModal() {
       if (!address) open()   // open Reown modal first
       else setShow(true)
     }

  return (
    <tr className="group border-b hover:bg-secondary/5">
      <td className="px-4 py-3">
        <TokenBadge symbol={snap.token} />
      </td>
      <td className="px-4 py-3 capitalize">{snap.chain}</td>
      <td className="px-4 py-3">{snap.protocol}</td>
      <td className="px-4 py-3 text-right font-semibold ">
        {snap.apy.toFixed(2)}%
      </td>
      <td className="px-4 py-3 text-right">
        ${snap.tvlUSD.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right">
        <Button
                  onClick={openModal}
                  className="px-3 py-1 text-xs text-black" title={busy ? 'Processing…' : 'Deposit'}        >
          {busy ? 'Bridging…' : 'Bridge'}
        </Button>
        
      </td>
      <DepositModal open={show} onClose={() => setShow(false)} snap={snap} />
    </tr>
  )
}
