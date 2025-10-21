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

    const post = await pub.readContract({
      address: token, abi: erc20Abi, functionName: 'allowance', args: [holder, vaultAddr],
    }) as bigint
    if (post < amount) throw new Error(`Allowance ${post} < ${amount} after approve`)
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

  return { depositTx }
}