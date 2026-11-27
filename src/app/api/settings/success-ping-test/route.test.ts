import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { NextRequest } from 'next/server'

const STORED_PING_URL = 'https://hc-ping.com/stored'

const outbound: Array<{ url: string }> = []

mock.module('@/lib/auth', () => ({
  isSessionAuthorized: async () => true,
}))

mock.module('@/lib/db', () => ({
  db: {
    query: {
      settings: {
        findFirst: async () => ({ key: 'successPingUrl', value: STORED_PING_URL }),
      },
    },
  },
}))

const realNotify = await import('@/lib/notify/success-ping')

mock.module('@/lib/notify/success-ping', () => ({
  ...realNotify,
  postSuccessPing: async (config: { url: string }) => {
    outbound.push({ url: config.url })
    return { ok: true }
  },
}))

const { POST } = await import('@/app/api/settings/success-ping-test/route')

function request(body: string) {
  return new NextRequest('http://127.0.0.1/api/settings/success-ping-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

beforeEach(() => {
  outbound.length = 0
})

afterAll(async () => {
  mock.restore()
  const freshDb = await import(`../../../../lib/db/index.ts?real=${Date.now()}`)
  mock.module('@/lib/db', () => freshDb)
})

describe('POST /api/settings/success-ping-test body validation', () => {
  test('rejects an invalid method instead of firing the stored ping', async () => {
    const response = await POST(request(JSON.stringify({ method: 'PATCH' })))

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; details: unknown[] }
    expect(body.error).toBe('Validation error')
    expect(body.details.length).toBeGreaterThan(0)
    expect(outbound).toHaveLength(0)
  })

  test('rejects malformed JSON instead of firing the stored ping', async () => {
    const response = await POST(request('not-json'))

    expect(response.status).toBe(400)
    expect(outbound).toHaveLength(0)
  })

  test('rejects an explicitly blank URL instead of using the stored one', async () => {
    const response = await POST(request(JSON.stringify({ url: ' ' })))

    expect(response.status).toBe(400)
    expect(outbound).toHaveLength(0)
  })

  test('falls back to the stored URL only when url is omitted', async () => {
    const response = await POST(request(JSON.stringify({ method: 'GET' })))

    expect(response.status).toBe(200)
    expect(outbound).toEqual([{ url: STORED_PING_URL }])
  })
})
