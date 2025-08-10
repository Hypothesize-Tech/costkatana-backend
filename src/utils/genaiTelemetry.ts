import { trace, metrics, SpanStatusCode, context, propagation } from '@opentelemetry/api';
import crypto from 'crypto';
import { logger } from './logger';
import { TelemetryService } from '../services/telemetry.service';

const tracer = trace.getTracer('cost-katana-genai', '1.0.0');
const meter = metrics.getMeter('cost-katana-genai', '1.0.0');

// Create metrics
const tokenUsageCounter = meter.createCounter('gen_ai.client.token.usage', {
    description: 'Measures number of tokens used in LLM operations',
    unit: 'token',
});

const costCounter = meter.createCounter('costkatana.llm.cost', {
    description: 'Tracks cumulative cost of LLM operations',
    unit: 'USD',
});

const latencyHistogram = meter.createHistogram('gen_ai.client.operation.duration', {
    description: 'Measures the duration of LLM operations',
    unit: 'ms',
});

interface GenAIUsageParams {
    provider: string;
    operationName: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUSD: number;
    requestId?: string;
    userId?: string;
    tenantId?: string;
    workspaceId?: string;
    prompt?: string;
    completion?: string;
    temperature?: number;
    maxTokens?: number;
    error?: Error;
    latencyMs?: number;
    extra?: Record<string, any>;
}

/**
 * Record GenAI usage metrics and create spans
 */
export async function recordGenAIUsage(params: GenAIUsageParams): Promise<void> {
    const {
        provider,
        operationName,
        model,
        promptTokens,
        completionTokens,
        costUSD,
        requestId,
        userId = 'unknown',
        tenantId = 'default',
        workspaceId = 'default',
        prompt,
        completion,
        temperature,
        maxTokens,
        error,
        latencyMs,
        extra = {}
    } = params;

    const totalTokens = promptTokens + completionTokens;

    try {
        // Get or create a span for this operation
        const activeSpan = trace.getActiveSpan();
        const span = activeSpan || tracer.startSpan(`gen_ai.${operationName}`, {
            attributes: {
                'gen_ai.system': provider,
                'gen_ai.operation.name': operationName,
                'gen_ai.request.model': model,
                'gen_ai.request.temperature': temperature,
                'gen_ai.request.max_tokens': maxTokens,
                'gen_ai.usage.prompt_tokens': promptTokens,
                'gen_ai.usage.completion_tokens': completionTokens,
                'gen_ai.usage.total_tokens': totalTokens,
                'costkatana.cost.usd': costUSD,
                'costkatana.cost.currency': 'USD',
                'tenant.id': tenantId,
                'workspace.id': workspaceId,
                'user.id': userId,
                'request.id': requestId,
                ...extra
            }
        });

        // Handle model text capture based on environment variable
        const captureModelText = process.env.CK_CAPTURE_MODEL_TEXT === 'true';
        
        if (captureModelText && prompt) {
            // Redact and truncate prompt for privacy
            const redactedPrompt = redactAndTruncate(prompt, 500);
            span.setAttribute('gen_ai.request.prompt.redacted', redactedPrompt);
            span.setAttribute('gen_ai.request.prompt.hash', hashText(prompt));
        }

        if (captureModelText && completion) {
            // Redact and truncate completion for privacy
            const redactedCompletion = redactAndTruncate(completion, 500);
            span.setAttribute('gen_ai.response.completion.redacted', redactedCompletion);
            span.setAttribute('gen_ai.response.completion.hash', hashText(completion));
        }

        // Add semantic event for the LLM call
        span.addEvent('gen_ai.content.processed', {
            'gen_ai.prompt_tokens': promptTokens,
            'gen_ai.completion_tokens': completionTokens,
            'gen_ai.total_tokens': totalTokens,
            'costkatana.cost': costUSD,
            'gen_ai.model': model,
            'gen_ai.provider': provider,
        });

        // Set span status
        if (error) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            span.recordException(error);
        } else {
            span.setStatus({ code: SpanStatusCode.OK });
        }

        // Store telemetry data in MongoDB
        const spanContext = span.spanContext();
        const activeBaggage = propagation.getBaggage(context.active());
        const baggage: Record<string, string> = {};
        if (activeBaggage) {
            const entries = activeBaggage.getAllEntries();
            entries.forEach(([key, entry]) => {
                baggage[key] = entry.value;
            });
        }

        // Store telemetry asynchronously (don't block the operation)
        TelemetryService.storeTelemetryData({
            trace_id: spanContext.traceId,
            span_id: spanContext.spanId,
            parent_span_id: (span as any).parentSpanId,
            tenant_id: baggage.tenant_id || tenantId || 'default',
            workspace_id: baggage.workspace_id || workspaceId || 'default',
            user_id: baggage.user_id || userId || 'anonymous',
            request_id: baggage.request_id || requestId || `genai_${Date.now()}`,
            timestamp: new Date(),
            start_time: new Date(),
            end_time: new Date(),
            duration_ms: latencyMs || 0,
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
            temperature,
            max_tokens: maxTokens,
            processing_latency_ms: latencyMs,
            attributes: extra
        }).catch(err => {
            logger.error('Failed to store GenAI telemetry in MongoDB:', err);
        });

        // End span if we created it
        if (!activeSpan) {
            span.end();
        }

        // Record metrics
        const labels = {
            provider,
            model,
            operation: operationName,
            tenant_id: tenantId,
            workspace_id: workspaceId,
            status: error ? 'error' : 'success',
        };

        // Increment token usage counter
        tokenUsageCounter.add(promptTokens, { ...labels, token_type: 'prompt' });
        tokenUsageCounter.add(completionTokens, { ...labels, token_type: 'completion' });
        tokenUsageCounter.add(totalTokens, { ...labels, token_type: 'total' });

        // Record cost
        if (costUSD > 0) {
            costCounter.add(costUSD, labels);
        }

        // Record latency if provided
        if (latencyMs !== undefined) {
            latencyHistogram.record(latencyMs, labels);
        }

        // Log high-cost operations
        if (costUSD >= 0.01) {
            logger.info('High-cost LLM operation detected', {
                provider,
                model,
                operationName,
                costUSD,
                totalTokens,
                requestId,
                userId,
                tenantId,
            });
        }

    } catch (error) {
        logger.error('Error recording GenAI telemetry:', error);
        // Don't throw - telemetry should not break the application
    }
}

/**
 * Create a span for GenAI operations
 */
export function createGenAISpan<T>(
    operationName: string, 
    fn: (span: any) => T | Promise<T>
): T | Promise<T> {
    return tracer.startActiveSpan(`gen_ai.${operationName}`, (span) => {
        span.setAttribute('gen_ai.operation.name', operationName);
        return fn(span);
    });
}

/**
 * Redact sensitive information and truncate text
 */
function redactAndTruncate(text: string, maxLength: number = 500): string {
    if (!text) return '';

    // Redact common sensitive patterns
    let redacted = text
        // Redact API keys and tokens
        .replace(/\b[A-Za-z0-9]{32,}\b/g, '[REDACTED_KEY]')
        // Redact email addresses
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
        // Redact phone numbers
        .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]')
        // Redact credit card numbers
        .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_CC]')
        // Redact SSN
        .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')
        // Redact JWT tokens
        .replace(/Bearer\s+[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, 'Bearer [REDACTED_JWT]')
        // Redact passwords in JSON-like structures
        .replace(/"password"\s*:\s*"[^"]+"/g, '"password":"[REDACTED]"')
        .replace(/"api_key"\s*:\s*"[^"]+"/g, '"api_key":"[REDACTED]"')
        .replace(/"secret"\s*:\s*"[^"]+"/g, '"secret":"[REDACTED]"');

    // Truncate if too long
    if (redacted.length > maxLength) {
        redacted = redacted.substring(0, maxLength) + '...[TRUNCATED]';
    }

    return redacted;
}

/**
 * Generate a hash of text for tracking without storing content
 */
function hashText(text: string): string {
    if (!text) return '';
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}

/**
 * Wrap an async function with GenAI telemetry
 */
export function withGenAITelemetry<T extends (...args: any[]) => Promise<any>>(
    operationName: string,
    fn: T
): T {
    return (async (...args: Parameters<T>) => {
        return tracer.startActiveSpan(`gen_ai.${operationName}`, async (span) => {
            const startTime = Date.now();
            try {
                const result = await fn(...args);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.setStatus({ 
                    code: SpanStatusCode.ERROR, 
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
                if (error instanceof Error) {
                    span.recordException(error);
                }
                throw error;
            } finally {
                const duration = Date.now() - startTime;
                span.setAttribute('gen_ai.operation.duration', duration);
                span.end();
            }
        });
    }) as T;
}
