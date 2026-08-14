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
import { loadConfig, saveConfig, shouldOpenUiOnStart } from './config';
import {
  injectLocalApiToken,
  publicConfig,
  validateLocalControlRequest,
} from './control';
import { getDb, listObjects } from './db';
import { alreadyRunningMessage, isAddressInUseError, isPortInUse } from './listen';
import { acceptInvite } from './pair';
import { getSyncStatus, startSyncLoop, syncOnce } from './sync';

let cfg: BroConfig = loadConfig();
if (await isPortInUse(cfg.port)) {
  console.log(alreadyRunningMessage(cfg.port));
  process.exit(0);
}
getDb(cfg);
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

    if (req.method === 'POST' && url.pathname === '/api/config') {
      try {
        const body = (await req.json()) as {
          shareDir?: string;
          label?: string;
          folderBackupPath?: string | null;
        };
        if (body.shareDir?.trim()) {
          cfg.shareDir = body.shareDir.trim();
          fs.mkdirSync(path.join(cfg.shareDir, 'objects'), { recursive: true });
        }
        if (body.label?.trim()) cfg.label = body.label.trim();
        if (body.folderBackupPath !== undefined) {
          cfg.folderBackupPath = body.folderBackupPath?.trim() || null;
        }
        saveConfig(cfg);
        return json({ ok: true, config: publicConfig(cfg) });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Config failed' }, 400);
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/pair') {
      try {
        const body = (await req.json()) as { inviteCode?: string; label?: string };
        if (!body.inviteCode?.trim()) {
          return json({ error: 'inviteCode required' }, 400);
        }
        cfg = await acceptInvite(cfg, body.inviteCode.trim(), body.label);
        await syncOnce(cfg);
        return json({ ok: true, remoteLabel: cfg.remoteLabel });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Pair failed' }, 400);
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
        return json({ error: e instanceof Error ? e.message : 'Backup failed' }, 400);
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
        return json({ error: e instanceof Error ? e.message : 'Autostart failed' }, 400);
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
