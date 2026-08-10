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
  HardDriveIcon,
  HistoryIcon,
  RotateCcwIcon,
  ServerIcon
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
  const [restoreVolumeName, setRestoreVolumeName] = useState('')
  const [restoreLog, setRestoreLog] = useState<string | null>(null)

  useEffect(() => {
    if (query.data?.backupConfig?.sourcePath) {
      setRestoreVolumeName(query.data.backupConfig.sourcePath)
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
    restoreMutation.mutate(
      { id, volumeName: restoreVolumeName || undefined },
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
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
                            <div className="bg-red-50 text-red-900 p-4 rounded border border-red-200 whitespace-pre-wrap font-mono text-sm">
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
                                  <div className="bg-blue-50 p-4 rounded border border-blue-200 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
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
                                <div className="bg-gray-50 p-4 rounded border border-gray-200 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                                  {transfer}
                                </div>
                              </AccordionContent>
                            </AccordionItem>

                            {fileRetention && (
                              <AccordionItem value="file-retention">
                                <AccordionTrigger>File Retention</AccordionTrigger>
                                <AccordionContent>
                                  <div className="bg-amber-50 p-4 rounded border border-amber-200 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
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
                            <div className="bg-green-50 p-4 rounded border border-green-200 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
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
            
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button 
                    className="w-full"
                    onClick={() => router.push(`/backups/${query.data?.backupConfig?.id}`)}
                  >
                    View Backup Configuration
                  </Button>

                  {canRestore && (
                    <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="w-full">
                          <RotateCcwIcon className="h-4 w-4 mr-2" />
                          Restore Docker Volume
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Restore Docker volume?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This uploads the backup archive to the remote host and extracts it into
                            the target volume. Existing files in that volume will be overwritten.
                            Images, networks, and compose config are not restored.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-2 py-2">
                          <label htmlFor="restoreVolumeName" className="text-sm font-medium">
                            Target volume name
                          </label>
                          <input
                            id="restoreVolumeName"
                            value={restoreVolumeName}
                            onChange={(e) => setRestoreVolumeName(e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder={query.data.backupConfig?.sourcePath || 'volume-name'}
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
                            disabled={!restoreVolumeName.trim() || restoreMutation.isPending}
                          >
                            Restore
                          </LoadingButton>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}

                  {!canRestore && restoreBlockReason && (
                    <p className="text-sm text-muted-foreground">{restoreBlockReason}</p>
                  )}
                  
                  <DeleteConfirmationDialog
                    title="Are you absolutely sure?"
                    description="This deletes the history row only. Backup files on disk (if any) are left in place."
                    onDelete={handleDelete}
                    isDeleting={isDeleting}
                    buttonText="Delete History Entry"
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  )
}
