import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

export type BroConfig = {
  dataDir: string;
  shareDir: string;
  port: number;
  label: string;
  pollIntervalMs: number;
  /** Host LazyBackup base URL after pairing */
  hostBaseUrl: string | null;
  outboundToken: string | null;
  /** Our peer id on the host */
  localPeerId: string | null;
  remotePeerId: string | null;
  remoteLabel: string | null;
  quotaBytes: number;
  folderBackupPath: string | null;
  folderBackupIntervalMs: number;
  lastFolderBackupAt: string | null;
  ageIdentity: string | null;
  ageRecipient: string | null;
  autostartPrompted: boolean;
  openUiOnStart: boolean;
  /** Random bearer used only by the loopback UI/control API. */
  localApiToken: string;
};

const DEFAULTS: BroConfig = {
  dataDir: '',
  shareDir: '',
  port: 3789,
  label: 'LazyBro',
  pollIntervalMs: 45_000,
  hostBaseUrl: null,
  outboundToken: null,
  localPeerId: null,
  remotePeerId: null,
  remoteLabel: null,
  quotaBytes: 0,
  folderBackupPath: null,
  folderBackupIntervalMs: 24 * 3600 * 1000,
  lastFolderBackupAt: null,
  ageIdentity: null,
  ageRecipient: null,
  autostartPrompted: false,
  openUiOnStart: true,
  localApiToken: '',
};

export function defaultDataDirFor(
  platform: NodeJS.Platform | string,
  home: string,
  env: { APPDATA?: string } = {},
  exists: (p: string) => boolean = fs.existsSync
): string {
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'LazyBro');
  }
  if (platform === 'darwin') {
    const next = path.join(home, 'Library', 'Application Support', 'LazyBro');
    const legacy = path.join(home, '.local', 'share', 'lazybro');
    if (!exists(next) && exists(legacy)) return legacy;
    return next;
  }
  return path.join(home, '.local', 'share', 'lazybro');
}

function defaultDataDir(): string {
  return defaultDataDirFor(
    process.platform,
    os.homedir(),
    { APPDATA: process.env.APPDATA },
    fs.existsSync
  );
}

/** Autostart wrappers set LAZYBRO_AUTOSTART=1 so login launch stays headless. */
export function shouldOpenUiOnStart(
  openUiOnStart: boolean,
  env: { LAZYBRO_AUTOSTART?: string } = {
    LAZYBRO_AUTOSTART: process.env.LAZYBRO_AUTOSTART,
  }
): boolean {
  if (env.LAZYBRO_AUTOSTART === '1') return false;
  return openUiOnStart;
}

export function configPath(dataDir: string): string {
  return path.join(dataDir, 'config.json');
}

export function loadConfig(): BroConfig {
  const dataDir = process.env.LAZYBRO_DATA_DIR || defaultDataDir();
  const cfgFile = configPath(dataDir);
  let loaded: Partial<BroConfig> = {};
  if (fs.existsSync(cfgFile)) {
    loaded = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) as Partial<BroConfig>;
  }
  const shareDir =
    loaded.shareDir ||
    process.env.LAZYBRO_SHARE_DIR ||
    path.join(dataDir, 'share');
  const cfg: BroConfig = {
    ...DEFAULTS,
    ...loaded,
    dataDir,
    shareDir,
    port: Number(process.env.LAZYBRO_PORT || loaded.port || DEFAULTS.port),
    localApiToken:
      typeof loaded.localApiToken === 'string' && loaded.localApiToken.length >= 32
        ? loaded.localApiToken
        : randomBytes(32).toString('base64url'),
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(cfg.dataDir, 0o700);
  fs.mkdirSync(cfg.shareDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(cfg.shareDir, 'objects'), { recursive: true });
  saveConfig(cfg);
  return cfg;
}

export function saveConfig(cfg: BroConfig): void {
  fs.mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(cfg.dataDir, 0o700);
  fs.writeFileSync(configPath(cfg.dataDir), JSON.stringify(cfg, null, 2), {
    mode: 0o600,
  });
  if (process.platform !== 'win32') fs.chmodSync(configPath(cfg.dataDir), 0o600);
}

export function objectsDir(cfg: BroConfig): string {
  return path.join(cfg.shareDir, 'objects');
}

export function dbPath(cfg: BroConfig): string {
  return path.join(cfg.dataDir, 'lazybro.sqlite');
}
