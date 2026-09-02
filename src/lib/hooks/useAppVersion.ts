import { APP_VERSION } from "@/lib/app-version"
import { useQuery } from "@tanstack/react-query"

export type AppVersionInfo = {
  current: string
  latest: string | null
  htmlUrl: string | null
  updateAvailable: boolean
  status: "ok" | "unknown"
  checkedAt: string
}

export const versionKeys = {
  all: ["app-version"] as const,
}

function unknownInfo(): AppVersionInfo {
  return {
    current: APP_VERSION,
    latest: null,
    htmlUrl: null,
    updateAvailable: false,
    status: "unknown",
    checkedAt: new Date().toISOString(),
  }
}

/** Settings (and similar) — 1h staleTime; server caches GitHub for ~24h. Never throws. */
export function useAppVersion() {
  return useQuery({
    queryKey: versionKeys.all,
    queryFn: async (): Promise<AppVersionInfo> => {
      try {
        const res = await fetch("/api/version")
        if (!res.ok) return unknownInfo()
        return res.json()
      } catch {
        return unknownInfo()
      }
    },
    staleTime: 60 * 60 * 1000,
    retry: false,
  })
}
