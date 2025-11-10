// src/components/MyPositions/MyPositions.tsx
"use client";

import React, { useMemo } from "react";
import MyPositionsTable from ".";
import { MyPositionsColumns, type Position as TableRow } from "./columns";

import { usePositions } from "@/hooks/usePositions";
import { useYields, type YieldSnapshot } from "@/hooks/useYields";
import { type Position as BasePosition } from "@/lib/positions";
import { MORPHO_POOLS, TokenAddresses } from "@/lib/constants";

/* ────────────────────────────────────────────────────────── */
/* Types & small helpers                                      */
/* ────────────────────────────────────────────────────────── */

type EvmChain = "lisk";
type MorphoToken = "USDCe" | "USDT0" | "WETH";

type PositionLike =
  | BasePosition
  | {
      protocol: "Morpho Blue";
      chain: Extract<EvmChain, "lisk">;
      token: MorphoToken;
      amount: bigint; // receipt shares (or 0n for fallback rows)
    };

const CHAIN_LABEL: Record<EvmChain, string> = { lisk: "Lisk" };

const MORPHO_VAULT_BY_TOKEN: Record<MorphoToken, `0x${string}`> = {
  USDCe: MORPHO_POOLS["usdce-supply"] as `0x${string}`,
  USDT0: MORPHO_POOLS["usdt0-supply"] as `0x${string}`,
  WETH: MORPHO_POOLS["weth-supply"] as `0x${string}`,
};

const TOKEN_DECIMALS: Record<MorphoToken, number> = {
  USDCe: 6,
  USDT0: 6,
  WETH: 18,
};

export function formatAmountBigint(amount: bigint, decimals: number): string {
  // humanize: 1) convert to decimal string 2) add thousand separators 3) trim trailing zeros
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (frac === 0n) return `${neg ? "-" : ""}${wholeStr}`;

  let fracStr = frac.toString().padStart(decimals, "0");
  // show up to 6 decimals by default for readability
  fracStr = fracStr.slice(0, Math.min(6, fracStr.length));
  fracStr = fracStr.replace(/0+$/, "");
  return `${neg ? "-" : ""}${wholeStr}${fracStr ? "." + fracStr : ""}`;
}

function formatPercent(n: number): string {
  // e.g. 4.8532 -> "4.85"
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function normalizeDisplayVault(token: string): string {
  // Keep USDT0 literal (to disambiguate), map USDCe → USDC for display nicety
  const t = token.toUpperCase();
  if (t === "USDCe".toUpperCase()) return "USDC";
  if (t === "USDT0") return "USDT0";
  if (t === "USDT") return "USDT";
  if (t === "WETH") return "WETH";
  return token;
}

/* ────────────────────────────────────────────────────────── */
/* Snapshot resolver (same spirit as PositionsDashboardInner) */
/* ────────────────────────────────────────────────────────── */

function findSnapshotForPosition(
  p: PositionLike,
  snapshots: YieldSnapshot[] | undefined
): YieldSnapshot {
  const normToken = String(p.token).toLowerCase();

  // 1) direct token match for Lisk + Morpho
  const direct = snapshots?.find(
    (y) =>
      y.chain === p.chain &&
      y.protocolKey === "morpho-blue" &&
      String(y.token).toLowerCase() ===
        (normToken === "usdce"
          ? "usdc"
          : normToken === "usdt0"
          ? "usdt"
          : normToken)
  );
  if (direct) return direct;

  // 2) vault address match
  const vault = MORPHO_VAULT_BY_TOKEN[p.token as MorphoToken];
  if (vault) {
    const byVault = snapshots?.find(
      (y) =>
        y.protocolKey === "morpho-blue" &&
        y.chain === "lisk" &&
        y.poolAddress?.toLowerCase() === vault.toLowerCase()
    );
    if (byVault) return byVault;
  }

  // 3) fallback snapshot (0 APY/TVL but keeps UI stable)
  const underlyingAddr: `0x${string}` =
    p.token === "USDCe"
      ? (TokenAddresses.USDCe as any).lisk
      : p.token === "USDT0"
      ? (TokenAddresses.USDT0 as any).lisk
      : (TokenAddresses.WETH as any).lisk;

  const fallback: YieldSnapshot = {
    id: `fallback-Morpho-${p.chain}-${String(p.token)}`,
    chain: p.chain as any,
    protocol: "Morpho Blue",
    protocolKey: "morpho-blue",
    poolAddress: vault ?? "0x0000000000000000000000000000000000000000",
    token: p.token as any,
    apy: 0,
    tvlUSD: 0,
    updatedAt: new Date().toISOString(),
    underlying: underlyingAddr,
  };
  return fallback;
}

/* ────────────────────────────────────────────────────────── */
/* Component                                                  */
/* ────────────────────────────────────────────────────────── */

const MyPositions: React.FC = () => {
  const { data: positionsRaw, isLoading: positionsLoading } = usePositions();
  const { yields: snapshots, isLoading: yieldsLoading } = useYields();

  const positions = (positionsRaw ?? []) as unknown as PositionLike[];

  // Only Morpho (Lisk). If none, show fallback zeroed rows for USDCe & USDT0.
  const positionsForMorpho: PositionLike[] = useMemo(() => {
    const morpho = positions.filter((p) => p.protocol === "Morpho Blue") as PositionLike[];
    if (morpho.length > 0) return morpho;
    return [
      { protocol: "Morpho Blue", chain: "lisk", token: "USDCe", amount: 0n },
      { protocol: "Morpho Blue", chain: "lisk", token: "USDT0", amount: 0n },
    ];
  }, [positions]);

  // Build table rows
  const tableData: TableRow[] = useMemo(() => {
    return positionsForMorpho.map((p) => {
      const snap = findSnapshotForPosition(p, snapshots);
      const decimals = 18;
      const depositsHuman = formatAmountBigint(p.amount ?? 0n, decimals);

      const row: TableRow = {
        vault: normalizeDisplayVault(String(p.token)),
        network: CHAIN_LABEL[p.chain],
        deposits: depositsHuman, // token-denominated amount (shares proxied)
        protocol: "Morpho Blue",
        apy: formatPercent(snap.apy),
      };
      return row;
    });
  }, [positionsForMorpho, snapshots]);

  // Optional: a minimal loading skeleton line (kept simple)
  if (positionsLoading || yieldsLoading) {
    return (
      <div className="rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
        Loading positions…
      </div>
    );
  }

  return <MyPositionsTable columns={MyPositionsColumns} data={tableData} />;
};

export default MyPositions;
