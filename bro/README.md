# LazyBro

Lend a folder to a friend who runs LazyBackup. Install LazyBro, paste their invite, choose a folder, leave it running. Everything your friend stores is encrypted before it reaches your computer — you can’t open it.

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

Every release also publishes a `SHA256SUMS` file. Verify your download from the same folder (only the files you downloaded are checked):

```bash
curl -fsSLO https://github.com/Ceneka/lazybackup/releases/download/lazybro/SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

On macOS use `shasum -a 256 -c SHA256SUMS --ignore-missing`; on Windows compare `certutil -hashfile lazybro-windows-x64.exe SHA256` with the matching line.

A page opens on your computer (`http://127.0.0.1:3789`). If LazyBro is already running, a second launch prints that URL and exits.

## Setup

1. **Your name** — so your friend knows it’s you.
2. **Paste the invite your friend sent you** — the whole message is fine; it contains a code that starts with `lb1.`
3. **Choose a folder** — LazyBro suggests your home folder, Documents, Desktop, and any external disks, with free space for each. You can also type a full path. The folder is created if it doesn’t exist.

When you’re connected, LazyBro shows how much space you’re lending, how much is in use, and when it last checked in. Turn on **Start LazyBro when I log in** so your friend’s backups keep working after a restart.

## Everyday use

- Keep LazyBro running (or let it start at login). Restores and new backups only move while it’s open.
- The **Activity** card tells you when a backup is arriving, when your friend is restoring one, or when everything is caught up.
- Your friend never sees the contents of what’s stored — only encrypted files.
- If your friend’s LazyBackup is offline for a bit, LazyBro quietly retries.

## Changing the folder

You can change the folder while nothing is stored yet; LazyBro checks that it can write there first.

Once backups are stored, changing the folder is locked: moving the folder without moving the encrypted files would make those backups unreachable. **Disconnect first**, or move the files yourself to the new folder before changing the setting.

## Disconnect

**Disconnect from …** at the bottom of the page removes the copies of your friend’s backups stored on this computer, forgets the connection, and stops sharing the folder. The folder itself stays where it is. Ask your friend first — they may still need those copies. Keep the invite message if you want to connect again later; otherwise your friend can send a new invite.

## Troubleshooting

- **“That invite doesn’t look right”** — copy the whole message from your friend. The code inside starts with `lb1.`
- **“Can’t reach your friend’s LazyBackup”** — your friend’s address is wrong, their LazyBackup is off, or you’re on a different network. Ask them to check the address and send a new invite.
- **“…need more space than you agreed to lend”** — your friend’s backups reached the limit you agreed on. Ask them to keep fewer backups, or agree on a bigger limit (they create a new invite). LazyBro won’t receive new backups until there is room.
- **“This disk is full”** — the disk holding your folder ran out of space. Free some up; LazyBro retries automatically.
- **“Your friend removed this connection”** — ask them for a new invite, then disconnect here and connect again.

Data lives in `~/.local/share/lazybro` (Linux), `~/Library/Application Support/LazyBro` (macOS), or `%APPDATA%\LazyBro` (Windows). The folder you share is separate and is the only place backup files are stored.

## Build binaries

```bash
bun run build
```

Outputs go to `dist/`.

## Desktop installers

Tray apps and installers are planned — see [desktop/README.md](./desktop/README.md).
