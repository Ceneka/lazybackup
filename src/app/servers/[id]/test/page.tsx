"use client"

import {
  ConnectionTestResultPanel,
  ServerTransportDetails,
} from "@/components/connections/connection-test-result"
import { PasswordAuthWarning } from "@/components/connections/server-auth"
import { DataState } from "@/components/ui/data-state"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import {
  useServer,
  useTestServer,
  type ServerTestResult,
} from "@/lib/hooks/useServers"
import { ArrowLeftIcon, Loader2Icon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

type TestOutcome = ServerTestResult & {
  testedAt?: number
  testedLabel?: string
}

export default function TestConnectionPage() {
  const router = useRouter()
  const params = useParams()
  const serverId = params.id as string
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestOutcome | null>(null)
  const autoRan = useRef(false)

  const query = useServer(serverId)
  const testQuery = useTestServer(serverId)

  useEffect(() => {
    if (query.error?.message === "Server not found") {
      toast.error("Server not found")
      router.push("/connections?tab=servers")
    }
  }, [query.error, router])

  const runServerTest = async () => {
    if (!query.data) return
    const testedLabel = `Saved server · ${query.data.username}@${query.data.host}:${query.data.port}`
    setTesting(true)
    setTestResult(null)

    try {
      const { data, isError, error } = await testQuery.refetch()

      if (isError || !data) {
        throw error instanceof Error ? error : new Error("Failed to test server")
      }

      setTestResult({ ...data, testedAt: Date.now(), testedLabel })
    } catch (error) {
      setTestResult({
        success: false,
        rsyncAvailable: false,
        scpAvailable: false,
        dockerAvailable: false,
        message: error instanceof Error ? error.message : "Failed to test server",
        testedAt: Date.now(),
        testedLabel,
      })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    if (query.isSuccess && query.data && !autoRan.current) {
      autoRan.current = true
      void runServerTest()
    }
    // Auto-run once per server; retries use the panel/button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isSuccess, query.data])

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
            <Link
              href={`/servers/${serverId}`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              <span className="sr-only">Back to server</span>
            </Link>
            <h1 className="text-3xl font-bold">Test server: {query.data.name}</h1>
          </div>

          <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
            <div className="space-y-6">
              <div className="flex items-center space-x-4">
                <ServerIcon className="h-8 w-8 text-muted-foreground" />
                <div>
                  <h2 className="text-xl font-semibold">{query.data.name}</h2>
                  <p className="text-muted-foreground">
                    {query.data.username}@{query.data.host}:{query.data.port}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="mb-4 text-lg font-medium">Connection and backup tools</h3>

                <DataState
                  isLoading={testing && !testResult}
                  loadingComponent={
                    <div className="flex items-center space-x-2 text-muted-foreground">
                      <Loader2Icon className="h-5 w-5 animate-spin" />
                      <span>Testing connection and tools...</span>
                    </div>
                  }
                >
                  {testResult ? (
                    <ConnectionTestResultPanel
                      result={testResult}
                      showMessage={!testResult.success}
                      details={
                        testResult.success ? (
                          <ServerTransportDetails result={testResult} />
                        ) : null
                      }
                      warning={
                        query.data.authType === "password" ? (
                          <PasswordAuthWarning
                            editHref={`/servers/${serverId}/edit`}
                          />
                        ) : null
                      }
                      onRetry={() => void runServerTest()}
                      retrying={testing}
                    />
                  ) : null}
                </DataState>

                <div className="mt-6 flex space-x-4">
                  <LoadingButton
                    onClick={runServerTest}
                    isLoading={testing}
                    loadingText="Testing..."
                  >
                    Test again
                  </LoadingButton>

                  <Link
                    href={`/servers/${serverId}`}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    Back to server
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
