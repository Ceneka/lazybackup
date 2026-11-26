import { classifyIp, normalizeHostname } from "@/lib/net/url-guard"

export type AddressKind =
  | "saved"
  | "tailscale"
  | "lan"
  | "request"
  | "loopback"

export type AddressReach =
  | "anywhere"
  | "tailnet"
  | "same-network"
  | "this-computer"

export type AddressCandidate = {
  kind: AddressKind
  url: string
  reach: AddressReach
  note: string
}

export type AddressCandidateInput = {
  savedBaseUrl?: string | null
  tailscaleBaseUrl?: string | null
  requestOrigin?: string | null
  /** IPv4 addresses from `os.networkInterfaces()` (private/LAN or public). */
  lanIpv4s?: string[]
  /** The port the request arrived on (or another real listening port). */
  port?: string | number | null
  protocol?: "http" | "https" | null
}

const REACH_NOTES: Record<AddressReach, string> = {
  anywhere: "Looks reachable from outside your network.",
  tailnet: "Your friend must also install Tailscale and join your tailnet.",
  "same-network": "Only works while your friend is on your home network.",
  "this-computer":
    "Only works on this computer. Your friend will not be able to connect.",
}

export function noteForReach(reach: AddressReach): string {
  return REACH_NOTES[reach]
}

function normalizePort(port: string | number | null | undefined): string | null {
  if (port === null || port === undefined) return null
  const text = String(port).trim()
  if (!/^\d{1,5}$/.test(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 1 || value > 65_535) return null
  return String(value)
}

/**
 * Accepts `http(s)://host[:port]`, drops credentials/query/hash, and trims
 * trailing slashes. Returns null when the value cannot be an instance URL.
 */
export function normalizeAddressUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (!parsed.hostname) return null
  if (parsed.username || parsed.password) return null
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString().replace(/\/+$/, "")
}

/**
 * How far this address reaches:
 * - `anywhere`: public hostname/IP
 * - `tailnet`: 100.64/10 or fd7a:115c:a1e0::/48
 * - `same-network`: RFC1918/ULA/.local
 * - `this-computer`: loopback/localhost
 */
const LOOPBACK_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "localhost6",
  "ip6-localhost",
  "ip6-loopback",
])

const METADATA_NAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.internal",
  "instance-data",
])

export function addressReachForUrl(raw: string | null | undefined): AddressReach | null {
  const url = normalizeAddressUrl(raw)
  if (!url) return null

  let hostname: string
  try {
    hostname = normalizeHostname(new URL(url).hostname)
  } catch {
    return null
  }

  if (LOOPBACK_NAMES.has(hostname) || hostname.endsWith(".localhost")) {
    return "this-computer"
  }
  if (
    METADATA_NAMES.has(hostname) ||
    hostname.endsWith(".metadata.google.internal")
  ) {
    return null
  }
  if (hostname.endsWith(".local")) {
    return "same-network"
  }

  const ipClass = classifyIp(hostname)
  if (!ipClass) return "anywhere" // a DNS name (public by default)
  switch (ipClass) {
    case "public":
      return "anywhere"
    case "cgnat":
    case "tailscale":
      return "tailnet"
    case "private":
    case "ula":
      return "same-network"
    case "loopback":
      return "this-computer"
    case "linkLocal":
    case "unspecified":
    case "multicast":
    case "reserved":
      return null
    default:
      return null
  }
}

function buildUrl(
  protocol: "http" | "https",
  host: string,
  port: string | null
): string {
  const defaultPort = protocol === "https" ? "443" : "80"
  const suffix = port && port !== defaultPort ? `:${port}` : ""
  return `${protocol}://${host}${suffix}`
}

function kindForReach(reach: AddressReach): AddressKind {
  switch (reach) {
    case "tailnet":
      return "tailscale"
    case "same-network":
      return "lan"
    case "this-computer":
      return "loopback"
    default:
      return "request"
  }
}

/**
 * Detected addresses, in the order we want to show them.
 *
 * - saved address first (the operator already chose it once)
 * - Tailscale from the helper
 * - LAN IPv4 interfaces
 * - the origin this request came in on
 * - loopback as an explicitly red "this computer only" option
 *
 * Duplicates (same normalised URL) are dropped; the first kind wins.
 */
export function buildAddressCandidates(
  input: AddressCandidateInput
): AddressCandidate[] {
  const candidates: AddressCandidate[] = []
  const seen = new Set<string>()
  const protocol = input.protocol === "https" ? "https" : "http"
  const port = normalizePort(input.port)

  const push = (kind: AddressKind, rawUrl: string | null | undefined, reachHint?: AddressReach) => {
    const url = normalizeAddressUrl(rawUrl)
    if (!url) return
    const key = url.toLowerCase()
    if (seen.has(key)) return
    const reach = reachHint ?? addressReachForUrl(url)
    if (!reach) return
    seen.add(key)
    candidates.push({ kind, url, reach, note: noteForReach(reach) })
  }

  push("saved", input.savedBaseUrl)
  push("tailscale", input.tailscaleBaseUrl, "tailnet")

  for (const ip of input.lanIpv4s ?? []) {
    const address = ip.trim()
    if (!address || address.includes(":")) continue
    const ipClass = classifyIp(address)
    if (ipClass === "cgnat" || ipClass === "tailscale") continue // Tailscale card covers it
    if (ipClass === "loopback" || ipClass === "linkLocal" || ipClass === "unspecified") continue
    if (ipClass === "multicast" || ipClass === "reserved" || ipClass === null) continue
    push("lan", buildUrl(protocol, address, port))
  }

  if (input.requestOrigin) {
    const reach = addressReachForUrl(input.requestOrigin)
    if (reach) push(kindForReach(reach), input.requestOrigin)
  }

  if (port) {
    push("loopback", buildUrl(protocol, "127.0.0.1", port))
  }

  return candidates
}

/** A candidate the wizard can actually save and hand to a friend. */
export function isCandidateUsable(
  candidate: AddressCandidate,
  allowPrivatePeerUrls: boolean
): boolean {
  if (candidate.reach === "this-computer") return false
  if (candidate.reach === "same-network" && !allowPrivatePeerUrls) return false
  return true
}

export type AddressValidation =
  | { ok: true; url: string; reach: AddressReach }
  | { ok: false; error: string; reach: AddressReach | null }

/**
 * Inline validation before the wizard saves the address.
 *
 * Loopback is rejected with the exact warning from the audit; private/LAN is
 * rejected when this host has not opted into `ALLOW_PRIVATE_PEER_URLS`.
 */
export function validateAddressInput(
  raw: string,
  options: { allowPrivatePeerUrls: boolean }
): AddressValidation {
  const url = normalizeAddressUrl(raw)
  if (!url) {
    return {
      ok: false,
      error: "Enter a full address starting with http:// or https://.",
      reach: null,
    }
  }

  const reach = addressReachForUrl(url)
  if (!reach) {
    return {
      ok: false,
      error: "That address can’t be used for an invite. Use a public, Tailscale, or home-network address.",
      reach: null,
    }
  }
  if (reach === "this-computer") {
    return {
      ok: false,
      error:
        "Only works on this computer. Your friend will not be able to connect.",
      reach,
    }
  }
  if (reach === "same-network" && !options.allowPrivatePeerUrls) {
    return {
      ok: false,
      error:
        "This address is private. To use it, set ALLOW_PRIVATE_PEER_URLS=true on this LazyBackup host, or use Tailscale or a public address.",
      reach,
    }
  }
  return { ok: true, url, reach }
}
