/**
 * OTel Enricher Service (NestJS)
 *
 * Port from Express otelEnricher.service.ts.
 * Enriches OpenTelemetry spans with AI-inferred attributes, cost info, and routing decisions.
 * Uses optional Bedrock for AI enrichment and CacheService (Redis) for caching.
 */

import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Span } from '@opentelemetry/api';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { CacheService } from '../cache/cache.service';

const ENRICHMENT_CACHE_PREFIX = 'otel_enrichment:';
const ENRICHMENT_CACHE_TTL = 3600; // 1 hour

export interface EnrichmentContext {
  span: Span;
  attributes: Record<string, unknown>;
  operation: string;
  service: string;
  httpRoute?: string;
  httpMethod?: string;
  genAiModel?: string;
}

export interface EnrichmentResult {
  enrichedAttributes: Record<string, string | number | boolean>;
  insights: string[];
  cacheHit: boolean;
  routingDecision?: string;
  priceUsd?: number;
}

@Injectable()
export class OTelEnricherService {
  private readonly logger = new Logger(OTelEnricherService.name);
  private readonly enrichmentCache = new Map<string, EnrichmentResult>();
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(CacheService)
    private readonly cacheService: CacheService | null,
  ) {
    const region =
      this.configService.get<string>('AWS_BEDROCK_REGION') ||
      process.env.AWS_BEDROCK_REGION ||
      'us-east-1';
    try {
      this.bedrockClient = new BedrockRuntimeClient({ region });
    } catch (err) {
      this.logger.warn(
        'BedrockRuntimeClient not initialized; AI enrichment disabled',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  /**
   * Enrich span with AI-inferred attributes
   */
  async enrichSpan(
    enrichmentContext: EnrichmentContext,
  ): Promise<EnrichmentResult> {
    try {
      const cacheKey = this.generateCacheKey(enrichmentContext);

      const cached = await this.getCachedEnrichment(cacheKey);
      if (cached) {
        this.applyEnrichment(enrichmentContext.span, cached);
        return { ...cached, cacheHit: true };
      }

      const enrichment = await this.generateEnrichment(enrichmentContext);
      await this.cacheEnrichment(cacheKey, enrichment);
      this.applyEnrichment(enrichmentContext.span, enrichment);
      return { ...enrichment, cacheHit: false };
    } catch (error) {
      this.logger.error('Failed to enrich span', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        enrichedAttributes: {},
        insights: [],
        cacheHit: false,
      };
    }
  }

  /**
   * Auto-enrich spans with cost and routing attributes
   */
  async autoEnrichSpan(span: Span): Promise<void> {
    try {
      const spanAny = span as unknown as {
        attributes?: Record<string, unknown>;
        name?: string;
      };
      const attributes = spanAny.attributes || {};
      const operation = spanAny.name || 'unknown';
      const service = (attributes['service.name'] as string) || 'unknown';

      const enrichmentContext: EnrichmentContext = {
        span,
        attributes,
        operation,
        service,
        httpRoute: attributes['http.route'] as string | undefined,
        httpMethod: attributes['http.method'] as string | undefined,
        genAiModel: attributes['gen_ai.request.model'] as string | undefined,
      };

      const inferredAttributes =
        await this.inferMissingAttributes(enrichmentContext);

      if (enrichmentContext.genAiModel) {
        const costInfo = await this.inferCostInformation(enrichmentContext);
        Object.assign(inferredAttributes, costInfo);
      }

      if (enrichmentContext.httpRoute) {
        const routingInfo = this.inferRoutingDecision(enrichmentContext);
        Object.assign(inferredAttributes, routingInfo);
      }

      for (const [key, value] of Object.entries(inferredAttributes)) {
        if (value !== undefined && value !== null) {
          span.setAttribute(key, value);
        }
      }
    } catch (error) {
      this.logger.error('Failed to auto-enrich span', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async generateEnrichment(
    context: EnrichmentContext,
  ): Promise<EnrichmentResult> {
    if (
      !this.bedrockClient ||
      !this.configService.get<string>('AWS_BEDROCK_MODEL_ID')
    ) {
      return {
        enrichedAttributes: {},
        insights: ['Enrichment skipped - Bedrock not configured'],
        cacheHit: false,
      };
    }
    try {
      const prompt = this.buildEnrichmentPrompt(context);
      const modelId =
        this.configService.get<string>('AWS_BEDROCK_MODEL_ID') ||
        process.env.AWS_BEDROCK_MODEL_ID;
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.content?.[0]?.text ?? '';
      return this.parseEnrichmentResponse(text);
    } catch (error) {
      this.logger.warn('Bedrock enrichment failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        enrichedAttributes: {},
        insights: ['Enrichment failed - using fallback'],
        cacheHit: false,
      };
    }
  }

  private async inferMissingAttributes(
    context: EnrichmentContext,
  ): Promise<Record<string, string | number | boolean>> {
    const inferred: Record<string, string | number | boolean> = {};

    if (
      context.operation.includes('cache') ||
      context.operation.includes('redis')
    ) {
      const hit =
        context.attributes['cache.hit'] ?? this.inferCacheHit(context);
      inferred['cache.hit'] = hit as boolean;
    }

    if (context.operation.includes('ai') || context.operation.includes('llm')) {
      inferred['processing.type'] = 'ai_inference';
    } else if (
      context.operation.includes('db') ||
      context.operation.includes('mongo')
    ) {
      inferred['processing.type'] = 'database';
    } else if (
      context.operation.includes('http') ||
      context.operation.includes('api')
    ) {
      inferred['processing.type'] = 'api_call';
    }

    if (context.httpRoute) {
      inferred['request.priority'] = this.inferRequestPriority(
        context.httpRoute,
      );
    }

    return inferred;
  }

  private async inferCostInformation(
    context: EnrichmentContext,
  ): Promise<Record<string, number | boolean>> {
    const costInfo: Record<string, number | boolean> = {};
    if (!context.genAiModel) return costInfo;

    const promptTokens =
      (context.attributes['gen_ai.usage.prompt_tokens'] as number) || 0;
    const completionTokens =
      (context.attributes['gen_ai.usage.completion_tokens'] as number) || 0;

    if (promptTokens > 0 || completionTokens > 0) {
      const estimatedCost = this.calculateModelCost(
        context.genAiModel,
        promptTokens,
        completionTokens,
      );
      costInfo['costkatana.cost.usd'] = estimatedCost;
      costInfo['costkatana.cost.estimated'] = true;
    }
    return costInfo;
  }

  private inferRoutingDecision(
    context: EnrichmentContext,
  ): Record<string, string | number | boolean> {
    const routingInfo: Record<string, string | number | boolean> = {};
    if (!context.httpRoute) return routingInfo;

    if (context.httpRoute.includes('/api/v1/')) {
      routingInfo['routing.version'] = 'v1';
    } else if (context.httpRoute.includes('/api/v2/')) {
      routingInfo['routing.version'] = 'v2';
    }

    if (context.httpMethod === 'GET') {
      routingInfo['routing.decision'] = 'read_replica';
    } else if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.httpMethod || '')
    ) {
      routingInfo['routing.decision'] = 'primary';
    }

    if (
      context.httpMethod === 'GET' &&
      !context.httpRoute.includes('/real-time/')
    ) {
      routingInfo['routing.cacheable'] = true;
      routingInfo['routing.cache_ttl'] = this.inferCacheTTL(context.httpRoute);
    }
    return routingInfo;
  }

  private buildEnrichmentPrompt(context: EnrichmentContext): string {
    return `
Analyze this OpenTelemetry span and provide enrichment suggestions:

Operation: ${context.operation}
Service: ${context.service}
HTTP Route: ${context.httpRoute || 'N/A'}
HTTP Method: ${context.httpMethod || 'N/A'}
GenAI Model: ${context.genAiModel || 'N/A'}

Current Attributes:
${JSON.stringify(context.attributes, null, 2)}

Please provide:
1. Missing attributes that should be inferred
2. Cost optimization insights
3. Performance insights
4. Any anomalies or patterns detected

Respond in JSON format:
{
  "enrichedAttributes": {
    "key": "value"
  },
  "insights": ["insight1", "insight2"],
  "routingDecision": "decision",
  "priceUsd": 0.0
}
    `.trim();
  }

  private parseEnrichmentResponse(response: string): EnrichmentResult {
    try {
      const parsed = JSON.parse(response) as {
        enrichedAttributes?: Record<string, string | number | boolean>;
        insights?: string[];
        routingDecision?: string;
        priceUsd?: number;
      };
      return {
        enrichedAttributes: parsed.enrichedAttributes || {},
        insights: parsed.insights || [],
        cacheHit: false,
        routingDecision: parsed.routingDecision,
        priceUsd: parsed.priceUsd,
      };
    } catch {
      return {
        enrichedAttributes: {},
        insights: ['Failed to parse AI response'],
        cacheHit: false,
      };
    }
  }

  private applyEnrichment(span: Span, enrichment: EnrichmentResult): void {
    for (const [key, value] of Object.entries(enrichment.enrichedAttributes)) {
      span.setAttribute(key, value);
    }
    if (enrichment.insights.length > 0) {
      span.setAttribute('costkatana.insights', enrichment.insights.join('; '));
    }
    if (enrichment.routingDecision) {
      span.setAttribute(
        'costkatana.routing_decision',
        enrichment.routingDecision,
      );
    }
    if (enrichment.priceUsd != null) {
      span.setAttribute('costkatana.price_usd', enrichment.priceUsd);
    }
  }

  private async cacheEnrichment(
    key: string,
    enrichment: EnrichmentResult,
  ): Promise<void> {
    this.enrichmentCache.set(key, enrichment);
    if (this.cacheService) {
      try {
        const cacheKey = `${ENRICHMENT_CACHE_PREFIX}${key}`;
        await this.cacheService.set(cacheKey, enrichment, ENRICHMENT_CACHE_TTL);
      } catch (err) {
        this.logger.debug('Cache set failed for enrichment', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async getCachedEnrichment(
    key: string,
  ): Promise<EnrichmentResult | null> {
    const memory = this.enrichmentCache.get(key);
    if (memory) return memory;

    if (this.cacheService) {
      try {
        const cacheKey = `${ENRICHMENT_CACHE_PREFIX}${key}`;
        const cached = await this.cacheService.get<EnrichmentResult>(cacheKey);
        if (
          cached &&
          typeof cached === 'object' &&
          'enrichedAttributes' in cached
        ) {
          this.enrichmentCache.set(key, cached);
          return cached;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  private generateCacheKey(context: EnrichmentContext): string {
    const keyParts = [
      context.operation,
      context.service,
      context.httpRoute || '',
      context.httpMethod || '',
      context.genAiModel || '',
    ];
    return Buffer.from(keyParts.join('|')).toString('base64');
  }

  private inferCacheHit(context: EnrichmentContext): boolean {
    const duration = (context.attributes['duration_ms'] as number) || 0;
    return duration < 10;
  }

  private inferRequestPriority(route: string): string {
    if (route.includes('/health') || route.includes('/metrics')) return 'low';
    if (route.includes('/api/v1/ai/') || route.includes('/chat/'))
      return 'high';
    if (route.includes('/analytics/') || route.includes('/reports/'))
      return 'medium';
    return 'normal';
  }

  private inferCacheTTL(route: string): number {
    if (route.includes('/static/') || route.includes('/assets/')) return 86400;
    if (route.includes('/api/v1/models/')) return 3600;
    if (route.includes('/api/v1/analytics/')) return 300;
    return 60;
  }

  private calculateModelCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const modelPricing: Record<string, { input: number; output: number }> = {
      'global.anthropic.claude-haiku-4-5-20251001-v1:0': {
        input: 0.00025,
        output: 0.00125,
      },
      'anthropic.claude-3-5-sonnet-20240620-v1:0': {
        input: 0.003,
        output: 0.015,
      },
      'anthropic.claude-opus-4-6-v1': { input: 0.005, output: 0.025 },
      'anthropic.claude-sonnet-4-6': { input: 0.003, output: 0.015 },
      'anthropic.claude-sonnet-4-6-v1:0': { input: 0.003, output: 0.015 }, // legacy
      'anthropic.claude-opus-4-1-20250805-v1:0': {
        input: 0.015,
        output: 0.075,
      },
      'amazon.nova-pro-v1:0': { input: 0.0008, output: 0.0032 },
      'amazon.titan-text-express-v1': { input: 0.0008, output: 0.0016 },
    };
    const pricing = modelPricing[model] || { input: 0.001, output: 0.002 };
    return (
      (promptTokens * pricing.input) / 1000 +
      (completionTokens * pricing.output) / 1000
    );
  }
}
