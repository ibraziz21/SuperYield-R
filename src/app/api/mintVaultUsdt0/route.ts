// app/api/mintVaultUsdt0/route.ts
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lisk, optimism } from 'viem/chains'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS } from '@/lib/constants'
import * as dotenv from 'dotenv'
dotenv.config()

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || ''
const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)

// Lisk chain client for transfers/deposits
const liskClient = createWalletClient({ account, chain: lisk, transport: http() })
const liskPublic = createPublicClient({ chain: lisk, transport: http() })

// Optimism client still needed if your receipt token lives there
const opPublic = createPublicClient({ chain: optimism, transport: http() })
const opClient = createWalletClient({ account, chain: optimism, transport: http() })

// ENV / constants (left as you defined them)
const USDT0         = TokenAddresses.USDT0.lisk as `0x${string}`     // USDT0 on Lisk
const MORPHO_POOL   = MORPHO_POOLS['usdt0-supply'] as `0x${string}`  // Morpho Blue pool
const REWARDS_VAULT = '0x1aDBe89F2887a79C64725128fd1D53b10FD6b441' as `0x${string}`

// Minimal ABIs
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) external returns (bool)',
])
// Morpho Blue core uses supply(asset, onBehalf, amount, data)
const MORPHO_POOL_ABI = parseAbi([
  'function supply(address asset, address onBehalf, uint256 amount, bytes data) external',
])

export async function POST(req: Request) {
  const { userAddress, tokenAmt } = await req.json() as {
    userAddress: `0x${string}`
    tokenAmt: string
  }

  try {
    const amount = BigInt(tokenAmt)

    // --- Approvals for USDT-like tokens: approve(0) then approve(amount)
    {
      const { request: approveZeroReq } = await liskPublic.simulateContract({
        address: USDT0,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [MORPHO_POOL, 0n],
        account,
      })
      await liskClient.writeContract(approveZeroReq)

      const { request: approveReq } = await liskPublic.simulateContract({
        address: USDT0,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [MORPHO_POOL, amount],
        account,
      })
      await liskClient.writeContract(approveReq)
    }

    // --- Direct deposit into Morpho pool
    const { request: supplyReq } = await liskPublic.simulateContract({
      address: MORPHO_POOL,
      abi: MORPHO_POOL_ABI,
      functionName: 'supply',
      args: [USDT0 as `0x${string}`, SAFEVAULT as `0x${string}`, amount, '0x'],
      account,
    })
    const depositTx = await liskClient.writeContract(supplyReq)
    await liskPublic.waitForTransactionReceipt({ hash: depositTx })

    // --- Mint receipt token via rewards vault (on Optimism)
    const { request: recordReq } = await opPublic.simulateContract({
      address: REWARDS_VAULT,
      abi: rewardsAbi,
      functionName: 'recordDeposit',
      args: [userAddress, amount],
      account,
    })
    const mintTx = await opClient.writeContract(recordReq)
    await opPublic.waitForTransactionReceipt({ hash: mintTx })

    return Response.json({ success: true, depositTx, mintTx })
  } catch (err: any) {
    console.error('mintVaultUsdt0 failed', err)
    return Response.json({ success: false, message: err?.message ?? 'Failed' }, { status: 500 })
  }
}
