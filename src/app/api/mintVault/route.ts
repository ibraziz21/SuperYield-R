// app/api/mintVault/route.ts
import {
    createPublicClient,
    createWalletClient,
    http,
  } from 'viem'
  import { privateKeyToAccount } from 'viem/accounts'
  import { optimism } from 'viem/chains'
  import vaultAbi from '@/lib/abi/vaultToken.json'
  import rewardsAbi from '@/lib/abi/rewardsAbi.json' // add this
  
  import * as dotenv from 'dotenv'
  dotenv.config()
  
  const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || ''
  console.log('private Key: ', PRIVATE_KEY)
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
  const chain = optimism
  
  const publicClient = createPublicClient({ chain, transport: http() })
  const client = createWalletClient({ account, chain, transport: http() })
  
  // ENV these:
const RECEIPT_TOKEN   = '0x65a8a2804aEF839605Cbc1a604defF3dcD778df2' as `0x${string}` // if you still need to read decimals
const REWARDS_VAULT   = '0xBe16ec32b28C8fef884034ed457592206a18d7ea' as `0x${string}`
  
  export async function POST(req: Request) {
    const { userAddress, tokenAmt } = await req.json() as {
      userAddress: `0x${string}`,
      tokenAmt: string // bigint-as-decimal string
    }
  
    try {
      // 1) notify rewards before changing user balance
      const { request } = await publicClient.simulateContract({
        address: REWARDS_VAULT,
        abi: rewardsAbi,
        functionName: 'recordDeposit',
        args: [userAddress, BigInt(tokenAmt)],
        account,
      })
      const txHash = await client.writeContract(request)
      await publicClient.waitForTransactionReceipt({ hash: txHash })


    return Response.json({ success: true, txHash })
    } catch (err: any) {
      console.error('Minting failed', err)
      return Response.json({ success: false, message: 'Error minting receipt token' }, { status: 500 })
    }
  }
  