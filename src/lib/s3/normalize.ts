export type S3ProfileFields = {
  endpoint: string;
  region?: string | null;
  bucket: string;
  accessKeyId: string;
  secretAccessKey?: string;
};

/**
 * Trim credentials/paths and drop a bucket that was pasted into the endpoint URL
 * (common with R2: `https://<account>.r2.cloudflarestorage.com/<bucket>`).
 */
export function normalizeS3ProfileFields<T extends S3ProfileFields>(profile: T): T {
  const bucket = profile.bucket.trim();
  let endpoint = profile.endpoint.trim().replace(/\/+$/, '');

  try {
    const url = new URL(endpoint);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 0 && decodeURIComponent(parts[0]) === bucket) {
      url.pathname = parts.length > 1 ? `/${parts.slice(1).join('/')}` : '/';
      endpoint = url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Invalid URLs are rejected later by the endpoint policy.
  }

  return {
    ...profile,
    endpoint,
    region: (profile.region ?? 'us-east-1').trim() || 'us-east-1',
    bucket,
    accessKeyId: profile.accessKeyId.trim(),
    ...(profile.secretAccessKey !== undefined
      ? { secretAccessKey: profile.secretAccessKey.trim() }
      : {}),
  };
}

export function formatS3ConnectionError(error: unknown): string {
  const msg = error instanceof Error ? error.message : 'S3 connection failed';
  if (/access denied|nosuchbucket|nosuchkey|specified key does not exist/i.test(msg)) {
    return `${msg}. Check the bucket name for extra spaces, and that the endpoint is the account URL (bucket goes in the Bucket field).`;
  }
  return msg;
}
