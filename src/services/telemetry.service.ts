import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Telemetry, TelemetryDocument } from '../schemas/core/telemetry.schema';

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
}

/**
 * Service for storing and querying telemetry (span-style) data in MongoDB.
 * Used by GenAI telemetry and other instrumentation to persist OpenTelemetry-style spans.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
  ) {}

  /**
   * Store a telemetry span record in MongoDB.
   * Called asynchronously from recordGenAIUsage so it does not block the operation.
   */
  async storeTelemetryData(
    data: Partial<TelemetryStoreInput>,
  ): Promise<TelemetryDocument> {
    try {
      const doc = await this.telemetryModel.create(data);
      return doc;
    } catch (error) {
      this.logger.error('Failed to store telemetry data', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
