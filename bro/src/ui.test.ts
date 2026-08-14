import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import path from 'path'

const html = readFileSync(path.join(import.meta.dir, 'ui', 'index.html'), 'utf8')

describe('LazyBro UI', () => {
  test('hides reverse folder backup instead of removing the API form', () => {
    expect(html).toContain('Your folder backup')
    expect(html).toMatch(/<section[^>]*\bhidden\b[\s\S]{0,120}Your folder backup/)
    expect(html).toContain('/api/backup')
  })

  test('shows a stay-online banner when recalls are pending', () => {
    expect(html).toContain('Your friend is restoring a backup — stay online.')
    expect(html).toContain('id="recallBanner"')
    expect(html).toContain('pendingRecalls')
  })

  test('renders untrusted status fields without innerHTML and authenticates API calls', () => {
    expect(html).not.toContain('.innerHTML')
    expect(html).toContain('textContent')
    expect(html).toContain('X-LazyBro-Token')
    expect(html).toContain('X-LazyBro-CSRF')
    expect(html).toContain('__LAZYBRO_API_TOKEN__')
  })
})
