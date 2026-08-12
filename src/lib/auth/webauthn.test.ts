import { describe, expect, test } from 'bun:test';
import { webauthnRpFromRequest } from '../auth/webauthn';

describe('webauthnRpFromRequest', () => {
  test('uses host header and defaults http for localhost', () => {
    const headers = new Headers({ host: 'localhost:3000' });
    const { rpID, origin } = webauthnRpFromRequest({ headers });
    expect(rpID).toBe('localhost');
    expect(origin).toBe('http://localhost:3000');
  });

  test('respects x-forwarded-proto and x-forwarded-host', () => {
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'backup.example.com',
      'x-forwarded-proto': 'https',
    });
    const { rpID, origin } = webauthnRpFromRequest({ headers });
    expect(rpID).toBe('backup.example.com');
    expect(origin).toBe('https://backup.example.com');
  });
});
