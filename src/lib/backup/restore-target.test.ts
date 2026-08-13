import { describe, expect, test } from 'bun:test';
import {
  RESTORE_S3_SOURCE_TO_SERVER,
  RESTORE_SERVER_RETARGET_REQUIRED,
  resolveRestoreHost,
} from './restore-target';

describe('resolveRestoreHost', () => {
  test('requires confirm=true', () => {
    expect(() =>
      resolveRestoreHost({
        sourceKind: 'local',
        confirm: false,
      })
    ).toThrow(/confirm=true/i);
  });

  test('local source with no target stays on this host', () => {
    expect(
      resolveRestoreHost({
        sourceKind: 'local',
        originalServerId: 'ignored',
        confirm: true,
      })
    ).toEqual({
      kind: 'local',
      serverId: null,
      originalServerId: null,
      retargeted: false,
    });
  });

  test('local source onto a server requires allowRetarget', () => {
    expect(() =>
      resolveRestoreHost({
        sourceKind: 'local',
        targetServerId: 's2',
        confirm: true,
      })
    ).toThrow(RESTORE_SERVER_RETARGET_REQUIRED);

    expect(
      resolveRestoreHost({
        sourceKind: 'local',
        targetServerId: 's2',
        confirm: true,
        allowRetarget: true,
      })
    ).toEqual({
      kind: 'server',
      serverId: 's2',
      originalServerId: null,
      retargeted: true,
    });
  });

  test('server source defaults to the original server', () => {
    expect(
      resolveRestoreHost({
        sourceKind: 'server',
        originalServerId: 's1',
        confirm: true,
      })
    ).toEqual({
      kind: 'server',
      serverId: 's1',
      originalServerId: 's1',
      retargeted: false,
    });
  });

  test('same server id is not a retarget', () => {
    expect(
      resolveRestoreHost({
        sourceKind: 'server',
        originalServerId: 's1',
        targetServerId: 's1',
        confirm: true,
      })
    ).toEqual({
      kind: 'server',
      serverId: 's1',
      originalServerId: 's1',
      retargeted: false,
    });
  });

  test('retarget without allowRetarget throws', () => {
    expect(() =>
      resolveRestoreHost({
        sourceKind: 'server',
        originalServerId: 's1',
        targetServerId: 's2',
        confirm: true,
      })
    ).toThrow(RESTORE_SERVER_RETARGET_REQUIRED);
  });

  test('restore to a different server id uses that server', () => {
    expect(
      resolveRestoreHost({
        sourceKind: 'server',
        originalServerId: 's1',
        targetServerId: 's2',
        confirm: true,
        allowRetarget: true,
      })
    ).toEqual({
      kind: 'server',
      serverId: 's2',
      originalServerId: 's1',
      retargeted: true,
    });
  });

  test('S3 source stays on S3 and rejects an SSH target', () => {
    expect(
      resolveRestoreHost({
        sourceKind: 's3',
        confirm: true,
      })
    ).toEqual({
      kind: 's3',
      serverId: null,
      originalServerId: null,
      retargeted: false,
    });
    expect(() =>
      resolveRestoreHost({
        sourceKind: 's3',
        targetServerId: 's2',
        confirm: true,
        allowRetarget: true,
      })
    ).toThrow(RESTORE_S3_SOURCE_TO_SERVER);
  });
});
