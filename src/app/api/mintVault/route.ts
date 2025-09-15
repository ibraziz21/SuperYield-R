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
  const VAULT_ADDRESS   = '0xD56eE57eD7906b8558db9926578879091391Fbb7' as `0x${string}`       // SVaultToken
  const REWARDS_ADDRESS = '0xE31dD2cc22D99285168067b053bB67792e3f9E15' as `0x${string}`     // SVaultRewards
  
  export async function POST(req: Request) {
    const { userAddress, tokenAmt } = await req.json() as {
      userAddress: `0x${string}`,
      tokenAmt: string // bigint-as-decimal string
    }
  
    try {
      // 1) notify rewards before changing user balance
      const { request: hookReq } = await publicClient.simulateContract({
        address: REWARDS_ADDRESS,
        abi: rewardsAbi,
        functionName: 'notifyBalanceChange',
        args: [userAddress],
        account,
      })
      const hookTx = await client.writeContract(hookReq)
      await publicClient.waitForTransactionReceipt({ hash: hookTx })
  
      // 2) mint SVault shares to the user
      const { request } = await publicClient.simulateContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: 'mint',
        args: [userAddress, BigInt(tokenAmt)],
        account,
      })
      const txHash = await client.writeContract(request)
  
      return Response.json({ success: true, txHash })
    } catch (err: any) {
      console.error('Minting failed', err)
      return Response.json({ success: false, message: 'Error minting receipt token' }, { status: 500 })
    }
  }
  