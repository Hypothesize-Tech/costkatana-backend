import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Span } from '@opentelemetry/api';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';

interface EnrichmentContext {
  span: Span;
  attributes: Record<string, any>;
  operation: string;
  service: string;
  httpRoute?: string;
  httpMethod?: string;
  genAiModel?: string;
}

interface EnrichmentResult {
  enrichedAttributes: Record<string, any>;
  insights: string[];
  cacheHit: boolean;
  routingDecision?: string;
  priceUsd?: number;
}

export class OTelEnricherService {
  private static instance: OTelEnricherService;
  private bedrockClient: BedrockRuntimeClient;
  private enrichmentCache = new Map<string, EnrichmentResult>();

  private constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  static getInstance(): OTelEnricherService {
    if (!OTelEnricherService.instance) {
      OTelEnricherService.instance = new OTelEnricherService();
    }
    return OTelEnricherService.instance;
  }

  /**
   * Enrich span with AI-inferred attributes
   */
  async enrichSpan(enrichmentContext: EnrichmentContext): Promise<EnrichmentResult> {
    try {
      const cacheKey = this.generateCacheKey(enrichmentContext);
      
      // Check Redis cache first
      const cached = await this.getCachedEnrichment(cacheKey);
      if (cached) {
        this.applyEnrichment(enrichmentContext.span, cached);
        return { ...cached, cacheHit: true };
      }

      // Generate enrichment using Bedrock
      const enrichment = await this.generateEnrichment(enrichmentContext);
      
      // Cache the result
      await this.cacheEnrichment(cacheKey, enrichment);
      
      // Apply to span
      this.applyEnrichment(enrichmentContext.span, enrichment);
      
      return { ...enrichment, cacheHit: false };
    } catch (error) {
      loggingService.error('Failed to enrich span:', { error: error instanceof Error ? error.message : String(error) });
      return {
        enrichedAttributes: {},
        insights: [],
        cacheHit: false
      };
    }
  }

  /**
   * Auto-enrich spans with cost and routing attributes
   */
  async autoEnrichSpan(span: Span): Promise<void> {
    try {
      const attributes = (span as any).attributes || {};
      const operation = (span as any).name || 'unknown';
      const service = attributes['service.name'] || 'unknown';

      const enrichmentContext: EnrichmentContext = {
        span,
        attributes,
        operation,
        service,
        httpRoute: attributes['http.route'],
        httpMethod: attributes['http.method'],
        genAiModel: attributes['gen_ai.request.model']
      };

      // Infer missing attributes
      const inferredAttributes = await this.inferMissingAttributes(enrichmentContext);
      
      // Add cost information if GenAI operation
      if (enrichmentContext.genAiModel) {
        const costInfo = await this.inferCostInformation(enrichmentContext);
        Object.assign(inferredAttributes, costInfo);
      }

      // Add routing decision for API calls
      if (enrichmentContext.httpRoute) {
        const routingInfo = await this.inferRoutingDecision(enrichmentContext);
        Object.assign(inferredAttributes, routingInfo);
      }

      // Apply enrichments
      for (const [key, value] of Object.entries(inferredAttributes)) {
        span.setAttribute(key, value);
      }

    } catch (error) {
      loggingService.error('Failed to auto-enrich span:', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Generate enrichment using Bedrock AI
   */
  private async generateEnrichment(context: EnrichmentContext): Promise<EnrichmentResult> {
    try {
      const prompt = this.buildEnrichmentPrompt(context);
      
      const command = new InvokeModelCommand({
        modelId: process.env.AWS_BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      return this.parseEnrichmentResponse(responseBody.content[0].text);
    } catch (error) {
      loggingService.error('Bedrock enrichment failed:', { error: error instanceof Error ? error.message : String(error) });
      return {
        enrichedAttributes: {},
        insights: ['Enrichment failed - using fallback'],
        cacheHit: false
      };
    }
  }

  /**
   * Infer missing attributes using patterns and AI
   */
  private async inferMissingAttributes(context: EnrichmentContext): Promise<Record<string, any>> {
    const inferred: Record<string, any> = {};

    // Infer cache hit from operation patterns
    if (context.operation.includes('cache') || context.operation.includes('redis')) {
      inferred['cache.hit'] = context.attributes['cache.hit'] || this.inferCacheHit(context);
    }

    // Infer processing type from operation name
    if (context.operation.includes('ai') || context.operation.includes('llm')) {
      inferred['processing.type'] = 'ai_inference';
    } else if (context.operation.includes('db') || context.operation.includes('mongo')) {
      inferred['processing.type'] = 'database';
    } else if (context.operation.includes('http') || context.operation.includes('api')) {
      inferred['processing.type'] = 'api_call';
    }

    // Infer priority from route patterns
    if (context.httpRoute) {
      inferred['request.priority'] = this.inferRequestPriority(context.httpRoute);
    }

    return inferred;
  }

  /**
   * Infer cost information for GenAI operations
   */
  private async inferCostInformation(context: EnrichmentContext): Promise<Record<string, any>> {
    const costInfo: Record<string, any> = {};

    if (!context.genAiModel) return costInfo;

    // Get token counts from attributes
    const promptTokens = context.attributes['gen_ai.usage.prompt_tokens'] || 0;
    const completionTokens = context.attributes['gen_ai.usage.completion_tokens'] || 0;

    if (promptTokens > 0 || completionTokens > 0) {
      // Calculate cost based on model pricing
      const estimatedCost = await this.calculateModelCost(
        context.genAiModel,
        promptTokens,
        completionTokens
      );

      costInfo['costkatana.cost.usd'] = estimatedCost;
      costInfo['costkatana.cost.currency'] = 'USD';
      costInfo['costkatana.cost.estimated'] = true;
    }

    return costInfo;
  }

  /**
   * Infer routing decision for API calls
   */
  private async inferRoutingDecision(context: EnrichmentContext): Promise<Record<string, any>> {
    const routingInfo: Record<string, any> = {};

    if (!context.httpRoute) return routingInfo;

    // Determine routing strategy based on route patterns
    if (context.httpRoute.includes('/api/v1/')) {
      routingInfo['routing.version'] = 'v1';
    } else if (context.httpRoute.includes('/api/v2/')) {
      routingInfo['routing.version'] = 'v2';
    }

    // Infer load balancing decision
    if (context.httpMethod === 'GET') {
      routingInfo['routing.decision'] = 'read_replica';
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.httpMethod || '')) {
      routingInfo['routing.decision'] = 'primary';
    }

    // Infer caching strategy
    if (context.httpMethod === 'GET' && !context.httpRoute.includes('/real-time/')) {
      routingInfo['routing.cacheable'] = true;
      routingInfo['routing.cache_ttl'] = this.inferCacheTTL(context.httpRoute);
    }

    return routingInfo;
  }

  /**
   * Build enrichment prompt for Bedrock
   */
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

  /**
   * Parse Bedrock response
   */
  private parseEnrichmentResponse(response: string): EnrichmentResult {
    try {
      const parsed = JSON.parse(response);
      return {
        enrichedAttributes: parsed.enrichedAttributes || {},
        insights: parsed.insights || [],
        cacheHit: false,
        routingDecision: parsed.routingDecision,
        priceUsd: parsed.priceUsd
      };
    } catch (error) {
      loggingService.error('Failed to parse enrichment response:', { error: error instanceof Error ? error.message : String(error) });
      return {
        enrichedAttributes: {},
        insights: ['Failed to parse AI response'],
        cacheHit: false
      };
    }
  }

  /**
   * Apply enrichment to span
   */
  private applyEnrichment(span: Span, enrichment: EnrichmentResult): void {
    for (const [key, value] of Object.entries(enrichment.enrichedAttributes)) {
      span.setAttribute(key, value);
    }

    if (enrichment.insights.length > 0) {
      span.setAttribute('costkatana.insights', enrichment.insights.join('; '));
    }

    if (enrichment.routingDecision) {
      span.setAttribute('costkatana.routing_decision', enrichment.routingDecision);
    }

    if (enrichment.priceUsd) {
      span.setAttribute('costkatana.price_usd', enrichment.priceUsd);
    }
  }

  /**
   * Cache enrichment result
   */
  private async cacheEnrichment(key: string, enrichment: EnrichmentResult): Promise<void> {
    try {
      // Cache in Redis for 1 hour
      await redisService.client.setEx(
        `otel_enrichment:${key}`,
        3600,
        JSON.stringify(enrichment)
      );
      
      // Also cache in memory for faster access
      this.enrichmentCache.set(key, enrichment);
    } catch (error) {
      loggingService.error('Failed to cache enrichment:', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Get cached enrichment
   */
  private async getCachedEnrichment(key: string): Promise<EnrichmentResult | null> {
    try {
      // Check memory cache first
      const memoryCache = this.enrichmentCache.get(key);
      if (memoryCache) return memoryCache;

      // Check Redis cache
      const cached = await redisService.client.get(`otel_enrichment:${key}`);
      if (cached) {
        const enrichment = JSON.parse(cached);
        this.enrichmentCache.set(key, enrichment);
        return enrichment;
      }

      return null;
    } catch (error) {
      loggingService.error('Failed to get cached enrichment:', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Generate cache key for enrichment
   */
  private generateCacheKey(context: EnrichmentContext): string {
    const keyParts = [
      context.operation,
      context.service,
      context.httpRoute || '',
      context.httpMethod || '',
      context.genAiModel || ''
    ];
    
    return Buffer.from(keyParts.join('|')).toString('base64');
  }

  /**
   * Helper methods for inference
   */
  private inferCacheHit(context: EnrichmentContext): boolean {
    // Simple heuristic - if duration is very low, likely a cache hit
    const duration = context.attributes['duration_ms'] || 0;
    return duration < 10; // Less than 10ms suggests cache hit
  }

  private inferRequestPriority(route: string): string {
    if (route.includes('/health') || route.includes('/metrics')) return 'low';
    if (route.includes('/api/v1/ai/') || route.includes('/chat/')) return 'high';
    if (route.includes('/analytics/') || route.includes('/reports/')) return 'medium';
    return 'normal';
  }

  private inferCacheTTL(route: string): number {
    if (route.includes('/static/') || route.includes('/assets/')) return 86400; // 24 hours
    if (route.includes('/api/v1/models/')) return 3600; // 1 hour
    if (route.includes('/api/v1/analytics/')) return 300; // 5 minutes
    return 60; // 1 minute default
  }

  private async calculateModelCost(model: string, promptTokens: number, completionTokens: number): Promise<number> {
    // Simplified cost calculation - in production, use actual pricing data
    const modelPricing: Record<string, { input: number; output: number }> = {
      // Legacy Claude 3 models removed - use Claude 3.5+ only
      
      // Updated Claude 3.5 models
      'global.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 0.00025, output: 0.00125 },
      'anthropic.claude-3-5-sonnet-20240620-v1:0': { input: 0.003, output: 0.015 },
      
      // Claude 4 models
      'anthropic.claude-opus-4-1-20250805-v1:0': { input: 0.015, output: 0.075 }, // Premium pricing
      
      // AWS Native models
      'amazon.nova-pro-v1:0': { input: 0.0008, output: 0.0032 }, // Cost-effective AWS pricing
      'amazon.titan-text-express-v1': { input: 0.0008, output: 0.0016 }
    };

    const pricing = modelPricing[model] || { input: 0.001, output: 0.002 };
    
    return (promptTokens * pricing.input / 1000) + (completionTokens * pricing.output / 1000);
  }
}

export const otelEnricherService = OTelEnricherService.getInstance();
    