import { LAZYBRO_RELEASE_URL } from "./download-links"

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})

/** 25 → "25", 12.5 → "12.5", 12.50 → "12.5" */
export function formatQuotaGb(quotaGb: number): string {
  if (!Number.isFinite(quotaGb)) return "0"
  const rounded = Math.round(quotaGb * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * "Nov 29" — deliberately short: the message is meant for a chat, not a log.
 * Invalid dates fall back to "soon" so a broken expiry does not leak `Invalid Date`.
 */
export function formatInviteExpiry(expiresAt: string | Date): string {
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return "soon"
  return EXPIRY_FORMAT.format(date)
}

export type InviteMessageInput = {
  friendName: string
  inviteCode: string
  quotaGb: number
  expiresAt: string | Date
}

/**
 * The message the host copies into a chat with their friend.
 *
 * Unit-tested in `invite-message.test.ts`; keep the wording friendly and complete:
 * a non-technical friend must be able to follow it without opening this app.
 */
export function buildInviteMessage(input: InviteMessageInput): string {
  const friend = input.friendName.trim() || "there"
  const code = input.inviteCode.trim()
  const quota = formatQuotaGb(input.quotaGb)
  const expiry = formatInviteExpiry(input.expiresAt)

  return [
    `Hi ${friend} — I set up a shared backup folder for you on my LazyBackup.`,
    "",
    `1. Download LazyBro: ${LAZYBRO_RELEASE_URL}`,
    "2. Open it and paste this invite:",
    code,
    `3. Choose a folder with about ${quota} GB free, and leave LazyBro running.`,
    "",
    `The invite expires on ${expiry}. Everything I store is encrypted — you can't open it.`,
  ].join("\n")
}
