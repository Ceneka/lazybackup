"use client"

import {
  BackupConfigForm,
  backupToFormData,
} from "@/components/backup-config-form"
import { formDataToPayload, type BackupFormData } from "@/lib/backup/form-payload"
import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { ApiError, readApiError } from "@/lib/api/client-error"
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
      if (!response.ok) {
        const { message, fieldErrors } = await readApiError(response)
        throw new ApiError(message, { status: response.status, fieldErrors })
      }
      await queryClient.invalidateQueries({ queryKey: ["backups"] })
      await queryClient.invalidateQueries({ queryKey: backupKeys.detail(backupId) })
      toast.success("Backup updated")
      router.push(`/backups/${backupId}`)
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
