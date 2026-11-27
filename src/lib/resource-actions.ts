"use client"

import { backupKeys, runBackupUntilDone } from "@/lib/hooks/useBackups"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export async function testServerConnection(
  id: string,
  name: string
): Promise<"success" | "failed"> {
  const toastId = toast.loading(`${name}: testing connection…`)
  try {
    const response = await fetch(`/api/servers/${id}/test`)
    const data = (await response.json()) as {
      success?: boolean
      rsyncAvailable?: boolean
      scpAvailable?: boolean
      message?: string
      error?: string
      authType?: string
    }
    if (!response.ok || !data.success) {
      toast.error(
        `${name}: ${data.error || data.message || "Connection failed"}`,
        { id: toastId }
      )
      return "failed"
    }
    if (data.authType === "password") {
      toast.warning(
        `${name}: connected with a password — path backups need an SSH key`,
        { id: toastId }
      )
    } else if (data.rsyncAvailable) {
      toast.success(`${name}: connection OK (rsync)`, { id: toastId })
    } else if (data.scpAvailable) {
      toast.info(`${name}: connected — backups will fall back to SCP`, {
        id: toastId,
      })
    } else {
      toast.error(`${name}: no rsync on remote and no local scp`, {
        id: toastId,
      })
    }
    return "success"
  } catch (error) {
    toast.error(
      `${name}: ${error instanceof Error ? error.message : "Connection failed"}`,
      { id: toastId }
    )
    return "failed"
  }
}

export async function testStoredS3Profile(
  id: string,
  name: string
): Promise<"success" | "failed"> {
  const toastId = toast.loading(`${name}: testing S3 connection…`)
  try {
    const response = await fetch(`/api/s3-profiles/${id}/test`)
    const data = (await response.json()) as {
      success?: boolean
      message?: string
      error?: string
    }
    if (!response.ok || !data.success) {
      toast.error(
        `${name}: ${data.error || data.message || "S3 connection failed"}`,
        { id: toastId }
      )
      return "failed"
    }
    toast.success(`${name}: ${data.message || "S3 connection OK"}`, {
      id: toastId,
    })
    return "success"
  } catch (error) {
    toast.error(
      `${name}: ${
        error instanceof Error ? error.message : "S3 connection failed"
      }`,
      { id: toastId }
    )
    return "failed"
  }
}

export async function testStoredGitRepo(
  id: string,
  name: string
): Promise<"success" | "failed"> {
  const toastId = toast.loading(`${name}: testing Git connection…`)
  try {
    const response = await fetch(`/api/git-repos/${id}/test`)
    const data = (await response.json()) as {
      success?: boolean
      message?: string
      error?: string
      refCount?: number
    }
    if (!response.ok || !data.success) {
      toast.error(
        `${name}: ${data.error || data.message || "Git connection failed"}`,
        { id: toastId }
      )
      return "failed"
    }
    toast.success(`${name}: ${data.message || "Git connection OK"}`, {
      id: toastId,
    })
    return "success"
  } catch (error) {
    toast.error(
      `${name}: ${
        error instanceof Error ? error.message : "Git connection failed"
      }`,
      { id: toastId }
    )
    return "failed"
  }
}

/**
 * Run a backup and resolve when it finishes. Completion/failure toasts are
 * owned by the SSE layer (`useBackupEvents`), so this stays silent to avoid
 * double toasts for manual runs.
 */
export async function startBackupRun(id: string) {
  return runBackupUntilDone(id)
}

export const runActionFlashClassName = {
  success: "!bg-green-600 !text-white hover:!bg-green-600",
  failed: "!bg-red-600 !text-white hover:!bg-red-600",
} as const

export function flashClassName(kind: "success" | "failed" | null | undefined) {
  if (!kind) return undefined
  return runActionFlashClassName[kind]
}

/** Shared Test / Run helpers for dashboard and list-card overflow menus. */
export function useResourceQuickActions() {
  const queryClient = useQueryClient()
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set())
  const [flash, setFlash] = useState<{
    key: string
    kind: "success" | "failed"
  } | null>(null)

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 1400)
    return () => window.clearTimeout(timer)
  }, [flash])

  async function run(
    key: string,
    fn: () => Promise<"success" | "failed" | void>
  ) {
    setBusyKeys((prev) => new Set(prev).add(key))
    try {
      const result = await fn()
      if (result === "success" || result === "failed") {
        setFlash({ key, kind: result })
      }
    } catch (error) {
      setFlash({ key, kind: "failed" })
      toast.error(error instanceof Error ? error.message : "Action failed")
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return {
    busy: busyKeys.size > 0 ? [...busyKeys][0] : null,
    isBusy: (key: string) => busyKeys.has(key),
    flashFor: (key: string) => (flash?.key === key ? flash.kind : null),
    testServer: (id: string, name: string) =>
      run(`server:${id}`, () => testServerConnection(id, name)),
    testS3: (id: string, name: string) =>
      run(`s3:${id}`, () => testStoredS3Profile(id, name)),
    testGit: (id: string, name: string) =>
      run(`git:${id}`, () => testStoredGitRepo(id, name)),
    runBackup: (id: string) =>
      run(`backup:${id}`, async () => {
        const outcome = await startBackupRun(id)
        await queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        await queryClient.invalidateQueries({ queryKey: ["history"] })
        await queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
        // An attached run was started elsewhere — do not flash "success" for
        // an outcome the user did not initiate.
        return outcome.attached ? undefined : outcome.status
      }),
  }
}
