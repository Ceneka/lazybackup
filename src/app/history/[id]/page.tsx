"use client"

import { HistoryDownloadButton } from "@/components/history-download-button"
import {
  HistoryRestoreButton,
  type HistoryRestoreResult,
} from "@/components/history-restore-button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  DetailActionButton,
  DetailActionLink,
  DetailActions,
  DetailActionsDivider,
  detailActionDestructiveClassName,
} from "@/components/ui/detail-actions"
import { QueryState } from "@/components/ui/query-state"
import {
  destinationEndpointName,
  sourceEndpointName,
  sourcePathLabel,
} from "@/lib/backup/endpoint-display"
import { splitBackupLog } from "@/lib/backup/log-format"
import {
  canRestoreBackup,
  restoreBlockedReason,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import { copyToClipboard } from "@/lib/clipboard"
import { formatCount, formatDuration } from "@/lib/format/duration"
import { useDeleteHistory, useHistoryDetail } from "@/lib/hooks/useHistory"
import { cn, formatBytes } from "@/lib/utils"
import { format } from "date-fns"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  HardDriveIcon,
  HistoryIcon,
  RotateCcwIcon,
  ServerIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

function runStatusBadge(status: string) {
  if (status === "running") {
    return (
      <Badge variant="info" className="gap-1">
        <ClockIcon className="h-3 w-3" aria-hidden />
        running
      </Badge>
    )
  }
  if (status === "success") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2Icon className="h-3 w-3" aria-hidden />
        success
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge
        variant="destructive"
        className="gap-1 border-transparent bg-red-500/15 text-red-700 ring-1 ring-inset ring-red-500/30 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/25"
      >
        <XCircleIcon className="h-3 w-3" aria-hidden />
        failed
      </Badge>
    )
  }
  return <Badge variant="muted">{status}</Badge>
}

function statusBadge(status: string, mailboxPending?: boolean) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {runStatusBadge(status)}
      {mailboxPending ? (
        <Badge variant="warning" className="gap-1">
          <ClockIcon className="h-3 w-3" aria-hidden />
          waiting for bro
        </Badge>
      ) : null}
    </div>
  )
}

function safeHistoryReturnTo(value: string | null): string {
  if (!value || !/^\/history(?:[/?#]|$)/.test(value)) return "/history"
  return value
}

export default function HistoryDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const query = useHistoryDetail(id)
  const { mutate: deleteHistory, isPending: isDeleting } = useDeleteHistory()

  const [backHref, setBackHref] = useState("/history")
  const [restoreResult, setRestoreResult] = useState<
    (HistoryRestoreResult & { at: string }) | null
  >(null)
  const restoreResultRef = useRef<HTMLDivElement | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const isRunning =
    query.data?.status === "running" && !query.data?.endTime

  // Preserve the list's filters/page on Back without needing useSearchParams.
  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo")
    setBackHref(safeHistoryReturnTo(returnTo))
    setRestoreResult(null)
  }, [id])

  useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const handle = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(handle)
  }, [isRunning])

  useEffect(() => {
    if (!restoreResult) return
    restoreResultRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    })
  }, [restoreResult])

  const handleDelete = () => {
    deleteHistory(id, {
      onSuccess: () => {
        router.push(backHref)
      },
    })
  }

  const handleCopyError = async () => {
    const message = query.data?.errorMessage
    if (!message) return
    const copied = await copyToClipboard(message)
    if (copied) {
      toast.success("Error copied")
    } else {
      toast.error("Could not copy — select the text and copy manually")
    }
  }

  const eligibility = query.data ? restoreEligibilityFromHistory(query.data) : null
  const canRestore = eligibility ? canRestoreBackup(eligibility) : false
  const restoreBlockReason = eligibility ? restoreBlockedReason(eligibility) : null

  const restoreSourceType = query.data?.backupConfig?.sourceType || "path"
  const restoreLabel =
    restoreSourceType === "database"
      ? "Restore DB"
      : restoreSourceType === "path"
        ? "Restore path"
        : restoreSourceType === "git_repo"
          ? "Restore Git"
          : "Restore volume"

  const config = query.data?.backupConfig ?? null
  const startMs = query.data?.startTime
    ? new Date(query.data.startTime).getTime()
    : null
  const endMs = query.data?.endTime ? new Date(query.data.endTime).getTime() : null
  const durationText =
    startMs != null && Number.isFinite(startMs)
      ? endMs != null && Number.isFinite(endMs)
        ? formatDuration(endMs - startMs)
        : isRunning
          ? `Running for ${formatDuration(now - startMs)}`
          : "—"
      : "—"
  const isEncrypted = Boolean(
    query.data?.artifactPath?.toLowerCase().endsWith(".age")
  )
  const sourcePathText = config ? sourcePathLabel(config) : ""

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" asChild>
          <Link href={backHref} aria-label="Back to history">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to history</span>
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Backup Details</h1>
      </div>

      <QueryState
        query={query}
        dataLabel="backup history details"
        errorIcon={<HistoryIcon className="h-12 w-12 text-red-500" />}
      >
        {query.data && (
          <div className="space-y-6">
            {query.data.status === "failed" && query.data.errorMessage ? (
              <Alert
                variant="destructive"
                className="border-destructive/40 bg-destructive/5"
              >
                <AlertCircleIcon aria-hidden />
                <div className="col-start-2 flex flex-wrap items-center justify-between gap-2">
                  <AlertTitle>Backup failed</AlertTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 border-destructive/40 px-2 text-xs"
                    onClick={() => void handleCopyError()}
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
                <AlertDescription className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-destructive/30 bg-background/60 p-3 font-mono text-xs text-foreground">
                  {query.data.errorMessage}
                </AlertDescription>
              </Alert>
            ) : null}

            {restoreResult ? (
              <div ref={restoreResultRef}>
                <Alert
                  variant={
                    restoreResult.status === "success" ? "default" : "destructive"
                  }
                  aria-live="polite"
                  className={cn(
                    "border",
                    restoreResult.status === "success"
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-destructive/40 bg-destructive/5"
                  )}
                >
                  {restoreResult.status === "success" ? (
                    <CheckCircle2Icon
                      className="text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <AlertCircleIcon aria-hidden />
                  )}
                  <div className="col-start-2 flex items-start justify-between gap-2">
                    <AlertTitle>
                      {restoreResult.status === "success"
                        ? "Restore completed"
                        : "Restore failed"}
                    </AlertTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-mr-2 -mt-1 h-7 px-2"
                      onClick={() => setRestoreResult(null)}
                      aria-label="Dismiss restore result"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <AlertDescription className="space-y-2">
                    <p className="break-words text-foreground">
                      {restoreResult.message}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(restoreResult.at), "PPp")}
                    </p>
                    {restoreResult.log ? (
                      <details open className="text-foreground">
                        <summary className="cursor-pointer text-xs font-medium">
                          Restore output
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted p-3 font-mono text-xs">
                          {restoreResult.log}
                        </pre>
                      </details>
                    ) : null}
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{config?.name || "Unknown Backup"}</span>
                      {statusBadge(
                        query.data.status,
                        Boolean(query.data.mailboxPending)
                      )}
                    </CardTitle>
                    <CardDescription>
                      {query.data.startTime && (
                        <>Backup from {format(new Date(query.data.startTime), "PPP 'at' p")}</>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <ClockIcon className="w-4 h-4 mr-2" />
                          Started
                        </div>
                        <div>
                          {query.data.startTime ? (
                            <>{format(new Date(query.data.startTime), "PPP 'at' p")}</>
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <ClockIcon className="w-4 h-4 mr-2" />
                          Completed
                        </div>
                        <div>
                          {endMs != null ? (
                            format(new Date(endMs), "PPP 'at' p")
                          ) : isRunning ? (
                            "In progress"
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <ClockIcon className="w-4 h-4 mr-2" />
                          Duration
                        </div>
                        <div>{durationText}</div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <FileIcon className="w-4 h-4 mr-2" />
                          Files
                        </div>
                        <div>
                          {query.data.fileCount != null
                            ? formatCount(query.data.fileCount)
                            : "—"}
                        </div>
                      </div>

                      <div className="space-y-1 col-span-2">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <ServerIcon className="w-4 h-4 mr-2" />
                          Source → Destination
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 break-words">
                          <span>{config ? sourceEndpointName(config) : "—"}</span>
                          {sourcePathText ? (
                            <span className="text-muted-foreground">
                              · {sourcePathText}
                            </span>
                          ) : null}
                          <ArrowRightIcon
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden
                          />
                          <span>
                            {config ? destinationEndpointName(config) : "—"}
                          </span>
                          {config?.destinationPath ? (
                            <span className="break-all text-muted-foreground">
                              · {config.destinationPath}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <HardDriveIcon className="w-4 h-4 mr-2" />
                          Total Size
                        </div>
                        <div>
                          {query.data.totalSize != null
                            ? formatBytes(query.data.totalSize)
                            : "—"}
                        </div>
                      </div>

                      {query.data.artifactPath && (
                        <div className="space-y-1 col-span-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <HardDriveIcon className="w-4 h-4" />
                            Artifact
                            {isEncrypted ? (
                              <>
                                <Badge variant="warning">encrypted (.age)</Badge>
                                <span className="text-xs">
                                  Restore decrypts on this host
                                </span>
                              </>
                            ) : null}
                          </div>
                          <div className="font-mono text-sm break-all">
                            {query.data.artifactPath}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {query.data.logOutput && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Log Output</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="single" collapsible>
                        {(() => {
                          const { preBackup, transfer, fileRetention } =
                            splitBackupLog(query.data.logOutput ?? "")

                          return (
                            <>
                              {preBackup && (
                                <AccordionItem value="pre-backup">
                                  <AccordionTrigger>Pre-Backup Commands</AccordionTrigger>
                                  <AccordionContent>
                                    <div className="bg-blue-50 dark:bg-blue-950/40 p-4 rounded border border-blue-200 dark:border-blue-900 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                                      {preBackup}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              )}

                              <AccordionItem value="transfer">
                                <AccordionTrigger>
                                  {preBackup ? "Backup Transfer" : "Command Output"}
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="bg-muted p-4 rounded border whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                                    {transfer}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>

                              {fileRetention && (
                                <AccordionItem value="file-retention">
                                  <AccordionTrigger>File Retention</AccordionTrigger>
                                  <AccordionContent>
                                    <div className="bg-amber-50 dark:bg-amber-950/40 p-4 rounded border border-amber-200 dark:border-amber-900 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                                      {fileRetention}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              )}
                            </>
                          )
                        })()}
                      </Accordion>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="w-full self-start">
                <Card>
                  <CardHeader>
                    <CardTitle>Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailActions>
                      {config?.id && (
                        <DetailActionLink
                          href={`/backups/${config.id}`}
                          variant="secondary"
                          className={canRestore ? undefined : "col-span-2"}
                        >
                          <FolderIcon />
                          View backup
                        </DetailActionLink>
                      )}

                      {canRestore && query.data && (
                        <HistoryRestoreButton
                          entry={query.data}
                          onRestored={(result) =>
                            setRestoreResult({
                              ...result,
                              at: new Date().toISOString(),
                            })
                          }
                        >
                          <DetailActionButton type="button" variant="ghost">
                            <RotateCcwIcon />
                            {restoreLabel}
                          </DetailActionButton>
                        </HistoryRestoreButton>
                      )}

                      {canRestore && query.data && (
                        <HistoryDownloadButton entry={query.data} />
                      )}

                      {!canRestore && restoreBlockReason && (
                        <p className="col-span-2 text-sm text-muted-foreground">
                          {restoreBlockReason}
                        </p>
                      )}

                      <DetailActionsDivider />

                      <DeleteConfirmationDialog
                        title="Delete this history entry?"
                        description="This deletes the history row only. Backup files on disk (if any) are left in place."
                        onDelete={handleDelete}
                        isDeleting={isDeleting}
                        buttonText="Delete"
                        triggerButtonClassName={detailActionDestructiveClassName}
                      />
                    </DetailActions>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
}
