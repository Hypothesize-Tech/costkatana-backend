import { z } from 'zod';

export const extractLinkMetadataSchema = z.object({
  url: z.string().min(1, 'URL is required').url('Invalid URL format'),
});

export type ExtractLinkMetadataDto = z.infer<typeof extractLinkMetadataSchema>;
