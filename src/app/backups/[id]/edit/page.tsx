"use client"

import {
  BackupConfigForm,
  backupToFormData,
  formDataToPayload,
  type BackupFormData,
} from "@/components/backup-config-form"
import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { QueryState } from "@/components/ui/query-state"
import { useBackup, backupKeys } from "@/lib/hooks/useBackups"
import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export default function EditBackupPage() {
  const params = useParams()
  const backupId = params.id as string
  const router = useRouter()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const backupQuery = useBackup(backupId)
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
      const response = await fetch(`/api/backups/${backupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formDataToPayload(data)),
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || "Failed to update backup")
      }
      await queryClient.invalidateQueries({ queryKey: ["backups"] })
      await queryClient.invalidateQueries({ queryKey: backupKeys.detail(backupId) })
      toast.success("Backup updated")
      router.push(`/backups/${backupId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update backup")
    } finally {
      setSaving(false)
    }
  }

  const ready = backupQuery.data && serversQuery.data

  return (
    <ResourceEditLayout
      backHref={`/backups/${backupId}`}
      backLabel="Back to backup"
      title="Edit backup"
      description="Update the From → To transfer and schedule."
    >
        <QueryState
          query={backupQuery}
          dataLabel="backup"
          isDataEmpty={(data) => !data}
        >
          <QueryState
            query={serversQuery}
            dataLabel="servers"
            isDataEmpty={() => false}
          >
            {ready ? (
              <BackupConfigForm
                mode="edit"
                servers={serversQuery.data!}
                initialData={backupToFormData(backupQuery.data!)}
                submitting={saving}
                onSubmit={handleSubmit}
                excludeBackupId={backupId}
              />
            ) : null}
          </QueryState>
        </QueryState>
    </ResourceEditLayout>
  )
}
