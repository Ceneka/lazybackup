import { describe, expect, test } from "bun:test"

import { formatCount, formatDuration } from "./duration"

describe("formatDuration", () => {
  test("formats sub-minute durations with one decimal", () => {
    expect(formatDuration(4_200)).toBe("4.2s")
    expect(formatDuration(4_000)).toBe("4s")
    expect(formatDuration(450)).toBe("0.5s")
    expect(formatDuration(0)).toBe("0s")
  })

  test("formats minutes and seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 00s")
    expect(formatDuration(724_000)).toBe("12m 04s")
    expect(formatDuration(59_990)).toBe("1m 00s")
  })

  test("formats hours, minutes and seconds", () => {
    expect(formatDuration(3_733_000)).toBe("1h 02m 13s")
    expect(formatDuration(7_200_000)).toBe("2h 00m 00s")
  })

  test("clamps invalid input", () => {
    expect(formatDuration(-1_000)).toBe("0s")
    expect(formatDuration(Number.NaN)).toBe("0s")
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s")
  })
})

describe("formatCount", () => {
  test("groups thousands", () => {
    expect(formatCount(0)).toBe("0")
    expect(formatCount(999)).toBe("999")
    expect(formatCount(1_234_567)).toBe("1,234,567")
  })

  test("handles invalid input", () => {
    expect(formatCount(Number.NaN)).toBe("0")
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("0")
  })
})
