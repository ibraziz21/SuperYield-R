// app/api/mintVaultUsdt0/route.ts
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lisk, optimism } from 'viem/chains'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import morphoAbi from '@/lib/abi/morphoLisk.json'
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS } from '@/lib/constants'
import * as dotenv from 'dotenv'
dotenv.config()

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || ''
if (!PRIVATE_KEY) throw new Error('RELAYER_PRIVATE_KEY missing')
const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)

// Lisk clients (USDT0 lives on Lisk)
const liskClient = createWalletClient({ account, chain: lisk, transport: http() })
const liskPublic = createPublicClient({ chain: lisk, transport: http() })

// Optimism clients (receipt token bookkeeping lives on OP)
const opPublic = createPublicClient({ chain: optimism, transport: http() })
const opClient = createWalletClient({ account, chain: optimism, transport: http() })

// Addresses
const USDT0         = TokenAddresses.USDT0.lisk as `0x${string}`
const MORPHO_POOL   = MORPHO_POOLS['usdt0-supply'] as `0x${string}`
const REWARDS_VAULT = '0x1aDBe89F2887a79C64725128fd1D53b10FD6b441' as `0x${string}`

// ABIs
const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 value) external returns (bool)',
])


/* helpers */
async function readRelayerBal(): Promise<bigint> {
  return (await liskPublic.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint
}

async function readAllowance(spender: `0x${string}`): Promise<bigint> {
  return (await liskPublic.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  })) as bigint
}

export async function POST(req: Request) {
  const { userAddress, tokenAmt, expectedMin, timeoutMs, pollMs } = (await req
    .json()
    .catch(() => ({}))) as {
    userAddress?: `0x${string}`
    tokenAmt?: string            // exact bridged amount (skip waiting if provided)
    expectedMin?: string         // optional: min amount expected to arrive (bridged)
    timeoutMs?: number           // optional: default 15 minutes
    pollMs?: number              // optional: default 10s
  }

  if (!userAddress) {
    return Response.json({ success: false, message: 'userAddress required' }, { status: 400 })
  }

  try {
    /* 1) Determine amount to deposit */
    let amount: bigint
    if (tokenAmt) {
      amount = BigInt(tokenAmt)
    } else {
      const start = await readRelayerBal()
      const want  = expectedMin ? BigInt(expectedMin) : 0n
      const endAt = Date.now() + (timeoutMs ?? 15 * 60 * 1000)
      const every = pollMs ?? 10_000

      let curr = await readRelayerBal()
      while (true) {
        const delta = curr - start
        if (expectedMin ? (delta >= want || curr >= want) : (delta > 0n)) break
        if (Date.now() > endAt) throw new Error('Timeout waiting for bridged funds')
        await new Promise((r) => setTimeout(r, every))
        curr = await readRelayerBal()
      }
      const delta = curr - start
      amount = delta > 0n ? delta : curr
    }

    if (amount <= 0n) throw new Error('No tokens available to deposit')

    /* 2) Approvals for USDT-like tokens (no explicit nonce; wait between txs) */
    const allowance = await readAllowance(MORPHO_POOL)
    if (allowance < amount) {
      // If non-zero allowance, reset to 0 first (USDT-style)
      if (allowance > 0n) {
        const { request } = await liskPublic.simulateContract({
          address: USDT0,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [MORPHO_POOL, 0n],
          account,
        })
        const tx = await liskClient.writeContract(request)
        await liskPublic.waitForTransactionReceipt({ hash: tx })
      }

      // Set exact allowance
      {
        const { request } = await liskPublic.simulateContract({
          address: USDT0,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [MORPHO_POOL, amount],
          account,
        })
        const tx = await liskClient.writeContract(request)
        await liskPublic.waitForTransactionReceipt({ hash: tx })
      }
    }

    /* 3) Supply to Morpho pool (onBehalfOf = SAFE) */
    const { request: supplyReq } = await liskPublic.simulateContract({
      address: MORPHO_POOL,
      abi: morphoAbi,
      functionName: 'deposit',
      args: [amount, SAFEVAULT as `0x${string}`, ],
      account,
    })
    const depositTx = await liskClient.writeContract(supplyReq)
    await liskPublic.waitForTransactionReceipt({ hash: depositTx })

    /* 4) Record/mint on Optimism */
    const { request: recordReq } = await opPublic.simulateContract({
      address: REWARDS_VAULT,
      abi: rewardsAbi,
      functionName: 'recordDeposit',
      args: [userAddress, amount],
      account,
    })
    const mintTx = await opClient.writeContract(recordReq)
    await opPublic.waitForTransactionReceipt({ hash: mintTx })

    return Response.json({ success: true, depositTx, mintTx, amount: amount.toString() })
  } catch (err: any) {
    console.error('mintVaultUsdt0 failed', err)
    return Response.json({ success: false, message: err?.message ?? 'Failed' }, { status: 500 })
  }
}
