const ENCODED_SLASH = /%2f/i
const ENCODED_BACKSLASH = /%5c/i

/**
 * Same-origin relative path for post-login redirects.
 * Rejects protocol-relative URLs, backslashes, and encoded slashes.
 */
export function safeInternalPath(from: string | null | undefined): string {
  if (!from) return '/'
  if (!from.startsWith('/')) return '/'
  if (from.startsWith('//') || from.startsWith('/\\')) return '/'
  if (from.includes('\\')) return '/'
  if (ENCODED_SLASH.test(from) || ENCODED_BACKSLASH.test(from)) return '/'

  try {
    const decoded = decodeURIComponent(from)
    if (decoded.startsWith('//') || decoded.includes('\\')) return '/'
    if (decoded.includes('://')) return '/'
  } catch {
    return '/'
  }

  return from
}
