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

const AUTOSTART_ENV = 'LAZYBRO_AUTOSTART=1';

function compiledBinary(): string | null {
  if (process.execPath && !process.execPath.includes('bun')) {
    return process.execPath;
  }
  return null;
}

function programArguments(): string[] {
  const bin = compiledBinary();
  if (bin) return [bin];
  return ['bun', path.resolve(import.meta.dir, 'main.ts')];
}

function exeQuoted(): string {
  return programArguments().map((a) => `"${a}"`).join(' ');
}

export function linuxSystemdUnitPath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'lazybro.service');
}

function linuxDesktopPath(): string {
  return path.join(os.homedir(), '.config', 'autostart', 'lazybro.desktop');
}

export function macosLaunchAgentPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'ar.zic.lazybro.plist');
}

export function windowsStartupBatPath(): string {
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

export function linuxSystemdUnit(execLine: string): string {
  return [
    '[Unit]',
    'Description=LazyBro — LazyBackup Bro Space agent',
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    'Environment=LAZYBRO_AUTOSTART=1',
    `ExecStart=${execLine}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export function macosLaunchAgentPlist(args: string[]): string {
  const argXml = args
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ar.zic.lazybro</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LAZYBRO_AUTOSTART</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
</dict>
</plist>
`;
}

export function windowsStartupBat(exePath: string): string {
  return [
    '@echo off',
    'set LAZYBRO_AUTOSTART=1',
    `start "LazyBro" /min "${exePath}"`,
    '',
  ].join('\r\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trySpawn(argv: string[]): void {
  try {
    Bun.spawnSync(argv, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    /* optional helper */
  }
}

export function getAutostartStatus(): AutostartStatus {
  if (process.platform === 'linux') {
    const p = linuxSystemdUnitPath();
    const legacy = linuxDesktopPath();
    return {
      supported: true,
      enabled: fs.existsSync(p) || fs.existsSync(legacy),
      path: fs.existsSync(p) ? p : fs.existsSync(legacy) ? legacy : p,
      hint: 'Creates a systemd --user unit (~/.config/systemd/user/lazybro.service)',
    };
  }
  if (process.platform === 'darwin') {
    const p = macosLaunchAgentPath();
    return {
      supported: true,
      enabled: fs.existsSync(p),
      path: p,
      hint: 'Installs a LaunchAgent so LazyBro starts at login',
    };
  }
  if (process.platform === 'win32') {
    const p = windowsStartupBatPath();
    return {
      supported: true,
      enabled: fs.existsSync(p),
      path: p,
      hint: 'Adds a hidden-start LazyBro.bat to the Windows Startup folder',
    };
  }
  return {
    supported: false,
    enabled: false,
    path: null,
    hint: 'Autostart helpers are available on Linux, macOS, and Windows.',
  };
}

export function enableAutostart(_cfg: BroConfig): AutostartStatus {
  const args = programArguments();
  if (process.platform === 'linux') {
    const p = linuxSystemdUnitPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, linuxSystemdUnit(exeQuoted()));
    try {
      fs.unlinkSync(linuxDesktopPath());
    } catch {
      /* ignore legacy XDG entry */
    }
    trySpawn(['systemctl', '--user', 'daemon-reload']);
    trySpawn(['systemctl', '--user', 'enable', '--now', 'lazybro.service']);
    return getAutostartStatus();
  }
  if (process.platform === 'darwin') {
    const p = macosLaunchAgentPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, macosLaunchAgentPlist(args));
    trySpawn(['launchctl', 'unload', p]);
    trySpawn(['launchctl', 'load', p]);
    return getAutostartStatus();
  }
  if (process.platform === 'win32') {
    const p = windowsStartupBatPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const exe = compiledBinary() || args.join(' ');
    fs.writeFileSync(p, windowsStartupBat(exe));
    return getAutostartStatus();
  }
  return getAutostartStatus();
}

export function disableAutostart(): AutostartStatus {
  if (process.platform === 'linux') {
    trySpawn(['systemctl', '--user', 'disable', '--now', 'lazybro.service']);
    for (const p of [linuxSystemdUnitPath(), linuxDesktopPath()]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } else if (process.platform === 'darwin') {
    const p = macosLaunchAgentPath();
    trySpawn(['launchctl', 'unload', p]);
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  } else if (process.platform === 'win32') {
    try {
      fs.unlinkSync(windowsStartupBatPath());
    } catch {
      /* ignore */
    }
  }
  return getAutostartStatus();
}

export { AUTOSTART_ENV };
