import { z } from 'zod';

export const extractUrlsSchema = z.object({
  text: z.string().min(1, 'Text is required'),
});

export type ExtractUrlsDto = z.infer<typeof extractUrlsSchema>;
