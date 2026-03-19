/**
 * TelemetryStoreService - Persist telemetry spans to MongoDB
 * Used by GenAI telemetry, request metrics, and telemetry ingestion.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';
import { loggingService } from '../../../common/services/logging.service';

/** Input shape for storeTelemetryData (used by genaiTelemetry) */
export interface TelemetryStoreInput {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  request_id: string;
  timestamp: Date;
  start_time: Date;
  end_time: Date;
  duration_ms: number;
  service_name: string;
  operation_name: string;
  span_kind: 'server' | 'client' | 'producer' | 'consumer' | 'internal';
  status: 'success' | 'error' | 'unset';
  status_message?: string;
  error_type?: string;
  error_message?: string;
  gen_ai_system?: string;
  gen_ai_model?: string;
  gen_ai_operation?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  temperature?: number;
  max_tokens?: number;
  processing_latency_ms?: number;
  attributes?: Record<string, unknown>;
  http_route?: string;
  http_method?: string;
  http_status_code?: number;
  [key: string]: unknown;
}

/**
 * TelemetryService - stores span data to MongoDB.
 * Used by TelemetryModule for GenAI telemetry ingestion.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  /** Static for legacy Express middleware - set by Nest or no-op */
  static storeTelemetryData: (
    data: Partial<TelemetryStoreInput>,
  ) => Promise<unknown> = async () => ({});

  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
  ) {}

  async storeTelemetryData(
    data: Partial<TelemetryStoreInput>,
  ): Promise<TelemetryDocument> {
    try {
      const defaults = {
        tenant_id: data.tenant_id ?? 'default',
        workspace_id: data.workspace_id ?? 'default',
        user_id: data.user_id ?? 'anonymous',
        request_id: data.request_id ?? data.span_id ?? `span_${Date.now()}`,
        timestamp: data.timestamp ?? new Date(),
        start_time: data.start_time ?? new Date(),
        end_time: data.end_time ?? new Date(),
        duration_ms: data.duration_ms ?? 0,
        service_name: data.service_name ?? 'unknown',
        operation_name: data.operation_name ?? 'unknown',
        span_kind: (data.span_kind ??
          'internal') as TelemetryStoreInput['span_kind'],
        status: (data.status ?? 'success') as TelemetryStoreInput['status'],
      };
      const doc = new this.telemetryModel({ ...defaults, ...data });
      await doc.save();
      return doc;
    } catch (error) {
      loggingService.error('Failed to store telemetry data', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
