import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { stagedObjectExists, writeStagedObject } from './staging';

const updates: Array<Record<string, unknown>> = [];

mock.module('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          updates.push(vals);
        },
      }),
    }),
  },
}));

const { completePeerDeleteAck } = await import('./retention');

describe('completePeerDeleteAck', () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(async () => {
    updates.length = 0;
    prev = process.env.BACKUP_STORAGE_PATH;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-delete-ack-'));
    process.env.BACKUP_STORAGE_PATH = tmp;
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env.BACKUP_STORAGE_PATH;
    else process.env.BACKUP_STORAGE_PATH = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('marks history removed and drops leftover staging after a verified delete ack', async () => {
    const src = path.join(tmp, 'blob.age');
    await fs.writeFile(src, Buffer.from('ciphertext'));
    await writeStagedObject('peer1', 'db/obj.sql.gz.age', src);
    expect(await stagedObjectExists('peer1', 'db/obj.sql.gz.age')).toBe(true);

    await completePeerDeleteAck('peer1', 'db/obj.sql.gz.age');

    expect(await stagedObjectExists('peer1', 'db/obj.sql.gz.age')).toBe(false);
    expect(updates.some((vals) => vals.status === 'acked')).toBe(true);
    expect(updates.some((vals) => vals.artifactRemoved === true)).toBe(true);
  });
});
