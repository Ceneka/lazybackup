import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { normalizeS3Prefix } from '@/lib/backup/destination';
import {
  selectFilesToDelete,
  type RetentionAgeUnit,
} from '@/lib/backup/file-retention';

export type S3ProfileConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean | null;
};

export function createS3Client(profile: S3ProfileConfig): S3Client {
  const endpoint = profile.endpoint.trim().replace(/\/+$/, '');
  return new S3Client({
    endpoint,
    region: profile.region.trim() || 'us-east-1',
    credentials: {
      accessKeyId: profile.accessKeyId,
      secretAccessKey: profile.secretAccessKey,
    },
    forcePathStyle: profile.forcePathStyle !== false,
  });
}

export function joinS3Key(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export async function testS3Connection(profile: S3ProfileConfig): Promise<void> {
  const client = createS3Client(profile);
  try {
    await client.send(new HeadBucketCommand({ Bucket: profile.bucket }));
  } catch (error) {
    // Some providers reject HeadBucket; fall back to a cheap list.
    try {
      await client.send(
        new ListObjectsV2Command({
          Bucket: profile.bucket,
          MaxKeys: 1,
        })
      );
    } catch (listError) {
      const detail =
        listError instanceof Error
          ? listError.message
          : error instanceof Error
            ? error.message
            : 'S3 connection failed';
      throw new Error(detail);
    }
  } finally {
    client.destroy();
  }
}

export type S3ObjectInfo = {
  key: string;
  size: number;
  lastModifiedMs: number;
};

export async function listObjectsUnderPrefix(
  profile: S3ProfileConfig,
  prefix: string
): Promise<S3ObjectInfo[]> {
  const client = createS3Client(profile);
  const normalized = normalizeS3Prefix(prefix);
  const listPrefix = normalized ? `${normalized}/` : '';
  const objects: S3ObjectInfo[] = [];

  try {
    let continuationToken: string | undefined;
    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: profile.bucket,
          Prefix: listPrefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of result.Contents || []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;
        objects.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModifiedMs: obj.LastModified?.getTime() ?? 0,
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
  } finally {
    client.destroy();
  }

  return objects;
}

/** List immediate child "directories" (common prefixes) under a prefix. */
export async function listVersionPrefixes(
  profile: S3ProfileConfig,
  basePrefix: string
): Promise<Array<{ name: string; prefix: string; lastModifiedMs: number }>> {
  const client = createS3Client(profile);
  const normalized = normalizeS3Prefix(basePrefix);
  const listPrefix = normalized ? `${normalized}/` : '';
  const versions: Array<{ name: string; prefix: string; lastModifiedMs: number }> = [];

  try {
    let continuationToken: string | undefined;
    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: profile.bucket,
          Prefix: listPrefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        })
      );
      for (const cp of result.CommonPrefixes || []) {
        if (!cp.Prefix) continue;
        const name = cp.Prefix.slice(listPrefix.length).replace(/\/+$/, '');
        if (!name) continue;
        versions.push({
          name,
          prefix: normalizeS3Prefix(cp.Prefix),
          lastModifiedMs: 0,
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    // Enrich with newest object mtime under each version prefix
    for (const version of versions) {
      const objs = await listObjectsUnderPrefix(profile, version.prefix);
      version.lastModifiedMs = objs.reduce(
        (max, o) => Math.max(max, o.lastModifiedMs),
        0
      );
    }
  } finally {
    client.destroy();
  }

  return versions.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteObjectsByKeys(
  profile: S3ProfileConfig,
  keys: string[]
): Promise<number> {
  if (keys.length === 0) return 0;
  const client = createS3Client(profile);
  let deleted = 0;
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: profile.bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      deleted += chunk.length - (result.Errors?.length ?? 0);
    }
  } finally {
    client.destroy();
  }
  return deleted;
}

export async function deletePrefix(
  profile: S3ProfileConfig,
  prefix: string
): Promise<number> {
  const objects = await listObjectsUnderPrefix(profile, prefix);
  return deleteObjectsByKeys(
    profile,
    objects.map((o) => o.key)
  );
}

export async function uploadFile(
  profile: S3ProfileConfig,
  localFilePath: string,
  key: string
): Promise<{ key: string; size: number }> {
  const client = createS3Client(profile);
  const stat = await fs.stat(localFilePath);
  const body = createReadStream(localFilePath);
  try {
    if (stat.size > 5 * 1024 * 1024) {
      const upload = new Upload({
        client,
        params: {
          Bucket: profile.bucket,
          Key: key,
          Body: body,
        },
      });
      await upload.done();
    } else {
      await client.send(
        new PutObjectCommand({
          Bucket: profile.bucket,
          Key: key,
          Body: body,
          ContentLength: stat.size,
        })
      );
    }
  } finally {
    client.destroy();
  }
  return { key, size: stat.size };
}

async function walkLocalFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  await walk(rootDir);
  return results;
}

export async function uploadDirectory(
  profile: S3ProfileConfig,
  localDir: string,
  prefix: string
): Promise<{ fileCount: number; totalSize: number }> {
  const files = await walkLocalFiles(localDir);
  const basePrefix = normalizeS3Prefix(prefix);
  let totalSize = 0;
  for (const file of files) {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    const key = joinS3Key(basePrefix, rel);
    const result = await uploadFile(profile, file, key);
    totalSize += result.size;
  }
  return { fileCount: files.length, totalSize };
}

export async function downloadFile(
  profile: S3ProfileConfig,
  key: string,
  localFilePath: string
): Promise<{ size: number }> {
  const client = createS3Client(profile);
  try {
    await fs.mkdir(path.dirname(localFilePath), { recursive: true });
    const result = await client.send(
      new GetObjectCommand({
        Bucket: profile.bucket,
        Key: key,
      })
    );
    if (!result.Body) {
      throw new Error(`Empty body for s3://${profile.bucket}/${key}`);
    }
    const writeStream = createWriteStream(localFilePath);
    // Body is a Readable in Node
    await pipeline(result.Body as NodeJS.ReadableStream, writeStream);
    const stat = await fs.stat(localFilePath);
    return { size: stat.size };
  } finally {
    client.destroy();
  }
}

export async function downloadPrefix(
  profile: S3ProfileConfig,
  prefix: string,
  localDir: string
): Promise<{ fileCount: number; totalSize: number }> {
  const objects = await listObjectsUnderPrefix(profile, prefix);
  if (objects.length === 0) {
    throw new Error(
      `No objects found under s3://${profile.bucket}/${normalizeS3Prefix(prefix)}`
    );
  }
  const base = normalizeS3Prefix(prefix);
  await fs.mkdir(localDir, { recursive: true });
  let totalSize = 0;
  for (const obj of objects) {
    const rel = base ? obj.key.slice(base.length).replace(/^\//, '') : obj.key;
    if (!rel) continue;
    const localPath = path.join(localDir, ...rel.split('/'));
    const downloaded = await downloadFile(profile, obj.key, localPath);
    totalSize += downloaded.size;
  }
  return { fileCount: objects.length, totalSize };
}

/**
 * Age-based file retention for objects directly under a prefix (not nested version dirs).
 * Object "name" is the basename of the key.
 */
export async function cleanupS3FileRetention(
  profile: S3ProfileConfig,
  prefix: string,
  options: {
    maxAge: number;
    unit: RetentionAgeUnit;
    minKeep: number;
  }
): Promise<{ deleted: number; names: string[] }> {
  const objects = await listObjectsUnderPrefix(profile, prefix);
  const base = normalizeS3Prefix(prefix);
  const topLevel = objects.filter((obj) => {
    const rel = base ? obj.key.slice(base.length).replace(/^\//, '') : obj.key;
    return rel.length > 0 && !rel.includes('/');
  });

  const toDeleteNames = selectFilesToDelete(
    topLevel.map((obj) => ({
      name: path.posix.basename(obj.key),
      mtimeMs: obj.lastModifiedMs,
    })),
    options
  );
  const nameSet = new Set(toDeleteNames);
  const keys = topLevel
    .filter((obj) => nameSet.has(path.posix.basename(obj.key)))
    .map((obj) => obj.key);
  const deleted = await deleteObjectsByKeys(profile, keys);
  return { deleted, names: toDeleteNames };
}

/**
 * Keep newest N version prefixes (immediate children under base prefix).
 */
export async function cleanupS3OldVersions(
  profile: S3ProfileConfig,
  basePrefix: string,
  versionsToKeep: number
): Promise<{ deleted: number; names: string[] }> {
  const versions = await listVersionPrefixes(profile, basePrefix);
  if (versions.length <= versionsToKeep) {
    return { deleted: 0, names: [] };
  }
  // Prefer sort by name (YYYY-MM-DD_HH-mm-ss) then mtime
  const sorted = [...versions].sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.lastModifiedMs - b.lastModifiedMs;
  });
  const toRemove = sorted.slice(0, Math.max(0, sorted.length - versionsToKeep));
  let deleted = 0;
  for (const version of toRemove) {
    deleted += await deletePrefix(profile, version.prefix);
  }
  return { deleted, names: toRemove.map((v) => v.name) };
}

/** Format artifact path for history: s3://bucket/key-or-prefix */
export function formatS3ArtifactPath(bucket: string, keyOrPrefix: string): string {
  const key = normalizeS3Prefix(keyOrPrefix);
  return key ? `s3://${bucket}/${key}` : `s3://${bucket}`;
}

export function parseS3ArtifactPath(artifactPath: string): {
  bucket: string;
  key: string;
} | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(artifactPath.trim());
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}
