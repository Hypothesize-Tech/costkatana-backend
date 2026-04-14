import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { CacheService } from '../../../common/cache/cache.service';

export interface EmbeddingResult {
  embedding: number[];
  text: string;
  model: string;
  dimensions: number;
}

/**
 * EmbeddingsService
 *
 * Handles text embeddings generation using AWS Bedrock Titan model.
 * Includes Redis caching and semantic content generation for telemetry data.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly EMBEDDING_MODEL = 'amazon.titan-embed-text-v1';
  private readonly CACHE_TTL = 3600; // 1 hour cache for embeddings

  constructor(private readonly cacheService: CacheService) {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  /**
   * Generate embeddings for text using AWS Bedrock Titan
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      // Validate input - AWS Bedrock requires minLength: 1
      if (!text || text.trim().length === 0) {
        this.logger.warn(
          'Empty text provided to generateEmbedding, returning zero vector',
        );
        return {
          embedding: new Array(1536).fill(0),
          text: '',
          model: this.EMBEDDING_MODEL,
          dimensions: 1536,
        };
      }

      // Check cache first
      const cacheKey = `embedding:${Buffer.from(text).toString('base64')}`;
      const cached = await this.getCachedEmbedding(cacheKey);
      if (cached) {
        return cached;
      }

      // Clean and prepare text
      const cleanText = this.cleanText(text);

      // Validate cleaned text is not empty
      if (!cleanText || cleanText.length === 0) {
        this.logger.warn(
          'Text became empty after cleaning, returning zero vector',
        );
        return {
          embedding: new Array(1536).fill(0),
          text: cleanText,
          model: this.EMBEDDING_MODEL,
          dimensions: 1536,
        };
      }

      const command = new InvokeModelCommand({
        modelId: this.EMBEDDING_MODEL,
        body: JSON.stringify({
          inputText: cleanText,
        }),
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const result: EmbeddingResult = {
        embedding: responseBody.embedding,
        text: cleanText,
        model: this.EMBEDDING_MODEL,
        dimensions: responseBody.embedding.length,
      };

      // Cache the result
      await this.cacheEmbedding(cacheKey, result);

      return result;
    } catch (error) {
      this.logger.error('Failed to generate embedding:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }

  /**
   * Generate embeddings for telemetry data
   */
  async generateTelemetryEmbedding(
    telemetryData: any,
  ): Promise<EmbeddingResult> {
    const semanticContent = this.createSemanticContent(telemetryData);
    return this.generateEmbedding(semanticContent);
  }

  /**
   * Create semantic content from telemetry data for embedding
   */
  private createSemanticContent(telemetry: any): string {
    const parts: string[] = [];

    // Operation context
    if (telemetry.operation_name) {
      parts.push(`Operation: ${telemetry.operation_name}`);
    }

    if (telemetry.service_name) {
      parts.push(`Service: ${telemetry.service_name}`);
    }

    // Performance context
    if (telemetry.duration_ms) {
      const durationCategory = this.categorizeDuration(telemetry.duration_ms);
      parts.push(
        `Performance: ${durationCategory} latency (${telemetry.duration_ms}ms)`,
      );
    }

    // Cost context
    if (telemetry.cost_usd) {
      const costCategory = this.categorizeCost(telemetry.cost_usd);
      parts.push(`Cost: ${costCategory} expense ($${telemetry.cost_usd})`);
    }

    // AI/GenAI context
    if (telemetry.gen_ai_model) {
      parts.push(`AI Model: ${telemetry.gen_ai_model}`);
      if (telemetry.prompt_tokens) {
        parts.push(`Input tokens: ${telemetry.prompt_tokens}`);
      }
      if (telemetry.completion_tokens) {
        parts.push(`Output tokens: ${telemetry.completion_tokens}`);
      }
    }

    // HTTP context
    if (telemetry.http_method && telemetry.http_route) {
      parts.push(`HTTP: ${telemetry.http_method} ${telemetry.http_route}`);
    }

    // Status context
    if (telemetry.status) {
      parts.push(`Status: ${telemetry.status}`);
      if (telemetry.error_message) {
        parts.push(`Error: ${telemetry.error_message}`);
      }
    }

    // Database context
    if (telemetry.db_operation) {
      parts.push(
        `Database: ${telemetry.db_operation} on ${telemetry.db_name || 'database'}`,
      );
    }

    // Time context
    if (telemetry.timestamp) {
      const timeCategory = this.categorizeTime(new Date(telemetry.timestamp));
      parts.push(`Time: ${timeCategory}`);
    }

    return parts.join('. ');
  }

  /**
   * Generate cost narrative using AI
   */
  async generateCostNarrative(telemetryData: any): Promise<string> {
    try {
      const semanticContent = this.createSemanticContent(telemetryData);

      const prompt = `Based on this telemetry data, create a concise cost narrative explaining what happened and why it cost what it did:

${semanticContent}

Provide a 1-2 sentence explanation focusing on:
1. What operation occurred
2. Why it had this cost impact
3. Any optimization opportunities

Keep it conversational and actionable.`;

      const modelId =
        process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';

      let requestBody;
      if (modelId.includes('nova')) {
        // Nova Pro format
        requestBody = JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
          inferenceConfig: {
            max_new_tokens: 150,
            temperature: 0.7,
          },
        });
      } else {
        // Claude format (fallback)
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 150,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      let responseText;
      if (modelId.includes('nova')) {
        responseText =
          responseBody.output?.message?.content?.[0]?.text ||
          responseBody.output?.text ||
          '';
      } else {
        responseText = responseBody.content?.[0]?.text || '';
      }

      return responseText;
    } catch (error) {
      this.logger.error('Failed to generate cost narrative:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return `${telemetryData.operation_name || 'Operation'} completed in ${telemetryData.duration_ms}ms${telemetryData.cost_usd ? ` costing $${telemetryData.cost_usd}` : ''}`;
    }
  }

  /**
   * Generate a grounded decision using the user's real recent usage records.
   * The LLM sees trimmed prompt/completion samples, token/cost data, and current
   * settings — so the returned headline, narrative, AND action are specific
   * to the user's workload, not template text.
   *
   * Returns both the framing and a concrete, parameterized action the apply
   * endpoint can execute (e.g. "switch /api/summarize from claude-3-opus to
   * claude-3-haiku" with a payload the apply path understands).
   */
  async generateGroundedDecision(input: {
    userId: string;
    reason: string;
    impactUsd: number;
    timeframe: 'per_day' | 'per_week' | 'per_month';
    samples: Array<{
      prompt?: string;
      completion?: string;
      model?: string;
      service?: string;
      costUsd?: number;
      promptTokens?: number;
      completionTokens?: number;
      responseTimeMs?: number;
      tags?: string[];
    }>;
    aggregate?: {
      totalCostUsd?: number;
      totalRequests?: number;
      windowDays?: number;
      topModel?: string;
      suggestedModel?: string;
      currentSettings?: Record<string, unknown>;
    };
    attribution?: Record<string, unknown>;
  }): Promise<{
    headline: string;
    narrative: string;
    action: {
      label: string;
      kind: 'apply' | 'review' | 'configure' | 'acknowledge';
      payload?: Record<string, unknown>;
    };
    confidence: number;
    reasoning?: string;
  }> {
    const dayBucket = new Date().toISOString().slice(0, 10);
    const sampleSignature = input.samples
      .slice(0, 3)
      .map((s) => `${s.model ?? ''}:${Math.round(s.costUsd ?? 0)}`)
      .join('|');
    const cacheKey = `grounded-decision:${input.userId}:${input.reason}:${dayBucket}:${Math.round(input.impactUsd)}:${sampleSignature}`;

    try {
      const cached = await this.cacheService.get<{
        headline: string;
        narrative: string;
        action: { label: string; kind: 'apply' | 'review' | 'configure' | 'acknowledge'; payload?: Record<string, unknown> };
        confidence: number;
        reasoning?: string;
      }>(cacheKey);
      if (cached) return cached;
    } catch {
      // cache miss is fine
    }

    const fallback = this.groundedDecisionFallback(input);

    try {
      const trimmedSamples = input.samples.slice(0, 5).map((s) => ({
        model: s.model,
        service: s.service,
        costUsd: Number((s.costUsd ?? 0).toFixed(4)),
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        responseTimeMs: s.responseTimeMs,
        // Keep each prompt/completion preview small — the LLM just needs
        // enough to recognize the task type, not the full text.
        promptPreview: (s.prompt || '').slice(0, 180),
        completionPreview: (s.completion || '').slice(0, 160),
        tags: (s.tags || []).slice(0, 4),
      }));

      const prompt = `You are the decision engine inside an AI-cost-optimization product. You have direct access to the user's recent usage records and aggregates. Recommend ONE concrete change the user should make, grounded in this real data — no generic advice, no placeholders.

TRIGGER: ${input.reason}
EXPECTED IMPACT: $${input.impactUsd.toFixed(2)} ${input.timeframe.replace('per_', '/')}
ATTRIBUTION: ${JSON.stringify(input.attribution || {}).slice(0, 400)}

AGGREGATE CONTEXT:
${JSON.stringify(input.aggregate || {}, null, 0).slice(0, 600)}

REAL USAGE SAMPLES (truncated previews, most recent first):
${JSON.stringify(trimmedSamples, null, 0).slice(0, 2400)}

Return STRICT JSON with this shape (no markdown fences, no preamble, no trailing prose):
{
  "headline": "<= 70 chars, imperative, includes the $ savings and timeframe. Reference the actual model/endpoint when possible. Example: \\"Route /summarize from Claude Opus → Haiku, save $142/week\\"",
  "narrative": "1-2 sentences, <= 240 chars. Explain WHY NOW using the sample data. Reference concrete observations (e.g. 'your last 47 summarization calls on Opus averaged $0.18 each'). No generic phrases.",
  "action": {
    "label": "<= 30 chars CTA. Imperative. Example: \\"Switch to Haiku for summarization\\"",
    "kind": "apply" | "review" | "configure" | "acknowledge",
    "payload": { "model": "new-model", "routeFromModel": "old-model", "scope": "endpoint-or-tag", ... }
  },
  "confidence": 0..1 reflecting how well the samples support the recommendation,
  "reasoning": "one sentence explaining the quantitative basis, cite sample counts or tokens"
}

Rules:
- Use the ACTUAL model names, services, endpoints, token counts, costs from the samples. Do not invent.
- If samples don't support a confident action, set kind=review and confidence below 0.5.
- payload.model must be a real model id from the samples or a standard downgrade target (claude-3-haiku, claude-3-sonnet, gpt-3.5-turbo, gpt-4o-mini, gemini-1.5-flash).
- The narrative must reference at least one observable number from the samples or aggregate.
`;

      const modelId =
        process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      const requestBody = modelId.includes('nova')
        ? JSON.stringify({
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            inferenceConfig: { max_new_tokens: 500, temperature: 0.3 },
          })
        : JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }],
          });

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text: string = modelId.includes('nova')
        ? responseBody.output?.message?.content?.[0]?.text ||
          responseBody.output?.text ||
          ''
        : responseBody.content?.[0]?.text || '';

      const parsed = this.parseGroundedDecisionJson(text);
      const result = parsed || fallback;

      try {
        await this.cacheService.set(cacheKey, result, 3600);
      } catch {
        // cache failure is non-fatal
      }
      return result;
    } catch (error) {
      this.logger.warn(
        'Grounded decision LLM call failed, using fallback',
        {
          error: error instanceof Error ? error.message : String(error),
          reason: input.reason,
        },
      );
      return fallback;
    }
  }

  private parseGroundedDecisionJson(raw: string): {
    headline: string;
    narrative: string;
    action: {
      label: string;
      kind: 'apply' | 'review' | 'configure' | 'acknowledge';
      payload?: Record<string, unknown>;
    };
    confidence: number;
    reasoning?: string;
  } | null {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const obj = JSON.parse(match[0]) as any;
      const validKinds = ['apply', 'review', 'configure', 'acknowledge'] as const;
      const kind = validKinds.includes(obj?.action?.kind)
        ? (obj.action.kind as typeof validKinds[number])
        : 'review';
      if (
        typeof obj.headline !== 'string' ||
        typeof obj.narrative !== 'string' ||
        typeof obj?.action?.label !== 'string'
      ) {
        return null;
      }
      return {
        headline: String(obj.headline).slice(0, 80),
        narrative: String(obj.narrative).slice(0, 260),
        action: {
          label: String(obj.action.label).slice(0, 32),
          kind,
          payload:
            typeof obj.action.payload === 'object' && obj.action.payload
              ? obj.action.payload
              : undefined,
        },
        confidence:
          typeof obj.confidence === 'number'
            ? Math.max(0, Math.min(1, obj.confidence))
            : 0.6,
        reasoning:
          typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
      };
    } catch {
      return null;
    }
  }

  private groundedDecisionFallback(input: {
    reason: string;
    impactUsd: number;
    timeframe: 'per_day' | 'per_week' | 'per_month';
    samples: Array<{
      model?: string;
      service?: string;
      costUsd?: number;
      promptTokens?: number;
      completionTokens?: number;
    }>;
    aggregate?: { topModel?: string; suggestedModel?: string };
    attribution?: Record<string, unknown>;
  }): {
    headline: string;
    narrative: string;
    action: {
      label: string;
      kind: 'apply' | 'review' | 'configure' | 'acknowledge';
      payload?: Record<string, unknown>;
    };
    confidence: number;
    reasoning?: string;
  } {
    const tf = input.timeframe.replace('per_', '/');
    const amount = `$${input.impactUsd.toFixed(2)}${tf}`;
    const topModel =
      input.aggregate?.topModel ||
      input.samples[0]?.model ||
      'your current model';
    const altModel =
      input.aggregate?.suggestedModel ||
      this.pickDowngrade(topModel) ||
      'a cheaper alternative';
    const sampleCount = input.samples.length;
    const avgCost = sampleCount
      ? input.samples.reduce((s, x) => s + (x.costUsd || 0), 0) / sampleCount
      : 0;

    // Reason-specific fallback is still grounded in actual sample counts/costs.
    switch (input.reason) {
      case 'model_overspend':
        return {
          headline: `Route high-cost tasks from ${topModel} → ${altModel}, save ${amount}`,
          narrative: `Your last ${sampleCount} calls on ${topModel} averaged $${avgCost.toFixed(
            3,
          )} each. Routing similar tasks to ${altModel} recovers ${amount}.`,
          action: {
            label: `Switch to ${altModel}`,
            kind: 'apply',
            payload: {
              routeFromModel: topModel,
              model: altModel,
              scope: 'similar-tasks',
            },
          },
          confidence: 0.7,
          reasoning: `Based on ${sampleCount} recent usage samples averaging $${avgCost.toFixed(3)} on ${topModel}.`,
        };
      case 'caching_opportunity':
        return {
          headline: `Enable semantic cache on repeated prompts, save ${amount}`,
          narrative: `We detected ${sampleCount} near-duplicate prompts in recent usage at an average $${avgCost.toFixed(
            3,
          )}/request. Caching recovers ${amount}.`,
          action: {
            label: 'Turn on semantic cache',
            kind: 'configure',
            payload: { feature: 'semantic_cache', enabled: true },
          },
          confidence: 0.65,
          reasoning: `Observed ${sampleCount} repeated-pattern prompts.`,
        };
      case 'compression_opportunity':
        return {
          headline: `Compress long prompts via Cortex, save ${amount}`,
          narrative: `Long-context calls dominate your recent spend (${sampleCount} samples, avg $${avgCost.toFixed(
            3,
          )}). Enabling compression recovers ${amount}.`,
          action: {
            label: 'Enable Cortex compression',
            kind: 'configure',
            payload: { feature: 'cortex_compression', enabled: true },
          },
          confidence: 0.65,
          reasoning: `Inferred from prompt token distribution across ${sampleCount} samples.`,
        };
      case 'cost_spike':
        return {
          headline: `Investigate ${topModel} spike — recover ${amount}`,
          narrative: `Spend on ${topModel} jumped recently; ${sampleCount} sampled requests averaged $${avgCost.toFixed(
            3,
          )}. Reviewing callers recovers ${amount}.`,
          action: {
            label: 'Review spike',
            kind: 'review',
            payload: { scope: 'cost-spike', model: topModel },
          },
          confidence: 0.55,
          reasoning: `Flagged from anomaly detection on ${topModel}.`,
        };
      case 'budget_pacing':
        return {
          headline: `Budget pace alert — trim ${topModel} to save ${amount}`,
          narrative: `At current burn rate you'll exhaust budget early. ${topModel} drives the spend (avg $${avgCost.toFixed(
            3,
          )}/req). Reviewing now recovers ${amount}.`,
          action: {
            label: 'Review top spender',
            kind: 'review',
            payload: { scope: 'budget-pacing', model: topModel },
          },
          confidence: 0.75,
          reasoning: `Derived from 7-day burn projection.`,
        };
      default:
        return {
          headline: `Optimization available — save ${amount}`,
          narrative: `Based on ${sampleCount} recent samples (avg $${avgCost.toFixed(
            3,
          )}/req), one change recovers ${amount}.`,
          action: {
            label: 'Review',
            kind: 'review',
            payload: {},
          },
          confidence: 0.5,
          reasoning: `Generic fallback from ${sampleCount} samples.`,
        };
    }
  }

  private pickDowngrade(model: string | undefined): string | null {
    if (!model) return null;
    const m = model.toLowerCase();
    if (m.includes('opus')) return 'claude-3-sonnet';
    if (m.includes('sonnet')) return 'claude-3-haiku';
    if (m.includes('gpt-4o') && !m.includes('mini')) return 'gpt-4o-mini';
    if (m.includes('gpt-4')) return 'gpt-3.5-turbo';
    if (m.includes('gemini-1.5-pro')) return 'gemini-1.5-flash';
    return null;
  }

  /**
   * Legacy narrative-only generator. New call sites should use
   * generateGroundedDecision for a specific action + grounded reasoning.
   * Kept for backward compat so existing callers don't break.
   */
  async generateDecisionNarrative(input: {
    userId: string;
    reason: string;
    evidence: Record<string, unknown>;
    impactUsd: number;
    timeframe: 'per_day' | 'per_week' | 'per_month';
    attribution?: Record<string, unknown>;
  }): Promise<{ headline: string; narrative: string }> {
    const dayBucket = new Date().toISOString().slice(0, 10);
    const cacheKey = `decision-narrative:${input.userId}:${input.reason}:${dayBucket}:${Math.round(input.impactUsd)}`;

    try {
      const cached = await this.cacheService.get<{
        headline: string;
        narrative: string;
      }>(cacheKey);
      if (cached) return cached;
    } catch {
      // cache miss is fine
    }

    const fallback = this.decisionNarrativeFallback(input);

    try {
      const prompt = `You are writing a cost-optimization decision card for an AI ops product.
Trigger: ${input.reason}
Evidence: ${JSON.stringify(input.evidence).slice(0, 900)}
Expected impact: $${input.impactUsd.toFixed(2)} ${input.timeframe.replace('per_', '/')}
Attribution: ${JSON.stringify(input.attribution || {}).slice(0, 300)}

Write a JSON object with exactly two keys: "headline" and "narrative".
- "headline": <= 70 characters, imperative, includes the savings and timeframe. Example: "Switch Claude Opus → Sonnet, save $142/week".
- "narrative": 1-2 sentences, <= 220 characters, explains WHY NOW (spike, new team, recent deploy, budget pace). No generic phrases. No markdown. No preamble.
Return ONLY the JSON object.`;

      const modelId =
        process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      const requestBody = modelId.includes('nova')
        ? JSON.stringify({
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            inferenceConfig: { max_new_tokens: 220, temperature: 0.4 },
          })
        : JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 220,
            messages: [{ role: 'user', content: prompt }],
          });

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text: string = modelId.includes('nova')
        ? responseBody.output?.message?.content?.[0]?.text ||
          responseBody.output?.text ||
          ''
        : responseBody.content?.[0]?.text || '';

      const parsed = this.parseDecisionJson(text);
      const result = parsed || fallback;

      try {
        await this.cacheService.set(cacheKey, result, 3600);
      } catch {
        // cache failure is non-fatal
      }
      return result;
    } catch (error) {
      this.logger.warn('Decision narrative LLM call failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        reason: input.reason,
      });
      return fallback;
    }
  }

  private parseDecisionJson(
    raw: string,
  ): { headline: string; narrative: string } | null {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const obj = JSON.parse(match[0]) as Partial<{
        headline: string;
        narrative: string;
      }>;
      if (
        typeof obj.headline === 'string' &&
        obj.headline.length > 0 &&
        typeof obj.narrative === 'string' &&
        obj.narrative.length > 0
      ) {
        return {
          headline: obj.headline.slice(0, 70),
          narrative: obj.narrative.slice(0, 240),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private decisionNarrativeFallback(input: {
    reason: string;
    impactUsd: number;
    timeframe: 'per_day' | 'per_week' | 'per_month';
    evidence: Record<string, unknown>;
    attribution?: Record<string, unknown>;
  }): { headline: string; narrative: string } {
    const tf = input.timeframe.replace('per_', '/');
    const amount = `$${input.impactUsd.toFixed(2)}${tf}`;
    const model =
      (input.attribution?.model as string | undefined) ||
      (input.evidence?.currentModel as string | undefined) ||
      'current model';
    const alt =
      (input.evidence?.suggestedModel as string | undefined) ||
      'a cheaper alternative';

    switch (input.reason) {
      case 'cost_spike': {
        const pct = (input.evidence?.pctChange as number) || 0;
        const top = (input.evidence?.topContributor as string) || model;
        return {
          headline: `Cost spike detected — review ${top} to recover ${amount}`,
          narrative: `Spend jumped ${pct.toFixed(0)}% vs the previous window. ${top} drove the increase. Acting now recovers ${amount}.`,
        };
      }
      case 'budget_pacing': {
        const projectedHit =
          (input.evidence?.projectedHitDate as string) || 'end of period';
        return {
          headline: `Budget pace warning — save ${amount}`,
          narrative: `At the current burn rate you'll blow budget by ${projectedHit}. Trim the top offender to recover ${amount}.`,
        };
      }
      case 'model_overspend': {
        return {
          headline: `Switch ${model} → ${alt}, save ${amount}`,
          narrative: `You're routing heavy volume through ${model} for tasks ${alt} handles with minimal quality delta. Saves ${amount}.`,
        };
      }
      case 'caching_opportunity': {
        return {
          headline: `Enable semantic cache, save ${amount}`,
          narrative: `Repeated similar prompts are paying full inference cost. Turning on the semantic cache recovers ${amount}.`,
        };
      }
      case 'compression_opportunity': {
        return {
          headline: `Compress context window, save ${amount}`,
          narrative: `Long prompts are inflating token spend. Enabling context compression recovers ${amount}.`,
        };
      }
      case 'summarization_opportunity': {
        return {
          headline: `Lazy-summarize long threads, save ${amount}`,
          narrative: `Multi-turn threads are re-sending full history. Lazy summarization recovers ${amount}.`,
        };
      }
      case 'new_team_activity': {
        const team = (input.attribution?.team as string) || 'a team';
        return {
          headline: `New ${team} activity — review ${amount} impact`,
          narrative: `${team} started driving unusual cost in the last 24h. Reviewing now prevents ${amount} of additional spend.`,
        };
      }
      default:
        return {
          headline: `Optimization available — save ${amount}`,
          narrative: `A recent usage pattern suggests you can recover ${amount} with one change.`,
        };
    }
  }

  /**
   * Clean text for embedding
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-\.\$]/g, '')
      .trim()
      .substring(0, 8000); // Titan has input limits
  }

  /**
   * Categorize duration for semantic understanding
   */
  private categorizeDuration(ms: number): string {
    if (ms < 100) return 'very fast';
    if (ms < 500) return 'fast';
    if (ms < 2000) return 'moderate';
    if (ms < 10000) return 'slow';
    return 'very slow';
  }

  /**
   * Categorize cost for semantic understanding
   */
  private categorizeCost(usd: number): string {
    if (usd < 0.001) return 'minimal';
    if (usd < 0.01) return 'low';
    if (usd < 0.1) return 'moderate';
    if (usd < 1.0) return 'high';
    return 'very high';
  }

  /**
   * Categorize time for semantic understanding
   */
  private categorizeTime(date: Date): string {
    const hour = date.getHours();
    if (hour < 6) return 'early morning';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  /**
   * Cache embedding result
   */
  private async cacheEmbedding(
    key: string,
    embedding: EmbeddingResult,
  ): Promise<void> {
    try {
      await this.cacheService.set(key, embedding, this.CACHE_TTL);
    } catch (error) {
      this.logger.warn('Failed to cache embedding:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cached embedding
   */
  private async getCachedEmbedding(
    key: string,
  ): Promise<EmbeddingResult | null> {
    try {
      const cached = await this.cacheService.get<EmbeddingResult>(key);
      return cached;
    } catch (error) {
      this.logger.warn('Failed to get cached embedding:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
