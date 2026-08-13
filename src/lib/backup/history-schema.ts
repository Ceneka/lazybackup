import { z } from 'zod';

/** POST /api/history/:id/restore — MCP-style confirm gate plus optional target. */
export const restoreHistorySchema = z.object({
  confirm: z.literal(true),
  allowRetarget: z.boolean().optional(),
  volumeName: z.string().min(1).optional(),
  databaseName: z.string().min(1).optional(),
  targetPath: z.string().min(1).optional(),
  /** Restore onto this server instead of the original source (or onto SSH from a local source). */
  targetServerId: z.string().min(1).nullable().optional(),
});

export const RESTORE_CONFIRM_REQUIRED =
  'Refusing to restore: pass confirm=true to proceed';

export function hasRestoreConfirm(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { confirm?: unknown }).confirm === true
  );
}
