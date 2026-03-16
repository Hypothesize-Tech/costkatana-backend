export enum WEBHOOK_EVENTS {
  // Cost & Budget (6 events)
  COST_ALERT = 'cost.alert',
  COST_THRESHOLD_EXCEEDED = 'cost.threshold_exceeded',
  BUDGET_WARNING = 'budget.warning',
  BUDGET_EXCEEDED = 'budget.exceeded',
  COST_SPIKE_DETECTED = 'cost.spike_detected',
  COST_ANOMALY_DETECTED = 'cost.anomaly_detected',

  // Optimization (5 events)
  OPTIMIZATION_COMPLETED = 'optimization.completed',
  OPTIMIZATION_FAILED = 'optimization.failed',
  OPTIMIZATION_SUGGESTED = 'optimization.suggested',
  OPTIMIZATION_APPLIED = 'optimization.applied',
  SAVINGS_MILESTONE = 'savings.milestone',

  // Model & Performance (5 events)
  MODEL_PERFORMANCE_DEGRADED = 'model.performance_degraded',
  MODEL_ERROR_RATE_HIGH = 'model.error_rate_high',
  MODEL_LATENCY_HIGH = 'model.latency_high',
  MODEL_QUOTA_WARNING = 'model.quota_warning',
  MODEL_QUOTA_EXCEEDED = 'model.quota_exceeded',

  // Usage (5 events)
  USAGE_SPIKE = 'usage.spike',
  USAGE_PATTERN_CHANGED = 'usage.pattern_changed',
  TOKEN_LIMIT_WARNING = 'token.limit_warning',
  TOKEN_LIMIT_EXCEEDED = 'token.limit_exceeded',
  API_RATE_LIMIT_WARNING = 'api.rate_limit_warning',

  // Experiment & Training (6 events)
  EXPERIMENT_STARTED = 'experiment.started',
  EXPERIMENT_COMPLETED = 'experiment.completed',
  EXPERIMENT_FAILED = 'experiment.failed',
  TRAINING_STARTED = 'training.started',
  TRAINING_COMPLETED = 'training.completed',
  TRAINING_FAILED = 'training.failed',

  // Workflow (4 events)
  WORKFLOW_STARTED = 'workflow.started',
  WORKFLOW_COMPLETED = 'workflow.completed',
  WORKFLOW_FAILED = 'workflow.failed',
  WORKFLOW_STEP_COMPLETED = 'workflow.step_completed',

  // Security & Compliance (4 events)
  SECURITY_ALERT = 'security.alert',
  COMPLIANCE_VIOLATION = 'compliance.violation',
  DATA_PRIVACY_ALERT = 'data.privacy_alert',
  MODERATION_BLOCKED = 'moderation.blocked',

  // System (3 events)
  SYSTEM_ERROR = 'system.error',
  SERVICE_DEGRADATION = 'service.degradation',
  MAINTENANCE_SCHEDULED = 'maintenance.scheduled',

  // Agent (3 events)
  AGENT_TASK_COMPLETED = 'agent.task_completed',
  AGENT_TASK_FAILED = 'agent.task_failed',
  AGENT_INSIGHT_GENERATED = 'agent.insight_generated',

  // Quality (3 events)
  QUALITY_DEGRADED = 'quality.degraded',
  QUALITY_IMPROVED = 'quality.improved',
  QUALITY_THRESHOLD_VIOLATED = 'quality.threshold_violated',

  // Subscription (13 events)
  SUBSCRIPTION_CREATED = 'subscription.created',
  SUBSCRIPTION_UPGRADED = 'subscription.upgraded',
  SUBSCRIPTION_DOWNGRADED = 'subscription.downgraded',
  SUBSCRIPTION_CANCELED = 'subscription.canceled',
  SUBSCRIPTION_REACTIVATED = 'subscription.reactivated',
  SUBSCRIPTION_TRIAL_STARTED = 'subscription.trial_started',
  SUBSCRIPTION_TRIAL_ENDING = 'subscription.trial_ending',
  SUBSCRIPTION_TRIAL_EXPIRED = 'subscription.trial_expired',
  SUBSCRIPTION_PAYMENT_FAILED = 'subscription.payment_failed',
  SUBSCRIPTION_PAYMENT_SUCCEEDED = 'subscription.payment_succeeded',
  SUBSCRIPTION_INVOICE_CREATED = 'subscription.invoice_created',
  SUBSCRIPTION_USAGE_ALERT = 'subscription.usage_alert',
  SUBSCRIPTION_LIMIT_EXCEEDED = 'subscription.limit_exceeded',
}

export type WebhookEventType = WEBHOOK_EVENTS;

export interface WebhookEventData {
  eventId: string;
  eventType: WebhookEventType;
  occurredAt: Date;
  userId: string;
  projectId?: string;
  data: {
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    tags?: string[];
    resource?: {
      type: string;
      id: string;
      name: string;
      metadata?: Record<string, any>;
    };
    metrics?: {
      current?: number;
      previous?: number;
      threshold?: number;
      change?: number;
      changePercentage?: number;
      unit?: string;
    };
    cost?: {
      amount: number;
      currency: string;
      period?: string;
      breakdown?: Record<string, any>;
    };
    links?: {
      dashboard?: string;
      details?: string;
      actions?: string[];
    };
    context?: Record<string, any>;
  };
  metadata?: Record<string, any>;
}

export interface WebhookEventFilters {
  severity?: string[];
  tags?: string[];
  projects?: string[];
  models?: string[];
  minCost?: number;
  customQuery?: Record<string, any>;
}

export interface WebhookStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  averageResponseTime?: number;
}

export interface RetryConfig {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelay: number;
}

export interface WebhookAuth {
  type: 'none' | 'basic' | 'bearer' | 'custom_header' | 'oauth2';
  credentials?: {
    username?: string;
    password?: string;
    token?: string;
    headerName?: string;
    headerValue?: string;
    oauth2?: {
      clientId?: string;
      clientSecret?: string;
      tokenUrl?: string;
      scope?: string;
    };
  };
}
