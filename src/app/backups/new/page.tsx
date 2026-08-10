"use client"

import {
  BackupConfigForm,
  defaultCreateFormData,
  formDataToPayload,
  type BackupFormData,
} from "@/components/backup-config-form"
import { QueryState } from "@/components/ui/query-state"
import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { toast } from "sonner"

function NewBackupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const prefillServerId = searchParams.get("serverId") || undefined
  const initialData = defaultCreateFormData(prefillServerId)

  const serversQuery = useQuery<Server[]>({
    queryKey: ["servers"],
    queryFn: async () => {
      const response = await fetch("/api/servers")
      if (!response.ok) {
        throw new Error("Failed to fetch servers")
      }
      return response.json()
    },
  })

  async function handleSubmit(data: BackupFormData) {
    setSaving(true)
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formDataToPayload(data)),
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || "Failed to create backup")
      }
      await queryClient.invalidateQueries({ queryKey: ["backups"] })
      toast.success("Backup created")
      router.push(`/backups/${body.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create backup")
    } finally {
      setSaving(false)
    }
  }

  const servers = serversQuery.data || []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/backups"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">New backup</h1>
        <p className="text-muted-foreground">
          Choose where files come from and where they go — this host or any server.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <QueryState
          query={serversQuery}
          dataLabel="servers"
          isDataEmpty={() => false}
        >
          <div className="space-y-4">
            {servers.length === 0 && !serversQuery.isLoading && (
              <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm">
                <ServerIcon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">No servers yet</p>
                  <p className="text-muted-foreground">
                    You can still copy local → local.{" "}
                    <Link href="/servers/new" className="underline underline-offset-2">
                      Add a server
                    </Link>{" "}
                    for remote transfers.
                  </p>
                </div>
              </div>
            )}
            {!serversQuery.isLoading && (
              <BackupConfigForm
                mode="create"
                servers={servers}
                initialData={
                  servers.length === 0
                    ? { ...initialData, sourceKind: "local", serverId: "" }
                    : initialData
                }
                submitting={saving}
                onSubmit={handleSubmit}
                autoSuggestDestination
              />
            )}
          </div>
        </QueryState>
      </div>
    </div>
  )
}

export default function NewBackupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <NewBackupForm />
    </Suspense>
  )
}
