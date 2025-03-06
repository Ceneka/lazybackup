"use client"

import { useParams, useRouter } from "next/navigation"
import { 
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  ArrowLeftIcon, 
  ClockIcon, 
  FileIcon, 
  HardDriveIcon, 
  Loader2Icon, 
  ServerIcon, 
  TrashIcon 
} from "lucide-react"
import { formatDistance, format } from "date-fns"
import { formatBytes } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useHistoryDetail, useDeleteHistory } from "@/lib/hooks/useHistory"

export default function HistoryDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const { data: history, isLoading } = useHistoryDetail(id)
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
  
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2Icon className="h-12 w-12 animate-spin text-primary" />
      </div>
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
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{history?.backupConfig?.name || "Unknown Backup"}</span>
                <Badge 
                  className={statusColors[history?.status as keyof typeof statusColors] || ""}
                >
                  {history?.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                {history?.startTime && (
                  <>Backup from {format(new Date(history.startTime), "PPP 'at' p")}</>
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
                    {history?.startTime && (
                      <>{format(new Date(history.startTime), "PPP 'at' p")}</>
                    )}
                  </div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <ClockIcon className="w-4 h-4 mr-2" />
                    Completed
                  </div>
                  <div>
                    {history?.endTime 
                      ? format(new Date(history.endTime), "PPP 'at' p")
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
                    {(history?.endTime && history?.startTime)
                      ? formatDistance(
                          new Date(history.startTime),
                          new Date(history.endTime),
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
                  <div>{history?.backupConfig?.server?.name || "Unknown"}</div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <FileIcon className="w-4 h-4 mr-2" />
                    Files
                  </div>
                  <div>{history?.fileCount || "N/A"}</div>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <HardDriveIcon className="w-4 h-4 mr-2" />
                    Total Size
                  </div>
                  <div>{history?.totalSize ? formatBytes(history.totalSize) : "N/A"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {(history?.logOutput || history?.errorMessage) && (
            <Card>
              <CardHeader>
                <CardTitle>Log Output</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible>
                  {history.errorMessage && (
                    <AccordionItem value="error">
                      <AccordionTrigger className="text-red-500">Error Message</AccordionTrigger>
                      <AccordionContent>
                        <div className="bg-red-50 text-red-900 p-4 rounded border border-red-200 whitespace-pre-wrap font-mono text-sm">
                          {history.errorMessage}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                  
                  {history.logOutput && (
                    <AccordionItem value="log">
                      <AccordionTrigger>Command Output</AccordionTrigger>
                      <AccordionContent>
                        <div className="bg-gray-50 p-4 rounded border border-gray-200 whitespace-pre-wrap font-mono text-sm max-h-96 overflow-y-auto">
                          {history.logOutput}
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
                onClick={() => router.push(`/backups/${history?.backupConfig?.id}`)}
              >
                View Backup Configuration
              </Button>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <TrashIcon className="w-4 h-4 mr-2" /> Delete History Entry
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this backup history entry.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="bg-red-500 hover:bg-red-600"
                    >
                      {isDeleting ? (
                        <>
                          <Loader2Icon className="w-4 h-4 mr-2 animate-spin" /> Deleting
                        </>
                      ) : (
                        "Delete"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
