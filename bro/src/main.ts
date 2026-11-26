import fs from 'fs';
import path from 'path';
import {
  disableAutostart,
  enableAutostart,
  getAutostartStatus,
} from './autostart';
import { pushFolderBackup } from './backup/push';
import { ensureAgeKeys } from './backup/pack';
import type { BroConfig } from './config';
import { loadConfig, objectsDir, saveConfig, shouldOpenUiOnStart } from './config';
import {
  injectLocalApiToken,
  publicConfig,
  validateLocalControlRequest,
} from './control';
import { deleteAllObjects, getDb, listObjects } from './db';
import { listFolderSuggestions, prepareShareDir, shareDirChangeError } from './folders';
import { alreadyRunningMessage, isAddressInUseError, isPortInUse } from './listen';
import { acceptInvite, clearPairing } from './pair';
import { sweepPartialFiles } from './stream';
import { getSyncStatus, startSyncLoop, syncOnce } from './sync';

const NAME_REQUIRED_MESSAGE = "Please add your name so your friend knows it's you.";
const INVITE_REQUIRED_MESSAGE =
  'Paste the invite your friend sent you — it starts with lb1.';
const UNPAIR_CONFIRM_MESSAGE = 'Confirm that you want to disconnect.';

let cfg: BroConfig = loadConfig();
if (await isPortInUse(cfg.port)) {
  console.log(alreadyRunningMessage(cfg.port));
  process.exit(0);
}
getDb(cfg);
// A crash mid-download leaves *.partial-* files behind forever; clear them.
const swept = await sweepPartialFiles(objectsDir(cfg)).catch(() => 0);
if (swept > 0) console.log(`[lazybro] removed ${swept} unfinished download(s)`);
void ensureAgeKeys(cfg).then((c) => {
  cfg = c;
});

const uiHtmlTemplate = fs.readFileSync(path.join(import.meta.dir, 'ui', 'index.html'), 'utf8');

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getCfg(): BroConfig {
  return cfg;
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

const server = (() => {
  try {
    return Bun.serve({
      hostname: '127.0.0.1',
      port: cfg.port,
      async fetch(req) {
        const url = new URL(req.url);
        const isApi = url.pathname.startsWith('/api/');
        const control = validateLocalControlRequest(req, cfg.port, cfg.localApiToken, {
          api: isApi,
        });
        if (!control.ok) return json({ error: control.error }, control.status);

        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          return new Response(injectLocalApiToken(uiHtmlTemplate, cfg.localApiToken), {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'Content-Security-Policy':
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
              'X-Frame-Options': 'DENY',
              'X-Content-Type-Options': 'nosniff',
              'Referrer-Policy': 'no-referrer',
            },
          });
        }

        if (req.method === 'GET' && url.pathname === '/api/status') {
          return json({
            config: publicConfig(cfg),
            sync: getSyncStatus(cfg),
            objects: listObjects(cfg),
            autostart: getAutostartStatus(),
          });
        }

        if (req.method === 'GET' && url.pathname === '/api/folders') {
          return json({
            shareDir: cfg.shareDir,
            folders: await listFolderSuggestions(cfg),
          });
        }

        if (req.method === 'POST' && url.pathname === '/api/config') {
          try {
            const body = (await req.json()) as {
              shareDir?: string;
              label?: string;
              folderBackupPath?: string | null;
            };
            const nextShareDir = body.shareDir?.trim();
            const nextLabel = body.label?.trim();
            if (body.label !== undefined && !nextLabel) {
              return json({ error: NAME_REQUIRED_MESSAGE }, 400);
            }
            let preparedShareDir: string | null = null;
            if (nextShareDir) {
              const locked = shareDirChangeError(
                cfg.shareDir,
                nextShareDir,
                listObjects(cfg).length
              );
              if (locked) return json({ error: locked }, 409);
              const prepared = await prepareShareDir(nextShareDir);
              if (!prepared.ok) return json({ error: prepared.error }, 400);
              preparedShareDir = prepared.path;
            }

            if (preparedShareDir) {
              cfg.shareDir = preparedShareDir;
              fs.mkdirSync(path.join(cfg.shareDir, 'objects'), { recursive: true });
            }
            if (nextLabel) cfg.label = nextLabel.slice(0, 80);
            if (body.folderBackupPath !== undefined) {
              cfg.folderBackupPath = body.folderBackupPath?.trim() || null;
            }
            saveConfig(cfg);
            return json({ ok: true, config: publicConfig(cfg) });
          } catch (e) {
            return json({ error: friendlyError(e, 'Config failed') }, 400);
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/pair') {
          try {
            const body = (await req.json()) as { inviteCode?: string; label?: string };
            const name = body.label?.trim();
            if (!name) return json({ error: NAME_REQUIRED_MESSAGE }, 400);
            if (!body.inviteCode?.trim()) {
              return json({ error: INVITE_REQUIRED_MESSAGE }, 400);
            }
            cfg = await acceptInvite(cfg, body.inviteCode.trim(), name);
            await syncOnce(cfg);
            return json({ ok: true, remoteLabel: cfg.remoteLabel });
          } catch (e) {
            return json({ error: friendlyError(e, 'Pairing failed') }, 400);
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/unpair') {
          try {
            const body = (await req.json()) as { confirm?: boolean };
            if (body.confirm !== true) {
              return json({ error: UNPAIR_CONFIRM_MESSAGE }, 400);
            }
            const removed = await deleteAllObjects(cfg);
            clearPairing(cfg);
            saveConfig(cfg);
            return json({
              ok: true,
              removedObjects: removed.count,
              freedBytes: removed.bytes,
              config: publicConfig(cfg),
            });
          } catch (e) {
            return json({ error: friendlyError(e, 'Disconnect failed') }, 400);
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/sync') {
          const status = await syncOnce(cfg);
          return json({ ok: true, sync: status });
        }

        if (req.method === 'POST' && url.pathname === '/api/backup') {
          try {
            const result = await pushFolderBackup(cfg);
            return json(result);
          } catch (e) {
            return json({ error: friendlyError(e, 'Backup failed') }, 400);
          }
        }

        if (req.method === 'POST' && url.pathname === '/api/autostart') {
          try {
            const body = (await req.json()) as { enabled?: boolean; prompted?: boolean };
            if (body.prompted || body.enabled !== undefined) {
              cfg.autostartPrompted = true;
              saveConfig(cfg);
            }
            let status = getAutostartStatus();
            if (body.enabled === true) {
              status = enableAutostart(cfg);
            } else if (body.enabled === false && body.prompted !== true) {
              status = disableAutostart();
            }
            return json({ ok: true, autostart: status });
          } catch (e) {
            return json({ error: friendlyError(e, 'Autostart failed') }, 400);
          }
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
          return json({ ok: true });
        }

        return json({ error: 'Not found' }, 404);
      },
    });
  } catch (error) {
    if (isAddressInUseError(error)) {
      console.log(alreadyRunningMessage(cfg.port));
      process.exit(0);
    }
    throw error;
  }
})();

startSyncLoop(cfg, getCfg);

const url = `http://127.0.0.1:${server.port}`;
console.log(`LazyBro listening on ${url}`);
if (shouldOpenUiOnStart(cfg.openUiOnStart)) {
  try {
    if (process.platform === 'linux') {
      Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
    } else if (process.platform === 'darwin') {
      Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    } else if (process.platform === 'win32') {
      Bun.spawn(['cmd', '/c', 'start', url], { stdout: 'ignore', stderr: 'ignore' });
    }
  } catch {
    /* ignore */
  }
}
