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
})
