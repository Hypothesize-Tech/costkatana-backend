import { z } from 'zod';

// SDK track usage DTO - mirrors sdkTrackUsageSchema from Express validators
export const SdkTrackUsageDto = z
  .object({
    provider: z
      .enum([
        'openai',
        'anthropic',
        'aws-bedrock',
        'google-ai',
        'huggingface',
        'cohere',
      ])
      .optional(),
    service: z
      .enum([
        'openai',
        'anthropic',
        'aws-bedrock',
        'google-ai',
        'huggingface',
        'cohere',
      ])
      .optional(),
    model: z.string(),
    prompt: z.string().optional().default(''),
    completion: z.string().optional(),
    promptTokens: z.number().min(0),
    completionTokens: z.number().min(0),
    totalTokens: z.number().min(0).optional(),
    cost: z.number().min(0).optional(),
    estimatedCost: z.number().min(0).optional(),
    responseTime: z.number().min(0).optional().default(0),
    metadata: z.object({}).optional().default({}),
    tags: z.array(z.string()).optional().default([]),
    projectId: z.string().optional(),
    // Workflow tracking fields
    workflowId: z.string().optional(),
    workflowName: z.string().optional(),
    workflowStep: z.string().optional(),
    workflowSequence: z.number().min(0).optional(),
    // Email fields for user and customer identification
    userEmail: z.string().email().optional(),
    customerEmail: z.string().email().optional(),
    // Enhanced request/response data
    messages: z
      .array(
        z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string(),
        }),
      )
      .optional(),
    system: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    // Enhanced metadata for comprehensive tracking
    requestMetadata: z
      .object({
        messages: z
          .array(
            z.object({
              role: z.enum(['system', 'user', 'assistant']),
              content: z.string(),
            }),
          )
          .optional(),
        system: z.string().optional(),
        input: z.string().optional(),
        prompt: z.string().optional(),
      })
      .optional(),
    responseMetadata: z
      .object({
        completion: z.string().optional(),
        output: z.string().optional(),
        choices: z
          .array(
            z.object({
              message: z
                .object({
                  content: z.string(),
                  role: z.string(),
                })
                .optional(),
              text: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .refine((data) => data.provider || data.service, {
    message: "Either 'provider' or 'service' must be provided",
  });

export type SdkTrackUsageDtoType = z.infer<typeof SdkTrackUsageDto>;
