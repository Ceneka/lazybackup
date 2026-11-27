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
import { localDayRange, toLocalDateKey } from "@/lib/backup/local-date"
import { useDeleteHistory, useHistoryList } from "@/lib/hooks/useHistory"
import { format } from "date-fns"
import {
  BarChart3Icon,
  HistoryIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"

const HISTORY_STATUSES = new Set(["running", "success", "failed", "waiting"])
const PAGE_SIZE = 10

function daysAgoKey(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toLocalDateKey(date)
}

function formatDayKey(key: string): string {
  const range = localDayRange(key)
  return range ? format(range.start, "MMM d, yyyy") : key
}

function HistoryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const configId =
    searchParams.get("configId") || searchParams.get("backupId") || ""
  const statusParam = searchParams.get("status") || ""
  const status = HISTORY_STATUSES.has(statusParam) ? statusParam : ""
  const dayParam = searchParams.get("day") || ""
  const day = localDayRange(dayParam) ? dayParam : ""
  const fromParam = searchParams.get("from") || ""
  const from = localDayRange(fromParam) ? fromParam : ""
  const toParam = searchParams.get("to") || ""
  const to = localDayRange(toParam) ? toParam : ""
  const search = searchParams.get("search") || ""
  const pageParam = Number.parseInt(searchParams.get("page") || "1", 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const offset = (page - 1) * PAGE_SIZE

  const [searchTerm, setSearchTerm] = useState(search)
  const lastWrittenSearch = useRef(search)
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams
  const { mutate: deleteHistory, isPending: isDeleting } = useDeleteHistory()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const query = useHistoryList(
    { configId, status, search, day, from, to },
    { limit: PAGE_SIZE, offset }
  )
  const { data } = query

  const applyParams = (
    mutate: (params: URLSearchParams) => void,
    mode: "push" | "replace" = "replace"
  ) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const qs = params.toString()
    const url = qs ? `/history?${qs}` : "/history"
    if (mode === "push") {
      router.push(url)
    } else {
      router.replace(url, { scroll: false })
    }
  }

  // Debounce typing into the URL so links and the detail Back action keep it.
  useEffect(() => {
    if (searchTerm === search) return
    const handle = window.setTimeout(() => {
      lastWrittenSearch.current = searchTerm
      const params = new URLSearchParams(searchParamsRef.current.toString())
      if (searchTerm) {
        params.set("search", searchTerm)
      } else {
        params.delete("search")
      }
      params.delete("page")
      const qs = params.toString()
      router.replace(qs ? `/history?${qs}` : "/history", { scroll: false })
    }, 250)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on the input only
  }, [searchTerm, search])

  // Follow Back/forward or links that change the search from outside the input.
  useEffect(() => {
    if (search === lastWrittenSearch.current) return
    lastWrittenSearch.current = search
    setSearchTerm(search)
  }, [search])

  // A deleted last row (or a stale shared page link) can point past the end.
  useEffect(() => {
    if (!data?.pagination) return
    const maxPage = Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE))
    if (page <= maxPage) return
    const params = new URLSearchParams(searchParams.toString())
    if (maxPage <= 1) {
      params.delete("page")
    } else {
      params.set("page", String(maxPage))
    }
    const qs = params.toString()
    router.replace(qs ? `/history?${qs}` : "/history", { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp after data lands
  }, [data?.pagination?.total, page])

  const setDayFilter = (value: string) => {
    applyParams((params) => {
      params.delete("from")
      params.delete("to")
      params.delete("page")
      if (value) {
        params.set("day", value)
      } else {
        params.delete("day")
      }
    })
  }

  const setRangeFilter = (daysBack: number) => {
    applyParams((params) => {
      params.delete("day")
      params.delete("page")
      params.set("from", daysAgoKey(daysBack))
      params.set("to", toLocalDateKey(new Date()))
    })
  }

  const clearDayFilter = () => setDayFilter("")

  const clearRangeFilter = () => {
    applyParams((params) => {
      params.delete("from")
      params.delete("to")
      params.delete("page")
    })
  }

  const clearConfigFilter = () => {
    applyParams((params) => {
      params.delete("configId")
      params.delete("backupId")
      params.delete("page")
    })
  }

  const clearAllFilters = () => {
    setSearchTerm("")
    lastWrittenSearch.current = ""
    router.replace("/history")
  }

  const goToPage = (nextPage: number) => {
    const pageCount = data?.pagination
      ? Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE))
      : 1
    const target = Math.min(Math.max(1, nextPage), pageCount)
    if (target === page) return
    const params = new URLSearchParams(searchParams.toString())
    if (target <= 1) {
      params.delete("page")
    } else {
      params.set("page", String(target))
    }
    const qs = params.toString()
    router.push(qs ? `/history?${qs}` : "/history")
  }

  const todayKey = toLocalDateKey(new Date())
  const todayActive = day === todayKey && !from && !to
  const sevenDaysActive = from === daysAgoKey(6) && to === todayKey
  const thirtyDaysActive = from === daysAgoKey(29) && to === todayKey

  const filteredConfigName = data?.filters?.configName
  const dayRange = day ? localDayRange(day) : null
  const rangeLabel =
    from || to
      ? `${from ? formatDayKey(from) : "…"} – ${to ? formatDayKey(to) : "…"}`
      : null
  const historyFiltered = Boolean(
    configId || search || status || day || from || to
  )
  const pageCount = data?.pagination
    ? Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE))
    : 1
  const isFirstPage = page <= 1
  const isLastPage = page >= pageCount

  // First/last + current ±1, with a single ellipsis for each gap.
  const visiblePageIndexes = new Set<number>([0, pageCount - 1])
  for (
    let index = Math.max(0, page - 2);
    index <= Math.min(pageCount - 1, page);
    index += 1
  ) {
    visiblePageIndexes.add(index)
  }
  const pageItems: Array<number | "gap"> = []
  const sortedPageIndexes = [...visiblePageIndexes].sort((a, b) => a - b)
  sortedPageIndexes.forEach((pageIndex, index) => {
    if (index > 0 && pageIndex - sortedPageIndexes[index - 1] > 1) {
      pageItems.push("gap")
    }
    pageItems.push(pageIndex)
  })

  return (
    <PageLayout>
      <PageHeader
        title="Backup History"
        description={
          configId || dayRange || rangeLabel ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Showing history for</span>
              {configId ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  {filteredConfigName || configId}
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
              {rangeLabel ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  {rangeLabel}
                  <button
                    type="button"
                    onClick={clearRangeFilter}
                    className="ml-1 rounded-sm hover:bg-muted"
                    aria-label="Clear date range filter"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null}
              {configId && filteredConfigName ? (
                <Link
                  href={`/backups/${configId}`}
                  className="text-primary hover:underline"
                >
                  View backup
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/history/stats">
                <BarChart3Icon className="h-4 w-4" />
                Statistics
              </Link>
            </Button>
            <LoadingButton
              isLoading={query.isFetching}
              onClick={() => query.refetch()}
              variant="outline"
              size="icon"
              hideTextWhenLoading={true}
              aria-label="Refresh history"
            >
              <RefreshCwIcon className="h-4 w-4" />
              <span className="sr-only">Refresh history</span>
            </LoadingButton>
          </div>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by backup name, server, or path..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search backup history"
            />
          </div>
          <Select
            value={status === "" || !status ? "all" : status}
            onValueChange={(value) => {
              const nextStatus = value === "all" ? "" : value
              applyParams((params) => {
                params.delete("page")
                if (nextStatus) {
                  params.set("status", nextStatus)
                } else {
                  params.delete("status")
                }
              })
            }}
          >
            <SelectTrigger
              className="w-full sm:w-[180px]"
              aria-label="Filter by status"
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="waiting">Waiting for a friend</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-labelledby="history-quick-range"
        >
          <span
            id="history-quick-range"
            className="text-xs font-medium text-muted-foreground"
          >
            Quick range
          </span>
          <Button
            type="button"
            size="sm"
            variant={todayActive ? "secondary" : "outline"}
            aria-pressed={todayActive}
            onClick={() => setDayFilter(todayKey)}
          >
            Today
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sevenDaysActive ? "secondary" : "outline"}
            aria-pressed={sevenDaysActive}
            onClick={() => setRangeFilter(6)}
          >
            7 days
          </Button>
          <Button
            type="button"
            size="sm"
            variant={thirtyDaysActive ? "secondary" : "outline"}
            aria-pressed={thirtyDaysActive}
            onClick={() => setRangeFilter(29)}
          >
            30 days
          </Button>
          <Input
            type="date"
            className="w-full sm:w-[160px]"
            value={day}
            onChange={(e) => setDayFilter(e.target.value)}
            aria-label="Filter by a specific day"
          />
          {historyFiltered ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
            >
              <XIcon className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <QueryState
        query={query}
        transformError={(error) =>
          error instanceof Error ? error.message : "Failed to load backup history"
        }
        emptyIcon={<HistoryIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage={
          historyFiltered
            ? "No backup history matches these filters"
            : "No backup history found"
        }
        emptyDescription={
          historyFiltered
            ? "Try a different search, status, or date range."
            : "Jobs appear here after they run."
        }
        emptyAction={
          historyFiltered ? (
            <Button variant="outline" onClick={clearAllFilters}>
              Clear filters
            </Button>
          ) : (
            <Button asChild>
              <Link href="/backups">Run a backup or create one</Link>
            </Button>
          )
        }
        dataLabel="backup history"
        isDataEmpty={(data) => !data?.history?.length}
        showChildrenWhenEmpty
      >
        <>
          {data?.history?.length ? (
            <HistoryList
              items={data.history}
              isDeleting={isDeleting}
              deletingId={deletingId}
              returnQuery={searchParams.toString()}
              onDelete={(id) => {
                setDeletingId(id)
                deleteHistory(id, {
                  onSettled: () => setDeletingId(null),
                })
              }}
            />
          ) : null}

          {data?.pagination && data.pagination.total > PAGE_SIZE && (
            <Pagination className="mt-4">
              <PaginationContent className="flex-wrap">
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={isFirstPage}
                    tabIndex={isFirstPage ? -1 : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (!isFirstPage) {
                        goToPage(page - 1)
                      }
                    }}
                    className={
                      isFirstPage ? "pointer-events-none opacity-50" : ""
                    }
                  />
                </PaginationItem>

                <PaginationItem className="px-2 text-sm text-muted-foreground sm:hidden">
                  Page {page} of {pageCount}
                </PaginationItem>

                {pageItems.map((pageItem, index) =>
                  pageItem === "gap" ? (
                    <PaginationItem
                      key={`gap-${index}`}
                      className="hidden sm:block"
                      aria-hidden="true"
                    >
                      …
                    </PaginationItem>
                  ) : (
                    <PaginationItem
                      key={pageItem}
                      className="hidden sm:block"
                    >
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          goToPage(pageItem + 1);
                        }}
                        isActive={page === pageItem + 1}
                      >
                        {pageItem + 1}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    aria-disabled={isLastPage}
                    tabIndex={isLastPage ? -1 : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      if (!isLastPage) {
                        goToPage(page + 1)
                      }
                    }}
                    className={
                      isLastPage ? "pointer-events-none opacity-50" : ""
                    }
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
