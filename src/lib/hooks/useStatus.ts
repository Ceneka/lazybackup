import { useQuery } from "@tanstack/react-query"
import type {
  StatusCheck,
  StatusSeverity,
  StatusSummary,
} from "@/lib/status/build-status"

export type StatusData = {
  generatedAt: string
  summary: StatusSummary
  auth: {
    authEnabled: boolean
    hasPassword: boolean
    hasPasskeys: boolean
    passkeyCount: number
  }
  encryption: {
    configured: boolean
    needsExportAck: boolean
    encryptionInUse: boolean
    keyCount: number
    recoveryRecipientCount: number
    activeKeyExportAcknowledged: boolean
    compromisedKeyCount: number
  }
  instanceBackup: {
    configCount: number
    enabledCount: number
    withPassphraseCount: number
    lastSuccess: null | {
      configId: string
      configName: string
      historyId: string
      startTime: string
      endTime: string | null
      artifactPath: string | null
      ageDays: number
    }
  }
  notifications: {
    failureWebhookConfigured: boolean
  }
  apiTokens: {
    activeCount: number
    remoteExecCount: number
  }
  backups: {
    total: number
    enabled: number
    encryptedOrPeerCount: number
    failedLast24h: number
    overdueSchedules?: { id: string; name: string }[]
  }
  servers: {
    total: number
    passwordOnlyCount: number
  }
  cookieSecure: boolean
  checks: StatusCheck[]
}

export type { StatusCheck, StatusSeverity, StatusSummary }

export const statusKeys = {
  all: ["status"] as const,
}

export function useStatus() {
  return useQuery({
    queryKey: statusKeys.all,
    queryFn: async (): Promise<StatusData> => {
      const res = await fetch("/api/status")
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || "Failed to load status")
      }
      return res.json()
    },
    refetchInterval: 60_000,
  })
}
