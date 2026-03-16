import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../common/logger/logger.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { CacheService } from '../../common/cache/cache.service';
import * as crypto from 'crypto';
import * as Handlebars from 'handlebars';
import {
  Webhook,
  WebhookDocument,
  IWebhookFilters,
} from '../../schemas/webhook/webhook.schema';
import {
  WebhookDelivery,
  WebhookDeliveryDocument,
} from '../../schemas/webhook/webhook-delivery.schema';
import { WEBHOOK_EVENTS, WebhookEventData } from './webhook.types';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  GetWebhooksQueryDto,
  GetDeliveriesQueryDto,
} from './dto/webhook.dto';

@Injectable()
export class WebhookService {
  private readonly templateCache = new Map<
    string,
    Handlebars.TemplateDelegate
  >();
  private readonly signatureCache = new Map<string, string>();

  constructor(
    @InjectModel(Webhook.name) private webhookModel: Model<WebhookDocument>,
    @InjectModel(WebhookDelivery.name)
    private webhookDeliveryModel: Model<WebhookDeliveryDocument>,
    private logger: LoggerService,
    private encryptionService: EncryptionService,
    private cacheService: CacheService,
  ) {}

  async createWebhook(
    userId: string,
    data: CreateWebhookDto,
  ): Promise<WebhookDocument> {
    try {
      // Validate events
      const validEvents = Object.values(WEBHOOK_EVENTS);
      const invalidEvents = data.events.filter(
        (event) => !validEvents.includes(event as any),
      );
      if (invalidEvents.length > 0) {
        throw new BadRequestException(
          `Invalid events: ${invalidEvents.join(', ')}`,
        );
      }

      // Encrypt credentials if provided (store as token field: JSON of { encrypted, iv, authTag })
      let encryptedAuth = data.auth;
      if (data.auth?.credentials) {
        const gcm = this.encryptionService.encryptGCM(
          JSON.stringify(data.auth.credentials),
        );
        encryptedAuth = {
          ...data.auth,
          credentials: { token: JSON.stringify(gcm) },
        };
      }

      const webhook = new this.webhookModel({
        userId,
        ...data,
        auth: encryptedAuth,
        secret: crypto.randomBytes(32).toString('hex'),
        retryConfig: data.retryConfig || {
          maxRetries: 3,
          backoffMultiplier: 2,
          initialDelay: 5000,
        },
      });

      const savedWebhook = await webhook.save();

      this.logger.log(`Webhook created: ${savedWebhook._id}`, {
        userId,
        webhookId: savedWebhook._id,
        webhookName: savedWebhook.name,
      });

      return savedWebhook;
    } catch (error) {
      this.logger.error('Failed to create webhook', { error, userId });
      throw error;
    }
  }

  async updateWebhook(
    id: string,
    userId: string,
    updates: UpdateWebhookDto,
  ): Promise<WebhookDocument> {
    try {
      // Validate events if provided
      if (updates.events) {
        const validEvents = Object.values(WEBHOOK_EVENTS);
        const invalidEvents = updates.events.filter(
          (event) => !validEvents.includes(event as any),
        );
        if (invalidEvents.length > 0) {
          throw new BadRequestException(
            `Invalid events: ${invalidEvents.join(', ')}`,
          );
        }
      }

      // Encrypt credentials if provided
      let encryptedAuth = updates.auth;
      if (updates.auth?.credentials) {
        const gcm = this.encryptionService.encryptGCM(
          JSON.stringify(updates.auth.credentials),
        );
        encryptedAuth = {
          ...updates.auth,
          credentials: { token: JSON.stringify(gcm) },
        };
      }

      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException('Invalid webhook ID format');
      }
      const webhookObjectId = new Types.ObjectId(id);
      const userObjectId = new Types.ObjectId(userId);
      const webhook = await this.webhookModel.findOneAndUpdate(
        { _id: webhookObjectId, userId: userObjectId },
        { ...updates, auth: encryptedAuth },
        { new: true },
      );

      if (!webhook) {
        throw new NotFoundException('Webhook not found');
      }

      this.logger.log(`Webhook updated: ${id}`, { userId, webhookId: id });
      return webhook;
    } catch (error) {
      this.logger.error('Failed to update webhook', {
        error,
        userId,
        webhookId: id,
      });
      throw error;
    }
  }

  async getUserWebhooks(
    userId: string,
    filters?: GetWebhooksQueryDto,
  ): Promise<WebhookDocument[]> {
    try {
      const query: any = { userId: new Types.ObjectId(userId) };

      if (filters?.active !== undefined) {
        query.active = filters.active;
      }

      if (filters?.events && filters.events.length > 0) {
        query.events = { $in: filters.events };
      }

      const webhooks = await this.webhookModel
        .find(query)
        .sort({ createdAt: -1 });

      this.logger.debug(`Retrieved ${webhooks.length} webhooks for user`, {
        userId,
      });
      return webhooks;
    } catch (error) {
      this.logger.error('Failed to get user webhooks', { error, userId });
      throw error;
    }
  }

  async getWebhook(id: string, userId: string): Promise<WebhookDocument> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException('Invalid webhook ID format');
      }
      const webhook = await this.webhookModel.findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      });

      if (!webhook) {
        throw new NotFoundException('Webhook not found');
      }

      return webhook;
    } catch (error) {
      this.logger.error('Failed to get webhook', {
        error,
        userId,
        webhookId: id,
      });
      throw error;
    }
  }

  async deleteWebhook(id: string, userId: string): Promise<boolean> {
    try {
      // Use explicit ObjectId for reliable matching (avoids string/ObjectId mismatch)
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException('Invalid webhook ID format');
      }
      const webhookObjectId = new Types.ObjectId(id);
      const userObjectId = new Types.ObjectId(userId);

      const result = await this.webhookModel.deleteOne({
        _id: webhookObjectId,
        userId: userObjectId,
      });

      if (result.deletedCount === 0) {
        throw new NotFoundException('Webhook not found');
      }

      // Cascade delete deliveries (use ObjectId for consistency)
      await this.webhookDeliveryModel.deleteMany({
        webhookId: webhookObjectId,
      });

      this.logger.log(`Webhook deleted: ${id}`, { userId, webhookId: id });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete webhook', {
        error,
        userId,
        webhookId: id,
      });
      throw error;
    }
  }

  async processEvent(eventData: WebhookEventData): Promise<void> {
    try {
      const matchingWebhooks = await this.findMatchingWebhooks(eventData);

      if (matchingWebhooks.length === 0) {
        this.logger.debug('No matching webhooks found for event', {
          eventId: eventData.eventId,
          eventType: eventData.eventType,
        });
        return;
      }

      this.logger.log(
        `Processing event ${eventData.eventId} for ${matchingWebhooks.length} webhooks`,
        {
          eventType: eventData.eventType,
          userId: eventData.userId,
        },
      );

      for (const webhook of matchingWebhooks) {
        try {
          await this.createDelivery(webhook, eventData);
        } catch (error) {
          this.logger.error('Failed to create delivery for webhook', {
            error,
            webhookId: webhook._id,
            eventId: eventData.eventId,
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to process webhook event', {
        error,
        eventData,
      });
      throw error;
    }
  }

  async testWebhook(
    id: string,
    userId: string,
    testData?: any,
  ): Promise<WebhookDeliveryDocument> {
    try {
      const webhook = await this.getWebhook(id, userId);

      if (!webhook.active) {
        throw new BadRequestException('Webhook is not active');
      }

      const testEventData: WebhookEventData = {
        eventId: `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        eventType: WEBHOOK_EVENTS.SYSTEM_ERROR, // Use a system event for testing
        occurredAt: new Date(),
        userId,
        data: {
          title: 'Webhook Test',
          description: 'This is a test webhook delivery',
          severity: 'low',
          resource: {
            type: 'webhook',
            id: webhook._id.toString(),
            name: webhook.name,
          },
          context: testData || {},
        },
      };

      const delivery = await this.createDelivery(webhook, testEventData);

      this.logger.log(`Webhook test initiated: ${id}`, {
        userId,
        webhookId: id,
        deliveryId: delivery._id,
      });
      return delivery;
    } catch (error) {
      this.logger.error('Failed to test webhook', {
        error,
        userId,
        webhookId: id,
      });
      throw error;
    }
  }

  async getWebhookDeliveries(
    webhookId: string,
    userId: string,
    filters?: GetDeliveriesQueryDto,
  ): Promise<{ deliveries: WebhookDeliveryDocument[]; total: number }> {
    try {
      // Verify webhook ownership
      await this.getWebhook(webhookId, userId);

      const query: any = { webhookId };

      if (filters?.status) {
        query.status = filters.status;
      }

      if (filters?.eventType) {
        query.eventType = filters.eventType;
      }

      const limit = filters?.limit || 20;
      const offset = filters?.offset || 0;

      const [deliveries, total] = await Promise.all([
        this.webhookDeliveryModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit),
        this.webhookDeliveryModel.countDocuments(query),
      ]);

      return { deliveries, total };
    } catch (error) {
      this.logger.error('Failed to get webhook deliveries', {
        error,
        userId,
        webhookId,
      });
      throw error;
    }
  }

  async getDelivery(
    deliveryId: string,
    userId: string,
  ): Promise<WebhookDeliveryDocument> {
    try {
      const delivery = await this.webhookDeliveryModel.findOne({
        _id: deliveryId,
        userId,
      });

      if (!delivery) {
        throw new NotFoundException('Delivery not found');
      }

      return delivery;
    } catch (error) {
      this.logger.error('Failed to get delivery', {
        error,
        userId,
        deliveryId,
      });
      throw error;
    }
  }

  async replayDelivery(
    deliveryId: string,
    userId: string,
  ): Promise<WebhookDeliveryDocument> {
    try {
      const originalDelivery = await this.getDelivery(deliveryId, userId);

      if (originalDelivery.status === 'pending') {
        throw new BadRequestException('Cannot replay a pending delivery');
      }

      const newDelivery = new this.webhookDeliveryModel({
        webhookId: originalDelivery.webhookId,
        userId: originalDelivery.userId,
        eventId: originalDelivery.eventId,
        eventType: originalDelivery.eventType,
        eventData: originalDelivery.eventData,
        attempt: 1,
        status: 'pending',
        request: originalDelivery.request,
        retriesLeft: originalDelivery.retriesLeft,
        metadata: {
          ...originalDelivery.metadata,
          originalDeliveryId: originalDelivery._id,
        },
      });

      const savedDelivery = await newDelivery.save();

      this.logger.log(
        `Delivery replayed: ${deliveryId} → ${savedDelivery._id}`,
        {
          userId,
          originalDeliveryId: deliveryId,
          newDeliveryId: savedDelivery._id,
        },
      );

      return savedDelivery;
    } catch (error) {
      this.logger.error('Failed to replay delivery', {
        error,
        userId,
        deliveryId,
      });
      throw error;
    }
  }

  async getWebhookStats(webhookId: string, userId: string): Promise<any> {
    try {
      // Verify webhook ownership
      await this.getWebhook(webhookId, userId);

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [totalStats, dayStats, weekStats, monthStats] = await Promise.all([
        this.webhookDeliveryModel.aggregate([
          { $match: { webhookId } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: {
                $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
              avgResponseTime: { $avg: '$response.responseTime' },
            },
          },
        ]),
        this.webhookDeliveryModel.aggregate([
          { $match: { webhookId, createdAt: { $gte: oneDayAgo } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: {
                $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
            },
          },
        ]),
        this.webhookDeliveryModel.aggregate([
          { $match: { webhookId, createdAt: { $gte: sevenDaysAgo } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: {
                $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
            },
          },
        ]),
        this.webhookDeliveryModel.aggregate([
          { $match: { webhookId, createdAt: { $gte: thirtyDaysAgo } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: {
                $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
            },
          },
        ]),
      ]);

      const stats = {
        overall: {
          total: totalStats[0]?.total || 0,
          successful: totalStats[0]?.successful || 0,
          failed: totalStats[0]?.failed || 0,
          successRate: totalStats[0]?.total
            ? ((totalStats[0].successful / totalStats[0].total) * 100).toFixed(
                2,
              )
            : '0.00',
          averageResponseTime: totalStats[0]?.avgResponseTime || null,
        },
        last24h: {
          total: dayStats[0]?.total || 0,
          successful: dayStats[0]?.successful || 0,
          failed: dayStats[0]?.failed || 0,
        },
        last7d: {
          total: weekStats[0]?.total || 0,
          successful: weekStats[0]?.successful || 0,
          failed: weekStats[0]?.failed || 0,
        },
        last30d: {
          total: monthStats[0]?.total || 0,
          successful: monthStats[0]?.successful || 0,
          failed: monthStats[0]?.failed || 0,
        },
      };

      return stats;
    } catch (error) {
      this.logger.error('Failed to get webhook stats', {
        error,
        userId,
        webhookId,
      });
      throw error;
    }
  }

  async updateWebhookStats(
    webhookId: string,
    success: boolean,
    responseTime?: number,
  ): Promise<void> {
    try {
      const updateData: any = {
        $inc: { 'stats.totalDeliveries': 1 },
        'stats.lastDeliveryAt': new Date(),
      };

      if (success) {
        updateData.$inc['stats.successfulDeliveries'] = 1;
        updateData['stats.lastSuccessAt'] = new Date();
        if (responseTime) {
          updateData['stats.averageResponseTime'] = responseTime;
        }
      } else {
        updateData.$inc['stats.failedDeliveries'] = 1;
        updateData['stats.lastFailureAt'] = new Date();
      }

      await this.webhookModel.updateOne({ _id: webhookId }, updateData);
    } catch (error) {
      this.logger.error('Failed to update webhook stats', {
        error,
        webhookId,
        success,
      });
      // Don't throw - stats update failure shouldn't break delivery
    }
  }

  verifySignature(
    secret: string,
    payload: string,
    timestamp: string,
    signature: string,
  ): boolean {
    try {
      const expectedSignature = this.generateSignature(
        secret,
        payload,
        timestamp,
      );
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch (error) {
      this.logger.error('Signature verification failed', { error });
      return false;
    }
  }

  private async findMatchingWebhooks(
    eventData: WebhookEventData,
  ): Promise<WebhookDocument[]> {
    try {
      const query: any = {
        active: true,
        events: eventData.eventType,
      };

      // Apply user/project filtering
      if (eventData.userId) {
        query.userId = eventData.userId;
      }

      if (eventData.projectId) {
        query['filters.projects'] = eventData.projectId;
      }

      const webhooks = await this.webhookModel.find(query);

      // Apply additional filters
      return webhooks.filter((webhook) =>
        this.matchesFilters(webhook, eventData),
      );
    } catch (error) {
      this.logger.error('Failed to find matching webhooks', {
        error,
        eventData,
      });
      return [];
    }
  }

  private async createDelivery(
    webhook: WebhookDocument,
    eventData: WebhookEventData,
  ): Promise<WebhookDeliveryDocument> {
    try {
      const payload = await this.buildPayload(webhook, eventData);
      const headers = await this.buildHeaders(webhook, payload);
      const signature = this.generateSignature(
        webhook.secret,
        JSON.stringify(payload),
        Date.now().toString(),
      );

      const delivery = new this.webhookDeliveryModel({
        webhookId: webhook._id,
        userId: webhook.userId,
        eventId: eventData.eventId,
        eventType: eventData.eventType,
        eventData: eventData.data,
        attempt: 1,
        status: 'pending',
        request: {
          url: webhook.url,
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          timestamp: new Date(),
        },
        retriesLeft: webhook.retryConfig?.maxRetries || 3,
        signature,
      });

      const savedDelivery = await delivery.save();
      return savedDelivery;
    } catch (error) {
      this.logger.error('Failed to create delivery', {
        error,
        webhookId: webhook._id,
        eventId: eventData.eventId,
      });
      throw error;
    }
  }

  private async buildPayload(
    webhook: WebhookDocument,
    eventData: WebhookEventData,
  ): Promise<any> {
    if (webhook.useDefaultPayload) {
      return {
        eventId: eventData.eventId,
        eventType: eventData.eventType,
        occurredAt: eventData.occurredAt.toISOString(),
        userId: eventData.userId,
        projectId: eventData.projectId,
        data: eventData.data,
        metadata: eventData.metadata,
      };
    }

    if (!webhook.payloadTemplate) {
      throw new Error('No payload template configured');
    }

    try {
      const template = await this.getCompiledTemplate(webhook.payloadTemplate);
      return template({
        eventId: eventData.eventId,
        eventType: eventData.eventType,
        occurredAt: eventData.occurredAt,
        userId: eventData.userId,
        projectId: eventData.projectId,
        data: eventData.data,
        metadata: eventData.metadata,
      });
    } catch (error) {
      this.logger.error('Failed to build payload from template', {
        error,
        webhookId: webhook._id,
      });
      throw new Error('Invalid payload template');
    }
  }

  private async buildHeaders(
    webhook: WebhookDocument,
    payload: any,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'CostKatana-Webhook/1.0',
      'X-Webhook-Event-Type': 'webhook-delivery',
    };

    // Add custom headers
    if (webhook.headers) {
      Object.assign(headers, webhook.headers);
    }

    // Add authentication headers
    if (webhook.auth && webhook.auth.type !== 'none') {
      const credentials = webhook.auth.credentials as
        | { token?: string }
        | undefined;
      if (credentials?.token) {
        const gcm = JSON.parse(credentials.token) as {
          encrypted: string;
          iv: string;
          authTag: string;
        };
        const decryptedStr = this.encryptionService.decryptGCM(
          gcm.encrypted,
          gcm.iv,
          gcm.authTag,
        );
        const decryptedCredentials = JSON.parse(decryptedStr) as Record<
          string,
          string
        >;

        switch (webhook.auth.type) {
          case 'basic':
            if (
              decryptedCredentials.username &&
              decryptedCredentials.password
            ) {
              const auth = Buffer.from(
                `${decryptedCredentials.username}:${decryptedCredentials.password}`,
              ).toString('base64');
              headers['Authorization'] = `Basic ${auth}`;
            }
            break;
          case 'bearer':
            if (decryptedCredentials.token) {
              headers['Authorization'] = `Bearer ${decryptedCredentials.token}`;
            }
            break;
          case 'custom_header':
            if (
              decryptedCredentials.headerName &&
              decryptedCredentials.headerValue
            ) {
              headers[decryptedCredentials.headerName] =
                decryptedCredentials.headerValue;
            }
            break;
        }
      }
    }

    // Add signature
    const timestamp = Date.now().toString();
    headers['X-Webhook-Timestamp'] = timestamp;
    headers['X-Webhook-Signature'] = this.generateSignature(
      webhook.secret,
      JSON.stringify(payload),
      timestamp,
    );

    return headers;
  }

  private generateSignature(
    secret: string,
    payload: string,
    timestamp: string,
  ): string {
    const cacheKey = `${secret}:${payload}:${timestamp}`;
    const cached = this.signatureCache.get(cacheKey);
    if (cached) return cached;

    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    this.signatureCache.set(cacheKey, signature);
    return signature;
  }

  private async getCompiledTemplate(
    template: string,
  ): Promise<Handlebars.TemplateDelegate> {
    const cached = this.templateCache.get(template);
    if (cached) return cached;

    try {
      const compiled = Handlebars.compile(template);
      this.templateCache.set(template, compiled);
      return compiled;
    } catch (error) {
      this.logger.error('Failed to compile Handlebars template', { error });
      throw error;
    }
  }

  private matchesFilters(
    webhook: WebhookDocument,
    eventData: WebhookEventData,
  ): boolean {
    const filters = webhook.filters;
    if (!filters) return true;

    // Severity filter
    if (filters.severity && filters.severity.length > 0) {
      if (!filters.severity.includes(eventData.data.severity)) {
        return false;
      }
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      const eventTags = eventData.data.tags || [];
      if (!filters.tags.some((tag) => eventTags.includes(tag))) {
        return false;
      }
    }

    // Models filter
    if (filters.models && filters.models.length > 0) {
      // This would need to be extracted from event data context
      const eventModel = eventData.data.resource?.metadata?.model;
      if (eventModel && !filters.models.includes(eventModel)) {
        return false;
      }
    }

    // Cost filter
    if (filters.minCost && eventData.data.cost) {
      if (eventData.data.cost.amount < filters.minCost) {
        return false;
      }
    }

    // Custom query filter
    if (filters.customQuery) {
      try {
        return this.matchesCustomQuery(filters.customQuery, eventData);
      } catch (error) {
        this.logger.warn('Custom query filter failed', {
          error,
          webhookId: webhook._id,
        });
        return false;
      }
    }

    return true;
  }

  private matchesCustomQuery(
    query: Record<string, any>,
    eventData: WebhookEventData,
  ): boolean {
    // Simple JSON path matching implementation
    for (const [key, expectedValue] of Object.entries(query)) {
      const actualValue = this.getNestedValue(eventData, key);
      if (actualValue !== expectedValue) {
        return false;
      }
    }
    return true;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
