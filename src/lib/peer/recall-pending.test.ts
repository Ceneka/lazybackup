import { describe, expect, test } from 'bun:test'
import {
  PEER_RECALL_WAITING_MESSAGE,
  PeerRecallPendingError,
  peerRecallWaitingResponse,
} from './recall-pending'

describe('peer recall pending', () => {
  test('waiting payload is HTTP 202 body', () => {
    expect(peerRecallWaitingResponse('rec-1')).toEqual({
      status: 'waiting',
      recallId: 'rec-1',
      message: PEER_RECALL_WAITING_MESSAGE,
    })
  })

  test('PeerRecallPendingError carries recallId and user copy', () => {
    const err = new PeerRecallPendingError('rec-9')
    expect(err).toBeInstanceOf(PeerRecallPendingError)
    expect(err.recallId).toBe('rec-9')
    expect(err.status).toBe('waiting')
    expect(err.message).toBe(PEER_RECALL_WAITING_MESSAGE)
  })
})
