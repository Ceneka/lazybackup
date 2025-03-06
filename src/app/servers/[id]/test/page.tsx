"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, ServerIcon, Loader2Icon, CheckCircleIcon, XCircleIcon } from "lucide-react"
import { toast } from "sonner"

export default function TestConnectionPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null)

  // Fetch server data with useQuery
  const { data: server, isLoading: loading, isSuccess } = useQuery({
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
    if (isSuccess && server && !testing && !testResult) {
      testConnection()
    }
  }, [isSuccess, server, testing, testResult])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!server) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ServerIcon className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">Server not found</h3>
        <p className="text-muted-foreground mt-2 mb-4">The server you're looking for doesn't exist or has been deleted.</p>
        <Link 
          href="/servers" 
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          Back to Servers
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Link href={`/servers/${serverId}`} className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-10 w-10">
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to server</span>
        </Link>
        <h1 className="text-3xl font-bold">Test Connection: {server.name}</h1>
      </div>

      <div className="p-6 rounded-lg border bg-card text-card-foreground shadow">
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <ServerIcon className="h-8 w-8 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold">{server.name}</h2>
              <p className="text-muted-foreground">{server.username}@{server.host}:{server.port}</p>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-lg font-medium mb-4">Connection Test</h3>
            
            {testing ? (
              <div className="flex items-center space-x-2 text-muted-foreground">
                <Loader2Icon className="h-5 w-5 animate-spin" />
                <span>Testing connection...</span>
              </div>
            ) : testResult ? (
              <div className={`flex items-center space-x-2 ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
                {testResult.success ? (
                  <CheckCircleIcon className="h-5 w-5" />
                ) : (
                  <XCircleIcon className="h-5 w-5" />
                )}
                <span>{testResult.success ? 'Connection successful!' : `Connection failed: ${testResult.message || 'Unknown error'}`}</span>
              </div>
            ) : null}
            
            <div className="mt-6 flex space-x-4">
              <button
                onClick={testConnection}
                disabled={testing}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
              >
                {testing ? (
                  <>
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Again'
                )}
              </button>
              
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
  )
} 
