import { describe, expect, test } from "bun:test"
import {
  PEER_ONLINE_WINDOW_MS,
  derivePeerStatus,
  formatRelativeTime,
  humanizePeerError,
  peerKindLabel,
} from "./peer-status"

const NOW = new Date("2026-11-26T12:00:00Z").getTime()

describe("derivePeerStatus", () => {
  test("reports online when the API says so", () => {
    expect(derivePeerStatus({ online: true }, NOW)).toEqual({
      tone: "online",
      label: "Online now",
      reachable: true,
    })
  })

  test("falls back to a 90-second last-seen window", () => {
    const recent = new Date(NOW - PEER_ONLINE_WINDOW_MS + 1_000).toISOString()
    expect(derivePeerStatus({ lastSeenAt: recent }, NOW).tone).toBe("online")
  })

  test("shows a relative last-seen label when idle", () => {
    const old = new Date(NOW - 12 * 60_000).toISOString()
    const status = derivePeerStatus({ lastSeenAt: old, online: false }, NOW)
    expect(status.tone).toBe("idle")
    expect(status.label).toBe("Last seen 12 minutes ago")
    expect(status.reachable).toBe(false)
  })

  test("never connected when there is no timestamp", () => {
    expect(derivePeerStatus({}, NOW)).toEqual({
      tone: "never",
      label: "Never connected",
      reachable: false,
    })
  })

  test("reported errors win over presence", () => {
    const status = derivePeerStatus(
      {
        online: true,
        lastSeenAt: new Date(NOW).toISOString(),
        remoteLastError: "Quota exceeded",
      },
      NOW
    )
    expect(status.tone).toBe("attention")
    expect(status.label).toBe("Needs attention")
  })

  test("revoked wins over everything", () => {
    expect(
      derivePeerStatus({ status: "revoked", online: true }, NOW).tone
    ).toBe("revoked")
  })
})

describe("formatRelativeTime", () => {
  test("formats minutes, hours, days", () => {
    expect(formatRelativeTime(new Date(NOW - 10_000), NOW)).toBe("just now")
    expect(formatRelativeTime(new Date(NOW - 60_000), NOW)).toBe("1 minute ago")
    expect(formatRelativeTime(new Date(NOW - 2 * 3_600_000), NOW)).toBe(
      "2 hours ago"
    )
    expect(formatRelativeTime(new Date(NOW - 2 * 86_400_000), NOW)).toBe(
      "2 days ago"
    )
  })

  test("returns null for bad input", () => {
    expect(formatRelativeTime("garbage", NOW)).toBeNull()
  })
})

describe("humanizePeerError", () => {
  test("maps a full folder without raw bytes", () => {
    expect(
      humanizePeerError("Quota exceeded: need 3147560 bytes", "Alex")
    ).toBe("Alex’s folder is full")
  })

  test("maps unreachable transports", () => {
    expect(humanizePeerError("fetch failed", "Alex")).toBe(
      "Couldn’t reach Alex’s computer"
    )
    expect(humanizePeerError("connect ECONNREFUSED", "Alex")).toBe(
      "Couldn’t reach Alex’s computer"
    )
  })

  test("maps auth failures", () => {
    expect(humanizePeerError("Ping failed (401)", "Alex")).toBe(
      "Alex’s app no longer accepts this connection"
    )
  })

  test("falls back to a generic sentence and hides null", () => {
    expect(humanizePeerError("weird parser output", "Alex")).toBe(
      "Alex’s app reported a problem"
    )
    expect(humanizePeerError(null, "Alex")).toBeNull()
  })
})

describe("peerKindLabel", () => {
  test("prefers the API kind and falls back to the URL", () => {
    expect(peerKindLabel({ kind: "lazybro", remoteBaseUrl: "http://x" })).toBe(
      "LazyBro app"
    )
    expect(peerKindLabel({ kind: "lazybackup" })).toBe("LazyBackup")
    expect(peerKindLabel({ remoteBaseUrl: "http://x" })).toBe("LazyBackup")
    expect(peerKindLabel({ remoteBaseUrl: "" })).toBe("LazyBro app")
  })
})
