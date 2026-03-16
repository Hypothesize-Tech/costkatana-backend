import { z } from 'zod';

// Bulk upload usage DTO - mirrors bulk upload schema from Express controller
export const BulkUploadUsageDto = z.object({
  usageData: z
    .array(
      z.object({
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

        // Optional fields that can be added during bulk upload
        workflowId: z.string().optional(),
        workflowName: z.string().optional(),
        workflowStep: z.string().optional(),
        workflowSequence: z.number().min(0).optional(),
        userEmail: z.string().email().optional(),
        customerEmail: z.string().email().optional(),
        errorOccurred: z.boolean().optional(),
        errorMessage: z.string().optional(),
        httpStatusCode: z.number().min(100).max(599).optional(),
        errorType: z
          .enum([
            'client_error',
            'server_error',
            'network_error',
            'auth_error',
            'rate_limit',
            'timeout',
            'validation_error',
            'integration_error',
          ])
          .optional(),
        optimizationApplied: z.boolean().optional(),
      }),
    )
    .min(1, 'At least one usage record is required')
    .max(1000, 'Maximum 1000 records per bulk upload'),
});

export type BulkUploadUsageDtoType = z.infer<typeof BulkUploadUsageDto>;
