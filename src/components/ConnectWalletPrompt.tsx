'use client'

import { useAppKit } from '@reown/appkit/react'
import { Button } from '@/components/ui/button'

export function ConnectWalletPrompt() {
  const { open } = useAppKit()

  return (
    <div className='flex justify-between items-center ecovaults-background h-screen bg-contain bg-center bg-no-repeat'>
      <div className='h-[250px] flex flex-col justify-between p-2 lg:p-5 max-w-6xl'>
        <h2 className='text-3xl md:text-5xl'>Your gateway to smarter on-chain yields</h2>
        <h4 className='text-[#4B5563]'>Please connect your wallet to get started</h4>
        <div>
          <Button
            onClick={() => open({ view: 'Connect' })}
            className="flex bg-[#376FFF] p-5 rounded-lg"
            title="Connect Wallet"
          >
            Connect Wallet
          </Button>
        </div>
      </div>
    </div>
  )
}