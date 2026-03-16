import { z } from 'zod';

// Track usage DTO - mirrors trackUsageSchema from Express validators
export const TrackUsageDto = z.object({
  service: z.enum([
    'openai',
    'aws-bedrock',
    'google-ai',
    'anthropic',
    'huggingface',
    'cohere',
  ]),
  model: z.string().min(1, 'Model is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  completion: z.string().optional(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  responseTime: z.number().nonnegative(),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
  projectId: z.string().optional(),
});

export type TrackUsageDtoType = z.infer<typeof TrackUsageDto>;
