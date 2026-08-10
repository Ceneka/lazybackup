export type ServerSshKeyRef = {
  id: string;
  name: string;
  sshKeyId: string | null;
};

/**
 * Servers that reference a stored SSH key (sshKeyId).
 * Used to block key deletion and surface links in the UI.
 */
export function findServersUsingSshKey(
  servers: readonly ServerSshKeyRef[],
  keyId: string
): Array<{ id: string; name: string }> {
  return servers
    .filter((server) => server.sshKeyId === keyId)
    .map((server) => ({ id: server.id, name: server.name }));
}
