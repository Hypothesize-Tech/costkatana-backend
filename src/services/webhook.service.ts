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

export class WebhookService {
    private static instance: WebhookService;

    private constructor() {
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
            const webhook = await Webhook.findOne({ _id: webhookId, userId });
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
            const query: any = { userId };
            
            if (filters?.active !== undefined) {
                query.active = filters.active;
            }
            
            if (filters?.events && filters.events.length > 0) {
                query.events = { $in: filters.events };
            }

            const webhooks = await Webhook.find(query)
                .sort({ createdAt: -1 })
                .select('-auth.credentials'); // Don't return encrypted credentials

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
            const webhook = await Webhook.findOne({ _id: webhookId, userId })
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
            const result = await Webhook.deleteOne({ _id: webhookId, userId });
            
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
     * Process an event and trigger matching webhooks
     */
    async processEvent(eventData: WebhookEventData): Promise<void> {
        try {
            loggingService.info('Processing webhook event', { value:  {  
                eventType: eventData.eventType, 
                eventId: eventData.eventId 
             } });

            // Find matching webhooks
            const webhooks = await this.findMatchingWebhooks(eventData);

            if (webhooks.length === 0) {
                loggingService.debug('No matching webhooks found', { value:  { eventType: eventData.eventType  } });
                return;
            }

            // Create delivery records for each webhook
            const deliveryPromises = webhooks.map(webhook => 
                this.createDelivery(webhook, eventData)
            );

            await Promise.all(deliveryPromises);

            loggingService.info('Event processed for webhooks', { value:  {  
                eventId: eventData.eventId,
                webhookCount: webhooks.length 
             } });
        } catch (error) {
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
     * Build the payload for a webhook
     */
    private async buildPayload(webhook: IWebhook, eventData: WebhookEventData): Promise<string> {
        try {
            const template = webhook.useDefaultPayload 
                ? DEFAULT_WEBHOOK_PAYLOAD 
                : webhook.payloadTemplate || DEFAULT_WEBHOOK_PAYLOAD;

            // Get additional context
            const user = await User.findById(eventData.userId);
            const project = eventData.projectId 
                ? await Project.findById(eventData.projectId) 
                : null;

            // Compile template
            const compiledTemplate = Handlebars.compile(template);
            
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
     * Generate HMAC signature for webhook payload
     */
    private generateSignature(secret: string, payload: string, timestamp: string): string {
        const signaturePayload = `${timestamp}.${payload}`;
        const signature = crypto
            .createHmac('sha256', secret)
            .update(signaturePayload)
            .digest('hex');
        
        return `sha256=${signature}`;
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
            const webhook = await Webhook.findOne({ _id: webhookId, userId });
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
     * Get webhook statistics
     */
    async getWebhookStats(webhookId: string, userId: string): Promise<any> {
        try {
            const webhook = await Webhook.findOne({ _id: webhookId, userId });
            if (!webhook) {
                throw new Error('Webhook not found');
            }

            // Get delivery stats for last 24 hours, 7 days, and 30 days
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const [day, week, month] = await Promise.all([
                this.getDeliveryStats(webhookId, oneDayAgo),
                this.getDeliveryStats(webhookId, sevenDaysAgo),
                this.getDeliveryStats(webhookId, thirtyDaysAgo)
            ]);

            // Get recent deliveries
            const recentDeliveries = await WebhookDelivery.find({ webhookId })
                .sort({ createdAt: -1 })
                .limit(10)
                .select('status createdAt responseTime eventType');

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
                    last24Hours: day,
                    last7Days: week,
                    last30Days: month
                },
                recentDeliveries
            };
        } catch (error) {
            loggingService.error('Error getting webhook stats', { error, webhookId, userId });
            throw error;
        }
    }

    /**
     * Get delivery statistics for a time period
     */
    private async getDeliveryStats(webhookId: string, since: Date): Promise<any> {
        const stats = await WebhookDelivery.aggregate([
            {
                $match: {
                    webhookId: webhookId,
                    createdAt: { $gte: since }
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    avgResponseTime: { $avg: '$response.responseTime' }
                }
            }
        ]);

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
}

// Export singleton instance
export const webhookService = WebhookService.getInstance();
