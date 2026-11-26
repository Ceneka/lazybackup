/**
 * LazyBro downloads shown in the invite wizard.
 *
 * Keep this in sync with `bro/README.md` and the floating `lazybro` release.
 * This is the single source for the host UI (do not repeat the URLs in components).
 */
export const LAZYBRO_RELEASE_URL =
  "https://github.com/Ceneka/lazybackup/releases/tag/lazybro"

export type LazyBroDownloadId =
  | "linux-x64"
  | "linux-arm64"
  | "macos-arm64"
  | "macos-x64"
  | "windows-x64"

export type LazyBroDownload = {
  id: LazyBroDownloadId
  label: string
  url: string
}

export const LAZYBRO_DOWNLOADS: readonly LazyBroDownload[] = [
  {
    id: "linux-x64",
    label: "Linux x64",
    url: "https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-linux-x64",
  },
  {
    id: "linux-arm64",
    label: "Linux ARM64",
    url: "https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-linux-arm64",
  },
  {
    id: "macos-arm64",
    label: "macOS Apple silicon",
    url: "https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-darwin-arm64",
  },
  {
    id: "macos-x64",
    label: "macOS Intel",
    url: "https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-darwin-x64",
  },
  {
    id: "windows-x64",
    label: "Windows x64",
    url: "https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-windows-x64.exe",
  },
] as const
