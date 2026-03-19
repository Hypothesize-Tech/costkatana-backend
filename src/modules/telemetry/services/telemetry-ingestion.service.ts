import { Injectable, Logger } from '@nestjs/common';
import { TelemetryService } from './telemetry-store.service';

export interface RawSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  attributes?: Record<string, unknown>;
  status?: 'success' | 'error' | 'unset';
  statusMessage?: string;
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
  costUsd?: number;
  genAiModel?: string;
  promptTokens?: number;
  completionTokens?: number;
}

@Injectable()
export class TelemetryIngestionService {
  private readonly logger = new Logger(TelemetryIngestionService.name);

  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Ingest a single raw span into the telemetry store.
   */
  async ingestSpan(span: RawSpanInput): Promise<void> {
    const endTime = span.endTime ?? new Date();
    const startTime =
      span.startTime instanceof Date
        ? span.startTime
        : new Date(span.startTime);
    const durationMs = endTime.getTime() - startTime.getTime();
    await this.telemetryService.storeTelemetryData({
      trace_id: span.traceId,
      span_id: span.spanId,
      parent_span_id: span.parentSpanId,
      tenant_id: span.tenantId ?? '',
      workspace_id: span.workspaceId ?? '',
      user_id: span.userId ?? '',
      request_id: span.spanId,
      timestamp: endTime,
      start_time: startTime,
      end_time: endTime,
      duration_ms: durationMs,
      service_name: 'ingestion',
      operation_name: span.name,
      span_kind: 'internal',
      status: span.status ?? 'success',
      status_message: span.statusMessage,
      cost_usd: span.costUsd,
      gen_ai_model: span.genAiModel,
      prompt_tokens: span.promptTokens,
      completion_tokens: span.completionTokens,
      total_tokens:
        span.promptTokens != null && span.completionTokens != null
          ? span.promptTokens + span.completionTokens
          : undefined,
      attributes: span.attributes,
    });
  }

  /**
   * Ingest multiple spans in batch.
   */
  async ingestSpans(
    spans: RawSpanInput[],
  ): Promise<{ ingested: number; failed: number }> {
    let ingested = 0;
    let failed = 0;
    for (const span of spans) {
      try {
        await this.ingestSpan(span);
        ingested += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn('Failed to ingest span', {
          traceId: span.traceId,
          spanId: span.spanId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { ingested, failed };
  }
}
