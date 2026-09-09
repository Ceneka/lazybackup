import { z } from 'zod';
import { gitUrlNeedsSshKey, parseGitUrl } from './mirror';

export const gitRepoSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    url: z.string().trim().min(1, 'Git URL is required'),
    sshKeyId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    try {
      parseGitUrl(data.url);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid Git URL',
        path: ['url'],
      });
      return;
    }
    if (gitUrlNeedsSshKey(data.url) && !data.sshKeyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SSH Git URLs require a key from Settings → SSH keys',
        path: ['sshKeyId'],
      });
    }
  })
  .transform((data) => ({
    name: data.name,
    url: data.url.trim(),
    sshKeyId: data.sshKeyId?.trim() || null,
  }));
