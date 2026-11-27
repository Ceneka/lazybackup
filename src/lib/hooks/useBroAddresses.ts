import { useQuery } from "@tanstack/react-query"
import type { AddressCandidate } from "@/lib/bro/addresses"

export type BroAddressesResponse = {
  instanceBaseUrl: string | null
  allowPrivatePeerUrls: boolean
  candidates: AddressCandidate[]
  port: string | null
  tailscale: {
    available: boolean
    cliAvailable: boolean
    suggestedBaseUrl: string | null
  }
}

export const broAddressKeys = {
  all: ["peers", "addresses"] as const,
}

async function fetchAddresses(): Promise<BroAddressesResponse> {
  const res = await fetch("/api/peers/addresses")
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ||
        "Couldn't detect your addresses. You can enter one manually."
    )
  }
  return res.json()
}

/**
 * Detected invite addresses (saved / Tailscale / LAN / request origin).
 * Detection is server-side; this hook only runs while the wizard is open.
 */
export function useBroAddresses(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: broAddressKeys.all,
    queryFn: fetchAddresses,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    retry: 1,
  })
}
