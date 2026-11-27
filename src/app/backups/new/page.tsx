"use client"

import {
  BackupConfigForm,
  cloneToFormData,
  defaultCreateFormData,
  defaultGitBackupFormData,
  defaultInstanceBackupFormData,
  defaultPeerBackupFormData,
  formDataToPayload,
  isBackupRecipeId,
  recipeFormData,
  type BackupFormData,
} from "@/components/backup-config-form"
import { QueryState } from "@/components/ui/query-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { ApiError, readApiError } from "@/lib/api/client-error"
import { useBackup } from "@/lib/hooks/useBackups"
import { usePeers } from "@/lib/hooks/usePeers"
import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, ServerIcon } from "lucide-react"
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
  const prefillGitRepoId = searchParams.get("gitRepoId") || undefined
  const prefillS3ProfileId = searchParams.get("s3ProfileId") || undefined
  const cloneFromId = searchParams.get("cloneFrom") || ""
  const recipeParam = searchParams.get("recipe")
  const recipe = isBackupRecipeId(recipeParam) ? recipeParam : null
  const prefillInstance =
    searchParams.get("source") === "lazybackup_instance" || recipe === "instance"
  const peerIdParam = searchParams.get("peerId") || undefined
  const peerFlow = Boolean(peerIdParam) || recipe === "bro-peer"

  const cloneQuery = useBackup(cloneFromId)
  const peersQuery = usePeers()
  const peerTarget = peerIdParam
    ? peersQuery.data?.peers.find(
        (peer) => peer.id === peerIdParam && peer.status === "active"
      )
    : undefined
  const peerMissing =
    Boolean(peerIdParam) &&
    !peersQuery.isLoading &&
    Boolean(peersQuery.data) &&
    !peersQuery.data?.peers.some(
      (peer) => peer.id === peerIdParam && peer.status === "active"
    )
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
      if (!response.ok) {
        const { message, fieldErrors } = await readApiError(response)
        throw new ApiError(message, { status: response.status, fieldErrors })
      }
      const body = await response.json()
      await queryClient.invalidateQueries({ queryKey: ["backups"] })
      toast.success(cloneFromId ? "Backup cloned" : "Backup created")
      router.push(`/backups/${body.id}`)
    } finally {
      setSaving(false)
    }
  }

  const servers = serversQuery.data || []
  const cloning = Boolean(cloneFromId)
  const cloneReady = !cloning || Boolean(cloneQuery.data)
  const initialData =
    cloning && cloneQuery.data
      ? cloneToFormData(cloneQuery.data)
      : peerFlow
        ? defaultPeerBackupFormData(peerTarget?.id || "", peerTarget?.name)
        : recipe
        ? recipeFormData(recipe)
        : prefillInstance
          ? defaultInstanceBackupFormData()
          : prefillGitRepoId
            ? defaultGitBackupFormData(prefillGitRepoId)
            : prefillS3ProfileId
              ? {
                  ...defaultCreateFormData(),
                  sourceKind: "s3" as const,
                  serverId: "",
                  sourceS3ProfileId: prefillS3ProfileId,
                  sourceType: "path" as const,
                }
              : defaultCreateFormData(prefillServerId)

  const formReady =
    !serversQuery.isLoading &&
    cloneReady &&
    !(cloning && cloneQuery.isError) &&
    (!peerFlow || !peersQuery.isLoading)

  const title = cloning
    ? "Clone backup"
    : peerFlow
      ? "Back up to a friend"
      : "New backup"
  const description = cloning
    ? "Review the copy, adjust the destination if needed, then save."
    : peerFlow
      ? "Schedule what to back up; files are encrypted here and stored on your friend's computer when their app checks in."
      : recipe
        ? "Starter recipe applied — adjust paths, credentials, and schedule, then save."
        : "Choose where data comes from and where it goes — this host, a server, an S3 bucket, a Bro peer, or a Git repository."
  const backHref = cloning && cloneFromId ? `/backups/${cloneFromId}` : "/backups"

  return (
    <ResourceEditLayout
      backHref={backHref}
      backLabel={cloning ? "Back to backup" : "Back to backups"}
      title={title}
      description={description}
    >
      {cloning && cloneQuery.isError ? (
        <p className="text-sm text-destructive">
          Could not load the backup to clone.{" "}
          <Link href="/backups" className="underline underline-offset-2">
            Back to backups
          </Link>
        </p>
      ) : (
        <QueryState
          query={serversQuery}
          dataLabel="servers"
          isDataEmpty={() => false}
        >
          <div className="space-y-4">
            {peerMissing && (
              <Alert>
                <AlertTriangleIcon className="h-4 w-4" />
                <AlertTitle>That friend is no longer paired</AlertTitle>
                <AlertDescription>
                  Pick another friend below, or{" "}
                  <Link
                    href="/settings?tab=bro"
                    className="underline underline-offset-2"
                  >
                    manage Bro Space
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            )}
            {servers.length === 0 && !serversQuery.isLoading && (
              <div className="flex items-start gap-3 rounded-md border border-dashed p-4 text-sm">
                <ServerIcon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">No servers yet</p>
                  <p className="text-muted-foreground">
                    You can still copy this host ↔ this host, S3, or Bro.{" "}
                    <Link href="/servers/new" className="underline underline-offset-2">
                      Add a server
                    </Link>{" "}
                    for remote transfers.
                  </p>
                </div>
              </div>
            )}
            {formReady ? (
              <BackupConfigForm
                mode="create"
                servers={servers}
                initialData={
                  servers.length === 0 && !cloning
                    ? {
                        ...initialData,
                        sourceKind:
                          initialData.sourceKind === "server"
                            ? "local"
                            : initialData.sourceKind,
                        serverId: "",
                      }
                    : initialData
                }
                submitting={saving}
                onSubmit={handleSubmit}
                autoSuggestDestination={
                  !cloning || initialData.destinationKind === "local"
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </div>
        </QueryState>
      )}
    </ResourceEditLayout>
  )
}

export default function NewBackupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center py-20 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <NewBackupForm />
    </Suspense>
  )
}
