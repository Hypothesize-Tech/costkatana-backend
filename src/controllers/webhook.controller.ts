import { Response } from 'express';
import { webhookService } from '../services/webhook.service';
import { webhookDeliveryService } from '../services/webhookDelivery.service';
import { loggingService } from '../services/logging.service';
import { WEBHOOK_EVENTS } from '../types/webhook.types';

export class WebhookController {
    /**
     * Create a new webhook
     */
    static async createWebhook(req: any, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id;

        try {
            loggingService.info('Webhook creation initiated', {
                requestId,
                userId,
                hasUserId: !!userId
            });

            if (!userId) {
                loggingService.warn('Webhook creation failed - unauthorized', {
                    requestId,
                    hasUserId: !!userId
                });

                return res.status(401).json({ error: 'Unauthorized' });
            }

            const webhookData = req.body;

            loggingService.info('Webhook creation parameters received', {
                requestId,
                userId,
                hasName: !!webhookData.name,
                hasUrl: !!webhookData.url,
                hasEvents: !!webhookData.events,
                eventsCount: webhookData.events?.length || 0,
                webhookName: webhookData.name,
                webhookUrl: webhookData.url
            });

            // Validate required fields
            if (!webhookData.name || !webhookData.url || !webhookData.events || webhookData.events.length === 0) {
                loggingService.warn('Webhook creation failed - missing required fields', {
                    requestId,
                    userId,
                    hasName: !!webhookData.name,
                    hasUrl: !!webhookData.url,
                    hasEvents: !!webhookData.events,
                    eventsCount: webhookData.events?.length || 0
                });

                return res.status(400).json({ 
                    error: 'Missing required fields: name, url, and events are required' 
                });
            }

            // Validate events
            const validEvents = Object.values(WEBHOOK_EVENTS);
            const invalidEvents = webhookData.events.filter((event: string) => !validEvents.includes(event as any));
            if (invalidEvents.length > 0) {
                loggingService.warn('Webhook creation failed - invalid events', {
                    requestId,
                    userId,
                    invalidEvents,
                    validEventsCount: validEvents.length
                });

                return res.status(400).json({ 
                    error: 'Invalid events', 
                    invalidEvents 
                });
            }

            const webhook = await webhookService.createWebhook(userId, webhookData);
            const duration = Date.now() - startTime;

            loggingService.info('Webhook created successfully', {
                requestId,
                duration,
                userId,
                webhookId: webhook._id,
                webhookName: webhook.name,
                webhookUrl: webhook.url,
                eventsCount: webhook.events.length,
                isActive: webhook.active,
                hasSecret: !!webhook.maskedSecret,
                hasRetryConfig: !!webhook.retryConfig
            });

            // Log business event
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Webhook creation failed', {
                requestId,
                userId,
                hasUserId: !!userId,
                webhookName: req.body?.name,
                webhookUrl: req.body?.url,
                eventsCount: req.body?.events?.length,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({ 
                error: 'Failed to create webhook' 
            });
        }
    }

    /**
     * Get user's webhooks
     */
    static async getWebhooks(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { active, events } = req.query;
            const filters: any = {};
            
            if (active !== undefined) {
                filters.active = active === 'true';
            }
            
            if (events) {
                filters.events = Array.isArray(events) ? events as string[] : [events as string];
            }

            const webhooks = await webhookService.getUserWebhooks(userId, filters);

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
            loggingService.error('Get webhooks failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                active: req.query.active,
                events: req.query.events,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch webhooks' 
            });
        }
    }

    /**
     * Get a single webhook
     */
    static async getWebhook(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { id } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const webhook = await webhookService.getWebhook(id, userId);
            
            if (!webhook) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

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
            loggingService.error('Get webhook failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                webhookId: req.params.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch webhook' 
            });
        }
    }

    /**
     * Update a webhook
     */
    static async updateWebhook(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { id } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

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

            loggingService.info('Webhook updated successfully', {
                requestId: req.headers['x-request-id'] as string,
                userId,
                webhookId: webhook._id,
                webhookName: webhook.name,
                hasUrl: !!webhook.url,
                eventsCount: webhook.events.length,
                isActive: webhook.active,
                hasVersion: !!webhook.version
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
            loggingService.error('Update webhook failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                webhookId: req.params.id,
                hasUpdates: !!req.body,
                updateFields: req.body ? Object.keys(req.body) : [],
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to update webhook' 
            });
        }
    }

    /**
     * Delete a webhook
     */
    static async deleteWebhook(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { id } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const deleted = await webhookService.deleteWebhook(id, userId);
            
            if (!deleted) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            loggingService.info('Webhook deleted successfully', {
                requestId: req.headers['x-request-id'] as string,
                userId,
                webhookId: id
            });

            return res.json({
                success: true,
                message: 'Webhook deleted successfully'
            });
        } catch (error: any) {
            loggingService.error('Delete webhook failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                webhookId: req.params.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to delete webhook' 
            });
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
    static async getDelivery(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { deliveryId } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const delivery = await webhookService.getDelivery(deliveryId, userId);
            
            if (!delivery) {
                return res.status(404).json({ error: 'Delivery not found' });
            }

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
            loggingService.error('Get webhook delivery failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                deliveryId: req.params.deliveryId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch delivery' 
            });
        }
    }

    /**
     * Replay a delivery
     */
    static async replayDelivery(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { deliveryId } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const newDelivery = await webhookService.replayDelivery(deliveryId, userId);

            // Queue for immediate delivery
            await webhookDeliveryService.queueDelivery(newDelivery._id!.toString());

            loggingService.info('Webhook delivery replayed successfully', {
                requestId: req.headers['x-request-id'] as string,
                userId,
                originalDeliveryId: deliveryId,
                newDeliveryId: newDelivery._id
            });

            return res.json({
                success: true,
                message: 'Delivery replayed successfully',
                deliveryId: newDelivery._id
            });
        } catch (error: any) {
            loggingService.error('Replay webhook delivery failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                deliveryId: req.params.deliveryId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to replay delivery' 
            });
        }
    }

    /**
     * Get webhook statistics
     */
    static async getWebhookStats(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            const { id } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const stats = await webhookService.getWebhookStats(id, userId);

            return res.json({
                success: true,
                stats
            });
        } catch (error: any) {
            loggingService.error('Get webhook stats failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user?.id,
                hasUserId: !!req.user?.id,
                webhookId: req.params.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch webhook statistics' 
            });
        }
    }

    /**
     * Get available webhook events
     */
    static async getAvailableEvents(req: any, res: Response): Promise<Response> {
        try {
            const events = Object.entries(WEBHOOK_EVENTS).map(([key, value]) => ({
                key,
                value,
                category: value.split('.')[0],
                name: value.split('.').slice(1).join('.').replace(/_/g, ' ')
            }));

            const categories = [...new Set(events.map(e => e.category))];

            return res.json({
                success: true,
                events,
                categories,
                total: events.length
            });
        } catch (error: any) {
            loggingService.error('Get available webhook events failed', {
                requestId: req.headers['x-request-id'] as string,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch available events' 
            });
        }
    }

    /**
     * Get queue statistics
     */
    static async getQueueStats(req: any, res: Response): Promise<Response> {
        try {
            const stats = await webhookDeliveryService.getQueueStats();

            return res.json({
                success: true,
                queue: stats
            });
        } catch (error: any) {
            loggingService.error('Get webhook queue stats failed', {
                requestId: req.headers['x-request-id'] as string,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return res.status(500).json({ 
                error: 'Failed to fetch queue statistics' 
            });
        }
    }
}
