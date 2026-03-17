/**
 * AI Router Service
 *
 * Routes AI model invocations to appropriate providers based on model availability,
 * cost optimization, and performance requirements. Handles AWS Bedrock integration
 * and provider failover strategies.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  PricingService,
  ModelPricing,
} from '../../utils/services/pricing.service';
import { TokenCounterService } from '../../utils/services/token-counter.service';
import { getMaxTokensForModel } from '../../../utils/model-tokens';

export interface ModelInvocationRequest {
  model: string;
  prompt: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
  metadata?: {
    userId?: string;
    requestId?: string;
    costPriority?: 'lowest' | 'balanced' | 'highest';
    speedPriority?: 'fastest' | 'balanced' | 'quality';
    operation?: string;
    cost?: number;
    responseTime?: number;
  };
}

export interface ModelInvocationResult {
  model: string;
  response: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: number;
  latency: number;
  metadata: {
    provider: string;
    modelVersion: string;
    requestId: string;
    timestamp: Date;
  };
}

export interface ModelRoute {
  model: string;
  provider: string;
  region: string;
  priority: number;
  isActive: boolean;
  lastHealthCheck: Date;
  healthScore: number;
}

@Injectable()
export class AIRouterService {
  private readonly logger = new Logger(AIRouterService.name);
  private readonly bedrockClients = new Map<string, BedrockRuntimeClient>();
  private readonly modelRoutes: ModelRoute[] = [];
  private readonly stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalLatency: 0,
    totalCost: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(
    private readonly pricingService: PricingService,
    private readonly tokenCounterService: TokenCounterService,
  ) {
    this.initializeBedrockClients();
    this.initializeModelRoutes();
  }

  /**
   * Invoke an AI model with automatic routing and optimization
   */
  async invokeModel(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    // Normalise model IDs that require inference profiles so they match registered routes
    request = { ...request, model: this.normaliseModelId(request.model) };

    try {
      // Find optimal route for the model
      let route = await this.findOptimalRoute(request);
      if (!route) {
        // Fallback: try any registered route for this model (e.g. inactive after failed health check)
        route = this.findRouteByModel(request.model);
        if (!route) {
          throw new Error(`No available route for model: ${request.model}`);
        }
        this.logger.debug(
          `Using fallback route for model: ${request.model} (was inactive)`,
        );
      }

      const result = await this.invokeModelWithRouteAndReturnResult(
        request,
        route,
        startTime,
      );

      // Update statistics
      this.stats.successfulRequests++;
      this.stats.totalLatency += result.latency;
      this.stats.totalCost += result.cost;

      this.logger.log(
        `Model invocation completed: ${request.model} (${result.latency}ms, $${result.cost.toFixed(4)})`,
      );
      return result;
    } catch (error) {
      this.stats.failedRequests++;
      this.logger.error(`Model invocation failed: ${request.model}`, error);
      throw error;
    }
  }

  /**
   * Find a route by model id only (active or inactive). Used for fallback when no active route.
   */
  private findRouteByModel(model: string): ModelRoute | null {
    const route = this.modelRoutes.find((r) => r.model === model);
    return route ?? null;
  }

  /**
   * Invoke using a specific route and return full result. On success, reactivates inactive routes.
   */
  private async invokeModelWithRouteAndReturnResult(
    request: ModelInvocationRequest,
    route: ModelRoute,
    startTime: number,
  ): Promise<ModelInvocationResult> {
    const invokeRequest = this.prepareInvokeRequest(request, route);
    const response = await this.invokeBedrockModel(invokeRequest, route);
    const parsedResponse = this.parseBedrockResponse(response, route);

    const usage = await this.calculateUsage(
      request.prompt,
      parsedResponse.response,
    );
    const cost = this.pricingService.estimateCost(
      request.model,
      usage.inputTokens,
      usage.outputTokens,
    );

    if (!route.isActive) {
      route.healthScore = Math.min(1.0, route.healthScore + 0.2);
      route.isActive = true;
      this.logger.debug(`Reactivated route for model: ${route.model}`);
    }

    return {
      model: request.model,
      response: parsedResponse.response,
      usage,
      cost: cost?.totalCost || 0,
      latency: Date.now() - startTime,
      metadata: {
        provider: route.provider,
        modelVersion: this.extractModelVersion(request.model),
        requestId: request.metadata?.requestId || this.generateRequestId(),
        timestamp: new Date(),
      },
    };
  }

  /**
   * Batch invoke multiple models for comparison or failover
   */
  async invokeModelBatch(
    requests: ModelInvocationRequest[],
    strategy: 'parallel' | 'sequential' | 'failover' = 'parallel',
  ): Promise<ModelInvocationResult[]> {
    switch (strategy) {
      case 'parallel':
        return await this.invokeParallel(requests);
      case 'sequential':
        return await this.invokeSequential(requests);
      case 'failover':
        return await this.invokeWithFailover(requests);
      default:
        return await this.invokeParallel(requests);
    }
  }

  /**
   * Get available models with routing information
   */
  async getAvailableModels(): Promise<ModelRoute[]> {
    // Update health status before returning
    await this.updateRouteHealth();

    return this.modelRoutes.filter((route) => route.isActive);
  }

  /**
   * Check model availability and health
   */
  async checkModelHealth(model: string): Promise<{
    available: boolean;
    latency: number;
    cost: number;
    healthScore: number;
  }> {
    const route = this.modelRoutes.find((r) => r.model === model);
    if (!route) {
      return { available: false, latency: 0, cost: 0, healthScore: 0 };
    }

    const healthCheck = await this.performHealthCheck(route);
    return {
      available: healthCheck.available,
      latency: healthCheck.latency,
      cost: this.pricingService.estimateCost(model, 10, 10)?.totalCost || 0,
      healthScore: route.healthScore,
    };
  }

  /**
   * Get routing statistics
   */
  getRoutingStats(): {
    totalRoutes: number;
    activeRoutes: number;
    totalInvocations: number;
    averageLatency: number;
    totalCost: number;
    routeDistribution: Record<string, number>;
    successRate: number;
    errorRate: number;
    cacheHitRate: number;
  } {
    const activeRoutes = this.modelRoutes.filter((r) => r.isActive).length;
    const routeDistribution = this.modelRoutes.reduce(
      (acc, route) => {
        acc[route.provider] =
          (acc[route.provider] || 0) + (route.isActive ? 1 : 0);
        return acc;
      },
      {} as Record<string, number>,
    );

    // Calculate success/error rates
    const totalRequests = this.stats.totalRequests;
    const successRate =
      totalRequests > 0
        ? (this.stats.successfulRequests / totalRequests) * 100
        : 0;
    const errorRate =
      totalRequests > 0 ? (this.stats.failedRequests / totalRequests) * 100 : 0;

    // Calculate cache hit rate
    const cacheRequests = this.stats.cacheHits + this.stats.cacheMisses;
    const cacheHitRate =
      cacheRequests > 0 ? (this.stats.cacheHits / cacheRequests) * 100 : 0;

    return {
      totalRoutes: this.modelRoutes.length,
      activeRoutes,
      totalInvocations: this.stats.totalRequests,
      averageLatency:
        this.stats.totalRequests > 0
          ? this.stats.totalLatency / this.stats.totalRequests
          : 0,
      totalCost: this.stats.totalCost,
      routeDistribution,
      successRate,
      errorRate,
      cacheHitRate,
    };
  }

  // Private methods

  private initializeBedrockClients(): void {
    // Initialize Bedrock clients for different regions
    const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

    for (const region of regions) {
      try {
        this.bedrockClients.set(
          region,
          new BedrockRuntimeClient({
            region,
            // Credentials would be configured via environment variables or AWS config
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
          }),
        );
        this.logger.debug(`Bedrock client initialized for region: ${region}`);
      } catch (error) {
        this.logger.warn(
          `Failed to initialize Bedrock client for region ${region}`,
          error,
        );
      }
    }
  }

  private initializeModelRoutes(): void {
    // Initialize available model routes with comprehensive model support
    this.modelRoutes.push(
      // Anthropic Claude models (active, non-legacy)
      {
        model: 'us.anthropic.claude-sonnet-4-6',
        provider: 'anthropic',
        region: 'us-east-1',
        priority: 1,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 1.0,
      },
      {
        model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        provider: 'anthropic',
        region: 'us-east-1',
        priority: 2,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.98,
      },
      {
        model: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        provider: 'anthropic',
        region: 'us-east-1',
        priority: 2,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.95,
      },
      {
        model: 'anthropic.claude-3-haiku-20240307-v1:0',
        provider: 'anthropic',
        region: 'us-east-1',
        priority: 2,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.9,
      },
      {
        model: 'anthropic.claude-3-sonnet-20240229-v1:0',
        provider: 'anthropic',
        region: 'us-west-2',
        priority: 1,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.92,
      },
      {
        model: 'mistral.mistral-large-3-675b-instruct',
        provider: 'mistral',
        region: 'us-east-1',
        priority: 2,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.9,
      },

      // Meta Llama models
      {
        model: 'meta.llama2-13b-chat-v1',
        provider: 'meta',
        region: 'us-east-1',
        priority: 3,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.8,
      },
      {
        model: 'meta.llama2-70b-chat-v1',
        provider: 'meta',
        region: 'us-west-2',
        priority: 2,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.85,
      },

      // AI21 Labs Jurassic models
      {
        model: 'ai21.j2-ultra-v1',
        provider: 'ai21',
        region: 'us-east-1',
        priority: 3,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.75,
      },
      {
        model: 'ai21.j2-mid-v1',
        provider: 'ai21',
        region: 'us-east-1',
        priority: 4,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.7,
      },

      // Amazon Nova models (used by AutonomousDetector, chat, etc.)
      {
        model: 'amazon.nova-lite-v1:0',
        provider: 'amazon',
        region: 'us-east-1',
        priority: 2,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.9,
      },
      {
        model: 'amazon.nova-pro-v1:0',
        provider: 'amazon',
        region: 'us-east-1',
        priority: 1,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.95,
      },
      {
        model: 'amazon.nova-micro-v1:0',
        provider: 'amazon',
        region: 'us-east-1',
        priority: 3,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.85,
      },

      // Cohere Command models
      {
        model: 'cohere.command-text-v14',
        provider: 'cohere',
        region: 'us-east-1',
        priority: 3,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.78,
      },
      {
        model: 'cohere.command-light-text-v14',
        provider: 'cohere',
        region: 'us-east-1',
        priority: 4,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.72,
      },

      // Stability AI SDXL
      {
        model: 'stability.stable-diffusion-xl-v1',
        provider: 'stability',
        region: 'us-east-1',
        priority: 5,
        isActive: true,
        lastHealthCheck: new Date(),
        healthScore: 0.65,
      },
    );

    this.logger.log(`Initialized ${this.modelRoutes.length} model routes`);
  }

  private async findOptimalRoute(
    request: ModelInvocationRequest,
  ): Promise<ModelRoute | null> {
    const availableRoutes = this.modelRoutes.filter(
      (route) => route.model === request.model && route.isActive,
    );

    if (availableRoutes.length === 0) {
      return null;
    }

    // Sort by priority and health score
    availableRoutes.sort((a, b) => {
      // Primary sort by priority (lower number = higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Secondary sort by health score
      return b.healthScore - a.healthScore;
    });

    return availableRoutes[0];
  }

  private prepareInvokeRequest(
    request: ModelInvocationRequest,
    route: ModelRoute,
  ): any {
    // Prepare request based on model provider and specific model requirements
    const baseParams = {
      temperature: request.parameters?.temperature ?? 0.7,
      max_tokens:
        request.parameters?.maxTokens || getMaxTokensForModel(request.model),
      top_p: request.parameters?.topP ?? 1,
      top_k: request.parameters?.topK ?? 250,
      stop_sequences: request.parameters?.stopSequences || [],
    };

    // Provider-specific request formatting
    switch (route.provider) {
      case 'anthropic':
        // Claude 3.5+, Haiku 4.5, Sonnet 4.5/4.6 require Messages API (not legacy text completion)
        if (this.requiresMessagesApi(request.model)) {
          const temp = baseParams.temperature ?? 0.7;
          const body: Record<string, unknown> = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: baseParams.max_tokens,
            messages: [
              {
                role: 'user',
                content: [{ type: 'text', text: request.prompt }],
              },
            ],
          };
          if (typeof temp === 'number' && temp >= 0 && temp <= 1) {
            body.temperature = temp;
          }
          return {
            modelId: request.model,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(body),
          };
        }
        // Legacy Claude models (e.g. claude-3-haiku-20240307)
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            prompt: this.formatAnthropicPrompt(request.prompt),
            ...baseParams,
            max_tokens_to_sample: baseParams.max_tokens,
            max_tokens: undefined,
            top_k: undefined,
          }),
        };

      case 'meta':
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            prompt: request.prompt,
            ...baseParams,
            max_gen_len: baseParams.max_tokens,
          }),
        };

      case 'ai21':
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            prompt: request.prompt,
            ...baseParams,
            maxTokens: baseParams.max_tokens,
            temperature: baseParams.temperature,
            topP: baseParams.top_p,
            stopSequences: baseParams.stop_sequences,
          }),
        };

      case 'cohere':
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            prompt: request.prompt,
            ...baseParams,
            max_tokens: baseParams.max_tokens,
            temperature: baseParams.temperature,
            p: baseParams.top_p,
            k: baseParams.top_k,
            stop_sequences: baseParams.stop_sequences,
          }),
        };

      case 'amazon': {
        // Amazon Nova (Bedrock): topK 1-128, topP 0-1, inferenceConfig uses maxTokens (not max_new_tokens)
        const novaTopK = Math.min(
          128,
          Math.max(1, request.parameters?.topK ?? 50),
        );
        const novaTopP = Math.min(
          1,
          Math.max(0.01, request.parameters?.topP ?? 0.9),
        );
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            schemaVersion: 'messages-v1',
            messages: [
              {
                role: 'user',
                content: [{ text: request.prompt }],
              },
            ],
            inferenceConfig: {
              maxTokens: baseParams.max_tokens,
              temperature: baseParams.temperature,
              topP: novaTopP,
              topK: novaTopK,
            },
          }),
        };
      }

      case 'stability':
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            text_prompts: [{ text: request.prompt }],
            cfg_scale: 7,
            height: 512,
            width: 512,
            steps: 50,
            seed: Math.floor(Math.random() * 1000000),
          }),
        };

      case 'mistral':
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            messages: [{ role: 'user', content: request.prompt }],
            max_tokens: baseParams.max_tokens,
            temperature: baseParams.temperature,
            top_p: baseParams.top_p,
          }),
        };

      default:
        // Generic format for unknown providers
        return {
          modelId: request.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            prompt: request.prompt,
            ...baseParams,
          }),
        };
    }
  }

  /**
   * Maps bare Bedrock model IDs to their required cross-region inference profile IDs.
   * Models like claude-sonnet-4-6 cannot be called on-demand; they need a `us.` / `global.` prefix.
   */
  private normaliseModelId(modelId: string): string {
    const INFERENCE_PROFILE_MAP: Record<string, string> = {
      'anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
      'anthropic.claude-sonnet-4-6-v1:0': 'us.anthropic.claude-sonnet-4-6',
      'anthropic.claude-sonnet-4-5-20250929-v1:0':
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'anthropic.claude-opus-4-6-v1': 'us.anthropic.claude-opus-4-6-v1',
      'anthropic.claude-3-5-haiku-20241022-v1:0':
        'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    };
    return INFERENCE_PROFILE_MAP[modelId] ?? modelId;
  }

  /**
   * Models that require Messages API (Claude 3.5+, Claude 4.x). Legacy text completion is deprecated.
   */
  private requiresMessagesApi(modelId: string): boolean {
    const id = modelId.toLowerCase();
    return (
      id.includes('claude-3-5') ||
      id.includes('claude-haiku-4-5') ||
      id.includes('claude-sonnet-4-5') ||
      id.includes('claude-sonnet-4-6') ||
      id.includes('claude-opus-4') ||
      id.includes('claude-sonnet-4-2025')
    );
  }

  private formatAnthropicPrompt(prompt: string): string {
    // Anthropic Claude legacy format
    return `\n\nHuman: ${prompt}\n\nAssistant:`;
  }

  private async invokeBedrockModel(
    request: any,
    route: ModelRoute,
  ): Promise<any> {
    const client = this.bedrockClients.get(route.region);
    if (!client) {
      throw new Error(
        `No Bedrock client available for region: ${route.region}`,
      );
    }

    const command = new InvokeModelCommand(request);
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Invoking Bedrock model: ${route.model} in region: ${route.region}`,
      );
      const response = await client.send(command);
      const latency = Date.now() - startTime;

      this.logger.debug(
        `Bedrock invocation successful: ${route.model} (${latency}ms)`,
      );
      return response;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error(
        `Bedrock invocation failed for ${route.model} (${latency}ms)`,
        error,
      );

      // Update route health on failure
      this.updateRouteHealthOnFailure(route);

      throw error;
    }
  }

  private parseBedrockResponse(
    response: any,
    route: ModelRoute,
  ): { response: string } {
    // Parse response based on model provider
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    switch (route.provider) {
      case 'anthropic':
        // Anthropic Claude response format
        if (responseBody.completion) {
          return { response: responseBody.completion };
        } else if (
          responseBody.content &&
          Array.isArray(responseBody.content)
        ) {
          // Claude 3 format
          return {
            response: responseBody.content.map((c: any) => c.text).join(''),
          };
        }
        break;

      case 'meta':
        // Meta Llama response format
        return {
          response: responseBody.generation || responseBody.response || '',
        };

      case 'ai21':
        // AI21 Labs Jurassic response format
        if (responseBody.completions && responseBody.completions.length > 0) {
          return { response: responseBody.completions[0].data.text };
        }
        break;

      case 'cohere':
        // Cohere Command response format
        if (responseBody.generations && responseBody.generations.length > 0) {
          return { response: responseBody.generations[0].text };
        }
        break;

      case 'amazon':
        // Amazon Nova response format
        if (
          responseBody.output?.message?.content &&
          Array.isArray(responseBody.output.message.content) &&
          responseBody.output.message.content.length > 0
        ) {
          const textContent = responseBody.output.message.content[0];
          const text =
            typeof textContent === 'string'
              ? textContent
              : (textContent?.text ?? '');
          return { response: text };
        }
        break;

      case 'stability':
        // Stability AI response format (base64 encoded image)
        if (responseBody.artifacts && responseBody.artifacts.length > 0) {
          return { response: responseBody.artifacts[0].base64 };
        }
        break;

      case 'mistral':
        if (
          responseBody.choices &&
          Array.isArray(responseBody.choices) &&
          responseBody.choices.length > 0 &&
          responseBody.choices[0].message?.content
        ) {
          return {
            response: responseBody.choices[0].message.content,
          };
        }
        break;
    }

    // Default response format
    return {
      response:
        responseBody.response ||
        responseBody.text ||
        responseBody.generation ||
        '',
    };
  }

  private async calculateUsage(
    inputPrompt: string,
    outputResponse: string,
  ): Promise<ModelInvocationResult['usage']> {
    const inputTokens =
      await this.tokenCounterService.estimateTokensAsync(inputPrompt);
    const outputTokens =
      await this.tokenCounterService.estimateTokensAsync(outputResponse);

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  private extractModelVersion(model: string): string {
    // Extract version from model string
    const parts = model.split('-');
    return parts[parts.length - 1] || 'unknown';
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Invoke a model using a specific route (bypasses findOptimalRoute).
   * Used by health checks so inactive routes can be re-validated.
   */
  private async invokeModelWithRoute(
    request: ModelInvocationRequest,
    route: ModelRoute,
  ): Promise<void> {
    const invokeRequest = this.prepareInvokeRequest(request, route);
    const response = await this.invokeBedrockModel(invokeRequest, route);
    this.parseBedrockResponse(response, route);
  }

  private async performHealthCheck(
    route: ModelRoute,
  ): Promise<{ available: boolean; latency: number }> {
    const startTime = Date.now();

    try {
      const testRequest: ModelInvocationRequest = {
        model: route.model,
        prompt: 'Hello',
        parameters: { maxTokens: 10, temperature: 0 },
      };

      await this.invokeModelWithRoute(testRequest, route);
      const latency = Date.now() - startTime;

      return { available: true, latency };
    } catch (error) {
      this.logger.error(`Health check failed for ${route.model}:`, error);
      return { available: false, latency: Date.now() - startTime };
    }
  }

  private updateRouteHealthOnFailure(route: ModelRoute): void {
    // Reduce health score on failure
    route.healthScore = Math.max(0, route.healthScore - 0.1);

    // Deactivate route if health score is too low
    if (route.healthScore < 0.3) {
      route.isActive = false;
      this.logger.warn(
        `Deactivated route for model ${route.model} due to low health score: ${route.healthScore}`,
      );
    }

    route.lastHealthCheck = new Date();
  }

  private async updateRouteHealth(): Promise<void> {
    // Update health status for all routes
    for (const route of this.modelRoutes) {
      if (Date.now() - route.lastHealthCheck.getTime() > 300000) {
        // 5 minutes
        const healthCheck = await this.performHealthCheck(route);
        route.healthScore = healthCheck.available
          ? Math.min(1.0, route.healthScore + 0.1)
          : Math.max(0, route.healthScore - 0.2);
        route.isActive = healthCheck.available && route.healthScore > 0.3;
        route.lastHealthCheck = new Date();
      }
    }
  }

  private async invokeParallel(
    requests: ModelInvocationRequest[],
  ): Promise<ModelInvocationResult[]> {
    const promises = requests.map((request) => this.invokeModel(request));
    return await Promise.all(promises);
  }

  private async invokeSequential(
    requests: ModelInvocationRequest[],
  ): Promise<ModelInvocationResult[]> {
    const results: ModelInvocationResult[] = [];

    for (const request of requests) {
      const result = await this.invokeModel(request);
      results.push(result);
    }

    return results;
  }

  private async invokeWithFailover(
    requests: ModelInvocationRequest[],
  ): Promise<ModelInvocationResult[]> {
    // Implement failover logic - try primary, then fallbacks
    const results: ModelInvocationResult[] = [];

    for (const request of requests) {
      try {
        const result = await this.invokeModel(request);
        results.push(result);
      } catch (error) {
        this.logger.warn(
          `Primary invocation failed for ${request.model}, attempting failover`,
        );

        // Try alternative models if available
        const alternativeResult = await this.tryFailoverInvocation(request);
        if (alternativeResult) {
          results.push(alternativeResult);
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  private async tryFailoverInvocation(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult | null> {
    // Find alternative models with similar capabilities
    const alternatives = await this.findAlternativeModels(request.model);

    for (const altModel of alternatives) {
      try {
        const altRequest = { ...request, model: altModel };
        return await this.invokeModel(altRequest);
      } catch (error) {
        this.logger.warn(`Failover to ${altModel} also failed`);
        continue;
      }
    }

    return null;
  }

  private async findAlternativeModels(model: string): Promise<string[]> {
    try {
      // Get pricing information for the current model
      const currentPricing = this.pricingService.getModelPricing(model);
      if (!currentPricing) {
        this.logger.warn(`No pricing information found for model: ${model}`);
        return this.getFallbackAlternatives(model);
      }

      const alternatives: Array<{
        model: string;
        score: number;
        reason: string;
      }> = [];

      // Find alternatives in the same tier first (prefer exact tier matches)
      const sameTierModels = this.pricingService
        .getModelsByTier(currentPricing.tier)
        .filter((p) => p.model !== model && p.active);

      for (const altPricing of sameTierModels) {
        const score = this.calculateAlternativeScore(
          currentPricing,
          altPricing,
          'same_tier',
        );
        if (score > 0.5) {
          // Only include reasonably good alternatives
          alternatives.push({
            model: altPricing.model,
            score,
            reason: 'Same tier alternative with good compatibility',
          });
        }
      }

      // If we don't have enough same-tier alternatives, look at adjacent tiers
      if (alternatives.length < 2) {
        const adjacentTiers = this.getAdjacentTiers(currentPricing.tier);

        for (const tier of adjacentTiers) {
          const tierModels = this.pricingService
            .getModelsByTier(tier)
            .filter((p) => p.model !== model && p.active);

          for (const altPricing of tierModels) {
            const score = this.calculateAlternativeScore(
              currentPricing,
              altPricing,
              'adjacent_tier',
            );
            if (score > 0.6) {
              // Higher threshold for tier changes
              alternatives.push({
                model: altPricing.model,
                score,
                reason: `${tier} tier alternative with good compatibility`,
              });
            }
          }
        }
      }

      // Find alternatives by capabilities if we still don't have enough
      if (alternatives.length < 2) {
        const capabilityModels = this.pricingService
          .getModelsByCapabilities(currentPricing.capabilities)
          .filter((p) => p.model !== model && p.active);

        for (const altPricing of capabilityModels) {
          if (!alternatives.some((a) => a.model === altPricing.model)) {
            const score = this.calculateAlternativeScore(
              currentPricing,
              altPricing,
              'capability_match',
            );
            if (score > 0.4) {
              alternatives.push({
                model: altPricing.model,
                score,
                reason: 'Capability-matched alternative',
              });
            }
          }
        }
      }

      // Sort by score (descending) and return top alternatives
      alternatives.sort((a, b) => b.score - a.score);

      const result = alternatives.slice(0, 3).map((a) => a.model); // Return top 3

      this.logger.debug(
        `Found ${result.length} alternative models for ${model}`,
        {
          alternatives: result,
          reasons: alternatives.slice(0, 3).map((a) => a.reason),
        },
      );

      return result;
    } catch (error) {
      this.logger.warn(
        `Error finding alternative models for ${model}, using fallback`,
        error,
      );
      return this.getFallbackAlternatives(model);
    }
  }

  private calculateAlternativeScore(
    current: ModelPricing,
    alternative: ModelPricing,
    matchType: 'same_tier' | 'adjacent_tier' | 'capability_match',
  ): number {
    let score = 0;

    // Base score based on match type
    switch (matchType) {
      case 'same_tier':
        score = 0.8; // High base score for same tier
        break;
      case 'adjacent_tier':
        score = 0.6; // Medium base score for adjacent tiers
        break;
      case 'capability_match':
        score = 0.4; // Lower base score for capability matches
        break;
    }

    // Capability overlap bonus
    const capabilityOverlap = current.capabilities.filter((cap) =>
      alternative.capabilities.includes(cap),
    ).length;
    const capabilityScore =
      capabilityOverlap / Math.max(current.capabilities.length, 1);
    score += capabilityScore * 0.3;

    // Cost efficiency bonus (prefer cheaper alternatives)
    const currentCostPerToken =
      current.inputCostPerToken + current.outputCostPerToken;
    const altCostPerToken =
      alternative.inputCostPerToken + alternative.outputCostPerToken;
    const costRatio = altCostPerToken / currentCostPerToken;

    if (costRatio < 0.9) {
      // Cheaper alternative gets bonus
      score += Math.min((1 - costRatio) * 2, 0.2);
    } else if (costRatio > 1.1) {
      // More expensive alternative gets penalty
      score -= Math.min((costRatio - 1) * 0.5, 0.2);
    }

    // Provider diversity bonus (prefer different providers for redundancy)
    if (current.provider !== alternative.provider) {
      score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  private getAdjacentTiers(tier: ModelPricing['tier']): ModelPricing['tier'][] {
    const tierHierarchy: ModelPricing['tier'][] = [
      'budget',
      'standard',
      'premium',
      'enterprise',
    ];

    const currentIndex = tierHierarchy.indexOf(tier);
    if (currentIndex === -1) return [];

    const adjacent: ModelPricing['tier'][] = [];

    // Add lower tier if exists
    if (currentIndex > 0) {
      adjacent.push(tierHierarchy[currentIndex - 1]);
    }

    // Add higher tier if exists
    if (currentIndex < tierHierarchy.length - 1) {
      adjacent.push(tierHierarchy[currentIndex + 1]);
    }

    return adjacent;
  }

  private getFallbackAlternatives(model: string): string[] {
    // Simple fallback logic when pricing service is unavailable
    const alternatives: string[] = [];

    if (model.includes('claude-3-opus')) {
      alternatives.push('anthropic.claude-3-5-sonnet-20240620-v1:0');
      alternatives.push('anthropic.claude-3-sonnet-20240229-v1:0');
    } else if (model.includes('claude-3-5-sonnet')) {
      alternatives.push('anthropic.claude-3-opus-20240229-v1:0');
      alternatives.push('anthropic.claude-3-haiku-20240307-v1:0');
    } else if (model.includes('claude-3-haiku')) {
      alternatives.push('anthropic.claude-3-5-haiku-20241022-v1:0');
      alternatives.push('anthropic.claude-3-5-sonnet-20240620-v1:0');
    } else if (model.includes('nova-pro')) {
      alternatives.push('amazon.nova-lite-v1:0');
      alternatives.push('amazon.nova-micro-v1:0');
    } else if (model.includes('nova-lite')) {
      alternatives.push('amazon.nova-pro-v1:0');
      alternatives.push('amazon.nova-micro-v1:0');
    } else if (model.includes('llama2-70b')) {
      alternatives.push('meta.llama2-13b-chat-v1');
    } else if (model.includes('llama2-13b')) {
      alternatives.push('meta.llama2-70b-chat-v1');
    }

    return alternatives.slice(0, 2);
  }
}
