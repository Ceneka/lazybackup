# LazyBro

Share some of your disk with a friend who runs LazyBackup. Install LazyBro, paste their invite, leave it running. That’s it.

## Install

**From source (with [Bun](https://bun.sh)):**

```bash
cd bro
bun install
bun run dev
```

Or run a binary from Releases (`lazybro-linux-x64` / `lazybro-windows-x64.exe`).

A small page opens on your computer (`http://127.0.0.1:3789`).

## Setup

1. Choose a **folder** on your computer where their backups can live
2. Paste the **invite** they sent you
3. Turn on **Start when I log in** when asked
4. Leave LazyBro open (or running in the background)

You can also pick one of your own folders to back up to their LazyBackup.

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
