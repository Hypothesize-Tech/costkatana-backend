import {
  trace,
  metrics,
  SpanStatusCode,
  context,
  propagation,
} from '@opentelemetry/api';
import * as crypto from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { Usage } from '../schemas/core/usage.schema';
import type { TelemetryStoreInput } from '../services/telemetry.service';

const tracer = trace.getTracer('cost-katana-genai', '1.0.0');
const meter = metrics.getMeter('cost-katana-genai', '1.0.0');

const tokenUsageCounter = meter.createCounter('gen_ai.client.token.usage', {
  description: 'Measures number of tokens used in LLM operations',
  unit: 'token',
});

const costCounter = meter.createCounter('costkatana.llm.cost', {
  description: 'Tracks cumulative cost of LLM operations',
  unit: 'USD',
});

const latencyHistogram = meter.createHistogram(
  'gen_ai.client.operation.duration',
  {
    description: 'Measures the duration of LLM operations',
    unit: 'ms',
  },
);

const HIGH_COST_THRESHOLD_USD = 0.01;

export interface GenAIUsageRecord {
  provider: string;
  operationName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  /** Optional: request id for tracing */
  requestId?: string;
  tenantId?: string;
  workspaceId?: string;
  prompt?: string;
  completion?: string;
  temperature?: number;
  maxTokens?: number;
  error?: Error;
  latencyMs?: number;
  extra?: Record<string, unknown>;
}

/** Global store for persisting GenAI telemetry to MongoDB. Set at app bootstrap from TelemetryService. */
let telemetryStore:
  | ((data: Partial<TelemetryStoreInput>) => Promise<void>)
  | null = null;

/**
 * Set the telemetry store used by recordGenAIUsage for MongoDB persistence.
 * Call this from a Nest module's onModuleInit with TelemetryService.storeTelemetryData bound to the service.
 */
export function setGenAITelemetryStore(
  store: (data: Partial<TelemetryStoreInput>) => Promise<void>,
): void {
  telemetryStore = store;
}

function redactAndTruncate(text: string, maxLength: number = 500): string {
  if (!text) return '';
  let redacted = text
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '[REDACTED_KEY]')
    .replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[REDACTED_EMAIL]',
    )
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_CC]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')
    .replace(
      /Bearer\s+[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
      'Bearer [REDACTED_JWT]',
    )
    .replace(/"password"\s*:\s*"[^"]+"/g, '"password":"[REDACTED]"')
    .replace(/"api_key"\s*:\s*"[^"]+"/g, '"api_key":"[REDACTED]"')
    .replace(/"secret"\s*:\s*"[^"]+"/g, '"secret":"[REDACTED]"');
  if (redacted.length > maxLength) {
    redacted = redacted.substring(0, maxLength) + '...[TRUNCATED]';
  }
  return redacted;
}

function hashText(text: string): string {
  if (!text) return '';
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex')
    .substring(0, 16);
}

const logger = new Logger('GenAITelemetry');

/**
 * Record GenAI usage: OpenTelemetry spans/metrics, optional MongoDB persistence, redaction, and high-cost logging.
 * Does not throw; telemetry failures must not break the application.
 */
export function recordGenAIUsage(record: GenAIUsageRecord): void {
  const {
    provider,
    operationName,
    model,
    promptTokens,
    completionTokens,
    cost,
    userId = 'unknown',
    sessionId,
    metadata,
    requestId,
    tenantId = 'default',
    workspaceId = 'default',
    prompt,
    completion,
    temperature,
    maxTokens,
    error,
    latencyMs,
    extra = {},
  } = record;

  const costUSD = cost;
  const totalTokens = promptTokens + completionTokens;

  try {
    const activeSpan = trace.getActiveSpan();
    const span =
      activeSpan ??
      tracer.startSpan(`gen_ai.${operationName}`, {
        attributes: {
          'gen_ai.system': provider,
          'gen_ai.operation.name': operationName,
          'gen_ai.request.model': model,
          'gen_ai.request.temperature': temperature ?? 0,
          'gen_ai.request.max_tokens': maxTokens ?? 0,
          'gen_ai.usage.prompt_tokens': promptTokens,
          'gen_ai.usage.completion_tokens': completionTokens,
          'gen_ai.usage.total_tokens': totalTokens,
          'costkatana.cost.usd': costUSD,
          'costkatana.cost.currency': 'USD',
          'tenant.id': tenantId,
          'workspace.id': workspaceId,
          'user.id': userId,
          'request.id': requestId ?? `genai_${Date.now()}`,
          ...(extra as Record<string, string | number>),
        },
      });

    const captureModelText = process.env.CK_CAPTURE_MODEL_TEXT === 'true';
    if (captureModelText && prompt) {
      const redactedPrompt = redactAndTruncate(prompt, 500);
      span.setAttribute('gen_ai.request.prompt.redacted', redactedPrompt);
      span.setAttribute('gen_ai.request.prompt.hash', hashText(prompt));
    }
    if (captureModelText && completion) {
      const redactedCompletion = redactAndTruncate(completion, 500);
      span.setAttribute(
        'gen_ai.response.completion.redacted',
        redactedCompletion,
      );
      span.setAttribute(
        'gen_ai.response.completion.hash',
        hashText(completion),
      );
    }

    span.addEvent('gen_ai.content.processed', {
      'gen_ai.prompt_tokens': promptTokens,
      'gen_ai.completion_tokens': completionTokens,
      'gen_ai.total_tokens': totalTokens,
      'costkatana.cost': costUSD,
      'gen_ai.model': model,
      'gen_ai.provider': provider,
    });

    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    const spanContext = span.spanContext();
    const activeBaggage = propagation.getBaggage(context.active());
    const baggage: Record<string, string> = {};
    if (activeBaggage) {
      activeBaggage.getAllEntries().forEach(([key, entry]) => {
        baggage[key] = entry.value;
      });
    }

    const requestIdResolved =
      baggage.request_id ?? requestId ?? `genai_${Date.now()}`;
    const userIdResolved = baggage.user_id ?? userId ?? 'anonymous';
    const tenantIdResolved = baggage.tenant_id ?? tenantId ?? 'default';
    const workspaceIdResolved =
      baggage.workspace_id ?? workspaceId ?? 'default';

    if (telemetryStore) {
      const storePayload: Partial<TelemetryStoreInput> = {
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        parent_span_id: (span as { parentSpanId?: string }).parentSpanId,
        tenant_id: tenantIdResolved,
        workspace_id: workspaceIdResolved,
        user_id: userIdResolved,
        request_id: requestIdResolved,
        timestamp: new Date(),
        start_time: new Date(),
        end_time: new Date(),
        duration_ms: latencyMs ?? 0,
        service_name: 'cost-katana-api',
        operation_name: `gen_ai.${operationName}`,
        span_kind: 'client',
        status: error ? 'error' : 'success',
        status_message: error?.message,
        error_type: error?.name,
        error_message: error?.message,
        gen_ai_system: provider,
        gen_ai_model: model,
        gen_ai_operation: operationName,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: costUSD,
        temperature: temperature ?? undefined,
        max_tokens: maxTokens,
        processing_latency_ms: latencyMs,
        attributes: { sessionId, ...metadata, ...extra } as Record<
          string,
          unknown
        >,
      };
      telemetryStore(storePayload).catch((err) => {
        logger.warn('Failed to store GenAI telemetry in MongoDB', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (!activeSpan) {
      span.end();
    }

    const labels = {
      provider,
      model,
      operation: operationName,
      tenant_id: tenantIdResolved,
      workspace_id: workspaceIdResolved,
      status: error ? 'error' : 'success',
    };
    tokenUsageCounter.add(promptTokens, { ...labels, token_type: 'prompt' });
    tokenUsageCounter.add(completionTokens, {
      ...labels,
      token_type: 'completion',
    });
    tokenUsageCounter.add(totalTokens, { ...labels, token_type: 'total' });
    if (costUSD > 0) {
      costCounter.add(costUSD, labels);
    }
    if (latencyMs !== undefined) {
      latencyHistogram.record(latencyMs, labels);
    }

    if (costUSD >= HIGH_COST_THRESHOLD_USD) {
      logger.log('High-cost LLM operation detected', {
        provider,
        model,
        operationName,
        costUSD,
        totalTokens,
        requestId: requestIdResolved,
        userId: userIdResolved,
        tenantId: tenantIdResolved,
      });
    }
  } catch (err) {
    logger.error('Error recording GenAI telemetry', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run a function inside an active GenAI span.
 */
export function createGenAISpan<T>(
  operationName: string,
  fn: (span: ReturnType<typeof tracer.startSpan>) => T | Promise<T>,
): T | Promise<T> {
  return tracer.startActiveSpan(`gen_ai.${operationName}`, (span) => {
    span.setAttribute('gen_ai.operation.name', operationName);
    return fn(span);
  });
}

/**
 * Wrap an async function with GenAI telemetry (span with duration).
 */
export function withGenAITelemetry<
  T extends (...args: unknown[]) => Promise<unknown>,
>(operationName: string, fn: T): T {
  return (async (...args: Parameters<T>) => {
    return tracer.startActiveSpan(`gen_ai.${operationName}`, async (span) => {
      const startTime = Date.now();
      try {
        const result = await fn(...args);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
        if (err instanceof Error) span.recordException(err);
        throw err;
      } finally {
        span.setAttribute('gen_ai.operation.duration', Date.now() - startTime);
        span.end();
      }
    });
  }) as T;
}

export { redactAndTruncate, hashText };

/** Injectable service that records usage to the Usage collection and can provide the telemetry store for recordGenAIUsage. */
export class GenAITelemetryService {
  private readonly log = new Logger(GenAITelemetryService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
  ) {}

  /**
   * Persist a simplified usage record to the Usage collection (for billing/analytics).
   * Skips create when userId is missing, as Usage schema requires userId.
   */
  async recordUsage(record: GenAIUsageRecord): Promise<void> {
    try {
      const totalTokens = record.promptTokens + record.completionTokens;
      const payload = {
        userId: record.userId,
        service: record.provider,
        model: record.model,
        prompt: '',
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens,
        cost: record.cost,
        responseTime: record.latencyMs ?? 0,
        metadata: {
          operationName: record.operationName,
          sessionId: record.sessionId,
          ...record.metadata,
        },
        tags: [],
        costAllocation: {},
        optimizationApplied: false,
        errorOccurred: !!record.error,
        errorMessage: record.error?.message,
      };
      if (!payload.userId) {
        this.log.debug('Skipping Usage create: userId required', {
          model: record.model,
        });
        return;
      }
      await this.usageModel.create(payload);
      this.log.debug('Recorded GenAI usage to Usage collection', {
        model: record.model,
        operation: record.operationName,
      });
    } catch (error) {
      this.log.error('Failed to record GenAI usage to Usage collection', {
        error: error instanceof Error ? error.message : String(error),
        model: record.model,
      });
    }
  }
}
