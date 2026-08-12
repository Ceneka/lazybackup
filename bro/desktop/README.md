# LazyBro desktop (Tauri follow-up)

v1 ships as a Bun-compiled binary with a localhost UI and OS autostart helpers.

## Planned Tauri 2 shell

Wrap `lazybro` as a sidecar:

- System tray: Open UI / Sync now / Quit
- Bundlers: AppImage (Linux), NSIS `.exe` (Windows)
- Stronger login-item registration via Tauri plugins

### Suggested layout

```
bro/desktop/
  src-tauri/     # Tauri project
  ui/            # optional thin shell, or open sidecar URL
```

### Scaffold (when ready)

```bash
cd bro/desktop
npm create tauri-app@latest . -- --template vanilla
# configure sidecar path to ../dist/lazybro-*
```

Keep the Bun daemon as the source of truth for pairing, sync, and backup; Tauri only owns tray + installers.
