import { describe, expect, test } from 'bun:test'
import { ERROR_SNIPPET_MAX, errorSnippet } from './error-snippet'

describe('errorSnippet', () => {
  test('returns null for empty input', () => {
    expect(errorSnippet(null)).toBeNull()
    expect(errorSnippet(undefined)).toBeNull()
    expect(errorSnippet('')).toBeNull()
    expect(errorSnippet('   \n\t  ')).toBeNull()
  })

  test('collapses verbose multiline errors to one line', () => {
    const snippet = errorSnippet('Command failed: rsync\nssh: no route to host\r\nrsync error: 255')
    expect(snippet).toBe('Command failed: rsync ssh: no route to host rsync error: 255')
  })

  test('truncates huge errors instead of dumping them', () => {
    const huge = `Command failed: ${'x'.repeat(8000)}\n${'y'.repeat(8000)}`
    const snippet = errorSnippet(huge)
    expect(snippet).not.toBeNull()
    expect(snippet!.length).toBe(ERROR_SNIPPET_MAX)
    expect(snippet!.endsWith('…')).toBe(true)
    expect(snippet).not.toContain('\n')
  })
})
