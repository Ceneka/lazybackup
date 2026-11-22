"use client"

import { BackupRecipesEmpty } from "@/components/backup-recipes-empty"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { ResourceListCard } from "@/components/resource-list-card"
import { backupOverflowItems } from "@/components/resource-overflow"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { QueryState } from "@/components/ui/query-state"
import { destinationEndpointKey } from "@/lib/backup/destination"
import {
  destinationEndpointName,
  sourceEndpointName,
  sourcePathLabel,
  sourceTypeLabel,
} from "@/lib/backup/endpoint-display"
import { formatRelativeTime, pickActiveRunningRun } from "@/lib/backup/run-status"
import {
  useBackups,
  useDeleteBackup,
  useToggleBackup,
  type Backup,
} from "@/lib/hooks/useBackups"
import { useResourceQuickActions } from "@/lib/resource-actions"
import { cn } from "@/lib/utils"
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckCircle2Icon,
  FolderIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

function endpointShort(backup: Backup, side: "from" | "to"): string {
  if (side === "from") {
    return `${sourceEndpointName(backup)}:${sourcePathLabel(backup)}`
  }
  return `${destinationEndpointName(backup)}:${backup.destinationPath}`
}

const RUN_STATUS_LABEL = {
  success: "Success",
  failed: "Failed",
  running: "Running",
} as const

const RUN_STATUS_TONE = {
  success: "success",
  failed: "destructive",
  running: "info",
} as const

function RunStatusBadge({ run }: { run: Backup["latestRun"] }) {
  if (!run) {
    return <Badge variant="muted">Never run</Badge>
  }

  const Icon =
    run.status === "success"
      ? CheckCircle2Icon
      : run.status === "failed"
        ? XCircleIcon
        : Loader2Icon

  return (
    <Badge variant={RUN_STATUS_TONE[run.status]} className="gap-1">
      <Icon
        className={cn("h-3 w-3", run.status === "running" && "animate-spin")}
        aria-hidden
      />
      {RUN_STATUS_LABEL[run.status]} · {formatRelativeTime(run.startTime)}
    </Badge>
  )
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "failed", label: "Failed" },
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"]

function parseStatusFilter(value: string | null): StatusFilter {
  return value === "active" || value === "paused" || value === "failed"
    ? value
    : "all"
}

function matchesStatusFilter(backup: Backup, filter: StatusFilter): boolean {
  if (filter === "active") return backup.enabled
  if (filter === "paused") return !backup.enabled
  if (filter === "failed") return backup.latestRun?.status === "failed"
  return true
}

function BackupsPageContent() {
  const query = useBackups()
  const actions = useResourceQuickActions()
  const deleteBackup = useDeleteBackup()
  const toggleBackup = useToggleBackup()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    parseStatusFilter(searchParams.get("status"))
  )
  const searchTrimmed = search.trim()

  // Follow URL changes (bookmarks, browser back/forward) into local state.
  useEffect(() => {
    const q = searchParams.get("q") ?? ""
    setSearch((current) => (current === q ? current : q))
  }, [searchParams])

  useEffect(() => {
    const next = parseStatusFilter(searchParams.get("status"))
    setStatusFilter((current) => (current === next ? current : next))
  }, [searchParams])

  // Keep search/status in the URL so a filtered list can be shared or restored.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (searchTrimmed) params.set("q", searchTrimmed)
    else params.delete("q")
    if (statusFilter !== "all") params.set("status", statusFilter)
    else params.delete("status")

    const next = params.toString()
    if (next === searchParams.toString()) return

    const handle = window.setTimeout(() => {
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [searchTrimmed, statusFilter, searchParams, pathname, router])

  /**
   * Enabled configs that write to the same endpoint are flagged with the name
   * of the other backup. Disabled configs do not produce a warning (and peer
   * IDs are part of the key so two different Bro peers never collide).
   */
  const duplicateDestinations = useMemo(() => {
    const conflicts = new Map<string, string[]>()
    const backups = query.data
    if (!backups?.length) return conflicts

    const byKey = new Map<string, { id: string; name: string }[]>()
    for (const backup of backups) {
      if (!backup.enabled) continue
      const key = destinationEndpointKey({
        destinationKind: backup.destinationKind,
        destinationServerId: backup.destinationServerId,
        destinationS3ProfileId: backup.destinationS3ProfileId,
        destinationPeerId: backup.destinationPeerId,
        destinationPath: backup.destinationPath,
      })
      const list = byKey.get(key) ?? []
      list.push({ id: backup.id, name: backup.name })
      byKey.set(key, list)
    }

    for (const list of byKey.values()) {
      if (list.length < 2) continue
      for (const backup of list) {
        conflicts.set(
          backup.id,
          list.filter((other) => other.id !== backup.id).map((other) => other.name)
        )
      }
    }
    return conflicts
  }, [query.data])

  // Client-side search: name, endpoints, paths, source type, schedule
  const visibleBackups = useMemo(() => {
    const backups = query.data
    if (!backups) return []
    const terms = searchTrimmed.toLowerCase().split(/\s+/).filter(Boolean)

    return backups.filter((backup) => {
      if (!matchesStatusFilter(backup, statusFilter)) return false
      if (terms.length === 0) return true

      const haystack = [
        backup.name,
        endpointShort(backup, "from"),
        endpointShort(backup, "to"),
        sourceTypeLabel(backup),
        backup.sourcePath,
        backup.destinationPath,
        backup.schedule,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [query.data, searchTrimmed, statusFilter])

  const filtersActive = Boolean(searchTrimmed) || statusFilter !== "all"
  const clearFilters = () => {
    setSearch("")
    setStatusFilter("all")
  }

  return (
    <PageLayout>
      <PageHeader
        title="Backup Configurations"
        actions={
          <Link
            href="/backups/new"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            Add Backup
          </Link>
        }
      />

      {query.data && query.data.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by name, server, or path..."
                className="pl-8 pr-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search backups"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-2.5 rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            {filtersActive && (
              <p className="shrink-0 text-sm text-muted-foreground">
                {visibleBackups.length} of {query.data.length} backups
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={statusFilter === filter.value ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <QueryState
        query={query}
        dataLabel="backup configurations"
        errorIcon={<FolderIcon className="h-12 w-12 text-red-500" />}
        isDataEmpty={() => false}
      >
        {query.data && query.data.length === 0 && <BackupRecipesEmpty />}
        {query.data && query.data.length > 0 && visibleBackups.length === 0 && (
          <div className="rounded-lg border border-dashed py-12 text-center">
            <p className="text-muted-foreground">No backups match the current filters.</p>
            <Button type="button" variant="link" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )}
        {visibleBackups.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleBackups.map((backup) => {
              const duplicateNames = duplicateDestinations.get(backup.id) ?? []

              return (
                <ResourceListCard
                  key={backup.id}
                  href={`/backups/${backup.id}`}
                  editHref={`/backups/${backup.id}/edit`}
                  icon={FolderIcon}
                  title={backup.name}
                  badges={
                    <>
                      <Badge variant={backup.enabled ? "success" : "muted"}>
                        {backup.enabled ? "Active" : "Paused"}
                      </Badge>
                      <RunStatusBadge run={backup.latestRun} />
                      {backup.lastValidation && !backup.lastValidation.ok ? (
                        <Badge
                          variant="warning"
                          className="pointer-events-auto"
                          title="The last validation found problems — open the backup for details."
                        >
                          Validation failed
                        </Badge>
                      ) : null}
                      {duplicateNames.length > 0 ? (
                        <Badge
                          variant="warning"
                          className="pointer-events-auto"
                          title={`Same destination as: ${duplicateNames.join(", ")}`}
                        >
                          Shared destination
                        </Badge>
                      ) : null}
                    </>
                  }
                  overflow={backupOverflowItems({
                    id: backup.id,
                    name: backup.name,
                    enabled: backup.enabled,
                    running: backup.latestRun
                      ? Boolean(pickActiveRunningRun([backup.latestRun]))
                      : false,
                    actions,
                    onToggle: () => toggleBackup.mutate(backup.id),
                    isToggling:
                      toggleBackup.isPending && toggleBackup.variables === backup.id,
                    onDelete: () => deleteBackup.mutate(backup.id),
                    isDeleting:
                      deleteBackup.isPending && deleteBackup.variables === backup.id,
                  })}
                  flash={actions.flashFor(`backup:${backup.id}`)}
                >
                  <p className="flex min-w-0 flex-wrap items-start gap-x-1 gap-y-0.5">
                    <span
                      className="min-w-0 break-all"
                      title={endpointShort(backup, "from")}
                    >
                      {endpointShort(backup, "from")}
                    </span>
                    <ArrowRightIcon className="mt-1 h-3.5 w-3.5 shrink-0" />
                    <span
                      className="min-w-0 break-all"
                      title={endpointShort(backup, "to")}
                    >
                      {endpointShort(backup, "to")}
                    </span>
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {backup.enabled
                        ? backup.nextRunFormatted
                          ? `Next ${backup.nextRunFormatted}`
                          : "No next run"
                        : "Paused"}
                    </span>
                  </p>
                </ResourceListCard>
              )
            })}
          </div>
        )}
      </QueryState>
    </PageLayout>
  )
}

export default function BackupsPage() {
  return (
    <Suspense fallback={null}>
      <BackupsPageContent />
    </Suspense>
  )
}
