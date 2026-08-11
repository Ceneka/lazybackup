import { describe, expect, test } from 'bun:test'
import { scoreServerMatch } from './discovery'

describe('scoreServerMatch', () => {
  const server = {
    id: 'abc123',
    name: 'WordPress Prod',
    host: 'wp.example.com',
  }

  test('exact id scores highest', () => {
    expect(scoreServerMatch('abc123', server)).toBe(100)
  })

  test('exact name/host scores high', () => {
    expect(scoreServerMatch('WordPress Prod', server)).toBe(90)
    expect(scoreServerMatch('wp.example.com', server)).toBe(90)
  })

  test('prefix and substring match', () => {
    expect(scoreServerMatch('word', server)).toBe(70)
    expect(scoreServerMatch('press', server)).toBe(50)
  })

  test('multi-token overlap', () => {
    expect(scoreServerMatch('wordpress prod', server)).toBeGreaterThan(0)
  })

  test('no match is zero', () => {
    expect(scoreServerMatch('database-only', server)).toBe(0)
  })
})
