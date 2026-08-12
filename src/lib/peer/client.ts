import fs from 'fs/promises';
import path from 'path';
import { assertPeerBaseUrl } from '@/lib/net/url-guard';
import type { PeerRow } from './types';

function peerApi(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

async function peerFetch(
  peer: PeerRow,
  apiPath: string,
  init?: RequestInit
): Promise<Response> {
  if (!peer.outboundToken) {
    throw new Error(`Peer "${peer.name}" has no outbound token; re-pair to continue`);
  }
  if (peer.status !== 'active') {
    throw new Error(`Peer "${peer.name}" is not active`);
  }
  assertPeerBaseUrl(peer.remoteBaseUrl);
  const res = await fetch(peerApi(peer.remoteBaseUrl, apiPath), {
    ...init,
    redirect: 'error',
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${peer.outboundToken}`,
    },
  });
  return res;
}

function storeUrl(objectKey: string): string {
  return `/api/peers/store?key=${encodeURIComponent(objectKey)}`;
}

export async function uploadPeerObject(
  peer: PeerRow,
  objectKey: string,
  localFilePath: string
): Promise<{ size: number }> {
  const body = await fs.readFile(localFilePath);
  const res = await peerFetch(peer, storeUrl(objectKey), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.byteLength),
    },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Peer upload failed (${res.status}) for ${peer.name}`
    );
  }
  const json = (await res.json()) as { size: number };
  return { size: json.size };
}

export async function downloadPeerObject(
  peer: PeerRow,
  objectKey: string,
  localFilePath: string
): Promise<void> {
  const res = await peerFetch(peer, storeUrl(objectKey), {
    method: 'GET',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Peer download failed (${res.status}) for ${peer.name}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(localFilePath), { recursive: true });
  await fs.writeFile(localFilePath, buf);
}

export async function deletePeerObject(peer: PeerRow, objectKey: string): Promise<void> {
  const res = await peerFetch(peer, storeUrl(objectKey), {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Peer delete failed (${res.status}) for ${peer.name}`
    );
  }
}
