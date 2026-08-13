"use client"

import { backupKeys, runBackupUntilDone } from "@/lib/hooks/useBackups"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return body.error || fallback
}

export async function testServerConnection(id: string, name: string) {
  const response = await fetch(`/api/servers/${id}/test`)
  const data = (await response.json()) as {
    success?: boolean
    rsyncAvailable?: boolean
    scpAvailable?: boolean
    message?: string
    error?: string
  }
  if (!response.ok || !data.success) {
    throw new Error(data.error || data.message || "Connection failed")
  }
  if (data.rsyncAvailable) {
    toast.success(`${name}: connection OK (rsync)`)
  } else if (data.scpAvailable) {
    toast.info(`${name}: connected — backups will fall back to SCP`)
  } else {
    toast.error(`${name}: no rsync on remote and no local scp`)
  }
}

export async function testStoredS3Profile(id: string, name: string) {
  const response = await fetch(`/api/s3-profiles/${id}/test`)
  if (!response.ok) {
    throw new Error(await readError(response, "S3 connection failed"))
  }
  toast.success(`${name}: S3 connection OK`)
}

export async function startBackupRun(id: string, name: string) {
  const outcome = await runBackupUntilDone(id)
  if (outcome.status === "success") {
    toast.success(`${name}: backup completed`)
  } else {
    toast.error(outcome.errorMessage || `${name}: backup failed`)
  }
  return outcome
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
    runBackup: (id: string, name: string) =>
      run(`backup:${id}`, async () => {
        const outcome = await startBackupRun(id, name)
        await queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        await queryClient.invalidateQueries({ queryKey: ["history"] })
        await queryClient.invalidateQueries({ queryKey: backupKeys.lists() })
        return outcome.status
      }),
  }
}
