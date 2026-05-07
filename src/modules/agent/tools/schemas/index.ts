/**
 * Per-tool Zod schemas for model-issued tool calls.
 *
 * Anything registered here gets validated before dispatch in
 * `bedrock.service.ts`. Tools NOT registered here pass through unvalidated
 * with a one-time warning. Migrate tools incrementally — each addition
 * raises the security floor without breaking unregistered ones.
 *
 * Conventions:
 * - Use `z.object(...).strict()` so unknown fields are rejected.
 * - Mirror tool names exactly as they appear in the Bedrock tool spec.
 * - Keep schemas conservative: it's safer to require fewer fields and let
 *   the tool default the rest, than to require something the model rarely
 *   supplies.
 */
import { z } from 'zod';
import { registerToolSchema } from '../../../../common/security/tool-arg-validator';

export const webSearchArgsSchema = z
  .object({
    query: z.string().min(1).max(2000),
    maxResults: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const knowledgeBaseArgsSchema = z
  .object({
    query: z.string().min(1).max(4000),
    topK: z.number().int().min(1).max(50).optional(),
    documentIds: z.array(z.string()).max(50).optional(),
  })
  .strict();

export const mongodbReaderArgsSchema = z
  .object({
    operation: z.enum(['find', 'aggregate', 'count', 'distinct']),
    collection: z.string().min(1).max(120),
    filter: z.record(z.unknown()).optional(),
    pipeline: z.array(z.record(z.unknown())).max(20).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export const projectManagerArgsSchema = z
  .object({
    action: z.enum(['list', 'get', 'create', 'update']),
    projectId: z.string().optional(),
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export const modelSelectorArgsSchema = z
  .object({
    task: z.string().min(1).max(2000),
    constraints: z
      .object({
        maxCostPer1MTokens: z.number().min(0).optional(),
        maxLatencyMs: z.number().int().min(0).optional(),
        capabilities: z
          .array(z.enum(['vision', 'tools', 'json', 'long_context']))
          .optional(),
      })
      .optional(),
  })
  .strict();

/**
 * Registers all schemas above with the validator. Call once at module init.
 * Kept idempotent so hot-reload during dev doesn't double-register or throw.
 */
export function registerAgentToolSchemas(): void {
  registerToolSchema('web_search', webSearchArgsSchema);
  registerToolSchema('knowledge_base', knowledgeBaseArgsSchema);
  registerToolSchema('mongodb_reader', mongodbReaderArgsSchema);
  registerToolSchema('project_manager', projectManagerArgsSchema);
  registerToolSchema('model_selector', modelSelectorArgsSchema);
}
