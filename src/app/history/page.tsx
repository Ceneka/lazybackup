"use client"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from "@/components/ui/pagination"
import { QueryState } from "@/components/ui/query-state"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { usePaginatedHistory } from "@/lib/hooks/useHistory"
import { formatBytes } from "@/lib/utils"
import { format, formatDistance } from "date-fns"
import { HistoryIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export default function HistoryPage() {
  const [searchTerm, setSearchTerm] = useState("")
  
  const { 
    data, 
    isLoading, 
    refetch,
    filters,
    updateFilters,
    pagination,
    goToPage
  } = usePaginatedHistory()
  
  const statusColors = {
    running: "bg-blue-500",
    success: "bg-green-500",
    failed: "bg-red-500",
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Backup History</h1>
        <LoadingButton 
          isLoading={isLoading} 
          onClick={() => refetch()} 
          variant="outline" 
          size="icon"
          hideTextWhenLoading={true}
        >
          <RefreshCwIcon className="h-4 w-4" />
        </LoadingButton>
      </div>
      
      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search backups..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                // We could add debounce here for better performance
                updateFilters({ search: e.target.value })
              }}
            />
          </div>
        </div>
        <Select
          value={filters.status === "" ? "all" : filters.status}
          onValueChange={(value) => updateFilters({ status: value === "all" ? "" : value })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <QueryState 
        query={{ isLoading, data, error: null, isError: false, refetch }}
        emptyIcon={<HistoryIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="No backup history found"
        dataLabel="backup history"
        isDataEmpty={(data) => !data?.history?.length}
      >
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Backup Config</TableHead>
                  <TableHead>Server</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.history?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No backup history found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.history?.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/history/${item.id}`} className="font-medium hover:underline text-primary">
                          {item.backupConfig.name}
                        </Link>
                      </TableCell>
                      <TableCell>{item.backupConfig.server.name}</TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {format(new Date(item.startTime), "MMM d, yyyy")}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(item.startTime), "h:mm a")}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.endTime ? (
                          formatDistance(
                            new Date(item.startTime),
                            new Date(item.endTime),
                            { includeSeconds: true }
                          )
                        ) : (
                          <span className="text-muted-foreground">In progress</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          className={statusColors[item.status as keyof typeof statusColors] || "bg-gray-500"}
                        >
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.totalSize ? formatBytes(item.totalSize) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.fileCount || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          {data?.pagination && data.pagination.total > pagination.limit && (
            <Pagination className="mt-4">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      if (pagination.offset > 0) {
                        goToPage(Math.floor(pagination.offset / pagination.limit) - 1);
                      }
                    }}
                    className={pagination.offset === 0 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                
                {Array.from(
                  { length: Math.ceil(data.pagination.total / pagination.limit) },
                  (_, i) => i
                ).map((page) => {
                  // Show only a subset of pages if there are many
                  const currentPage = pagination.offset / pagination.limit;
                  if (
                    page === 0 || 
                    page === Math.ceil(data.pagination.total / pagination.limit) - 1 ||
                    (page >= currentPage - 1 && page <= currentPage + 1)
                  ) {
                    return (
                      <PaginationItem key={page}>
                        <PaginationLink 
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            goToPage(page);
                          }}
                          isActive={pagination.offset === page * pagination.limit}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  }
                  if (
                    page === currentPage - 2 || 
                    page === currentPage + 2
                  ) {
                    return <PaginationItem key={page}>...</PaginationItem>;
                  }
                  return null;
                })}
                
                <PaginationItem>
                  <PaginationNext 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      if (pagination.offset + pagination.limit < data.pagination.total) {
                        goToPage(Math.floor(pagination.offset / pagination.limit) + 1);
                      }
                    }}
                    className={pagination.offset + pagination.limit >= data.pagination.total ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      </QueryState>
    </div>
  )
} 
