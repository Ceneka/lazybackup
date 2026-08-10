import { DOCKER_VOLUME_NAME_RE } from '@/lib/docker/volumes';
import { z } from 'zod';

export const backupConfigSchema = z
  .object({
    serverId: z.string().min(1, 'Server ID is required'),
    name: z.string().min(1, 'Name is required'),
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
    if (data.enableVersioning && data.enableFileRetention) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File retention cannot be enabled together with versioning',
        path: ['enableFileRetention'],
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
  });
