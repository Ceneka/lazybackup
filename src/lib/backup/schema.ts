import { DOCKER_VOLUME_NAME_RE } from '@/lib/docker/volumes';
import { z } from 'zod';

export const backupConfigSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    sourceKind: z.enum(['local', 'server']).default('server'),
    /** Source server when sourceKind === 'server' (legacy field name) */
    serverId: z.string().nullable().optional(),
    destinationKind: z.enum(['local', 'server']).default('local'),
    destinationServerId: z.string().nullable().optional(),
    sourceType: z.enum(['path', 'docker_volume']).default('path'),
    sourcePath: z.string().min(1, 'Source path is required'),
    destinationPath: z.string().min(1, 'Destination path is required'),
    schedule: z.string().min(1, 'Schedule is required'),
    excludePatterns: z.string().optional(),
    preBackupCommands: z.string().optional(),
    enabled: z.boolean().default(true),
    enableVersioning: z.boolean().default(false),
    versionsToKeep: z.coerce.number().min(1).max(100).optional().default(5),
    enableFileRetention: z.boolean().default(false),
    retentionMaxAge: z.coerce.number().min(1).max(3650).optional().default(30),
    retentionMaxAgeUnit: z.enum(['days', 'months']).default('days'),
    retentionMinKeep: z.coerce.number().min(1).max(10000).optional().default(5),
  })
  .superRefine((data, ctx) => {
    if (data.sourceKind === 'server') {
      if (!data.serverId || !data.serverId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source server is required',
          path: ['serverId'],
        });
      }
    }

    if (data.destinationKind === 'server') {
      if (!data.destinationServerId || !data.destinationServerId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination server is required',
          path: ['destinationServerId'],
        });
      }
    }

    if (data.sourceType === 'docker_volume' && data.sourceKind !== 'server') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Docker volume sources require a source server',
        path: ['sourceType'],
      });
    }

    if (data.sourceType === 'docker_volume' && !DOCKER_VOLUME_NAME_RE.test(data.sourcePath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Invalid Docker volume name. Names must start with a letter or digit and contain only letters, digits, underscore, period, or hyphen.',
        path: ['sourcePath'],
      });
    }

    if (data.enableVersioning && data.enableFileRetention) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File retention cannot be enabled together with versioning',
        path: ['enableFileRetention'],
      });
    }

    const sameServer =
      data.sourceKind === 'server' &&
      data.destinationKind === 'server' &&
      data.serverId &&
      data.destinationServerId &&
      data.serverId === data.destinationServerId;
    const bothLocal = data.sourceKind === 'local' && data.destinationKind === 'local';
    if ((sameServer || bothLocal) && data.sourcePath.trim() === data.destinationPath.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Source and destination cannot be the same path on the same endpoint',
        path: ['destinationPath'],
      });
    }
  })
  .transform((data) => ({
    ...data,
    serverId: data.sourceKind === 'server' ? data.serverId || null : null,
    destinationServerId: data.destinationKind === 'server' ? data.destinationServerId || null : null,
  }));
