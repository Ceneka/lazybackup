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
import { DeliveryBadge } from "@/components/peer/delivery-badge"
import { HistoryDownloadButton } from "@/components/history-download-button"
import { HistoryRestoreButton } from "@/components/history-restore-button"
import { QueryState } from "@/components/ui/query-state"
import { splitBackupLog } from "@/lib/backup/log-format"
import {
  canRestoreBackup,
  restoreBlockedReason,
  restoreEligibilityFromHistory,
} from "@/lib/backup/restore-eligibility"
import {
  deliveryErrorFor,
  deriveDeliveryState,
  historyDisplayStats,
  peerIdForHistoryRow,
} from "@/lib/backup/delivery-state"
import { useDeleteHistory, useHistoryDetail } from "@/lib/hooks/useHistory"
import { usePeers } from "@/lib/hooks/usePeers"
import {
  friendAppKind,
  friendAppLabel,
  peerObjectKeyFromArtifactPath,
  resolveFriendName,
  resolvePeer,
} from "@/lib/peer/friend-copy"
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
  UsersIcon,
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

  const peersQuery = usePeers()
  const peers = peersQuery.data?.peers || []
  const entry = query.data
  const peerId = entry
    ? peerIdForHistoryRow({
        artifactPath: entry.artifactPath,
        destinationPeerId: entry.backupConfig?.destinationPeerId,
        destinationPeer: entry.backupConfig?.destinationPeer,
      })
    : null
  const friendName = resolveFriendName(peers, peerId)
  const friendPeer = resolvePeer(peers, peerId)
  const friendApp = friendAppLabel(friendPeer ? friendAppKind(friendPeer) : null)
  const deliveryState = entry
    ? deriveDeliveryState({
        status: entry.status,
        deliveryState: entry.deliveryState,
        mailboxPending: entry.mailboxPending,
        deliveryError: entry.deliveryError,
        artifactPath: entry.artifactPath,
        destinationKind: entry.backupConfig?.destinationKind,
      })
    : null
  const deliveryError = entry
    ? deliveryErrorFor({
        deliveryError: entry.deliveryError,
        mailboxError: (entry as { mailboxError?: string | null }).mailboxError,
      })
    : null
  const stats = entry
    ? historyDisplayStats({
        fileCount: entry.fileCount,
        totalSize: entry.totalSize,
        artifactPath: entry.artifactPath,
        logOutput: entry.logOutput,
      })
    : null
  const sourceKind = entry?.backupConfig?.sourceKind || "server"
  const sourceHost =
    sourceKind === "local" || sourceKind === "git"
      ? "This host"
      : sourceKind === "s3"
        ? entry?.backupConfig?.sourceS3Profile?.name || "S3"
        : entry?.backupConfig?.server?.name || "Unknown server"
  const peerObjectKey = peerObjectKeyFromArtifactPath(entry?.artifactPath)
  const peerFolder = peerObjectKey?.includes("/")
    ? peerObjectKey.slice(0, peerObjectKey.lastIndexOf("/"))
    : null
  const isPeerRun = Boolean(peerId)
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/history")}
          aria-label="Back to history"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to history</span>
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
                    {deliveryState ? (
                      <DeliveryBadge
                        state={deliveryState}
                        friendName={friendName}
                        error={deliveryError}
                      />
                    ) : (
                      <Badge
                        className={
                          statusColors[
                            query.data?.status as keyof typeof statusColors
                          ] || ""
                        }
                      >
                        {query.data?.status}
                      </Badge>
                    )}
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
                      <div>{sourceHost}</div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <FileIcon className="w-4 h-4 mr-2" />
                        Files
                      </div>
                      <div>{stats?.filesLabel || "N/A"}</div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <HardDriveIcon className="w-4 h-4 mr-2" />
                        Total Size
                      </div>
                      <div>
                        {stats?.sizeBytes != null
                          ? formatBytes(stats.sizeBytes)
                          : "N/A"}
                      </div>
                    </div>

                    {isPeerRun ? (
                      <div className="space-y-2 col-span-2">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <UsersIcon className="w-4 h-4 mr-2" />
                          Destination
                        </div>
                        <DeliveryBadge
                          state={deliveryState}
                          friendName={friendName}
                          error={deliveryError}
                        />
                        {!deliveryState ? (
                          <Badge
                            className={
                              statusColors[
                                query.data?.status as keyof typeof statusColors
                              ] || ""
                            }
                          >
                            {query.data?.status}
                          </Badge>
                        ) : null}
                        <p className="text-sm text-muted-foreground">
                          {deliveryState === "waiting"
                            ? `Waiting for ${friendName}'s ${friendApp} — saved on this server, not yet on their disk.`
                            : deliveryState === "failed"
                              ? deliveryError ||
                                `This run could not be delivered to ${friendName}'s ${friendApp}.`
                              : deliveryState === "stored"
                                ? `Stored on ${friendName}'s ${friendApp}.`
                                : "This run did not finish — no off-site copy was recorded."}
                        </p>
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer select-none">
                            Technical details
                          </summary>
                          <div className="mt-1 space-y-1">
                            {peerFolder ? (
                              <p>
                                Folder: <span className="font-mono">{peerFolder}</span>
                              </p>
                            ) : null}
                            {query.data?.artifactPath ? (
                              <p className="break-all font-mono">
                                {query.data.artifactPath}
                              </p>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    ) : query.data?.artifactPath ? (
                      <div className="space-y-1 col-span-2">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <HardDriveIcon className="w-4 h-4 mr-2" />
                          Artifact
                        </div>
                        <div className="font-mono text-sm break-all">{query.data.artifactPath}</div>
                      </div>
                    ) : null}
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
                            <div className="max-h-96 overflow-auto break-all rounded border border-red-200 bg-red-50 p-4 font-mono text-sm whitespace-pre-wrap text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
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
