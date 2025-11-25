// src/components/ClaimRewards/ClaimRewards.tsx
"use client";

import React, { useMemo, useState } from "react";
import ClaimRewardTable from ".";
import { ClaimableRewardColumns, type ClaimableReward } from "./columns";

import { useMerklRewards, type FlatReward } from "@/hooks/useMerklRewards";
import { useAppKit } from "@reown/appkit/react";
import { useWalletClient, useSwitchChain, useChainId } from "wagmi";
import { base, optimism, lisk } from "viem/chains";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { MERKL_DISTRIBUTOR, distributorAbi, buildClaimArgs } from "@/lib/merkl";
import { ClaimRewardsModal } from "@/components/claim-rewards-modal";
import { useUsdPrices } from "@/hooks/useUSDPrices";     // ⬅️ NEW

const CHAIN_LABEL: Record<number, string> = {
  [lisk.id]: "Lisk",
  [optimism.id]: "Optimism",
  [base.id]: "Base",
};

function formatNumber(n: number, maxFrac = 6) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
}

const ClaimRewards: React.FC = () => {
  const { rewards, isLoading, refetch } = useMerklRewards();
  const { open: openConnect } = useAppKit();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const activeChainId = useChainId();

  // ⬅️ Price helper
  const { priceUsdForSymbol } = useUsdPrices();

  // Track which row is claiming to disable its button
  const [claimingKey, setClaimingKey] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedReward, setSelectedReward] =
    useState<(ClaimableReward & { __raw?: FlatReward }) | null>(null);

  const tableData: (ClaimableReward & { __raw: FlatReward })[] = useMemo(() => {
    if (!rewards || rewards.length === 0) return [];

    return rewards.map((r) => {
      const qty = Number(formatUnits(BigInt(r.claimable), r.token.decimals)) || 0;

      return {
        network: CHAIN_LABEL[r.chainId] ?? `Chain ${r.chainId}`,
        source: "Merkl",
        claimable: qty.toString(), // plain numeric string
        token: r.token.symbol,
        __raw: r,
      };
    });
  }, [rewards]);

  function onClaimClick(row: ClaimableReward & { __raw?: FlatReward }) {
    if (!wallet) return openConnect?.();
    setSelectedReward(row);
    setShowModal(true);
  }

  async function handleModalClaim() {
    if (!wallet || !selectedReward) return;

    const item = selectedReward.__raw!;
    const chainId = item.chainId;

    try {
      const key = `${chainId}-${item.token.address.toLowerCase()}`;
      setClaimingKey(key);

      const distributor = MERKL_DISTRIBUTOR[chainId];
      if (!distributor) throw new Error(`Missing Merkl Distributor for chain ${chainId}`);

      if (activeChainId !== chainId && switchChainAsync) {
        await switchChainAsync({ chainId });
      }

      const { users, tokens, amounts, proofs } = buildClaimArgs({
        user: wallet.account!.address as Address,
        items: [item],
      });

      await wallet.writeContract({
        address: distributor,
        abi: distributorAbi,
        functionName: "claim",
        args: [users, tokens, amounts, proofs],
        account: wallet.account!.address as Address,
      });

      await refetch();
    } catch (err) {
      console.error("[ClaimRewards] claim error:", err);
      throw err;
    } finally {
      setClaimingKey(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading claimable rewards…
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            title="Refresh"
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <ClaimRewardTable
          columns={ClaimableRewardColumns}
          data={tableData as ClaimableReward[]}
          meta={{
            onClaim: onClaimClick,
            priceUsdForSymbol, // ⬅️ NEW for cells
            isClaiming: (r: any) => {
              const raw = (r as any).__raw as FlatReward | undefined;
              if (!raw) return false;
              return claimingKey === `${raw.chainId}-${raw.token.address.toLowerCase()}`;
            },
          }}
          emptyMessage="No rewards to claim yet."
          emptySubMessage="Keep your vaults active to start earning."
        />
      </div>

      {/* Claim Rewards Modal */}
      {selectedReward && (
        <ClaimRewardsModal
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setSelectedReward(null);
          }}
          onClaim={async () => {
            await handleModalClaim();
          }}
          rewards={[
            {
              token: selectedReward.token,
              symbol: `${selectedReward.claimable} ${selectedReward.token}`,
              amount: parseFloat(selectedReward.claimable),
              usdValue:
                parseFloat(selectedReward.claimable) *
                priceUsdForSymbol(selectedReward.token), // ⬅️ REAL PRICE
              icon: `/tokens/${selectedReward.token.toLowerCase()}-icon.png`,
              color: "bg-blue-100 dark:bg-blue-900/30",
              checked: true,
            },
          ]}
        />
      )}
    </>
  );
};

export default ClaimRewards;
