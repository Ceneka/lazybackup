export type InviteExpiry = {
  expired: boolean
  msRemaining: number
  /** "Expires in 2 days 4 h" / "Expired" — ready for the UI. */
  label: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function dayLabel(value: number): string {
  return `${value} ${value === 1 ? "day" : "days"}`
}

/**
 * Countdown copy for a pending invite.
 *
 * Expiry is derived on the client from `expiresAt` (the API may still say
 * "pending" for a row whose time has passed).
 */
export function formatInviteCountdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return "Expired"
  if (msRemaining < MINUTE) return "Expires in less than a minute"

  if (msRemaining < HOUR) {
    const minutes = Math.max(1, Math.floor(msRemaining / MINUTE))
    return `Expires in ${minutes} min`
  }

  if (msRemaining < DAY) {
    const hours = Math.floor(msRemaining / HOUR)
    const minutes = Math.floor((msRemaining % HOUR) / MINUTE)
    return minutes > 0
      ? `Expires in ${hours} h ${minutes} min`
      : `Expires in ${hours} h`
  }

  const days = Math.floor(msRemaining / DAY)
  const hours = Math.floor((msRemaining % DAY) / HOUR)
  return hours > 0
    ? `Expires in ${dayLabel(days)} ${hours} h`
    : `Expires in ${dayLabel(days)}`
}

export function getInviteExpiry(
  expiresAt: string | Date | null | undefined,
  now: number = Date.now()
): InviteExpiry {
  if (!expiresAt) return { expired: true, msRemaining: 0, label: "Expired" }
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return { expired: true, msRemaining: 0, label: "Expired" }
  }
  const msRemaining = date.getTime() - now
  return {
    expired: msRemaining <= 0,
    msRemaining: Math.max(0, msRemaining),
    label: formatInviteCountdown(msRemaining),
  }
}
