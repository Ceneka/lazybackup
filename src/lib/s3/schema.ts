import { z } from 'zod';
import { normalizeS3ProfileFields } from './normalize';

const s3ProfileBaseSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  endpoint: z.string().trim().url('Endpoint must be a valid URL'),
  region: z.string().trim().min(1).default('us-east-1'),
  bucket: z.string().trim().min(1, 'Bucket is required'),
  accessKeyId: z.string().trim().min(1, 'Access key is required'),
  secretAccessKey: z.string().trim().min(1, 'Secret key is required'),
  forcePathStyle: z.boolean().default(true),
});

export const s3ProfileSchema = s3ProfileBaseSchema.transform((data) =>
  normalizeS3ProfileFields(data)
);

/** Update: empty/missing secretAccessKey means keep the existing secret. */
export const s3ProfileUpdateSchema = s3ProfileBaseSchema
  .extend({
    secretAccessKey: z.string().optional(),
  })
  .transform((data) => normalizeS3ProfileFields(data));
