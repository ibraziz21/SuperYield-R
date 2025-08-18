// src/components/positions/YieldRow.tsx
'use client'

import { FC, useState } from 'react'
import type { YieldSnapshot } from '@/hooks/useYields'
import { useAppKitAccount, useAppKit } from '@reown/appkit/react'
import { Button } from '@/components/ui/button'
import { TokenBadge } from '@/components/TokenBadge'
import { DepositModal } from '@/components/deposit/DepositModal'

export const YieldRow: FC<{ snap: YieldSnapshot }> = ({ snap }) => {
  const { address } = useAppKitAccount()
  const { open } = useAppKit()
  const [show, setShow] = useState(false)

  function openModal() {
    if (!address) open()   // Reown connect first
    else setShow(true)
  }

  return (
    <>
      <tr className="group border-b hover:bg-secondary/5">
        <td className="px-4 py-3">
          <TokenBadge symbol={snap.token} />
        </td>
        <td className="px-4 py-3 capitalize">{snap.chain}</td>
        <td className="px-4 py-3">{snap.protocol}</td>
        <td className="px-4 py-3 text-right font-semibold">{snap.apy.toFixed(2)}%</td>
        <td className="px-4 py-3 text-right">${snap.tvlUSD.toLocaleString()}</td>
        <td className="px-4 py-3 text-right">
          <Button onClick={openModal} className="h-8 px-3 text-xs" title={'Deposit'}>Deposit</Button>
        </td>
      </tr>

      <DepositModal open={show} onClose={() => setShow(false)} snap={snap} />
    </>
  )
}
