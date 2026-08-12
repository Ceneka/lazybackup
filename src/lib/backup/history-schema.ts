import { z } from 'zod';

export const historyStatusSchema = z.enum(['running', 'success', 'failed']);

const optionalDate = z.coerce.date().optional().nullable();
const optionalInt = z.coerce.number().int().optional().nullable();

/** POST /api/history — create a history row (internal/dev; validated fields only). */
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
    artifactSha256: z.string().optional().nullable(),
    mailboxPending: z.boolean().optional(),
  })
  .strict();

/** PUT /api/history/:id — partial update; unknown keys rejected. */
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
    artifactSha256: z.string().optional().nullable(),
    mailboxPending: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });
