import { ethers } from 'ethers'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from './constants'

// lib/depositor.ts
const aaveAbi = [
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
]

const cTokenAbi = [
  'function mint(uint256 mintAmount) returns (uint256)',
]

const erc20Abi = [
  'function approve(address spender,uint256 amount) returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
]


export async function depositToPool(
  snap: YieldSnapshot,
  amount: ethers.BigNumber,
  signer: ethers.Signer,
) {
  const user = await signer.getAddress()

  switch (snap.protocolKey) {
    case 'aave-v3': {
      const pool = new ethers.Contract(snap.poolAddress, aaveAbi, signer)

      const tokenAddr = TokenAddresses[snap.token][snap.chain]
      await ensureAllowance(tokenAddr, snap.poolAddress, amount, signer)

      await (await pool.supply(tokenAddr, amount, user, 0)).wait()
      break
    }

    case 'compound-v3': {
      const cToken = new ethers.Contract(snap.poolAddress, cTokenAbi, signer)
      await ensureAllowance(
        TokenAddresses[snap.token][snap.chain],
        snap.poolAddress,
        amount,
        signer,
      )
      await (await cToken.mint(amount)).wait()
      break
    }

    case 'sonne-finance':
    case 'moonwell-lending': {
      // both are Compound-forks (CToken mint)
      const cToken = new ethers.Contract(snap.poolAddress, cTokenAbi, signer)
      await ensureAllowance(
        TokenAddresses[snap.token][snap.chain],
        snap.poolAddress,
        amount,
        signer,
      )
      await (await cToken.mint(amount)).wait()
      break
    }

    default:
      throw new Error(`Unsupported protocol ${snap.protocolKey}`)
  }
}

async function ensureAllowance(
  token: string,
  spender: string,
  amt: ethers.BigNumber,
  signer: ethers.Signer,
) {
  const erc20   = new ethers.Contract(token, erc20Abi, signer)
  const user    = await signer.getAddress()
  const current = await erc20.allowance(user, spender)
  if (current.gte(amt)) return
  await (await erc20.approve(spender, amt)).wait()
}
