/** 3-chain token map */
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
  // NOTE: base:USDT is not supported in your constants (pool is 0x0)

  // MORPHO BLUE (Lisk uses USDCe / USDT0 / WETH)
  morphoLiskUSDCe: makeKey('morpho-blue:lisk:USDCe'),
  morphoLiskUSDT0: makeKey('morpho-blue:lisk:USDT0'),
  morphoLiskWETH:  makeKey('morpho-blue:lisk:WETH'),
} as const

export type AdapterKeyName = keyof typeof ADAPTER_KEYS

export const ROUTERS: Record<'optimism' | 'base' | 'lisk', `0x${string}`> = {
  optimism: '0x74298D4c82f06797029b90ca7e50B1AEB9edB501',
  base:     '0x7AE3e0e585b1663Dc876e8b36B47494166d38F2F',
  lisk:     '0x5133C942c1b7962D62a3851Fe01876D750d02AA7',
} as const

export const TokenAddresses = {
  USDC: {
    optimism: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    base:     '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  },
  USDT: {
    optimism: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
    base:     '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
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

export const AAVE_POOL: Record<'optimism' | 'base', `0x${string}`> = {
  optimism: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
  base:     '0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
}

export const COMET_POOLS = {
  optimism: {
    USDC: '0x2e44e174f7d53f0212823acc11c01a11d58c5bcb',
    USDT: '0x995e394b8b2437ac8ce61ee0bc610d617962b214',
  },
  base: {
    USDC: '0xb125e6687d4313864e53df431d5425969c15eb2f',
    USDT: '0x0000000000000000000000000000000000000000', // not yet
  },
} as const satisfies Record<'optimism' | 'base',
  Record<'USDC' | 'USDT', `0x${string}`>>

export const MORPHO_POOLS = {
  'usdce-supply': '0xd92f564a29992251297980187a6b74faa3d50699',
  'usdt0-supply': '0x50cb55be8cf05480a844642cb979820c847782ae',
  'weth-supply':  '0x7cbaa98bd5e171a658fdf761ed1db33806a0d346',
} as const

export type ChainId = 'optimism' | 'base' | 'lisk'
export type TokenSymbol =
  | 'USDC' | 'USDT'
  | 'USDCe' | 'USDT0' | 'WETH'

