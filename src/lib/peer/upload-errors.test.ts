import { describe, expect, test } from 'bun:test';
import { PeerUploadLimitError } from './upload-limit';
import { publicUploadErrorMessage } from './upload-errors';

describe('publicUploadErrorMessage', () => {
  test('keeps upload-limit status and message', () => {
    const result = publicUploadErrorMessage(new PeerUploadLimitError('too big', 413));
    expect(result).toEqual({ status: 413, message: 'too big' });
  });

  test('keeps quota and digest messages', () => {
    expect(
      publicUploadErrorMessage(new Error('Peer quota exceeded: need 9 bytes')).message
    ).toMatch(/quota exceeded/i);
    expect(
      publicUploadErrorMessage(new Error('recall artifact SHA-256 mismatch: a vs b'))
        .message
    ).toMatch(/SHA-256 mismatch/);
  });

  test('hides filesystem paths from raw fs errors', () => {
    const result = publicUploadErrorMessage(
      new Error(
        "EISDIR: illegal operation on a directory, copyfile '/tmp/lb-peer-upload-x/body' -> '/backups/peers/p'"
      )
    );
    expect(result).toEqual({ status: 400, message: 'Upload failed' });
  });
});
