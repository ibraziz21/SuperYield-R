// src/components/tables/VaultsTable/Vaults.tsx
"use client";

import React, { useMemo } from "react";
import VaultsTable from ".";
import { VaultsColumns } from "./columns";
import { useYields, type YieldSnapshot } from "@/hooks/useYields";

/** Display names for Morpho Lisk vault tokens */
const DISPLAY_TOKEN: Record<string, string> = {
  USDC: "Re7 USDC.e",
  USDT: "Re7 USDT0",
  USDCe: "Re7 USDC.e",
  USDT0: "Re7 USDT0",
  WETH: "Re7 WETH",
};

/** Hard filter: only show Lisk + Morpho Blue + (USDC/USDT underlying) */
const HARD_FILTER = (
  y: Pick<YieldSnapshot, "chain" | "protocolKey" | "token">,
) =>
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
      const routeKey =
        snap.token === "USDC"
          ? "USDCe"
          : snap.token === "USDT"
          ? "USDT0"
          : snap.token;

      return {
        vault: vaultDisplay, // "Re7 USDC.e" | "Re7 USDT0"
        routeKey,            // "USDCe" | "USDT0"
        network: "Lisk",     // fixed per filter
        protocol: "Morpho Blue",
        apy: (Number(snap.apy) || 0).toFixed(2),
        tvl: Number.isFinite(snap.tvlUSD)
          ? Math.round(snap.tvlUSD).toLocaleString()
          : "0",
      };
    });
  }, [yields, isLoading, error]);

  return <VaultsTable columns={VaultsColumns} data={data} />;
};

export default Vaults;
