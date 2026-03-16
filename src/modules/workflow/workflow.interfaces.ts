/**
 * Workflow module interfaces (aligned with Express workflowOrchestrator).
 */

export type WorkflowStepType =
  | 'llm_call'
  | 'data_processing'
  | 'api_call'
  | 'conditional'
  | 'parallel'
  | 'custom';

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type WorkflowExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export interface WorkflowStepMetadata {
  model?: string;
  provider?: string;
  tokens?: { input: number; output: number; total: number };
  cost?: number;
  retryAttempts?: number;
  cacheHit?: boolean;
  latency?: number;
  [key: string]: unknown;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: WorkflowStepType;
  status: WorkflowStepStatus;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: WorkflowStepMetadata;
  dependencies?: string[];
  conditions?: {
    if: string;
    then: string;
    else?: string;
  };
}

export interface WorkflowExecutionMetadata {
  totalCost?: number;
  totalTokens?: number;
  cacheHitRate?: number;
  averageLatency?: number;
  environment?: string;
  version?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  name: string;
  userId: string;
  status: WorkflowExecutionStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  steps: WorkflowStep[];
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: WorkflowExecutionMetadata;
  traceId: string;
  parentExecutionId?: string;
}

export interface WorkflowStepTemplate {
  id: string;
  name: string;
  type: WorkflowStepType;
  metadata?: unknown;
  dependencies: string[];
  conditions?: { if: string; then: string; else?: string };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version?: string;
  userId: string;
  steps: WorkflowStepTemplate[];
  variables?: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'object';
      required: boolean;
      default?: unknown;
      description?: string;
    }
  >;
  triggers?: {
    type: 'manual' | 'webhook' | 'schedule' | 'event';
    config: unknown;
  }[];
  settings?: {
    timeout?: number;
    retryPolicy?: { maxRetries: number; factor?: number; minTimeout: number };
    parallelism?: number;
    caching?: boolean;
  };
  tags?: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowMetrics {
  executionCount: number;
  successRate: number;
  averageDuration: number;
  averageCost: number;
  averageTokens: number;
  cacheHitRate: number;
  errorRate: number;
  topErrors: { error: string; count: number; percentage: number }[];
  performanceByStep: {
    stepName: string;
    averageDuration: number;
    successRate: number;
    averageCost: number;
  }[];
  trends: {
    period: string;
    executions: number;
    avgDuration: number;
    avgCost: number;
    successRate: number;
  }[];
}
