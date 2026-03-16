import { Schema as MongooseSchema } from 'mongoose';

export enum AgentMode {
  SCOPE = 'SCOPE',
  CLARIFY = 'CLARIFY',
  PLAN = 'PLAN',
  BUILD = 'BUILD',
  VERIFY = 'VERIFY',
  DONE = 'DONE',
}

export interface ResearchResult {
  query: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    relevance: number;
  }>;
  synthesis: string;
  keyFindings: string[];
  /** ISO timestamp when the research was performed */
  searchTimestamp?: string;
}

export interface PlanStep {
  id: string;
  tool: string;
  action: string;
  params: Record<string, any>;
  description: string;
  estimatedDuration: number; // seconds
  dependencies?: string[]; // IDs of steps that must complete first
}

export interface PlanPhase {
  name: string;
  approvalRequired: boolean;
  steps: PlanStep[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
}

export interface ExecutionPlan {
  phases: PlanPhase[];
  researchSources?: ResearchResult[];
  estimatedDuration: number; // total seconds
  estimatedCost?: number; // dollars
  riskAssessment: {
    level: 'none' | 'low' | 'medium' | 'high';
    reasons: string[];
    requiresApproval: boolean;
  };
  rollbackPlan?: string;
}

export interface ScopeAnalysis {
  compatible: boolean;
  ambiguities: string[];
  requiredIntegrations: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  canProceed: boolean;
  clarificationNeeded?: string[];
}

export interface ExecutionProgress {
  currentPhase: number;
  currentStep?: string; // Changed to string to track step ID (or undefined when no step is executing)
  totalPhases: number;
  totalSteps: number;
  completedSteps: string[];
  failedSteps: Array<{
    stepId: string;
    error: string;
    timestamp: Date;
  }>;
  startTime: Date;
  estimatedCompletionTime?: Date;
}

export interface VerificationResult {
  success: boolean;
  deploymentUrls?: string[];
  healthChecks?: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: any;
  }>;
  dataIntegrity?: {
    recordsProcessed: number;
    recordsSuccessful: number;
    recordsFailed: number;
  };
  rollbackInstructions?: string;
  recommendations?: string[];
  /** When the verification was performed */
  timestamp?: Date;
}

export interface GovernedTask {
  id: string;
  userId: MongooseSchema.Types.ObjectId;
  sessionId?: string;
  chatId?: MongooseSchema.Types.ObjectId;
  parentMessageId?: MongooseSchema.Types.ObjectId;
  mode: AgentMode;
  userRequest: string;

  // Task Classification
  classification?: {
    type: string;
    complexity: string;
    riskLevel: string;
    integrations: string[];
    route: string;
    reasoning: string;
  };

  // SCOPE_MODE outputs
  scopeAnalysis?: ScopeAnalysis;

  // Clarifying answers (from CLARIFY mode)
  clarifyingAnswers?: Record<string, string>;

  // PLAN_MODE outputs
  plan?: ExecutionPlan;

  // Approval tracking
  approvalToken?: string;
  approvedAt?: Date;
  approvedBy?: MongooseSchema.Types.ObjectId;

  // BUILD_MODE tracking
  executionProgress?: ExecutionProgress;
  executionResults?: any[];

  // VERIFY_MODE outputs
  verification?: VerificationResult;

  // Metadata
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  errorStack?: string;

  createdAt?: Date;
  updatedAt?: Date;
  completedAt?: Date;
}

export interface TaskClassification {
  type:
    | 'simple_query'
    | 'complex_query'
    | 'cross_integration'
    | 'coding'
    | 'research'
    | 'data_transformation';
  complexity: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  integrations: string[];
  route: 'DIRECT_EXECUTION' | 'GOVERNED_WORKFLOW';
  reasoning: string;
}

export interface ProgressUpdate {
  step: number;
  total: number;
  status: 'running' | 'completed' | 'failed';
  action?: string;
  error?: string;
  result?: any;
  timestamp: Date;
}

export interface ChainResult {
  success: boolean;
  results: Array<{
    step: string;
    result: any;
    success: boolean;
    duration: number;
  }>;
  totalDuration: number;
  error?: string;
}

export interface IntegrationStep extends PlanStep {
  integration: string; // github, google, mongodb, jira, vercel, aws
}

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  details: any;
  timestamp: Date;
}

export interface DeploymentVerification {
  url: string;
  accessible: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
}

export interface DataIntegrityCheck {
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  failureRate: number;
  sampleErrors?: string[];
}
