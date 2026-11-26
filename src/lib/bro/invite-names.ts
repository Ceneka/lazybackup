/**
 * Local-only display names for invites.
 *
 * The pairing API stores the inviter's label (shown to the friend) but not the
 * friend's name on the host row until they pair. Remembering the name in
 * localStorage keeps the waiting list human-readable across reloads without a
 * schema/API change. Never throws (private mode / storage disabled).
 */

const FRIEND_PREFIX = "lazybackup.broInviteFriend."
const OWNER_KEY = "lazybackup.broOwnerName"
const MAX_NAME_LENGTH = 80

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH)
}

export function rememberInviteFriendName(inviteCode: string, name: string): void {
  const code = inviteCode.trim()
  const value = cleanName(name)
  const store = storage()
  if (!store || !code || !value) return
  try {
    store.setItem(`${FRIEND_PREFIX}${code}`, value)
  } catch {
    // quota/private mode — the invite still works
  }
}

export function recallInviteFriendName(inviteCode: string): string | null {
  const code = inviteCode.trim()
  const store = storage()
  if (!store || !code) return null
  try {
    const value = store.getItem(`${FRIEND_PREFIX}${code}`)?.trim()
    return value || null
  } catch {
    return null
  }
}

export function rememberOwnerName(name: string): void {
  const value = cleanName(name)
  const store = storage()
  if (!store || !value) return
  try {
    store.setItem(OWNER_KEY, value)
  } catch {
    // ignore
  }
}

export function recallOwnerName(): string {
  const store = storage()
  if (!store) return ""
  try {
    return store.getItem(OWNER_KEY)?.trim().slice(0, MAX_NAME_LENGTH) || ""
  } catch {
    return ""
  }
}
