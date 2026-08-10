"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  findExactConflictInList,
  findNestedOverlapsInList,
  suggestDestinationPath,
  type EndpointKind,
} from "@/lib/backup/destination"
import { useBackups, type Backup } from "@/lib/hooks/useBackups"
import { Server, useServerDockerVolumes } from "@/lib/hooks/useServers"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  HardDriveIcon,
  Loader2Icon,
  RefreshCwIcon,
  ServerIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

export type BackupFormData = {
  name: string
  sourceKind: EndpointKind
  serverId: string
  destinationKind: EndpointKind
  destinationServerId: string
  sourceType: "path" | "docker_volume" | "database"
  sourcePath: string
  destinationPath: string
  schedule: string
  excludePatterns: string
  preBackupCommands: string
  dbEngine: "postgres" | "mysql" | "mariadb"
  dbClient: "native" | "docker"
  dbContainer: string
  dbHost: string
  dbPort: string
  dbUser: string
  dbPassword: string
  enabled: boolean
  enableVersioning: boolean
  versionsToKeep: number
  enableFileRetention: boolean
  retentionMaxAge: number
  retentionMaxAgeUnit: "days" | "months"
  retentionMinKeep: number
}

const inputClass =
  "w-full p-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"

export function backupToFormData(backup: Backup): BackupFormData {
  return {
    name: backup.name,
    sourceKind: backup.sourceKind || "server",
    serverId: backup.serverId || "",
    destinationKind: backup.destinationKind || "local",
    destinationServerId: backup.destinationServerId || "",
    sourceType: backup.sourceType || "path",
    sourcePath: backup.sourcePath,
    destinationPath: backup.destinationPath,
    schedule: backup.schedule,
    excludePatterns: backup.excludePatterns || "",
    preBackupCommands: backup.preBackupCommands || "",
    dbEngine: backup.dbEngine || "postgres",
    dbClient: backup.dbClient || "native",
    dbContainer: backup.dbContainer || "",
    dbHost: backup.dbHost || "127.0.0.1",
    dbPort: backup.dbPort != null ? String(backup.dbPort) : "",
    dbUser: backup.dbUser || "",
    dbPassword: backup.dbPassword || "",
    enabled: backup.enabled,
    enableVersioning: Boolean(backup.enableVersioning),
    versionsToKeep: backup.versionsToKeep ?? 5,
    enableFileRetention: Boolean(backup.enableFileRetention),
    retentionMaxAge: backup.retentionMaxAge ?? 30,
    retentionMaxAgeUnit: backup.retentionMaxAgeUnit || "days",
    retentionMinKeep: backup.retentionMinKeep ?? 5,
  }
}

/** Prefill create form from an existing config (unique name + destination). */
export function cloneToFormData(backup: Backup): BackupFormData {
  const base = backupToFormData(backup)
  const name = backup.name.toLowerCase().startsWith("copy of ")
    ? backup.name
    : `Copy of ${backup.name}`

  const destinationKind = base.destinationKind
  let destinationPath = base.destinationPath
  if (destinationKind === "local") {
    // Leave empty so auto-suggest builds a unique path from the new name.
    destinationPath = ""
  } else if (destinationPath) {
    destinationPath = `${destinationPath.replace(/\/+$/, "")}-copy`
  }

  return {
    ...base,
    name,
    destinationPath,
    enabled: false,
  }
}

function endpointLabel(
  kind: EndpointKind,
  serverId: string,
  servers: Server[],
  path: string
): string {
  if (kind === "local") {
    return path ? `this host:${path}` : "this host"
  }
  const server = servers.find((s) => s.id === serverId)
  const name = server?.name || "server"
  return path ? `${name}:${path}` : name
}

type BackupConfigFormProps = {
  mode: "create" | "edit"
  servers: Server[]
  initialData: BackupFormData
  submitting: boolean
  onSubmit: (data: BackupFormData) => Promise<void>
  excludeBackupId?: string
  /** When true (create), auto-suggest local destination until user edits it */
  autoSuggestDestination?: boolean
}

export function BackupConfigForm({
  mode,
  servers,
  initialData,
  submitting,
  onSubmit,
  excludeBackupId,
  autoSuggestDestination = false,
}: BackupConfigFormProps) {
  const [formData, setFormData] = useState<BackupFormData>(initialData)
  const [destinationTouched, setDestinationTouched] = useState(!autoSuggestDestination)
  const [testingDb, setTestingDb] = useState(false)
  const backupsQuery = useBackups()

  const volumesQuery = useServerDockerVolumes(
    formData.sourceKind === "server" && formData.sourceType === "docker_volume"
      ? formData.serverId
      : ""
  )

  const sourceServer = servers.find((s) => s.id === formData.serverId)
  const destServer = servers.find((s) => s.id === formData.destinationServerId)

  useEffect(() => {
    if (!autoSuggestDestination || destinationTouched) {
      return
    }
    if (formData.destinationKind !== "local" || !formData.name.trim()) {
      return
    }
    const suggested = suggestDestinationPath({
      serverName: sourceServer?.name || (formData.sourceKind === "local" ? "local" : "server"),
      backupName: formData.name,
    })
    setFormData((prev) =>
      prev.destinationPath === suggested ? prev : { ...prev, destinationPath: suggested }
    )
  }, [
    autoSuggestDestination,
    destinationTouched,
    formData.destinationKind,
    formData.name,
    formData.sourceKind,
    sourceServer?.name,
  ])

  const destinationConflict = useMemo(() => {
    if (!formData.destinationPath.trim() || !backupsQuery.data) {
      return null
    }
    return findExactConflictInList(
      backupsQuery.data,
      formData.destinationPath,
      excludeBackupId,
      {
        destinationKind: formData.destinationKind,
        destinationServerId: formData.destinationServerId || null,
      }
    )
  }, [
    backupsQuery.data,
    formData.destinationPath,
    formData.destinationKind,
    formData.destinationServerId,
    excludeBackupId,
  ])

  const destinationOverlaps = useMemo(() => {
    if (!formData.destinationPath.trim() || !backupsQuery.data) {
      return []
    }
    return findNestedOverlapsInList(
      backupsQuery.data,
      formData.destinationPath,
      excludeBackupId,
      {
        destinationKind: formData.destinationKind,
        destinationServerId: formData.destinationServerId || null,
      }
    )
  }, [
    backupsQuery.data,
    formData.destinationPath,
    formData.destinationKind,
    formData.destinationServerId,
    excludeBackupId,
  ])

  const summary = `${endpointLabel(
    formData.sourceKind,
    formData.serverId,
    servers,
    formData.sourceType === "docker_volume"
      ? `volume:${formData.sourcePath || "…"}`
      : formData.sourceType === "database"
        ? `db:${formData.sourcePath || "…"}`
        : formData.sourcePath || "…"
  )} → ${endpointLabel(
    formData.destinationKind,
    formData.destinationServerId,
    servers,
    formData.destinationPath || "…"
  )}`

  const canSwap =
    formData.sourceType === "path" &&
    !(formData.sourceKind === formData.destinationKind &&
      formData.serverId === formData.destinationServerId)

  function updateField<K extends keyof BackupFormData>(key: K, value: BackupFormData[K]) {
    setFormData((prev) => {
      const next = { ...prev, [key]: value }
      if (key === "sourceKind" && value === "local") {
        if (next.sourceType === "docker_volume") {
          next.sourceType = "path"
        }
        next.serverId = ""
      }
      if (key === "destinationKind" && value === "local") {
        next.destinationServerId = ""
      }
      if (key === "sourceType" && value === "docker_volume") {
        next.sourcePath = ""
      }
      if (key === "sourceType" && value === "database") {
        if (!next.dbHost) next.dbHost = "127.0.0.1"
        if (!next.dbEngine) next.dbEngine = "postgres"
        if (!next.dbClient) next.dbClient = "native"
      }
      if ((key === "serverId" || key === "sourceType") && next.sourceType === "docker_volume") {
        if (key === "serverId") {
          next.sourcePath = ""
        }
      }
      return next
    })
  }

  function handleSwap() {
    if (!canSwap) {
      toast.error("Cannot swap when source is a Docker volume or database")
      return
    }
    setDestinationTouched(true)
    setFormData((prev) => ({
      ...prev,
      sourceKind: prev.destinationKind,
      serverId: prev.destinationKind === "server" ? prev.destinationServerId : "",
      destinationKind: prev.sourceKind,
      destinationServerId: prev.sourceKind === "server" ? prev.serverId : "",
      sourcePath: prev.destinationPath,
      destinationPath: prev.sourcePath,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (destinationConflict) {
      toast.error(`Destination is already used by "${destinationConflict.name}"`)
      return
    }
    if (formData.sourceKind === "server" && !formData.serverId) {
      toast.error("Select a source server")
      return
    }
    if (formData.destinationKind === "server" && !formData.destinationServerId) {
      toast.error("Select a destination server")
      return
    }
    await onSubmit(formData)
  }

  function KindToggle({
    value,
    onChange,
    idPrefix,
  }: {
    value: EndpointKind
    onChange: (kind: EndpointKind) => void
    idPrefix: string
  }) {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          id={`${idPrefix}-local`}
          onClick={() => onChange("local")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
            value === "local"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/50"
          }`}
        >
          <HardDriveIcon className="h-4 w-4" />
          This host
        </button>
        <button
          type="button"
          id={`${idPrefix}-server`}
          onClick={() => onChange("server")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
            value === "server"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/50"
          }`}
        >
          <ServerIcon className="h-4 w-4" />
          Server
        </button>
      </div>
    )
  }

  function EndpointPanel({
    title,
    kind,
    onKindChange,
    serverId,
    onServerChange,
    path,
    onPathChange,
    idPrefix,
    isSource,
  }: {
    title: string
    kind: EndpointKind
    onKindChange: (k: EndpointKind) => void
    serverId: string
    onServerChange: (id: string) => void
    path: string
    onPathChange: (path: string) => void
    idPrefix: string
    isSource: boolean
  }) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {kind === "local" ? (
            <HardDriveIcon className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ServerIcon className="h-4 w-4 text-muted-foreground" />
          )}
          {title}
        </div>

        <KindToggle value={kind} onChange={onKindChange} idPrefix={idPrefix} />

        {kind === "server" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-server-select`}>
              Server
            </label>
            <select
              id={`${idPrefix}-server-select`}
              className={inputClass}
              value={serverId}
              onChange={(e) => onServerChange(e.target.value)}
              required
            >
              <option value="">Select a server</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.host})
                </option>
              ))}
            </select>
          </div>
        )}

        {isSource && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-source-type`}>
              Source type
            </label>
            <select
              id={`${idPrefix}-source-type`}
              className={inputClass}
              value={formData.sourceType}
              onChange={(e) =>
                updateField(
                  "sourceType",
                  e.target.value as "path" | "docker_volume" | "database"
                )
              }
            >
              <option value="path">Filesystem path</option>
              {kind === "server" && <option value="docker_volume">Docker volume</option>}
              <option value="database">Database dump</option>
            </select>
          </div>
        )}

        {isSource && formData.sourceType === "docker_volume" && kind === "server" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-volume`}>
                Docker volume
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={!serverId || volumesQuery.isFetching}
                onClick={() => volumesQuery.refetch()}
              >
                {volumesQuery.isFetching ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCwIcon className="h-3.5 w-3.5" />
                )}
                <span className="ml-1">Refresh</span>
              </Button>
            </div>
            <select
              id={`${idPrefix}-volume`}
              className={inputClass}
              value={path}
              onChange={(e) => onPathChange(e.target.value)}
              required
              disabled={!serverId || volumesQuery.isLoading}
            >
              <option value="">
                {!serverId
                  ? "Select a server first"
                  : volumesQuery.isLoading
                    ? "Loading volumes…"
                    : "Select a volume"}
              </option>
              {path &&
                volumesQuery.data &&
                !volumesQuery.data.includes(path) && (
                  <option value={path}>{path} (current)</option>
                )}
              {(volumesQuery.data || []).map((volume) => (
                <option key={volume} value={volume}>
                  {volume}
                </option>
              ))}
            </select>
            {volumesQuery.isError && (
              <Alert variant="destructive">
                <AlertTriangleIcon className="h-4 w-4" />
                <AlertTitle>Could not list volumes</AlertTitle>
                <AlertDescription>
                  {volumesQuery.error instanceof Error
                    ? volumesQuery.error.message
                    : "Failed to load Docker volumes"}
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : isSource && formData.sourceType === "database" ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-db-name`}>
              Database name
            </label>
            <input
              id={`${idPrefix}-db-name`}
              type="text"
              className={inputClass}
              value={path}
              onChange={(e) => onPathChange(e.target.value)}
              placeholder="app"
              required
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-path`}>
              {kind === "local" ? "Path on this host" : "Path on server"}
            </label>
            <input
              id={`${idPrefix}-path`}
              type="text"
              className={inputClass}
              value={path}
              onChange={(e) => {
                if (!isSource) {
                  setDestinationTouched(true)
                }
                onPathChange(e.target.value)
              }}
              placeholder={kind === "local" ? "/backups/my-backup" : "/var/www"}
              required
            />
          </div>
        )}
      </div>
    )
  }

  async function handleTestDatabase() {
    if (formData.sourceKind === "server" && !formData.serverId) {
      toast.error("Select a source server first")
      return
    }
    if (!formData.sourcePath.trim() || !formData.dbUser.trim()) {
      toast.error("Database name and user are required")
      return
    }
    if (formData.dbClient === "docker" && !formData.dbContainer.trim()) {
      toast.error("Container name is required for docker client mode")
      return
    }
    setTestingDb(true)
    try {
      const res = await fetch("/api/backups/database/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind: formData.sourceKind,
          serverId: formData.sourceKind === "server" ? formData.serverId : null,
          dbEngine: formData.dbEngine,
          dbClient: formData.dbClient,
          dbContainer: formData.dbClient === "docker" ? formData.dbContainer : null,
          dbHost: formData.dbHost || "127.0.0.1",
          dbPort: formData.dbPort ? Number(formData.dbPort) : null,
          dbUser: formData.dbUser,
          dbPassword: formData.dbPassword,
          sourcePath: formData.sourcePath,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Connection test failed")
      }
      toast.success("Database connection OK")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection test failed")
    } finally {
      setTestingDb(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="name" className="block text-sm font-medium">
          Backup name
        </label>
        <input
          id="name"
          type="text"
          className={inputClass}
          value={formData.name}
          onChange={(e) => updateField("name", e.target.value)}
          required
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Transfer</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSwap}
            disabled={!canSwap}
            title="Swap source and destination"
          >
            <ArrowLeftRightIcon className="h-4 w-4 mr-1" />
            Swap
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row items-stretch gap-3">
          <EndpointPanel
            title="From"
            kind={formData.sourceKind}
            onKindChange={(k) => updateField("sourceKind", k)}
            serverId={formData.serverId}
            onServerChange={(id) => updateField("serverId", id)}
            path={formData.sourcePath}
            onPathChange={(p) => updateField("sourcePath", p)}
            idPrefix="from"
            isSource
          />

          <div className="flex lg:flex-col items-center justify-center shrink-0 py-1">
            <ArrowRightIcon className="h-5 w-5 text-muted-foreground rotate-90 lg:rotate-0" />
          </div>

          <EndpointPanel
            title="To"
            kind={formData.destinationKind}
            onKindChange={(k) => updateField("destinationKind", k)}
            serverId={formData.destinationServerId}
            onServerChange={(id) => updateField("destinationServerId", id)}
            path={formData.destinationPath}
            onPathChange={(p) => updateField("destinationPath", p)}
            idPrefix="to"
            isSource={false}
          />
        </div>

        <p className="text-xs text-muted-foreground font-mono break-all">{summary}</p>

        {formData.sourceType === "database" && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">Database connection</h4>
              <LoadingButton
                type="button"
                variant="outline"
                size="sm"
                isLoading={testingDb}
                loadingText="Testing…"
                onClick={handleTestDatabase}
              >
                Test connection
              </LoadingButton>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="db-engine">
                  Engine
                </label>
                <select
                  id="db-engine"
                  className={inputClass}
                  value={formData.dbEngine}
                  onChange={(e) =>
                    updateField(
                      "dbEngine",
                      e.target.value as "postgres" | "mysql" | "mariadb"
                    )
                  }
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="db-client">
                  Client
                </label>
                <select
                  id="db-client"
                  className={inputClass}
                  value={formData.dbClient}
                  onChange={(e) =>
                    updateField("dbClient", e.target.value as "native" | "docker")
                  }
                >
                  <option value="native">Native (pg_dump / mysqldump on host)</option>
                  <option value="docker">Docker exec (into container)</option>
                </select>
              </div>
              {formData.dbClient === "docker" && (
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs text-muted-foreground" htmlFor="db-container">
                    Container name
                  </label>
                  <input
                    id="db-container"
                    type="text"
                    className={inputClass}
                    value={formData.dbContainer}
                    onChange={(e) => updateField("dbContainer", e.target.value)}
                    placeholder="postgres"
                    required
                  />
                </div>
              )}
              {formData.dbClient === "native" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground" htmlFor="db-host">
                      Host
                    </label>
                    <input
                      id="db-host"
                      type="text"
                      className={inputClass}
                      value={formData.dbHost}
                      onChange={(e) => updateField("dbHost", e.target.value)}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground" htmlFor="db-port">
                      Port (optional)
                    </label>
                    <input
                      id="db-port"
                      type="number"
                      className={inputClass}
                      value={formData.dbPort}
                      onChange={(e) => updateField("dbPort", e.target.value)}
                      placeholder={formData.dbEngine === "postgres" ? "5432" : "3306"}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="db-user">
                  User
                </label>
                <input
                  id="db-user"
                  type="text"
                  className={inputClass}
                  value={formData.dbUser}
                  onChange={(e) => updateField("dbUser", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="db-password">
                  Password
                </label>
                <input
                  id="db-password"
                  type="password"
                  className={inputClass}
                  value={formData.dbPassword}
                  onChange={(e) => updateField("dbPassword", e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Dumps a logical <code className="text-xs">.sql.gz</code> via{" "}
              {formData.dbEngine === "postgres" ? "pg_dump" : "mysqldump"}
              {formData.dbClient === "docker" ? " inside the container" : " on the source host"}.
              Prefer this over Docker volume backups for live databases.
            </p>
          </div>
        )}

        {formData.destinationKind === "local" && (
          <p className="text-xs text-muted-foreground">
            Local destinations live on the LazyBackup host
            {autoSuggestDestination ? " (defaults to /backups/… until you edit)" : ""}.
          </p>
        )}
        {formData.destinationKind === "server" && destServer && (
          <p className="text-xs text-muted-foreground">
            Files will be written on {destServer.name} ({destServer.host}).
          </p>
        )}

        {destinationConflict && (
          <Alert variant="destructive">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Destination already in use</AlertTitle>
            <AlertDescription>
              Backup &quot;{destinationConflict.name}&quot; already uses this destination.
            </AlertDescription>
          </Alert>
        )}
        {!destinationConflict && destinationOverlaps.length > 0 && (
          <Alert>
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Overlapping destination</AlertTitle>
            <AlertDescription>
              Nested under or contains:{" "}
              {destinationOverlaps.map((o) => o.name).join(", ")}. Exact duplicates are blocked;
              nested paths are allowed but can fight over the same files.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="space-y-4 border-t pt-4">
        <div className="space-y-2">
          <label htmlFor="schedule" className="block text-sm font-medium">
            Schedule (cron)
          </label>
          <input
            id="schedule"
            type="text"
            className={inputClass}
            value={formData.schedule}
            onChange={(e) => updateField("schedule", e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Example: 0 0 * * * (daily at midnight)
          </p>
        </div>

        {formData.sourceType !== "database" && (
          <div className="space-y-2">
            <label htmlFor="excludePatterns" className="block text-sm font-medium">
              Exclude patterns
            </label>
            <textarea
              id="excludePatterns"
              className={inputClass}
              value={formData.excludePatterns}
              onChange={(e) => updateField("excludePatterns", e.target.value)}
              rows={3}
              placeholder={"*.log\nnode_modules/\n.tmp"}
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="preBackupCommands" className="block text-sm font-medium">
            Pre-backup commands
          </label>
          <textarea
            id="preBackupCommands"
            className={inputClass}
            value={formData.preBackupCommands}
            onChange={(e) => updateField("preBackupCommands", e.target.value)}
            rows={3}
            placeholder={
              formData.sourceKind === "local"
                ? "Commands run on this host before transfer"
                : "Commands run on the source server before transfer"
            }
          />
        </div>

        <div className="flex items-center">
          <input
            id="enabled"
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={formData.enabled}
            onChange={(e) => updateField("enabled", e.target.checked)}
          />
          <label htmlFor="enabled" className="ml-2 block text-sm">
            Enable this backup
          </label>
        </div>

        <div className="flex items-center">
          <input
            id="enableVersioning"
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={formData.enableVersioning}
            onChange={(e) => {
              const checked = e.target.checked
              setFormData((prev) => ({
                ...prev,
                enableVersioning: checked,
                enableFileRetention: checked ? false : prev.enableFileRetention,
              }))
            }}
          />
          <label htmlFor="enableVersioning" className="ml-2 block text-sm">
            Enable versioning (timestamped subfolders)
          </label>
        </div>

        {formData.enableVersioning && (
          <div className="space-y-2 pl-6">
            <label htmlFor="versionsToKeep" className="block text-sm font-medium">
              Versions to keep
            </label>
            <input
              id="versionsToKeep"
              type="number"
              min={1}
              max={100}
              className={inputClass}
              value={formData.versionsToKeep}
              onChange={(e) => updateField("versionsToKeep", Number(e.target.value) || 5)}
            />
          </div>
        )}

        <div className="flex items-center">
          <input
            id="enableFileRetention"
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={formData.enableFileRetention}
            disabled={formData.enableVersioning}
            onChange={(e) => updateField("enableFileRetention", e.target.checked)}
          />
          <label htmlFor="enableFileRetention" className="ml-2 block text-sm">
            Enable file retention (age-based cleanup)
          </label>
        </div>

        {formData.enableFileRetention && !formData.enableVersioning && (
          <div className="space-y-3 pl-6 rounded-md border border-border p-3">
            <Alert variant="destructive">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>Destructive cleanup</AlertTitle>
              <AlertDescription>
                Old top-level files in the destination may be deleted after each successful run.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label htmlFor="retentionMaxAge" className="text-xs text-muted-foreground">
                  Max age
                </label>
                <input
                  id="retentionMaxAge"
                  type="number"
                  min={1}
                  className={inputClass}
                  value={formData.retentionMaxAge}
                  onChange={(e) => updateField("retentionMaxAge", Number(e.target.value) || 30)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="retentionMaxAgeUnit" className="text-xs text-muted-foreground">
                  Unit
                </label>
                <select
                  id="retentionMaxAgeUnit"
                  className={inputClass}
                  value={formData.retentionMaxAgeUnit}
                  onChange={(e) =>
                    updateField("retentionMaxAgeUnit", e.target.value as "days" | "months")
                  }
                >
                  <option value="days">Days</option>
                  <option value="months">Months</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="retentionMinKeep" className="text-xs text-muted-foreground">
                  Min keep
                </label>
                <input
                  id="retentionMinKeep"
                  type="number"
                  min={1}
                  className={inputClass}
                  value={formData.retentionMinKeep}
                  onChange={(e) => updateField("retentionMinKeep", Number(e.target.value) || 5)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" asChild>
          <Link href={mode === "edit" && excludeBackupId ? `/backups/${excludeBackupId}` : "/backups"}>
            Cancel
          </Link>
        </Button>
        <LoadingButton type="submit" isLoading={submitting} disabled={Boolean(destinationConflict)}>
          {mode === "create" ? "Create backup" : "Save changes"}
        </LoadingButton>
      </div>
    </form>
  )
}

export function defaultCreateFormData(prefillServerId?: string): BackupFormData {
  return {
    name: "",
    sourceKind: "server",
    serverId: prefillServerId || "",
    destinationKind: "local",
    destinationServerId: "",
    sourceType: "path",
    sourcePath: "",
    destinationPath: "",
    schedule: "0 0 * * *",
    excludePatterns: "",
    preBackupCommands: "",
    dbEngine: "postgres",
    dbClient: "native",
    dbContainer: "",
    dbHost: "127.0.0.1",
    dbPort: "",
    dbUser: "",
    dbPassword: "",
    enabled: true,
    enableVersioning: false,
    versionsToKeep: 5,
    enableFileRetention: false,
    retentionMaxAge: 30,
    retentionMaxAgeUnit: "days",
    retentionMinKeep: 5,
  }
}

export function formDataToPayload(data: BackupFormData) {
  return {
    name: data.name,
    sourceKind: data.sourceKind,
    serverId: data.sourceKind === "server" ? data.serverId : null,
    destinationKind: data.destinationKind,
    destinationServerId: data.destinationKind === "server" ? data.destinationServerId : null,
    sourceType: data.sourceType,
    sourcePath: data.sourcePath,
    destinationPath: data.destinationPath,
    schedule: data.schedule,
    excludePatterns:
      data.sourceType === "database" ? undefined : data.excludePatterns || undefined,
    preBackupCommands: data.preBackupCommands || undefined,
    dbEngine: data.sourceType === "database" ? data.dbEngine : null,
    dbClient: data.sourceType === "database" ? data.dbClient : null,
    dbContainer:
      data.sourceType === "database" && data.dbClient === "docker"
        ? data.dbContainer
        : null,
    dbHost: data.sourceType === "database" ? data.dbHost || "127.0.0.1" : null,
    dbPort:
      data.sourceType === "database" && data.dbPort
        ? Number(data.dbPort)
        : null,
    dbUser: data.sourceType === "database" ? data.dbUser : null,
    dbPassword: data.sourceType === "database" ? data.dbPassword : null,
    enabled: data.enabled,
    enableVersioning: data.enableVersioning,
    versionsToKeep: data.versionsToKeep,
    enableFileRetention: data.enableFileRetention,
    retentionMaxAge: data.retentionMaxAge,
    retentionMaxAgeUnit: data.retentionMaxAgeUnit,
    retentionMinKeep: data.retentionMinKeep,
  }
}
