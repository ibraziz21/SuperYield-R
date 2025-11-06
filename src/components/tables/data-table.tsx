"use client";

import * as React from "react";
import {
  ColumnDef,
  Table as TableTanstack,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";


import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  children?: React.ReactNode;
  table: TableTanstack<TData>;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  children,
  table,
}: DataTableProps<TData, TValue>) {
  // const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
  //   []
  // );
  // const table = useReactTable({
  //   data,
  //   columns,
  //   getCoreRowModel: getCoreRowModel(),
  //   getPaginationRowModel: getPaginationRowModel(),
  //   onColumnFiltersChange: setColumnFilters,
  //   getFilteredRowModel: getFilteredRowModel(),
  //   state: {
  //     columnFilters,
  //   },
  // });
  const { pageIndex } = table.getState().pagination;
  const router = useRouter();

  const paginationButtons = [];
  if (table.getPageCount()) {
    for (let i = 0; i < table!.getPageCount(); i++) {
      paginationButtons.push(
        <Button
          className={`ml-1 ${i === pageIndex ? "bg-[#7CE27E] text-white" : ""}`}
          variant="outline"
          size="sm"
          key={i}
          onClick={() => table.setPageIndex(i)}
        >
          {i + 1}
        </Button>
      );
    }
  }

  return (
    <div>
      <div className="rounded-md bg-white border my-3">
        {children}
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export type PaginationState = {
  pageIndex: number;
  pageSize: number;
};

export type PaginationTableState = {
  pagination: PaginationState;
};

export type PaginationInitialTableState = {
  pagination?: Partial<PaginationState>;
};
