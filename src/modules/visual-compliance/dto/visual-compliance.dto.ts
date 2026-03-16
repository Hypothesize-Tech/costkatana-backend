import { z } from 'zod';

// Base schema for visual compliance check
const baseComplianceSchema = z.object({
  referenceImage: z.string().min(1, 'referenceImage is required'),
  evidenceImage: z.string().min(1, 'evidenceImage is required'),
  complianceCriteria: z
    .array(z.string().min(1, 'Each criterion must be a non-empty string'))
    .min(1, 'complianceCriteria must be a non-empty array'),
  industry: z.enum(['jewelry', 'grooming', 'retail', 'fmcg', 'documents'], {
    errorMap: () => ({
      message:
        'Invalid industry. Must be one of: jewelry, grooming, retail, fmcg, documents',
    }),
  }),
  useUltraCompression: z.boolean().default(true),
  mode: z.enum(['optimized', 'standard']).default('optimized'),
  metaPrompt: z.string().optional(),
  metaPromptPresetId: z.string().optional(),
  templateId: z.string().optional(),
  projectId: z.string().optional(),
});

// Schema for single compliance check (POST /check-optimized)
export const checkComplianceSchema = baseComplianceSchema;

// Schema for batch compliance checks (POST /batch)
export const batchCheckSchema = z.object({
  requests: z
    .array(baseComplianceSchema)
    .min(1, 'requests array must not be empty')
    .max(10, 'Maximum 10 requests allowed in batch'),
});

// Inferred TypeScript types
export type CheckComplianceDto = z.infer<typeof checkComplianceSchema>;
export type BatchCheckDto = z.infer<typeof batchCheckSchema>;
export type VisualComplianceRequest = z.infer<typeof baseComplianceSchema>;
