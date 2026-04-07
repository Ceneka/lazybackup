import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NodeSSH } from 'node-ssh';
import { db } from '../db';
import { servers, sshKeys } from '../db/schema';
import { buildRsyncCommand } from './rsync';

export type Server = typeof servers.$inferSelect;
export type SSHKey = typeof sshKeys.$inferSelect;

/** Same key material used by node-ssh; required for host-side rsync/scp which cannot use the DB directly. */
export async function resolvePrivateKeyForServer(server: Server): Promise<string> {
  if (server.authType !== 'key') {
    throw new Error(
      'Host-side rsync/scp requires SSH key authentication (password-only is not supported for pulling backups).'
    );
  }
  if (server.sshKeyId) {
    const key = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, server.sshKeyId),
    });
    if (!key) {
      throw new Error('Referenced SSH key not found');
    }
    if (key.privateKeyContent) {
      return key.privateKeyContent;
    }
    if (key.privateKeyPath) {
      try {
        return await fs.readFile(key.privateKeyPath, 'utf8');
      } catch {
        throw new Error(`Failed to read SSH key file: ${key.privateKeyPath}`);
      }
    }
    throw new Error('SSH key has no content or path');
  }
  if (server.systemKeyPath) {
    try {
      return await fs.readFile(server.systemKeyPath, 'utf8');
    } catch {
      throw new Error(`Failed to read system SSH key file: ${server.systemKeyPath}`);
    }
  }
  if (server.privateKey) {
    return server.privateKey;
  }
  throw new Error('Invalid authentication configuration: no private key available');
}

/**
 * Prepare key text for OpenSSH CLI (scp/rsync). ssh2 is more lenient than native ssh;
 * DB/JSON often stores CRLF or literal \\n sequences which break libcrypto PEM parsing.
 */
export function normalizePrivateKeyForOpenSsh(content: string): string {
  let s = content.trim();
  if (s.includes('-----BEGIN') && s.includes('\\n') && !s.includes('\n')) {
    s = s.replace(/\\n/g, '\n');
  }
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.trim();
  if (!s.endsWith('\n')) {
    s += '\n';
  }
  return s;
}

export async function writeTemporarySshIdentityFile(
  keyContent: string
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const id = randomBytes(16).toString('hex');
  const keyPath = path.join(tmpdir(), `lazybackup-ssh-${id}`);
  const normalized = normalizePrivateKeyForOpenSsh(keyContent);
  await fs.writeFile(keyPath, normalized, { mode: 0o600 });
  await fs.chmod(keyPath, 0o600);
  return {
    path: keyPath,
    cleanup: async () => {
      await fs.unlink(keyPath).catch(() => {});
    },
  };
}

/** True if remote `command -v` found an executable (POSIX; avoids flaky `which` + stderr checks). */
export function remoteCommandFound(result: {
  stdout: string;
  stderr?: string;
  code?: number | null;
}): boolean {
  const okCode = result.code === 0 || result.code === null || result.code === undefined;
  return okCode && result.stdout.trim().length > 0;
}

/** Non-interactive SSH sessions often get a minimal PATH (no /usr/bin), so bare `command -v rsync` fails. */
const REMOTE_STANDARD_PATH =
  'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"';

/**
 * Whether rsync exists on the remote host (for choosing rsync vs scp on the app host).
 */
export async function checkRemoteHasRsync(ssh: NodeSSH): Promise<boolean> {
  const r1 = await ssh.execCommand(`${REMOTE_STANDARD_PATH} command -v rsync`);
  if (remoteCommandFound(r1)) {
    return true;
  }
  const r2 = await ssh.execCommand(
    '[ -x /usr/bin/rsync ] && echo /usr/bin/rsync || [ -x /usr/local/bin/rsync ] && echo /usr/local/bin/rsync || [ -x /bin/rsync ] && echo /bin/rsync || true'
  );
  return remoteCommandFound(r2);
}

/**
 * Whether scp exists on the remote (informational; local scp is what pulls files).
 */
export async function checkRemoteHasScpBinary(ssh: NodeSSH): Promise<boolean> {
  const r1 = await ssh.execCommand(`${REMOTE_STANDARD_PATH} command -v scp`);
  if (remoteCommandFound(r1)) {
    return true;
  }
  const r2 = await ssh.execCommand(
    '[ -x /usr/bin/scp ] && echo /usr/bin/scp || [ -x /usr/local/bin/scp ] && echo /usr/local/bin/scp || true'
  );
  return remoteCommandFound(r2);
}

export async function connectToServer(server: Server): Promise<NodeSSH> {

  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    console.error('❌ Not server environment');
    throw new Error('Not server environment');
  }

  const ssh = new NodeSSH();

  try {
    // If using password authentication
    if (server.authType === 'password' && server.password) {
      await ssh.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
      });
    } else if (server.authType === 'key') {
      const privateKey = await resolvePrivateKeyForServer(server);
      await ssh.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey,
      });
    } else {
      throw new Error('Invalid authentication configuration');
    }

    return ssh;
  } catch (error) {
    console.error(`Failed to connect to server ${server.name}:`, error);
    throw error;
  }
}

export async function executeRsyncCommand(
  ssh: NodeSSH,
  sourcePath: string,
  destinationPath: string,
  excludePatterns: string[] = []
): Promise<{ stdout: string; stderr: string }> {
  // Build the rsync command using the utility function
  const rsyncCommand = buildRsyncCommand(sourcePath, destinationPath, excludePatterns);

  // Execute the command
  return ssh.execCommand(rsyncCommand);
}

export async function testConnection(server: Server): Promise<{ success: boolean; message?: string }> {
  try {
    const ssh = await connectToServer(server);
    const result = await ssh.execCommand('echo "Connection successful"');
    ssh.dispose();
    return { success: true, message: "Connection successful" };
  } catch (error) {
    console.error(`Connection test failed for server ${server.name}:`, error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Test server connection and check if rsync is installed
 * Returns information about the available backup methods
 */
export async function testServerBackupCapabilities(server: Server): Promise<{
  success: boolean;
  rsyncAvailable: boolean;
  scpAvailable: boolean;
  message?: string;
}> {
  try {
    // First connect to the server
    const ssh = await connectToServer(server);

    const isRsyncAvailable = await checkRemoteHasRsync(ssh);
    const isScpAvailable = await checkRemoteHasScpBinary(ssh);

    // Get the server's OS info for display
    const osInfo = await ssh.execCommand('uname -a');

    ssh.dispose();

    let message = "Connection successful. ";
    if (isRsyncAvailable) {
      message += "Rsync is available for optimal backups.";
    } else if (isScpAvailable) {
      message += "Rsync not found, but SCP is available for fallback backups.";
    } else {
      message += "Neither Rsync nor SCP found. Backups may not work correctly.";
    }

    return {
      success: true,
      rsyncAvailable: isRsyncAvailable,
      scpAvailable: isScpAvailable,
      message
    };
  } catch (error) {
    console.error(`Backup capabilities test failed for server ${server.name}:`, error);
    return {
      success: false,
      rsyncAvailable: false,
      scpAvailable: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
} 
