"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { splitBackupLog } from "@/lib/backup/log-format"
import {
  canRestoreDockerVolumeBackup,
  restoreBlockedReason,
} from "@/lib/backup/restore-eligibility"
import { useDeleteHistory, useHistoryDetail, useRestoreBackupHistory } from "@/lib/hooks/useHistory"
import { formatBytes } from "@/lib/utils"
import { format, formatDistance } from "date-fns"
import {
  ArrowLeftIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  HardDriveIcon,
  HistoryIcon,
  RotateCcwIcon,
  ServerIcon,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function HistoryDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const query = useHistoryDetail(id)
  const { mutate: deleteHistory, isPending: isDeleting } = useDeleteHistory()
  const restoreMutation = useRestoreBackupHistory()

  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreTargetName, setRestoreTargetName] = useState('')
  const [restoreLog, setRestoreLog] = useState<string | null>(null)

  const restoreSourceType = query.data?.backupConfig?.sourceType || 'path'
  const isDatabaseRestore = restoreSourceType === 'database'

  useEffect(() => {
    if (query.data?.backupConfig?.sourcePath) {
      setRestoreTargetName(query.data.backupConfig.sourcePath)
    }
  }, [query.data?.backupConfig?.sourcePath])
  
  const statusColors = {
    running: "bg-blue-500 hover:bg-blue-500",
    success: "bg-green-500 hover:bg-green-500",
    failed: "bg-red-500 hover:bg-red-500",
  }
  
  const handleDelete = () => {
    deleteHistory(id, {
      onSuccess: () => {
        router.push("/history")
      }
    })
  }

  const canRestore = canRestoreDockerVolumeBackup({
    status: query.data?.status,
    sourceType: query.data?.backupConfig?.sourceType,
    destinationKind: query.data?.backupConfig?.destinationKind,
    artifactPath: query.data?.artifactPath,
  })

  const restoreBlockReason = restoreBlockedReason({
    status: query.data?.status,
    sourceType: query.data?.backupConfig?.sourceType,
    destinationKind: query.data?.backupConfig?.destinationKind,
    artifactPath: query.data?.artifactPath,
  })

  const handleRestore = () => {
    const configured = query.data?.backupConfig?.sourcePath || ''
    const requested = restoreTargetName.trim()
    const allowRetarget = Boolean(requested && configured && requested !== configured)
    restoreMutation.mutate(
      isDatabaseRestore
        ? { id, databaseName: requested || undefined, allowRetarget }
        : { id, volumeName: requested || undefined, allowRetarget },
      {
        onSuccess: (data) => {
          setRestoreLog(data.log)
          setRestoreOpen(false)
        },
      }
    )
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={() => router.push("/history")}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-3xl font-bold">Backup Details</h1>
      </div>
      
      <QueryState
        query={query}
        dataLabel="backup history details"
        errorIcon={<HistoryIcon className="h-12 w-12 text-red-500" />}
      >
        {query.data && (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{query.data?.backupConfig?.name || "Unknown Backup"}</span>
                    <Badge 
                      className={statusColors[query.data?.status as keyof typeof statusColors] || ""}
                    >
                      {query.data?.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {query.data?.startTime && (
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
                        {query.data?.startTime && (
                          <>{format(new Date(query.data.startTime), "PPP 'at' p")}</>
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <ClockIcon className="w-4 h-4 mr-2" />
                        Completed
                      </div>
                      <div>
                        {query.data?.endTime 
                          ? format(new Date(query.data.endTime), "PPP 'at' p")
                          : "In progress"
                        }
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <ClockIcon className="w-4 h-4 mr-2" />
                        Duration
                      </div>
                      <div>
                        {(query.data?.endTime && query.data?.startTime)
                          ? formatDistance(
                              new Date(query.data.startTime),
                              new Date(query.data.endTime),
                              { includeSeconds: true }
                            )
                          : "In progress"
                        }
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <ServerIcon className="w-4 h-4 mr-2" />
                        Server
                      </div>
                      <div>{query.data?.backupConfig?.server?.name || "Unknown"}</div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <FileIcon className="w-4 h-4 mr-2" />
                        Files
                      </div>
                      <div>{query.data?.fileCount || "N/A"}</div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <HardDriveIcon className="w-4 h-4 mr-2" />
                        Total Size
                      </div>
                      <div>{query.data?.totalSize ? formatBytes(query.data.totalSize) : "N/A"}</div>
                    </div>

                    {query.data?.artifactPath && (
                      <div className="space-y-1 col-span-2">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <HardDriveIcon className="w-4 h-4 mr-2" />
                          Artifact
                        </div>
                        <div className="font-mono text-sm break-all">{query.data.artifactPath}</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              
              {(query.data?.logOutput || query.data?.errorMessage || restoreLog) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Log Output</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible>
                      {query.data.errorMessage && (
                        <AccordionItem value="error">
                          <AccordionTrigger className="text-red-500">Error Message</AccordionTrigger>
                          <AccordionContent>
                            <div className="bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-200 p-4 rounded border border-red-200 dark:border-red-900 whitespace-pre-wrap font-mono text-sm">
                              {query.data.errorMessage}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      
                      {query.data.logOutput && (() => {
                        const { preBackup, transfer, fileRetention } = splitBackupLog(query.data.logOutput)

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

                      {restoreLog && (
                        <AccordionItem value="restore">
                          <AccordionTrigger>Restore Output</AccordionTrigger>
                          <AccordionContent>
                            <div className="bg-green-50 dark:bg-green-950/40 p-4 rounded border border-green-200 dark:border-green-900 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                              {restoreLog}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}
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
                    {query.data.backupConfig?.id && (
                      <DetailActionLink
                        href={`/backups/${query.data.backupConfig.id}`}
                        variant="secondary"
                        className={canRestore ? undefined : "col-span-2"}
                      >
                        <FolderIcon />
                        View backup
                      </DetailActionLink>
                    )}

                    {canRestore && (
                      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
                        <AlertDialogTrigger asChild>
                          <DetailActionButton type="button" variant="ghost">
                            <RotateCcwIcon />
                            {isDatabaseRestore ? "Restore DB" : "Restore volume"}
                          </DetailActionButton>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {isDatabaseRestore
                                ? "Restore database dump?"
                                : "Restore Docker volume?"}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {isDatabaseRestore
                                ? "This loads the .sql.gz dump into the target database using the backup’s connection settings. Existing objects may be overwritten or conflict depending on the dump contents."
                                : "This uploads the backup archive to the remote host and extracts it into the target volume. Existing files in that volume will be overwritten. Images, networks, and compose config are not restored."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <div className="space-y-2 py-2">
                            <label htmlFor="restoreTargetName" className="text-sm font-medium">
                              {isDatabaseRestore ? "Target database name" : "Target volume name"}
                            </label>
                            <input
                              id="restoreTargetName"
                              value={restoreTargetName}
                              onChange={(e) => setRestoreTargetName(e.target.value)}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              placeholder={
                                query.data.backupConfig?.sourcePath ||
                                (isDatabaseRestore ? "database" : "volume-name")
                              }
                            />
                          </div>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={restoreMutation.isPending}>
                              Cancel
                            </AlertDialogCancel>
                            <LoadingButton
                              onClick={handleRestore}
                              isLoading={restoreMutation.isPending}
                              loadingText="Restoring..."
                              disabled={!restoreTargetName.trim() || restoreMutation.isPending}
                            >
                              Restore
                            </LoadingButton>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
        )}
      </QueryState>
    </div>
  )
}
