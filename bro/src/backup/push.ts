import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BroConfig } from '../config';
import { saveConfig } from '../config';
import { ensureAgeKeys, encryptFile, packFolderTarGz } from './pack';

function hostApi(cfg: BroConfig, apiPath: string): string {
  if (!cfg.hostBaseUrl) throw new Error('Not paired');
  return `${cfg.hostBaseUrl.replace(/\/+$/, '')}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
}

/**
 * Pack + encrypt folder and PUT to host /api/peers/store.
 */
export async function pushFolderBackup(cfg: BroConfig): Promise<{ key: string; size: number }> {
  if (!cfg.folderBackupPath) {
    throw new Error('No folder selected for backup');
  }
  if (!cfg.hostBaseUrl || !cfg.outboundToken) {
    throw new Error('Not paired with a LazyBackup host');
  }

  await ensureAgeKeys(cfg);
  if (!cfg.ageRecipient) throw new Error('Age key missing');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybro-'));
  const tarPath = path.join(tmpDir, 'folder.tar.gz');
  const agePath = path.join(tmpDir, 'folder.tar.gz.age');

  try {
    await packFolderTarGz(cfg.folderBackupPath, tarPath);
    await encryptFile(tarPath, agePath, cfg.ageRecipient);
    const body = await fs.readFile(agePath);
    const key = `lazybro-folder/${stamp}/folder.tar.gz.age`;
    const res = await fetch(
      hostApi(cfg, `/api/peers/store?key=${encodeURIComponent(key)}`),
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cfg.outboundToken}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.byteLength),
        },
        body,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error || `Upload failed (${res.status})`
      );
    }
    const json = (await res.json()) as { size: number };
    cfg.lastFolderBackupAt = new Date().toISOString();
    saveConfig(cfg);
    return { key, size: json.size };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function maybeRunFolderBackup(
  cfg: BroConfig,
  getCfg: () => BroConfig
): Promise<void> {
  const c = getCfg();
  if (!c.folderBackupPath || !c.hostBaseUrl) return;
  const last = c.lastFolderBackupAt ? Date.parse(c.lastFolderBackupAt) : 0;
  if (Date.now() - last < c.folderBackupIntervalMs) return;
  await pushFolderBackup(c);
}
