import { describe, expect, test } from "bun:test"
import { formatInviteCountdown, getInviteExpiry } from "./invite-lifecycle"

const NOW = new Date("2026-11-26T12:00:00Z").getTime()

describe("formatInviteCountdown", () => {
  test("handles minutes, hours, and days", () => {
    expect(formatInviteCountdown(30_000)).toBe("Expires in less than a minute")
    expect(formatInviteCountdown(12 * 60_000)).toBe("Expires in 12 min")
    expect(formatInviteCountdown(3 * 3_600_000 + 12 * 60_000)).toBe(
      "Expires in 3 h 12 min"
    )
    expect(formatInviteCountdown(2 * 86_400_000 + 4 * 3_600_000)).toBe(
      "Expires in 2 days 4 h"
    )
  })

  test("uses singular units", () => {
    expect(formatInviteCountdown(60_000)).toBe("Expires in 1 min")
    expect(formatInviteCountdown(3_600_000)).toBe("Expires in 1 h")
    expect(formatInviteCountdown(86_400_000)).toBe("Expires in 1 day")
  })

  test("is expired at zero and for invalid input", () => {
    expect(formatInviteCountdown(0)).toBe("Expired")
    expect(formatInviteCountdown(Number.NaN)).toBe("Expired")
  })
})

describe("getInviteExpiry", () => {
  test("derives expired from the timestamp even when the API says pending", () => {
    const past = new Date(NOW - 60_000).toISOString()
    expect(getInviteExpiry(past, NOW)).toEqual({
      expired: true,
      msRemaining: 0,
      label: "Expired",
    })
  })

  test("returns the remaining time and label", () => {
    const future = new Date(NOW + 2 * 86_400_000).toISOString()
    const expiry = getInviteExpiry(future, NOW)
    expect(expiry.expired).toBe(false)
    expect(expiry.msRemaining).toBe(2 * 86_400_000)
    expect(expiry.label).toBe("Expires in 2 days")
  })

  test("treats missing or malformed dates as expired", () => {
    expect(getInviteExpiry(null, NOW).expired).toBe(true)
    expect(getInviteExpiry("garbage", NOW).expired).toBe(true)
  })
})
