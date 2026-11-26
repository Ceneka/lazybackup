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
import { useBackup } from "@/lib/hooks/useBackups"
import { usePeers } from "@/lib/hooks/usePeers"
import { Server } from "@/lib/hooks/useServers"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react"
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
  const cloneFromId = searchParams.get("cloneFrom") || ""
  const recipeParam = searchParams.get("recipe")
  const recipe = isBackupRecipeId(recipeParam) ? recipeParam : null
  const peerIdParam = searchParams.get("peerId") || undefined
  const peerFlow = Boolean(peerIdParam) || recipe === "bro-peer"
  const prefillInstance =
    searchParams.get("source") === "lazybackup_instance" || recipe === "instance"

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
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || "Failed to create backup")
      }
      await queryClient.invalidateQueries({ queryKey: ["backups"] })
      toast.success(cloneFromId ? "Backup cloned" : "Backup created")
      router.push(`/backups/${body.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create backup")
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
              : defaultCreateFormData(prefillServerId)

  const formReady =
    !serversQuery.isLoading &&
    cloneReady &&
    !(cloning && cloneQuery.isError) &&
    (!peerFlow || !peersQuery.isLoading)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href={cloning && cloneFromId ? `/backups/${cloneFromId}` : "/backups"}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Back
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {cloning ? "Clone backup" : peerFlow ? "Back up to a friend" : "New backup"}
        </h1>
        <p className="text-muted-foreground">
          {cloning
            ? "Review the copy, adjust the destination if needed, then save."
            : peerFlow
              ? "Schedule what to back up; files are encrypted here and stored on your friend's computer when their app checks in."
              : recipe
                ? "Starter recipe applied — adjust paths, credentials, and schedule, then save."
                : "Choose where files come from and where they go — this host or any server."}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
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
                    <Link href="/settings?tab=bro" className="underline underline-offset-2">
                      manage Bro Space
                    </Link>
                    .
                  </AlertDescription>
                </Alert>
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
      </div>
    </div>
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
