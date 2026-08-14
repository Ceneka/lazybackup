import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { pinnedFetch, type PinnedRequestInit } from '@/lib/net/pinned-fetch';
import { peerUrlPolicy } from '@/lib/net/url-guard';
import { writeCappedResponseToFile } from './capped-body';
import { PEER_UPLOAD_HARD_CAP_BYTES } from './upload-limit';
import type { PeerRow } from './types';

function peerApi(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}

async function peerFetch(
  peer: PeerRow,
  apiPath: string,
  init?: PinnedRequestInit
): Promise<Response> {
  if (!peer.outboundToken) {
    throw new Error(`Peer "${peer.name}" has no outbound token; re-pair to continue`);
  }
  if (peer.status !== 'active') {
    throw new Error(`Peer "${peer.name}" is not active`);
  }
  const res = await pinnedFetch(peerApi(peer.remoteBaseUrl, apiPath), peerUrlPolicy(), {
    ...init,
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
  const stat = await fs.stat(localFilePath);
  const maxBytes = Math.min(PEER_UPLOAD_HARD_CAP_BYTES, peer.quotaBytes);
  if (stat.size > maxBytes) {
    throw new Error(`Peer upload exceeds maximum of ${maxBytes} bytes`);
  }
  const body = createReadStream(localFilePath);
  const res = await peerFetch(peer, storeUrl(objectKey), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
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

export async function deletePeerObject(
  peer: PeerRow,
  objectKey: string
): Promise<void> {
  const res = await peerFetch(peer, storeUrl(objectKey), {
    method: 'DELETE',
  });
  if (res.ok || res.status === 404) return;
  const err = await res.json().catch(() => ({}));
  throw new Error(
    (err as { error?: string }).error ||
      `Peer delete failed (${res.status}) for ${peer.name}`
  );
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
  await writeCappedResponseToFile({
    response: res,
    destPath: localFilePath,
    maxBytes: PEER_UPLOAD_HARD_CAP_BYTES,
  });
}
