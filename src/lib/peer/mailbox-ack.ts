import { timingSafeEqualHex } from './digest';

export type MailboxAckInput = {
  key: string;
  size?: number;
  sha256?: string;
  exists?: boolean;
};

export type MailboxDeleteAckDecision =
  | { action: 'accept' }
  | { action: 'keep'; reason: 'missing_proof' | 'still_exists' };

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

/**
 * Delete ACK is trusted only when the bro proves the object is gone (exists=false, size 0).
 */
export function decideMailboxDeleteAck(claimed: MailboxAckInput): MailboxDeleteAckDecision {
  if (claimed.exists !== false) {
    return { action: 'keep', reason: 'missing_proof' };
  }
  if (claimed.size != null && claimed.size !== 0) {
    return { action: 'keep', reason: 'still_exists' };
  }
  return { action: 'accept' };
}
