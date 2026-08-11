import { z } from 'zod';

export const s3ProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  endpoint: z.string().url('Endpoint must be a valid URL'),
  region: z.string().min(1).default('us-east-1'),
  bucket: z.string().min(1, 'Bucket is required'),
  accessKeyId: z.string().min(1, 'Access key is required'),
  secretAccessKey: z.string().min(1, 'Secret key is required'),
  forcePathStyle: z.boolean().default(true),
});

/** Update: empty/missing secretAccessKey means keep the existing secret. */
export const s3ProfileUpdateSchema = s3ProfileSchema.extend({
  secretAccessKey: z.string().optional(),
});
