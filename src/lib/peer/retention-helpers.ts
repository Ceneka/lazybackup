/** Leaf helpers for Bro mailbox retention — kept off the db/SSH module graph for unit tests. */

export function parsePeerArtifactPath(
  artifactPath: string
): { peerId: string; objectKey: string } | null {
  const match = /^peer:\/\/([^/]+)\/(.+)$/.exec(artifactPath.trim());
  if (!match?.[1] || !match[2]) return null;
  const objectKey = match[2].replace(/\\/g, '/').replace(/^\/+/, '');
  if (!objectKey || objectKey.includes('..')) return null;
  return { peerId: match[1], objectKey };
}

/** Omit pending deletes from /work while a recall for that key is still open. */
export function advertiseMailboxDeletes(
  pendingKeys: string[],
  openRecallKeys: Iterable<string>
): Array<{ key: string }> {
  const blocked = new Set(openRecallKeys);
  return pendingKeys.filter((key) => !blocked.has(key)).map((key) => ({ key }));
}
