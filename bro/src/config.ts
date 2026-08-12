import fs from 'fs';
import os from 'os';
import path from 'path';

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
};

function defaultDataDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'LazyBro');
  }
  return path.join(home, '.local', 'share', 'lazybro');
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
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.mkdirSync(cfg.shareDir, { recursive: true });
  fs.mkdirSync(path.join(cfg.shareDir, 'objects'), { recursive: true });
  saveConfig(cfg);
  return cfg;
}

export function saveConfig(cfg: BroConfig): void {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.writeFileSync(configPath(cfg.dataDir), JSON.stringify(cfg, null, 2));
}

export function objectsDir(cfg: BroConfig): string {
  return path.join(cfg.shareDir, 'objects');
}

export function dbPath(cfg: BroConfig): string {
  return path.join(cfg.dataDir, 'lazybro.sqlite');
}
