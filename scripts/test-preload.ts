/**
 * Bun test preload.
 *
 * The SSH TOFU known_hosts file defaults to the directory of DATABASE_URL,
 * which is the repo root in tests. Point every test process at a temp file so
 * `bun test` never creates `./ssh_known_hosts` (gitignored, but a real side
 * effect that hides in local checkouts). Tests that need their own file still
 * override LAZYBACKUP_KNOWN_HOSTS and restore the previous value.
 */
import { tmpdir } from 'os';
import path from 'path';

if (!process.env.LAZYBACKUP_KNOWN_HOSTS) {
  process.env.LAZYBACKUP_KNOWN_HOSTS = path.join(
    tmpdir(),
    `lazybackup-test-known-hosts-${process.pid}`
  );
}
