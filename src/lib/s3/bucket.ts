import { z } from 'zod';
import { assertS3EndpointHostSync } from './endpoint';

export type BucketNameResult = { ok: true } | { ok: false; message: string };

const IPV4_SHAPED = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * AWS bucket naming rules that matter to S3-compatible stores. The endpoint
 * schema trims first; a stored value that predates this check is only ever
 * re-validated when a request sends it.
 */
export function validateBucketName(name: string): BucketNameResult {
  if (name.length < 3 || name.length > 63) {
    return { ok: false, message: 'Bucket name must be between 3 and 63 characters' };
  }
  if (!/^[a-z0-9.-]+$/.test(name)) {
    return {
      ok: false,
      message:
        'Bucket name may only contain lowercase letters, digits, dots, and hyphens',
    };
  }
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) {
    return {
      ok: false,
      message: 'Bucket name must start and end with a letter or digit',
    };
  }
  if (name.includes('..')) {
    return { ok: false, message: 'Bucket name cannot contain consecutive dots' };
  }
  if (IPV4_SHAPED.test(name)) {
    return { ok: false, message: 'Bucket name cannot look like an IP address' };
  }
  return { ok: true };
}

/** Zod wrapper for forms/schemas that want the bucket issue on `bucket`. */
export const bucketNameSchema = z.string().superRefine((value, ctx) => {
  const result = validateBucketName(value);
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
  }
});

export type S3ProfileWriteIssue = {
  path: Array<'bucket' | 'endpoint'>;
  message: string;
};

/**
 * Write-time checks for a new/edited profile. Only the incoming fields are
 * checked so an old invalid row cannot block unrelated edits. Endpoint hosts
 * are checked synchronously (literal IPs/localhost/metadata names); DNS
 * resolution stays at use time in `assertS3EndpointAllowed`.
 */
export function validateS3ProfileForWrite(profile: {
  bucket: string;
  endpoint: string;
}): S3ProfileWriteIssue[] {
  const issues: S3ProfileWriteIssue[] = [];

  const bucket = bucketNameSchema.safeParse(profile.bucket);
  if (!bucket.success) {
    issues.push({
      path: ['bucket'],
      message: bucket.error.issues[0]?.message ?? 'Invalid bucket name',
    });
  }

  try {
    assertS3EndpointHostSync(profile.endpoint);
  } catch (error) {
    issues.push({
      path: ['endpoint'],
      message: error instanceof Error ? error.message : 'Invalid S3 endpoint',
    });
  }

  return issues;
}
