import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Header,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import type {
  CreateWebhookDto,
  UpdateWebhookDto,
  GetWebhooksQueryDto,
  GetDeliveriesQueryDto,
  TestWebhookDto,
} from './dto/webhook.dto';
import {
  createWebhookSchema,
  updateWebhookSchema,
  getWebhooksQuerySchema,
  getDeliveriesQuerySchema,
  testWebhookSchema,
  webhookIdParamSchema,
  deliveryIdParamSchema,
} from './dto/webhook.dto';
import { WEBHOOK_EVENTS } from './webhook.types';

@Controller('api/webhooks')
@UseGuards(JwtAuthGuard)
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookDeliveryService: WebhookDeliveryService,
  ) {}

  @Get('events')
  async getAvailableEvents() {
    const events = Object.entries(WEBHOOK_EVENTS).map(([key, value]) => ({
      key,
      value,
      category: value.split('.')[0],
      name: value.split('.').slice(1).join('.').replace(/_/g, ' '),
    }));

    const categories = [...new Set(events.map((e) => e.category))];

    return {
      success: true,
      events,
      categories,
      total: events.length,
    };
  }

  @Get('queue/stats')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getQueueStats() {
    const queue = await this.webhookDeliveryService.getQueueStats();

    return {
      success: true,
      queue,
    };
  }

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getWebhooks(
    @CurrentUser('id') userId: string,
    @Query(ZodPipe(getWebhooksQuerySchema)) query: GetWebhooksQueryDto,
  ) {
    const webhooks = await this.webhookService.getUserWebhooks(userId, query);

    return {
      success: true,
      webhooks: webhooks.map((webhook) => ({
        id: webhook._id.toString(),
        name: webhook.name,
        description: webhook.description,
        url: webhook.url,
        events: webhook.events as WEBHOOK_EVENTS[],
        active: webhook.active,
        version: webhook.version,
        retryConfig: webhook.retryConfig || {
          maxRetries: 3,
          backoffMultiplier: 2,
          initialDelay: 5000,
        },
        stats: webhook.stats,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      })),
    };
  }

  @Post()
  async createWebhook(
    @CurrentUser('id') userId: string,
    @Body(ZodPipe(createWebhookSchema)) data: CreateWebhookDto,
  ) {
    const webhook = await this.webhookService.createWebhook(userId, data);

    return {
      success: true,
      webhook: {
        id: webhook._id.toString(),
        name: webhook.name,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        secret: `****${webhook.maskedSecret?.slice(-4) || webhook.secret.slice(-4)}`,
        retryConfig: webhook.retryConfig || {
          maxRetries: 3,
          backoffMultiplier: 2,
          initialDelay: 5000,
        },
        createdAt: webhook.createdAt,
      },
    };
  }

  @Get(':id')
  async getWebhook(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(webhookIdParamSchema)) params: { id: string },
  ) {
    const webhook = await this.webhookService.getWebhook(params.id, userId);

    return {
      success: true,
      webhook: {
        id: webhook._id.toString(),
        name: webhook.name,
        description: webhook.description,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        version: webhook.version,
        auth: webhook.auth
          ? {
              type: webhook.auth.type,
              hasCredentials: !!webhook.auth.credentials,
            }
          : undefined,
        filters: webhook.filters,
        headers: webhook.headers,
        payloadTemplate: webhook.payloadTemplate,
        useDefaultPayload: webhook.useDefaultPayload,
        secret: `****${webhook.maskedSecret?.slice(-4) || webhook.secret.slice(-4)}`,
        timeout: webhook.timeout,
        retryConfig: webhook.retryConfig || {
          maxRetries: 3,
          backoffMultiplier: 2,
          initialDelay: 5000,
        },
        stats: webhook.stats,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      },
    };
  }

  @Put(':id')
  async updateWebhook(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(webhookIdParamSchema)) params: { id: string },
    @Body(ZodPipe(updateWebhookSchema)) updates: UpdateWebhookDto,
  ) {
    const webhook = await this.webhookService.updateWebhook(
      params.id,
      userId,
      updates,
    );

    return {
      success: true,
      webhook: {
        id: webhook._id.toString(),
        name: webhook.name,
        url: webhook.url,
        events: webhook.events as WEBHOOK_EVENTS[],
        active: webhook.active,
        version: webhook.version,
        retryConfig: webhook.retryConfig || {
          maxRetries: 3,
          backoffMultiplier: 2,
          initialDelay: 5000,
        },
        updatedAt: webhook.updatedAt,
      },
    };
  }

  @Delete(':id')
  async deleteWebhook(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(webhookIdParamSchema)) params: { id: string },
  ) {
    await this.webhookService.deleteWebhook(params.id, userId);

    return {
      success: true,
      message: 'Webhook deleted successfully',
    };
  }

  @Post(':id/test')
  async testWebhook(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(webhookIdParamSchema)) params: { id: string },
    @Body(ZodPipe(testWebhookSchema)) data: TestWebhookDto,
  ) {
    const delivery = await this.webhookService.testWebhook(
      params.id,
      userId,
      data.testData,
    );
    await this.webhookDeliveryService.queueDelivery(delivery._id.toString());

    return {
      success: true,
      message: 'Test webhook queued for delivery',
      deliveryId: delivery._id.toString(),
    };
  }

  @Get(':id/stats')
  async getWebhookStats(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(webhookIdParamSchema)) params: { id: string },
  ) {
    const stats = await this.webhookService.getWebhookStats(params.id, userId);

    return {
      success: true,
      stats,
    };
  }

  @Get(':id/deliveries')
  async getDeliveries(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(webhookIdParamSchema)) params: { id: string },
    @Query(ZodPipe(getDeliveriesQuerySchema)) query: GetDeliveriesQueryDto,
  ) {
    const { deliveries, total } =
      await this.webhookService.getWebhookDeliveries(params.id, userId, query);

    return {
      success: true,
      deliveries: deliveries.map((delivery) => ({
        id: delivery._id.toString(),
        webhookId: delivery.webhookId.toString(),
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        eventData: delivery.eventData,
        attempt: delivery.attempt,
        status: delivery.status,
        request: {
          url: delivery.request.url,
          method: delivery.request.method,
          headers: delivery.request.headers,
          timestamp: delivery.request.timestamp,
        },
        response: delivery.response,
        error: delivery.error,
        nextRetryAt: delivery.nextRetryAt,
        retriesLeft: delivery.retriesLeft,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
      })),
      pagination: {
        total,
        limit: query.limit || 20,
        offset: query.offset || 0,
        hasMore: (query.offset || 0) + (deliveries.length || 0) < total,
      },
    };
  }

  @Get('/deliveries/:deliveryId')
  async getDelivery(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(deliveryIdParamSchema)) params: { deliveryId: string },
  ) {
    const delivery = await this.webhookService.getDelivery(
      params.deliveryId,
      userId,
    );

    return {
      success: true,
      delivery: {
        id: delivery._id.toString(),
        webhookId: delivery.webhookId.toString(),
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
        updatedAt: delivery.updatedAt,
      },
    };
  }

  @Post('/deliveries/:deliveryId/replay')
  async replayDelivery(
    @CurrentUser('id') userId: string,
    @Param(ZodPipe(deliveryIdParamSchema)) params: { deliveryId: string },
  ) {
    const newDelivery = await this.webhookService.replayDelivery(
      params.deliveryId,
      userId,
    );
    await this.webhookDeliveryService.queueDelivery(newDelivery._id.toString());

    return {
      success: true,
      message: 'Delivery replayed successfully',
      deliveryId: newDelivery._id.toString(),
    };
  }
}
