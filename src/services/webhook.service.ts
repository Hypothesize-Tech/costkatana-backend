import { IWebhook, Webhook } from '../models/Webhook';
import { IWebhookDelivery, WebhookDelivery } from '../models/WebhookDelivery';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { loggingService } from './logging.service';
import { encryptData, decryptData } from '../utils/encryption';
import { 
    WebhookEventData, 
    WEBHOOK_EVENTS,
    WebhookTestPayload,
    DEFAULT_WEBHOOK_PAYLOAD
} from '../types/webhook.types';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Handlebars from 'handlebars';
import mongoose from 'mongoose';
import { BaseService } from '../shared/BaseService';

export class WebhookService extends BaseService {
    private static instance: WebhookService;
    
    // Template compilation cache
    private static templateCache = new Map<string, HandlebarsTemplateDelegate>();
    
    // Encryption result cache
    private static encryptionCache = new Map<string, string>();
    
    // Signature cache
    private static signatureCache = new Map<string, string>();
    
    // Circuit breaker for database operations
    private static dbFailureCount = 0;
    private static lastDbFailureTime = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 5 * 60 * 1000; // 5 minutes
    
    /**
     * Check if DB circuit breaker is open
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
    
    /**
     * Record DB failure for circuit breaker
     */
    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    private constructor() {
        super('WebhookService', {
            max: 1000,
            ttl: 300000 // 5 minutes
        });
        this.registerHandlebarsHelpers();
    }

    static getInstance(): WebhookService {
        if (!WebhookService.instance) {
            WebhookService.instance = new WebhookService();
        }
        return WebhookService.instance;
    }

    private registerHandlebarsHelpers() {
        // Helper to serialize JSON
        Handlebars.registerHelper('json', function(context: any) {
            return JSON.stringify(context);
        });

        // Helper for conditional rendering
        Handlebars.registerHelper('if', function(this: any, conditional: any, options: any) {
            if (conditional) {
                return options.fn(this);
            } else {
                return options.inverse(this);
            }
        });
    }

    /**
     * Create a new webhook
     */
    async createWebhook(userId: string, data: Partial<IWebhook>): Promise<IWebhook> {
        try {
            // Encrypt sensitive data
            if (data.auth?.credentials) {
                const credentials = data.auth.credentials;
                if (credentials.password) {
                    credentials.password = encryptData(credentials.password);
                }
                if (credentials.token) {
                    credentials.token = encryptData(credentials.token);
                }
                if (credentials.headerValue) {
                    credentials.headerValue = encryptData(credentials.headerValue);
                }
                if (credentials.oauth2?.clientSecret) {
                    credentials.oauth2.clientSecret = encryptData(credentials.oauth2.clientSecret);
                }
            }

            // Ensure retryConfig is set with default values if not provided
            const defaultRetryConfig = {
                maxRetries: 3,
                backoffMultiplier: 2,
                initialDelay: 5000
            };
            
            const webhook = new Webhook({
                ...data,
                userId,
                retryConfig: data.retryConfig || defaultRetryConfig,
                stats: {
                    totalDeliveries: 0,
                    successfulDeliveries: 0,
                    failedDeliveries: 0
                }
            });

            await webhook.save();
            loggingService.info('Webhook created', { value:  {  webhookId: webhook._id, userId  } });

            return webhook;
        } catch (error) {
            loggingService.error('Error creating webhook', { error, userId });
            throw error;
        }
    }

    /**
     * Update an existing webhook
     */
    async updateWebhook(webhookId: string, userId: string, updates: Partial<IWebhook>): Promise<IWebhook | null> {
        try {
            const webhook = await Webhook.findOne({ _id: webhookId, userId: new mongoose.Types.ObjectId(userId) });
            if (!webhook) {
                return null;
            }

            // Encrypt sensitive data if updated
            if (updates.auth?.credentials) {
                const credentials = updates.auth.credentials;
                if (credentials.password) {
                    credentials.password = encryptData(credentials.password);
                }
                if (credentials.token) {
                    credentials.token = encryptData(credentials.token);
                }
                if (credentials.headerValue) {
                    credentials.headerValue = encryptData(credentials.headerValue);
                }
                if (credentials.oauth2?.clientSecret) {
                    credentials.oauth2.clientSecret = encryptData(credentials.oauth2.clientSecret);
                }
            }

            // Update version if significant changes
            if (updates.url || updates.events || updates.payloadTemplate) {
                const currentVersion = webhook.version || '1.0.0';
                const [major, minor] = currentVersion.split('.').map(Number);
                webhook.version = `${major}.${minor + 1}.0`;
            }

            Object.assign(webhook, updates);
            await webhook.save();

            loggingService.info('Webhook updated', { value:  {  webhookId, userId  } });
            return webhook;
        } catch (error) {
            loggingService.error('Error updating webhook', { error, webhookId, userId });
            throw error;
        }
    }

    /**
     * Get webhooks for a user
     */
    async getUserWebhooks(userId: string, filters?: {
        active?: boolean;
        events?: string[];
    }): Promise<IWebhook[]> {
        try {
            const query: any = { userId: new mongoose.Types.ObjectId(userId) };
            
            if (filters?.active !== undefined) {
                query.active = filters.active;
            }
            
            if (filters?.events && filters.events.length > 0) {
                query.events = { $in: filters.events };
            }

            const webhooks = await Webhook.find(query)
                .sort({ createdAt: -1 })
                .select('-auth.credentials');

            return webhooks;
        } catch (error) {
            loggingService.error('Error fetching webhooks', { error, userId });
            throw error;
        }
    }

    /**
     * Get a single webhook
     */
    async getWebhook(webhookId: string, userId: string): Promise<IWebhook | null> {
        try {
            const webhook = await Webhook.findOne({ _id: webhookId, userId: new mongoose.Types.ObjectId(userId) })
                .select('-auth.credentials');
            return webhook;
        } catch (error) {
            loggingService.error('Error fetching webhook', { error, webhookId, userId });
            throw error;
        }
    }

    /**
     * Delete a webhook
     */
    async deleteWebhook(webhookId: string, userId: string): Promise<boolean> {
        try {
            const result = await Webhook.deleteOne({ _id: webhookId, userId: new mongoose.Types.ObjectId(userId) });
            
            if (result.deletedCount > 0) {
                // Also delete associated deliveries
                await WebhookDelivery.deleteMany({ webhookId });
                loggingService.info('Webhook deleted', { value:  {  webhookId, userId  } });
                return true;
            }
            
            return false;
        } catch (error) {
            loggingService.error('Error deleting webhook', { error, webhookId, userId });
            throw error;
        }
    }

    /**
     * Process an event and trigger matching webhooks (optimized with parallel processing)
     */
    async processEvent(eventData: WebhookEventData): Promise<void> {
        try {
            // Check circuit breaker
            if (WebhookService.isDbCircuitBreakerOpen()) {
                loggingService.warn('Webhook processing skipped - circuit breaker open', { 
                    eventType: eventData.eventType, 
                    eventId: eventData.eventId 
                });
                return;
            }

            // Find matching webhooks
            const webhooks = await this.findMatchingWebhooks(eventData);

            if (webhooks.length === 0) {
                return;
            }

            // Create delivery records for each webhook in parallel
            const deliveryPromises = webhooks.map(webhook => 
                this.createDelivery(webhook, eventData).catch(error => {
                    loggingService.error('Failed to create delivery for webhook', { 
                        error, 
                        webhookId: webhook._id,
                        eventId: eventData.eventId 
                    });
                    return null; // Don't fail the entire batch
                })
            );

            const deliveries = await Promise.allSettled(deliveryPromises);
            const successfulDeliveries = deliveries.filter(result => 
                result.status === 'fulfilled' && result.value !== null
            ).length;

            this.logOperation('info', 'Event processed for webhooks', 'processEvent', {
                eventId: eventData.eventId,
                webhookCount: webhooks.length,
                successfulDeliveries
            });
        } catch (error) {
            WebhookService.recordDbFailure();
            loggingService.error('Error processing webhook event', { error, eventData });
            // Don't throw - webhook failures shouldn't break the main flow
        }
    }

    /**
     * Find webhooks that match the event
     */
    private async findMatchingWebhooks(eventData: WebhookEventData): Promise<IWebhook[]> {
        const query: any = {
            active: true,
            events: eventData.eventType
        };

        // Add filters based on event data
        if (eventData.projectId) {
            query.$or = [
                { 'filters.projects': eventData.projectId },
                { 'filters.projects': { $size: 0 } },
                { 'filters.projects': null }
            ];
        }

        if (eventData.data.severity) {
            query['$or'] = [
                { 'filters.severity': eventData.data.severity },
                { 'filters.severity': { $size: 0 } },
                { 'filters.severity': null }
            ];
        }

        if (eventData.data.tags && eventData.data.tags.length > 0) {
            query['$or'] = [
                { 'filters.tags': { $in: eventData.data.tags } },
                { 'filters.tags': { $size: 0 } },
                { 'filters.tags': null }
            ];
        }

        if (eventData.data.cost?.amount) {
            query['$or'] = [
                { 'filters.minCost': { $lte: eventData.data.cost.amount } },
                { 'filters.minCost': null }
            ];
        }

        const webhooks = await Webhook.find(query);

        // Further filter by custom query if specified
        return webhooks.filter(webhook => {
            if (!webhook.filters?.customQuery) return true;
            
            try {
                // Simple matching of custom query against event data
                return this.matchCustomQuery(webhook.filters.customQuery, eventData);
            } catch (error) {
                loggingService.error('Error matching custom query', { error, webhookId: webhook._id });
                return false;
            }
        });
    }

    /**
     * Match custom query against event data
     */
    private matchCustomQuery(query: Record<string, any>, eventData: WebhookEventData): boolean {
        // Simple implementation - can be enhanced with more complex matching
        for (const [key, value] of Object.entries(query)) {
            const eventValue = this.getNestedValue(eventData, key);
            
            if (typeof value === 'object' && value !== null) {
                // Handle operators like $gt, $lt, $in, etc.
                for (const [operator, operandValue] of Object.entries(value)) {
                    switch (operator) {
                        case '$gt':
                            if (!(eventValue > (operandValue as any))) return false;
                            break;
                        case '$gte':
                            if (!(eventValue >= (operandValue as any))) return false;
                            break;
                        case '$lt':
                            if (!(eventValue < (operandValue as any))) return false;
                            break;
                        case '$lte':
                            if (!(eventValue <= (operandValue as any))) return false;
                            break;
                        case '$in':
                            if (!Array.isArray(operandValue) || !operandValue.includes(eventValue)) return false;
                            break;
                        case '$ne':
                            if (eventValue === operandValue) return false;
                            break;
                        default:
                            // Unknown operator
                            return false;
                    }
                }
            } else {
                // Direct equality check
                if (eventValue !== value) return false;
            }
        }
        
        return true;
    }

    /**
     * Get nested value from object using dot notation
     */
    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }

    /**
     * Create a delivery record for a webhook
     */
    private async createDelivery(webhook: IWebhook, eventData: WebhookEventData): Promise<IWebhookDelivery> {
        try {
            // Build the payload
            const payload = await this.buildPayload(webhook, eventData);
            
            // Create delivery record
            const delivery = new WebhookDelivery({
                webhookId: webhook._id,
                userId: webhook.userId,
                eventId: eventData.eventId,
                eventType: eventData.eventType,
                eventData: eventData,
                attempt: 1,
                status: 'pending',
                request: {
                    url: webhook.url,
                    method: 'POST',
                    headers: await this.buildHeaders(webhook, payload),
                    body: payload,
                    timestamp: new Date()
                },
                retriesLeft: webhook.retryConfig?.maxRetries || 3
            });

            await delivery.save();

            loggingService.debug('Webhook delivery created', { value:  { deliveryId: delivery._id, 
                webhookId: webhook._id 
             } });

            return delivery;
        } catch (error) {
            loggingService.error('Error creating webhook delivery', { error, webhookId: webhook._id });
            throw error;
        }
    }

    /**
     * Build the payload for a webhook (optimized with template caching)
     */
    private async buildPayload(webhook: IWebhook, eventData: WebhookEventData): Promise<string> {
        try {
            const template = webhook.useDefaultPayload 
                ? DEFAULT_WEBHOOK_PAYLOAD 
                : webhook.payloadTemplate || DEFAULT_WEBHOOK_PAYLOAD;

            // Get or compile template with caching
            let compiledTemplate = WebhookService.templateCache.get(template);
            if (!compiledTemplate) {
                compiledTemplate = Handlebars.compile(template);
                WebhookService.templateCache.set(template, compiledTemplate);
            }

            // Get additional context in parallel
            const [user, project] = await Promise.all([
                User.findById(eventData.userId).select('_id name email').lean(),
                eventData.projectId 
                    ? Project.findById(eventData.projectId).select('_id name').lean()
                    : Promise.resolve(null)
            ]);
            
            // Build context
            const context = {
                event: eventData,
                user: user ? {
                    id: user._id.toString(),
                    name: user.name,
                    email: user.email
                } : null,
                project: project ? {
                    id: project._id.toString(),
                    name: project.name
                } : null,
                timestamp: new Date().toISOString(),
                costKatana: {
                    version: process.env.APP_VERSION || '1.0.0',
                    environment: process.env.NODE_ENV || 'production'
                }
            };

            return compiledTemplate(context);
        } catch (error) {
            loggingService.error('Error building webhook payload', { error, webhookId: webhook._id });
            // Return a minimal payload on error
            return JSON.stringify({
                event_id: eventData.eventId,
                event_type: eventData.eventType,
                error: 'Failed to build custom payload'
            });
        }
    }

    /**
     * Build headers for webhook request
     */
    private async buildHeaders(webhook: IWebhook, payload: string): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'CostKatana-Webhook/1.0',
            'X-CostKatana-Webhook-Id': webhook._id!.toString(),
            'X-CostKatana-Event-Id': uuidv4(),
            'X-CostKatana-Timestamp': Date.now().toString()
        };

        // Add custom headers
        if (webhook.headers) {
            Object.entries(webhook.headers).forEach(([key, value]) => {
                headers[key] = value;
            });
        }

        // Add authentication headers
        if (webhook.auth && webhook.auth.type !== 'none' && webhook.auth.credentials) {
            const creds = webhook.auth.credentials;
            
            switch (webhook.auth.type) {
                case 'basic':
                    if (creds.username && creds.password) {
                        const decryptedPassword = decryptData(creds.password);
                        const auth = Buffer.from(`${creds.username}:${decryptedPassword}`).toString('base64');
                        headers['Authorization'] = `Basic ${auth}`;
                    }
                    break;
                    
                case 'bearer':
                    if (creds.token) {
                        const decryptedToken = decryptData(creds.token);
                        headers['Authorization'] = `Bearer ${decryptedToken}`;
                    }
                    break;
                    
                case 'custom_header':
                    if (creds.headerName && creds.headerValue) {
                        const decryptedValue = decryptData(creds.headerValue);
                        headers[creds.headerName] = decryptedValue;
                    }
                    break;
                    
                case 'oauth2':
                    // OAuth2 would require fetching a token first
                    // This is a placeholder - implement OAuth2 flow as needed
                    loggingService.warn('OAuth2 authentication not yet implemented for webhooks');
                    break;
            }
        }

        // Add HMAC signature
        const signature = this.generateSignature(webhook.secret, payload, headers['X-CostKatana-Timestamp']);
        headers['X-CostKatana-Signature'] = signature;

        return headers;
    }

    /**
     * Generate HMAC signature for webhook payload (optimized with caching)
     */
    private generateSignature(secret: string, payload: string, timestamp: string): string {
        const signaturePayload = `${timestamp}.${payload}`;
        const cacheKey = `${secret}:${signaturePayload}`;
        
        // Check cache first
        let signature = WebhookService.signatureCache.get(cacheKey);
        if (!signature) {
            const hmacSignature = crypto
                .createHmac('sha256', secret)
                .update(signaturePayload)
                .digest('hex');
            
            signature = `sha256=${hmacSignature}`;
            
            // Cache the result (with size limit)
            if (WebhookService.signatureCache.size < 1000) {
                WebhookService.signatureCache.set(cacheKey, signature);
            }
        }
        
        return signature;
    }

    /**
     * Verify webhook signature (for inbound webhooks)
     */
    verifySignature(secret: string, payload: string, timestamp: string, signature: string): boolean {
        const expectedSignature = this.generateSignature(secret, payload, timestamp);
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    /**
     * Test a webhook with sample data
     */
    async testWebhook(webhookId: string, userId: string, testData?: WebhookTestPayload): Promise<IWebhookDelivery> {
        try {
            const webhook = await Webhook.findOne({ _id: webhookId, userId: new mongoose.Types.ObjectId(userId) });
            if (!webhook) {
                throw new Error('Webhook not found');
            }

            // Create test event data
            const eventData: WebhookEventData = {
                eventId: `test_${uuidv4()}`,
                eventType: testData?.eventType || WEBHOOK_EVENTS.SYSTEM_ERROR,
                occurredAt: new Date(),
                userId,
                data: testData?.customData || {
                    title: 'Test Webhook Event',
                    description: 'This is a test event to verify your webhook configuration',
                    severity: 'low',
                    tags: ['test'],
                    context: {
                        test: true,
                        timestamp: new Date().toISOString()
                    }
                }
            };

            // Create and return delivery
            const delivery = await this.createDelivery(webhook, eventData);
            
            loggingService.info('Test webhook delivery created', { value:  {  
                webhookId, 
                deliveryId: delivery._id 
             } });

            return delivery;
        } catch (error) {
            loggingService.error('Error testing webhook', { error, webhookId, userId });
            throw error;
        }
    }

    /**
     * Get webhook deliveries
     */
    async getWebhookDeliveries(
        webhookId: string, 
        userId: string, 
        filters?: {
            status?: string;
            eventType?: string;
            limit?: number;
            offset?: number;
        }
    ): Promise<{ deliveries: IWebhookDelivery[]; total: number }> {
        try {
            const query: any = { webhookId, userId };
            
            if (filters?.status) {
                query.status = filters.status;
            }
            
            if (filters?.eventType) {
                query.eventType = filters.eventType;
            }

            const limit = filters?.limit || 20;
            const offset = filters?.offset || 0;

            const [deliveries, total] = await Promise.all([
                WebhookDelivery.find(query)
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .skip(offset)
                    .select('-eventData'), // Exclude large event data
                await WebhookDelivery.countDocuments(query)
            ]);

            return { deliveries, total };
        } catch (error) {
            loggingService.error('Error fetching webhook deliveries', { error, webhookId, userId });
            throw error;
        }
    }

    /**
     * Get a single delivery
     */
    async getDelivery(deliveryId: string, userId: string): Promise<IWebhookDelivery | null> {
        try {
            const delivery = await WebhookDelivery.findOne({ 
                _id: deliveryId, 
                userId 
            });
            return delivery;
        } catch (error) {
            loggingService.error('Error fetching delivery', { error, deliveryId, userId });
            throw error;
        }
    }

    /**
     * Replay a webhook delivery
     */
    async replayDelivery(deliveryId: string, userId: string): Promise<IWebhookDelivery> {
        try {
            const originalDelivery = await WebhookDelivery.findOne({ 
                _id: deliveryId, 
                userId 
            });
            
            if (!originalDelivery) {
                throw new Error('Delivery not found');
            }

            const webhook = await Webhook.findById(originalDelivery.webhookId);
            if (!webhook) {
                throw new Error('Webhook not found');
            }

            // Create new delivery with same event data
            const newDelivery = new WebhookDelivery({
                webhookId: webhook._id,
                userId: webhook.userId,
                eventId: `${originalDelivery.eventId}_replay_${Date.now()}`,
                eventType: originalDelivery.eventType,
                eventData: originalDelivery.eventData,
                attempt: 1,
                status: 'pending',
                request: {
                    url: webhook.url,
                    method: 'POST',
                    headers: await this.buildHeaders(webhook, originalDelivery.request.body),
                    body: originalDelivery.request.body,
                    timestamp: new Date()
                },
                retriesLeft: webhook.retryConfig?.maxRetries || 3,
                metadata: {
                    replayedFrom: originalDelivery._id,
                    originalEventId: originalDelivery.eventId
                }
            });

            await newDelivery.save();

            loggingService.info('Webhook delivery replayed', { value:  {  
                originalDeliveryId: deliveryId,
                newDeliveryId: newDelivery._id 
             } });

            return newDelivery;
        } catch (error) {
            loggingService.error('Error replaying delivery', { error, deliveryId, userId });
            throw error;
        }
    }

    /**
     * Get webhook statistics (optimized with $facet aggregation)
     */
    async getWebhookStats(webhookId: string, userId: string): Promise<any> {
        try {
            // Check circuit breaker
            if (WebhookService.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const webhook = await Webhook.findOne({ _id: webhookId, userId: new mongoose.Types.ObjectId(userId) });
            if (!webhook) {
                throw new Error('Webhook not found');
            }

            // Get delivery stats for multiple time periods using $facet
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const [statsResult] = await WebhookDelivery.aggregate([
                {
                    $facet: {
                        last24Hours: [
                            { $match: { webhookId: webhookId, createdAt: { $gte: oneDayAgo } } },
                            {
                                $group: {
                                    _id: '$status',
                                    count: { $sum: 1 },
                                    avgResponseTime: { $avg: '$response.responseTime' }
                                }
                            }
                        ],
                        last7Days: [
                            { $match: { webhookId: webhookId, createdAt: { $gte: sevenDaysAgo } } },
                            {
                                $group: {
                                    _id: '$status',
                                    count: { $sum: 1 },
                                    avgResponseTime: { $avg: '$response.responseTime' }
                                }
                            }
                        ],
                        last30Days: [
                            { $match: { webhookId: webhookId, createdAt: { $gte: thirtyDaysAgo } } },
                            {
                                $group: {
                                    _id: '$status',
                                    count: { $sum: 1 },
                                    avgResponseTime: { $avg: '$response.responseTime' }
                                }
                            }
                        ],
                        recentDeliveries: [
                            { $match: { webhookId: webhookId } },
                            { $sort: { createdAt: -1 } },
                            { $limit: 10 },
                            {
                                $project: {
                                    status: 1,
                                    createdAt: 1,
                                    'response.responseTime': 1,
                                    eventType: 1
                                }
                            }
                        ]
                    }
                }
            ]);

            // Process the aggregated results
            const processStats = (stats: any[]) => {
                const result = {
                    total: 0,
                    success: 0,
                    failed: 0,
                    pending: 0,
                    timeout: 0,
                    cancelled: 0,
                    avgResponseTime: 0
                };

                stats.forEach(stat => {
                    (result as any)[stat._id] = stat.count;
                    result.total += stat.count;
                    if (stat._id === 'success' && stat.avgResponseTime) {
                        result.avgResponseTime = Math.round(stat.avgResponseTime);
                    }
                });

                return result;
            };

            return {
                webhook: {
                    id: webhook._id,
                    name: webhook.name,
                    url: webhook.url,
                    active: webhook.active,
                    events: webhook.events,
                    stats: webhook.stats
                },
                deliveryStats: {
                    last24Hours: processStats(statsResult.last24Hours),
                    last7Days: processStats(statsResult.last7Days),
                    last30Days: processStats(statsResult.last30Days)
                },
                recentDeliveries: statsResult.recentDeliveries
            };
        } catch (error) {
            WebhookService.recordDbFailure();
            loggingService.error('Error getting webhook stats', { error, webhookId, userId });
            throw error;
        }
    }



    /**
     * Update webhook statistics after delivery
     */
    async updateWebhookStats(webhookId: string, success: boolean, responseTime?: number): Promise<void> {
        try {
            const update: any = {
                $inc: {
                    'stats.totalDeliveries': 1,
                    [`stats.${success ? 'successfulDeliveries' : 'failedDeliveries'}`]: 1
                },
                $set: {
                    'stats.lastDeliveryAt': new Date()
                }
            };

            if (success) {
                update.$set['stats.lastSuccessAt'] = new Date();
                
                // Update average response time
                if (responseTime) {
                    const webhook = await Webhook.findById(webhookId);
                    if (webhook) {
                        const currentAvg = webhook.stats.averageResponseTime || 0;
                        const totalSuccess = webhook.stats.successfulDeliveries || 0;
                        const newAvg = (currentAvg * totalSuccess + responseTime) / (totalSuccess + 1);
                        update.$set['stats.averageResponseTime'] = Math.round(newAvg);
                    }
                }
            } else {
                update.$set['stats.lastFailureAt'] = new Date();
            }

            await Webhook.findByIdAndUpdate(webhookId, update);
        } catch (error) {
            loggingService.error('Error updating webhook stats', { error, webhookId });
        }
    }

    /**
     * Detect if webhook URL is a Slack or Discord webhook
     */
    static detectWebhookPlatform(url: string): 'slack' | 'discord' | 'generic' {
        if (url.includes('hooks.slack.com')) {
            return 'slack';
        } else if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) {
            return 'discord';
        }
        return 'generic';
    }

    /**
     * Format payload for Slack/Discord webhooks if detected
     */
    static async formatPlatformPayload(
        webhookUrl: string,
        eventData: WebhookEventData,
        defaultPayload: string
    ): Promise<string> {
        const platform = this.detectWebhookPlatform(webhookUrl);

        if (platform === 'slack') {
            return this.formatSlackPayload(eventData);
        } else if (platform === 'discord') {
            return this.formatDiscordPayload(eventData);
        }

        return defaultPayload;
    }

    /**
     * Format payload for Slack Block Kit
     */
    private static formatSlackPayload(eventData: WebhookEventData): string {
        const severityEmoji: Record<string, string> = {
            low: '🔵',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
        };

        const severity = eventData.data?.severity || 'low';
        const title = eventData.data?.title || 'Alert';
        const description = eventData.data?.description || 'No description provided';
        const emoji = severityEmoji[severity] || '⚪';

        const slackPayload = {
            text: `${emoji} ${title}`,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: `${emoji} ${title}`,
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: description
                    }
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Type:*\n${eventData.eventType}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Severity:*\n${severity.toUpperCase()}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Time:*\n<!date^${Math.floor(eventData.occurredAt.getTime() / 1000)}^{date_short_pretty} at {time}|${eventData.occurredAt.toISOString()}>`
                        }
                    ]
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `🤖 Cost Katana Alert System | Event ID: \`${eventData.eventId}\``
                        }
                    ]
                }
            ]
        };

        return JSON.stringify(slackPayload);
    }

    /**
     * Format payload for Discord Embeds
     */
    private static formatDiscordPayload(eventData: WebhookEventData): string {
        const severityColors: Record<string, number> = {
            low: 0x36a64f,      // Green
            medium: 0xffb700,   // Yellow
            high: 0xff6b00,     // Orange
            critical: 0xff0000  // Red
        };

        const severityEmoji: Record<string, string> = {
            low: '🔵',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
        };

        const severity = eventData.data?.severity || 'low';
        const title = eventData.data?.title || 'Alert';
        const description = eventData.data?.description || 'No description provided';
        const color = severityColors[severity] || 0x808080;
        const emoji = severityEmoji[severity] || '⚪';

        const discordPayload = {
            content: severity === 'critical' ? '⚠️ **Critical Alert**' : undefined,
            embeds: [
                {
                    title: `${emoji} ${title}`,
                    description: description,
                    color: color,
                    fields: [
                        {
                            name: '📋 Type',
                            value: eventData.eventType,
                            inline: true
                        },
                        {
                            name: '⚠️ Severity',
                            value: severity.toUpperCase(),
                            inline: true
                        },
                        {
                            name: '🕐 Time',
                            value: `<t:${Math.floor(eventData.occurredAt.getTime() / 1000)}:F>`,
                            inline: true
                        }
                    ],
                    footer: {
                        text: `Cost Katana Alert System | Event ID: ${eventData.eventId}`
                    },
                    timestamp: eventData.occurredAt.toISOString()
                }
            ]
        };

        return JSON.stringify(discordPayload);
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Clear caches
        this.templateCache.clear();
        this.encryptionCache.clear();
        this.signatureCache.clear();
        
        // Call base service shutdown
        if (this.instance) {
            this.instance.shutdown();
        }
    }
}

// Export singleton instance
export const webhookService = WebhookService.getInstance();
