/** User-facing copy when a mailbox recall is not staged yet (HTTP 202). */
export const PEER_RECALL_WAITING_MESSAGE =
  'Waiting for Bro — keep LazyBro running.'

export const PEER_RECALL_STAY_ONLINE =
  'Your friend is restoring a backup — stay online.'

export type PeerRecallWaitingBody = {
  status: 'waiting'
  recallId: string
  message: string
}

export function peerRecallWaitingResponse(recallId: string): PeerRecallWaitingBody {
  return {
    status: 'waiting',
    recallId,
    message: PEER_RECALL_WAITING_MESSAGE,
  }
}

/** Mailbox object is not staged yet; callers return HTTP 202 instead of blocking. */
export class PeerRecallPendingError extends Error {
  readonly recallId: string
  readonly status = 'waiting' as const

  constructor(recallId: string) {
    super(PEER_RECALL_WAITING_MESSAGE)
    this.name = 'PeerRecallPendingError'
    this.recallId = recallId
  }
}
