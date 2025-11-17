
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
import { DataTable } from "../data-table";
import { normalizeVaultRoute } from "../VaultsTable";
import { useRouter } from "next/navigation";


interface TblProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export default function MyPositionsTable<TData , TValue>({
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
    <DataTable table={table} columns={columns} data={data}   onRowClick={handleRowClick}/>
  );
}
