import { APP_NAME, APP_VERSION } from '@/lib/app-version'
import { isNewerVersion, isPrereleaseTag, parseSemver, stripVersionPrefix } from './semver'

export const GITHUB_RELEASES_LATEST_URL =
  'https://api.github.com/repos/Ceneka/lazybackup/releases/latest'

/** In-memory TTL for GitHub latest. Shared by Settings and Status. */
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000

const FETCH_TIMEOUT_MS = 5_000

export type AppUpdateStatus = 'ok' | 'unknown'

export type AppUpdateInfo = {
  current: string
  latest: string | null
  htmlUrl: string | null
  updateAvailable: boolean
  status: AppUpdateStatus
  checkedAt: string
}

type GithubReleasePayload = {
  tag_name?: unknown
  html_url?: unknown
  prerelease?: unknown
}

type CacheEntry = {
  at: number
  value: AppUpdateInfo
}

let cache: CacheEntry | null = null

export function clearUpdateCheckCache(): void {
  cache = null
}

function unknownInfo(current: string, checkedAt: Date): AppUpdateInfo {
  return {
    current,
    latest: null,
    htmlUrl: null,
    updateAvailable: false,
    status: 'unknown',
    checkedAt: checkedAt.toISOString(),
  }
}

function githubUserAgent(): string {
  return `${APP_NAME}/${APP_VERSION} (+https://github.com/Ceneka/lazybackup)`
}

/** Map a GitHub release JSON body to update info. Never throws. */
export function updateFromGithubRelease(
  payload: unknown,
  current: string,
  checkedAt: Date = new Date()
): AppUpdateInfo {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return unknownInfo(current, checkedAt)
    }
    const body = payload as GithubReleasePayload
    if (body.prerelease === true) {
      return unknownInfo(current, checkedAt)
    }
    const tag = typeof body.tag_name === 'string' ? body.tag_name.trim() : ''
    const htmlUrl = typeof body.html_url === 'string' ? body.html_url.trim() : ''
    if (!tag || isPrereleaseTag(tag) || !parseSemver(tag)) {
      return unknownInfo(current, checkedAt)
    }
    const latest = stripVersionPrefix(tag)
    const updateAvailable = isNewerVersion(tag, current)
    return {
      current,
      latest,
      htmlUrl: htmlUrl || null,
      updateAvailable,
      status: 'ok',
      checkedAt: checkedAt.toISOString(),
    }
  } catch {
    return unknownInfo(current, checkedAt)
  }
}

async function fetchLatestFromGithub(
  fetcher: typeof fetch,
  current: string,
  checkedAt: Date
): Promise<AppUpdateInfo> {
  try {
    const res = await fetcher(GITHUB_RELEASES_LATEST_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': githubUserAgent(),
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 404 || res.status === 403 || res.status === 429 || !res.ok) {
      return unknownInfo(current, checkedAt)
    }
    const json: unknown = await res.json()
    return updateFromGithubRelease(json, current, checkedAt)
  } catch {
    return unknownInfo(current, checkedAt)
  }
}

/**
 * Latest GitHub release vs running APP_VERSION. Cached ~24h in-process.
 * Failures (offline, rate-limit, 404, malformed) are `unknown`, never thrown.
 */
export async function getAppUpdateInfo(options?: {
  fetch?: typeof fetch
  now?: number
  current?: string
}): Promise<AppUpdateInfo> {
  const current = options?.current ?? APP_VERSION
  const now = options?.now ?? Date.now()
  if (cache && now - cache.at < UPDATE_CHECK_TTL_MS) {
    return cache.value
  }
  const checkedAt = new Date(now)
  const fetcher = options?.fetch ?? globalThis.fetch
  const value = await fetchLatestFromGithub(fetcher, current, checkedAt)
  cache = { at: now, value }
  return value
}
