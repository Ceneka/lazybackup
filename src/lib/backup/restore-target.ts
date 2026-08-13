/** Where a restore lands: original source, this host, or a different configured server. */

export type ResolvedRestoreHost = {
  kind: 'local' | 'server' | 's3';
  /** Server to restore onto; null for local copy or S3 prefix restore. */
  serverId: string | null;
  originalServerId: string | null;
  retargeted: boolean;
};

export const RESTORE_SERVER_RETARGET_REQUIRED =
  'Refusing to restore to a different server: pass allowRetarget=true (and confirm=true)';

export const RESTORE_S3_SOURCE_TO_SERVER =
  'Restoring an S3-source path backup onto an SSH host is not supported';

/**
 * Resolve the restore host from the job’s original source plus optional targetServerId.
 * Changing host (including local → SSH) requires allowRetarget + confirm.
 */
export function resolveRestoreHost(input: {
  sourceKind?: string | null;
  originalServerId?: string | null;
  targetServerId?: string | null;
  allowRetarget?: boolean;
  confirm?: boolean;
}): ResolvedRestoreHost {
  if (!input.confirm) {
    throw new Error('Refusing to restore: pass confirm=true to proceed');
  }

  const sourceKind = input.sourceKind || 'server';
  const requested = input.targetServerId?.trim() || null;
  const originalServerId =
    sourceKind === 'local' || sourceKind === 's3'
      ? null
      : input.originalServerId?.trim() || null;

  if (sourceKind === 's3') {
    if (requested) {
      throw new Error(RESTORE_S3_SOURCE_TO_SERVER);
    }
    return {
      kind: 's3',
      serverId: null,
      originalServerId: null,
      retargeted: false,
    };
  }

  if (sourceKind === 'local') {
    if (!requested) {
      return {
        kind: 'local',
        serverId: null,
        originalServerId: null,
        retargeted: false,
      };
    }
    if (!input.allowRetarget) {
      throw new Error(RESTORE_SERVER_RETARGET_REQUIRED);
    }
    return {
      kind: 'server',
      serverId: requested,
      originalServerId: null,
      retargeted: true,
    };
  }

  if (!requested) {
    return {
      kind: 'server',
      serverId: originalServerId,
      originalServerId,
      retargeted: false,
    };
  }

  const retargeted = requested !== originalServerId;
  if (retargeted && !input.allowRetarget) {
    throw new Error(RESTORE_SERVER_RETARGET_REQUIRED);
  }
  return {
    kind: 'server',
    serverId: requested,
    originalServerId,
    retargeted,
  };
}
