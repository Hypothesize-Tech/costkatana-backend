import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';

export interface EmbeddingResult {
  embedding: number[];
  text: string;
  model: string;
  dimensions: number;
}

export class EmbeddingsService {
  private static instance: EmbeddingsService;
  private bedrockClient: BedrockRuntimeClient;
  private readonly EMBEDDING_MODEL = 'amazon.titan-embed-text-v1';
  private readonly CACHE_TTL = 3600; // 1 hour cache for embeddings

  private constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  static getInstance(): EmbeddingsService {
    if (!EmbeddingsService.instance) {
      EmbeddingsService.instance = new EmbeddingsService();
    }
    return EmbeddingsService.instance;
  }

  /**
   * Generate embeddings for text using AWS Bedrock Titan
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      // Validate input - AWS Bedrock requires minLength: 1
      if (!text || text.trim().length === 0) {
        loggingService.warn('Empty text provided to generateEmbedding, returning zero vector');
        return {
          embedding: new Array(1536).fill(0),
          text: '',
          model: this.EMBEDDING_MODEL,
          dimensions: 1536
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
        loggingService.warn('Text became empty after cleaning, returning zero vector');
        return {
          embedding: new Array(1536).fill(0),
          text: cleanText,
          model: this.EMBEDDING_MODEL,
          dimensions: 1536
        };
      }
      
      const command = new InvokeModelCommand({
        modelId: this.EMBEDDING_MODEL,
        body: JSON.stringify({
          inputText: cleanText
        }),
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const result: EmbeddingResult = {
        embedding: responseBody.embedding,
        text: cleanText,
        model: this.EMBEDDING_MODEL,
        dimensions: responseBody.embedding.length
      };

      // Cache the result
      await this.cacheEmbedding(cacheKey, result);

      return result;
    } catch (error) {
      loggingService.error('Failed to generate embedding:', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }

  /**
   * Generate embeddings for telemetry data
   */
  async generateTelemetryEmbedding(telemetryData: any): Promise<EmbeddingResult> {
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
      parts.push(`Performance: ${durationCategory} latency (${telemetry.duration_ms}ms)`);
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
      parts.push(`Database: ${telemetry.db_operation} on ${telemetry.db_name || 'database'}`);
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

      const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      
      let requestBody;
      if (modelId.includes('nova')) {
        // Nova Pro format
        requestBody = JSON.stringify({
          messages: [{
            role: 'user',
            content: [{ text: prompt }]
          }],
          inferenceConfig: {
            max_new_tokens: 150,
            temperature: 0.7
          }
        });
      } else {
        // Claude format (fallback)
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      let responseText;
      if (modelId.includes('nova')) {
        // Nova Pro response format
        responseText = responseBody.output?.message?.content?.[0]?.text || responseBody.output?.text || '';
      } else {
        // Claude response format
        responseText = responseBody.content?.[0]?.text || '';
      }
      
      return responseText;
    } catch (error) {
      loggingService.error('Failed to generate cost narrative:', { error: error instanceof Error ? error.message : String(error) });
      return `${telemetryData.operation_name || 'Operation'} completed in ${telemetryData.duration_ms}ms${telemetryData.cost_usd ? ` costing $${telemetryData.cost_usd}` : ''}`;
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
  private async cacheEmbedding(key: string, embedding: EmbeddingResult): Promise<void> {
    try {
      await redisService.client.setEx(key, this.CACHE_TTL, JSON.stringify(embedding));
    } catch (error) {
      loggingService.warn('Failed to cache embedding:', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Get cached embedding
   */
  private async getCachedEmbedding(key: string): Promise<EmbeddingResult | null> {
    try {
      const cached = await redisService.client.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      loggingService.warn('Failed to get cached embedding:', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}

export const embeddingsService = EmbeddingsService.getInstance();


