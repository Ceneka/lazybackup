import { eq } from 'drizzle-orm';
import { promises as fs } from 'fs';
import { NodeSSH } from 'node-ssh';
import { db } from '../db';
import { servers, sshKeys } from '../db/schema';
import { buildRsyncCommand } from './rsync';

export type Server = typeof servers.$inferSelect;
export type SSHKey = typeof sshKeys.$inferSelect;

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
    }
    // If using SSH key with a reference to a stored key
    else if (server.authType === 'key' && server.sshKeyId) {
      // Get the SSH key from the database
      const key = await db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, server.sshKeyId),
      });

      if (!key) {
        throw new Error('Referenced SSH key not found');
      }

      // Use the key content if available, otherwise try to read from file path
      if (key.privateKeyContent) {
        await ssh.connect({
          host: server.host,
          port: server.port,
          username: server.username,
          privateKey: key.privateKeyContent,
        });
      } else if (key.privateKeyPath) {
        try {
          const keyContent = await fs.readFile(key.privateKeyPath, 'utf8');
          await ssh.connect({
            host: server.host,
            port: server.port,
            username: server.username,
            privateKey: keyContent,
          });
        } catch (err) {
          throw new Error(`Failed to read SSH key file: ${key.privateKeyPath}`);
        }
      } else {
        throw new Error('SSH key has no content or path');
      }
    }
    // If using direct reference to system key path
    else if (server.authType === 'key' && server.systemKeyPath) {
      try {
        const keyContent = await fs.readFile(server.systemKeyPath, 'utf8');
        await ssh.connect({
          host: server.host,
          port: server.port,
          username: server.username,
          privateKey: keyContent,
        });
      } catch (err) {
        throw new Error(`Failed to read system SSH key file: ${server.systemKeyPath}`);
      }
    }
    // Using directly provided private key
    else if (server.authType === 'key' && server.privateKey) {
      await ssh.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey: server.privateKey,
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

    // Check if rsync is available
    const rsyncCheck = await ssh.execCommand('which rsync || echo "not_found"');
    const isRsyncAvailable = !rsyncCheck.stdout.includes('not_found') && rsyncCheck.stderr === '';

    // Check if scp is available (fallback method)
    const scpCheck = await ssh.execCommand('which scp || echo "not_found"');
    const isScpAvailable = !scpCheck.stdout.includes('not_found') && scpCheck.stderr === '';

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
