import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BroConfig } from './config';

export type AutostartStatus = {
  supported: boolean;
  enabled: boolean;
  path: string | null;
  hint: string;
};

function exeCommand(): string {
  // Prefer compiled binary path when available
  if (process.execPath && !process.execPath.includes('bun')) {
    return `"${process.execPath}"`;
  }
  const main = path.resolve(import.meta.dir, 'main.ts');
  return `bun "${main}"`;
}

function linuxDesktopPath(): string {
  return path.join(os.homedir(), '.config', 'autostart', 'lazybro.desktop');
}

function windowsRunKeyPath(): string {
  // We write a .bat into Startup folder (no registry deps)
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'LazyBro.bat'
  );
}

export function getAutostartStatus(): AutostartStatus {
  if (process.platform === 'linux') {
    const p = linuxDesktopPath();
    return {
      supported: true,
      enabled: fs.existsSync(p),
      path: p,
      hint: 'Creates ~/.config/autostart/lazybro.desktop',
    };
  }
  if (process.platform === 'win32') {
    const p = windowsRunKeyPath();
    return {
      supported: true,
      enabled: fs.existsSync(p),
      path: p,
      hint: 'Adds LazyBro.bat to the Windows Startup folder',
    };
  }
  return {
    supported: false,
    enabled: false,
    path: null,
    hint: 'Autostart helpers are available on Linux and Windows. On macOS, use Login Items.',
  };
}

export function enableAutostart(_cfg: BroConfig): AutostartStatus {
  const cmd = exeCommand();
  if (process.platform === 'linux') {
    const p = linuxDesktopPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=LazyBro',
        'Comment=LazyBackup Bro Space agent',
        `Exec=${cmd}`,
        'X-GNOME-Autostart-enabled=true',
        'Terminal=false',
        '',
      ].join('\n')
    );
    return getAutostartStatus();
  }
  if (process.platform === 'win32') {
    const p = windowsRunKeyPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `@echo off\r\nstart "" ${cmd}\r\n`);
    return getAutostartStatus();
  }
  return getAutostartStatus();
}

export function disableAutostart(): AutostartStatus {
  if (process.platform === 'linux') {
    const p = linuxDesktopPath();
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  } else if (process.platform === 'win32') {
    const p = windowsRunKeyPath();
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  return getAutostartStatus();
}
