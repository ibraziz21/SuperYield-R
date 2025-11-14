import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "../data-table";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useRouter } from "next/navigation";

interface TblProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

/** Fallback mapper from display label -> route slug */
export function normalizeVaultRoute(label: string): string {
  const clean = (label || "").trim();

  // Explicit cases first
  if (/^USDC\.?e$/i.test(clean) || /^USDC$/i.test(clean)) return "USDCe";
  if (/^USDT0$/i.test(clean) || /^USDT$/i.test(clean)) return "USDT0";

  // Otherwise: remove spaces, replace ".e" -> "e"
  return clean.replace(/\s+/g, "").replace(/\.e$/i, "e");
}

export default function VaultsTable<TData, TValue>({
  columns,
  data,
}: TblProps<TData, TValue>) {
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const router = useRouter();

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    state: {
      columnFilters,
      sorting,
    },
  });

  const handleRowClick = (row: any) => {
    // Prefer a canonical key if your data rows provide it (recommended):
    // e.g. in Vaults.tsx, set `routeKey: 'USDCe' | 'USDT0'`
    const routeKey = row.original?.routeKey as string | undefined;

    // Otherwise, normalize from display label (USDC.e -> USDCe, USDT0 -> USDT0, etc.)
    const display = (row.original?.vault as string) ?? "";
    const vaultParam = routeKey ?? normalizeVaultRoute(display);

    router.push(`/vaults/${encodeURIComponent(vaultParam)}`);
  };

  return (
    <DataTable table={table} columns={columns} data={data} onRowClick={handleRowClick}>
      <div className="p-3 flex items-center gap-3">
        <Select
          value={(table.getColumn("network")?.getFilterValue() as string) ?? "all"}
          onValueChange={(value: string) => {
            table.getColumn("network")?.setFilterValue(value === "all" ? "" : value);
          }}
        >
          <SelectTrigger className="w-[200px] bg-[#A5A5A520] outline-none">
            <SelectValue placeholder="All Networks" />
          </SelectTrigger>
          <SelectContent className="bg-[#ffffff] text-[#808195]">
            <SelectItem value="all">All Networks</SelectItem>
            <SelectItem value="Ethereum">Ethereum</SelectItem>
            <SelectItem value="Lisk">Lisk</SelectItem>
            <SelectItem value="Arbitrum">Arbitrum</SelectItem>
            <SelectItem value="Optimism">Optimism</SelectItem>
            <SelectItem value="Base">Base</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={(table.getColumn("protocol")?.getFilterValue() as string) ?? "all"}
          onValueChange={(value: string) => {
            table.getColumn("protocol")?.setFilterValue(value === "all" ? "" : value);
          }}
        >
          <SelectTrigger className="w-[200px] bg-[#A5A5A520] outline-none">
            <SelectValue placeholder="All Protocols" />
          </SelectTrigger>
          <SelectContent className="bg-[#ffffff] text-[#808195]">
            <SelectItem value="all">All Protocols</SelectItem>
            {/* IMPORTANT: this must match the actual cell value exactly */}
            <SelectItem value="Morpho Blue">Morpho Blue</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center border border-[#ccc] rounded-full px-2 flex-1 max-w-md">
          <MagnifyingGlassIcon color="#1e1e1e" />
          <input
            type="text"
            className="outline-none p-2 w-full bg-transparent"
            placeholder="Search Vaults"
            value={(table.getColumn("vault")?.getFilterValue() as string) ?? ""}
            onChange={(event: React.FormEvent<HTMLInputElement>) => {
              table.getColumn("vault")?.setFilterValue(event.currentTarget.value);
            }}
          />
        </div>
      </div>
    </DataTable>
  );
}
