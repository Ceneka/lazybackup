/**
 * Utility functions for building rsync commands
 */

/** Safe single-quoted string for use inside `sh -c` / docker-compose style shells */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds a standard rsync command with options
 * @param sourcePath Source path for rsync (local or remote)
 * @param destinationPath Destination path for rsync (local or remote)
 * @param excludePatterns Array of patterns to exclude from sync
 * @param additionalOptions Additional rsync options
 * @param rshShell Full remote shell command (e.g. `ssh -p 22 -i /path -F /dev/null ...`) passed to `rsync -e`
 * @returns A complete rsync command string
 */
export function buildRsyncCommand(
  sourcePath: string,
  destinationPath: string,
  excludePatterns: string[] = [],
  additionalOptions: string[] = [],
  rshShell?: string
): string {
  // Validate paths
  if (!sourcePath) {
    throw new Error('Source path is required');
  }
  
  if (!destinationPath) {
    throw new Error('Destination path is required');
  }
  
  // Build the base rsync command
  let command = 'rsync -avz --stats';

  if (rshShell) {
    command += ` -e ${shellSingleQuote(rshShell)}`;
  }
  
  // Add any additional options
  if (additionalOptions.length > 0) {
    command += ' ' + additionalOptions.join(' ');
  }
  
  // Add exclude patterns
  if (excludePatterns.length > 0) {
    excludePatterns.forEach(pattern => {
      command += ` --exclude="${pattern}"`;
    });
  }
  
  // Add source and destination
  command += ` "${sourcePath}" "${destinationPath}"`;
  
  return command;
} 
