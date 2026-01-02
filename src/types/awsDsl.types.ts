/**
 * AWS DSL Types - Deterministic Action Domain Specific Language
 * 
 * This DSL provides a structured, auditable way to define AWS actions.
 * It constrains what the LLM can request, ensuring predictable behavior.
 * 
 * Security Guarantees:
 * - DSL versions are immutable once released
 * - Executed plans store dslVersion and dslHash
 * - Replay/audit uses original DSL semantics
 * - No retroactive behavior changes
 */

// ============================================================================
// Core DSL Types
// ============================================================================

export type DSLVersion = '1.0' | '1.1' | '2.0';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type CostImpact = 'negative' | 'neutral' | 'positive' | 'unknown';

export type ActionCategory = 
  | 'read'
  | 'start_stop'
  | 'resize'
  | 'configure'
  | 'create'
  | 'delete'
  | 'backup'
  | 'restore';

// ============================================================================
// Action Definition
// ============================================================================

export interface ActionDefinition {
  // Identity
  action: string;  // e.g., 'ec2.stop', 's3.lifecycle'
  version: DSLVersion;
  
  // Metadata
  metadata: ActionMetadata;
  
  // Resource Selection
  selector: ResourceSelector;
  
  // Constraints
  constraints: ActionConstraints;
  
  // Execution
  execution: ExecutionConfig;
  
  // Audit
  audit: AuditConfig;
}

export interface ActionMetadata {
  name: string;
  description: string;
  category: ActionCategory;
  risk: RiskLevel;
  reversible: boolean;
  costImpact: CostImpact;
  estimatedDuration?: number;  // seconds
  documentation?: string;
  tags?: string[];
}

// ============================================================================
// Resource Selection
// ============================================================================

export interface ResourceSelector {
  service: AWSService;
  resourceType: string;
  filters: ResourceFilter[];
  regions?: string[];
  accounts?: string[];
}

export type AWSService = 
  | 'ec2'
  | 's3'
  | 'rds'
  | 'lambda'
  | 'dynamodb'
  | 'cloudwatch'
  | 'elasticache'
  | 'ecs'
  | 'eks';

export interface ResourceFilter {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | string[];
}

export type FilterOperator = 
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists';

// ============================================================================
// Constraints
// ============================================================================

export interface ActionConstraints {
  // Resource limits
  maxResources: number;
  
  // Regional limits
  regions: string[];
  
  // Time constraints
  timeWindow?: TimeWindow;
  
  // Approval requirements
  requireApproval: boolean;
  approvalLevel?: 'user' | 'admin' | 'dual';
  
  // Cost constraints
  maxCostImpact?: number;  // USD
  
  // Simulation requirements
  simulationRequired?: boolean;
  simulationPeriodDays?: number;
  
  // Dependencies
  dependsOn?: string[];  // Other actions that must complete first
  
  // Exclusions
  excludeResources?: string[];  // Resource IDs to exclude
  excludeTags?: Record<string, string>;  // Tags that exclude resources
}

export interface TimeWindow {
  type: 'business_hours' | 'maintenance_window' | 'custom';
  timezone?: string;
  startHour?: number;
  endHour?: number;
  daysOfWeek?: number[];  // 0-6, Sunday-Saturday
}

// ============================================================================
// Execution Configuration
// ============================================================================

export interface ExecutionConfig {
  // Pre-execution checks
  preChecks: PreCheck[];
  
  // The actual action
  action: AWSAPIAction;
  
  // Post-execution checks
  postChecks: PostCheck[];
  
  // Rollback configuration
  rollback?: RollbackConfig;
  
  // Retry configuration
  retry?: RetryConfig;
}

export interface PreCheck {
  type: PreCheckType;
  config?: Record<string, any>;
  failAction: 'abort' | 'warn' | 'skip';
}

export type PreCheckType = 
  | 'verify_backups'
  | 'check_dependencies'
  | 'verify_permissions'
  | 'check_cost_impact'
  | 'verify_idle'
  | 'check_tags'
  | 'custom';

export interface PostCheck {
  type: PostCheckType;
  config?: Record<string, any>;
  timeout?: number;  // seconds
}

export type PostCheckType = 
  | 'verify_state'
  | 'verify_stopped'
  | 'verify_started'
  | 'verify_resized'
  | 'update_inventory'
  | 'notify'
  | 'custom';

export interface AWSAPIAction {
  operation: string;  // AWS API operation name
  parameters: Record<string, any>;
  timeout?: number;  // seconds
}

export interface RollbackConfig {
  enabled: boolean;
  operation?: string;
  parameters?: Record<string, any>;
  autoRollbackOnError: boolean;
  rollbackTimeout?: number;  // seconds
}

export interface RetryConfig {
  maxAttempts: number;
  backoffType: 'linear' | 'exponential';
  initialDelayMs: number;
  maxDelayMs: number;
}

// ============================================================================
// Audit Configuration
// ============================================================================

export interface AuditConfig {
  logLevel: 'minimal' | 'standard' | 'detailed' | 'forensic';
  notify: NotificationTarget[];
  complianceTags: string[];
  retentionDays?: number;
}

export type NotificationTarget = 
  | 'owner'
  | 'admin'
  | 'security_team'
  | 'ops_team'
  | 'slack'
  | 'email'
  | 'webhook';

// ============================================================================
// Parsed Action (Output of DSL Parser)
// ============================================================================

export interface ParsedAction {
  // The validated DSL
  dsl: ActionDefinition;
  
  // Cryptographic proof
  hash: string;  // SHA-256 of DSL
  signature?: string;  // For non-repudiation
  
  // Version tracking
  dslVersion: DSLVersion;
  parsedAt: Date;
  
  // Validation results
  validation: ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

// ============================================================================
// Execution Plan (Generated from DSL)
// ============================================================================

export interface ExecutionPlan {
  planId: string;
  dslHash: string;
  dslVersion: DSLVersion;
  
  // Steps to execute
  steps: ExecutionStep[];
  
  // Summary
  summary: PlanSummary;
  
  // Visualization
  visualization?: string;  // Mermaid diagram
  
  // Rollback plan
  rollbackPlan?: ExecutionPlan;
  
  // Timestamps
  createdAt: Date;
  expiresAt: Date;
  
  // Approval status
  approval?: PlanApproval;
}

export interface ExecutionStep {
  stepId: string;
  order: number;
  
  // Action details
  service: string;
  action: string;
  description: string;
  
  // Resources
  resources: string[];
  
  // Impact assessment
  impact: StepImpact;
  
  // API calls
  apiCalls: APICall[];
  
  // Dependencies
  dependsOn?: string[];  // Step IDs
  
  // Status (for execution tracking)
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'rolled_back';
  result?: StepResult;
}

export interface StepImpact {
  resourceCount: number;
  costChange: number;  // USD (negative = savings)
  reversible: boolean;
  downtime: boolean;
  dataLoss: boolean;
  riskLevel: RiskLevel;
}

export interface APICall {
  service: string;
  operation: string;
  parameters: Record<string, any>;
  expectedDuration?: number;
}

export interface StepResult {
  success: boolean;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  awsRequestIds: string[];
  error?: string;
  output?: Record<string, any>;
}

export interface PlanSummary {
  totalSteps: number;
  estimatedDuration: number;  // seconds
  estimatedCostImpact: number;  // USD
  riskScore: number;  // 0-100
  resourcesAffected: number;
  servicesAffected: string[];
  requiresApproval: boolean;
  reversible: boolean;
}

export interface PlanApproval {
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  approvedAt?: Date;
  expiresAt: Date;
  notes?: string;
}

// ============================================================================
// Intent (Input from Natural Language)
// ============================================================================

export interface ParsedIntent {
  originalRequest: string;
  interpretedAction: string;
  confidence: number;  // 0-1
  
  // Extracted entities
  entities: IntentEntities;
  
  // Risk assessment
  riskLevel: RiskLevel;
  
  // Suggested DSL action
  suggestedAction?: string;
  
  // Warnings
  warnings: string[];
  
  // Blocked (if action is not allowed)
  blocked: boolean;
  blockReason?: string;
}

export interface IntentEntities {
  service?: string;
  action?: string;
  resources?: string[];
  parameters?: Record<string, any>;
  regions?: string[];
  filters?: Record<string, any>;
}

// ============================================================================
// Allowed Actions Registry
// ============================================================================

export interface AllowedAction {
  action: string;
  name: string;
  description: string;
  category: ActionCategory;
  risk: RiskLevel;
  requiresApproval: boolean;
  template: Partial<ActionDefinition>;
}

export const ALLOWED_ACTIONS: AllowedAction[] = [
  // EC2 Actions
  {
    action: 'ec2.stop',
    name: 'Stop EC2 Instances',
    description: 'Stop running EC2 instances',
    category: 'start_stop',
    risk: 'medium',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Stop EC2 Instances',
        description: 'Stop running EC2 instances to save costs',
        category: 'start_stop',
        risk: 'medium',
        reversible: true,
        costImpact: 'negative',
      },
    },
  },
  {
    action: 'ec2.start',
    name: 'Start EC2 Instances',
    description: 'Start stopped EC2 instances',
    category: 'start_stop',
    risk: 'medium',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Start EC2 Instances',
        description: 'Start stopped EC2 instances',
        category: 'start_stop',
        risk: 'medium',
        reversible: true,
        costImpact: 'positive',
      },
    },
  },
  {
    action: 'ec2.resize',
    name: 'Resize EC2 Instance',
    description: 'Change EC2 instance type',
    category: 'resize',
    risk: 'high',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Resize EC2 Instance',
        description: 'Change the instance type of an EC2 instance',
        category: 'resize',
        risk: 'high',
        reversible: true,
        costImpact: 'unknown',
      },
    },
  },
  
  // S3 Actions
  {
    action: 's3.lifecycle',
    name: 'Configure S3 Lifecycle',
    description: 'Set up S3 lifecycle rules for cost optimization',
    category: 'configure',
    risk: 'medium',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Configure S3 Lifecycle',
        description: 'Configure lifecycle rules for S3 bucket',
        category: 'configure',
        risk: 'medium',
        reversible: true,
        costImpact: 'negative',
      },
    },
  },
  {
    action: 's3.intelligent_tiering',
    name: 'Enable S3 Intelligent Tiering',
    description: 'Enable intelligent tiering for automatic cost optimization',
    category: 'configure',
    risk: 'low',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Enable S3 Intelligent Tiering',
        description: 'Enable intelligent tiering for automatic cost optimization',
        category: 'configure',
        risk: 'low',
        reversible: true,
        costImpact: 'negative',
      },
    },
  },
  
  // RDS Actions
  {
    action: 'rds.stop',
    name: 'Stop RDS Instance',
    description: 'Stop an RDS database instance',
    category: 'start_stop',
    risk: 'high',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Stop RDS Instance',
        description: 'Stop an RDS database instance to save costs',
        category: 'start_stop',
        risk: 'high',
        reversible: true,
        costImpact: 'negative',
      },
    },
  },
  {
    action: 'rds.start',
    name: 'Start RDS Instance',
    description: 'Start a stopped RDS database instance',
    category: 'start_stop',
    risk: 'medium',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Start RDS Instance',
        description: 'Start a stopped RDS database instance',
        category: 'start_stop',
        risk: 'medium',
        reversible: true,
        costImpact: 'positive',
      },
    },
  },
  {
    action: 'rds.snapshot',
    name: 'Create RDS Snapshot',
    description: 'Create a manual snapshot of an RDS instance',
    category: 'backup',
    risk: 'low',
    requiresApproval: false,
    template: {
      metadata: {
        name: 'Create RDS Snapshot',
        description: 'Create a manual snapshot of an RDS instance',
        category: 'backup',
        risk: 'low',
        reversible: false,
        costImpact: 'positive',
      },
    },
  },
  {
    action: 'rds.resize',
    name: 'Resize RDS Instance',
    description: 'Change RDS instance class',
    category: 'resize',
    risk: 'high',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Resize RDS Instance',
        description: 'Change the instance class of an RDS instance',
        category: 'resize',
        risk: 'high',
        reversible: true,
        costImpact: 'unknown',
      },
    },
  },
  
  // Lambda Actions
  {
    action: 'lambda.update_memory',
    name: 'Update Lambda Memory',
    description: 'Change Lambda function memory allocation',
    category: 'configure',
    risk: 'medium',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Update Lambda Memory',
        description: 'Change Lambda function memory allocation',
        category: 'configure',
        risk: 'medium',
        reversible: true,
        costImpact: 'unknown',
      },
    },
  },
  {
    action: 'lambda.update_timeout',
    name: 'Update Lambda Timeout',
    description: 'Change Lambda function timeout',
    category: 'configure',
    risk: 'low',
    requiresApproval: true,
    template: {
      metadata: {
        name: 'Update Lambda Timeout',
        description: 'Change Lambda function timeout',
        category: 'configure',
        risk: 'low',
        reversible: true,
        costImpact: 'neutral',
      },
    },
  },
];

// ============================================================================
// DSL Schema Version History (for immutability tracking)
// ============================================================================

export interface DSLVersionInfo {
  version: DSLVersion;
  releasedAt: Date;
  deprecated: boolean;
  deprecatedAt?: Date;
  changes: string[];
  schemaHash: string;
}

export const DSL_VERSION_HISTORY: DSLVersionInfo[] = [
  {
    version: '1.0',
    releasedAt: new Date('2025-01-01'),
    deprecated: false,
    changes: ['Initial release'],
    schemaHash: 'sha256:initial',
  },
];
