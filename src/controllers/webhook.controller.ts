import { Response } from 'express';
import { webhookService } from '../services/webhook.service';
import { webhookDeliveryService } from '../services/webhookDelivery.service';
import { loggingService } from '../services/logging.service';
import { WEBHOOK_EVENTS } from '../types/webhook.types';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class WebhookController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Request timeout configuration
    private static readonly STATS_TIMEOUT = 30000; // 30 seconds for stats
    
    // Pre-computed valid events for validation
    private static readonly VALID_EVENTS = Object.values(WEBHOOK_EVENTS);
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
    /**
     * Create a new webhook
     */
    static async createWebhook(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('createWebhook', req);

        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }

            const webhookData = req.body;

            // Validate required fields
            const validation = this.validateWebhookData(webhookData);
            if (!validation.isValid) {
                return res.status(400).json({ error: validation.error, invalidEvents: validation.invalidEvents });
            }

            const webhook = await webhookService.createWebhook(userId, webhookData);

            // Queue business event logging to background
            const duration = Date.now() - startTime;
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'webhook_created',
                    category: 'webhook_management',
                    value: duration,
                    metadata: {
                        userId,
                        webhookId: webhook._id,
                        webhookName: webhook.name,
                        eventsCount: webhook.events.length,
                        isActive: webhook.active
                    }
                });
            });

            // Reset failure count on success
            this.dbFailureCount = 0;

            ControllerHelper.logRequestSuccess('createWebhook', req, startTime, {
                webhookId: webhook._id,
                webhookName: webhook.name
            });

            return res.status(201).json({
                success: true,
                webhook: {
                    id: webhook._id,
                    name: webhook.name,
                    url: webhook.url,
                    events: webhook.events,
                    active: webhook.active,
                    secret: webhook.maskedSecret,
                    retryConfig: webhook.retryConfig || {
                        maxRetries: 3,
                        backoffMultiplier: 2,
                        initialDelay: 5000
                    },
                    createdAt: webhook.createdAt
                }
            });
        } catch (error: any) {
            WebhookController.recordDbFailure();
            ControllerHelper.handleError('createWebhook', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get user's webhooks
     */
    static async getWebhooks(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getWebhooks', req, { query: req.query });

        try {

            const { active, events } = req.query;
            const filters: any = {};
            
            if (active !== undefined) {
                filters.active = active === 'true';
            }
            
            if (events) {
                filters.events = Array.isArray(events) ? events as string[] : [events as string];
            }

            const webhooks = await webhookService.getUserWebhooks(userId, filters);

            ControllerHelper.logRequestSuccess('getWebhooks', req, startTime, {
                count: webhooks.length
            });

            return res.json({
                success: true,
                webhooks: webhooks.map(webhook => ({
                    id: webhook._id,
                    name: webhook.name,
                    description: webhook.description,
                    url: webhook.url,
                    events: webhook.events,
                    active: webhook.active,
                    version: webhook.version,
                    retryConfig: webhook.retryConfig || {
                        maxRetries: 3,
                        backoffMultiplier: 2,
                        initialDelay: 5000
                    },
                    stats: webhook.stats,
                    createdAt: webhook.createdAt,
                    updatedAt: webhook.updatedAt
                }))
            });
        } catch (error: any) {
            ControllerHelper.handleError('getWebhooks', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get a single webhook
     */
    static async getWebhook(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { id } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getWebhook', req, { webhookId: id });

        try {
            ServiceHelper.validateObjectId(id, 'webhookId');

            const webhook = await webhookService.getWebhook(id, userId);
            
            if (!webhook) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            ControllerHelper.logRequestSuccess('getWebhook', req, startTime, { webhookId: id });

            return res.json({
                success: true,
                webhook: {
                    id: webhook._id,
                    name: webhook.name,
                    description: webhook.description,
                    url: webhook.url,
                    events: webhook.events,
                    active: webhook.active,
                    version: webhook.version,
                    auth: webhook.auth ? {
                        type: webhook.auth.type,
                        hasCredentials: !!webhook.auth.credentials
                    } : undefined,
                    filters: webhook.filters,
                    headers: webhook.headers,
                    payloadTemplate: webhook.payloadTemplate,
                    useDefaultPayload: webhook.useDefaultPayload,
                    secret: webhook.maskedSecret,
                    timeout: webhook.timeout,
                    retryConfig: webhook.retryConfig || {
                        maxRetries: 3,
                        backoffMultiplier: 2,
                        initialDelay: 5000
                    },
                    stats: webhook.stats,
                    createdAt: webhook.createdAt,
                    updatedAt: webhook.updatedAt
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getWebhook', error, req, res, startTime, { webhookId: id });
            return res;
        }
    }

    /**
     * Update a webhook
     */
    static async updateWebhook(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { id } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('updateWebhook', req, { webhookId: id });

        try {
            ServiceHelper.validateObjectId(id, 'webhookId');

            const updates = req.body;

            // Validate events if provided
            if (updates.events) {
                const validEvents = Object.values(WEBHOOK_EVENTS);
                const invalidEvents = updates.events.filter((event: string) => !validEvents.includes(event as any));
                if (invalidEvents.length > 0) {
                    return res.status(400).json({ 
                        error: 'Invalid events', 
                        invalidEvents 
                    });
                }
            }

            const webhook = await webhookService.updateWebhook(id, userId, updates);
            
            if (!webhook) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            ControllerHelper.logRequestSuccess('updateWebhook', req, startTime, {
                webhookId: webhook._id,
                webhookName: webhook.name
            });

            return res.json({
                success: true,
                webhook: {
                    id: webhook._id,
                    name: webhook.name,
                    url: webhook.url,
                    events: webhook.events,
                    active: webhook.active,
                    version: webhook.version,
                    retryConfig: webhook.retryConfig || {
                        maxRetries: 3,
                        backoffMultiplier: 2,
                        initialDelay: 5000
                    },
                    updatedAt: webhook.updatedAt
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateWebhook', error, req, res, startTime, { webhookId: id });
            return res;
        }
    }

    /**
     * Delete a webhook
     */
    static async deleteWebhook(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { id } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('deleteWebhook', req, { webhookId: id });

        try {
            ServiceHelper.validateObjectId(id, 'webhookId');

            const deleted = await webhookService.deleteWebhook(id, userId);
            
            if (!deleted) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            ControllerHelper.logRequestSuccess('deleteWebhook', req, startTime, { webhookId: id });

            return res.json({
                success: true,
                message: 'Webhook deleted successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteWebhook', error, req, res, startTime, { webhookId: id });
            return res;
        }
    }

    /**
     * Test a webhook
     */
    static async testWebhook(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { id } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const testData = req.body;
            const delivery = await webhookService.testWebhook(id, userId, testData);

            // Queue for immediate delivery
            await webhookDeliveryService.queueDelivery(delivery._id!.toString());

            loggingService.info('Webhook test triggered successfully', {
                requestId: req.headers['x-request-id'] as string,
                userId,
                webhookId: id,
                deliveryId: delivery._id,
                hasTestData: !!testData,
                testDataKeys: testData ? Object.keys(testData) : []
            });

            return res.json({
                success: true,
                message: 'Test webhook queued for delivery',
                deliveryId: delivery._id
            });
        } catch (error: any) {
            loggingService.error('Test webhook failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                webhookId: req.params.id,
                hasTestData: !!req.body,
                testDataKeys: req.body ? Object.keys(req.body) : [],
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to test webhook' 
            });
        }
    }

    /**
     * Get webhook deliveries
     */
    static async getDeliveries(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { id } = req.params;
            const { status, eventType, limit = 20, offset = 0 } = req.query;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const filters: any = {};
            if (status) filters.status = status;
            if (eventType) filters.eventType = eventType;
            filters.limit = Math.min(parseInt(limit as string) || 20, 100);
            filters.offset = parseInt(offset as string) || 0;

            const { deliveries, total } = await webhookService.getWebhookDeliveries(
                id, 
                userId, 
                filters
            );

            return res.json({
                success: true,
                deliveries: deliveries.map(delivery => ({
                    id: delivery._id,
                    eventId: delivery.eventId,
                    eventType: delivery.eventType,
                    attempt: delivery.attempt,
                    status: delivery.status,
                    request: {
                        url: delivery.request.url,
                        method: delivery.request.method,
                        timestamp: delivery.request.timestamp
                    },
                    response: delivery.response,
                    error: delivery.error,
                    nextRetryAt: delivery.nextRetryAt,
                    createdAt: delivery.createdAt
                })),
                pagination: {
                    total,
                    limit: filters.limit,
                    offset: filters.offset,
                    hasMore: filters.offset + deliveries.length < total
                }
            });
        } catch (error: any) {
            loggingService.error('Get webhook deliveries failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                webhookId: req.params.id,
                status: req.query.status,
                eventType: req.query.eventType,
                limit: req.query.limit,
                offset: req.query.offset,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch deliveries' 
            });
        }
    }

    /**
     * Get a single delivery
     */
    static async getDelivery(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { deliveryId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getDelivery', req, { deliveryId });

        try {
            const delivery = await webhookService.getDelivery(deliveryId, userId);
            
            if (!delivery) {
                return res.status(404).json({ error: 'Delivery not found' });
            }

            ControllerHelper.logRequestSuccess('getDelivery', req, startTime, { deliveryId });

            return res.json({
                success: true,
                delivery: {
                    id: delivery._id,
                    webhookId: delivery.webhookId,
                    eventId: delivery.eventId,
                    eventType: delivery.eventType,
                    eventData: delivery.eventData,
                    attempt: delivery.attempt,
                    status: delivery.status,
                    request: delivery.request,
                    response: delivery.response,
                    error: delivery.error,
                    nextRetryAt: delivery.nextRetryAt,
                    retriesLeft: delivery.retriesLeft,
                    signature: delivery.signature,
                    metadata: delivery.metadata,
                    createdAt: delivery.createdAt,
                    updatedAt: delivery.updatedAt
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getDelivery', error, req, res, startTime, { deliveryId });
            return res;
        }
    }

    /**
     * Replay a delivery
     */
    static async replayDelivery(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { deliveryId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('replayDelivery', req, { deliveryId });

        try {
            ServiceHelper.validateObjectId(deliveryId, 'deliveryId');

            const newDelivery = await webhookService.replayDelivery(deliveryId, userId);

            // Queue for immediate delivery
            await webhookDeliveryService.queueDelivery(newDelivery._id!.toString());

            ControllerHelper.logRequestSuccess('replayDelivery', req, startTime, {
                originalDeliveryId: deliveryId,
                newDeliveryId: newDelivery._id
            });

            return res.json({
                success: true,
                message: 'Delivery replayed successfully',
                deliveryId: newDelivery._id
            });
        } catch (error: any) {
            ControllerHelper.handleError('replayDelivery', error, req, res, startTime, { deliveryId });
            return res;
        }
    }

    /**
     * Get webhook statistics
     */
    static async getWebhookStats(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { id } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getWebhookStats', req, { webhookId: id });

        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                return res.status(503).json({ error: 'Service temporarily unavailable' });
            }

            ServiceHelper.validateObjectId(id, 'webhookId');

            // Add timeout handling
            const statsPromise = webhookService.getWebhookStats(id, userId);
            const stats = await Promise.race([
                statsPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Stats operation timeout')), this.STATS_TIMEOUT)
                )
            ]);

            // Reset failure count on success
            this.dbFailureCount = 0;

            ControllerHelper.logRequestSuccess('getWebhookStats', req, startTime, { webhookId: id });

            return res.json({
                success: true,
                stats
            });
        } catch (error: any) {
            WebhookController.recordDbFailure();
            ControllerHelper.handleError('getWebhookStats', error, req, res, startTime, { webhookId: id });
            return res;
        }
    }

    /**
     * Get available webhook events
     */
    static async getAvailableEvents(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        
        ControllerHelper.logRequestStart('getAvailableEvents', req);

        try {
            const events = Object.entries(WEBHOOK_EVENTS).map(([key, value]) => ({
                key,
                value,
                category: value.split('.')[0],
                name: value.split('.').slice(1).join('.').replace(/_/g, ' ')
            }));

            const categories = [...new Set(events.map(e => e.category))];

            ControllerHelper.logRequestSuccess('getAvailableEvents', req, startTime, {
                total: events.length
            });

            return res.json({
                success: true,
                events,
                categories,
                total: events.length
            });
        } catch (error: any) {
            ControllerHelper.handleError('getAvailableEvents', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get queue statistics
     */
    static async getQueueStats(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        
        ControllerHelper.logRequestStart('getQueueStats', req);

        try {
            const stats = await webhookDeliveryService.getQueueStats();

            ControllerHelper.logRequestSuccess('getQueueStats', req, startTime);

            return res.json({
                success: true,
                queue: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getQueueStats', error, req, res, startTime);
            return res;
        }
    }


    /**
     * Webhook data validation utility
     */
    private static validateWebhookData(webhookData: any): { isValid: boolean; error?: string; invalidEvents?: string[] } {
        // Validate required fields
        if (!webhookData.name || !webhookData.url || !webhookData.events || webhookData.events.length === 0) {
            return {
                isValid: false,
                error: 'Missing required fields: name, url, and events are required'
            };
        }

        // Validate events
        const invalidEvents = webhookData.events.filter((event: string) => !this.VALID_EVENTS.includes(event as any));
        if (invalidEvents.length > 0) {
            return {
                isValid: false,
                error: 'Invalid events',
                invalidEvents
            };
        }

        return { isValid: true };
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.DB_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Background processing queue utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operations = this.backgroundQueue.splice(0, 10); // Process up to 10 operations at once
                
                await Promise.allSettled(
                    operations.map(async (operation) => {
                        try {
                            await operation();
                        } catch (error) {
                            loggingService.error('Background operation failed', { 
                                error: error instanceof Error ? error.message : String(error) 
                            });
                        }
                    })
                );
            }
        }, 1000); // Process every second
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Clear background processor
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Clear background queue
        this.backgroundQueue.length = 0;
        
        // Reset circuit breaker state
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
    }
}
