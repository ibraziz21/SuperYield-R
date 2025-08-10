// src/lib/constants.ts
import { keccak256, toBytes } from 'viem'

export type AdapterKey = `0x${string}`

function makeKey(s: string): AdapterKey {
  return keccak256(toBytes(s)) as AdapterKey
}

/** Must match the keys hardcoded/derived in your contracts */
export const ADAPTER_KEYS = {
  // AAVE
  aaveOptimism:  makeKey('aave-v3:optimism'),
  aaveBase:      makeKey('aave-v3:base'),

  // COMPOUND V3 (Comet)
  cometOpUSDC:   makeKey('compound-v3:optimism:USDC'),
  cometOpUSDT:   makeKey('compound-v3:optimism:USDT'),
  cometBaseUSDC: makeKey('compound-v3:base:USDC'),
  // NOTE: base:USDT not supported (pool = 0x0)

  // MORPHO BLUE (Lisk)
  morphoLiskUSDCe: makeKey('morpho-blue:lisk:USDCe'),
  morphoLiskUSDT0: makeKey('morpho-blue:lisk:USDT0'),
  morphoLiskWETH:  makeKey('morpho-blue:lisk:WETH'),
} as const

export type AdapterKeyName = keyof typeof ADAPTER_KEYS

/** Your deployed routers */
export const ROUTERS: Record<'optimism'| 'lisk', `0x${string}`> = {
  optimism: '0x74298D4c82f06797029b90ca7e50B1AEB9edB501',
  lisk:     '0x5133C942c1b7962D62a3851Fe01876D750d02AA7',
} as const

/** 3-chain token map */
export const TokenAddresses = {
  USDC: {
    optimism: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',

  },
  USDT: {
    optimism: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
  
  },

  USDCe: {
    lisk: '0xf242275d3a6527d877f2c927a82d9b057609cc71',
  },
  USDT0: {
    lisk: '0x43f2376d5d03553ae72f4a8093bbe9de4336eb08',
  },
  WETH: {
    lisk: '0x4200000000000000000000000000000000000006',
  },
} as const

export const AAVE_POOL: Record<'optimism', `0x${string}`> = {
  optimism: '0x794a61358d6845594f94dc1db02a252b5b4814ad',

}

export const COMET_POOLS = {
  optimism: {
    USDC: '0x2e44e174f7d53f0212823acc11c01a11d58c5bcb',
    USDT: '0x995e394b8b2437ac8ce61ee0bc610d617962b214',
  },
 
} as const satisfies Record<'optimism', Record<'USDC' | 'USDT', `0x${string}`>>

export const MORPHO_POOLS = {
  'usdce-supply': '0xd92f564a29992251297980187a6b74faa3d50699',
  'usdt0-supply': '0x50cb55be8cf05480a844642cb979820c847782ae',
  'weth-supply':  '0x7cbaa98bd5e171a658fdf761ed1db33806a0d346',
} as const

export type ChainId = 'optimism' | 'lisk'
export type TokenSymbol = 'USDC' | 'USDT' | 'USDCe' | 'USDT0' | 'WETH'
