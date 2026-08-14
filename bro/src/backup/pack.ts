import * as age from 'age-encryption';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { BroConfig } from '../config';
import { saveConfig } from '../config';

export async function ensureAgeKeys(cfg: BroConfig): Promise<BroConfig> {
  if (cfg.ageIdentity && cfg.ageRecipient) return cfg;
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  cfg.ageIdentity = identity;
  cfg.ageRecipient = recipient;
  saveConfig(cfg);
  return cfg;
}

export async function encryptFile(
  inputPath: string,
  outputPath: string,
  recipient: string
): Promise<void> {
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  const webIn = Readable.toWeb(
    createReadStream(inputPath)
  ) as unknown as ReadableStream<Uint8Array>;
  const encrypted = await encrypter.encrypt(webIn);
  await pipeline(Readable.fromWeb(encrypted as never), createWriteStream(outputPath));
}

/** Pack a folder to tar.gz via system tar. */
export async function packFolderTarGz(
  folderPath: string,
  outPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const proc = Bun.spawn(['tar', '-czf', outPath, '-C', folderPath, '.'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`tar failed: ${err || code}`);
  }
}
