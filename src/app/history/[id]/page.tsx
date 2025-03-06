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
import { QueryState } from "@/components/ui/query-state"
import { useDeleteHistory, useHistoryDetail } from "@/lib/hooks/useHistory"
import { formatBytes } from "@/lib/utils"
import { format, formatDistance } from "date-fns"
import {
  ArrowLeftIcon,
  ClockIcon,
  FileIcon,
  HardDriveIcon,
  HistoryIcon,
  ServerIcon
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"

export default function HistoryDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const query = useHistoryDetail(id)
  const { mutate: deleteHistory, isPending: isDeleting } = useDeleteHistory()
  
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
                  </div>
                </CardContent>
              </Card>
              
              {(query.data?.logOutput || query.data?.errorMessage) && (
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
                      
                      {query.data.logOutput && (
                        <AccordionItem value="log">
                          <AccordionTrigger>Command Output</AccordionTrigger>
                          <AccordionContent>
                            <div className="bg-gray-50 p-4 rounded border border-gray-200 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                              {query.data.logOutput}
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
                  
                  <DeleteConfirmationDialog
                    title="Are you absolutely sure?"
                    description="This will permanently delete this backup history entry. This action cannot be undone."
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
