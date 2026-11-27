/**
 * Effective origin of an incoming request, respecting the same
 * `AUTH_TRUST_PROXY` flag used for WebAuthn/login protection.
 *
 * Used by Bro Space address detection and the Tailscale helper so suggested
 * URLs use the real request port (not a hard-coded `PORT || 3000`).
 */

export type RequestOriginInfo = {
  origin: string
  protocol: "http" | "https"
  /** host[:port] */
  host: string
  hostname: string
  /** Explicit port from the Host header, or null for the protocol default. */
  port: string | null
  trustProxy: boolean
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim()
  return first || null
}

export function getRequestOrigin(request: {
  headers: Headers
  url: string
}): RequestOriginInfo {
  const trustProxy = process.env.AUTH_TRUST_PROXY?.trim().toLowerCase() === "true"

  let fallback: URL
  try {
    fallback = new URL(request.url)
  } catch {
    fallback = new URL("http://localhost")
  }

  const forwardedHost = trustProxy
    ? firstHeaderValue(request.headers.get("x-forwarded-host"))
    : null
  const hostHeader = request.headers.get("host")?.trim() || null
  const host = forwardedHost || hostHeader || fallback.host

  const forwardedProto = trustProxy
    ? firstHeaderValue(request.headers.get("x-forwarded-proto"))
    : null
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : fallback.protocol === "https:"
        ? "https"
        : "http"

  try {
    const parsed = new URL(`${protocol}://${host}`)
    return {
      origin: parsed.origin,
      protocol,
      host: parsed.host,
      hostname: parsed.hostname,
      port: parsed.port || null,
      trustProxy,
    }
  } catch {
    return {
      origin: fallback.origin,
      protocol,
      host: fallback.host,
      hostname: fallback.hostname,
      port: fallback.port || null,
      trustProxy,
    }
  }
}
