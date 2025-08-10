import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

import * as dotenv from 'dotenv'
dotenv.config()

const { OP_RPC, BASE_RPC, LISK_RPC, DEPLOYER_KEY } = process.env
if (!DEPLOYER_KEY) throw new Error('Missing DEPLOYER_KEY in .env')

const config: HardhatUserConfig = {
  solidity: "0.8.28",

  networks: {
    optimism: { url: OP_RPC!,   accounts: [DEPLOYER_KEY] },
    base:     { url: BASE_RPC!, accounts: [DEPLOYER_KEY] },
    lisk:     { url: LISK_RPC!, accounts: [DEPLOYER_KEY] },
  },

  etherscan: {
    apiKey: '1SFG3G483B7YGWUVJ666WVBQ2T231XDBVV'
    ,
    customChains: [
      {
        network: "lisk",
        chainId: 1135,
        urls: {
          apiURL: "https://blockscout.lisk.com/api",
          browserURL: "https://blockscout.lisk.com",
        },
      },
    ]
    // '1SFG3G483B7YGWUVJ666WVBQ2T231XDBVV',
},
};

export default config;
