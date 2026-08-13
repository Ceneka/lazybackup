# LazyBro

Share some of your disk with a friend who runs LazyBackup. Install LazyBro, paste their invite, leave it running. That’s it.

## Install

**From source (with [Bun](https://bun.sh)):**

```bash
cd bro
bun install
bun run dev
```

Or download a binary from the [LazyBro release](https://github.com/Ceneka/lazybackup/releases/tag/lazybro):

- Linux x64: https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-linux-x64
- Linux ARM64: https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-linux-arm64
- macOS Apple Silicon: https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-darwin-arm64
- macOS Intel: https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-darwin-x64
- Windows: https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-windows-x64.exe

A small page opens on your computer (`http://127.0.0.1:3789`). If LazyBro is already running, a second launch prints that URL and exits.

## Setup

1. Choose a **folder** on your computer where their backups can live
2. Paste the **invite** they sent you
3. Turn on **Start when I log in** when asked
4. Leave LazyBro open (or running in the background)

Data lives in `~/.local/share/lazybro` (Linux), `~/Library/Application Support/LazyBro` (macOS), or `%APPDATA%\LazyBro` (Windows).

## Tips

- Keep LazyBro running so space stays available and restores can finish
- If their LazyBackup is offline for a bit, LazyBro will quietly retry
- Your friend never sees the contents of what’s stored — only encrypted files

## Build binaries

```bash
bun run build
```

Outputs go to `dist/`.

## Desktop installers

Tray apps and installers are planned — see [desktop/README.md](./desktop/README.md).
