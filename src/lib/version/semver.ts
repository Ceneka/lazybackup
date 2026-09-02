/** Strip a leading `v` / `V` so GitHub tags compare with package.json. */
export function stripVersionPrefix(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

/** Major.minor.patch from a tag or package version. Null if unusable. */
export function parseSemver(raw: string): [number, number, number] | null {
  const s = stripVersionPrefix(raw)
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** True when the tag has a semver pre-release suffix (`-beta`, `-rc.1`, …). */
export function isPrereleaseTag(raw: string): boolean {
  const s = stripVersionPrefix(raw)
  const m = s.match(/^\d+\.\d+\.\d+(.*)$/)
  if (!m) return false
  return m[1].startsWith('-')
}

/**
 * Compare two versions after stripping `v`. Returns 1 / 0 / -1, or null
 * when either side is not `major.minor.patch`. Never throws.
 */
export function compareSemver(a: string, b: string): number | null {
  try {
    const pa = parseSemver(a)
    const pb = parseSemver(b)
    if (!pa || !pb) return null
    for (let i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return 1
      if (pa[i] < pb[i]) return -1
    }
    return 0
  } catch {
    return null
  }
}

/**
 * True when `latest` is a newer stable semver than `current`.
 * Pre-release tags and malformed strings return false (never throws).
 */
export function isNewerVersion(latest: string, current: string): boolean {
  try {
    if (isPrereleaseTag(latest)) return false
    return compareSemver(latest, current) === 1
  } catch {
    return false
  }
}
