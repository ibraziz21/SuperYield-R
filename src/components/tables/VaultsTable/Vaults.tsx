// src/components/tables/VaultsTable/Vaults.tsx
"use client";

import React, { useMemo } from "react";
import VaultsTable from ".";
import { VaultsColumns } from "./columns";
import { useYields, type YieldSnapshot } from "@/hooks/useYields";

// Match YieldRow's display normalization
const DISPLAY_TOKEN: Record<string, string> = {
  USDCe: "USDC",
  USDT0: "USDT",
  USDC: "USDC",
  USDT: "USDT",
  WETH: "WETH",
};

/** Hard filter: only show Lisk + Morpho Blue + (USDCe/USDT0 underlying) */
const HARD_FILTER = (y: Pick<YieldSnapshot, "chain" | "protocolKey" | "token">) =>
  y.chain === "lisk" &&
  y.protocolKey === "morpho-blue" &&
  (y.token === "USDC" || y.token === "USDT");

const Vaults: React.FC = () => {
  const { yields, isLoading, error } = useYields();

  const data = useMemo(() => {
    if (!yields || isLoading || error) return [];

    // Keep only Lisk • Morpho Blue • USDC/USDT
    const filtered = yields.filter((y) => HARD_FILTER(y));

    // Map YieldSnapshot -> Vault row shape
    return filtered.map((snap) => {
      const vaultDisplay = DISPLAY_TOKEN[snap.token] ?? snap.token;
      return {
        vault: vaultDisplay,                     // "USDC" | "USDT"
        network: "Lisk",                         // fixed per filter
        protocol: "Morpho Blue",                 // fixed per filter
        apy: (Number(snap.apy) || 0).toFixed(2), // string for column renderer
        tvl: Number.isFinite(snap.tvlUSD)
          ? Math.round(snap.tvlUSD).toLocaleString()
          : "0",
      };
    });
  }, [yields, isLoading, error]);

  return <VaultsTable columns={VaultsColumns} data={data} />;
};

export default Vaults;
