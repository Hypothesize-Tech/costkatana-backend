import { EventEmitter } from 'events';
import { WebhookEventData, WebhookEventType, WEBHOOK_EVENTS } from '../types/webhook.types';
import { webhookService } from './webhook.service';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WebhookEventEmitter extends EventEmitter {
    private static instance: WebhookEventEmitter;
    private eventQueue: WebhookEventData[] = [];
    private processing: boolean = false;
    private batchSize: number = 10;
    private batchInterval: number = 1000; // Process batch every second

    private constructor() {
        super();
        this.setMaxListeners(100); // Increase max listeners
        this.startBatchProcessing();
    }

    static getInstance(): WebhookEventEmitter {
        if (!WebhookEventEmitter.instance) {
            WebhookEventEmitter.instance = new WebhookEventEmitter();
        }
        return WebhookEventEmitter.instance;
    }

    /**
     * Start batch processing of events
     */
    private startBatchProcessing(): void {
        setInterval(() => {
            this.processBatch();
        }, this.batchInterval);
    }

    /**
     * Process a batch of events
     */
    private async processBatch(): Promise<void> {
        if (this.processing || this.eventQueue.length === 0) {
            return;
        }

        this.processing = true;
        const batch = this.eventQueue.splice(0, this.batchSize);

        try {
            await Promise.all(
                batch.map(event => webhookService.processEvent(event))
            );
        } catch (error) {
            logger.error('Error processing webhook event batch', { error });
        } finally {
            this.processing = false;
        }
    }

    /**
     * Emit a webhook event
     */
    emitWebhookEvent(
        eventType: WebhookEventType,
        userId: string,
        data: Omit<WebhookEventData['data'], 'title' | 'description' | 'severity'> & 
              Partial<Pick<WebhookEventData['data'], 'title' | 'description' | 'severity'>>,
        options?: {
            projectId?: string;
            metadata?: Record<string, any>;
            immediate?: boolean;
        }
    ): void {
        try {
            const event: WebhookEventData = {
                eventId: uuidv4(),
                eventType,
                occurredAt: new Date(),
                userId,
                projectId: options?.projectId,
                data: {
                    title: data.title || this.generateTitle(eventType),
                    description: data.description || this.generateDescription(eventType, data),
                    severity: data.severity || this.determineSeverity(eventType, data),
                    ...data
                },
                metadata: options?.metadata
            };

            // Log the event
            logger.info('Webhook event emitted', {
                eventId: event.eventId,
                eventType: event.eventType,
                userId: event.userId,
                severity: event.data.severity
            });

            // Emit for local listeners
            this.emit(eventType, event);
            this.emit('webhook:event', event);

            // Add to queue or process immediately
            if (options?.immediate) {
                webhookService.processEvent(event).catch(error => {
                    logger.error('Error processing immediate webhook event', { error, event });
                });
            } else {
                this.eventQueue.push(event);
            }
        } catch (error) {
            logger.error('Error emitting webhook event', { error, eventType, userId });
        }
    }

    /**
     * Generate default title for event
     */
    private generateTitle(eventType: WebhookEventType): string {
        const titles: Partial<Record<WebhookEventType, string>> = {
            [WEBHOOK_EVENTS.COST_ALERT]: 'Cost Alert',
            [WEBHOOK_EVENTS.COST_THRESHOLD_EXCEEDED]: 'Cost Threshold Exceeded',
            [WEBHOOK_EVENTS.BUDGET_WARNING]: 'Budget Warning',
            [WEBHOOK_EVENTS.BUDGET_EXCEEDED]: 'Budget Exceeded',
            [WEBHOOK_EVENTS.COST_SPIKE_DETECTED]: 'Cost Spike Detected',
            [WEBHOOK_EVENTS.COST_ANOMALY_DETECTED]: 'Cost Anomaly Detected',
            [WEBHOOK_EVENTS.OPTIMIZATION_COMPLETED]: 'Optimization Completed',
            [WEBHOOK_EVENTS.OPTIMIZATION_FAILED]: 'Optimization Failed',
            [WEBHOOK_EVENTS.OPTIMIZATION_SUGGESTED]: 'New Optimization Suggestion',
            [WEBHOOK_EVENTS.OPTIMIZATION_APPLIED]: 'Optimization Applied',
            [WEBHOOK_EVENTS.SAVINGS_MILESTONE]: 'Savings Milestone Reached',
            [WEBHOOK_EVENTS.MODEL_PERFORMANCE_DEGRADED]: 'Model Performance Degraded',
            [WEBHOOK_EVENTS.MODEL_ERROR_RATE_HIGH]: 'High Model Error Rate',
            [WEBHOOK_EVENTS.MODEL_LATENCY_HIGH]: 'High Model Latency',
            [WEBHOOK_EVENTS.MODEL_QUOTA_WARNING]: 'Model Quota Warning',
            [WEBHOOK_EVENTS.MODEL_QUOTA_EXCEEDED]: 'Model Quota Exceeded',
            [WEBHOOK_EVENTS.USAGE_SPIKE]: 'Usage Spike Detected',
            [WEBHOOK_EVENTS.USAGE_PATTERN_CHANGED]: 'Usage Pattern Changed',
            [WEBHOOK_EVENTS.TOKEN_LIMIT_WARNING]: 'Token Limit Warning',
            [WEBHOOK_EVENTS.TOKEN_LIMIT_EXCEEDED]: 'Token Limit Exceeded',
            [WEBHOOK_EVENTS.API_RATE_LIMIT_WARNING]: 'API Rate Limit Warning',
            [WEBHOOK_EVENTS.EXPERIMENT_STARTED]: 'Experiment Started',
            [WEBHOOK_EVENTS.EXPERIMENT_COMPLETED]: 'Experiment Completed',
            [WEBHOOK_EVENTS.EXPERIMENT_FAILED]: 'Experiment Failed',
            [WEBHOOK_EVENTS.TRAINING_STARTED]: 'Training Started',
            [WEBHOOK_EVENTS.TRAINING_COMPLETED]: 'Training Completed',
            [WEBHOOK_EVENTS.TRAINING_FAILED]: 'Training Failed',
            [WEBHOOK_EVENTS.WORKFLOW_STARTED]: 'Workflow Started',
            [WEBHOOK_EVENTS.WORKFLOW_COMPLETED]: 'Workflow Completed',
            [WEBHOOK_EVENTS.WORKFLOW_FAILED]: 'Workflow Failed',
            [WEBHOOK_EVENTS.WORKFLOW_STEP_COMPLETED]: 'Workflow Step Completed',
            [WEBHOOK_EVENTS.SECURITY_ALERT]: 'Security Alert',
            [WEBHOOK_EVENTS.COMPLIANCE_VIOLATION]: 'Compliance Violation',
            [WEBHOOK_EVENTS.DATA_PRIVACY_ALERT]: 'Data Privacy Alert',
            [WEBHOOK_EVENTS.MODERATION_BLOCKED]: 'Content Moderation Blocked',
            [WEBHOOK_EVENTS.SYSTEM_ERROR]: 'System Error',
            [WEBHOOK_EVENTS.SERVICE_DEGRADATION]: 'Service Degradation',
            [WEBHOOK_EVENTS.MAINTENANCE_SCHEDULED]: 'Maintenance Scheduled',
            [WEBHOOK_EVENTS.AGENT_TASK_COMPLETED]: 'Agent Task Completed',
            [WEBHOOK_EVENTS.AGENT_TASK_FAILED]: 'Agent Task Failed',
            [WEBHOOK_EVENTS.AGENT_INSIGHT_GENERATED]: 'New Agent Insight',
            [WEBHOOK_EVENTS.QUALITY_DEGRADED]: 'Quality Degraded',
            [WEBHOOK_EVENTS.QUALITY_IMPROVED]: 'Quality Improved',
            [WEBHOOK_EVENTS.QUALITY_THRESHOLD_VIOLATED]: 'Quality Threshold Violated'
        };

        return titles[eventType] || eventType.replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Generate default description for event
     */
    private generateDescription(eventType: WebhookEventType, data: any): string {
        // Generate contextual descriptions based on event type and data
        switch (eventType) {
            case WEBHOOK_EVENTS.COST_THRESHOLD_EXCEEDED:
                return `Cost has exceeded the threshold of ${data.metrics?.threshold || 'N/A'}`;
            
            case WEBHOOK_EVENTS.BUDGET_EXCEEDED:
                return `Budget limit has been exceeded by ${data.metrics?.changePercentage || 0}%`;
            
            case WEBHOOK_EVENTS.MODEL_PERFORMANCE_DEGRADED:
                return `Model performance has degraded. Current: ${data.metrics?.current || 'N/A'}, Previous: ${data.metrics?.previous || 'N/A'}`;
            
            case WEBHOOK_EVENTS.USAGE_SPIKE:
                return `Usage spike detected: ${data.metrics?.changePercentage || 0}% increase`;
            
            case WEBHOOK_EVENTS.OPTIMIZATION_COMPLETED:
                return `Optimization completed successfully. Estimated savings: ${data.cost?.amount || 0} ${data.cost?.currency || 'USD'}`;
            
            default:
                return `${eventType} event occurred`;
        }
    }

    /**
     * Determine severity based on event type and data
     */
    private determineSeverity(eventType: WebhookEventType, data: any): 'low' | 'medium' | 'high' | 'critical' {
        // Critical events
        const criticalEvents = [
            WEBHOOK_EVENTS.BUDGET_EXCEEDED,
            WEBHOOK_EVENTS.SECURITY_ALERT,
            WEBHOOK_EVENTS.COMPLIANCE_VIOLATION,
            WEBHOOK_EVENTS.DATA_PRIVACY_ALERT,
            WEBHOOK_EVENTS.SYSTEM_ERROR
        ];

        if (criticalEvents.includes(eventType as any)) {
            return 'critical';
        }

        // High severity events
        const highEvents = [
            WEBHOOK_EVENTS.COST_THRESHOLD_EXCEEDED,
            WEBHOOK_EVENTS.MODEL_QUOTA_EXCEEDED,
            WEBHOOK_EVENTS.TOKEN_LIMIT_EXCEEDED,
            WEBHOOK_EVENTS.SERVICE_DEGRADATION,
            WEBHOOK_EVENTS.QUALITY_THRESHOLD_VIOLATED
        ];

        if (highEvents.includes(eventType as any)) {
            return 'high';
        }

        // Medium severity events
        const mediumEvents = [
            WEBHOOK_EVENTS.COST_SPIKE_DETECTED,
            WEBHOOK_EVENTS.BUDGET_WARNING,
            WEBHOOK_EVENTS.MODEL_PERFORMANCE_DEGRADED,
            WEBHOOK_EVENTS.MODEL_ERROR_RATE_HIGH,
            WEBHOOK_EVENTS.USAGE_SPIKE,
            WEBHOOK_EVENTS.API_RATE_LIMIT_WARNING
        ];

        if (mediumEvents.includes(eventType as any)) {
            return 'medium';
        }

        // Check metrics for dynamic severity
        if (data.metrics?.changePercentage) {
            const change = Math.abs(data.metrics.changePercentage);
            if (change > 100) return 'high';
            if (change > 50) return 'medium';
        }

        return 'low';
    }

    /**
     * Helper methods for common events
     */

    emitCostAlert(userId: string, projectId: string | undefined, cost: number, threshold: number, currency: string = 'USD'): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.COST_ALERT, userId, {
            cost: { amount: cost, currency },
            metrics: {
                current: cost,
                threshold: threshold,
                changePercentage: ((cost - threshold) / threshold) * 100,
                unit: currency
            },
            resource: projectId ? {
                type: 'project',
                id: projectId,
                name: 'Project'
            } : undefined
        }, { projectId });
    }

    emitOptimizationCompleted(
        userId: string, 
        optimizationId: string, 
        savings: number, 
        description: string,
        projectId?: string
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.OPTIMIZATION_COMPLETED, userId, {
            description,
            cost: { amount: savings, currency: 'USD' },
            resource: {
                type: 'optimization',
                id: optimizationId,
                name: 'Optimization'
            }
        }, { projectId });
    }

    emitModelPerformanceDegraded(
        userId: string,
        model: string,
        metric: string,
        current: number,
        previous: number,
        projectId?: string
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.MODEL_PERFORMANCE_DEGRADED, userId, {
            resource: {
                type: 'model',
                id: model,
                name: model
            },
            metrics: {
                current,
                previous,
                change: current - previous,
                changePercentage: ((current - previous) / previous) * 100,
                unit: metric
            }
        }, { projectId });
    }

    emitUsageSpike(
        userId: string,
        metric: string,
        current: number,
        average: number,
        projectId?: string
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.USAGE_SPIKE, userId, {
            metrics: {
                current,
                previous: average,
                changePercentage: ((current - average) / average) * 100,
                unit: metric
            }
        }, { projectId });
    }

    emitExperimentCompleted(
        userId: string,
        experimentId: string,
        experimentName: string,
        results: any,
        projectId?: string
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.EXPERIMENT_COMPLETED, userId, {
            resource: {
                type: 'experiment',
                id: experimentId,
                name: experimentName,
                metadata: results
            }
        }, { projectId });
    }

    emitWorkflowCompleted(
        userId: string,
        workflowId: string,
        workflowName: string,
        duration: number,
        projectId?: string
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.WORKFLOW_COMPLETED, userId, {
            resource: {
                type: 'workflow',
                id: workflowId,
                name: workflowName,
                metadata: { duration }
            }
        }, { projectId });
    }

    emitSecurityAlert(
        userId: string,
        alertType: string,
        description: string,
        metadata?: any
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.SECURITY_ALERT, userId, {
            description,
            severity: 'critical',
            context: {
                alertType,
                ...metadata
            }
        }, { immediate: true }); // Security alerts should be processed immediately
    }

    emitSystemError(
        userId: string,
        errorType: string,
        message: string,
        metadata?: any
    ): void {
        this.emitWebhookEvent(WEBHOOK_EVENTS.SYSTEM_ERROR, userId, {
            description: message,
            severity: 'high',
            context: {
                errorType,
                ...metadata
            }
        }, { immediate: true });
    }

    /**
     * Get queue size
     */
    getQueueSize(): number {
        return this.eventQueue.length;
    }

    /**
     * Flush the event queue
     */
    async flushQueue(): Promise<void> {
        while (this.eventQueue.length > 0) {
            await this.processBatch();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

// Export singleton instance
export const webhookEventEmitter = WebhookEventEmitter.getInstance();
