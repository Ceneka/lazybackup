import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { NextRequest } from 'next/server'

type Write = { kind: 'insert' | 'update' | 'delete'; values?: unknown }
const writes: Write[] = []

mock.module('@/lib/db', () => ({
  db: {
    query: {
      settings: {
        findFirst: async () => null,
      },
    },
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: async (values: unknown) => {
        writes.push({ kind: 'insert', values })
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          writes.push({ kind: 'update', values })
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        writes.push({ kind: 'delete' })
      },
    }),
  },
}))

const { POST } = await import('@/app/api/settings/route')

function request(body: unknown) {
  return new NextRequest('http://127.0.0.1/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  writes.length = 0
})

afterAll(async () => {
  mock.restore()
  const freshDb = await import(`../../../lib/db/index.ts?real=${Date.now()}`)
  mock.module('@/lib/db', () => freshDb)
})

describe('POST /api/settings webhook validation', () => {
  test('rejects javascript: webhook URLs without writing', async () => {
    const response = await POST(
      request({ key: 'failureWebhookUrl', value: 'javascript:alert(1)' })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('failureWebhookUrl'),
    })
    expect(writes).toHaveLength(0)
  })

  test('rejects data: and relative webhook URLs without writing', async () => {
    for (const value of ['data:text/html,<script>x</script>', '/relative/hook', 'not a url']) {
      const response = await POST(request({ key: 'failureWebhookUrl', value }))
      expect(response.status).toBe(400)
    }
    expect(writes).toHaveLength(0)
  })

  test('rejects unsupported webhook methods without writing', async () => {
    for (const key of ['failureWebhookMethod', 'successPingMethod']) {
      const response = await POST(request({ key, value: 'DELETE' }))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining(key),
      })
    }
    expect(writes).toHaveLength(0)
  })

  test('rejects a batch when any value is invalid and writes nothing', async () => {
    const response = await POST(
      request({
        settings: {
          failureWebhookMethod: 'GET',
          successPingUrl: 'javascript:alert(1)',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  test('accepts http(s) URLs, including tag templates', async () => {
    const response = await POST(
      request({
        settings: {
          failureWebhookUrl:
            'https://kuma.example.com/api/push/TOKEN?status=down&msg={{errorMessage}}',
          failureWebhookMethod: 'GET',
          successPingUrl: 'http://127.0.0.1:8080/ping',
          successPingMethod: 'POST',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(writes).toHaveLength(4)
  })

  test('still rejects an invalid timezone', async () => {
    const response = await POST(request({ key: 'timezone', value: 'Not/AZone' }))

    expect(response.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
})
