import { describe, expect, test } from "bun:test"
import { successRate } from "./success-rate"

describe("successRate", () => {
  test("returns 0 when there are no runs", () => {
    expect(successRate(0, 0)).toBe(0)
  })

  test("returns 50 for 2 success of 4", () => {
    expect(successRate(2, 4)).toBe(50)
  })

  test("returns 0 when every run failed", () => {
    expect(successRate(0, 4)).toBe(0)
  })

  test("rounds to the nearest percent", () => {
    expect(successRate(1, 3)).toBe(33)
  })
})
