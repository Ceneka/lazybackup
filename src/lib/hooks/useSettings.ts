import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Type definitions
export interface SettingItem {
  id: string
  key: string
  value: string | null
  createdAt: string
  updatedAt: string
}

export type Settings = Record<string, string | null>

type SettingsPayload = Record<string, string>

const SETTING_LABELS: Record<string, string> = {
  timezone: "Timezone",
  defaultSshKeyPath: "Default SSH key path",
  sshKeepAliveInterval: "SSH keep-alive interval",
  failureWebhookUrl: "Failure webhook URL",
  failureWebhookMethod: "Failure webhook method",
  failureWebhookHeaders: "Failure webhook headers",
  failureWebhookBody: "Failure webhook body",
  successPingUrl: "Success ping URL",
  successPingMethod: "Success ping method",
  successPingHeaders: "Success ping headers",
  successPingBody: "Success ping body",
}

function labelFor(key: string, fallback?: string): string {
  return SETTING_LABELS[key] ?? fallback ?? "Setting"
}

type UpdateSettingInput = { key: string; value: string | null; label?: string }
type UpdateSettingsInput = { values: SettingsPayload; label?: string }

// Hook for managing settings
export function useSettings() {
  const queryClient = useQueryClient()

  // Fetch settings
  const query = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await fetch("/api/settings")

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Failed to fetch settings")
      }

      return response.json()
    },
  })
  const settings = query.data ?? {}

  const applyToCache = (updated: Record<string, string | null>) => {
    queryClient.setQueryData<Settings>(["settings"], (old = {}) => ({
      ...old,
      ...updated,
    }))
  }

  const invalidateDerived = (updated: Record<string, string | null>) => {
    if ("timezone" in updated) {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      void queryClient.invalidateQueries({ queryKey: ["backup"] })
      void queryClient.invalidateQueries({ queryKey: ["backups"] })
    }
  }

  // Update one setting (single-key request; kept for callers that only change one value).
  const updateSetting = useMutation({
    mutationFn: async ({ key, value }: UpdateSettingInput) => {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, value }),
      })

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(error.error || "Failed to update setting")
      }

      return { ...(await response.json()), key } as { key: string; value: string | null }
    },
    onSuccess: (data, variables) => {
      applyToCache({ [data.key]: data.value })
      invalidateDerived({ [data.key]: data.value ?? "" })
      toast.success(`${labelFor(data.key, variables.label)} saved`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update setting")
    },
  })

  /**
   * Save several settings in one request. No-op writes are filtered out on the
   * client so blurring an unchanged field does not POST or toast.
   */
  const updateSettings = useMutation({
    mutationFn: async ({ values, label }: UpdateSettingsInput) => {
      const current = queryClient.getQueryData<Settings>(["settings"]) ?? {}
      const changed = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => current[key] !== value)
      ) as SettingsPayload

      if (Object.keys(changed).length === 0) {
        return { updated: {}, label, unchanged: true }
      }

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ settings: changed }),
      })

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(error.error || "Failed to save settings")
      }

      const data = (await response.json()) as { settings?: SettingsPayload }
      return { updated: data.settings ?? changed, label, unchanged: false }
    },
    onSuccess: (data) => {
      applyToCache(data.updated)
      invalidateDerived(data.updated)
      if (!data.unchanged) {
        const keys = Object.keys(data.updated)
        const label =
          keys.length === 1 ? labelFor(keys[0], data.label) : data.label ?? "Settings"
        toast.success(`${label} saved`)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings")
    },
  })

  // Delete setting
  const deleteSetting = useMutation({
    mutationFn: async (key: string) => {
      const response = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(error.error || "Failed to delete setting")
      }

      return response.json()
    },
    onSuccess: (_data, key) => {
      queryClient.setQueryData<Settings>(["settings"], (old = {}) => {
        const newSettings = { ...old }
        delete newSettings[key]
        return newSettings
      })
      toast.success(`${labelFor(key)} deleted`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete setting")
    },
  })

  return {
    // Real query fields — pages can pass this straight to QueryState.
    ...query,
    hasLoaded: query.data !== undefined,
    settings,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    updateSetting,
    updateSettings,
    deleteSetting,
    // Helper to get specific setting value with default
    getSetting: (key: string, defaultValue: string | null = null): string | null => {
      return settings[key] !== undefined ? settings[key] : defaultValue
    },
  }
}
