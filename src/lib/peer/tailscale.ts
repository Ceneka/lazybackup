import { execFile } from 'child_process';
import fs from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const TAILSCALE_SOCKET_PATHS = [
  process.env.TS_SOCKET?.trim(),
  '/var/run/tailscale/tailscaled.sock',
  '/tmp/tailscaled.sock',
].filter(Boolean) as string[];

export type TailscaleStatus = {
  available: boolean;
  /** How we talked to Tailscale */
  via: 'socket' | 'cli' | 'none';
  /** CLI `tailscale` found on PATH (needed to join with an auth key from the UI) */
  cliAvailable: boolean;
  backendState: string | null;
  /** MagicDNS or hostname */
  dnsName: string | null;
  /** Prefer IPv4 Tailscale address */
  ipv4: string | null;
  ipv6: string | null;
  /** Suggested LazyBackup Instance URL (http://100.x:PORT) */
  suggestedBaseUrl: string | null;
  /** Short setup hint when Tailscale is missing */
  hint: string | null;
};

function appPort(): number {
  const n = Number(process.env.PORT || 3000);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

function suggestedUrl(ipv4: string | null, dnsName: string | null): string | null {
  const port = appPort();
  if (ipv4) return `http://${ipv4}:${port}`;
  if (dnsName) {
    const host = dnsName.replace(/\.$/, '');
    return `http://${host}:${port}`;
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findSocket(): Promise<string | null> {
  for (const p of TAILSCALE_SOCKET_PATHS) {
    if (await pathExists(p)) return p;
  }
  return null;
}

async function cliOnPath(): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-c', 'command -v tailscale'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

type StatusJson = {
  BackendState?: string;
  Self?: {
    DNSName?: string;
    HostName?: string;
    TailscaleIPs?: string[];
  };
};

function parseStatusJson(data: StatusJson): Omit<
  TailscaleStatus,
  'available' | 'via' | 'cliAvailable' | 'hint'
> {
  const ips = data.Self?.TailscaleIPs || [];
  const ipv4 = ips.find((ip) => ip.includes('.')) || null;
  const ipv6 = ips.find((ip) => ip.includes(':')) || null;
  const dnsName = data.Self?.DNSName?.replace(/\.$/, '') || null;
  return {
    backendState: data.BackendState || null,
    dnsName,
    ipv4,
    ipv6,
    suggestedBaseUrl: suggestedUrl(ipv4, dnsName),
  };
}

/** LocalAPI over unix socket (Bun fetch `unix` option). */
async function statusViaSocket(socketPath: string): Promise<StatusJson> {
  const res = await fetch('http://local-tailscaled.sock/localapi/v0/status', {
    // @ts-expect-error Bun extends fetch with unix socket
    unix: socketPath,
    headers: { Host: 'local-tailscaled.sock' },
  });
  if (!res.ok) {
    throw new Error(`Tailscale LocalAPI HTTP ${res.status}`);
  }
  return (await res.json()) as StatusJson;
}

async function statusViaCli(): Promise<StatusJson> {
  const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
    timeout: 8000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout) as StatusJson;
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const cliAvailable = await cliOnPath();
  const socket = await findSocket();

  try {
    if (socket) {
      const parsed = parseStatusJson(await statusViaSocket(socket));
      const running = (parsed.backendState || '').toLowerCase() === 'running';
      return {
        available: running || Boolean(parsed.ipv4 || parsed.dnsName),
        via: 'socket',
        cliAvailable,
        ...parsed,
        hint: running
          ? null
          : 'Tailscale socket found but not Running yet — wait a few seconds or check auth.',
      };
    }

    if (cliAvailable) {
      const parsed = parseStatusJson(await statusViaCli());
      const running = (parsed.backendState || '').toLowerCase() === 'running';
      return {
        available: running || Boolean(parsed.ipv4 || parsed.dnsName),
        via: 'cli',
        cliAvailable,
        ...parsed,
        hint: running
          ? null
          : 'Tailscale CLI found but not connected. Paste an auth key below or run: tailscale up',
      };
    }
  } catch (error) {
    return {
      available: false,
      via: 'none',
      cliAvailable,
      backendState: null,
      dnsName: null,
      ipv4: null,
      ipv6: null,
      suggestedBaseUrl: null,
      hint:
        error instanceof Error
          ? `Could not read Tailscale status: ${error.message}`
          : 'Could not read Tailscale status',
    };
  }

  return {
    available: false,
    via: 'none',
    cliAvailable,
    backendState: null,
    dnsName: null,
    ipv4: null,
    ipv6: null,
    suggestedBaseUrl: null,
    hint:
      'Tailscale is not on this host. Install it on the machine, or start the optional compose overlay (docker-compose.tailscale.yml) — we do not ship Tailscale inside the LazyBackup image (~50MB+).',
  };
}

/**
 * Join the tailnet with an auth key. Requires `tailscale` on PATH
 * (host install or sidecar that shares the network namespace — not bundled).
 */
export async function joinTailscaleWithAuthKey(authKey: string): Promise<{
  ok: boolean;
  message: string;
  status: TailscaleStatus;
}> {
  const key = authKey.trim();
  if (!key.startsWith('tskey-')) {
    throw new Error('Auth key should look like tskey-auth-… (from Tailscale admin → Keys)');
  }
  if (!(await cliOnPath())) {
    throw new Error(
      'tailscale CLI not found in this container/host. Install Tailscale on the host, or use docker-compose.tailscale.yml with TS_AUTHKEY (no CLI needed in the app image).'
    );
  }

  try {
    await execFileAsync(
      'tailscale',
      ['up', `--auth-key=${key}`, '--accept-dns=false', '--timeout=60s'],
      { timeout: 70000, maxBuffer: 1024 * 1024 }
    );
  } catch (error) {
    const msg =
      error instanceof Error
        ? // execFile errors often include stderr on the object
          String((error as { stderr?: string }).stderr || error.message)
        : 'tailscale up failed';
    throw new Error(msg.trim() || 'tailscale up failed');
  }

  // Brief wait for IPs to appear
  await new Promise((r) => setTimeout(r, 1500));
  const status = await getTailscaleStatus();
  return {
    ok: status.available,
    message: status.suggestedBaseUrl
      ? `Connected. Suggested URL: ${status.suggestedBaseUrl}`
      : 'tailscale up finished; waiting for an IP — refresh status in a moment.',
    status,
  };
}
