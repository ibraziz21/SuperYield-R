// src/components/ClaimRewards/columns.ts
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import Image from "next/image";
import { DataTableColumnHeader } from "../data-table-header";
import { Button } from "@/components/ui/button";

export type ClaimableReward = {
  network: string;
  source: string;
  claimable: string; // numeric string (no token suffix)
  token: string;
  // runtime-only: __raw is attached in the container component
  // __raw?: FlatReward
};

const networkIcons: Record<string, string> = {
  Ethereum: "/networks/ethereum.svg",
  Lisk: "/networks/lisk.svg",
  Arbitrum: "/networks/arbitrum.svg",
  Optimism: "/networks/optimism.svg",
  Base: "/networks/base.svg",
};

const sourceIcons: Record<string, string> = {
  "Aave V3": "/protocols/aave.svg",
  "Morpho Blue": "/protocols/morpho.svg",
  Compound: "/protocols/compound.svg",
  GMX: "/protocols/gmx.svg",
  Merkl: "/protocols/merkl.svg",
};

const tokenIcons: Record<string, string> = {
  AAVE: "/tokens/aave.svg",
  USDC: "/tokens/usdc.svg",
  ETH: "/tokens/eth.svg",
  WETH: "/tokens/weth.svg",
  GMX: "/tokens/gmx.svg",
  USDT: "/tokens/usdt.svg",
  LSK: "/tokens/lsk.svg",
};

const tokenPrices: Record<string, number> = {
  AAVE: 85.5,
  USDC: 1.0,
  ETH: 2400.0,
  WETH: 2400.0,
  GMX: 45.2,
  USDT: 1.0,
  LSK: 0, // price optional; show $0.00 if unknown
};

export const ClaimableRewardColumns: ColumnDef<ClaimableReward>[] = [
  {
    accessorKey: "network",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Network" />,
    cell: ({ row }) => {
      const network = row.getValue("network") as string;
      const iconPath = networkIcons[network] || "/networks/default.svg";
      return (
        <div className="flex items-center justify-center gap-2">
          <div className="relative h-6 w-6">
            <Image
              src={iconPath}
              alt={network}
              width={24}
              height={24}
              className="rounded-xl"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
          <span className="font-medium">{network}</span>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "source",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
    cell: ({ row }) => {
      const source = row.getValue("source") as string;
      const iconPath = sourceIcons[source] || "/protocols/default.svg";
      return (
        <div className="flex items-center justify-center gap-2">
          <div className="relative h-6 w-6">
            <Image
              src={iconPath}
              alt={source}
              width={24}
              height={24}
              className="rounded-xl"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
          <span className="font-medium">{source}</span>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "claimable",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Claimable" />,
    cell: ({ row }) => {
      const claimable = Number(row.getValue("claimable") as string) || 0;
      const token = row.getValue("token") as string;
      const price = tokenPrices[token] ?? 0;
      const usdValue = claimable * price;

      return (
        <div className="text-center">
          <div className="font-medium">
            {claimable.toLocaleString(undefined, { maximumFractionDigits: 6 })} {token}
          </div>
          <div className="text-xs text-muted-foreground">
            ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "token",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Token" />,
    cell: ({ row }) => {
      const token = row.getValue("token") as string;
      const iconPath = tokenIcons[token] || "/tokens/default.svg";
      return (
        <div className="flex items-center justify-center gap-2">
          <div className="relative h-6 w-6">
            <Image
              src={iconPath}
              alt={token}
              width={24}
              height={24}
              className="rounded-full"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
          <span className="font-medium">{token}</span>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row, table }) => {
      const meta: any = table.options.meta ?? {};
      const onClaim = meta.onClaim as ((row: ClaimableReward & { __raw?: unknown }) => Promise<void>) | undefined;
      const isClaiming = typeof meta.isClaiming === "function" ? meta.isClaiming(row.original) : false;

      const handleClaim = async () => {
        try {
          await onClaim?.(row.original as any);
          // Optional UX ping
          // toast.success("Claim submitted");
        } catch (e: any) {
          toast.error(e?.message ?? "Claim failed");
        }
      };

      return (
        <Button title="Claim" className="bg-blue-400" onClick={handleClaim} disabled={!onClaim || isClaiming}>
          {isClaiming ? "Claiming…" : "Claim"}
        </Button>
      );
    },
    enableSorting: false,
  },
];
