
import { Checkbox } from "@/components/ui/checkbox";
import { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";

export type ClaimableReward = {
  network: string;
  source: string;
  claimable: string;
  token: string;
}

import { DataTableColumnHeader } from "../data-table-header";
import { Button } from "@/components/ui/button";

// Network icon mapping
const networkIcons: Record<string, string> = {
  Ethereum: "/networks/ethereum.svg",
  Lisk: "/networks/lisk.svg",
  Arbitrum: "/networks/arbitrum.svg",
  Optimism: "/networks/optimism.svg",
  Base: "/networks/base.svg",
};

// Protocol/Source icon mapping
const sourceIcons: Record<string, string> = {
  "Aave V3": "/protocols/aave.svg",
  "Morpho Blue": "/protocols/morpho.svg",
  Compound: "/protocols/compound.svg",
  GMX: "/protocols/gmx.svg",
};

// Token icon mapping
const tokenIcons: Record<string, string> = {
  AAVE: "/tokens/aave.svg",
  USDC: "/tokens/usdc.svg",
  ETH: "/tokens/eth.svg",
  WETH: "/tokens/weth.svg",
  GMX: "/tokens/gmx.svg",
  USDT: "/tokens/usdt.svg",
};

// Mock token prices (in a real app, fetch from API)
const tokenPrices: Record<string, number> = {
  AAVE: 85.5,
  USDC: 1.0,
  ETH: 2400.0,
  WETH: 2400.0,
  GMX: 45.2,
  USDT: 1.0,
};

export const ClaimableRewardColumns: ColumnDef<ClaimableReward>[] = [
  {
    accessorKey: "network",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Network" />
    ),
    cell: ({ row }) => {
      const network = row.getValue("network") as string;
      const iconPath = networkIcons[network] || "/networks/default.svg";

      return (
        <div className="flex items-center justify-center gap-2">
          <div className="w-6 h-6 relative">
            <Image
              src={iconPath}
              alt={network}
              width={24}
              height={24}
              className="rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Source" />
    ),
    cell: ({ row }) => {
      const source = row.getValue("source") as string;
      const iconPath = sourceIcons[source] || "/protocols/default.svg";

      return (
        <div className="flex items-center justify-center gap-2">
          <div className="w-6 h-6 relative">
            <Image
              src={iconPath}
              alt={source}
              width={24}
              height={24}
              className="rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Claimable" />
    ),
    cell: ({ row }) => {
      const claimable = row.getValue("claimable") as string;
      const token = row.getValue("token") as string;

      // Remove commas and parse the amount
      const amount = parseFloat(claimable.replace(/,/g, ""));
      const price = tokenPrices[token] || 0;
      const usdValue = amount * price;

      return (
        <div className="text-center">
          <div className="font-medium">{claimable} {token}</div>
          <div className="text-xs text-muted-foreground">
            ${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "token",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Token" />
    ),
    cell: ({ row }) => {
      const token = row.getValue("token") as string;
      const iconPath = tokenIcons[token] || "/tokens/default.svg";

      return (
        <div className="flex items-center justify-center gap-2">
          <div className="w-6 h-6 relative">
            <Image
              src={iconPath}
              alt={token}
              width={24}
              height={24}
              className="rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
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
    accessorKey: "ACTIONS",
    header: "Actions",
    cell: ({ row }) => {
      const reward = row.original;

      const handleClaim = () => {
        toast.success("Claim Initiated", {
          description: `Claiming ${reward.claimable} ${reward.token} from ${reward.source} on ${reward.network}`,
          duration: 3000,
        });
      };

      return (
        <Button
          title="Claim"
          className="bg-blue-400"
          onClick={handleClaim}
        />
      );
    },
  },
];
