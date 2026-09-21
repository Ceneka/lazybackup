"use client"

import { HistoryList } from "@/components/history-list"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { localDayRange } from "@/lib/backup/local-date"
import { useDeleteHistory, usePaginatedHistory } from "@/lib/hooks/useHistory"
import { format } from "date-fns"
import { HistoryIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

const HISTORY_STATUSES = new Set(["running", "success", "failed"])

function HistoryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const configIdFromUrl =
    searchParams.get("configId") || searchParams.get("backupId") || ""
  const statusParam = searchParams.get("status") || ""
  const statusFromUrl = HISTORY_STATUSES.has(statusParam) ? statusParam : ""
  const dayParam = searchParams.get("day") || ""
  const dayFromUrl = localDayRange(dayParam) ? dayParam : ""

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
    day: dayFromUrl,
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

  useEffect(() => {
    if ((filters.day || "") !== dayFromUrl) {
      updateFilters({ day: dayFromUrl })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to URL changes
  }, [dayFromUrl])

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

  const clearDayFilter = () => {
    updateFilters({ day: "" })
    const params = new URLSearchParams(searchParams.toString())
    params.delete("day")
    const qs = params.toString()
    router.replace(qs ? `/history?${qs}` : "/history")
  }

  const clearConfigFilter = () => {
    updateFilters({ configId: "" })
    const params = new URLSearchParams(searchParams.toString())
    params.delete("configId")
    params.delete("backupId")
    const qs = params.toString()
    router.replace(qs ? `/history?${qs}` : "/history")
  }

  const filteredConfigName = data?.filters?.configName
  const dayRange = filters.day ? localDayRange(filters.day) : null
  const historyFiltered = Boolean(
    filters.configId || filters.search || filters.status || filters.day
  )

  return (
    <PageLayout>
      <PageHeader
        title="Backup History"
        description={
          filters.configId || dayRange ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Showing history for</span>
              {filters.configId ? (
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
              ) : null}
              {dayRange ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  {format(dayRange.start, "MMM d, yyyy")}
                  <button
                    type="button"
                    onClick={clearDayFilter}
                    className="ml-1 rounded-sm hover:bg-muted"
                    aria-label="Clear day filter"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {filters.configId && filteredConfigName ? (
                <Link
                  href={`/backups/${filters.configId}`}
                  className="text-blue-500 hover:underline"
                >
                  View backup
                </Link>
              ) : null}
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
            aria-label="Refresh history"
          >
            <RefreshCwIcon className="h-4 w-4" />
            <span className="sr-only">Refresh history</span>
          </LoadingButton>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by backup name, server, or path..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
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
          <SelectTrigger className="w-full sm:w-[180px]">
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
          historyFiltered
            ? "No backup history matches these filters"
            : "No backup history found"
        }
        emptyDescription={
          historyFiltered
            ? undefined
            : "Jobs appear here after they run."
        }
        emptyAction={
          historyFiltered ? undefined : (
            <Button asChild>
              <Link href="/backups">Run a backup or create one</Link>
            </Button>
          )
        }
        dataLabel="backup history"
        isDataEmpty={(data) => !data?.history?.length}
      >
        <>
          <HistoryList
            items={data?.history ?? []}
            isDeleting={isDeleting}
            deletingId={deletingId}
            onDelete={(id) => {
              setDeletingId(id)
              deleteHistory(id, {
                onSettled: () => setDeletingId(null),
              })
            }}
          />

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
