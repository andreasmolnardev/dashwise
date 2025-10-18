"use client"

import React, { useState, useEffect } from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type NotificationItem = {
  id: string
  content: string
  status: string
  created: string
  topicId: string
  topicName: string
  title?: string
  description?: string
}

const columns: ColumnDef<NotificationItem>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(val) => table.toggleAllPageRowsSelected(!!val)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(val) => row.toggleSelected(!!val)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "topicName",
    header: "Topic",
  },
  {
    accessorKey: "content",
    header: "Content",
    cell: ({ row }) => {
      const content = row.original.content

      if (content && typeof content === "object" && !Array.isArray(content)) {
        const contentObj = content as { title?: string; description?: string }

        if (contentObj.title) {
          return (
            <div className="max-w-[65%] break-words whitespace-normal">
              <div className="font-semibold">{contentObj.title}</div>
              {contentObj.description && (
                <div className="text-sm break-words">{contentObj.description}</div>
              )}
            </div>
          )
        }

        // fallback for other objects
        return (
          <code className="max-w-[65%] block whitespace-pre-wrap break-words">
            {JSON.stringify(contentObj, null, 2)}
          </code>
        )
      }

      return (
        <span className="max-w-[65%] block whitespace-normal break-words">
          {String(content)}
        </span>
      )
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Status
        <ArrowUpDown className="ml-1 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const status = row.getValue("status")
      if (status === "not read") {
        return <span className="font-bold capitalize">{status}</span>
      }
      return null
    },
    enableHiding: true,
  },
  {
    accessorKey: "created",
    header: () => <div className="text-right">Created</div>,
    cell: ({ row }) => {
      const date = new Date(row.getValue("created"))
      return (
        <div className="text-right font-medium">
          {date.toLocaleString("default", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )
    },
  },
  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const notif = row.original
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="frosted text-(--text-primary)">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(notif.id)}
            >
              Copy notification ID
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-(--text-primary)" />
            <DropdownMenuItem
              onClick={() => alert(`Topic ID: ${notif.topicId}`)}
            >
              Show topic ID
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]

export default function NotificationsInboxPage() {
  const [data, setData] = useState<NotificationItem[]>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    status: false, // hide by default
  })
  const [rowSelection, setRowSelection] = useState({})

  useEffect(() => {
    const token = localStorage.getItem("pb_token")
    if (!token) return

    fetch("/api/v1/notifications", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
      .then((res) => res.json())
      .then((json) => setData(json.items))
      .catch(console.error)
  }, [])

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  })

  return (
    <>
      <h1 className="text-3xl font-semibold mb-4">Inbox</h1>

      <div className="flex items-center py-4">
        <Input
          placeholder="Filter topics..."
          value={(table.getColumn("topicName")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("topicName")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
              Columns
              <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  className="capitalize"
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {col.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-md">
        <Table className="border-transparent">
          <TableHeader className="bg-muted/30 border-none">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className=" border-white/50">
                {hg.headers.map((header) => (
                  <TableHead key={header.id} className="text-(--text-primary)">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className="frosted my-2 border-transparent data-[state=selected]:border-2 data-[state=selected]:border-(--primary)"
                >

                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="border-transparent">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No notifications.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-muted-foreground flex-1 text-sm">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="space-x-2">
          <Button
            className="frosted"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            className="frosted"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  )
}
