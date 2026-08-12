import { z } from 'zod';

export const historyStatusSchema = z.enum(['running', 'success', 'failed']);

const optionalDate = z.coerce.date().optional().nullable();
const optionalInt = z.coerce.number().int().optional().nullable();

/** Shape of a history row the backup engine writes. Not exposed as HTTP POST. */
export const createHistorySchema = z
  .object({
    id: z.string().min(1).optional(),
    configId: z.string().min(1),
    status: historyStatusSchema,
    startTime: z.coerce.date().optional(),
    endTime: optionalDate,
    fileCount: optionalInt,
    totalSize: optionalInt,
    transferredSize: optionalInt,
    errorMessage: z.string().optional().nullable(),
    logOutput: z.string().optional().nullable(),
    artifactPath: z.string().optional().nullable(),
  })
  .strict();

/** Shape of a history row patch. Not exposed as HTTP PUT. */
export const updateHistorySchema = z
  .object({
    status: historyStatusSchema.optional(),
    startTime: z.coerce.date().optional(),
    endTime: optionalDate,
    fileCount: optionalInt,
    totalSize: optionalInt,
    transferredSize: optionalInt,
    errorMessage: z.string().optional().nullable(),
    logOutput: z.string().optional().nullable(),
    artifactPath: z.string().optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

/** POST /api/history/:id/restore — MCP-style confirm gate plus optional target. */
export const restoreHistorySchema = z.object({
  confirm: z.literal(true),
  allowRetarget: z.boolean().optional(),
  volumeName: z.string().min(1).optional(),
  databaseName: z.string().min(1).optional(),
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
