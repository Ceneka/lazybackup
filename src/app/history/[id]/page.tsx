"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
import { HistoryDownloadButton } from "@/components/history-download-button"
import { HistoryRestoreButton } from "@/components/history-restore-button"
import { QueryState } from "@/components/ui/query-state"
import { splitBackupLog } from "@/lib/backup/log-format"
import {
  canRestoreBackup,
  restoreBlockedReason,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import { useDeleteHistory, useHistoryDetail } from "@/lib/hooks/useHistory"
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
import { useState } from "react"

export default function HistoryDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const query = useHistoryDetail(id)
  const { mutate: deleteHistory, isPending: isDeleting } = useDeleteHistory()

  const [restoreLog, setRestoreLog] = useState<string | null>(null)

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

  const eligibility = query.data ? restoreEligibilityFromHistory(query.data) : null
  const canRestore = eligibility ? canRestoreBackup(eligibility) : false
  const restoreBlockReason = eligibility ? restoreBlockedReason(eligibility) : null

  const restoreSourceType = query.data?.backupConfig?.sourceType || "path"
  const restoreLabel =
    restoreSourceType === "database"
      ? "Restore DB"
      : restoreSourceType === "path"
        ? "Restore path"
        : "Restore volume"
  
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
                      className={
                        query.data?.mailboxPending
                          ? "bg-amber-500 hover:bg-amber-500"
                          : statusColors[query.data?.status as keyof typeof statusColors] || ""
                      }
                    >
                      {query.data?.mailboxPending ? "waiting for bro" : query.data?.status}
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

                    {canRestore && query.data && (
                      <HistoryRestoreButton
                        entry={query.data}
                        onRestored={(log) => setRestoreLog(log)}
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
        )}
      </QueryState>
    </div>
  )
}
