import { NodeSSH } from 'node-ssh';
import { servers } from '../db/schema';

export type Server = typeof servers.$inferSelect;

export async function connectToServer(server: Server): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  
  try {
    if (server.authType === 'password' && server.password) {
      await ssh.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
      });
    } else if (server.authType === 'key' && server.privateKey) {
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
  // Validate paths
  if (!sourcePath) {
    throw new Error('Source path is required');
  }
  
  if (!destinationPath) {
    throw new Error('Destination path is required');
  }
  
  // Build the rsync command
  let rsyncCommand = `rsync -avz --stats`;
  
  // Add exclude patterns
  if (excludePatterns.length > 0) {
    excludePatterns.forEach(pattern => {
      rsyncCommand += ` --exclude="${pattern}"`;
    });
  }
  
  // Add source and destination
  rsyncCommand += ` ${sourcePath} ${destinationPath}`;
  
  // Execute the command
  return ssh.execCommand(rsyncCommand);
}

export async function testConnection(server: Server): Promise<{ success: boolean; message?: string }> {
  try {
    const ssh = await connectToServer(server);
    const result = await ssh.execCommand('echo "Connection successful"');
    ssh.dispose();
    
    if (result.stdout.includes('Connection successful')) {
      return { success: true };
    } else {
      return { 
        success: false, 
        message: `Unexpected response: ${result.stdout || result.stderr}` 
      };
    }
  } catch (error) {
    console.error(`Connection test failed for server ${server.name}:`, error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
} 
