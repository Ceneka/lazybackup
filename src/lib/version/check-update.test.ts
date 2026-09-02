import { describe, expect, mock, test } from 'bun:test'
import {
  clearUpdateCheckCache,
  getAppUpdateInfo,
  GITHUB_RELEASES_LATEST_URL,
  UPDATE_CHECK_TTL_MS,
  updateFromGithubRelease,
} from './check-update'

describe('updateFromGithubRelease', () => {
  test('v0.3.0 vs 0.2.0 is an update', () => {
    const info = updateFromGithubRelease(
      {
        tag_name: 'v0.3.0',
        html_url: 'https://github.com/Ceneka/lazybackup/releases/tag/v0.3.0',
        prerelease: false,
      },
      '0.2.0',
      new Date('2026-09-02T00:00:00.000Z')
    )
    expect(info.updateAvailable).toBe(true)
    expect(info.latest).toBe('0.3.0')
    expect(info.status).toBe('ok')
    expect(info.htmlUrl).toContain('/releases/tag/v0.3.0')
  })

  test('equal tag is not an update', () => {
    const info = updateFromGithubRelease(
      { tag_name: 'v0.2.0', html_url: 'https://example.com/r', prerelease: false },
      '0.2.0'
    )
    expect(info.updateAvailable).toBe(false)
    expect(info.latest).toBe('0.2.0')
    expect(info.status).toBe('ok')
  })

  test('malformed or pre-release payload is unknown, never throws', () => {
    expect(() => updateFromGithubRelease(null, '0.2.0')).not.toThrow()
    expect(updateFromGithubRelease(null, '0.2.0').updateAvailable).toBe(false)
    expect(updateFromGithubRelease({ tag_name: 'lazybro' }, '0.2.0').status).toBe(
      'unknown'
    )
    expect(
      updateFromGithubRelease(
        { tag_name: 'v0.9.0-rc.1', html_url: 'https://x', prerelease: false },
        '0.2.0'
      ).updateAvailable
    ).toBe(false)
    expect(
      updateFromGithubRelease(
        { tag_name: 'v0.9.0', html_url: 'https://x', prerelease: true },
        '0.2.0'
      ).status
    ).toBe('unknown')
  })
})

describe('getAppUpdateInfo', () => {
  test('caches GitHub for the TTL and treats 404 as unknown', async () => {
    clearUpdateCheckCache()
    const fetchOk = mock(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(GITHUB_RELEASES_LATEST_URL)
      expect(new Headers(init?.headers).get('User-Agent')).toContain('LazyBackup/')
      return new Response(
        JSON.stringify({
          tag_name: 'v0.3.0',
          html_url: 'https://github.com/Ceneka/lazybackup/releases/tag/v0.3.0',
          prerelease: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })

    const first = await getAppUpdateInfo({
      fetch: fetchOk as typeof fetch,
      now: 1_000,
      current: '0.2.0',
    })
    expect(first.updateAvailable).toBe(true)
    const second = await getAppUpdateInfo({
      fetch: fetchOk as typeof fetch,
      now: 1_000 + 60_000,
      current: '0.2.0',
    })
    expect(second.updateAvailable).toBe(true)
    expect(fetchOk).toHaveBeenCalledTimes(1)

    const fetch404 = mock(
      async () => new Response('Not Found', { status: 404 })
    )
    const afterTtl = await getAppUpdateInfo({
      fetch: fetch404 as typeof fetch,
      now: 1_000 + UPDATE_CHECK_TTL_MS + 1,
      current: '0.2.0',
    })
    expect(afterTtl.status).toBe('unknown')
    expect(afterTtl.updateAvailable).toBe(false)
    expect(fetch404).toHaveBeenCalledTimes(1)
  })

  test('offline fetch is unknown and does not throw', async () => {
    clearUpdateCheckCache()
    const fetchFail = mock(async () => {
      throw new Error('network down')
    })
    const info = await getAppUpdateInfo({
      fetch: fetchFail as typeof fetch,
      now: Date.now(),
      current: '0.2.0',
    })
    expect(info.status).toBe('unknown')
    expect(info.updateAvailable).toBe(false)
  })
})
