/**
 * DTOs for workflow API (aligned with Express workflow routes).
 */

export class CreateWorkflowTemplateDto {
  name!: string;
  description?: string;
  version?: string;
  steps!: Array<{
    id: string;
    name: string;
    type: string;
    metadata?: unknown;
    dependencies: string[];
    conditions?: { if: string; then: string; else?: string };
  }>;
  variables?: Record<string, unknown>;
  triggers?: unknown[];
  settings?: unknown;
  tags?: string[];
}

export class ExecuteWorkflowDto {
  input?: unknown;
  variables?: Record<string, unknown>;
  environment?: string;
  tags?: string[];
}

export class WorkflowListQueryDto {
  page?: number;
  limit?: number;
}

export class WorkflowMetricsQueryDto {
  timeRange?: string;
}
