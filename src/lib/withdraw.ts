import { WalletClient } from 'viem'
import { YieldSnapshot } from '@/hooks/useYields'
import { AAVE_POOL, COMET_POOLS } from '@/lib/constants'
import aaveAbi from './abi/aavePool.json'
import cometAbi from './abi/comet.json'
import { optimism, base } from 'viem/chains'


export async function withdrawFromPool(
    snap: YieldSnapshot,
    amount: bigint,
    wallet: WalletClient,
) {
    if (snap.protocol === 'Aave v3') {
        return wallet.writeContract({
            address: AAVE_POOL[snap.chain],
            abi: aaveAbi,
            functionName: 'withdraw',
            args: [
                snap.underlying, // token address
                amount,
                wallet.account!.address,
            ],
            chain:  snap.chain=='base'? base : optimism,
            account: wallet.account?.address as `0x${string}` 
        })
    }

    if (snap.protocol === 'Compound v3') {
        return wallet.writeContract({
            address: COMET_POOLS[snap.chain][snap.token],
            abi: cometAbi,
            functionName: 'withdraw',
            args: [wallet.account!.address, amount],
            chain:  snap.chain=='base'? base : optimism,
            account: wallet.account?.address as `0x${string}` 
        })
    }

    //   // Morpho Blue (4626 wrapper)
    //   if (snap.protocol === 'Morpho Blue') {
    //     return wallet.writeContract({
    //       address: MORPHO_LENS[snap.chain],
    //       abi: morphoAbi,
    //       functionName: 'redeem',
    //       args: [snap.marketId, amount, wallet.account.address, wallet.account.address],
    //     })
    //   }

    throw new Error('Unsupported protocol')
}
