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
  emptyMessage?: string;
  emptySubMessage?: string;
  filterUI?: React.ReactNode;
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
  emptyMessage,
  emptySubMessage,
  filterUI,
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
    <DataTable table={table} columns={columns} data={data} onRowClick={handleRowClick} emptyMessage={emptyMessage} emptySubMessage={emptySubMessage}>
      {filterUI}
    </DataTable>
  );
}
