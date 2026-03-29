/**
 * Experimentation Module DTOs
 *
 * Zod-validated Data Transfer Objects for all experimentation endpoints.
 * Provides runtime validation and TypeScript type inference.
 */

import { z } from 'zod';

/**
 * Create a DTO class from a Zod schema (local replacement when nestjs-zod is not resolved).
 * Use Nest ValidationPipe with ZodSchemaPipe or parse in controller.
 */
function createZodDto<T extends z.ZodTypeAny>(schema: T): new () => z.infer<T> {
  return class {} as new () => z.infer<T>;
}

/** Shared object shape — must stay a ZodObject so `.extend()` works (`.refine()` yields ZodEffects, which has no `.extend`). */
const ModelComparisonBaseSchema = z.object({
  prompt: z.string().optional(),
  prompts: z.array(z.string().min(1)).optional(),
  models: z
    .array(
      z.object({
        provider: z.string().min(1, 'Provider is required'),
        model: z.string().min(1, 'Model is required'),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).max(100000).optional(),
      }),
    )
    .min(1, 'At least one model is required'),
  evaluationCriteria: z
    .array(z.string())
    .min(1, 'At least one evaluation criterion is required'),
  iterations: z.number().int().min(1).max(50).default(1),
});

function hasPromptOrPrompts(data: {
  prompt?: string;
  prompts?: string[];
}): boolean {
  const p = data.prompt?.trim() ?? '';
  const ps = data.prompts?.filter((x) => x.trim().length > 0) ?? [];
  return p.length > 0 || ps.length > 0;
}

const promptOrPromptsIssue = {
  message: 'Provide prompt or at least one prompts[] entry',
  path: ['prompt'],
};

/**
 * DTO for running model comparison experiments
 */
const ModelComparisonDtoSchema =
  ModelComparisonBaseSchema.refine(hasPromptOrPrompts, promptOrPromptsIssue);

export class RunModelComparisonDto extends createZodDto(
  ModelComparisonDtoSchema,
) {}

/** Exported for use with ZodPipe in controller */
export { ModelComparisonDtoSchema };

/**
 * DTO for starting real-time model comparison with SSE
 * sessionId is optional - server generates one when not provided (for SSE progress streaming)
 */
const RealTimeComparisonDtoSchema = ModelComparisonBaseSchema.extend({
  sessionId: z
    .string()
    .min(1, 'Session ID must be non-empty when provided')
    .optional(),
  executeOnBedrock: z.boolean().default(true),
  evaluationPrompt: z.string().optional(),
  comparisonMode: z
    .enum(['quality', 'cost', 'speed', 'comprehensive'])
    .default('comprehensive'),
}).refine(hasPromptOrPrompts, promptOrPromptsIssue);

export class StartRealTimeComparisonDto extends createZodDto(
  RealTimeComparisonDtoSchema,
) {}

/** Exported for use with ZodPipe in controller */
export { RealTimeComparisonDtoSchema };

/**
 * DTO for estimating experiment costs
 */
const EstimateExperimentCostDtoSchema = z.object({
  type: z.enum(['model_comparison', 'what_if', 'fine_tuning']),
  parameters: z.record(z.any()),
});

export class EstimateExperimentCostDto extends createZodDto(
  EstimateExperimentCostDtoSchema,
) {}

/**
 * DTO for creating what-if scenarios
 */
const CreateWhatIfScenarioDtoSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(1000, 'Description must be less than 1000 characters'),
  changes: z.union([z.array(z.any()), z.record(z.string(), z.any())]),
  timeframe: z.union([
    z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    z.record(z.string(), z.any()),
  ]),
  baselineData: z.union([
    z.object({
      cost: z.number(),
      volume: z.number(),
      performance: z.number(),
    }),
    z.record(z.string(), z.any()),
  ]),
  lifecycleStatus: z
    .enum(['draft', 'approved', 'implemented', 'measured'])
    .optional(),
});

export class CreateWhatIfScenarioDto extends createZodDto(
  CreateWhatIfScenarioDtoSchema,
) {}

/**
 * DTO for running real-time what-if simulations
 */
const RunRealTimeSimulationDtoSchema = z.object({
  simulationType: z.enum([
    'prompt_optimization',
    'context_trimming',
    'model_comparison',
    'real_time_analysis',
  ]),
  prompt: z.string().optional(),
  currentModel: z.string().optional(),
  options: z
    .object({
      trimPercentage: z.number().min(0).max(100).optional(),
      alternativeModels: z.array(z.string()).optional(),
      optimizationGoals: z
        .array(z.enum(['cost', 'speed', 'quality']))
        .optional(),
    })
    .optional(),
});

export class RunRealTimeSimulationDto extends createZodDto(
  RunRealTimeSimulationDtoSchema,
) {}

/**
 * DTO for experiment history query parameters
 */
const GetExperimentHistoryQueryDtoSchema = z.object({
  type: z.enum(['model_comparison', 'what_if', 'fine_tuning']).optional(),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z
    .string()
    .transform((val) => parseInt(val))
    .refine((val) => val > 0 && val <= 100, 'Limit must be between 1 and 100')
    .optional(),
});

export class GetExperimentHistoryQueryDto extends createZodDto(
  GetExperimentHistoryQueryDtoSchema,
) {}

/** Inferred type for query params (createZodDto class type may not expose all properties to TS) */
export type GetExperimentHistoryQueryDtoType = z.infer<
  typeof GetExperimentHistoryQueryDtoSchema
>;

/**
 * DTO for what-if scenario analysis query
 */
const RunWhatIfAnalysisQueryDtoSchema = z.object({
  scenarioName: z.string().min(1, 'Scenario name is required'),
});

export class RunWhatIfAnalysisQueryDto extends createZodDto(
  RunWhatIfAnalysisQueryDtoSchema,
) {}

/**
 * DTO for experiment deletion
 */
const DeleteExperimentDtoSchema = z.object({
  experimentId: z.string().min(1, 'Experiment ID is required'),
});

export class DeleteExperimentDto extends createZodDto(
  DeleteExperimentDtoSchema,
) {}

/**
 * DTO for what-if scenario deletion
 */
const DeleteWhatIfScenarioDtoSchema = z.object({
  scenarioName: z.string().min(1, 'Scenario name is required'),
});

export class DeleteWhatIfScenarioDto extends createZodDto(
  DeleteWhatIfScenarioDtoSchema,
) {}

/**
 * DTO for getting experiment details
 */
const GetExperimentDtoSchema = z.object({
  experimentId: z.string().min(1, 'Experiment ID is required'),
});

export class GetExperimentDto extends createZodDto(GetExperimentDtoSchema) {}

/**
 * DTO for session validation (used in SSE endpoints)
 */
export const SessionValidationSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
});

export class SessionValidationDto extends createZodDto(
  SessionValidationSchema,
) {}
