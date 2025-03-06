import { eq } from 'drizzle-orm';
import { promises as fs } from 'fs';
import { NodeSSH } from 'node-ssh';
import { db } from '../db';
import { servers, sshKeys } from '../db/schema';
import { buildRsyncCommand } from './rsync';

export type Server = typeof servers.$inferSelect;
export type SSHKey = typeof sshKeys.$inferSelect;

export async function connectToServer(server: Server): Promise<NodeSSH> {
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
