import { describe, expect, test } from "bun:test"
import {
  buildInviteMessage,
  formatInviteExpiry,
  formatQuotaGb,
} from "./invite-message"

const expiry = new Date(2026, 10, 29, 12, 0, 0) // local noon → stable "Nov 29"
const code = "lb1.eyJ2IjoxLCJ1IjoiaHR0cDovLzE5Mi4xNjguMC4zNjozMTQxIn0"

describe("buildInviteMessage", () => {
  test("builds a complete message a non-technical friend can follow", () => {
    const message = buildInviteMessage({
      friendName: "Alex",
      inviteCode: code,
      quotaGb: 25,
      expiresAt: expiry,
    })

    expect(message).toStartWith(
      "Hi Alex — I set up a shared backup folder for you on my LazyBackup."
    )
    expect(message).toContain(
      "Download LazyBro: https://github.com/Ceneka/lazybackup/releases/tag/lazybro"
    )
    expect(message).toContain(code)
    expect(message).toContain("about 25 GB free")
    expect(message).toContain("leave LazyBro running")
    expect(message).toContain("The invite expires on Nov 29.")
    expect(message).toContain("Everything I store is encrypted")
    expect(message).toContain("you can't open it")
  })

  test("falls back to a neutral greeting and handles fractional quotas", () => {
    const message = buildInviteMessage({
      friendName: "  ",
      inviteCode: `  ${code}  `,
      quotaGb: 12.55,
      expiresAt: expiry,
    })

    expect(message).toStartWith("Hi there —")
    expect(message).toContain("about 12.6 GB free")
    expect(message).toContain(code)
    // No leading/trailing whitespace around the pasted code line
    expect(message.split("\n")).toContain(code)
  })
})

describe("invite expiry formatting", () => {
  test("formats a short month/day", () => {
    expect(formatInviteExpiry(expiry)).toBe("Nov 29")
  })

  test("does not leak Invalid Date", () => {
    expect(formatInviteExpiry("not-a-date")).toBe("soon")
  })
})

describe("formatQuotaGb", () => {
  test("trims integer decimals", () => {
    expect(formatQuotaGb(25)).toBe("25")
    expect(formatQuotaGb(25.0)).toBe("25")
    expect(formatQuotaGb(12.5)).toBe("12.5")
    expect(formatQuotaGb(Number.NaN)).toBe("0")
  })
})
