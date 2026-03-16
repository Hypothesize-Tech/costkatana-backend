import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../webhook.types';

// Base webhook creation schema
const webhookBaseSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).trim().optional(),
  url: z.string().url(),
  events: z.array(z.nativeEnum(WEBHOOK_EVENTS)).min(1).max(50),
  active: z.boolean().default(true),
  timeout: z.number().min(5000).max(120000).default(30000),
  retryConfig: z
    .object({
      maxRetries: z.number().min(0).max(10).default(3),
      backoffMultiplier: z.number().min(1).max(5).default(2),
      initialDelay: z.number().min(1000).max(60000).default(5000),
    })
    .optional(),
  filters: z
    .object({
      severity: z
        .array(z.enum(['low', 'medium', 'high', 'critical']))
        .optional(),
      tags: z.array(z.string()).optional(),
      projects: z.array(z.string()).optional(), // ObjectId strings
      models: z.array(z.string()).optional(),
      minCost: z.number().positive().optional(),
      customQuery: z.record(z.any()).optional(),
    })
    .optional(),
  headers: z.record(z.string()).optional(),
  payloadTemplate: z.string().optional(),
  useDefaultPayload: z.boolean().default(true),
  auth: z
    .object({
      type: z.enum(['none', 'basic', 'bearer', 'custom_header', 'oauth2']),
      credentials: z
        .object({
          username: z.string().optional(),
          password: z.string().optional(),
          token: z.string().optional(),
          headerName: z.string().optional(),
          headerValue: z.string().optional(),
          oauth2: z
            .object({
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              tokenUrl: z.string().url().optional(),
              scope: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

// Create webhook DTO
export const createWebhookSchema = webhookBaseSchema;
export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;

// Update webhook DTO (all fields optional)
export const updateWebhookSchema = webhookBaseSchema.partial().extend({
  events: z.array(z.nativeEnum(WEBHOOK_EVENTS)).min(1).max(50).optional(),
});
export type UpdateWebhookDto = z.infer<typeof updateWebhookSchema>;

// Get webhooks query DTO
export const getWebhooksQuerySchema = z.object({
  active: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  events: z
    .union([z.string().transform((val) => [val]), z.array(z.string())])
    .optional(),
  limit: z
    .string()
    .transform((val) => Math.min(parseInt(val) || 50, 100))
    .optional(),
  offset: z
    .string()
    .transform((val) => parseInt(val) || 0)
    .optional(),
});
export type GetWebhooksQueryDto = z.infer<typeof getWebhooksQuerySchema>;

// Get deliveries query DTO
export const getDeliveriesQuerySchema = z.object({
  status: z
    .enum(['pending', 'success', 'failed', 'timeout', 'cancelled'])
    .optional(),
  eventType: z.nativeEnum(WEBHOOK_EVENTS).optional(),
  limit: z
    .string()
    .transform((val) => Math.min(parseInt(val) || 20, 100))
    .optional(),
  offset: z
    .string()
    .transform((val) => parseInt(val) || 0)
    .optional(),
});
export type GetDeliveriesQueryDto = z.infer<typeof getDeliveriesQuerySchema>;

// Test webhook DTO
export const testWebhookSchema = z.object({
  testData: z.record(z.any()).optional(),
});
export type TestWebhookDto = z.infer<typeof testWebhookSchema>;

// Webhook ID parameter schema
export const webhookIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid webhook ID format'),
});
export type WebhookIdParamDto = z.infer<typeof webhookIdParamSchema>;

// Delivery ID parameter schema
export const deliveryIdParamSchema = z.object({
  deliveryId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid delivery ID format'),
});
export type DeliveryIdParamDto = z.infer<typeof deliveryIdParamSchema>;

// Response DTOs (for documentation, not validation)
export interface WebhookResponseDto {
  id: string;
  name: string;
  description?: string;
  url: string;
  events: WEBHOOK_EVENTS[];
  active: boolean;
  version: string;
  auth?: {
    type: string;
    hasCredentials: boolean;
  };
  filters?: any;
  headers?: Record<string, string>;
  payloadTemplate?: string;
  useDefaultPayload: boolean;
  secret: string;
  timeout: number;
  retryConfig: {
    maxRetries: number;
    backoffMultiplier: number;
    initialDelay: number;
  };
  stats: {
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    lastDeliveryAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    averageResponseTime?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookListResponseDto {
  success: true;
  webhooks: WebhookResponseDto[];
}

export interface WebhookDeliveryResponseDto {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  eventData: any;
  attempt: number;
  status: 'pending' | 'success' | 'failed' | 'timeout' | 'cancelled';
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    timestamp: Date;
  };
  response?: {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    responseTime: number;
    timestamp: Date;
  };
  error?: {
    type: string;
    message: string;
    code?: string;
    details?: any;
  };
  nextRetryAt?: Date;
  retriesLeft: number;
  signature?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveriesResponseDto {
  success: true;
  deliveries: WebhookDeliveryResponseDto[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface WebhookEventsResponseDto {
  success: true;
  events: Array<{
    key: string;
    value: string;
    category: string;
    name: string;
  }>;
  categories: string[];
  total: number;
}

export interface WebhookQueueStatsResponseDto {
  success: true;
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  };
}
