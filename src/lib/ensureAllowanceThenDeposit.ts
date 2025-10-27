// src/lib/ensureAllowanceThenDeposit.ts
import { erc20Abi, type PublicClient, type Address, encodeFunctionData } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import type { Chain, Hex } from 'viem'
import { sendSimulated } from './tx'

export async function ensureAllowanceThenDeposit(params: {
  pub: PublicClient
  account: PrivateKeyAccount          // from privateKeyToAccount(RELAYER_PRIVATE_KEY)
  chain: Chain                        // lisk
  token: Address                      // USDT0 on Lisk
  vaultAddr: Address                  // Morpho ERC4626 vault (also the spender/puller)
  receiver: Address                   // SAFE
  amount: bigint                      // 6d
  morphoAbi: any                      // must include deposit(uint256,address)
  log?: (msg: string, extra?: any) => void
}) {
  const {
    pub, account, chain,
    token, vaultAddr, receiver, amount, morphoAbi,
    log = () => {},
  } = params
  const holder = account.address

  // 0) balance & allowance
  const [bal, allowance] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }) as Promise<bigint>,
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [holder, vaultAddr] }) as Promise<bigint>,
  ])
  log('[ensureAllowanceThenDeposit] pre', { holder, bal: bal.toString(), allowance: allowance.toString(), need: amount.toString() })
  if (bal < amount) throw new Error(`Relayer balance ${bal} < amount ${amount}`)

  // 1) USDT-style approve(0) then approve(N) if needed
  if (allowance < amount) {
    if (allowance > 0n) {
      const { request } = await pub.simulateContract({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [vaultAddr, 0n],
        account: holder,
      })
      const tx0 = await sendSimulated(pub, account, chain, {
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [vaultAddr, 0n] }),
      })
      log('[ensureAllowanceThenDeposit] approve(0)', { tx0 })
      await pub.waitForTransactionReceipt({ hash: tx0 })
    }

    const { request } = await pub.simulateContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [vaultAddr, amount],
      account: holder,
    })
    const tx1 = await sendSimulated(pub, account, chain, {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [vaultAddr, amount] }),
    })
    log('[ensureAllowanceThenDeposit] approve(N)', { tx1, amount: amount.toString() })

    // ✅ wait for receipt first
    await pub.waitForTransactionReceipt({ hash: tx1 })

    // ✅ NEW: wait for allowance to reflect (RPC lag fix)
    let post = 0n
    for (let i = 0; i < 5; i++) {
      post = (await pub.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [holder, vaultAddr],
      })) as bigint

      if (post >= amount) break
      log(`[ensureAllowanceThenDeposit] waiting allowance update… (${i + 1}/5)`, { allowance: post.toString() })
      await new Promise((r) => setTimeout(r, 2000))
    }

    if (post < amount) {
      log(`[ensureAllowanceThenDeposit] warning: allowance ${post} < ${amount} after approve (likely RPC lag)`)
      // Don’t throw — continue to deposit safely
    }
  }

  // 2) deposit(uint256 assets, address receiver)
  const { request: depReq } = await pub.simulateContract({
    address: vaultAddr,
    abi: morphoAbi,
    functionName: 'deposit',
    args: [amount, receiver],
    account: holder,
  })
  const depositTx = await sendSimulated(pub, account, chain, {
    to: vaultAddr,
    data: encodeFunctionData({ abi: morphoAbi, functionName: 'deposit', args: [amount, receiver] }),
  })
  log('[ensureAllowanceThenDeposit] deposit()', { depositTx })
  await pub.waitForTransactionReceipt({ hash: depositTx })

  return { depositTx }
}