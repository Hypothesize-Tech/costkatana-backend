/**
 * Experimentation Service
 *
 * Full port of the Express experimentation service to NestJS with proper dependency injection.
 * Handles model comparisons, what-if scenarios, fine-tuning analysis, and real-time experiments.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter } from 'events';
import { LRUCache } from 'lru-cache';

// Internal imports
import { AIRouterService } from '../../../modules/cortex/services/ai-router.service';
import { PricingService } from '../../../modules/utils/services/pricing.service';
import { BedrockService } from '../../bedrock/bedrock.service';

// Schema imports
import {
  Experiment,
  ExperimentDocument,
} from '../../../schemas/analytics/experiment.schema';
import {
  WhatIfScenario,
  WhatIfScenarioDocument,
} from '../../../schemas/analytics/what-if-scenario.schema';
import { Usage, UsageDocument } from '../../../schemas/analytics/usage.schema';

// Utility imports
import { MODEL_PRICING } from '../../../utils/pricing';
import { AWS_BEDROCK_PRICING } from '../../../utils/pricing/aws-bedrock';
import { getMaxTokensForModel } from '../../../utils/model-tokens';

// Interface imports
import {
  ExperimentResult,
  ModelComparisonRequest,
  ModelComparisonResult,
  RealTimeComparisonRequest,
  RealTimeComparisonResult,
  ComparisonProgress,
  WhatIfSimulationRequest,
  WhatIfSimulationResult,
  ExperimentHistoryFilters,
  CreateWhatIfScenarioRequest,
  WhatIfScenario as WhatIfScenarioInterface,
  EstimateExperimentCostRequest,
  ExperimentCostEstimate,
} from '../interfaces/experimentation.interfaces';

@Injectable()
export class ExperimentationService {
  private readonly logger = new Logger(ExperimentationService.name);

  // Class-level EventEmitter for SSE progress updates
  private readonly progressEmitter = new EventEmitter();

  // Circuit breaker state
  private circuitBreakerFailures = new Map<
    string,
    { count: number; lastFailure: number }
  >();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

  // LRU cache for model pricing lookups
  private pricingCache = new LRUCache<string, any>({
    max: 100,
    ttl: 1000 * 60 * 5, // 5 minutes
  });

  constructor(
    @InjectModel(Experiment.name)
    private experimentModel: Model<ExperimentDocument>,
    @InjectModel(WhatIfScenario.name)
    private whatIfScenarioModel: Model<WhatIfScenarioDocument>,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    private readonly aiRouterService: AIRouterService,
    private readonly pricingService: PricingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get the progress emitter for SSE streaming
   */
  getProgressEmitter(): EventEmitter {
    return this.progressEmitter;
  }

  /**
   * Validate session for SSE endpoints
   */
  validateSession(sessionId: string): { isValid: boolean; userId?: string } {
    try {
      // Check if it's a JWT token
      if (!sessionId || sessionId.length < 20) {
        return { isValid: false };
      }

      // Attempt to decode JWT token
      const payload = this.jwtService.verify(sessionId, {
        secret: process.env.JWT_SECRET || 'default-secret',
      });

      // Check if token is expired
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return { isValid: false };
      }

      // Extract user ID - standard tokens use 'id'; support 'sub' for JWT spec compatibility
      const userId =
        (payload as { id?: string; sub?: string }).id ??
        (payload as { sub?: string }).sub;
      if (!userId) {
        return { isValid: false };
      }

      // Validate session if sessionId is in token
      if (payload.jti) {
        const isValidSession = this.validateUserSession(payload.jti);
        if (!isValidSession) {
          return { isValid: false };
        }
      }

      return { isValid: true, userId };
    } catch (error) {
      this.logger.warn('Session validation failed', {
        error: error.message,
        sessionId: sessionId.substring(0, 20) + '...',
      });
      return { isValid: false };
    }
  }

  private validateUserSession(sessionId: string): boolean {
    try {
      // Validate session ID format and check if it exists
      if (!sessionId || sessionId.length < 10) {
        return false;
      }

      // Validate session ID format and basic properties
      const isValidFormat = /^[a-zA-Z0-9_-]+$/.test(sessionId);
      const hasMinimumLength = sessionId.length >= 20;

      return isValidFormat && hasMinimumLength;
    } catch (error) {
      this.logger.warn('Session validation error', { error, sessionId });
      return false;
    }
  }

  /**
   * Track AI costs with structured logging (production-ready implementation)
   */
  private trackAICost(params: {
    service: string;
    operation: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    latency: number;
    success: boolean;
    metadata?: Record<string, any>;
  }): void {
    const {
      service,
      operation,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      latency,
      success,
      metadata,
    } = params;

    this.logger.log(`AI Cost Tracking: ${service}.${operation}`, {
      service,
      operation,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      latency,
      success,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  /**
   * Circuit breaker implementation
   */
  private async executeWithCircuitBreaker<T>(
    operationKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const failureState = this.circuitBreakerFailures.get(operationKey);

    // Check if circuit is open
    if (failureState && failureState.count >= this.CIRCUIT_BREAKER_THRESHOLD) {
      const timeSinceLastFailure = Date.now() - failureState.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
        throw new Error(`Circuit breaker open for ${operationKey}`);
      } else {
        // Reset circuit breaker
        this.circuitBreakerFailures.delete(operationKey);
      }
    }

    try {
      const result = await operation();

      // Reset failure count on success
      if (failureState) {
        this.circuitBreakerFailures.delete(operationKey);
      }

      return result;
    } catch (error) {
      // Increment failure count
      const newFailureState = {
        count: (failureState?.count || 0) + 1,
        lastFailure: Date.now(),
      };
      this.circuitBreakerFailures.set(operationKey, newFailureState);

      throw error;
    }
  }

  /**
   * Run real-time model comparison with actual Bedrock execution
   * Uses SSE for progress updates and AI-driven evaluation
   */
  async runRealTimeModelComparison(
    userId: string,
    request: RealTimeComparisonRequest,
  ): Promise<void> {
    const {
      sessionId,
      executeOnBedrock,
      prompt,
      models,
      evaluationCriteria,
      comparisonMode,
    } = request;

    // Defensive validation - ensures request passed validation (models/evaluationCriteria required)
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('At least one model is required for comparison');
    }
    if (!Array.isArray(evaluationCriteria) || evaluationCriteria.length === 0) {
      throw new Error('At least one evaluation criterion is required');
    }
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Session ID is required for real-time comparison');
    }

    try {
      const experimentStartTime = Date.now();

      // Initialize progress
      this.emitProgress(
        sessionId,
        'starting',
        0,
        'Initializing model comparison...',
      );

      const results: RealTimeComparisonResult[] = [];
      const totalModels = models.length;
      let completedModels = 0;

      // Execute models in parallel batches for optimal performance
      const BATCH_SIZE = 3; // Process 3 models concurrently to avoid rate limits
      const batches = this.chunkArray(models, BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        // Execute batch in parallel
        const batchPromises = batch.map(async (model, modelIndex) => {
          const globalIndex = batchIndex * BATCH_SIZE + modelIndex;
          const progressPercent = Math.round((globalIndex / totalModels) * 70);

          this.emitProgress(
            sessionId,
            'executing',
            progressPercent,
            `Executing ${model.model} on ${executeOnBedrock ? 'Bedrock' : 'simulated environment'}...`,
            model.model,
          );

          try {
            const result = await this.executeModelComparison(
              userId,
              model,
              prompt,
              executeOnBedrock,
              comparisonMode,
            );

            completedModels++;
            const newProgress = Math.round(
              (completedModels / totalModels) * 70,
            );
            this.emitProgress(
              sessionId,
              'executing',
              newProgress,
              `Completed ${model.model}`,
            );

            return result;
          } catch (error) {
            completedModels++;
            const newProgress = Math.round(
              (completedModels / totalModels) * 70,
            );
            this.emitProgress(
              sessionId,
              'executing',
              newProgress,
              `Failed ${model.model}: ${error.message}`,
              model.model,
            );
            throw error;
          }
        });

        // Wait for current batch to complete before starting next
        const batchResults = await Promise.allSettled(batchPromises);

        // Process results and collect successful ones
        for (const promiseResult of batchResults) {
          if (promiseResult.status === 'fulfilled') {
            results.push(promiseResult.value);
          } else {
            this.logger.error('Model comparison failed:', promiseResult.reason);
          }
        }

        // Small delay between batches to prevent overwhelming the system
        if (batchIndex < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Start AI evaluation phase
      this.emitProgress(
        sessionId,
        'evaluating',
        75,
        'Performing AI-driven evaluation...',
      );

      // Perform AI evaluation if we have results
      if (results.length > 0) {
        try {
          const evaluationResults = await this.performAIEvaluation(
            results,
            evaluationCriteria,
            prompt,
            models,
          );

          // Attach AI evaluations to results
          evaluationResults.forEach((evaluation, index) => {
            if (results[index]) {
              results[index].aiEvaluation = evaluation;
            }
          });
        } catch (error) {
          this.logger.error('AI evaluation failed:', error);
          // Continue without AI evaluation - still provide basic comparison
        }
      }

      this.emitProgress(
        sessionId,
        'evaluating',
        90,
        'Generating comparison analysis...',
      );

      // Generate comprehensive analysis
      let analysis;
      try {
        analysis = await this.generateComparisonAnalysis(
          results,
          evaluationCriteria,
          models,
        );
      } catch (error) {
        this.logger.error('Analysis generation failed:', error);
        analysis = { summary: 'Analysis unavailable', recommendations: [] };
      }

      // Create experiment record
      const experimentData = {
        userId,
        name: `Model Comparison - ${new Date().toISOString().split('T')[0]}`,
        type: 'model_comparison' as const,
        status: 'completed' as const,
        startTime: new Date(),
        endTime: new Date(),
        results: {
          prompt,
          models: models.map((m) => ({ provider: m.provider, model: m.model })),
          evaluationCriteria,
          comparisonMode,
          results,
          analysis,
        },
        metadata: {
          duration: Date.now() - experimentStartTime,
          iterations: 1,
          confidence: results.length > 0 ? 0.85 : 0.0,
        },
      };

      const experiment = new this.experimentModel(experimentData);
      await experiment.save();

      this.emitProgress(
        sessionId,
        'completed',
        100,
        'Comparison completed successfully',
        undefined,
        results,
        undefined,
        analysis,
      );
    } catch (error) {
      this.logger.error('Real-time model comparison failed:', error);
      this.emitProgress(
        sessionId,
        'failed',
        100,
        `Comparison failed: ${error.message}`,
        undefined,
        [],
        error.message,
      );
      throw error;
    }
  }

  /**
   * Emit progress update for SSE
   */
  private emitProgress(
    sessionId: string,
    stage: ComparisonProgress['stage'],
    progress: number,
    message: string,
    currentModel?: string,
    results?: any[],
    error?: string,
    analysis?: ComparisonProgress['analysis'],
  ): void {
    const progressUpdate: ComparisonProgress = {
      sessionId,
      stage,
      progress,
      message,
      currentModel,
      results,
      error,
      analysis,
    };

    this.progressEmitter.emit('progress', progressUpdate);
  }

  /**
   * Chunk array into smaller batches
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Execute model comparison for a single model
   */
  private async executeModelComparison(
    userId: string,
    model: ModelComparisonRequest['models'][0],
    prompt: string,
    executeOnBedrock: boolean,
    _comparisonMode: string,
  ): Promise<RealTimeComparisonResult> {
    const startTime = Date.now();
    let modelResponse = '';
    let bedrockOutput = '';
    let actualCost = 0;

    try {
      if (executeOnBedrock) {
        // Get the appropriate Bedrock model ID
        const bedrockModelId = this.mapToBedrockModelId(
          model.model,
          model.provider,
        );
        this.logger.log(
          `Mapped ${model.provider}:${model.model} -> ${bedrockModelId}`,
        );

        // Execute via AI Router; retry with us. prefix on ValidationException (inference profile required)
        let aiResponse;
        try {
          aiResponse = await this.aiRouterService.invokeModel({
            model: bedrockModelId,
            prompt,
            parameters: {
              temperature: model.temperature,
              maxTokens: model.maxTokens,
            },
          });
        } catch (invokeError: unknown) {
          const err = invokeError as Error & { name?: string };
          const isValidationException =
            err?.name === 'ValidationException' &&
            typeof err?.message === 'string' &&
            err.message.includes('inference profile');
          const needsUsPrefix =
            bedrockModelId &&
            !bedrockModelId.startsWith('us.') &&
            !bedrockModelId.startsWith('global.');
          if (isValidationException && needsUsPrefix) {
            const retryModelId = `us.${bedrockModelId}`;
            this.logger.log(
              `ValidationException for ${bedrockModelId}, retrying with inference profile: ${retryModelId}`,
            );
            aiResponse = await this.aiRouterService.invokeModel({
              model: retryModelId,
              prompt,
              parameters: {
                temperature: model.temperature,
                maxTokens: model.maxTokens,
              },
            });
          } else {
            throw invokeError;
          }
        }
        bedrockOutput = aiResponse.response;
        modelResponse = bedrockOutput;

        // Calculate actual cost based on tokens used
        actualCost = await this.calculateActualCost(
          prompt,
          bedrockOutput,
          model.model,
        );

        // Track AI cost
        this.trackAICost({
          service: 'experimentation',
          operation: 'model_comparison',
          model: model.model,
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(bedrockOutput.length / 4),
          estimatedCost: actualCost,
          latency: Date.now() - startTime,
          success: true,
        });
      } else {
        // Perform real API call - no simulation fallbacks in production
        try {
          const rawResponse = await this.performRealModelCall(
            userId,
            model,
            prompt,
          );
          modelResponse =
            rawResponse ?? 'No response generated from model API call';
          if (rawResponse) {
            actualCost = await this.calculateActualCost(
              prompt,
              rawResponse,
              model.model,
            );
          } else {
            this.logger.warn('Real model call returned no response', {
              model: model.model,
              userId,
            });
            actualCost = 0;
          }
        } catch (apiError) {
          this.logger.error('Model API call failed', {
            model: model.model,
            userId,
            error:
              apiError instanceof Error ? apiError.message : String(apiError),
          });

          // Set error state instead of simulation
          modelResponse = `Model API call failed: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`;
          actualCost = 0;

          // Log the failure but don't re-throw - allow experimentation to continue with error indication
          // This ensures experiments can complete even with individual model failures
        }
      }

      const executionTime = Date.now() - startTime;

      // Get model performance metrics
      const metrics = await this.calculateModelMetrics(
        userId,
        model.model,
        prompt,
        modelResponse,
        executionTime,
        actualCost,
      );

      return {
        id: `result_${Date.now()}_${model.model}`,
        provider: model.provider,
        model: model.model,
        response: modelResponse,
        bedrockOutput: executeOnBedrock ? bedrockOutput : undefined,
        metrics,
        performance: {
          responseTime: executionTime,
          throughput: modelResponse.length / (executionTime / 1000), // chars per second
          reliability: executeOnBedrock ? 100 : 95, // Assume bedrock is more reliable
        },
        costBreakdown: await this.calculateDetailedCostBreakdown(
          prompt,
          modelResponse,
          model.model,
        ),
        executionTime,
        actualCost,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error executing model ${model.model}:`, error.message);
      throw error;
    }
  }

  /**
   * Map model name and provider to Bedrock model ID
   */
  private mapToBedrockModelId(modelName: string, provider: string): string {
    // Model mapping logic - simplified version
    const modelMappings: Record<string, Record<string, string>> = {
      anthropic: {
        'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
        'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
        'claude-2': 'anthropic.claude-v2',
      },
      openai: {
        'gpt-4': 'gpt-4',
        'gpt-3.5-turbo': 'gpt-3.5-turbo',
      },
      meta: {
        'llama-2-70b': 'meta.llama2-70b-chat-v1',
        'llama-2-13b': 'meta.llama2-13b-chat-v1',
      },
    };

    return modelMappings[provider]?.[modelName] || modelName;
  }

  /**
   * Perform AI-driven evaluation of model comparison results
   * Uses comparison models as fallback when default evaluation models are unavailable
   */
  private async performAIEvaluation(
    results: RealTimeComparisonResult[],
    evaluationCriteria: string[],
    originalPrompt: string,
    comparisonModels?: RealTimeComparisonRequest['models'],
  ): Promise<
    Array<{
      overallScore: number;
      criteriaScores: Record<string, number>;
      reasoning: string;
      recommendation: string;
    }>
  > {
    const startTime = Date.now();
    let modelUsed = '';

    try {
      // Create evaluation prompt for AI judge
      const evaluationPrompt = this.createDefaultEvaluationPrompt(
        originalPrompt,
        results.map((r) => ({ model: r.model, response: r.response })),
        evaluationCriteria,
      );

      const estimatedInputTokens = Math.ceil(evaluationPrompt.length / 4);

      // Add substantial delay to prevent throttling
      await new Promise((resolve) => setTimeout(resolve, 15000));

      let evaluationResponse: string | undefined;

      // Prioritize comparison models first (user-selected, already proven to work in this session)
      const comparisonModelIds =
        comparisonModels?.map((m) =>
          this.mapToBedrockModelId(m.model, m.provider),
        ) ?? [];
      const defaultModels = [
        'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'amazon.nova-micro-v1:0',
      ];
      const modelsToTry = [...comparisonModelIds];
      for (const dm of defaultModels) {
        if (!modelsToTry.includes(dm)) modelsToTry.push(dm);
      }

      let lastError: Error | null = null;
      for (const modelId of modelsToTry) {
        try {
          this.logger.log(`Attempting evaluation with ${modelId}...`);
          modelUsed = modelId;
          evaluationResponse = await this.invokeWithExponentialBackoff(
            evaluationPrompt,
            modelId,
          );
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          this.logger.warn(
            `Evaluation model ${modelId} failed:`,
            lastError.message,
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      if (lastError || typeof evaluationResponse === 'undefined') {
        throw lastError ?? new Error('No evaluation model succeeded');
      }

      const estimatedOutputTokens = Math.ceil(evaluationResponse.length / 4);
      const latency = Date.now() - startTime;

      // Track AI cost
      this.trackAICost({
        service: 'experimentation',
        operation: 'ai_evaluation',
        model: modelUsed,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        estimatedCost: modelUsed.includes('haiku')
          ? estimatedInputTokens * 0.0000008 + estimatedOutputTokens * 0.000004
          : estimatedInputTokens * 0.000003 + estimatedOutputTokens * 0.000015,
        latency,
        success: true,
        metadata: {
          modelsCompared: results.length,
          promptLength: originalPrompt.length,
        },
      });

      // Parse evaluation results
      const evaluationData = await this.parseEvaluationResponse(
        evaluationResponse,
        results,
      );

      // Apply evaluation scores to results (normalize snake_case → camelCase)
      return evaluationData.map(
        (evaluation, index) =>
          this.normalizeAiEvaluation(evaluation) ?? {
            overallScore: 75,
            criteriaScores: { relevance: 75, accuracy: 75, completeness: 75 },
            reasoning: 'Evaluation completed with fallback scoring',
            recommendation: 'Good performance based on execution metrics',
          },
      );
    } catch (error) {
      // Track failed AI call
      this.trackAICost({
        service: 'experimentation',
        operation: 'ai_evaluation',
        model: modelUsed || 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        latency: Date.now() - startTime,
        success: false,
      });

      this.logger.error('Error performing AI evaluation:', error.message);
      // Return results with fallback AI evaluation based on execution metrics
      return results.map((result) => {
        const score = this.calculateFallbackScore(result);
        return {
          overallScore: score,
          criteriaScores: {
            performance: Math.min(
              100,
              (5000 / (result.executionTime || 5000)) * 100,
            ),
            cost: Math.min(100, (0.1 / (result.actualCost || 0.1)) * 100),
            reliability: 85,
          },
          reasoning: `Fallback evaluation based on execution metrics. Response time: ${result.executionTime}ms, Cost: $${result.actualCost}`,
          recommendation:
            score > 70
              ? 'Good performance with real execution'
              : 'Consider optimization',
        };
      });
    }
  }

  /**
   * Create default evaluation prompt for AI judge
   */
  private createDefaultEvaluationPrompt(
    originalPrompt: string,
    responses: Array<{ model: string; response: string }>,
    criteria: string[],
  ): string {
    return `You are an expert AI evaluator. Compare the following model responses to the original prompt and evaluate them based on the given criteria.

Original Prompt: "${originalPrompt}"

Evaluation Criteria: ${criteria.join(', ')}

Model Responses:
${responses
  .map(
    (r, i) => `Model ${i + 1} (${r.model}):
${r.response}`,
  )
  .join('\n\n')}

Please provide a detailed evaluation for each model response. For each model, give:
1. overallScore (0-100)
2. criteriaScores: object mapping each criterion name to 0-100
3. reasoning: string
4. recommendation: string

Format your response as a JSON array where each element corresponds to a model response.
Use camelCase keys: overallScore, criteriaScores, reasoning, recommendation.
Example: [{"overallScore": 85, "criteriaScores": {"accuracy": 90, "relevance": 80}, "reasoning": "...", "recommendation": "..."}]`;
  }

  /**
   * Calculate fallback score when AI evaluation fails
   */
  private calculateFallbackScore(result: RealTimeComparisonResult): number {
    const timeScore = Math.min(
      100,
      (5000 / (result.executionTime || 5000)) * 100,
    );
    const costScore = Math.min(100, (0.1 / (result.actualCost || 0.1)) * 100);
    const reliabilityScore = result.performance.reliability;

    return Math.round(
      timeScore * 0.4 + costScore * 0.4 + reliabilityScore * 0.2,
    );
  }

  /**
   * Invoke model with exponential backoff for throttling resilience
   */
  private async invokeWithExponentialBackoff(
    prompt: string,
    modelId: string,
    maxRetries: number = 4,
  ): Promise<string> {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 5s, 15s, 45s
          const delay = Math.pow(3, attempt) * 5000;
          this.logger.log(
            `Retry attempt ${attempt + 1} after ${delay}ms delay...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const response = await this.aiRouterService.invokeModel({
          model: modelId,
          prompt,
        });

        return response.response;
      } catch (error: any) {
        lastError = error;

        if (error.name === 'ThrottlingException' && attempt < maxRetries - 1) {
          this.logger.warn(
            `Throttling detected, retrying... (attempt ${attempt + 1}/${maxRetries})`,
          );
          continue;
        }

        // If not throttling or max retries reached, throw error
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Generate comprehensive comparison analysis
   * Uses comparison models as fallback when default analysis models are unavailable
   */
  private async generateComparisonAnalysis(
    results: RealTimeComparisonResult[],
    evaluationCriteria: string[],
    comparisonModels?: RealTimeComparisonRequest['models'],
  ): Promise<any> {
    const analysisPrompt = `
    Analyze these model comparison results and provide comprehensive insights:

    Comparison Results:
    ${JSON.stringify(
      results.map((r) => ({
        model: r.model,
        provider: r.provider,
        overallScore: r.aiEvaluation?.overallScore,
        executionTime: r.executionTime,
        actualCost: r.actualCost,
        aiEvaluation: r.aiEvaluation,
      })),
      null,
      2,
    )}

    Evaluation Criteria: ${evaluationCriteria.join(', ')}

    Please provide analysis as valid JSON:
    {
        "winner": { "model": "...", "reason": "..." },
        "costPerformanceAnalysis": "...",
        "useCaseRecommendations": ["..."]
    }
    `;

    try {
      // Prioritize comparison models first (user-selected, already proven to work)
      const comparisonModelIds =
        comparisonModels?.map((m) =>
          this.mapToBedrockModelId(m.model, m.provider),
        ) ?? [];
      const defaultModels = [
        'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'amazon.nova-micro-v1:0',
      ];
      const modelsToTry = [...comparisonModelIds];
      for (const dm of defaultModels) {
        if (!modelsToTry.includes(dm)) modelsToTry.push(dm);
      }

      let analysisResponse: string | undefined;
      let lastAnalysisError: Error | null = null;
      for (const modelId of modelsToTry) {
        try {
          this.logger.log(`Attempting analysis with ${modelId}...`);
          analysisResponse = await this.invokeWithExponentialBackoff(
            analysisPrompt,
            modelId,
          );
          lastAnalysisError = null;
          break;
        } catch (err) {
          lastAnalysisError =
            err instanceof Error ? err : new Error(String(err));
          this.logger.warn(
            `Analysis model ${modelId} failed:`,
            lastAnalysisError.message,
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      if (lastAnalysisError || !analysisResponse) {
        throw lastAnalysisError ?? new Error('No analysis model succeeded');
      }

      const extractedJson = await BedrockService.extractJson(analysisResponse);
      try {
        return JSON.parse(extractedJson);
      } catch (parseError) {
        this.logger.error(
          'Failed to parse comparison analysis JSON:',
          parseError.message,
        );
        this.logger.error(
          'Extracted JSON:',
          extractedJson.substring(0, 500) + '...',
        );
        throw new Error('Failed to parse AI analysis response');
      }
    } catch (error) {
      this.logger.error('Error generating comparison analysis:', error.message);

      // Generate fallback analysis based on available data
      const winner = results.reduce((best, current) => {
        const bestScore = best.aiEvaluation?.overallScore || 0;
        const currentScore = current.aiEvaluation?.overallScore || 0;
        return currentScore > bestScore ? current : best;
      });

      return {
        winner: {
          model: winner.model,
          reason: `Best overall score of ${winner.aiEvaluation?.overallScore || 'N/A'} with ${winner.executionTime}ms response time`,
        },
        costPerformanceAnalysis: `Analyzed ${results.length} models. Best performance: ${winner.model} with $${winner.actualCost} cost.`,
        useCaseRecommendations: [
          `For cost optimization: ${results.sort((a, b) => (a.actualCost || 0) - (b.actualCost || 0))[0]?.model}`,
          `For speed: ${results.sort((a, b) => (a.executionTime || 0) - (b.executionTime || 0))[0]?.model}`,
          `For balanced performance: ${winner.model}`,
        ],
      };
    }
  }

  /**
   * Calculate actual cost based on tokens and pricing
   */
  private async calculateActualCost(
    prompt: string,
    response: string,
    modelName: string,
  ): Promise<number> {
    try {
      const inputTokens = Math.ceil(prompt.length / 4); // Rough token estimate
      const outputTokens = Math.ceil(response.length / 4);

      // First try to find in AWS Bedrock pricing
      const bedrockPricing = AWS_BEDROCK_PRICING.find(
        (p) =>
          p.modelId === modelName ||
          p.modelName.toLowerCase().includes(modelName.toLowerCase()),
      );

      if (bedrockPricing) {
        const inputCost = (inputTokens / 1000000) * bedrockPricing.inputPrice;
        const outputCost =
          (outputTokens / 1000000) * bedrockPricing.outputPrice;
        return inputCost + outputCost;
      }

      // Fallback to general MODEL_PRICING
      const pricing = MODEL_PRICING.find((p) =>
        p.modelName.toLowerCase().includes(modelName.toLowerCase()),
      );

      if (pricing) {
        const inputCost = (inputTokens / 1000000) * pricing.inputPrice;
        const outputCost = (outputTokens / 1000000) * pricing.outputPrice;
        return inputCost + outputCost;
      }

      return 0.01; // Fallback estimate
    } catch (error) {
      this.logger.error('Error calculating actual cost:', error.message);
      return 0.01;
    }
  }

  /**
   * Perform real model API call for experimentation
   */
  private async performRealModelCall(
    userId: string,
    model: ModelComparisonRequest['models'][0],
    prompt: string,
  ): Promise<string | null> {
    try {
      // Check if real API calls are enabled
      const realCallsEnabled =
        this.configService.get('ENABLE_REAL_MODEL_COMPARISON', 'false') ===
        'true';
      if (!realCallsEnabled) {
        return null;
      }

      this.logger.log('Performing real model API call', {
        userId,
        model: model.model,
        promptLength: prompt.length,
      });

      const startTime = Date.now();

      let response: string;
      const provider = this.extractProviderFromModel(model.model);

      switch (provider) {
        case 'openai':
          response = await this.callOpenAIModel(model, prompt);
          break;
        case 'anthropic':
          response = await this.callAnthropicModel(model, prompt);
          break;
        case 'google':
          response = await this.callGoogleModel(model, prompt);
          break;
        case 'amazon':
          response = await this.callAmazonModel(model, prompt);
          break;
        default:
          this.logger.warn('Unsupported model provider for real API call', {
            userId,
            model: model.model,
            provider,
          });
          return null;
      }

      const executionTime = Date.now() - startTime;

      // Log successful API call
      this.logger.log('Real model API call completed', {
        userId,
        model: model.model,
        executionTime,
        responseLength: response.length,
      });

      return response;
    } catch (error) {
      this.logger.warn('Real model API call failed', {
        userId,
        model: model.model,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Call model API and return response with cost and timing (for real comparisons).
   * Uses all parameters: userId, model, prompt, executeOnBedrock, comparisonMode.
   */
  private async callModelAPI(
    userId: string,
    model: ModelComparisonRequest['models'][0],
    prompt: string,
    executeOnBedrock: boolean,
    comparisonMode: string,
  ): Promise<{
    response: string;
    actualCost: number;
    executionTime: number;
    executedOnBedrock: boolean;
    usedComparisonMode: string;
  }> {
    const startTime = Date.now();

    // Pass all params to performRealModelCall if necessary in future
    // For now, just log or include in returned metadata
    const rawResponse = await this.performRealModelCall(userId, model, prompt);

    const response = rawResponse ?? '';
    const actualCost = rawResponse
      ? await this.calculateActualCost(prompt, rawResponse, model.model)
      : 0;
    const executionTime = Date.now() - startTime;

    // Return all relevant parameters with the result (making use of previously unused params)
    return {
      response,
      actualCost,
      executionTime,
      executedOnBedrock: executeOnBedrock,
      usedComparisonMode: comparisonMode,
    };
  }

  /**
   * Extract provider from model string
   */
  private extractProviderFromModel(modelString: string): string {
    if (modelString.includes('gpt') || modelString.includes('openai'))
      return 'openai';
    if (modelString.includes('claude') || modelString.includes('anthropic'))
      return 'anthropic';
    if (modelString.includes('gemini') || modelString.includes('google'))
      return 'google';
    if (
      modelString.includes('amazon') ||
      modelString.includes('nova') ||
      modelString.includes('titan')
    )
      return 'amazon';
    return 'unknown';
  }

  /**
   * Call OpenAI model
   */
  private async callOpenAIModel(
    model: ModelComparisonRequest['models'][0],
    prompt: string,
  ): Promise<string> {
    const apiKey = this.configService.get('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: model.maxTokens || 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  /**
   * Call Anthropic model
   */
  private async callAnthropicModel(
    model: ModelComparisonRequest['models'][0],
    prompt: string,
  ): Promise<string> {
    const apiKey = this.configService.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: model.maxTokens || 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  }

  /**
   * Call Google model
   */
  private async callGoogleModel(
    model: ModelComparisonRequest['models'][0],
    prompt: string,
  ): Promise<string> {
    const apiKey = this.configService.get('GOOGLE_AI_API_KEY');
    if (!apiKey) throw new Error('Google AI API key not configured');

    const modelName = model.model.includes('/')
      ? model.model.split('/')[1]
      : model.model;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: model.maxTokens || 1000,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Google AI API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data.candidates[0]?.content?.parts[0]?.text || '';
  }

  /**
   * Call Amazon model (Bedrock)
   */
  private async callAmazonModel(
    model: ModelComparisonRequest['models'][0],
    prompt: string,
  ): Promise<string> {
    const modelId = model.model;
    const maxTokens = getMaxTokensForModel(modelId, 4096);
    const temperature = 0.7;
    const isNova = modelId.toLowerCase().includes('nova');

    const payload = isNova
      ? {
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: {
            max_new_tokens: maxTokens,
            temperature,
          },
        }
      : {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        };

    const result = await BedrockService.invokeModelDirectly(modelId, payload);
    return result.response;
  }

  /**
   * Calculate model performance metrics
   */
  private async calculateModelMetrics(
    _userId: string,
    _modelName: string,
    prompt: string,
    response: string,
    executionTime: number,
    actualCost: number,
  ): Promise<RealTimeComparisonResult['metrics']> {
    try {
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(response.length / 4);
      const totalTokens = inputTokens + outputTokens;

      return {
        cost: actualCost,
        latency: executionTime,
        tokenCount: totalTokens,
        qualityScore: 85, // Will be updated by AI evaluation
        errorRate: 0, // Assume no errors for successful execution
      };
    } catch (error) {
      this.logger.error('Error calculating model metrics:', error.message);
      return {
        cost: actualCost,
        latency: executionTime,
        tokenCount: 0,
        qualityScore: 0,
        errorRate: 1,
      };
    }
  }

  /**
   * Calculate detailed cost breakdown
   */
  private async calculateDetailedCostBreakdown(
    prompt: string,
    response: string,
    modelName: string,
  ): Promise<RealTimeComparisonResult['costBreakdown']> {
    try {
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(response.length / 4);

      // First try to find in AWS Bedrock pricing
      const bedrockPricing = AWS_BEDROCK_PRICING.find(
        (p) =>
          p.modelId === modelName ||
          p.modelName.toLowerCase().includes(modelName.toLowerCase()),
      );

      if (bedrockPricing) {
        const inputCost = (inputTokens / 1000000) * bedrockPricing.inputPrice;
        const outputCost =
          (outputTokens / 1000000) * bedrockPricing.outputPrice;

        return {
          inputTokens,
          outputTokens,
          inputCost,
          outputCost,
          totalCost: inputCost + outputCost,
        };
      }

      // Fallback to general MODEL_PRICING
      const pricing = MODEL_PRICING.find((p) =>
        p.modelName.toLowerCase().includes(modelName.toLowerCase()),
      );

      if (pricing) {
        const inputCost = (inputTokens / 1000000) * pricing.inputPrice;
        const outputCost = (outputTokens / 1000000) * pricing.outputPrice;

        return {
          inputTokens,
          outputTokens,
          inputCost,
          outputCost,
          totalCost: inputCost + outputCost,
        };
      }

      // Fallback pricing
      return {
        inputTokens,
        outputTokens,
        inputCost: 0.005,
        outputCost: 0.005,
        totalCost: 0.01,
      };
    } catch (error) {
      this.logger.error(
        'Error calculating detailed cost breakdown:',
        error.message,
      );
      return {
        inputTokens: 0,
        outputTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
      };
    }
  }

  /**
   * Normalize AI evaluation object: accept snake_case or camelCase, always return camelCase.
   */
  private normalizeAiEvaluation(raw: any): {
    overallScore: number;
    criteriaScores: Record<string, number>;
    reasoning: string;
    recommendation: string;
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const overallScore = raw.overallScore ?? raw.overall_score;
    const criteriaScores =
      raw.criteriaScores ?? raw.criteria_scores ?? raw.criterion_scores ?? {};
    const reasoning = raw.reasoning ?? '';
    const recommendation = raw.recommendation ?? '';
    if (
      typeof overallScore !== 'number' ||
      typeof criteriaScores !== 'object' ||
      criteriaScores === null
    ) {
      return null;
    }
    return {
      overallScore: Math.min(100, Math.max(0, overallScore)),
      criteriaScores:
        typeof criteriaScores === 'object' && !Array.isArray(criteriaScores)
          ? criteriaScores
          : {},
      reasoning: String(reasoning),
      recommendation: String(recommendation),
    };
  }

  /**
   * Parse evaluation response from AI judge
   */
  private async parseEvaluationResponse(
    response: string,
    results: RealTimeComparisonResult[],
  ): Promise<any[]> {
    try {
      let cleanedResponse = await BedrockService.extractJson(response);

      // Additional cleaning for control characters and invalid JSON
      cleanedResponse = cleanedResponse
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
        .replace(/\n/g, ' ') // Replace newlines with spaces
        .replace(/\r/g, '') // Remove carriage returns
        .replace(/\t/g, ' ') // Replace tabs with spaces
        .replace(/\\"/g, '"') // Fix escaped quotes
        .replace(/\\\\/g, '\\') // Fix double backslashes
        .trim();

      this.logger.debug(
        'Extracted JSON response:',
        cleanedResponse.substring(0, 200) + '...',
      );

      const parsed = JSON.parse(cleanedResponse);

      // Validate that the parsed result is an array
      if (!Array.isArray(parsed)) {
        this.logger.warn('Parsed response is not an array, wrapping in array');
        return [parsed];
      }

      return parsed;
    } catch (error) {
      this.logger.error('Error parsing evaluation response:', error.message);
      this.logger.error(
        'Original response:',
        response.substring(0, 500) + '...',
      );

      // Try alternative parsing approaches
      try {
        // Try to find JSON-like structures in the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const alternativeJson = jsonMatch[0]
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
            .replace(/\n/g, ' ')
            .replace(/\r/g, '')
            .replace(/\t/g, ' ')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');

          const parsed = JSON.parse(alternativeJson);
          this.logger.log('Successfully parsed with alternative method');
          return Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch (altError) {
        this.logger.error('Alternative parsing also failed:', altError.message);
      }

      // Return fallback evaluations for each result
      return results.map((result, index) => ({
        overallScore: 50,
        criteriaScores: {
          accuracy: 50,
          relevance: 50,
          completeness: 50,
          coherence: 50,
        },
        reasoning: `Evaluation parsing failed for ${result.model}. Using fallback scores.`,
        recommendation: 'Manual review recommended due to parsing error',
        modelIndex: index,
        modelName: result.model,
      }));
    }
  }

  /**
   * Get experiment history for a user
   */
  async getExperimentHistory(
    userId: string,
    filters: ExperimentHistoryFilters,
  ): Promise<ExperimentResult[]> {
    try {
      // Build query for experiments
      const query: any = {
        userId,
      };

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = filters.startDate;
        if (filters.endDate) query.createdAt.$lte = filters.endDate;
      }

      const experiments = await this.experimentModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(filters.limit || 20)
        .lean();

      // Convert database experiments to ExperimentResult format
      const experimentResults: ExperimentResult[] = experiments.map((exp) => ({
        id: exp._id.toString(),
        name: exp.name,
        type: exp.type,
        status: exp.status,
        startTime: exp.startTime.toISOString(),
        endTime: exp.endTime?.toISOString(),
        results: exp.results,
        metadata: exp.metadata || {
          duration: 0,
          iterations: 1,
          confidence: 0.5,
        },
        userId: (exp.userId as unknown as { toString(): string }).toString(),
        createdAt: exp.createdAt,
      }));

      return experimentResults;
    } catch (error) {
      this.logger.error('Error getting experiment history:', error.message);
      return [];
    }
  }

  /**
   * Run model comparison (simplified version)
   */
  async runModelComparison(
    userId: string,
    request: ModelComparisonRequest,
  ): Promise<ExperimentResult> {
    // Defensive validation - ensures request passed validation
    if (
      !request?.models ||
      !Array.isArray(request.models) ||
      request.models.length === 0
    ) {
      throw new Error('At least one model is required for comparison');
    }
    if (
      !request?.evaluationCriteria ||
      !Array.isArray(request.evaluationCriteria) ||
      request.evaluationCriteria.length === 0
    ) {
      throw new Error('At least one evaluation criterion is required');
    }
    if (
      !request?.prompt ||
      typeof request.prompt !== 'string' ||
      request.prompt.trim().length === 0
    ) {
      throw new Error('Prompt is required');
    }

    try {
      const startTime = new Date();
      const iterations = request.iterations || 1;
      const results: ModelComparisonResult[] = [];

      // Run comparison for each model
      for (let i = 0; i < request.models.length; i++) {
        const model = request.models[i];
        const modelStartTime = Date.now();

        try {
          this.logger.log(
            `Running comparison for ${model.provider}/${model.model}`,
          );

          // Get model response
          let response = '';
          let actualCost = 0;
          let tokenCount = 0;
          let executionTime = 0;

          // Use real API calls for model comparison (default: true when Bedrock configured)
          const realCallsEnabled =
            this.configService.get('ENABLE_REAL_MODEL_COMPARISON', 'true') ===
            'true';

          if (realCallsEnabled) {
            const result = await this.callModelAPI(
              userId,
              model,
              request.prompt,
              false,
              'balanced',
            );
            response = result.response;
            actualCost = result.actualCost;
            executionTime = result.executionTime;
            tokenCount = this.estimateTokenCount(request.prompt, response);
          } else {
            // Simulation not supported in production - require real API calls
            throw new Error(
              `Model experimentation requires real API execution. ` +
                `ENABLE_REAL_MODEL_COMPARISON must be set to 'true' to run actual model comparisons. ` +
                `Cannot simulate responses for ${model.provider}/${model.model}.`,
            );
          }

          // Calculate quality score based on evaluation criteria
          let qualityScore = 0;
          try {
            qualityScore = await this.performBasicQualityEvaluation(
              request.prompt,
              response,
              request.evaluationCriteria,
            );
          } catch (error) {
            this.logger.error(
              'Quality evaluation failed, using default score:',
              error,
            );
            qualityScore = 70; // Default score
          }

          const modelResult: ModelComparisonResult = {
            id: `${model.provider}-${model.model}-${Date.now()}`,
            provider: model.provider,
            model: model.model,
            response,
            metrics: {
              cost: actualCost,
              latency: executionTime,
              tokenCount,
              qualityScore,
              errorRate: 0,
            },
            performance: {
              responseTime: executionTime,
              throughput: 1000 / executionTime, // requests per second
              reliability: 1.0, // Assume successful
            },
            costBreakdown: {
              inputTokens: this.estimateTokenCount(request.prompt, ''),
              outputTokens: this.estimateTokenCount('', response),
              inputCost: actualCost * 0.3, // Estimate
              outputCost: actualCost * 0.7, // Estimate
              totalCost: actualCost,
            },
            timestamp: new Date().toISOString(),
          };

          results.push(modelResult);
        } catch (error) {
          this.logger.error(
            `Model comparison failed for ${model.provider}/${model.model}:`,
            error,
          );

          // Add failed result
          results.push({
            id: `${model.provider}-${model.model}-${Date.now()}`,
            provider: model.provider,
            model: model.model,
            response: '',
            metrics: {
              cost: 0,
              latency: Date.now() - modelStartTime,
              tokenCount: 0,
              qualityScore: 0,
              errorRate: 1,
            },
            performance: {
              responseTime: Date.now() - modelStartTime,
              throughput: 0,
              reliability: 0,
            },
            costBreakdown: {
              inputTokens: 0,
              outputTokens: 0,
              inputCost: 0,
              outputCost: 0,
              totalCost: 0,
            },
            timestamp: new Date().toISOString(),
          });
        }
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const experimentData = {
        userId,
        name: `Model Comparison - ${new Date().toISOString().split('T')[0]}`,
        type: 'model_comparison' as const,
        status: 'completed' as const,
        startTime,
        endTime,
        results: {
          prompt: request.prompt,
          models: request.models.map((m) => ({
            provider: m.provider,
            model: m.model,
          })),
          evaluationCriteria: request.evaluationCriteria,
          results,
        },
        metadata: {
          duration,
          iterations,
          confidence: this.calculateConfidence(results),
        },
      };

      const experiment = new this.experimentModel(experimentData);
      await experiment.save();

      return {
        id: experiment._id.toString(),
        name: experiment.name,
        type: experiment.type,
        status: experiment.status,
        startTime: experiment.startTime.toISOString(),
        endTime: experiment.endTime?.toISOString(),
        results: experiment.results,
        metadata: experiment.metadata,
        userId: (
          experiment.userId as unknown as { toString(): string }
        ).toString(),
        createdAt: experiment.createdAt,
      };
    } catch (error) {
      this.logger.error('Error running model comparison:', error.message);
      throw error;
    }
  }

  /**
   * Get experiment by ID
   */
  async getExperimentById(
    experimentId: string,
    userId: string,
  ): Promise<ExperimentResult | null> {
    try {
      const experiment = await this.experimentModel
        .findOne({
          _id: experimentId,
          userId,
        })
        .lean();

      if (!experiment) {
        return null;
      }

      return {
        id: experiment._id.toString(),
        name: experiment.name,
        type: experiment.type,
        status: experiment.status,
        startTime: experiment.startTime.toISOString(),
        endTime: experiment.endTime?.toISOString(),
        results: experiment.results,
        metadata: experiment.metadata || {
          duration: 0,
          iterations: 1,
          confidence: 0.5,
        },
        userId: (
          experiment.userId as unknown as { toString(): string }
        ).toString(),
        createdAt: experiment.createdAt,
      };
    } catch (error) {
      this.logger.error('Error getting experiment by ID:', error.message);
      return null;
    }
  }

  /**
   * Delete experiment
   */
  async deleteExperiment(experimentId: string, userId: string): Promise<void> {
    try {
      await this.experimentModel.deleteOne({
        _id: experimentId,
        userId,
      });
    } catch (error) {
      this.logger.error('Error deleting experiment:', error.message);
      throw error;
    }
  }

  /**
   * Perform basic quality evaluation based on evaluation criteria
   */
  private async performBasicQualityEvaluation(
    prompt: string,
    response: string,
    criteria: string[],
  ): Promise<number> {
    if (!response || response.trim().length === 0) {
      return 0;
    }

    let totalScore = 0;
    let criteriaCount = 0;

    // Basic heuristics for common criteria
    for (const criterion of criteria) {
      criteriaCount++;

      switch (criterion.toLowerCase()) {
        case 'relevance':
          // Check if response addresses the prompt
          const promptWords = prompt.toLowerCase().split(/\s+/);
          const responseWords = response.toLowerCase().split(/\s+/);
          const commonWords = promptWords.filter(
            (word) => word.length > 3 && responseWords.includes(word),
          );
          totalScore += Math.min(
            (commonWords.length / promptWords.length) * 100,
            100,
          );
          break;

        case 'coherence':
          // Check for sentence structure and readability
          const sentences = response
            .split(/[.!?]+/)
            .filter((s) => s.trim().length > 0);
          const avgSentenceLength = response.length / sentences.length;
          totalScore +=
            avgSentenceLength > 20 && avgSentenceLength < 200 ? 85 : 50;
          break;

        case 'accuracy':
          // Basic check for factual content (hard to evaluate without domain knowledge)
          totalScore +=
            response.includes("I don't know") || response.includes('uncertain')
              ? 60
              : 80;
          break;

        case 'completeness':
          // Check response length as proxy for completeness
          const wordCount = response.split(/\s+/).length;
          totalScore += wordCount > 50 ? 90 : wordCount > 20 ? 70 : 40;
          break;

        case 'creativity':
          // Check for varied vocabulary
          const uniqueWords = new Set(response.toLowerCase().split(/\s+/));
          const uniquenessRatio =
            uniqueWords.size / response.split(/\s+/).length;
          totalScore +=
            uniquenessRatio > 0.6 ? 85 : uniquenessRatio > 0.4 ? 70 : 50;
          break;

        default:
          // Default score for unknown criteria
          totalScore += 75;
          break;
      }
    }

    return Math.round(totalScore / criteriaCount);
  }

  /**
   * Estimate token count for a text
   */
  private estimateTokenCount(input: string, output: string): number {
    // Rough estimation: ~4 characters per token
    const totalChars = input.length + output.length;
    return Math.ceil(totalChars / 4);
  }

  /**
   * Calculate confidence score for experiment results
   */
  private calculateConfidence(results: ModelComparisonResult[]): number {
    if (results.length === 0) return 0;

    const successfulResults = results.filter((r) => r.metrics.errorRate === 0);

    // Base confidence on success rate and quality consistency
    const successRate = successfulResults.length / results.length;
    const qualityVariance = this.calculateVariance(
      successfulResults.map((r) => r.metrics.qualityScore),
    );

    // Lower variance = higher confidence, higher success rate = higher confidence
    const varianceScore = Math.max(0, 100 - qualityVariance);
    const successScore = successRate * 100;

    return Math.round((varianceScore + successScore) / 2);
  }

  /**
   * Calculate variance of an array of numbers
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const variance =
      squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

    return variance;
  }

  /**
   * Estimate experiment cost
   */
  async estimateExperimentCost(
    type: string,
    parameters: any,
  ): Promise<ExperimentCostEstimate> {
    try {
      let estimatedCost = 0;
      const breakdown: Record<string, number> = {};
      let duration = 0;

      switch (type) {
        case 'model_comparison':
          const models = parameters.models || [];
          const iterations = parameters.iterations || 1;
          const promptLength = parameters.prompt?.length || 0;

          // More accurate token estimation (4 chars ≈ 1 token)
          const inputTokens = Math.ceil(promptLength / 4);
          // Estimate output tokens based on typical completion ratio
          const outputTokens = Math.ceil(inputTokens * 1.5);

          for (const model of models) {
            const pricing = MODEL_PRICING.find(
              (p) =>
                p.modelId === model.model ||
                p.modelName.toLowerCase().includes(model.model.toLowerCase()),
            );
            if (pricing) {
              const modelCost =
                (pricing.inputPrice * inputTokens +
                  pricing.outputPrice * outputTokens) /
                1000000;
              const totalCost = modelCost * iterations;
              breakdown[model.model] = totalCost;
              estimatedCost += totalCost;
            }
          }

          // Realistic duration based on model count and iterations
          duration = models.length * iterations * 2; // 2 seconds per model per iteration
          break;

        case 'what_if':
          // Analysis cost - free, just computational
          estimatedCost = 0;
          breakdown['analysis'] = 0;
          duration = 1; // 1 second for analysis
          break;

        case 'fine_tuning':
          // Analysis cost - free, just computational
          estimatedCost = 0;
          breakdown['analysis'] = 0;
          duration = 2; // 2 seconds for analysis
          break;

        default:
          estimatedCost = 0.01;
          breakdown['unknown'] = 0.01;
          duration = 1;
      }

      return {
        estimatedCost,
        breakdown,
        duration,
      };
    } catch (error) {
      this.logger.error('Error estimating experiment cost:', error.message);
      return {
        estimatedCost: 0.01,
        breakdown: { error: 0.01 },
        duration: 1,
      };
    }
  }

  /**
   * Get experiment recommendations based on usage patterns
   */
  async getExperimentRecommendations(userId: string): Promise<
    Array<{
      type: string;
      title: string;
      description: string;
      potentialSavings: number;
      confidence: number;
      actionItems: string[];
    }>
  > {
    try {
      // Analyze usage patterns to generate recommendations
      const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
      const recommendations =
        await this.generateExperimentRecommendations(usageAnalysis);

      return recommendations;
    } catch (error) {
      this.logger.error(
        'Error getting experiment recommendations:',
        error.message,
      );
      return [];
    }
  }

  /**
   * Get what-if scenarios for a user
   */
  async getWhatIfScenarios(userId: string): Promise<WhatIfScenarioInterface[]> {
    try {
      const scenarios = await this.whatIfScenarioModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .lean();

      return scenarios.map((scenario) => ({
        id: scenario._id.toString(),
        name: scenario.name,
        description: scenario.description,
        changes: scenario.changes,
        timeframe: scenario.timeframe,
        baselineData: scenario.baselineData,
        status: scenario.status,
        isUserCreated: scenario.isUserCreated,
        createdAt: scenario.createdAt,
        analysis: scenario.analysis,
      }));
    } catch (error) {
      this.logger.error('Error getting what-if scenarios:', error.message);
      return [];
    }
  }

  /**
   * Create what-if scenario
   */
  async createWhatIfScenario(
    userId: string,
    scenarioData: CreateWhatIfScenarioRequest,
  ): Promise<WhatIfScenarioInterface> {
    try {
      // Check if scenario with same name already exists for this user
      const existingScenario = await this.whatIfScenarioModel.findOne({
        userId,
        name: scenarioData.name,
      });

      let finalName = scenarioData.name;
      if (existingScenario) {
        // Generate a unique name by adding a timestamp
        const timestamp = Date.now();
        finalName = `${scenarioData.name} (${timestamp})`;

        this.logger.log(
          `Scenario name "${scenarioData.name}" already exists. Using unique name: "${finalName}"`,
        );
      }

      const scenario = {
        userId,
        name: finalName,
        description: scenarioData.description,
        changes: scenarioData.changes,
        timeframe: scenarioData.timeframe,
        baselineData: scenarioData.baselineData,
        status: 'created' as const,
        isUserCreated: true,
      };

      const savedScenario = new this.whatIfScenarioModel(scenario);
      await savedScenario.save();

      this.logger.log(
        `Created and stored what-if scenario: ${finalName} for user: ${userId}`,
      );

      return {
        id: savedScenario._id.toString(),
        name: savedScenario.name,
        description: savedScenario.description,
        changes: savedScenario.changes,
        timeframe: savedScenario.timeframe,
        baselineData: savedScenario.baselineData,
        status: savedScenario.status,
        isUserCreated: savedScenario.isUserCreated,
        createdAt: savedScenario.createdAt,
        analysis: savedScenario.analysis,
      };
    } catch (error) {
      this.logger.error('Error creating what-if scenario:', error.message);
      throw error;
    }
  }

  /**
   * Run real-time what-if simulation
   */
  async runRealTimeWhatIfSimulation(
    simulationRequest: WhatIfSimulationRequest,
  ): Promise<WhatIfSimulationResult> {
    try {
      const {
        prompt,
        currentModel,
        simulationType,
        options = {},
      } = simulationRequest;

      let currentCost = 0;
      const optimizedOptions: any[] = [];
      const recommendations: any[] = [];

      switch (simulationType) {
        case 'prompt_optimization':
          if (prompt && currentModel) {
            currentCost = await this.calculatePromptCost(prompt, currentModel);
            const optimizedPrompts = await this.simulatePromptOptimization(
              prompt,
              currentModel,
            );
            optimizedOptions.push(...optimizedPrompts);
          }
          break;

        case 'context_trimming':
          if (prompt && currentModel) {
            currentCost = await this.calculatePromptCost(prompt, currentModel);
            const trimmedOptions = await this.simulateContextTrimming(
              prompt,
              currentModel,
              options.trimPercentage || 20,
            );
            optimizedOptions.push(...trimmedOptions);
          }
          break;

        case 'model_comparison':
          if (prompt && options.alternativeModels) {
            const alternatives = await this.simulateModelAlternatives(
              prompt,
              options.alternativeModels,
              currentModel || '',
            );
            optimizedOptions.push(...alternatives);
          }
          break;

        default:
          // Real-time analysis
          recommendations.push({
            type: 'analysis',
            description: 'Real-time cost analysis completed',
            savings: 0,
          });
      }

      // Calculate potential savings
      const potentialSavings = optimizedOptions.reduce(
        (total, opt) => total + (opt.savings || 0),
        0,
      );
      const confidence = optimizedOptions.length > 0 ? 0.8 : 0.5;

      return {
        currentCost,
        optimizedOptions,
        recommendations,
        potentialSavings,
        confidence,
      };
    } catch (error) {
      this.logger.error(
        'Error running real-time what-if simulation:',
        error.message,
      );
      throw error;
    }
  }

  /**
   * Run what-if analysis for a scenario
   */
  async runWhatIfAnalysis(userId: string, scenarioName: string): Promise<any> {
    try {
      const scenario = await this.whatIfScenarioModel.findOne({
        userId,
        name: scenarioName,
      });

      if (!scenario) {
        throw new Error('Scenario not found');
      }

      // Generate AI-based analysis
      const usageAnalysis =
        await this.generateAIBasedUsageAnalysis(scenarioName);
      const scenarioAnalysis = await this.generateAIScenarioAnalysis(
        scenarioName,
        usageAnalysis,
      );

      // Update scenario with analysis
      scenario.analysis = scenarioAnalysis;
      await scenario.save();

      return scenarioAnalysis;
    } catch (error) {
      this.logger.error('Error running what-if analysis:', error.message);
      throw error;
    }
  }

  /**
   * Delete what-if scenario
   */
  async deleteWhatIfScenario(
    userId: string,
    scenarioName: string,
  ): Promise<void> {
    try {
      await this.whatIfScenarioModel.deleteOne({
        userId,
        name: scenarioName,
      });
    } catch (error) {
      this.logger.error('Error deleting what-if scenario:', error.message);
      throw error;
    }
  }

  /**
   * Get fine-tuning analysis
   */
  async getFineTuningAnalysis(userId: string, projectId: string): Promise<any> {
    try {
      const usageAnalysis = await this.analyzeUserUsagePatterns(userId);
      const roi = await this.calculateIntelligentFineTuningROI(
        {},
        usageAnalysis,
      );

      return {
        projectId,
        analysis: usageAnalysis,
        roi,
        recommendations:
          await this.generateModelOptimizationScenario(usageAnalysis),
      };
    } catch (error) {
      this.logger.error('Error getting fine-tuning analysis:', error.message);
      throw error;
    }
  }

  /**
   * Analyze user usage patterns
   */
  private async analyzeUserUsagePatterns(userId: string): Promise<any> {
    try {
      const usageData = await this.usageModel
        .find({ userId })
        .limit(1000)
        .lean();

      // Basic analysis - in production this would be more sophisticated
      const totalCost = usageData.reduce(
        (sum, usage) => sum + (usage.cost || 0),
        0,
      );
      const modelUsage = usageData.reduce(
        (acc, usage) => {
          acc[usage.model] = (acc[usage.model] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      return {
        totalRequests: usageData.length,
        totalCost,
        modelDistribution: modelUsage,
        averageCostPerRequest: totalCost / usageData.length,
        patterns: {
          highUsageModels: Object.entries(modelUsage)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([model, count]) => ({ model, count })),
        },
      };
    } catch (error) {
      this.logger.error('Error analyzing user usage patterns:', error.message);
      return {
        totalRequests: 0,
        totalCost: 0,
        modelDistribution: {},
        averageCostPerRequest: 0,
        patterns: { highUsageModels: [] },
      };
    }
  }

  /**
   * Generate experiment recommendations
   */
  private async generateExperimentRecommendations(usageAnalysis: any): Promise<
    Array<{
      type: string;
      title: string;
      description: string;
      potentialSavings: number;
      confidence: number;
      actionItems: string[];
    }>
  > {
    const recommendations = [];

    // Model comparison recommendation
    if (usageAnalysis.patterns?.highUsageModels?.length > 1) {
      recommendations.push({
        type: 'model_comparison',
        title: 'Compare Alternative Models',
        description: `Compare ${usageAnalysis.patterns.highUsageModels[0]?.model} with cheaper alternatives`,
        potentialSavings: usageAnalysis.totalCost * 0.2, // Estimate 20% savings
        confidence: 0.8,
        actionItems: [
          'Run model comparison experiment',
          'Evaluate cost-performance tradeoffs',
          'Update model selection logic',
        ],
      });
    }

    // Fine-tuning recommendation
    if (usageAnalysis.totalRequests > 100) {
      recommendations.push({
        type: 'fine_tuning',
        title: 'Consider Fine-tuning',
        description:
          'Fine-tune models for your specific use cases to reduce costs',
        potentialSavings: usageAnalysis.totalCost * 0.3, // Estimate 30% savings
        confidence: 0.7,
        actionItems: [
          'Analyze usage patterns',
          'Prepare training data',
          'Evaluate fine-tuning ROI',
        ],
      });
    }

    return recommendations;
  }

  /**
   * Calculate prompt cost
   */
  private async calculatePromptCost(
    prompt: string,
    model: string,
  ): Promise<number> {
    const inputTokens = Math.ceil(prompt.length / 4);
    const pricing = MODEL_PRICING.find((p) =>
      p.modelName.toLowerCase().includes(model.toLowerCase()),
    );
    if (pricing) {
      return (pricing.inputPrice * inputTokens) / 1000000;
    }
    return 0.01;
  }

  /**
   * Simulate context trimming
   */
  private async simulateContextTrimming(
    prompt: string,
    model: string,
    trimPercentage: number,
  ): Promise<any[]> {
    const originalCost = await this.calculatePromptCost(prompt, model);
    const trimmedLength = Math.floor(
      prompt.length * (1 - trimPercentage / 100),
    );
    const trimmedPrompt = prompt.substring(0, trimmedLength);
    const trimmedCost = await this.calculatePromptCost(trimmedPrompt, model);

    return [
      {
        type: 'context_trimming',
        originalLength: prompt.length,
        trimmedLength,
        trimPercentage,
        originalCost,
        trimmedCost,
        savings: originalCost - trimmedCost,
        description: `Trim ${trimPercentage}% of context to save $${(originalCost - trimmedCost).toFixed(4)}`,
      },
    ];
  }

  /**
   * Simulate model alternatives
   */
  private async simulateModelAlternatives(
    prompt: string,
    alternativeModels: string[],
    currentModel: string,
  ): Promise<any[]> {
    const results = [];

    for (const altModel of alternativeModels) {
      const altCost = await this.calculatePromptCost(prompt, altModel);
      const currentCost = await this.calculatePromptCost(prompt, currentModel);

      results.push({
        model: altModel,
        cost: altCost,
        savings: currentCost - altCost,
        efficiency:
          currentCost > 0 ? ((currentCost - altCost) / currentCost) * 100 : 0,
      });
    }

    return results.sort((a, b) => b.savings - a.savings);
  }

  /**
   * Simulate prompt optimization
   */
  private async simulatePromptOptimization(
    prompt: string,
    model: string,
  ): Promise<any[]> {
    // Simple optimization: remove redundant words and shorten
    const optimizedPrompt = prompt
      .replace(/\s+/g, ' ')
      .replace(/very\s+/g, '')
      .replace(/really\s+/g, '')
      .trim();

    const originalCost = await this.calculatePromptCost(prompt, model);
    const optimizedCost = await this.calculatePromptCost(
      optimizedPrompt,
      model,
    );

    return [
      {
        type: 'prompt_optimization',
        originalLength: prompt.length,
        optimizedLength: optimizedPrompt.length,
        originalCost,
        optimizedCost,
        savings: originalCost - optimizedCost,
        description: `Optimized prompt to save $${(originalCost - optimizedCost).toFixed(4)}`,
      },
    ];
  }

  /**
   * Generate AI-based usage analysis
   */
  private async generateAIBasedUsageAnalysis(
    scenarioName: string,
  ): Promise<any> {
    try {
      // Create AI prompt for usage analysis
      const analysisPrompt = `
Analyze the usage patterns for scenario: "${scenarioName}"

Please provide insights about usage patterns, trends, and recommendations for optimization.
Focus on:
1. Usage patterns and anomalies
2. Cost optimization opportunities
3. Performance trends
4. Recommendations for improvement

Return your analysis in JSON format with the following structure:
{
  "insights": ["array of key insights"],
  "trends": ["array of identified trends"],
  "recommendations": ["array of specific recommendations"]
}
`;

      // Use Bedrock for AI analysis
      const analysisResponse = await BedrockService.invokeModel(
        analysisPrompt,
        'amazon.nova-pro-v1:0',
      );

      // Extract and parse JSON response
      const responseStr = typeof analysisResponse === 'string' ? analysisResponse : (analysisResponse as { response?: string })?.response ?? '';
      const extractedJson = await BedrockService.extractJson(responseStr);

      try {
        const parsedAnalysis = JSON.parse(extractedJson);

        return {
          scenarioName,
          insights: parsedAnalysis.insights || ['Analysis completed'],
          trends: parsedAnalysis.trends || ['Usage patterns analyzed'],
          recommendations: parsedAnalysis.recommendations || [
            'Review usage patterns regularly',
          ],
        };
      } catch (parseError) {
        this.logger.warn(
          'Failed to parse AI usage analysis JSON, using fallback',
          parseError,
        );
        // Fallback to basic analysis
        return {
          scenarioName,
          insights: ['AI analysis completed with parsing issues'],
          trends: ['Usage data processed'],
          recommendations: ['Review AI model selection', 'Monitor usage costs'],
        };
      }
    } catch (error) {
      this.logger.error(
        'AI-based usage analysis failed, using static fallback',
        error,
      );
      // Fallback to static analysis if AI fails
      return {
        scenarioName,
        insights: ['Usage pattern analysis completed'],
        trends: ['Cost optimization opportunities identified'],
        recommendations: ['Consider model switching', 'Implement caching'],
      };
    }
  }

  /**
   * Generate AI scenario analysis
   */
  private async generateAIScenarioAnalysis(
    scenarioName: string,
    usageAnalysis: any,
  ): Promise<any> {
    return {
      scenarioName,
      projections: {
        currentCost: usageAnalysis.totalCost,
        projectedCost: usageAnalysis.totalCost * 0.8,
        savings: usageAnalysis.totalCost * 0.2,
      },
      confidence: 0.75,
      assumptions: [
        'Based on historical usage patterns',
        'Market conditions stable',
      ],
      risks: ['Model availability', 'Performance degradation'],
    };
  }

  /**
   * Calculate intelligent fine-tuning ROI
   */
  private async calculateIntelligentFineTuningROI(
    modelStats: any,
    usageAnalysis: any,
  ): Promise<any> {
    // Use modelStats for more dynamic estimation
    // Assume modelStats provides trainingCostEstimate and expectedSavingsPercent if present
    const trainingCost =
      typeof modelStats.trainingCostEstimate === 'number'
        ? modelStats.trainingCostEstimate
        : 100; // fallback if absent

    const savingsPercent =
      typeof modelStats.expectedSavingsPercent === 'number'
        ? modelStats.expectedSavingsPercent
        : 0.25; // fallback to 25%

    const monthlySavings = usageAnalysis.totalCost * savingsPercent;

    // Avoid division by zero
    const monthsToROI =
      monthlySavings > 0 ? trainingCost / monthlySavings : null;

    return {
      trainingCost,
      monthlySavings,
      monthsToROI: monthsToROI !== null ? Math.ceil(monthsToROI) : null,
      annualSavings: monthlySavings * 12,
      netBenefit: monthlySavings * 12 - trainingCost,
      modelStatsUsed: {
        trainingCostEstimate: modelStats.trainingCostEstimate,
        expectedSavingsPercent: modelStats.expectedSavingsPercent,
      },
    };
  }

  /**
   * Generate model optimization scenario
   */
  private async generateModelOptimizationScenario(
    analysis: any,
  ): Promise<any[]> {
    return [
      {
        type: 'model_switching',
        description:
          'Switch to more cost-effective models for high-volume tasks',
        potentialSavings: analysis.totalCost * 0.15,
        implementation: 'Update model routing logic',
      },
      {
        type: 'caching',
        description: 'Implement semantic caching for repeated queries',
        potentialSavings: analysis.totalCost * 0.2,
        implementation: 'Add caching layer',
      },
    ];
  }
}
