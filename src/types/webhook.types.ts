export const WEBHOOK_EVENTS = {
    // Cost & Budget Events
    COST_ALERT: 'cost.alert',
    COST_THRESHOLD_EXCEEDED: 'cost.threshold_exceeded',
    BUDGET_WARNING: 'budget.warning',
    BUDGET_EXCEEDED: 'budget.exceeded',
    COST_SPIKE_DETECTED: 'cost.spike_detected',
    COST_ANOMALY_DETECTED: 'cost.anomaly_detected',
    
    // Optimization Events
    OPTIMIZATION_COMPLETED: 'optimization.completed',
    OPTIMIZATION_FAILED: 'optimization.failed',
    OPTIMIZATION_SUGGESTED: 'optimization.suggested',
    OPTIMIZATION_APPLIED: 'optimization.applied',
    SAVINGS_MILESTONE: 'savings.milestone_reached',
    
    // Model & Performance Events
    MODEL_PERFORMANCE_DEGRADED: 'model.performance_degraded',
    MODEL_ERROR_RATE_HIGH: 'model.error_rate_high',
    MODEL_LATENCY_HIGH: 'model.latency_high',
    MODEL_QUOTA_WARNING: 'model.quota_warning',
    MODEL_QUOTA_EXCEEDED: 'model.quota_exceeded',
    
    // Usage Events
    USAGE_SPIKE: 'usage.spike_detected',
    USAGE_PATTERN_CHANGED: 'usage.pattern_changed',
    TOKEN_LIMIT_WARNING: 'token.limit_warning',
    TOKEN_LIMIT_EXCEEDED: 'token.limit_exceeded',
    API_RATE_LIMIT_WARNING: 'api.rate_limit_warning',
    
    // Experiment & Training Events
    EXPERIMENT_STARTED: 'experiment.started',
    EXPERIMENT_COMPLETED: 'experiment.completed',
    EXPERIMENT_FAILED: 'experiment.failed',
    TRAINING_STARTED: 'training.started',
    TRAINING_COMPLETED: 'training.completed',
    TRAINING_FAILED: 'training.failed',
    
    // Workflow Events
    WORKFLOW_STARTED: 'workflow.started',
    WORKFLOW_COMPLETED: 'workflow.completed',
    WORKFLOW_FAILED: 'workflow.failed',
    WORKFLOW_STEP_COMPLETED: 'workflow.step_completed',
    
    // Security & Compliance Events
    SECURITY_ALERT: 'security.alert',
    COMPLIANCE_VIOLATION: 'compliance.violation',
    DATA_PRIVACY_ALERT: 'data.privacy_alert',
    MODERATION_BLOCKED: 'moderation.blocked',
    
    // System Events
    SYSTEM_ERROR: 'system.error',
    SERVICE_DEGRADATION: 'service.degradation',
    MAINTENANCE_SCHEDULED: 'maintenance.scheduled',
    
    // Agent Events
    AGENT_TASK_COMPLETED: 'agent.task_completed',
    AGENT_TASK_FAILED: 'agent.task_failed',
    AGENT_INSIGHT_GENERATED: 'agent.insight_generated',
    
    // Quality Events
    QUALITY_DEGRADED: 'quality.degraded',
    QUALITY_IMPROVED: 'quality.improved',
    QUALITY_THRESHOLD_VIOLATED: 'quality.threshold_violated'
} as const;

export type WebhookEventType = typeof WEBHOOK_EVENTS[keyof typeof WEBHOOK_EVENTS];

export interface WebhookEventData {
    eventId: string;
    eventType: WebhookEventType;
    occurredAt: Date;
    userId: string;
    projectId?: string;
    
    // Event-specific data
    data: {
        // Common fields
        title: string;
        description: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        tags?: string[];
        
        // Resource information
        resource?: {
            type: string;
            id: string;
            name: string;
            metadata?: Record<string, any>;
        };
        
        // Metrics
        metrics?: {
            current?: number;
            previous?: number;
            threshold?: number;
            change?: number;
            changePercentage?: number;
            unit?: string;
        };
        
        // Cost information
        cost?: {
            amount: number;
            currency: string;
            period?: string;
            breakdown?: Record<string, number>;
        };
        
        // Links
        links?: {
            dashboard?: string;
            details?: string;
            actions?: string;
        };
        
        // Additional context
        context?: Record<string, any>;
    };
    
    // Metadata
    metadata?: Record<string, any>;
}

export interface WebhookPayloadTemplate {
    // Template variables that can be used
    variables: {
        event: WebhookEventData;
        user: {
            id: string;
            name: string;
            email: string;
        };
        project?: {
            id: string;
            name: string;
        };
        timestamp: string;
        costKatana: {
            version: string;
            environment: string;
        };
    };
}

export const DEFAULT_WEBHOOK_PAYLOAD = `{
    "event_id": "{{event.eventId}}",
    "event_type": "{{event.eventType}}",
    "occurred_at": "{{event.occurredAt}}",
    "severity": "{{event.data.severity}}",
    "title": "{{event.data.title}}",
    "description": "{{event.data.description}}",
    {{#if event.data.resource}}
    "resource": {
        "type": "{{event.data.resource.type}}",
        "id": "{{event.data.resource.id}}",
        "name": "{{event.data.resource.name}}"
    },
    {{/if}}
    {{#if event.data.metrics}}
    "metrics": {{json event.data.metrics}},
    {{/if}}
    {{#if event.data.cost}}
    "cost": {{json event.data.cost}},
    {{/if}}
    "user": {
        "id": "{{user.id}}",
        "name": "{{user.name}}",
        "email": "{{user.email}}"
    },
    {{#if project}}
    "project": {
        "id": "{{project.id}}",
        "name": "{{project.name}}"
    },
    {{/if}}
    "costkatana": {
        "version": "{{costKatana.version}}",
        "environment": "{{costKatana.environment}}"
    }
}`;

export interface WebhookDeliveryResult {
    success: boolean;
    statusCode?: number;
    responseTime?: number;
    error?: {
        type: string;
        message: string;
        code?: string;
    };
}

export interface WebhookTestPayload {
    webhookId: string;
    eventType?: WebhookEventType;
    customData?: any;
}
