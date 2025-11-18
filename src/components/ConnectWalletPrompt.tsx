'use client'

import { useAppKit } from '@reown/appkit/react'
import { Button } from '@/components/ui/button'

export function ConnectWalletPrompt() {
  const { open } = useAppKit()

  return (
    <div className='flex justify-center items-center ecovaults-background min-h-[calc(100vh-3.5rem)] bg-contain bg-center bg-no-repeat px-4'>
      <div className='w-full max-w-6xl mx-auto'>
        <div className='h-[350px] flex flex-col justify-between p-2 lg:p-5'>
          <h2 className='text-3xl md:text-5xl lg:text-6xl font-semibold'>Your gateway to smarter on-chain yields</h2>
          <h4 className='text-[#4B5563] text-base md:text-lg'>Please connect your wallet to get started</h4>
          <div>
            <Button
              onClick={() => open({ view: 'Connect' })}
              className="flex bg-[#376FFF] p-4 py-6 rounded-lg text-base"
              title="Connect Wallet"
            >
              Connect Wallet
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
