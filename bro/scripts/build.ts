import { mkdirSync } from 'fs';
import path from 'path';

const outDir = path.join(import.meta.dir, '..', 'dist');
mkdirSync(outDir, { recursive: true });

const entry = path.join(import.meta.dir, '..', 'src', 'main.ts');

const targets = [
  { target: 'bun-linux-x64', outfile: path.join(outDir, 'lazybro-linux-x64') },
  { target: 'bun-windows-x64', outfile: path.join(outDir, 'lazybro-windows-x64.exe') },
] as const;

for (const t of targets) {
  console.log(`Compiling ${t.target} → ${t.outfile}`);
  const proc = Bun.spawn(
    [
      'bun',
      'build',
      '--compile',
      `--target=${t.target}`,
      `--outfile=${t.outfile}`,
      entry,
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  );
  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }
}

console.log('Done. Binaries in bro/dist/');
