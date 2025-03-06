"use client"

import { DataState } from "@/components/ui/data-state"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, CheckCircleIcon, Loader2Icon, ServerIcon, XCircleIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function TestConnectionPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null)

  // Fetch server data with useQuery
  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: async () => {
      const response = await fetch(`/api/servers/${serverId}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          toast.error("Server not found")
          router.push("/servers")
          return null
        }
        throw new Error("Failed to fetch server")
      }
      
      return response.json()
    }
  })

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    
    try {
      const response = await fetch(`/api/servers/${serverId}/test`)
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to test connection")
      }
      
      setTestResult(data)
      
      if (data.success) {
        toast.success("Connection successful!")
      } else {
        toast.error(`Connection failed: ${data.message || "Unknown error"}`)
      }
    } catch (error) {
      console.error("Error testing connection:", error)
      toast.error("Failed to test connection")
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error"
      })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    if (query.isSuccess && query.data && !testing && !testResult) {
      testConnection()
    }
  }, [query.isSuccess, query.data, testing, testResult])

  return (
    <QueryState
      query={query}
      dataLabel="server"
      errorIcon={<ServerIcon className="h-12 w-12 text-red-500" />}
      emptyIcon={<ServerIcon className="h-12 w-12 text-muted-foreground" />}
      emptyMessage="Server not found"
      isDataEmpty={(data) => !data}
    >
      {query.data && (
        <div className="space-y-6">
          <div className="flex items-center space-x-2">
            <Link href={`/servers/${serverId}`} className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
              <ArrowLeftIcon className="h-4 w-4" />
              <span className="sr-only">Back to server</span>
            </Link>
            <h1 className="text-3xl font-bold">Test Connection: {query.data.name}</h1>
          </div>
  
          <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
            <div className="space-y-6">
              <div className="flex items-center space-x-4">
                <ServerIcon className="h-8 w-8 text-muted-foreground" />
                <div>
                  <h2 className="text-xl font-semibold">{query.data.name}</h2>
                  <p className="text-muted-foreground">{query.data.username}@{query.data.host}:{query.data.port}</p>
                </div>
              </div>
  
              <div className="border-t pt-4">
                <h3 className="text-lg font-medium mb-4">Connection Test</h3>
                
                <DataState isLoading={testing} loadingComponent={
                  <div className="flex items-center space-x-2 text-muted-foreground">
                    <Loader2Icon className="h-5 w-5 animate-spin" />
                    <span>Testing connection...</span>
                  </div>
                }>
                  {testResult && (
                    <div className={`flex items-center space-x-2 ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                      {testResult.success ? (
                        <CheckCircleIcon className="h-5 w-5" />
                      ) : (
                        <XCircleIcon className="h-5 w-5" />
                      )}
                      <span>{testResult.success ? 'Connection successful!' : `Connection failed: ${testResult.message || 'Unknown error'}`}</span>
                    </div>
                  )}
                </DataState>
                
                <div className="mt-6 flex space-x-4">
                  <LoadingButton
                    onClick={testConnection}
                    isLoading={testing}
                    loadingText="Testing..."
                  >
                    Test Again
                  </LoadingButton>
                  
                  <Link
                    href={`/servers/${serverId}`}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
                  >
                    Back to Server
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </QueryState>
  )
} 
