import { describe, expect, test } from "bun:test"
import { LAZYBRO_DOWNLOADS, LAZYBRO_RELEASE_URL } from "./download-links"

describe("LazyBro download links", () => {
  test("points at the floating lazybro release", () => {
    expect(LAZYBRO_RELEASE_URL).toBe(
      "https://github.com/Ceneka/lazybackup/releases/tag/lazybro"
    )
  })

  test("offers one download per supported platform", () => {
    expect(LAZYBRO_DOWNLOADS.map((d) => d.id)).toEqual([
      "linux-x64",
      "linux-arm64",
      "macos-arm64",
      "macos-x64",
      "windows-x64",
    ])
    for (const download of LAZYBRO_DOWNLOADS) {
      expect(download.url).toStartWith(
        "https://github.com/Ceneka/lazybackup/releases/download/lazybro/"
      )
      expect(download.label.length).toBeGreaterThan(0)
    }
  })

  test("the Windows build keeps its .exe extension", () => {
    const windows = LAZYBRO_DOWNLOADS.find((d) => d.id === "windows-x64")
    expect(windows?.url.endsWith(".exe")).toBe(true)
  })
})
