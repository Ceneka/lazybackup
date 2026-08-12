import { timingSafeEqualHex } from './digest';

export type MailboxAckInput = {
  key: string;
  size?: number;
  sha256?: string;
};

export type MailboxAckDecision =
  | { action: 'accept' }
  | { action: 'keep'; reason: 'missing_receipt' | 'mismatch' };

/**
 * ACK is only trusted when the bro proves size and/or sha256 of what it stored.
 * Old agents that omit sha256 must not cause staging to be deleted.
 */
export function decideMailboxAck(options: {
  claimed: MailboxAckInput;
  stagedSize: number;
  stagedSha256: string;
}): MailboxAckDecision {
  const claimedHash = options.claimed.sha256?.trim();
  if (!claimedHash) {
    return { action: 'keep', reason: 'missing_receipt' };
  }
  if (!timingSafeEqualHex(claimedHash, options.stagedSha256)) {
    return { action: 'keep', reason: 'mismatch' };
  }
  if (options.claimed.size != null && options.claimed.size !== options.stagedSize) {
    return { action: 'keep', reason: 'mismatch' };
  }
  return { action: 'accept' };
}
