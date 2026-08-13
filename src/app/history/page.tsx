"use client"

import { HistoryRestoreButton } from "@/components/history-restore-button"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
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
import { canRestoreBackup, restoreEligibilityFromHistory } from "@/lib/backup/restore-eligibility"
import { useDeleteHistory, usePaginatedHistory } from "@/lib/hooks/useHistory"
import { formatBytes } from "@/lib/utils"
import { format, formatDistance } from "date-fns"
import { ExternalLinkIcon, HistoryIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

const HISTORY_STATUSES = new Set(["running", "success", "failed"])

function historyEndpointLabel(item: {
  backupConfig?: {
    sourceKind?: string | null
    server?: { name?: string | null } | null
    sourceS3Profile?: { name?: string | null } | null
  } | null
}): string {
  const kind = item.backupConfig?.sourceKind || "server"
  if (kind === "local") return "this host"
  if (kind === "s3") return item.backupConfig?.sourceS3Profile?.name || "S3"
  return item.backupConfig?.server?.name || "—"
}

function HistoryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const configIdFromUrl =
    searchParams.get("configId") || searchParams.get("backupId") || ""
  const statusParam = searchParams.get("status") || ""
  const statusFromUrl = HISTORY_STATUSES.has(statusParam) ? statusParam : ""

  const [searchTerm, setSearchTerm] = useState("")
  const { mutate: deleteHistory, isPending: isDeleting } = useDeleteHistory()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const {
    data,
    isLoading,
    refetch,
    filters,
    updateFilters,
    pagination,
    goToPage
  } = usePaginatedHistory({
    configId: configIdFromUrl,
    status: statusFromUrl,
  })

  // Keep filters in sync when navigating from dashboard / backup detail links
  useEffect(() => {
    if ((filters.configId || "") !== configIdFromUrl) {
      updateFilters({ configId: configIdFromUrl })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to URL changes
  }, [configIdFromUrl])

  useEffect(() => {
    if ((filters.status || "") !== statusFromUrl) {
      updateFilters({ status: statusFromUrl })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to URL changes
  }, [statusFromUrl])

  // Debounce search into the query filter
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if ((filters.search || "") !== searchTerm) {
        updateFilters({ search: searchTerm })
      }
    }, 250)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])

  const clearConfigFilter = () => {
    updateFilters({ configId: "" })
    const params = new URLSearchParams(searchParams.toString())
    params.delete("configId")
    params.delete("backupId")
    const qs = params.toString()
    router.replace(qs ? `/history?${qs}` : "/history")
  }

  const statusColors = {
    running: "bg-blue-500",
    success: "bg-green-500",
    failed: "bg-red-500",
  }

  function statusBadge(item: { status: string; mailboxPending?: boolean }) {
    if (item.mailboxPending) {
      return <Badge className="bg-amber-500">waiting for bro</Badge>
    }
    return (
      <Badge
        className={statusColors[item.status as keyof typeof statusColors] || "bg-gray-500"}
      >
        {item.status}
      </Badge>
    )
  }

  const filteredConfigName = data?.filters?.configName

  return (
    <PageLayout>
      <PageHeader
        title="Backup History"
        description={
          filters.configId ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Showing history for</span>
              <Badge variant="secondary" className="gap-1 font-normal">
                {filteredConfigName || filters.configId}
                <button
                  type="button"
                  onClick={clearConfigFilter}
                  className="ml-1 rounded-sm hover:bg-muted"
                  aria-label="Clear backup filter"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </Badge>
              {filteredConfigName && (
                <Link
                  href={`/backups/${filters.configId}`}
                  className="text-blue-500 hover:underline"
                >
                  View backup
                </Link>
              )}
            </div>
          ) : undefined
        }
        actions={
          <LoadingButton
            isLoading={isLoading}
            onClick={() => refetch()}
            variant="outline"
            size="icon"
            hideTextWhenLoading={true}
          >
            <RefreshCwIcon className="h-4 w-4" />
          </LoadingButton>
        }
      />

      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by backup name, server, or path..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <Select
          value={filters.status === "" || !filters.status ? "all" : filters.status}
          onValueChange={(value) => {
            const status = value === "all" ? "" : value
            updateFilters({ status })
            const params = new URLSearchParams(searchParams.toString())
            if (status) {
              params.set("status", status)
            } else {
              params.delete("status")
            }
            const qs = params.toString()
            router.replace(qs ? `/history?${qs}` : "/history")
          }}
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
        emptyMessage={
          filters.configId || filters.search || filters.status
            ? "No backup history matches these filters"
            : "No backup history found"
        }
        dataLabel="backup history"
        isDataEmpty={(data) => !data?.history?.length}
      >
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Backup Config</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.history?.map((item: any) => {
                  const showRestore = canRestoreBackup(restoreEligibilityFromHistory(item))
                  return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link href={`/history/${item.id}`} className="font-medium hover:underline text-primary">
                        {item.backupConfig?.name || "Unknown"}
                      </Link>
                    </TableCell>
                    <TableCell>{historyEndpointLabel(item)}</TableCell>
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
                      {statusBadge(item)}
                    </TableCell>
                    <TableCell>
                      {item.totalSize ? formatBytes(item.totalSize) : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.fileCount || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {showRestore && <HistoryRestoreButton entry={item} />}
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/history/${item.id}`}>
                            <ExternalLinkIcon className="h-3.5 w-3.5" />
                            Open
                          </Link>
                        </Button>
                        <DeleteConfirmationDialog
                          title="Delete this history entry?"
                          description="This deletes the history row only. Backup files on disk (if any) are left in place."
                          isDeleting={isDeleting && deletingId === item.id}
                          buttonText="Delete"
                          onDelete={() => {
                            setDeletingId(item.id)
                            deleteHistory(item.id, {
                              onSettled: () => setDeletingId(null),
                            })
                          }}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                          >
                            Delete
                          </Button>
                        </DeleteConfirmationDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                  )
                })}
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
    </PageLayout>
  )
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <PageLayout>
          <PageHeader title="Backup History" />
          <div className="h-40 animate-pulse rounded-md bg-muted/30" />
        </PageLayout>
      }
    >
      <HistoryPageContent />
    </Suspense>
  )
}
