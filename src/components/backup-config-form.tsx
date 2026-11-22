"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  findExactConflictInList,
  findNestedOverlapsInList,
  getSuggestStorageRoot,
  isLocalPathInsideStorageRoots,
  slugifyName,
  suggestDestinationPath,
  type EndpointKind,
} from "@/lib/backup/destination"
import { ApiError } from "@/lib/api/client-error"
import { useBackups, type Backup } from "@/lib/hooks/useBackups"
import { useGitRepos } from "@/lib/hooks/useGitRepos"
import {
  fetchContainerDbHints,
  Server,
  useLocalDockerContainers,
  useLocalDockerVolumes,
  useServerDockerContainers,
  useServerDockerVolumes,
} from "@/lib/hooks/useServers"
import { useS3Profiles, type S3Profile } from "@/lib/hooks/useS3Profiles"
import { useEncryption } from "@/lib/hooks/useEncryption"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  CloudIcon,
  GitBranchIcon,
  HardDriveIcon,
  Loader2Icon,
  RefreshCwIcon,
  ServerIcon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { usePeers } from "@/lib/hooks/usePeers"
import { cronPresets } from "@/lib/cron/presets"
import {
  DEFAULT_TIMEZONE,
  formatCronExpression,
  formatInTimezone,
  isValidTimezone,
} from "@/lib/cron/format"
import { getNextCronDate } from "@/lib/cron/next"
import { useSettings } from "@/lib/hooks/useSettings"
import { pathJobUsesServerEndpoint } from "@/lib/backup/transfer-keys"
import { useQuery } from "@tanstack/react-query"

export type SourceKind = EndpointKind | "git"

export type BackupFormData = {
  name: string
  sourceKind: SourceKind
  serverId: string
  sourceS3ProfileId: string
  sourceGitRepoId: string
  destinationKind: EndpointKind
  destinationServerId: string
  destinationS3ProfileId: string
  destinationPeerId: string
  sourceType: "path" | "docker_volume" | "database" | "lazybackup_instance" | "git_repo"
  sourcePath: string
  destinationPath: string
  schedule: string
  excludePatterns: string
  preBackupCommands: string
  dbEngine: "postgres" | "mysql" | "mariadb" | "sqlite"
  dbClient: "native" | "docker"
  dbContainer: string
  dbHost: string
  dbPort: string
  dbUser: string
  dbPassword: string
  /** Edit only: a password is already stored (API never returns it) */
  hasDbPassword?: boolean
  instanceBackupPassphrase: string
  hasInstanceBackupPassphrase?: boolean
  enabled: boolean
  enableEncryption: boolean
  deleteExtraneous: boolean
  enableVersioning: boolean
  versionsToKeep: number
  enableFileRetention: boolean
  retentionMaxAge: number
  retentionMaxAgeUnit: "days" | "months"
  retentionMinKeep: number
}

const inputClass =
  "w-full p-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"

type ListQueryState = {
  isLoading: boolean
  isError: boolean
  refetch: () => unknown
}

type DockerListQuery = ListQueryState & {
  data?: string[]
  isFetching: boolean
  error: unknown
}

type EndpointPanelProps = {
  title: string
  kind: SourceKind
  onKindChange: (kind: SourceKind) => void
  isSource: boolean
  allowPeer: boolean
  serverId: string
  onServerChange: (id: string) => void
  servers: Server[]
  s3ProfileId: string
  onS3ProfileChange: (id: string) => void
  s3Profiles: S3Profile[]
  s3ProfilesQuery: ListQueryState
  gitRepoId: string
  onGitRepoChange: (id: string) => void
  gitRepos: Array<{ id: string; name: string }>
  gitReposQuery: ListQueryState
  peerId: string
  onPeerChange: (id: string) => void
  activePeers: Array<{ id: string; name: string; quotaGb: number }>
  peersQuery: ListQueryState
  sourceType: BackupFormData["sourceType"]
  onSourceTypeChange: (type: BackupFormData["sourceType"]) => void
  path: string
  onPathChange: (path: string) => void
  volumesQuery: DockerListQuery
  fieldErrors: Record<string, string>
  idPrefix: "from" | "to"
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {message}
    </p>
  )
}

function endpointPathPlaceholder(kind: SourceKind, isSource: boolean): string {
  if (kind === "s3" || kind === "peer") return "backups/my-app"
  if (isSource) return "/var/www"
  return "/backups/my-app"
}

/** S3/peer object prefixes are relative: strip leading slashes as the user types/transitions. */
function normalizePrefixPath(value: string): string {
  return value.replace(/^\/+/, "")
}

function EndpointListHint({
  query,
  errorText,
  resourceHref,
  resourceLabel,
  suffix,
}: {
  query: ListQueryState
  errorText: string
  resourceHref: string
  resourceLabel: string
  suffix?: string
}) {
  if (query.isError) {
    return (
      <p className="text-xs text-destructive">
        {errorText}{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </p>
    )
  }
  if (query.isLoading) {
    return null
  }
  return (
    <p className="text-xs text-muted-foreground">
      <Link href={resourceHref} className="underline">
        {resourceLabel}
      </Link>{" "}
      first.{suffix ? ` ${suffix}` : ""}
    </p>
  )
}

function KindToggle({
  value,
  onChange,
  idPrefix,
  allowPeer = false,
  allowGit = false,
  label,
}: {
  value: SourceKind
  onChange: (kind: SourceKind) => void
  idPrefix: string
  allowPeer?: boolean
  allowGit?: boolean
  label: string
}) {
  const options: Array<{ kind: SourceKind; label: string; icon: typeof HardDriveIcon }> = [
    { kind: "local", label: "This host", icon: HardDriveIcon },
    { kind: "server", label: "Server", icon: ServerIcon },
    { kind: "s3", label: "S3", icon: CloudIcon },
  ]
  if (allowGit) {
    options.push({ kind: "git", label: "Git", icon: GitBranchIcon })
  }
  if (allowPeer) {
    options.push({ kind: "peer", label: "Bro", icon: UsersIcon })
  }
  return (
    <div
      role="radiogroup"
      aria-label={`${label} endpoint type`}
      className="grid grid-cols-2 gap-2 sm:flex"
    >
      {options.map(({ kind, label: optionLabel, icon: Icon }) => (
        <button
          key={kind}
          type="button"
          id={`${idPrefix}-${kind}`}
          role="radio"
          aria-checked={value === kind}
          onClick={() => onChange(kind)}
          className={`flex items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm transition-colors sm:flex-1 ${
            value === kind
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/50"
          }`}
        >
          <Icon className="h-4 w-4" />
          {optionLabel}
        </button>
      ))}
    </div>
  )
}

function EndpointPanel({
  title,
  kind,
  onKindChange,
  isSource,
  allowPeer,
  serverId,
  onServerChange,
  servers,
  s3ProfileId,
  onS3ProfileChange,
  s3Profiles,
  s3ProfilesQuery,
  gitRepoId,
  onGitRepoChange,
  gitRepos,
  gitReposQuery,
  peerId,
  onPeerChange,
  activePeers,
  peersQuery,
  sourceType,
  onSourceTypeChange,
  path,
  onPathChange,
  volumesQuery,
  fieldErrors,
  idPrefix,
}: EndpointPanelProps) {
  const pathField = isSource ? "sourcePath" : "destinationPath"
  return (
    <fieldset className="min-w-0 flex-1 space-y-3 rounded-lg border bg-card p-4">
      <legend className="sr-only">{title} endpoint</legend>
      <div className="flex items-center gap-2 text-sm font-medium">
        {kind === "local" ? (
          <HardDriveIcon className="h-4 w-4 text-muted-foreground" />
        ) : kind === "s3" ? (
          <CloudIcon className="h-4 w-4 text-muted-foreground" />
        ) : kind === "peer" ? (
          <UsersIcon className="h-4 w-4 text-muted-foreground" />
        ) : kind === "git" ? (
          <GitBranchIcon className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ServerIcon className="h-4 w-4 text-muted-foreground" />
        )}
        {title}
      </div>

      <KindToggle
        value={kind}
        onChange={onKindChange}
        idPrefix={idPrefix}
        allowPeer={allowPeer}
        allowGit={isSource}
        label={title}
      />

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
            aria-invalid={Boolean(fieldErrors[isSource ? "serverId" : "destinationServerId"])}
          >
            <option value="">Select a server</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name} ({server.host})
              </option>
            ))}
          </select>
          <FieldError
            message={fieldErrors[isSource ? "serverId" : "destinationServerId"]}
          />
        </div>
      )}

      {kind === "s3" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-s3-select`}>
            S3 profile
          </label>
          <select
            id={`${idPrefix}-s3-select`}
            className={inputClass}
            value={s3ProfileId}
            onChange={(e) => onS3ProfileChange(e.target.value)}
            required
            aria-invalid={Boolean(
              fieldErrors[isSource ? "sourceS3ProfileId" : "destinationS3ProfileId"]
            )}
          >
            <option value="">
              {s3ProfilesQuery.isLoading ? "Loading…" : "Select a profile"}
            </option>
            {s3Profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.bucket})
              </option>
            ))}
          </select>
          <FieldError
            message={fieldErrors[isSource ? "sourceS3ProfileId" : "destinationS3ProfileId"]}
          />
          {(s3Profiles.length === 0 || s3ProfilesQuery.isError) && (
            <EndpointListHint
              query={s3ProfilesQuery}
              errorText="Could not load S3 profiles."
              resourceHref="/s3-profiles/new"
              resourceLabel="Add an S3 profile"
            />
          )}
        </div>
      )}

      {kind === "git" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-git-select`}>
            Git repository
          </label>
          <select
            id={`${idPrefix}-git-select`}
            className={inputClass}
            value={gitRepoId}
            onChange={(e) => onGitRepoChange(e.target.value)}
            required
            aria-invalid={Boolean(fieldErrors.sourceGitRepoId)}
          >
            <option value="">
              {gitReposQuery.isLoading ? "Loading…" : "Select a repository"}
            </option>
            {gitRepos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.sourceGitRepoId} />
          {(gitRepos.length === 0 || gitReposQuery.isError) && (
            <EndpointListHint
              query={gitReposQuery}
              errorText="Could not load Git repositories."
              resourceHref="/git-repos/new"
              resourceLabel="Add a Git repository"
            />
          )}
        </div>
      )}

      {kind === "peer" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-peer-select`}>
            Bro peer
          </label>
          <select
            id={`${idPrefix}-peer-select`}
            className={inputClass}
            value={peerId}
            onChange={(e) => onPeerChange(e.target.value)}
            required
            aria-invalid={Boolean(fieldErrors.destinationPeerId)}
          >
            <option value="">
              {peersQuery.isLoading ? "Loading…" : "Select a bro"}
            </option>
            {activePeers.map((peer) => (
              <option key={peer.id} value={peer.id}>
                {peer.name} ({peer.quotaGb} GB)
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.destinationPeerId} />
          {(activePeers.length === 0 || peersQuery.isError) && (
            <EndpointListHint
              query={peersQuery}
              errorText="Could not load paired bros."
              resourceHref="/settings?tab=bro"
              resourceLabel="Pair a bro in Settings → Bro Space"
              suffix="Encryption is always on for bro destinations."
            />
          )}
        </div>
      )}

      {isSource && kind !== "git" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-source-type`}>
            Source type
          </label>
          <select
            id={`${idPrefix}-source-type`}
            className={inputClass}
            value={sourceType}
            onChange={(e) =>
              onSourceTypeChange(e.target.value as BackupFormData["sourceType"])
            }
            disabled={kind === "s3"}
            aria-invalid={Boolean(fieldErrors.sourceType)}
          >
            <option value="path">
              {kind === "s3" ? "Object prefix" : "Filesystem path"}
            </option>
            {kind !== "s3" && <option value="docker_volume">Docker volume</option>}
            {kind !== "s3" && <option value="database">Database dump</option>}
            {kind === "local" && (
              <option value="lazybackup_instance">LazyBackup instance data</option>
            )}
          </select>
          <FieldError message={fieldErrors.sourceType} />
        </div>
      )}

      {isSource && sourceType === "docker_volume" && kind !== "s3" ? (
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
              disabled={(kind === "server" && !serverId) || volumesQuery.isFetching}
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
            disabled={(kind === "server" && !serverId) || volumesQuery.isLoading}
            aria-invalid={Boolean(fieldErrors[pathField])}
          >
            <option value="">
              {kind === "server" && !serverId
                ? "Select a server first"
                : volumesQuery.isLoading
                  ? "Loading volumes…"
                  : "Select a volume"}
            </option>
            {path && volumesQuery.data && !volumesQuery.data.includes(path) && (
              <option value={path}>{path} (current)</option>
            )}
            {(volumesQuery.data || []).map((volume) => (
              <option key={volume} value={volume}>
                {volume}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors[pathField]} />
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
      ) : isSource && sourceType === "lazybackup_instance" ? (
        <p className="text-sm text-muted-foreground">
          Packs this instance&apos;s SQLite database, age encryption vault, and SSH keys.
          Restore is manual (replace DB / import keys). Prefer a passphrase wrap below for
          untrusted destinations.
        </p>
      ) : isSource && kind === "git" ? (
        <p className="text-sm text-muted-foreground">
          Clones a bare mirror on this host, then stores <code>.tar.gz</code> at the
          destination (optional age encryption).
        </p>
      ) : !(isSource && sourceType === "database") ? (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`${idPrefix}-path`}>
            {kind === "local"
              ? "Path on this host"
              : kind === "s3"
                ? "Object key prefix"
                : kind === "peer"
                  ? "Object prefix on bro"
                  : "Path on server"}
          </label>
          <input
            id={`${idPrefix}-path`}
            type="text"
            className={inputClass}
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={endpointPathPlaceholder(kind, isSource)}
            required
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={Boolean(fieldErrors[pathField])}
          />
          <FieldError message={fieldErrors[pathField]} />
        </div>
      ) : null}
    </fieldset>
  )
}

export function backupToFormData(backup: Backup): BackupFormData {
  return {
    name: backup.name,
    sourceKind: backup.sourceKind || "server",
    serverId: backup.serverId || "",
    sourceS3ProfileId: backup.sourceS3ProfileId || "",
    sourceGitRepoId: backup.sourceGitRepoId || "",
    destinationKind: backup.destinationKind || "local",
    destinationServerId: backup.destinationServerId || "",
    destinationS3ProfileId: backup.destinationS3ProfileId || "",
    destinationPeerId: backup.destinationPeerId || "",
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
    dbPassword: "",
    hasDbPassword: Boolean(backup.hasDbPassword),
    instanceBackupPassphrase: "",
    hasInstanceBackupPassphrase: Boolean(backup.hasInstanceBackupPassphrase),
    enabled: backup.enabled,
    enableEncryption: Boolean(backup.enableEncryption) || backup.destinationKind === "peer",
    deleteExtraneous: Boolean(backup.deleteExtraneous),
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
  kind: SourceKind,
  serverId: string,
  servers: Server[],
  s3ProfileId: string,
  s3Profiles: S3Profile[],
  peerId: string,
  peers: Array<{ id: string; name: string }>,
  path: string,
  gitRepoId?: string,
  gitRepos?: Array<{ id: string; name: string }>
): string {
  if (kind === "local") {
    return path ? `this host:${path}` : "this host"
  }
  if (kind === "s3") {
    const profile = s3Profiles.find((p) => p.id === s3ProfileId)
    const name = profile?.name || "s3"
    return path ? `${name}:${path}` : name
  }
  if (kind === "peer") {
    const peer = peers.find((p) => p.id === peerId)
    const name = peer?.name || "bro"
    return path ? `${name}:${path}` : name
  }
  if (kind === "git") {
    const repo = gitRepos?.find((r) => r.id === gitRepoId)
    return repo?.name || "git"
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
  const [destinationTouched, setDestinationTouched] = useState(
    !autoSuggestDestination || Boolean(initialData.destinationPath.trim())
  )
  const [testingDb, setTestingDb] = useState(false)
  const [fillingContainerHints, setFillingContainerHints] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [apiFieldErrors, setApiFieldErrors] = useState<Record<string, string>>({})
  const [passphraseConfirm, setPassphraseConfirm] = useState("")
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [showDbPassword, setShowDbPassword] = useState(false)
  const [numberInputs, setNumberInputs] = useState({
    versionsToKeep: String(initialData.versionsToKeep),
    retentionMaxAge: String(initialData.retentionMaxAge),
    retentionMinKeep: String(initialData.retentionMinKeep),
  })
  const sourcePathMemory = useRef<Partial<Record<BackupFormData["sourceType"], string>>>({})
  const prePeerEncryption = useRef(false)
  const prePeerDeleteExtraneous = useRef(false)
  const formDataRef = useRef(formData)
  useEffect(() => {
    formDataRef.current = formData
  }, [formData])
  const backupsQuery = useBackups()
  const s3ProfilesQuery = useS3Profiles()
  const s3Profiles = s3ProfilesQuery.data || []
  const gitReposQuery = useGitRepos()
  const gitRepos = gitReposQuery.data || []
  const peersQuery = usePeers()
  const activePeers = (peersQuery.data?.peers || []).filter((p) => p.status === "active")
  const settingsQuery = useSettings()
  const encryption = useEncryption()
  const storageRootQuery = useQuery({
    queryKey: ["backups", "storage-root"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await fetch("/api/backups/storage-root")
      if (!response.ok) {
        throw new Error("Failed to load storage root")
      }
      return response.json() as Promise<{
        storageRoot: string
        allowedRoots?: string[]
        allowArbitraryLocalPaths?: boolean
      }>
    },
  })
  const storageRoot = storageRootQuery.data?.storageRoot || getSuggestStorageRoot()
  const allowedStorageRoots = storageRootQuery.data?.allowedRoots || [storageRoot]
  const storageRootLoaded = Boolean(storageRootQuery.data)
  const scheduleTimeZone = useMemo(() => {
    const raw = settingsQuery.settings.timezone?.trim() || DEFAULT_TIMEZONE
    return isValidTimezone(raw) ? raw : DEFAULT_TIMEZONE
  }, [settingsQuery.settings.timezone])
  const nextCronDate = useMemo(
    () => getNextCronDate(formData.schedule, scheduleTimeZone),
    [formData.schedule, scheduleTimeZone]
  )
  const cronFieldCount = formData.schedule.trim()
    ? formData.schedule.trim().split(/\s+/).length
    : 0
  const cronInvalid = cronFieldCount !== 5 || !nextCronDate
  const scheduleLabel = formatCronExpression(formData.schedule)
  const nextRunPreview = useMemo(() => {
    if (settingsQuery.isLoading || !nextCronDate) return null
    return formatInTimezone(nextCronDate, scheduleTimeZone)
  }, [nextCronDate, scheduleTimeZone, settingsQuery.isLoading])

  const volumesQuery = useServerDockerVolumes(
    formData.sourceKind === "server" && formData.sourceType === "docker_volume"
      ? formData.serverId
      : ""
  )
  const localVolumesQuery = useLocalDockerVolumes(
    formData.sourceKind === "local" && formData.sourceType === "docker_volume"
  )
  const activeVolumesQuery =
    formData.sourceKind === "local" ? localVolumesQuery : volumesQuery

  const showDbContainerPicker =
    (formData.sourceKind === "server" || formData.sourceKind === "local") &&
    formData.sourceType === "database" &&
    formData.dbClient === "docker"

  const containersQuery = useServerDockerContainers(
    formData.serverId,
    showDbContainerPicker && formData.sourceKind === "server"
  )
  const localContainersQuery = useLocalDockerContainers(
    showDbContainerPicker && formData.sourceKind === "local"
  )
  const activeContainersQuery =
    formData.sourceKind === "local" ? localContainersQuery : containersQuery

  const sourceServer = servers.find((s) => s.id === formData.serverId)
  const destServer = servers.find((s) => s.id === formData.destinationServerId)

  useEffect(() => {
    if (!autoSuggestDestination || destinationTouched) {
      return
    }
    if (formData.destinationKind !== "local") {
      return
    }

    const destinationOptions = {
      destinationKind: formData.destinationKind,
      destinationServerId: formData.destinationServerId || null,
      destinationS3ProfileId: formData.destinationS3ProfileId || null,
      destinationPeerId: formData.destinationPeerId || null,
    }
    const makeUnique = (base: string) => {
      let candidate = base
      let suffix = 2
      while (
        backupsQuery.data &&
        findExactConflictInList(
          backupsQuery.data,
          candidate,
          excludeBackupId,
          destinationOptions
        )
      ) {
        candidate = `${base}-${suffix}`
        suffix += 1
        if (suffix > 100) break
      }
      return candidate
    }

    if (formData.sourceKind === "git") {
      const repo = gitRepos.find((r) => r.id === formData.sourceGitRepoId)
      const slug = slugifyName(repo?.name || formData.name || "repo")
      const suggested = makeUnique(`${storageRoot}/git/${slug}`)
      setFormData((prev) =>
        prev.destinationPath === suggested ? prev : { ...prev, destinationPath: suggested }
      )
      return
    }
    if (!formData.name.trim()) {
      return
    }
    const base = suggestDestinationPath({
      serverName:
        sourceServer?.name || (formData.sourceKind === "local" ? "local" : "server"),
      backupName: formData.name,
      storageRoot,
    })
    const suggested = makeUnique(base)
    setFormData((prev) =>
      prev.destinationPath === suggested ? prev : { ...prev, destinationPath: suggested }
    )
  }, [
    autoSuggestDestination,
    destinationTouched,
    formData.destinationKind,
    formData.name,
    formData.sourceKind,
    formData.sourceGitRepoId,
    formData.destinationServerId,
    formData.destinationS3ProfileId,
    formData.destinationPeerId,
    sourceServer?.name,
    gitRepos,
    backupsQuery.data,
    excludeBackupId,
    storageRoot,
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
        destinationS3ProfileId: formData.destinationS3ProfileId || null,
        destinationPeerId: formData.destinationPeerId || null,
      }
    )
  }, [
    backupsQuery.data,
    formData.destinationPath,
    formData.destinationKind,
    formData.destinationServerId,
    formData.destinationS3ProfileId,
    formData.destinationPeerId,
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
        destinationS3ProfileId: formData.destinationS3ProfileId || null,
        destinationPeerId: formData.destinationPeerId || null,
      }
    )
  }, [
    backupsQuery.data,
    formData.destinationPath,
    formData.destinationKind,
    formData.destinationServerId,
    formData.destinationS3ProfileId,
    formData.destinationPeerId,
    excludeBackupId,
  ])

  const summary = `${endpointLabel(
    formData.sourceKind,
    formData.serverId,
    servers,
    formData.sourceS3ProfileId,
    s3Profiles,
    "",
    activePeers,
    formData.sourceType === "docker_volume"
      ? `volume:${formData.sourcePath || "…"}`
      : formData.sourceType === "database"
        ? `db:${formData.sourcePath || "…"}`
        : formData.sourceType === "lazybackup_instance"
          ? "LazyBackup data"
          : formData.sourceType === "git_repo"
            ? "mirror"
            : formData.sourcePath || "…",
    formData.sourceGitRepoId,
    gitRepos
  )} → ${endpointLabel(
    formData.destinationKind,
    formData.destinationServerId,
    servers,
    formData.destinationS3ProfileId,
    s3Profiles,
    formData.destinationPeerId,
    activePeers,
    formData.destinationPath || "…"
  )}`

  const canSwap =
    formData.sourceType === "path" &&
    formData.sourceKind !== "git" &&
    formData.destinationKind !== "peer" &&
    !(
      formData.sourceKind === formData.destinationKind &&
      formData.serverId === formData.destinationServerId &&
      formData.sourceS3ProfileId === formData.destinationS3ProfileId
    )

  const swapUnavailableReason = canSwap
    ? null
    : formData.sourceKind === "git"
      ? "Git sources cannot be swapped."
      : formData.destinationKind === "peer"
        ? "Bro destinations cannot be swapped."
        : formData.sourceType !== "path"
          ? "Swap is only available for filesystem path sources."
          : "Source and destination are the same endpoint."

  const destinationConflictPath = destinationConflict
    ? backupsQuery.data?.find((backup) => backup.id === destinationConflict.id)?.destinationPath
    : undefined

  const localDestinationOutsideRoot = Boolean(
    formData.destinationKind === "local" &&
      formData.destinationPath.trim() &&
      storageRootLoaded &&
      !storageRootQuery.data?.allowArbitraryLocalPaths &&
      !isLocalPathInsideStorageRoots(formData.destinationPath, allowedStorageRoots)
  )

  const instanceDestinationNeedsPassphrase =
    formData.sourceType === "lazybackup_instance" &&
    (formData.destinationKind !== "local" ||
      (storageRootLoaded &&
        !isLocalPathInsideStorageRoots(formData.destinationPath, allowedStorageRoots)))

  const instancePassphraseMissing =
    instanceDestinationNeedsPassphrase &&
    !formData.instanceBackupPassphrase.trim() &&
    !formData.hasInstanceBackupPassphrase

  const passphraseMismatch =
    formData.sourceType === "lazybackup_instance" &&
    Boolean(formData.instanceBackupPassphrase) &&
    passphraseConfirm !== formData.instanceBackupPassphrase

  const encryptionForcedOn = formData.destinationKind === "peer"
  const encryptionNeedsKey =
    formData.sourceType !== "lazybackup_instance" &&
    (formData.enableEncryption || encryptionForcedOn) &&
    !encryption.isLoading &&
    Boolean(encryption.status) &&
    !encryption.status?.configured

  const fieldError = (key: string) => apiFieldErrors[key]

  function fieldElementId(field: string): string | null {
    switch (field) {
      case "name":
        return "name"
      case "schedule":
        return "schedule"
      case "sourcePath":
        return formData.sourceType === "database"
          ? "db-name"
          : formData.sourceType === "docker_volume"
            ? "from-volume"
            : "from-path"
      case "destinationPath":
        return "to-path"
      case "serverId":
        return "from-server-select"
      case "sourceS3ProfileId":
        return "from-s3-select"
      case "sourceGitRepoId":
        return "from-git-select"
      case "destinationServerId":
        return "to-server-select"
      case "destinationS3ProfileId":
        return "to-s3-select"
      case "destinationPeerId":
        return "to-peer-select"
      case "sourceType":
        return "from-source-type"
      case "sourceKind":
        return "from-local"
      case "destinationKind":
        return "to-local"
      case "dbEngine":
        return "db-engine"
      case "dbClient":
        return "db-client"
      case "dbContainer":
        return "db-container"
      case "dbUser":
        return "db-user"
      case "dbPort":
        return "db-port"
      case "excludePatterns":
        return "excludePatterns"
      case "preBackupCommands":
        return "preBackupCommands"
      case "instanceBackupPassphrase":
        return "instanceBackupPassphrase"
      case "enableFileRetention":
        return "enableFileRetention"
      case "versionsToKeep":
        return "versionsToKeep"
      case "retentionMaxAge":
        return "retentionMaxAge"
      case "retentionMinKeep":
        return "retentionMinKeep"
      default:
        return null
    }
  }

  function fieldLabel(field: string): string {
    const labels: Record<string, string> = {
      name: "Backup name",
      schedule: "Schedule",
      sourcePath:
        formData.sourceType === "database"
          ? formData.dbEngine === "sqlite"
            ? "SQLite file path"
            : "Database name"
          : formData.sourceType === "docker_volume"
            ? "Docker volume"
            : "Source path",
      destinationPath: "Destination path",
      serverId: "Source server",
      sourceS3ProfileId: "Source S3 profile",
      sourceGitRepoId: "Git repository",
      destinationServerId: "Destination server",
      destinationS3ProfileId: "Destination S3 profile",
      destinationPeerId: "Bro peer",
      sourceType: "Source type",
      sourceKind: "Source kind",
      destinationKind: "Destination kind",
      dbEngine: "Database engine",
      dbClient: "Database client",
      dbContainer: "Database container",
      dbUser: "Database user",
      dbPort: "Database port",
      excludePatterns: "Exclude patterns",
      preBackupCommands: "Pre-backup commands",
      instanceBackupPassphrase: "Archive passphrase",
      enableFileRetention: "File retention",
      retentionMaxAge: "Retention max age",
      retentionMinKeep: "Retention min keep",
      versionsToKeep: "Versions to keep",
    }
    return labels[field] || field
  }

  function focusFirstInvalidField(errors: Record<string, string>) {
    for (const field of Object.keys(errors)) {
      const id = fieldElementId(field)
      if (!id) continue
      const element = document.getElementById(id)
      if (element) {
        element.focus()
        element.scrollIntoView({ block: "center" })
        return
      }
    }
  }

  function rememberSourcePath(data: BackupFormData) {
    if (data.sourceKind === "s3" || data.sourceKind === "git") return
    if (data.sourceType === "lazybackup_instance" || data.sourceType === "git_repo") return
    sourcePathMemory.current[data.sourceType] = data.sourcePath
  }

  function updateField<K extends keyof BackupFormData>(key: K, value: BackupFormData[K]) {
    setApiError(null)
    setApiFieldErrors({})
    setFormData((prev) => {
      const next = { ...prev, [key]: value }
      if (key === "sourceKind" && value !== prev.sourceKind) {
        rememberSourcePath(prev)
        const nextKind = value as SourceKind
        next.serverId = nextKind === "server" ? prev.serverId : ""
        next.sourceS3ProfileId = nextKind === "s3" ? prev.sourceS3ProfileId : ""
        next.sourceGitRepoId = nextKind === "git" ? prev.sourceGitRepoId : ""
        if (nextKind === "s3") {
          next.sourceType = "path"
          next.sourcePath = normalizePrefixPath(
            sourcePathMemory.current.path ??
              (prev.sourceType === "path" && prev.sourceKind !== "s3"
                ? prev.sourcePath
                : "")
          )
          next.deleteExtraneous = false
        } else if (nextKind === "git") {
          next.sourceType = "git_repo"
          next.sourcePath = "git-mirror"
          next.deleteExtraneous = false
        } else if (prev.sourceKind === "s3" || prev.sourceKind === "git") {
          next.sourceType = "path"
          next.sourcePath = sourcePathMemory.current.path ?? ""
        } else if (prev.sourceType === "lazybackup_instance") {
          next.sourceType = "path"
          next.sourcePath = sourcePathMemory.current.path ?? ""
        }
        if (
          (nextKind === "local" || nextKind === "server") &&
          (prev.sourceKind === "local" || prev.sourceKind === "server") &&
          next.sourceType === "docker_volume"
        ) {
          // Volumes differ per Docker daemon; never carry one across hosts.
          next.sourcePath = ""
          sourcePathMemory.current.docker_volume = ""
        }
        if (next.sourceType !== "path") {
          next.deleteExtraneous = false
        }
        if (next.sourceType === "database" && next.dbClient === "docker") {
          next.dbContainer = ""
        }
      }
      if (key === "destinationKind" && value !== prev.destinationKind) {
        const nextKind = value as EndpointKind
        next.destinationServerId = nextKind === "server" ? prev.destinationServerId : ""
        next.destinationS3ProfileId = nextKind === "s3" ? prev.destinationS3ProfileId : ""
        next.destinationPeerId = nextKind === "peer" ? prev.destinationPeerId : ""
        if (nextKind === "peer") {
          prePeerEncryption.current = prev.enableEncryption
          prePeerDeleteExtraneous.current = prev.deleteExtraneous
          next.enableEncryption = true
          next.deleteExtraneous = false
          next.destinationPath = normalizePrefixPath(prev.destinationPath) || "backups"
        } else {
          if (prev.destinationKind === "peer") {
            next.enableEncryption = prePeerEncryption.current
            next.deleteExtraneous = prePeerDeleteExtraneous.current
            if (
              (nextKind === "local" || nextKind === "server") &&
              next.destinationPath &&
              !next.destinationPath.startsWith("/")
            ) {
              next.destinationPath = `/${next.destinationPath}`
            }
          }
          if (
            nextKind === "local" &&
            prev.destinationKind === "s3" &&
            next.destinationPath &&
            !next.destinationPath.startsWith("/")
          ) {
            next.destinationPath = `/${next.destinationPath}`
          }
          if (nextKind === "s3") {
            next.destinationPath = normalizePrefixPath(prev.destinationPath)
            next.deleteExtraneous = false
          }
        }
      }
      if (
        key === "destinationPath" &&
        (prev.destinationKind === "s3" || prev.destinationKind === "peer")
      ) {
        next.destinationPath = normalizePrefixPath(value as string)
      }
      if (key === "sourcePath" && prev.sourceKind === "s3") {
        next.sourcePath = normalizePrefixPath(value as string)
      }
      if (key === "enableEncryption" && value === true) {
        next.deleteExtraneous = false
      }
      if (key === "sourceType" && value !== prev.sourceType) {
        rememberSourcePath(prev)
        const nextType = value as BackupFormData["sourceType"]
        if (nextType === "lazybackup_instance") {
          next.sourceKind = "local"
          next.serverId = ""
          next.sourceS3ProfileId = ""
          next.sourceGitRepoId = ""
          next.sourcePath = "lazybackup-instance"
          next.enableEncryption = false
          if (next.destinationKind === "peer") {
            next.destinationKind = "local"
            next.destinationPeerId = ""
            if (next.destinationPath && !next.destinationPath.startsWith("/")) {
              next.destinationPath = `/${next.destinationPath}`
            }
          }
          if (!next.name) next.name = "LazyBackup instance"
          if (!next.destinationPath) {
            next.destinationPath =
              next.destinationKind === "s3" ? "backups/_lazybackup" : "/backups/_lazybackup"
          }
        } else if (nextType === "git_repo") {
          next.sourcePath = "git-mirror"
        } else if (nextType === "path" && prev.sourceKind === "s3") {
          next.sourcePath = normalizePrefixPath(prev.sourcePath)
        } else {
          next.sourcePath = sourcePathMemory.current[nextType] ?? ""
        }
        if (nextType === "database") {
          if (!next.dbHost) next.dbHost = "127.0.0.1"
          if (!next.dbEngine) next.dbEngine = "postgres"
          if (!next.dbClient) next.dbClient = "native"
        }
        if (nextType !== "path") {
          next.deleteExtraneous = false
        }
      }
      if (key === "dbEngine" && value === "sqlite") {
        next.dbClient = "native"
        next.dbContainer = ""
      }
      if (
        key === "serverId" &&
        value !== prev.serverId &&
        next.sourceType === "database"
      ) {
        next.dbContainer = ""
      }
      if (
        key === "serverId" &&
        value !== prev.serverId &&
        next.sourceType === "docker_volume"
      ) {
        next.sourcePath = ""
        sourcePathMemory.current.docker_volume = ""
      }
      return next
    })
  }

  function handleSwap() {
    if (!canSwap) {
      return
    }
    setDestinationTouched(true)
    setFormData((prev) => {
      const nextDestinationKind: EndpointKind =
        prev.destinationKind === "peer" || prev.sourceKind === "git"
          ? "local"
          : prev.sourceKind
      return {
        ...prev,
        sourceKind: prev.destinationKind,
        serverId: prev.destinationKind === "server" ? prev.destinationServerId : "",
        sourceS3ProfileId:
          prev.destinationKind === "s3" ? prev.destinationS3ProfileId : "",
        sourceGitRepoId: "",
        destinationKind: nextDestinationKind,
        destinationServerId: prev.sourceKind === "server" ? prev.serverId : "",
        destinationS3ProfileId: prev.sourceKind === "s3" ? prev.sourceS3ProfileId : "",
        destinationPeerId: "",
        sourcePath: prev.destinationPath,
        destinationPath: prev.sourcePath,
      }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setApiError(null)
    setApiFieldErrors({})
    if (destinationConflict) {
      toast.error(`Destination is already used by "${destinationConflict.name}"`)
      return
    }
    if (cronInvalid) {
      toast.error("Fix the schedule: enter a valid 5-field cron expression")
      document.getElementById("schedule")?.focus()
      return
    }
    if (formData.sourceKind === "server" && !formData.serverId) {
      toast.error("Select a source server")
      document.getElementById("from-server-select")?.focus()
      return
    }
    if (formData.sourceKind === "git" && !formData.sourceGitRepoId) {
      toast.error("Select a Git repository")
      document.getElementById("from-git-select")?.focus()
      return
    }
    if (formData.destinationKind === "server" && !formData.destinationServerId) {
      toast.error("Select a destination server")
      document.getElementById("to-server-select")?.focus()
      return
    }
    if (formData.destinationKind === "s3" && !formData.destinationS3ProfileId) {
      toast.error("Select a destination S3 profile")
      document.getElementById("to-s3-select")?.focus()
      return
    }
    if (formData.destinationKind === "peer" && !formData.destinationPeerId) {
      toast.error("Select a bro peer (Settings → Bro Space)")
      document.getElementById("to-peer-select")?.focus()
      return
    }
    if (instancePassphraseMissing) {
      toast.error("Add an archive passphrase for non-local instance backups")
      document.getElementById("instanceBackupPassphrase")?.focus()
      return
    }
    if (passphraseMismatch) {
      toast.error("Passphrase confirmation does not match")
      document.getElementById("instanceBackupPassphraseConfirm")?.focus()
      return
    }
    try {
      await onSubmit(formData)
    } catch (error) {
      if (error instanceof ApiError) {
        setApiError(error.message)
        setApiFieldErrors(error.fieldErrors)
        toast.error(error.message)
        focusFirstInvalidField(error.fieldErrors)
        return
      }
      const message =
        error instanceof Error ? error.message : "Could not save the backup"
      setApiError(message)
      toast.error(message)
    }
  }


  async function handleTestDatabase() {
    if (formData.sourceKind === "server" && !formData.serverId) {
      toast.error("Select a source server first")
      return
    }
    if (
      !formData.sourcePath.trim() ||
      (formData.dbEngine !== "sqlite" && !formData.dbUser.trim())
    ) {
      toast.error(
        formData.dbEngine === "sqlite"
          ? "SQLite file path is required"
          : "Database name and user are required"
      )
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
          backupId: excludeBackupId,
          useStoredPassword: Boolean(formData.hasDbPassword && !formData.dbPassword.trim()),
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

  async function applyContainerDbHints(containerName: string) {
    const hintSource =
      formData.sourceKind === "local" ? "local" : formData.serverId
    if (!hintSource || !containerName) return
    setFillingContainerHints(true)
    try {
      const hints = await fetchContainerDbHints(hintSource, containerName)
      const prev = formDataRef.current
      const next = { ...prev, dbContainer: containerName }
      const applied: Array<keyof BackupFormData> = []
      const undo: Partial<BackupFormData> = {}
      const fill = <K extends keyof BackupFormData>(key: K, value: BackupFormData[K]) => {
        const current = prev[key]
        if (current !== "" && current != null) return
        next[key] = value
        applied.push(key)
        undo[key] = current
      }
      if (hints.engine && hints.engine !== prev.dbEngine) {
        next.dbEngine = hints.engine
        applied.push("dbEngine")
        undo.dbEngine = prev.dbEngine
      }
      if (hints.user) fill("dbUser", hints.user)
      if (hints.password) fill("dbPassword", hints.password)
      if (hints.database) fill("sourcePath", hints.database)
      if (
        hints.host &&
        (!prev.dbHost || prev.dbHost === "127.0.0.1") &&
        hints.host !== prev.dbHost
      ) {
        next.dbHost = hints.host
        applied.push("dbHost")
        undo.dbHost = prev.dbHost
      }
      if (hints.port != null) fill("dbPort", String(hints.port))
      setFormData(next)
      if (hints.found) {
        const filledCount = applied.filter((key) => key !== "dbEngine").length
        toast.success(
          filledCount > 0
            ? `Filled ${filledCount} empty connection field${filledCount === 1 ? "" : "s"} from container env`
            : "Container selected — connection fields already filled",
          applied.length > 0
            ? {
                action: {
                  label: "Undo",
                  onClick: () =>
                    setFormData((current) => ({
                      ...current,
                      ...undo,
                      dbContainer: containerName,
                    })),
                },
              }
            : undefined
        )
      } else {
        toast.message("No DB env vars found — fill fields manually")
      }
    } catch (err) {
      setFormData((prev) => ({ ...prev, dbContainer: containerName }))
      toast.error(
        err instanceof Error ? err.message : "Could not inspect container"
      )
    } finally {
      setFillingContainerHints(false)
    }
  }

  function handleNumberInput(
    key: "versionsToKeep" | "retentionMaxAge" | "retentionMinKeep",
    raw: string
  ) {
    setNumberInputs((prev) => ({ ...prev, [key]: raw }))
    const parsed = Number(raw)
    if (raw.trim() !== "" && Number.isFinite(parsed) && parsed >= 1) {
      updateField(key, Math.trunc(parsed))
    }
  }

  function commitNumberInput(
    key: "versionsToKeep" | "retentionMaxAge" | "retentionMinKeep",
    min: number,
    max: number
  ) {
    const raw = numberInputs[key]
    const parsed = Number(raw)
    const fallback = formData[key]
    const value =
      raw.trim() === "" || !Number.isFinite(parsed)
        ? fallback
        : Math.min(max, Math.max(min, Math.trunc(parsed)))
    setNumberInputs((prev) => ({ ...prev, [key]: String(value) }))
    if (value !== formData[key]) {
      setFormData((prev) => ({ ...prev, [key]: value }))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {apiError && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="h-4 w-4" />
          <AlertTitle>Could not save backup</AlertTitle>
          <AlertDescription>
            <p>{apiError}</p>
            {Object.keys(apiFieldErrors).length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {Object.entries(apiFieldErrors).map(([field, message]) => (
                  <li key={field}>
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => {
                        const id = fieldElementId(field)
                        if (id) document.getElementById(id)?.focus()
                      }}
                    >
                      {fieldLabel(field)}
                    </button>
                    : {message}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

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
          aria-invalid={Boolean(fieldError("name"))}
        />
        <FieldError message={fieldError("name")} />
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
            title={swapUnavailableReason || "Swap source and destination"}
          >
            <ArrowLeftRightIcon className="h-4 w-4 mr-1" />
            Swap
          </Button>
        </div>
        {swapUnavailableReason && (
          <p className="text-xs text-muted-foreground">
            Swap unavailable: {swapUnavailableReason}
          </p>
        )}

        <div className="flex flex-col lg:flex-row items-stretch gap-3">
          <EndpointPanel
            title="From"
            kind={formData.sourceKind}
            onKindChange={(k) => updateField("sourceKind", k)}
            isSource
            allowPeer={false}
            serverId={formData.serverId}
            onServerChange={(id) => updateField("serverId", id)}
            servers={servers}
            s3ProfileId={formData.sourceS3ProfileId}
            onS3ProfileChange={(id) => updateField("sourceS3ProfileId", id)}
            s3Profiles={s3Profiles}
            s3ProfilesQuery={s3ProfilesQuery}
            gitRepoId={formData.sourceGitRepoId}
            onGitRepoChange={(id) => updateField("sourceGitRepoId", id)}
            gitRepos={gitRepos}
            gitReposQuery={gitReposQuery}
            peerId=""
            onPeerChange={() => {}}
            activePeers={[]}
            peersQuery={peersQuery}
            sourceType={formData.sourceType}
            onSourceTypeChange={(type) => updateField("sourceType", type)}
            path={formData.sourcePath}
            onPathChange={(p) => updateField("sourcePath", p)}
            volumesQuery={activeVolumesQuery}
            fieldErrors={apiFieldErrors}
            idPrefix="from"
          />

          <div className="flex lg:flex-col items-center justify-center shrink-0 py-1">
            <ArrowRightIcon className="h-5 w-5 text-muted-foreground rotate-90 lg:rotate-0" />
          </div>

          <EndpointPanel
            title="To"
            kind={formData.destinationKind}
            onKindChange={(k) => updateField("destinationKind", k as EndpointKind)}
            isSource={false}
            allowPeer={formData.sourceType !== "lazybackup_instance"}
            serverId={formData.destinationServerId}
            onServerChange={(id) => updateField("destinationServerId", id)}
            servers={servers}
            s3ProfileId={formData.destinationS3ProfileId}
            onS3ProfileChange={(id) => updateField("destinationS3ProfileId", id)}
            s3Profiles={s3Profiles}
            s3ProfilesQuery={s3ProfilesQuery}
            gitRepoId=""
            onGitRepoChange={() => {}}
            gitRepos={[]}
            gitReposQuery={gitReposQuery}
            peerId={formData.destinationPeerId}
            onPeerChange={(id) => updateField("destinationPeerId", id)}
            activePeers={activePeers}
            peersQuery={peersQuery}
            sourceType={formData.sourceType}
            onSourceTypeChange={(type) => updateField("sourceType", type)}
            path={formData.destinationPath}
            onPathChange={(p) => {
              setDestinationTouched(true)
              updateField("destinationPath", p)
            }}
            volumesQuery={activeVolumesQuery}
            fieldErrors={apiFieldErrors}
            idPrefix="to"
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
            {formData.hasDbPassword && !formData.dbPassword.trim() && (
              <p className="text-xs text-muted-foreground">
                Testing uses the password stored with this backup; nothing is sent from
                the browser.
              </p>
            )}
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
                      e.target.value as "postgres" | "mysql" | "mariadb" | "sqlite"
                    )
                  }
                  aria-invalid={Boolean(fieldError("dbEngine"))}
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                  <option value="sqlite">SQLite</option>
                </select>
                <FieldError message={fieldError("dbEngine")} />
              </div>
              {formData.dbEngine !== "sqlite" && (
              <>
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
                  aria-invalid={Boolean(fieldError("dbClient"))}
                >
                  <option value="native">Native (pg_dump / mysqldump on host)</option>
                  <option value="docker">Docker exec (into container)</option>
                </select>
                <FieldError message={fieldError("dbClient")} />
              </div>
              {formData.dbClient === "docker" && (
                <div className="space-y-2 sm:col-span-2">
                  {showDbContainerPicker ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-xs text-muted-foreground"
                          htmlFor="db-container"
                        >
                          Container
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          disabled={
                            (formData.sourceKind === "server" && !formData.serverId) ||
                            activeContainersQuery.isFetching ||
                            fillingContainerHints
                          }
                          onClick={() => activeContainersQuery.refetch()}
                        >
                          {activeContainersQuery.isFetching ? (
                            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCwIcon className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1">Refresh</span>
                        </Button>
                      </div>
                      <select
                        id="db-container"
                        className={inputClass}
                        value={formData.dbContainer}
                        onChange={(e) => {
                          const name = e.target.value
                          if (!name) {
                            updateField("dbContainer", "")
                            return
                          }
                          void applyContainerDbHints(name)
                        }}
                        required
                        disabled={
                          (formData.sourceKind === "server" && !formData.serverId) ||
                          activeContainersQuery.isLoading ||
                          fillingContainerHints
                        }
                        aria-invalid={Boolean(fieldError("dbContainer"))}
                      >
                        <option value="">
                          {formData.sourceKind === "server" && !formData.serverId
                            ? "Select a server first"
                            : activeContainersQuery.isLoading
                              ? "Loading containers…"
                              : fillingContainerHints
                                ? "Reading container…"
                                : "Select a container"}
                        </option>
                        {formData.dbContainer &&
                          activeContainersQuery.data &&
                          !activeContainersQuery.data.includes(formData.dbContainer) && (
                            <option value={formData.dbContainer}>
                              {formData.dbContainer} (current)
                            </option>
                          )}
                        {(activeContainersQuery.data || []).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      {activeContainersQuery.isError && (
                        <Alert variant="destructive">
                          <AlertTriangleIcon className="h-4 w-4" />
                          <AlertTitle>Could not list containers</AlertTitle>
                          <AlertDescription>
                            {activeContainersQuery.error instanceof Error
                              ? activeContainersQuery.error.message
                              : "Failed to load Docker containers"}
                          </AlertDescription>
                        </Alert>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Selecting a container fills empty connection fields from its env
                        when possible. Existing values are kept; Undo is offered.
                      </p>
                    </>
                  ) : (
                    <>
                      <label
                        className="text-xs text-muted-foreground"
                        htmlFor="db-container"
                      >
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
                        aria-invalid={Boolean(fieldError("dbContainer"))}
                      />
                    </>
                  )}
                  <FieldError message={fieldError("dbContainer")} />
                </div>
              )}
              </>
              )}
              {formData.dbEngine !== "sqlite" && (
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
                      aria-invalid={Boolean(fieldError("dbHost"))}
                    />
                    <FieldError message={fieldError("dbHost")} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground" htmlFor="db-port">
                      Port (optional)
                    </label>
                    <input
                      id="db-port"
                      type="number"
                      min={1}
                      max={65535}
                      className={inputClass}
                      value={formData.dbPort}
                      onChange={(e) => updateField("dbPort", e.target.value)}
                      placeholder={formData.dbEngine === "postgres" ? "5432" : "3306"}
                      aria-invalid={Boolean(fieldError("dbPort"))}
                    />
                    <FieldError message={fieldError("dbPort")} />
                  </div>
                  {formData.dbClient === "docker" && (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Host is the address as seen from inside the container. Leave
                      127.0.0.1 when dumping from the database container itself; use a
                      docker-network hostname or VPS private IP when the tools talk to a
                      DB elsewhere.
                    </p>
                  )}
                </>
              )}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground" htmlFor="db-name">
                  {formData.dbEngine === "sqlite" ? "SQLite file path" : "Database name"}
                </label>
                <input
                  id="db-name"
                  type="text"
                  className={inputClass}
                  value={formData.sourcePath}
                  onChange={(e) => updateField("sourcePath", e.target.value)}
                  placeholder={formData.dbEngine === "sqlite" ? "/var/lib/app/data.db" : "app"}
                  required
                  spellCheck={false}
                  aria-invalid={Boolean(fieldError("sourcePath"))}
                />
                <FieldError message={fieldError("sourcePath")} />
              </div>
              {formData.dbEngine !== "sqlite" && (
              <>
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
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("dbUser"))}
                />
                <FieldError message={fieldError("dbUser")} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground" htmlFor="db-password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="db-password"
                    type={showDbPassword ? "text" : "password"}
                    className={`${inputClass} pr-16`}
                    value={formData.dbPassword}
                    onChange={(e) => updateField("dbPassword", e.target.value)}
                    placeholder={
                      formData.hasDbPassword ? "Leave blank to keep existing" : undefined
                    }
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 text-xs text-muted-foreground underline underline-offset-2"
                    onClick={() => setShowDbPassword((value) => !value)}
                    aria-pressed={showDbPassword}
                  >
                    {showDbPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {formData.hasDbPassword && (
                  <p className="text-xs text-muted-foreground">
                    A password is stored. Leave blank to keep it.
                  </p>
                )}
                <FieldError message={fieldError("dbPassword")} />
              </div>
              </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formData.dbEngine === "sqlite"
                ? "Copies the SQLite file (sqlite3 .backup when available) and gzips it to .sqlite.gz. Native only."
                : `Dumps a logical .sql.gz via ${
                    formData.dbEngine === "postgres" ? "pg_dump" : "mysqldump"
                  }${
                    formData.dbClient === "docker"
                      ? " inside the container"
                      : " on the source host"
                  }. Prefer this over Docker volume backups for live databases.`}
            </p>
          </div>
        )}

        {formData.destinationKind === "local" && (
          <p className="text-xs text-muted-foreground">
            Local destinations live on the LazyBackup host
            {storageRootLoaded ? (
              <>
                {" "}
                under <code>{storageRoot}</code>
              </>
            ) : null}
            {autoSuggestDestination ? " (suggested automatically until you edit it)" : ""}.
          </p>
        )}
        {localDestinationOutsideRoot && (
          <Alert>
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Local destination is outside the storage root</AlertTitle>
            <AlertDescription>
              This path is not under <code>{storageRoot}</code>. The backup will fail at
              run time unless <code>ALLOW_ARBITRARY_LOCAL_PATHS=true</code> is set on the
              server.
            </AlertDescription>
          </Alert>
        )}
        {formData.destinationKind === "server" && destServer && (
          <p className="text-xs text-muted-foreground">
            Files will be written on {destServer.name} ({destServer.host}).
          </p>
        )}
        {formData.destinationKind === "s3" && (
          <p className="text-xs text-muted-foreground">
            Objects are uploaded under the selected profile&apos;s bucket and prefix.
          </p>
        )}
        {formData.destinationKind === "peer" && (
          <p className="text-xs text-muted-foreground">
            Encryption is turned on automatically for Bro destinations; the previous
            encryption choice is restored when you leave Bro.
          </p>
        )}
        {instanceDestinationNeedsPassphrase && instancePassphraseMissing && (
          <Alert variant="destructive">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Archive passphrase required</AlertTitle>
            <AlertDescription>
              Instance backups to a non-local destination (or a local path outside the
              storage root) must be wrapped with a passphrase before they can run. Enter
              one in Archive passphrase below.
            </AlertDescription>
          </Alert>
        )}

        {destinationConflict && (
          <Alert variant="destructive">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Destination already in use</AlertTitle>
            <AlertDescription>
              Backup &quot;{destinationConflict.name}&quot; already uses{" "}
              <code>{destinationConflictPath || "this destination"}</code>.
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
        {pathJobUsesServerEndpoint({
          sourceType: formData.sourceType,
          sourceKind: formData.sourceKind,
          destinationKind: formData.destinationKind,
        }) &&
          ((sourceServer?.authType === "password" && formData.sourceKind === "server") ||
            (destServer?.authType === "password" && formData.destinationKind === "server")) && (
            <Alert>
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>SSH key required for path transfers</AlertTitle>
              <AlertDescription>
                Password-only servers can be tested and used for volume/container lists and
                database dumps. Path jobs (rsync/scp) need an SSH key on{" "}
                {[
                  sourceServer?.authType === "password" && formData.sourceKind === "server"
                    ? sourceServer.name
                    : null,
                  destServer?.authType === "password" && formData.destinationKind === "server"
                    ? destServer.name
                    : null,
                ]
                  .filter(Boolean)
                  .join(" and ")}
                .{" "}
                <Link href="/connections?tab=servers" className="underline underline-offset-2">
                  Edit the server
                </Link>{" "}
                to attach a key.
              </AlertDescription>
            </Alert>
          )}

        <div className="space-y-2">
          <label htmlFor="schedule" className="block text-sm font-medium">
            Schedule (cron)
          </label>
          <div className="flex flex-wrap gap-2">
            {cronPresets().map((preset) => {
              const active = formData.schedule.trim() === preset.expression
              return (
                <button
                  key={preset.expression}
                  type="button"
                  className={
                    active
                      ? "rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium"
                      : "rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
                  }
                  onClick={() => updateField("schedule", preset.expression)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          <input
            id="schedule"
            type="text"
            className={inputClass}
            value={formData.schedule}
            onChange={(e) => updateField("schedule", e.target.value)}
            required
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={cronInvalid}
            aria-describedby={cronInvalid ? "schedule-error" : undefined}
          />
          {cronInvalid ? (
            <p id="schedule-error" className="text-xs text-destructive" role="alert">
              Invalid 5-field cron expression. Use minute hour day-of-month month
              day-of-week, e.g. 0 2 * * *.
            </p>
          ) : (
            scheduleLabel !== formData.schedule.trim() && (
              <p className="text-xs text-muted-foreground">{scheduleLabel}</p>
            )
          )}
          <p className="text-xs text-muted-foreground">
            {!formData.enabled ? (
              <>Disabled — this schedule will not run.</>
            ) : !cronInvalid && nextRunPreview ? (
              <>
                Next run: {nextRunPreview}{" "}
                <span>
                  ({scheduleTimeZone} —{" "}
                  <Link href="/settings?tab=general" className="underline underline-offset-2">
                    change
                  </Link>
                  )
                </span>
              </>
            ) : (
              "No next run — fix the schedule above."
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Example: 0 2 * * * (daily at 02:00). Pick a chip or type a 5-field cron.
          </p>
        </div>

        {formData.sourceType !== "database" &&
          formData.sourceType !== "lazybackup_instance" &&
          formData.sourceType !== "git_repo" && (
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
              spellCheck={false}
              aria-invalid={Boolean(fieldError("excludePatterns"))}
            />
            <FieldError message={fieldError("excludePatterns")} />
          </div>
        )}

        {formData.sourceKind !== "s3" &&
          formData.sourceKind !== "git" &&
          formData.sourceType !== "lazybackup_instance" && (
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
              spellCheck={false}
              aria-invalid={Boolean(fieldError("preBackupCommands"))}
            />
            <FieldError message={fieldError("preBackupCommands")} />
          </div>
        )}

        {formData.sourceType === "lazybackup_instance" && (
          <div className="space-y-2">
            <label htmlFor="instanceBackupPassphrase" className="block text-sm font-medium">
              Archive passphrase{" "}
              {instanceDestinationNeedsPassphrase ? "(required for this destination)" : "(optional)"}
            </label>
            <div className="relative">
              <input
                id="instanceBackupPassphrase"
                type={showPassphrase ? "text" : "password"}
                className={`${inputClass} pr-16`}
                value={formData.instanceBackupPassphrase}
                onChange={(e) => updateField("instanceBackupPassphrase", e.target.value)}
                placeholder={
                  formData.hasInstanceBackupPassphrase
                    ? "Leave blank to keep existing passphrase"
                    : "age passphrase wrap for the archive"
                }
                autoComplete="new-password"
                aria-invalid={Boolean(
                  fieldError("instanceBackupPassphrase") ||
                    instancePassphraseMissing ||
                    passphraseMismatch
                )}
                aria-describedby={
                  instancePassphraseMissing || passphraseMismatch
                    ? "instance-passphrase-error"
                    : undefined
                }
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => setShowPassphrase((value) => !value)}
                aria-pressed={showPassphrase}
              >
                {showPassphrase ? "Hide" : "Show"}
              </button>
            </div>
            <FieldError
              id="instance-passphrase-error"
              message={
                fieldError("instanceBackupPassphrase") ||
                (instancePassphraseMissing
                  ? "Required for non-local instance backups."
                  : undefined)
              }
            />
            {(!formData.hasInstanceBackupPassphrase || formData.instanceBackupPassphrase) && (
              <div className="space-y-1">
                <label
                  htmlFor="instanceBackupPassphraseConfirm"
                  className="block text-sm font-medium"
                >
                  Confirm passphrase
                </label>
                <input
                  id="instanceBackupPassphraseConfirm"
                  type={showPassphrase ? "text" : "password"}
                  className={inputClass}
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.target.value)}
                  placeholder="Repeat the passphrase"
                  autoComplete="new-password"
                  aria-invalid={passphraseMismatch}
                  aria-describedby={
                    passphraseMismatch ? "instance-passphrase-confirm-error" : undefined
                  }
                />
                <FieldError
                  id="instance-passphrase-confirm-error"
                  message={passphraseMismatch ? "Passphrases do not match." : undefined}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Wraps the tarball with age passphrase encryption (not your instance age
              keys). There is no recovery if this passphrase is lost — store it in a
              password manager.
            </p>
          </div>
        )}

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

        {formData.sourceType !== "lazybackup_instance" && (
        <div className="space-y-1">
          <div className="flex items-start">
            <input
              id="enableEncryption"
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={formData.enableEncryption || encryptionForcedOn}
              disabled={encryptionForcedOn}
              onChange={(e) => updateField("enableEncryption", e.target.checked)}
            />
            <label htmlFor="enableEncryption" className="ml-2 block text-sm">
              Encrypt before storing (age)
              <span className="block text-xs text-muted-foreground">
                Destination only sees ciphertext. Always on for Bro destinations. Path
                backups become a single <code>.tar.gz.age</code> archive.
              </span>
            </label>
          </div>
          {encryptionNeedsKey && (
            <p className="pl-6 text-xs text-destructive" role="alert">
              No active age key is configured, so this backup will fail at run time.{" "}
              <Link href="/settings?tab=encryption" className="underline underline-offset-2">
                Create or import a key in Settings → Encryption
              </Link>
              .
            </p>
          )}
        </div>
        )}

        {formData.sourceType === "path" &&
          formData.sourceKind !== "s3" &&
          formData.destinationKind !== "s3" &&
          formData.destinationKind !== "peer" &&
          !formData.enableEncryption && (
        <div className="flex items-start">
          <input
            id="deleteExtraneous"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={formData.deleteExtraneous}
            onChange={(e) => updateField("deleteExtraneous", e.target.checked)}
          />
          <label htmlFor="deleteExtraneous" className="ml-2 block text-sm">
            Remove files at destination that were deleted at source
            <span className="block text-xs text-muted-foreground">
              Passes rsync <code>--delete</code> so the destination mirrors the source.
              Excluded paths are not deleted. No effect when versioning is on (each run is a new
              folder).
            </span>
          </label>
        </div>
        )}

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
              value={numberInputs.versionsToKeep}
              onChange={(e) => handleNumberInput("versionsToKeep", e.target.value)}
              onBlur={() => commitNumberInput("versionsToKeep", 1, 100)}
              aria-invalid={Boolean(fieldError("versionsToKeep"))}
            />
            <FieldError message={fieldError("versionsToKeep")} />
            <p className="text-xs text-muted-foreground">
              Keeps the newest N timestamped copies; older versions are deleted after a
              successful run.
            </p>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center">
            <input
              id="enableFileRetention"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={formData.enableFileRetention}
              disabled={formData.enableVersioning}
              onChange={(e) => updateField("enableFileRetention", e.target.checked)}
              aria-invalid={Boolean(fieldError("enableFileRetention"))}
            />
            <label htmlFor="enableFileRetention" className="ml-2 block text-sm">
              Enable file retention (age-based cleanup)
            </label>
          </div>
          {formData.enableVersioning && (
            <p className="pl-6 text-xs text-muted-foreground">
              Not available while versioning is on — versioning already prunes old
              timestamped folders.
            </p>
          )}
          <FieldError message={fieldError("enableFileRetention")} />
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
                  max={3650}
                  className={inputClass}
                  value={numberInputs.retentionMaxAge}
                  onChange={(e) => handleNumberInput("retentionMaxAge", e.target.value)}
                  onBlur={() => commitNumberInput("retentionMaxAge", 1, 3650)}
                  aria-invalid={Boolean(fieldError("retentionMaxAge"))}
                />
                <FieldError message={fieldError("retentionMaxAge")} />
                <p className="text-xs text-muted-foreground">
                  Delete backup archives older than this after a successful run (max 3650).
                </p>
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
                  max={10000}
                  className={inputClass}
                  value={numberInputs.retentionMinKeep}
                  onChange={(e) => handleNumberInput("retentionMinKeep", e.target.value)}
                  onBlur={() => commitNumberInput("retentionMinKeep", 1, 10000)}
                  aria-invalid={Boolean(fieldError("retentionMinKeep"))}
                />
                <FieldError message={fieldError("retentionMinKeep")} />
                <p className="text-xs text-muted-foreground">
                  Never delete the newest N backup archives, even if they are older than
                  max age.
                </p>
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
    sourceS3ProfileId: "",
    sourceGitRepoId: "",
    destinationKind: "local",
    destinationServerId: "",
    destinationS3ProfileId: "",
    destinationPeerId: "",
    sourceType: "path",
    sourcePath: "",
    destinationPath: "",
    schedule: "0 2 * * *",
    excludePatterns: "",
    preBackupCommands: "",
    dbEngine: "postgres",
    dbClient: "native",
    dbContainer: "",
    dbHost: "127.0.0.1",
    dbPort: "",
    dbUser: "",
    dbPassword: "",
    instanceBackupPassphrase: "",
    enabled: true,
    enableEncryption: false,
    deleteExtraneous: false,
    enableVersioning: false,
    versionsToKeep: 5,
    enableFileRetention: false,
    retentionMaxAge: 30,
    retentionMaxAgeUnit: "days",
    retentionMinKeep: 5,
  }
}

export function defaultInstanceBackupFormData(): BackupFormData {
  return {
    ...defaultCreateFormData(),
    name: "LazyBackup instance",
    sourceKind: "local",
    serverId: "",
    sourceType: "lazybackup_instance",
    sourcePath: "lazybackup-instance",
    destinationPath: "/backups/_lazybackup",
    enableEncryption: false,
  }
}

export function defaultGitBackupFormData(gitRepoId: string): BackupFormData {
  return {
    ...defaultCreateFormData(),
    sourceKind: "git",
    sourceType: "git_repo",
    sourceGitRepoId: gitRepoId,
    sourcePath: "git-mirror",
    // Left empty so the repo-based unique suggestion runs on the create page.
    destinationPath: "",
  }
}

/** Starter recipes for empty-state deep links (`?recipe=`). */
export const BACKUP_RECIPE_IDS = [
  "server-path-local",
  "volume-local",
  "database-local",
  "path-s3",
  "instance",
] as const

export type BackupRecipeId = (typeof BACKUP_RECIPE_IDS)[number]

export function isBackupRecipeId(value: string | null | undefined): value is BackupRecipeId {
  return BACKUP_RECIPE_IDS.includes(value as BackupRecipeId)
}

export function recipeFormData(recipe: BackupRecipeId): BackupFormData {
  switch (recipe) {
    case "server-path-local":
      return {
        ...defaultCreateFormData(),
        name: "Server path",
        sourceKind: "server",
        sourceType: "path",
        sourcePath: "/var/www",
        destinationKind: "local",
        destinationPath: "/backups",
        schedule: "0 2 * * *",
      }
    case "volume-local":
      return {
        ...defaultCreateFormData(),
        name: "Docker volume",
        sourceKind: "server",
        sourceType: "docker_volume",
        sourcePath: "",
        destinationKind: "local",
        destinationPath: "/backups",
        schedule: "0 2 * * *",
      }
    case "database-local":
      return {
        ...defaultCreateFormData(),
        name: "Database dump",
        sourceKind: "local",
        serverId: "",
        sourceType: "database",
        sourcePath: "postgres",
        destinationKind: "local",
        destinationPath: "/backups/databases",
        dbEngine: "postgres",
        dbClient: "native",
        dbHost: "127.0.0.1",
        schedule: "0 2 * * *",
      }
    case "path-s3":
      return {
        ...defaultCreateFormData(),
        name: "Path to S3",
        sourceKind: "local",
        serverId: "",
        sourceType: "path",
        sourcePath: "/data",
        destinationKind: "s3",
        destinationPath: "backups/",
        schedule: "0 3 * * *",
      }
    case "instance":
      return defaultInstanceBackupFormData()
  }
}

export function formDataToPayload(data: BackupFormData) {
  return {
    name: data.name,
    sourceKind: data.sourceKind,
    serverId: data.sourceKind === "server" ? data.serverId : null,
    sourceS3ProfileId: data.sourceKind === "s3" ? data.sourceS3ProfileId : null,
    sourceGitRepoId: data.sourceKind === "git" ? data.sourceGitRepoId : null,
    destinationKind: data.destinationKind,
    destinationServerId: data.destinationKind === "server" ? data.destinationServerId : null,
    destinationS3ProfileId:
      data.destinationKind === "s3" ? data.destinationS3ProfileId : null,
    destinationPeerId: data.destinationKind === "peer" ? data.destinationPeerId : null,
    sourceType: data.sourceType,
    sourcePath:
      data.sourceType === "lazybackup_instance"
        ? "lazybackup-instance"
        : data.sourceType === "git_repo"
          ? "git-mirror"
          : data.sourcePath,
    destinationPath: data.destinationPath,
    schedule: data.schedule,
    excludePatterns:
      data.sourceType === "database" ||
      data.sourceType === "lazybackup_instance" ||
      data.sourceType === "git_repo"
        ? undefined
        : data.excludePatterns || undefined,
    preBackupCommands:
      data.sourceKind === "s3" ||
      data.sourceKind === "git" ||
      data.sourceType === "lazybackup_instance"
        ? undefined
        : data.preBackupCommands || undefined,
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
    instanceBackupPassphrase:
      data.sourceType === "lazybackup_instance"
        ? data.instanceBackupPassphrase || null
        : null,
    enabled: data.enabled,
    enableEncryption:
      data.sourceType === "lazybackup_instance"
        ? false
        : data.destinationKind === "peer"
          ? true
          : data.enableEncryption,
    deleteExtraneous:
      data.sourceType === "path" &&
      data.sourceKind !== "s3" &&
      data.sourceKind !== "git" &&
      data.destinationKind !== "s3" &&
      data.destinationKind !== "peer" &&
      !data.enableEncryption &&
      data.deleteExtraneous,
    enableVersioning: data.enableVersioning,
    versionsToKeep: data.versionsToKeep,
    enableFileRetention: data.enableFileRetention,
    retentionMaxAge: data.retentionMaxAge,
    retentionMaxAgeUnit: data.retentionMaxAgeUnit,
    retentionMinKeep: data.retentionMinKeep,
  }
}
