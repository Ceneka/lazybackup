import { describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  decryptFileToPath,
  encryptFileToPath,
  generateAgeKeyPair,
} from './age';

describe('decrypted restore artifacts', () => {
  test('plaintext decrypted to disk is owner-only (0600)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbtest-age-mode-'));
    try {
      const keys = await generateAgeKeyPair();
      const input = path.join(dir, 'dump.sql.gz');
      const cipher = path.join(dir, 'dump.sql.gz.age');
      const plain = path.join(dir, 'dump.sql.gz');
      await fs.writeFile(input, 'secret database dump');
      await encryptFileToPath(input, cipher, keys.recipient);
      await fs.unlink(input);

      await decryptFileToPath(cipher, plain, keys.identity);

      const stat = await fs.stat(plain);
      expect(stat.mode & 0o777).toBe(0o600);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
