import { describe, expect, test } from 'bun:test';
import {
  buildStatusChecks,
  summarizeStatusChecks,
  type StatusSnapshot,
} from './build-status';

function baseSnapshot(over: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    auth: {
      authEnabled: true,
      authSetupCompleted: true,
      hasPassword: true,
      passkeyCount: 0,
      ...over.auth,
    },
    encryption: {
      configured: false,
      needsExportAck: false,
      encryptionInUse: false,
      keyCount: 0,
      recoveryRecipientCount: 0,
      activeKeyExportAcknowledged: false,
      compromisedKeyCount: 0,
      ...over.encryption,
    },
    instanceBackup: {
      configCount: 0,
      enabledCount: 0,
      withPassphraseCount: 0,
      lastSuccessAgeDays: null,
      ...over.instanceBackup,
    },
    notifications: {
      failureWebhookConfigured: false,
      ...over.notifications,
    },
    apiTokens: {
      activeCount: 0,
      remoteExecCount: 0,
      ...over.apiTokens,
    },
    backups: {
      total: 0,
      enabled: 0,
      encryptedOrPeerCount: 0,
      failedLast24h: 0,
      overdueSchedules: [],
      ...over.backups,
    },
    servers: {
      total: 0,
      passwordOnlyCount: 0,
      ...over.servers,
    },
    cookieSecure: false,
    ...over,
  };
}

describe('buildStatusChecks', () => {
  test('flags unlocked dashboard as critical', () => {
    const checks = buildStatusChecks(
      baseSnapshot({
        auth: {
          authEnabled: false,
          authSetupCompleted: false,
          hasPassword: false,
          passkeyCount: 0,
        },
      })
    );
    expect(checks.some((c) => c.id === 'auth-open' && c.severity === 'critical')).toBe(
      true
    );
    expect(summarizeStatusChecks(checks).overall).toBe('critical');
  });

  test('warns when instance backup missing', () => {
    const checks = buildStatusChecks(baseSnapshot());
    expect(checks.some((c) => c.id === 'instance-backup-missing')).toBe(true);
  });

  test('warns on encryption export ack when in use', () => {
    const checks = buildStatusChecks(
      baseSnapshot({
        encryption: {
          configured: true,
          needsExportAck: true,
          encryptionInUse: true,
          keyCount: 1,
          recoveryRecipientCount: 0,
          activeKeyExportAcknowledged: false,
          compromisedKeyCount: 0,
        },
      })
    );
    expect(checks.some((c) => c.id === 'encryption-export')).toBe(true);
    expect(checks.some((c) => c.id === 'encryption-recovery')).toBe(true);
  });

  test('ok when instance backup recent', () => {
    const checks = buildStatusChecks(
      baseSnapshot({
        instanceBackup: {
          configCount: 1,
          enabledCount: 1,
          withPassphraseCount: 1,
          lastSuccessAgeDays: 1,
        },
      })
    );
    expect(checks.some((c) => c.id === 'instance-backup-ok')).toBe(true);
    expect(checks.some((c) => c.id === 'instance-backup-passphrase-ok')).toBe(true);
  });

  test('warns password-only servers', () => {
    const checks = buildStatusChecks(
      baseSnapshot({
        servers: { total: 2, passwordOnlyCount: 1 },
      })
    );
    expect(checks.some((c) => c.id === 'servers-password-only')).toBe(true);
  });

  test('warns overdue schedules and caps names', () => {
    const checks = buildStatusChecks(
      baseSnapshot({
        backups: {
          total: 6,
          enabled: 6,
          encryptedOrPeerCount: 0,
          failedLast24h: 0,
          overdueSchedules: [
            { id: '1', name: 'Daily DB' },
            { id: '2', name: 'Path' },
            { id: '3', name: 'Vol' },
            { id: '4', name: 'S3' },
            { id: '5', name: 'Inst' },
            { id: '6', name: 'Extra' },
          ],
        },
      })
    );
    const row = checks.find((c) => c.id === 'schedules-overdue');
    expect(row?.severity).toBe('warn');
    expect(row?.detail).toContain('Daily DB');
    expect(row?.detail).toContain('and 1 more');
    expect(row?.href).toBe('/history');
  });
});
