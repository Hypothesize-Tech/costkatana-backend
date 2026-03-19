/**
 * Optimization Service (NestJS)
 *
 * Core service for prompt optimization, integrating with Cortex for advanced AI-powered
 * optimization, semantic compression, and intelligent model routing.
 */

import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import mongoose from 'mongoose';
import { Optimization } from '../../schemas/core/optimization.schema';
import { OptimizationConfig } from '../../schemas/core/optimization-config.schema';
import { User } from '../../schemas/user/user.schema';
import { Usage } from '../../schemas/core/usage.schema';
import { Activity } from '../../schemas/logging/activity.schema';
import { Alert } from '../../schemas/core/alert.schema';

// 🚀 NEW CORTEX IMPORTS - ADVANCED STREAMING
import { CortexCoreService } from '../cortex/services/cortex-core.service';
import { CortexEncoderService } from '../cortex/services/cortex-encoder.service';
import { CortexDecoderService } from '../cortex/services/cortex-decoder.service';
import { CortexVocabularyService } from '../cortex/services/cortex-vocabulary.service';
import { CortexCacheService } from '../cortex/services/cortex-cache.service';
import { AIRouterService } from '../cortex/services/ai-router.service';
import { CortexLispInstructionGeneratorService } from '../cortex/services/cortex-lisp-instruction-generator.service';
import { CortexTrainingDataCollectorService } from '../cortex/services/cortex-training-data-collector.service';
import {
  CortexAnalyticsService,
  CortexImpactMetrics,
} from '../cortex/services/cortex-analytics.service';

// 🚀 ADVANCED STREAMING ORCHESTRATOR
import { CortexStreamingOrchestratorService } from '../cortex/services/cortex-streaming-orchestrator.service';

// 🎯 STRATEGIC POLICIES - Make implicit tradeoffs explicit
import {
  getStrategicPolicies,
  getFallbackPricing,
  CortexOperationType,
} from '../cortex/config/strategic-policies.config';

// Services
import { PricingService } from '../utils/services/pricing.service';
import { TokenCounterService } from '../utils/services/token-counter.service';
import { OptimizationUtilsService } from '../utils/services/optimization-utils.service';
import { CalculationUtilsService } from '../utils/services/calculation-utils.service';

// Compiler services
import { PromptCompilerService } from '../compiler/services/prompt-compiler.service';
import { ParallelExecutionOptimizerService } from '../compiler/services/parallel-execution-optimizer.service';

// Proactive services
import { ProactiveSuggestionsService } from '../proactive-suggestions/services/proactive-suggestions.service';
import { OptimizationFeedbackLoopService } from '../proactive-suggestions/services/optimization-feedback-loop.service';

// DTOs
import { CreateOptimizationDto } from './dto/create-optimization.dto';
import { OptimizationResultDto } from './dto/optimization-response.dto';
import { PaginationQueryDto, FeedbackDto } from './dto/optimization-query.dto';

// Request fusion and bulk optimization (Express parity)
import {
  suggestRequestFusion,
  estimateTokens,
  providerEnumToString,
  FusionRequest,
} from '../../utils/optimizationUtils';
import { calculateCost } from '../../utils/pricing';
import { AIProvider } from '../../utils/modelDiscovery.types';
import { buildRequestTrackingFromRequest } from '../../common/utils/request-tracking.util';
import type { Request } from 'express';

@Injectable()
export class OptimizationService implements OnModuleDestroy {
  private readonly logger = new Logger(OptimizationService.name);

  // 🚀 NEW CORTEX SERVICES FOR META-LANGUAGE PROCESSING
  private cortexEncoderService: CortexEncoderService;
  private cortexDecoderService: CortexDecoderService;
  private cortexCoreService: CortexCoreService;
  private streamingOrchestrator: CortexStreamingOrchestratorService;
  private cortexInitialized = false;

  // Background processing queue
  private backgroundQueue: Array<() => Promise<void>> = [];
  private backgroundProcessor?: NodeJS.Timeout;

  // Token estimation memoization
  private tokenEstimationCache = new Map<string, number>();
  private readonly TOKEN_CACHE_SIZE = parseInt(
    process.env.TOKEN_CACHE_SIZE || '1000',
    10,
  );

  // Performance optimization flags
  private readonly ENABLE_PARALLEL_PROCESSING =
    process.env.ENABLE_PARALLEL_PROCESSING !== 'false';
  private readonly ENABLE_BACKGROUND_PROCESSING =
    process.env.ENABLE_BACKGROUND_PROCESSING !== 'false';

  // Circuit breaker for Cortex operations
  private cortexFailureCount = 0;
  private lastCortexFailureTime = 0;
  private readonly MAX_CORTEX_FAILURES = parseInt(
    process.env.MAX_CORTEX_FAILURES || '3',
    10,
  );
  private readonly CORTEX_CIRCUIT_BREAKER_RESET_TIME = parseInt(
    process.env.CORTEX_CIRCUIT_BREAKER_RESET_TIME || String(5 * 60 * 1000),
    10,
  ); // 5 minutes

  constructor(
    @InjectModel(Optimization.name)
    private optimizationModel: Model<Optimization>,
    @InjectModel(OptimizationConfig.name)
    private optimizationConfigModel: Model<OptimizationConfig>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(Activity.name) private activityModel: Model<Activity>,
    @InjectModel(Alert.name) private alertModel: Model<Alert>,
    private configService: ConfigService,

    // Cortex services injected
    private cortexCoreServiceInjected: CortexCoreService,
    private cortexEncoderServiceInjected: CortexEncoderService,
    private cortexDecoderServiceInjected: CortexDecoderService,
    private cortexCacheService: CortexCacheService,
    private cortexLispInstructionGenerator: CortexLispInstructionGeneratorService,
    private aiRouterService: AIRouterService,
    private cortexStreamingOrchestrator: CortexStreamingOrchestratorService,
    private cortexTrainingDataCollector: CortexTrainingDataCollectorService,
    private cortexAnalyticsService: CortexAnalyticsService,
    private cortexVocabularyService: CortexVocabularyService,

    // Utils
    private pricingService: PricingService,
    private tokenCounterService: TokenCounterService,
    private optimizationUtilsService: OptimizationUtilsService,
    private calculationUtilsService: CalculationUtilsService,

    // Compiler services
    private promptCompilerService: PromptCompilerService,
    private parallelExecutionOptimizerService: ParallelExecutionOptimizerService,

    // Proactive services
    @Inject(forwardRef(() => ProactiveSuggestionsService))
    private readonly proactiveSuggestionsService: ProactiveSuggestionsService,
    @Inject(forwardRef(() => OptimizationFeedbackLoopService))
    private readonly optimizationFeedbackLoopService: OptimizationFeedbackLoopService,
  ) {
    // Initialize Cortex services
    this.initializeCortexServices();
  }

  /**
   * Initialize Cortex services for meta-language processing
   */
  private async initializeCortexServices(): Promise<void> {
    if (this.cortexInitialized) return;

    try {
      this.logger.log('🚀 Initializing Cortex meta-language services...');

      // Initialize services in parallel
      const [encoder, core, decoder, streaming] = await Promise.all([
        Promise.resolve(this.cortexEncoderServiceInjected),
        Promise.resolve(this.cortexCoreServiceInjected),
        Promise.resolve(this.cortexDecoderServiceInjected),
        Promise.resolve(this.cortexStreamingOrchestrator),
      ]);

      this.cortexEncoderService = encoder;
      this.cortexCoreService = core;
      this.cortexDecoderService = decoder;
      this.streamingOrchestrator = streaming;

      // Initialize dependent services in parallel (if they expose initialize)
      await Promise.all([
        (
          this.cortexCoreService as { initialize?: () => Promise<void> }
        ).initialize?.() ?? Promise.resolve(),
        (
          this.cortexVocabularyService as { initialize?: () => Promise<void> }
        ).initialize?.() ?? Promise.resolve(),
        (
          this.streamingOrchestrator as { initialize?: () => Promise<void> }
        ).initialize?.() ?? Promise.resolve(),
      ]);

      this.cortexInitialized = true;
      this.logger.log('✅ Cortex services initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Cortex services', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without Cortex - graceful degradation
    }
  }

  /**
   * Record Cortex failure for circuit breaker
   */
  private recordCortexFailure(): void {
    this.cortexFailureCount++;
    this.lastCortexFailureTime = Date.now();
  }

  /**
   * Check if Cortex circuit breaker is open
   */
  private isCortexCircuitBreakerOpen(): boolean {
    if (this.cortexFailureCount >= this.MAX_CORTEX_FAILURES) {
      const timeSinceLastFailure = Date.now() - this.lastCortexFailureTime;
      if (timeSinceLastFailure < this.CORTEX_CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      } else {
        // Reset circuit breaker
        this.cortexFailureCount = 0;
        return false;
      }
    }
    return false;
  }

  /**
   * Graceful shutdown: reset circuit breaker, clear caches, stop background processor.
   */
  cleanup(): void {
    this.logger.log('OptimizationService cleanup called');
    this.cortexFailureCount = 0;
    this.lastCortexFailureTime = 0;
    this.tokenEstimationCache.clear();
    this.backgroundQueue.length = 0;
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.cleanup();
    await Promise.resolve();
  }

  /**
   * Process prompt using Cortex meta-language pipeline
   */
  private async processCortexOptimization(
    originalPrompt: string,
    cortexConfig: any,
    userId: string,
    model?: string,
    cortexOperation?: CortexOperationType,
  ): Promise<{
    optimizedPrompt: string;
    cortexMetadata: any;
    tokenReduction?: {
      originalTokens: number;
      cortexTokens: number;
      reductionPercentage: number;
    };
    impactMetrics?: CortexImpactMetrics;
  }> {
    const startTime = Date.now();

    // 🎯 Initialize training data collection (fire-and-forget)
    const sessionId = `cortex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trainingCollector = this.cortexTrainingDataCollector as any;

    trainingCollector.startSession?.(sessionId, userId, originalPrompt, {
      service: 'optimization',
      category: 'prompt_optimization',
      complexity:
        originalPrompt.length > 500
          ? 'complex'
          : originalPrompt.length > 100
            ? 'medium'
            : 'simple',
      language: 'en',
    });

    try {
      // 🎯 Step 0: Check semantic cache first
      this.logger.log('Checking Cortex semantic cache...', { userId });
      const cacheKey = `cortex_${crypto.createHash('sha256').update(originalPrompt).digest('hex')}`;
      const cachedResult = this.cortexCacheService.get(cacheKey) as
        | {
            optimizedPrompt?: string;
            createdAt?: Date;
            accessCount?: number;
            cortexMetadata?: any;
            tokenReduction?: any;
          }
        | undefined;

      if (
        cachedResult &&
        typeof cachedResult === 'object' &&
        cachedResult.optimizedPrompt != null
      ) {
        this.logger.log('Using cached Cortex result', {
          userId,
          cacheAge: cachedResult.createdAt
            ? Math.round(
                (Date.now() - new Date(cachedResult.createdAt).getTime()) /
                  60000,
              )
            : 0,
          accessCount: cachedResult.accessCount ?? 0,
          processingTime: Date.now() - startTime,
        });

        return {
          optimizedPrompt: cachedResult.optimizedPrompt,
          cortexMetadata: {
            ...(cachedResult.cortexMetadata ?? {}),
            processingTime: Date.now() - startTime,
            cacheHit: true,
            originalCacheTime: cachedResult.cortexMetadata?.processingTime ?? 0,
          },
          tokenReduction: cachedResult.tokenReduction,
        };
      }

      this.logger.log('Starting Cortex processing pipeline...', { userId });

      // Step 1: Encode natural language to Cortex
      this.logger.log('Step 1: Starting Cortex encoding...', { userId });
      const instructionService = this.cortexLispInstructionGenerator;
      const encodeFrame = {
        frameType: 'query' as const,
        question: originalPrompt,
      };
      const lispProgram = instructionService.generateInstructions(
        encodeFrame as any,
      );
      const lispInstructions = {
        encoderPrompt: originalPrompt,
        coreProcessorPrompt: originalPrompt,
        decoderPrompt: originalPrompt,
        ...lispProgram,
      };

      // 🎯 Collect LISP instructions (fire-and-forget)
      trainingCollector.collectLispInstructions?.(sessionId, {
        encoderPrompt: lispInstructions.encoderPrompt,
        coreProcessorPrompt: lispInstructions.coreProcessorPrompt,
        decoderPrompt: lispInstructions.decoderPrompt,
        model:
          cortexConfig.instructionGeneration?.model ||
          'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      });

      // Use initialized service or fallback to injected (init may not have completed yet)
      const encoderService =
        this.cortexEncoderService ?? this.cortexEncoderServiceInjected;
      if (!encoderService?.encode) {
        throw new Error(
          'Cortex encoder service not available. Ensure CortexModule is properly configured.',
        );
      }
      const encodingResult = await encoderService.encode({
        text: originalPrompt,
        language: 'en',
        userId,
        config: cortexConfig,
        prompt: lispInstructions.encoderPrompt,
      });

      if (encodingResult.error) {
        this.logger.error('Cortex encoding failed', {
          userId,
          error: encodingResult.error,
        });
        throw new Error(`Encoding failed: ${encodingResult.error}`);
      }
      this.logger.log('Step 1: Cortex encoding completed', {
        userId,
        frameType: (encodingResult.cortexFrame as any).frameType,
        confidence: encodingResult.confidence,
        originalText: originalPrompt,
        encodedCortex: JSON.stringify(encodingResult.cortexFrame, null, 2),
      });

      // 🎯 Collect encoder data (fire-and-forget)
      trainingCollector.collectEncoderData?.(sessionId, {
        inputText: originalPrompt,
        outputLisp: encodingResult.cortexFrame,
        confidence: encodingResult.confidence,
        processingTime: encodingResult.processingTime || 0,
        model:
          cortexConfig.encoding?.model ||
          'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      });

      // Step 2: Generate ANSWER in LISP format (NEW ARCHITECTURE)
      this.logger.log('Step 2: Generating answer in LISP format...', {
        userId,
        queryType: encodingResult.cortexFrame.frameType,
      });

      const coreService = this.cortexCoreService;

      /**
       * STRATEGIC DECISION: Cortex Operation Type
       *
       * ✅ FIXED: Now uses explicit policy configuration
       * TRADEOFF: Made explicit via strategicPolicies.config.ts
       *   ✅ Flexible: Supports 6 operation types
       *   ✅ Explicit: Request can override default
       *   ✅ Documented: Each operation has documented tradeoffs
       *
       * OPERATION TYPES:
       *   - optimize: General optimization (recommended default)
       *   - compress: Maximum token reduction (cost-critical)
       *   - analyze: Analysis without transformation
       *   - transform: Format conversion
       *   - sast: Semantic AST generation
       *   - answer: Legacy answer generation (backward compat)
       *
       * See: /docs/COST_PERFORMANCE_TRADEOFFS.md#1-cortex-operation-type
       *      /config/strategicPolicies.config.ts
       */
      const strategicPolicies = getStrategicPolicies();
      // When Cortex is used for optimization creation, default to 'answer' (Express parity)
      // so the pipeline produces actual answers, not compressed prompts
      const operationType =
        cortexOperation ||
        (cortexConfig?.processingOperation as CortexOperationType) ||
        (cortexConfig?.cortexOperation as CortexOperationType) ||
        'answer';

      this.logger.log(`Using Cortex operation: ${operationType}`, {
        requested: cortexOperation,
        default: strategicPolicies.cortexOperation.defaultOperation,
        tradeoff:
          strategicPolicies.cortexOperation.operationConfig[operationType]
            ?.tradeoff,
      });

      const allowedOps = [
        'optimize',
        'compress',
        'analyze',
        'transform',
        'sast',
        'answer',
      ] as const;
      const processOp = allowedOps.includes(operationType as any)
        ? operationType
        : 'optimize';
      const processingResult = await coreService.process({
        input: encodingResult.cortexFrame,
        operation: processOp as
          | 'optimize'
          | 'compress'
          | 'answer'
          | 'analyze'
          | 'sast'
          | 'transform',
        options: { preserveSemantics: true },
        prompt: lispInstructions.coreProcessorPrompt,
      });

      this.logger.log('Step 2: Answer generation completed', {
        userId,
        queryFrame: JSON.stringify(encodingResult.cortexFrame, null, 2),
        answerFrame: JSON.stringify(processingResult.output, null, 2),
        answerType: processingResult.output.frameType,
        isAnswer: processingResult.output.frameType === 'answer',
      });

      // 🎯 Collect core processor data (fire-and-forget)
      trainingCollector.collectCoreProcessorData?.(sessionId, {
        inputLisp: encodingResult.cortexFrame,
        outputLisp: processingResult.output,
        answerType: processingResult.output.frameType || 'answer',
        processingTime: processingResult.processingTime || 0,
        model: cortexConfig.coreProcessing?.model || 'claude-sonnet-4-5',
      });

      // Step 3: Decode LISP answer back to natural language (NEW ARCHITECTURE)
      this.logger.log('Step 3: Decoding LISP answer to natural language...', {
        userId,
        answerFrameType: processingResult.output.frameType,
      });

      const decoderService = this.cortexDecoderService;
      const decodingResult = await decoderService.decode({
        cortexStructure: processingResult.output,
        targetLanguage: 'en',
        style: cortexConfig.outputStyle || 'conversational',
        format: cortexConfig.outputFormat || 'plain',
        options: {
          enhanceReadability: true,
          isAnswer: true, // Flag to indicate this is an answer frame
        },
        prompt: lispInstructions.decoderPrompt,
      });

      this.logger.log('✅ Step 3: Answer decoding completed', {
        userId,
        lispAnswer: JSON.stringify(processingResult.output, null, 2),
        naturalLanguageAnswer: decodingResult.text,
        originalQuery: originalPrompt,
        answerLength: decodingResult.text.length,
        tokenReduction: `${Math.round(((originalPrompt.length - decodingResult.text.length) / originalPrompt.length) * 100)}%`,
      });

      // 🎯 Collect decoder data (fire-and-forget)
      trainingCollector.collectDecoderData?.(sessionId, {
        inputLisp: processingResult.output,
        outputText: decodingResult.text,
        style: cortexConfig.outputStyle || 'conversational',
        processingTime: decodingResult.processingTime || 0,
        model:
          cortexConfig.decoding?.model ||
          'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      });

      // Extract final answer content: prefer raw code/content from the frame
      // (mirrors Express backend: processedAnswer.code > processedAnswer.content > decodedOutput)
      // When content is code, wrap in markdown backticks so frontend code snippet components can render it.
      const answerFrame = processingResult.output as any;
      let finalAnswerContent = decodingResult.text; // default to decoded natural language
      if (
        answerFrame?.code &&
        typeof answerFrame.code === 'string' &&
        answerFrame.code.trim().length > 20
      ) {
        const lang = (answerFrame.language || 'text').toLowerCase();
        finalAnswerContent = `\n\`\`\`${lang}\n${answerFrame.code.trim()}\n\`\`\`\n`;
      } else if (
        answerFrame?.content &&
        typeof answerFrame.content === 'string' &&
        answerFrame.content.trim().length > 20
      ) {
        const lang = (answerFrame.language || 'text').toLowerCase();
        finalAnswerContent = `\n\`\`\`${lang}\n${answerFrame.content.trim()}\n\`\`\`\n`;
      } else if (
        decodingResult.text &&
        decodingResult.text !== 'Processing is complete and successful.' &&
        decodingResult.text !== 'Processing has been completed successfully.' &&
        decodingResult.text.trim().length > 50
      ) {
        finalAnswerContent = decodingResult.text;
      }

      // Token calculation: compare what the user sent (original prompt) vs the LISP-compressed
      // intermediate representation. This reflects true Cortex compression savings.
      // The final answer content length is NOT compared because answers are inherently longer.
      const lispAnswerTokens = Math.ceil(
        JSON.stringify(processingResult.output).length / 4,
      );
      // Original prompt tokens (what went in)
      const originalPromptTokens = Math.ceil(originalPrompt.length / 4);
      // The "optimized" token count is the LISP representation sent to the model, not the answer
      const finalResponseTokens = lispAnswerTokens;

      // Calculate ACTUAL token difference (LISP is usually more compact than original)
      const actualTokenDifference = originalPromptTokens - finalResponseTokens;
      const actualReductionPercentage =
        originalPromptTokens > 0
          ? (actualTokenDifference / originalPromptTokens) * 100
          : 0;

      const cortexMetadata = {
        processingTime: Date.now() - startTime,
        encodingConfidence: encodingResult.confidence,
        answerGenerated: processingResult.output.frameType === 'answer',
        decodingConfidence: decodingResult.confidence,
        cortexModel: {
          encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
          core: 'anthropic.claude-sonnet-4-6',
          decoder: 'mistral.mistral-large-3-675b-instruct',
        },
        // Use ACTUAL token difference (can be negative)
        tokensSaved: actualTokenDifference,
        reductionPercentage: actualReductionPercentage,
        semanticIntegrity: processingResult.metadata?.semanticIntegrity || 1.0,
        // Add debug info to understand what happened
        debug: {
          originalPromptTokens,
          finalResponseTokens,
          lispAnswerTokens,
          actualDifference: actualTokenDifference,
        },
      };

      this.logger.log('✅ Cortex processing completed successfully', {
        userId,
        processingTime: cortexMetadata.processingTime,
        tokensSaved: cortexMetadata.tokensSaved,
        reductionPercentage: `${cortexMetadata.reductionPercentage.toFixed(1)}%`,
      });

      // 💾 Cache the successful result for future use
      const tokenReductionData = {
        originalTokens: originalPromptTokens,
        cortexTokens: finalResponseTokens,
        reductionPercentage: actualReductionPercentage,
      };

      const setCacheKey = `cortex_${crypto.createHash('sha256').update(originalPrompt).digest('hex')}`;
      this.cortexCacheService.set(
        setCacheKey,
        {
          optimizedPrompt: finalAnswerContent,
          cortexMetadata,
          tokenReduction: tokenReductionData,
          createdAt: new Date(),
          accessCount: 0,
        } as any,
        { ttl: 3600000, type: 'processing' },
      );

      // Analyze the actual impact of Cortex optimization
      let impactMetrics: CortexImpactMetrics | undefined;
      try {
        this.logger.log('📊 Analyzing Cortex optimization impact...', {
          userId,
        });

        impactMetrics = await (
          this.cortexAnalyticsService as any
        ).analyzeOptimizationImpact?.(
          originalPrompt,
          JSON.stringify(processingResult.output),
          decodingResult.text,
          model || cortexConfig?.model || 'gpt-4',
        );

        this.logger.log('✅ Impact analysis completed', {
          userId,
          tokenSavings: impactMetrics?.tokenReduction?.percentageSavings,
          clarityScore: impactMetrics?.qualityMetrics?.clarityScore,
          confidenceScore: impactMetrics?.justification?.confidenceScore,
        });
      } catch (error) {
        this.logger.log('Failed to analyze Cortex impact', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 🎯 Finalize training data collection (fire-and-forget)
      const totalProcessingTime = Date.now() - startTime;
      trainingCollector.finalizeSession?.(sessionId, {
        totalProcessingTime,
        totalTokenReduction: tokenReductionData?.reductionPercentage || 0,
        tokenReductionPercentage: tokenReductionData?.reductionPercentage || 0,
        costSavings: (impactMetrics as any)?.costImpact?.costSavings || 0,
        qualityScore: impactMetrics?.qualityMetrics?.clarityScore || 0,
      });

      return {
        optimizedPrompt: finalAnswerContent,
        cortexMetadata,
        tokenReduction: tokenReductionData,
        impactMetrics,
      };
    } catch (error) {
      this.logger.log('❌ CORTEX FAILED - USING INTELLIGENT FALLBACK:', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        processingTime: Date.now() - startTime,
      });

      // AGGRESSIVE FALLBACK - bypass the broken system entirely
      const fallbackOptimizedPrompt =
        await this.createIntelligentOptimization(originalPrompt);
      return {
        optimizedPrompt: fallbackOptimizedPrompt,
        cortexMetadata: {
          processingTime: Date.now() - startTime,
          fallbackUsed: true,
          fallbackReason:
            'Cortex processing failed, using intelligent fallback',
          originalLength: originalPrompt.length,
          error: error instanceof Error ? error.message : String(error),
          cortexModel: {
            encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
            core: 'anthropic.claude-sonnet-4-6',
            decoder: 'mistral.mistral-large-3-675b-instruct',
          },
        },
        tokenReduction: this.calculateTokenReduction(
          originalPrompt,
          fallbackOptimizedPrompt,
        ),
      };
    }
  }

  /**
   * Create intelligent optimization that preserves semantic meaning
   * when AI systems fail
   */
  private async createIntelligentOptimization(
    originalPrompt: string,
  ): Promise<string> {
    this.logger.log('🛡️ LLM-BASED INTELLIGENT OPTIMIZATION: Starting', {
      originalLength: originalPrompt.length,
      optimizationMode: 'llm_based_preservation',
    });

    try {
      const optimizationPrompt = `CRITICAL: Remove ONLY unnecessary filler words. DO NOT:
- Change any facts, details, or meaning
- Remove specific information (error messages, numbers, names)
- Summarize or paraphrase
- Change the tone or urgency
- Remove context or background

KEEP EXACTLY:
- All technical details and error messages
- All specific requirements or tasks
- All important context and background
- The original meaning and intent
- All formatting instructions

Original prompt:
${originalPrompt}

Return the same prompt with only obvious filler words removed (like extra "just", "really", "actually", "basically", etc.).`;

      const optimizedResult = await this.aiRouterService.invokeModel({
        prompt: optimizationPrompt,
        model: 'amazon.nova-pro-v1:0',
      });

      const optimizedText =
        typeof optimizedResult?.response === 'string'
          ? optimizedResult.response
          : undefined;
      if (!optimizedText) {
        this.logger.log('🔄 LLM optimization failed, preserving original');
        return originalPrompt;
      }

      const optimizedPrompt = optimizedText.trim();

      // Validate the LLM optimization result
      // Check if optimization actually changed the prompt
      if (originalPrompt.trim() === optimizedPrompt.trim()) {
        this.logger.log(
          '⚠️ LLM optimization produced identical prompt, preserving original',
          {
            originalLength: originalPrompt.length,
            reason: 'no_changes_detected',
          },
        );
        return originalPrompt;
      }

      // Safety check: If optimization reduced length by more than 70%, it's likely summarizing not optimizing
      const reductionRatio =
        (originalPrompt.length - optimizedPrompt.length) /
        originalPrompt.length;
      if (reductionRatio > 0.7) {
        this.logger.log(
          '⚠️ LLM optimization reduced length too drastically, likely summarizing instead of optimizing',
          {
            originalLength: originalPrompt.length,
            optimizedLength: optimizedPrompt.length,
            reductionRatio: reductionRatio.toFixed(2),
            reason: 'excessive_reduction',
          },
        );
        return originalPrompt;
      }

      const validation = await this.validateLLMOptimization(
        originalPrompt,
        optimizedPrompt,
      );

      if (!validation.isValid) {
        this.logger.log(
          '⚠️ LLM optimization validation failed, preserving original',
          {
            validationIssues: validation.issues,
            optimizedLength: optimizedPrompt.length,
            originalLength: originalPrompt.length,
          },
        );
        return originalPrompt;
      }

      const reductionPercentage =
        ((originalPrompt.length - optimizedPrompt.length) /
          originalPrompt.length) *
        100;

      this.logger.log('✅ LLM-based intelligent optimization successful', {
        originalLength: originalPrompt.length,
        optimizedLength: optimizedPrompt.length,
        reductionPercentage: reductionPercentage.toFixed(1),
        validationPassed: true,
        informationLoss: 'none',
      });

      return optimizedPrompt;
    } catch (error) {
      this.logger.log('❌ LLM-based optimization failed, preserving original', {
        error: error instanceof Error ? error.message : String(error),
        originalLength: originalPrompt.length,
      });
      return originalPrompt; // Always preserve original on failure
    }
  }

  /**
   * Validate LLM optimization result using another LLM call
   */
  private async validateLLMOptimization(
    original: string,
    optimized: string,
  ): Promise<{
    isValid: boolean;
    issues: string[];
  }> {
    try {
      const validationPrompt = `CRITICAL VALIDATION: Compare these prompts and identify if ANY important information was lost.

ORIGINAL: ${original.substring(0, 400)}...
OPTIMIZED: ${optimized.substring(0, 400)}...

Check for:
1. Same facts and details?
2. Same meaning and intent?
3. Same technical information?
4. Same urgency/tone?
5. No semantic inversion (success vs failure)?

REPLY FORMAT (JSON only):
{"valid": true/false, "issues": ["specific issue 1", "specific issue 2"]}`;

      const validationResult = await this.aiRouterService.invokeModel({
        prompt: validationPrompt,
        model: 'amazon.nova-pro-v1:0',
      });

      const validationText =
        typeof validationResult?.response === 'string'
          ? validationResult.response
          : undefined;
      if (!validationText) {
        return { isValid: false, issues: ['Validation service unavailable'] };
      }

      try {
        // Extract JSON robustly from potentially mixed response
        const cleanedResult =
          this.extractJsonFromValidationResponse(validationText);
        const parsed = JSON.parse(cleanedResult);
        const isValid = parsed.valid === true;
        const issues = Array.isArray(parsed.issues) ? parsed.issues : [];

        // If only minimal changes (less than 20 chars difference), be more lenient
        const lengthDiff = Math.abs(original.length - optimized.length);
        if (lengthDiff < 20 && issues.length === 0) {
          this.logger.log(
            '✅ Accepting minimal optimization with no validation issues',
            {
              lengthDiff,
              originalLength: original.length,
              optimizedLength: optimized.length,
            },
          );
          return { isValid: true, issues: [] };
        }

        return { isValid, issues };
      } catch (parseError) {
        this.logger.log(
          'Failed to parse validation result, being lenient for small changes',
          {
            parseError:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          },
        );

        // For minimal changes, default to valid if parsing fails
        const lengthDiff = Math.abs(original.length - optimized.length);
        if (lengthDiff < 50) {
          // More lenient threshold
          return {
            isValid: true,
            issues: ['Validation parsing failed but minimal changes detected'],
          };
        }
        return { isValid: false, issues: ['Validation result parsing failed'] };
      }
    } catch (error) {
      this.logger.log('Validation service error', { error });
      return { isValid: false, issues: ['Validation service error'] };
    }
  }

  /**
   * Extract JSON from LLM validation response that might contain additional text
   */
  private extractJsonFromValidationResponse(response: string): string {
    let cleanedResult = response.trim();

    // Remove markdown code blocks
    cleanedResult = cleanedResult
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '');

    // Try to find JSON object - look for first { to matching }
    const firstBrace = cleanedResult.indexOf('{');
    if (firstBrace !== -1) {
      let braceCount = 0;
      let endIndex = -1;

      for (let i = firstBrace; i < cleanedResult.length; i++) {
        if (cleanedResult[i] === '{') braceCount++;
        else if (cleanedResult[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIndex = i;
            break;
          }
        }
      }

      if (endIndex !== -1) {
        return cleanedResult.substring(firstBrace, endIndex + 1);
      }
    }

    // Fallback: try regex match for simple JSON
    const jsonMatch = cleanedResult.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    // Last resort: return cleaned result
    return cleanedResult;
  }

  /**
   * Calculate token reduction metrics
   */
  private calculateTokenReduction(
    original: string,
    optimized: string,
  ): {
    originalTokens: number;
    cortexTokens: number;
    reductionPercentage: number;
  } {
    const originalTokens = original.length / 4; // Rough estimate
    const cortexTokens = optimized.length / 4;
    const reductionPercentage =
      ((originalTokens - cortexTokens) / originalTokens) * 100;

    return {
      originalTokens,
      cortexTokens,
      reductionPercentage: Math.max(0, reductionPercentage),
    };
  }

  /** Provider string for pricing/token APIs (Nest uses service string as-is). */
  private getAIProviderFromString(service: string): string {
    return service || 'openai';
  }

  private providerEnumToString(provider: string): string {
    const map: Record<string, string> = {
      openai: 'OpenAI',
      'aws-bedrock': 'AWS Bedrock',
      anthropic: 'Anthropic',
      google: 'Google',
      'google-ai': 'Google',
      cohere: 'Cohere',
      azure: 'Azure OpenAI',
      deepseek: 'DeepSeek',
      groq: 'Grok',
      huggingface: 'Hugging Face',
      ollama: 'Ollama',
      replicate: 'Replicate',
    };
    return map[provider?.toLowerCase()] ?? provider ?? 'OpenAI';
  }

  /** Token count with memoization (uses TokenCounterService). */
  private async getTokensWithMemoization(
    text: string,
    provider: string,
    model: string,
  ): Promise<number> {
    // Compose cache key from all arguments
    const cacheKey = `${text.substring(0, 100)}_${provider}_${model}`;
    if (this.tokenEstimationCache.has(cacheKey)) {
      return this.tokenEstimationCache.get(cacheKey)!;
    }
    const result = this.tokenCounterService.countTokens(text, { model });
    const tokens = result?.tokens ?? Math.ceil(text.length / 4);
    if (this.tokenEstimationCache.size >= this.TOKEN_CACHE_SIZE) {
      const first = this.tokenEstimationCache.keys().next().value;
      if (first) this.tokenEstimationCache.delete(first);
    }
    this.tokenEstimationCache.set(cacheKey, tokens);
    return tokens;
  }

  /** Build cost estimate shape for metadata (Nest pricing returns CostEstimate | null). */
  private convertToCostEstimate(
    simpleEstimate: {
      inputCost?: number;
      outputCost?: number;
      totalCost?: number;
    } | null,
    promptTokens: number,
    completionTokens: number,
    provider: string,
    model: string,
  ): {
    totalCost: number;
    breakdown: { inputCost: number; outputCost: number };
    details: {
      promptTokens: number;
      completionTokens: number;
      provider: string;
      model: string;
    };
  } {
    if (simpleEstimate && typeof simpleEstimate.totalCost === 'number') {
      return {
        totalCost: simpleEstimate.totalCost,
        breakdown: {
          inputCost: simpleEstimate.inputCost ?? 0,
          outputCost: simpleEstimate.outputCost ?? 0,
        },
        details: {
          promptTokens,
          completionTokens,
          provider,
          model,
        },
      };
    }
    return {
      totalCost: 0,
      breakdown: { inputCost: 0, outputCost: 0 },
      details: {
        promptTokens,
        completionTokens,
        provider,
        model,
      },
    };
  }

  private quickQualityChecks(
    response: string,
    original: string,
  ): { isObviouslyTerrible: boolean; reason?: string } {
    const r = response.trim().toLowerCase();
    if (['describe?', 'describe', 'what?', 'how?', 'why?'].includes(r)) {
      return {
        isObviouslyTerrible: true,
        reason: 'Exact match with terrible response',
      };
    }
    if (response.length < original.length * 0.05 && original.length > 50) {
      return {
        isObviouslyTerrible: true,
        reason: 'Extreme content reduction >95%',
      };
    }
    if (
      response.split(/\s+/).length === 1 &&
      original.split(/\s+/).length > 10
    ) {
      return {
        isObviouslyTerrible: true,
        reason: 'Single word response for complex input',
      };
    }
    if (response.trim().length === 0) {
      return { isObviouslyTerrible: true, reason: 'Empty response' };
    }
    return { isObviouslyTerrible: false };
  }

  private async isTerribleResponse(
    response: string,
    original: string,
  ): Promise<boolean> {
    const quick = this.quickQualityChecks(response, original);
    if (quick.isObviouslyTerrible) return true;
    try {
      const prompt = `Analyze optimization quality. Reply ONLY with valid JSON:\nORIGINAL: ${original.substring(0, 400)}...\nOPTIMIZED: ${response.substring(0, 400)}...\nIs the optimized version terrible? Reply: {"is_terrible": false, "quality_score": 8.5}`;
      const result = await this.aiRouterService.invokeModel({
        model: 'amazon.nova-pro-v1:0',
        prompt,
      });
      const raw = result?.response;
      if (!raw || typeof raw !== 'string') {
        return response.length < original.length * 0.3;
      }
      const jsonMatch = raw.trim().match(/\{[\s\S]*?\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      return (
        parsed.is_terrible === true ||
        (parsed.quality_score != null && parsed.quality_score < 6)
      );
    } catch {
      return response.length < original.length * 0.3;
    }
  }

  private determineCategoryFromType(type: string): string {
    const map: Record<string, string> = {
      prompt: 'prompt_reduction',
      compression: 'prompt_reduction',
      context_trimming: 'context_optimization',
      request_fusion: 'batch_processing',
      model: 'model_selection',
      caching: 'response_formatting',
      batching: 'batch_processing',
    };
    return map[type] ?? 'prompt_reduction';
  }

  /** Map provider string to AIProvider for request fusion. */
  private stringToAIProvider(provider: string): AIProvider {
    const lower = (provider || '').toLowerCase().replace(/\s+/g, '-');
    const map: Record<string, AIProvider> = {
      openai: AIProvider.OpenAI,
      anthropic: AIProvider.Anthropic,
      'aws-bedrock': AIProvider.AWSBedrock,
      'google-ai': AIProvider.Google,
      google: AIProvider.Google,
      cohere: AIProvider.Cohere,
      huggingface: AIProvider.HuggingFace,
      deepseek: AIProvider.DeepSeek,
      grok: AIProvider.Grok,
      ollama: AIProvider.Ollama,
      replicate: AIProvider.Replicate,
      azure: AIProvider.Azure,
    };
    return map[lower] ?? AIProvider.OpenAI;
  }

  /**
   * Create batch optimization with request fusion (Express parity).
   * Groups requests by provider/model, fuses them, and creates one Optimization per fusion group.
   */
  async createBatchOptimization(request: {
    userId: string;
    requests: Array<{
      id: string;
      prompt: string;
      timestamp: number;
      model: string;
      provider: string;
    }>;
    enableFusion?: boolean;
  }): Promise<Optimization[]> {
    const fusionRequests: FusionRequest[] = request.requests.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      timestamp: r.timestamp,
      model: r.model,
      provider: this.stringToAIProvider(r.provider),
    }));

    const { fusionGroups, details } = suggestRequestFusion(fusionRequests);
    const optimizations: Optimization[] = [];

    for (let i = 0; i < fusionGroups.length; i++) {
      const batch = fusionGroups[i];
      const detail = details[i];
      if (!batch.length || !detail) continue;

      let originalTotalCost = 0;
      let originalTotalTokens = 0;
      for (const req of batch) {
        const promptTokens = estimateTokens(req.prompt, req.provider);
        try {
          originalTotalCost += calculateCost(
            promptTokens,
            150,
            providerEnumToString(req.provider),
            req.model,
          );
        } catch {
          originalTotalCost +=
            (promptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.6;
        }
        originalTotalTokens += promptTokens + 150;
      }

      const fusedPrompt = batch.map((r) => r.prompt).join('\n\n---\n\n');
      const firstProvider = batch[0].provider;
      const firstModel = batch[0].model;
      const optimizedPromptTokens = estimateTokens(fusedPrompt, firstProvider);
      let optimizedCost = 0;
      try {
        optimizedCost = calculateCost(
          optimizedPromptTokens,
          150,
          providerEnumToString(firstProvider),
          firstModel,
        );
      } catch {
        optimizedCost =
          (optimizedPromptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.6;
      }
      const optimizedTokens = optimizedPromptTokens + 150;
      const tokensSaved = Math.max(0, originalTotalTokens - optimizedTokens);
      const costSaved = Math.max(0, originalTotalCost - optimizedCost);
      const improvementPercentage =
        originalTotalTokens > 0
          ? Math.max(0, (tokensSaved / originalTotalTokens) * 100)
          : 0;

      const optimization = await this.optimizationModel.create({
        userId: new mongoose.Types.ObjectId(request.userId),
        userQuery: request.requests.map((r) => r.prompt).join('\n\n---\n\n'),
        generatedAnswer: fusedPrompt,
        optimizationTechniques: ['request_fusion', detail.fusionStrategy],
        originalTokens: originalTotalTokens,
        optimizedTokens,
        tokensSaved,
        originalCost: originalTotalCost,
        optimizedCost,
        costSaved,
        improvementPercentage,
        service: String(batch[0].provider),
        model: firstModel,
        category: 'batch_processing',
        optimizationType: 'text',
        suggestions: [
          {
            type: 'request_fusion',
            description: `Fused ${batch.length} requests (${detail.fusionStrategy})`,
            impact:
              improvementPercentage > 30
                ? 'high'
                : improvementPercentage > 15
                  ? 'medium'
                  : 'low',
            implemented: true,
          },
        ],
        metadata: {
          fusionDetails: detail,
          originalRequestCount: request.requests.length,
          fusionStrategy: detail.fusionStrategy,
        },
      });
      optimizations.push(optimization);
    }

    return optimizations;
  }

  /**
   * Generate bulk optimizations by prompt IDs (Express parity).
   * Fetches Usage by promptIds and runs createOptimization in batches.
   */
  async generateBulkOptimizations(
    userId: string,
    promptIds: string[],
    options?: { cortexEnabled?: boolean; cortexConfig?: any },
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    optimizations: any[];
  }> {
    const prompts = await this.usageModel
      .find({
        userId: new mongoose.Types.ObjectId(userId),
        _id: { $in: promptIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
      .select('prompt service model')
      .lean();

    const BATCH_SIZE = 5;
    const optimizations: any[] = [];

    for (let i = 0; i < prompts.length; i += BATCH_SIZE) {
      const batch = prompts.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(
          async (promptData: {
            _id: unknown;
            prompt: string;
            service?: string;
            model?: string;
          }) => {
            try {
              const dto: CreateOptimizationDto = {
                userId,
                prompt: promptData.prompt,
                service: promptData.service ?? 'openai',
                model: promptData.model ?? 'gpt-4o-mini',
                options: options?.cortexEnabled
                  ? { enableCortex: true, cortexConfig: options.cortexConfig }
                  : undefined,
              };
              return await this.createOptimization(userId, dto);
            } catch (error) {
              this.logger.warn(
                `Bulk optimization failed for usage ${promptData._id}`,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              );
              return null;
            }
          },
        ),
      );
      optimizations.push(
        ...results.filter((r): r is NonNullable<typeof r> => r != null),
      );
    }

    return {
      total: promptIds.length,
      successful: optimizations.length,
      failed: promptIds.length - optimizations.length,
      optimizations,
    };
  }

  private async generatePromptCachingSuggestions(
    createDto: CreateOptimizationDto,
  ): Promise<any[]> {
    try {
      const suggestions: any[] = [];

      // Analyze prompt for caching opportunities
      const prompt = createDto.prompt;
      const promptLength = prompt.length;

      // Check if prompt is long enough for caching benefits
      const minPromptLengthForCaching = parseInt(
        process.env.MIN_PROMPT_LENGTH_FOR_CACHING || '1000',
        10,
      );
      const cacheSavingsMultiplier = parseFloat(
        process.env.CACHE_SAVINGS_MULTIPLIER || '0.8',
      );
      const expectedCacheHitRate = parseFloat(
        process.env.EXPECTED_CACHE_HIT_RATE || '0.75',
      );

      if (promptLength > minPromptLengthForCaching) {
        suggestions.push({
          type: 'prompt_caching',
          title: 'Enable Prompt Caching',
          description:
            'Cache the system prompt and common prefixes to reduce token costs',
          impact: 'high',
          savingsEstimate: promptLength * cacheSavingsMultiplier * 0.00001, // Rough estimate
          implementation: {
            provider: 'anthropic',
            cacheType: 'automatic',
            expectedHitRate: expectedCacheHitRate,
          },
          priority: 'high',
        });
      }

      // Check for repetitive patterns that could benefit from caching
      const words = prompt.split(/\s+/);
      const wordFreq = words.reduce(
        (acc, word) => {
          acc[word] = (acc[word] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const minWordRepetition = parseInt(
        process.env.MIN_WORD_REPETITION_FOR_CACHING || '3',
        10,
      );
      const repetitiveWords = Object.entries(wordFreq)
        .filter(([, count]) => count > minWordRepetition)
        .map(([word]) => word);

      if (repetitiveWords.length > 0) {
        const prefixSavingsMultiplier = parseInt(
          process.env.PREFIX_SAVINGS_MULTIPLIER || '10',
          10,
        );
        suggestions.push({
          type: 'prefix_caching',
          title: 'Cache Common Prefixes',
          description: `Cache frequently repeated terms: ${repetitiveWords.slice(0, 3).join(', ')}`,
          impact: 'medium',
          savingsEstimate:
            repetitiveWords.length * prefixSavingsMultiplier * 0.00001,
          implementation: {
            provider: 'anthropic',
            cacheType: 'explicit',
            prefixes: repetitiveWords.slice(0, 5),
          },
          priority: 'medium',
        });
      }

      return suggestions;
    } catch (error) {
      this.logger.warn('Failed to generate prompt caching suggestions', error);
      return [];
    }
  }

  private queueBackgroundOperation(operation: () => Promise<void>): void {
    if (!this.ENABLE_BACKGROUND_PROCESSING) {
      void operation().catch((err) =>
        this.logger.warn('Background op failed', err),
      );
      return;
    }
    this.backgroundQueue.push(operation);
  }

  /** Build CortexImpactMetrics for schema (align with Express convertToCortexMetrics). */
  private convertToCortexMetrics(
    unifiedCalc: {
      originalTokens: number;
      optimizedTokens: number;
      originalCost: number;
      optimizedCost: number;
      displayTokensSaved?: number;
      displayCostSaved?: number;
      displayPercentage?: number;
      tokensSaved?: number;
      costSaved?: number;
    },
    qualityMetrics?: Partial<CortexImpactMetrics['qualityMetrics']>,
    performanceMetrics?: Partial<CortexImpactMetrics['performanceMetrics']>,
    justification?: Partial<CortexImpactMetrics['justification']>,
  ): import('../../schemas/core/optimization.schema').ICortexImpactMetrics {
    const tokenDiff = unifiedCalc.originalTokens - unifiedCalc.optimizedTokens;
    const costDiff = unifiedCalc.originalCost - unifiedCalc.optimizedCost;
    const pctTokens =
      unifiedCalc.originalTokens > 0
        ? (tokenDiff / unifiedCalc.originalTokens) * 100
        : 0;
    const pctCost =
      unifiedCalc.originalCost > 0
        ? (costDiff / unifiedCalc.originalCost) * 100
        : 0;
    return {
      tokenReduction: {
        withoutCortex: unifiedCalc.originalTokens,
        withCortex: unifiedCalc.optimizedTokens,
        absoluteSavings: tokenDiff,
        percentageSavings: Math.max(-100, Math.min(100, pctTokens)),
      },
      qualityMetrics: {
        clarityScore: qualityMetrics?.clarityScore ?? 85,
        completenessScore: qualityMetrics?.completenessScore ?? 90,
        relevanceScore: qualityMetrics?.relevanceScore ?? 95,
        ambiguityReduction: qualityMetrics?.ambiguityReduction ?? 30,
        redundancyRemoval: qualityMetrics?.redundancyRemoval ?? 25,
      },
      performanceMetrics: {
        processingTime: performanceMetrics?.processingTime ?? 1500,
        responseLatency: performanceMetrics?.responseLatency ?? 1200,
        compressionRatio: performanceMetrics?.compressionRatio ?? 0.5,
      },
      costImpact: {
        estimatedCostWithoutCortex: unifiedCalc.originalCost,
        actualCostWithCortex: unifiedCalc.optimizedCost,
        costSavings: costDiff,
        savingsPercentage: Math.max(-100, Math.min(100, pctCost)),
        isAdjusted: costDiff < 0,
        minimalFee:
          costDiff < 0
            ? Math.max(0.0001, unifiedCalc.originalCost * 0.1)
            : undefined,
      },
      justification: {
        optimizationTechniques: justification?.optimizationTechniques ?? [
          'Intelligent structuring',
        ],
        keyImprovements: justification?.keyImprovements ?? [
          'Clarity and precision',
        ],
        confidenceScore: justification?.confidenceScore ?? 80,
      },
    };
  }

  /** Advanced Cortex streaming: fallback to static processCortexOptimization when orchestrator not used. */
  private async processAdvancedCortexStreaming(
    prompt: string,
    cortexConfig: any,
    userId: string,
    model: string,
    _service: string,
  ): Promise<any> {
    try {
      const result = await this.processCortexOptimization(
        prompt,
        cortexConfig,
        userId,
        model,
        undefined,
      );
      return {
        ...result,
        cortexMetadata: { ...result.cortexMetadata, lightweightCortex: false },
      };
    } catch (err) {
      this.logger.warn('Advanced Cortex streaming failed, using basic Cortex', {
        err,
      });
      return this.processCortexOptimization(
        prompt,
        cortexConfig,
        userId,
        model,
        undefined,
      );
    }
  }

  /** Lightweight Cortex path: fallback to processCortexOptimization. */
  private async processLightweightCortexOptimization(
    prompt: string,
    userId: string,
    model: string,
  ): Promise<any> {
    const result = await this.processCortexOptimization(
      prompt,
      {},
      userId,
      model,
      undefined,
    );
    return {
      ...result,
      cortexMetadata: { ...result.cortexMetadata, lightweightCortex: true },
    };
  }

  /**
   * Map schema document to API result DTO (single source of truth for response shape).
   */
  private buildResultDto(
    doc: Optimization & { _id?: any; [key: string]: any },
  ): OptimizationResultDto & {
    costSavings?: number;
    percentageSavings?: number;
  } {
    const meta = doc.metadata || {};
    const costSaved =
      doc.costSaved ??
      doc.costSavings ??
      meta.costBreakdown?.savings?.amount ??
      0;
    return {
      id: doc._id?.toString?.() ?? '',
      userQuery: doc.userQuery ?? meta.userQuery ?? '',
      generatedAnswer: doc.generatedAnswer ?? meta.generatedAnswer ?? '',
      improvementPercentage: doc.improvementPercentage ?? 0,
      costSaved,
      tokensSaved: doc.tokensSaved ?? 0,
      originalTokens: doc.originalTokens ?? 0,
      optimizedTokens: doc.optimizedTokens ?? 0,
      originalCost: doc.originalCost ?? 0,
      optimizedCost: doc.optimizedCost ?? 0,
      service:
        doc.service?.trim() ||
        (typeof doc.model === 'string'
          ? doc.model.includes('anthropic')
            ? 'anthropic'
            : doc.model.includes('amazon')
              ? 'amazon'
              : doc.model.includes('openai')
                ? 'openai'
                : 'anthropic'
          : 'anthropic'),
      model: doc.model ?? '',
      cortexImpactMetrics: doc.cortexImpactMetrics ?? undefined,
      isIncrease: meta.isIncrease ?? false,
      suggestions: doc.suggestions || [],
      metadata: meta,
      cortexEnabled: meta.cortexEnabled ?? doc.cortexEnabled ?? false,
      cortexProcessingTime:
        meta.cortex?.processingTime ?? doc.cortexProcessingTime,
      cortexSemanticIntegrity:
        meta.cortex?.semanticIntegrity ?? doc.cortexSemanticIntegrity,
      cortexTokenReduction:
        meta.cortex?.tokenReduction ?? doc.cortexTokenReduction,
      costSavings: costSaved,
      percentageSavings: doc.improvementPercentage ?? 0,
      ...(doc.requestTracking && { requestTracking: doc.requestTracking }),
    };
  }

  /**
   * Create optimization with full Cortex integration and fallback chains.
   * Supports (userId, dto) for controller and optional preview mode.
   * @param context - Optional { req, startTime, frontendRequestTracking } to save network details
   */
  async createOptimization(
    userIdOrDto: string | CreateOptimizationDto,
    dtoOrPreview?: CreateOptimizationDto | boolean,
    previewOrContext?:
      | boolean
      | { req: Request; startTime: number; frontendRequestTracking?: unknown },
  ): Promise<OptimizationResultDto> {
    const createDto: CreateOptimizationDto =
      typeof userIdOrDto === 'string' &&
      dtoOrPreview &&
      typeof dtoOrPreview === 'object'
        ? { ...dtoOrPreview, userId: userIdOrDto }
        : (userIdOrDto as CreateOptimizationDto);

    const userId = createDto.userId;
    if (!userId || typeof userId !== 'string') {
      throw new Error('userId is required for optimization');
    }

    const context =
      typeof previewOrContext === 'object' && previewOrContext?.req
        ? previewOrContext
        : undefined;
    const isPreview =
      typeof previewOrContext === 'boolean'
        ? previewOrContext
        : typeof dtoOrPreview === 'boolean'
          ? dtoOrPreview
          : !!previewOrContext;

    try {
      this.logger.log('🚀 Starting optimization creation', {
        userId: createDto.userId,
        promptLength: createDto.prompt.length,
        enableCortex: createDto.options?.enableCortex,
        service: createDto.service,
        model: createDto.model,
      });

      // 🚀 CORTEX PROCESSING: Check if Cortex is enabled and process accordingly
      let cortexResult: any = null;

      this.logger.debug('Cortex options check', {
        userId: createDto.userId,
        enableCortex: createDto.options?.enableCortex,
        hasCortexConfig: !!createDto.options?.cortexConfig,
      });

      if (createDto.options?.enableCortex) {
        this.logger.debug('Cortex processing triggered', {
          userId: createDto.userId,
        });

        const cortexStartTime = Date.now();
        try {
          await this.initializeCortexServices();

          this.logger.debug('Cortex initialization status', {
            userId: createDto.userId,
            cortexInitialized: this.cortexInitialized,
          });

          if (this.cortexInitialized) {
            this.logger.log('⚡ Starting Advanced Cortex Streaming Pipeline', {
              userId: createDto.userId,
            });

            cortexResult = await this.processAdvancedCortexStreaming(
              createDto.prompt,
              createDto.options.cortexConfig || {},
              userId,
              createDto.model,
              createDto.service,
            );

            this.logger.log('✅ Advanced Cortex Streaming completed', {
              userId: createDto.userId,
              hasResult: !!cortexResult,
              hasError: cortexResult?.cortexMetadata?.error,
            });
          } else {
            this.logger.warn(
              '⚠️ Advanced Cortex requested but services not available - using basic Cortex',
              {
                userId: createDto.userId,
              },
            );

            cortexResult = await this.processCortexOptimization(
              createDto.prompt,
              createDto.options.cortexConfig || {},
              userId,
              createDto.model,
              createDto.cortexOperation as CortexOperationType | undefined,
            );
          }
        } catch (error) {
          this.recordCortexFailure();
          this.logger.error('❌ Advanced Cortex Streaming failed with error', {
            userId: createDto.userId,
            error: error instanceof Error ? error.message : String(error),
          });

          cortexResult = {
            optimizedPrompt: createDto.prompt,
            cortexMetadata: {
              error: `Advanced Cortex Streaming failed: ${error instanceof Error ? error.message : String(error)}`,
              fallbackUsed: true,
              processingTime: Date.now() - cortexStartTime,
              circuitBreakerTriggered: this.isCortexCircuitBreakerOpen(),
              cortexModel: {
                encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                core: 'anthropic.claude-sonnet-4-6',
                decoder: 'mistral.mistral-large-3-675b-instruct',
              },
            },
          };
        }
      } else {
        this.logger.log(
          '🚀 Lightweight Cortex optimization (Cortex not enabled)',
          { userId: createDto.userId },
        );
        const cortexStartTime = Date.now();
        try {
          cortexResult = await this.processLightweightCortexOptimization(
            createDto.prompt,
            userId,
            createDto.model,
          );

          this.logger.log('✅ Lightweight Cortex processing completed', {
            userId: createDto.userId,
            hasResult: !!cortexResult,
            hasError: cortexResult?.cortexMetadata?.error,
          });
        } catch (error) {
          this.logger.error(
            '❌ Lightweight Cortex processing failed, falling back to traditional optimization',
            {
              userId: createDto.userId,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          cortexResult = {
            optimizedPrompt: createDto.prompt,
            cortexMetadata: {
              error: `Lightweight Cortex processing failed: ${error instanceof Error ? error.message : String(error)}`,
              fallbackUsed: true,
              processingTime: Date.now() - cortexStartTime,
              cortexModel: {
                encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                core: 'amazon.nova-pro-v1',
                decoder: 'mistral.mistral-large-3-675b-instruct',
              },
            },
          };
        }
      }

      // Get token count and cost for ORIGINAL prompt
      const originalPromptTokens = await this.getTokensWithMemoization(
        createDto.prompt,
        this.getAIProviderFromString(createDto.service),
        createDto.model,
      );

      const COMPLETION_TOKENS_ESTIMATE = 150;
      // Express: originalTotalTokens = prompt + completion (for comparison)
      const totalOriginalTokens =
        originalPromptTokens + COMPLETION_TOKENS_ESTIMATE;
      const rawOriginalEstimate = this.pricingService.estimateCost(
        createDto.model,
        originalPromptTokens,
        COMPLETION_TOKENS_ESTIMATE,
        0.95,
      );
      let originalSimpleEstimate: {
        inputCost: number;
        outputCost: number;
        totalCost: number;
      } | null = rawOriginalEstimate
        ? {
            totalCost: rawOriginalEstimate.totalCost,
            inputCost: rawOriginalEstimate.breakdown?.inputCost ?? 0,
            outputCost: rawOriginalEstimate.breakdown?.outputCost ?? 0,
          }
        : null;

      if (!originalSimpleEstimate || originalSimpleEstimate.totalCost == null) {
        const fallbackPolicy = getFallbackPricing();
        if (fallbackPolicy.strategy === 'strict') {
          throw new Error(
            `No pricing data found for ${this.providerEnumToString(this.getAIProviderFromString(createDto.service))}/${createDto.model}. ` +
              `Configure explicit pricing or change FALLBACK_PRICING_STRATEGY from 'strict'.`,
          );
        }
        this.logger.warn(
          `No pricing data found for ${this.providerEnumToString(this.getAIProviderFromString(createDto.service))}/${createDto.model}`,
          {
            fallbackStrategy: fallbackPolicy.strategy,
            expectedAccuracy: fallbackPolicy.accuracy,
            risk: fallbackPolicy.risk,
            rationale: fallbackPolicy.rationale,
          },
        );
        originalSimpleEstimate = {
          inputCost:
            (originalPromptTokens / 1_000_000) *
            fallbackPolicy.pricingRates.inputCostPer1M,
          outputCost:
            (COMPLETION_TOKENS_ESTIMATE / 1_000_000) *
            fallbackPolicy.pricingRates.outputCostPer1M,
          totalCost:
            (originalPromptTokens / 1_000_000) *
              fallbackPolicy.pricingRates.inputCostPer1M +
            (COMPLETION_TOKENS_ESTIMATE / 1_000_000) *
              fallbackPolicy.pricingRates.outputCostPer1M,
        };
      }

      const originalEstimate = this.convertToCostEstimate(
        originalSimpleEstimate,
        originalPromptTokens,
        COMPLETION_TOKENS_ESTIMATE,
        this.getAIProviderFromString(createDto.service),
        createDto.model,
      );

      // Skip traditional optimization if we have Cortex result (full or lightweight)
      let optimizationResult: any = null;
      if (!cortexResult || cortexResult.cortexMetadata.error) {
        try {
          const nestSuggestions =
            this.optimizationUtilsService.generateOptimizationSuggestions(
              createDto.prompt,
              undefined,
              createDto.model,
            );
          optimizationResult = {
            suggestions: nestSuggestions.map((s, i) => ({
              ...s,
              id: `${s.type}-${i}`,
              optimizedPrompt:
                s.type === 'compression'
                  ? createDto.prompt.replace(/\s+/g, ' ').trim()
                  : undefined,
            })),
          };
        } catch (error) {
          this.logger.error('Failed to generate optimization suggestions:', {
            error: error instanceof Error ? error.message : String(error),
          });
          optimizationResult = {
            id: 'fallback-optimization',
            totalSavings: 10,
            suggestions: [
              {
                id: 'fallback-compression',
                type: 'compression',
                explanation: 'Basic prompt compression applied',
                estimatedSavings: 10,
                confidence: 0.7,
                optimizedPrompt: createDto.prompt.replace(/\s+/g, ' ').trim(),
                compressionDetails: {
                  technique: 'pattern_replacement',
                  originalSize: createDto.prompt.length,
                  compressedSize: createDto.prompt.replace(/\s+/g, ' ').trim()
                    .length,
                  compressionRatio: 0.9,
                  reversible: false,
                },
              },
            ],
            appliedOptimizations: ['compression'],
            metadata: {
              processingTime: 1,
              originalTokens: createDto.prompt.length / 4,
              optimizedTokens:
                createDto.prompt.replace(/\s+/g, ' ').trim().length / 4,
              techniques: ['compression'],
            },
          };
        }
      }

      // Apply the optimizations to get the actual optimized prompt
      let optimizedPrompt = createDto.prompt;
      const appliedOptimizations: string[] = [];

      // 🚀 USE CORTEX RESULT if available and successful
      if (cortexResult && !cortexResult.cortexMetadata.error) {
        optimizedPrompt = cortexResult.optimizedPrompt;

        const isActuallyTerrible = await this.isTerribleResponse(
          optimizedPrompt,
          createDto.prompt,
        );

        // When Cortex runs in 'answer' mode, the result is a full answer to the query,
        // which is expected to be longer than the original prompt. Never trigger fallback
        // based on length alone for answer-mode results.
        const isAnswerMode =
          cortexResult.cortexMetadata?.answerGenerated === true ||
          (optimizedPrompt.length > createDto.prompt.length &&
            !optimizedPrompt.includes('error') &&
            !optimizedPrompt.includes('failed'));

        const shouldUseFallback =
          !isAnswerMode &&
          isActuallyTerrible &&
          (optimizedPrompt.length < 20 ||
            optimizedPrompt.includes('error') ||
            optimizedPrompt.includes('failed'));

        if (shouldUseFallback) {
          this.logger.warn(
            '🚨 FINAL QUALITY CHECK: Cortex returned terrible response, using intelligent fallback',
            {
              userId: createDto.userId,
              originalPrompt: createDto.prompt,
              terribleCortexResponse: optimizedPrompt,
              reason: 'Final quality check detected unusable response',
            },
          );

          optimizedPrompt = await this.createIntelligentOptimization(
            createDto.prompt,
          );
          appliedOptimizations.push('intelligent_fallback');
        } else {
          appliedOptimizations.push(
            cortexResult.cortexMetadata.lightweightCortex
              ? 'lightweight_cortex_optimization'
              : 'cortex_optimization',
          );
        }

        this.logger.log('✅ Using final optimized prompt', {
          userId: createDto.userId,
          originalLength: createDto.prompt.length,
          optimizedLength: optimizedPrompt.length,
          reduction:
            cortexResult.cortexMetadata.reductionPercentage?.toFixed?.(1) ??
            'N/A',
          wasIntelligentFallback: appliedOptimizations.includes(
            'intelligent_fallback',
          ),
          isLightweightCortex: cortexResult.cortexMetadata.lightweightCortex,
        });
      } else if (
        optimizationResult &&
        optimizationResult.suggestions.length > 0
      ) {
        const bestSuggestion = optimizationResult.suggestions[0];
        if (bestSuggestion.optimizedPrompt) {
          optimizedPrompt = bestSuggestion.optimizedPrompt;
          appliedOptimizations.push(bestSuggestion.id);
        } else if (bestSuggestion.type === 'compression') {
          optimizedPrompt = createDto.prompt.replace(/\s+/g, ' ').trim();
          appliedOptimizations.push('compression');
        }
      }

      // Get token count and cost for optimized prompt.
      // Express: optimizedTotalTokens = answer tokens (the full generated response)
      const optimizedTokens = await this.getTokensWithMemoization(
        optimizedPrompt,
        this.getAIProviderFromString(createDto.service),
        createDto.model,
      );

      // For Cortex answer mode: optimized cost = output-only (0 input, answer tokens as output)
      // Express: estimateCost(0, optimizedResponseTokens, provider, model)
      const isCortexAnswerMode =
        cortexResult?.cortexMetadata?.answerGenerated === true;
      const rawOptimizedEstimate = this.pricingService.estimateCost(
        createDto.model,
        isCortexAnswerMode ? 0 : optimizedTokens,
        isCortexAnswerMode ? optimizedTokens : COMPLETION_TOKENS_ESTIMATE,
        0.95,
      );
      let optimizedSimpleEstimate: {
        inputCost: number;
        outputCost: number;
        totalCost: number;
      } | null = rawOptimizedEstimate
        ? {
            totalCost: rawOptimizedEstimate.totalCost,
            inputCost: rawOptimizedEstimate.breakdown?.inputCost ?? 0,
            outputCost: rawOptimizedEstimate.breakdown?.outputCost ?? 0,
          }
        : null;

      if (
        !optimizedSimpleEstimate ||
        optimizedSimpleEstimate.totalCost == null
      ) {
        this.logger.warn(
          `No pricing data found for ${this.providerEnumToString(this.getAIProviderFromString(createDto.service))}/${createDto.model}, using fallback pricing for optimized prompt`,
        );
        const fallbackPolicy = getFallbackPricing();
        optimizedSimpleEstimate = isCortexAnswerMode
          ? {
              inputCost: 0,
              outputCost:
                (optimizedTokens / 1_000_000) *
                fallbackPolicy.pricingRates.outputCostPer1M,
              totalCost:
                (optimizedTokens / 1_000_000) *
                fallbackPolicy.pricingRates.outputCostPer1M,
            }
          : {
              inputCost:
                (optimizedTokens / 1_000_000) *
                fallbackPolicy.pricingRates.inputCostPer1M,
              outputCost:
                (COMPLETION_TOKENS_ESTIMATE / 1_000_000) *
                fallbackPolicy.pricingRates.outputCostPer1M,
              totalCost:
                (optimizedTokens / 1_000_000) *
                  fallbackPolicy.pricingRates.inputCostPer1M +
                (COMPLETION_TOKENS_ESTIMATE / 1_000_000) *
                  fallbackPolicy.pricingRates.outputCostPer1M,
            };
      }

      const optimizedEstimate = this.convertToCostEstimate(
        optimizedSimpleEstimate,
        isCortexAnswerMode ? 0 : optimizedTokens,
        isCortexAnswerMode ? optimizedTokens : COMPLETION_TOKENS_ESTIMATE,
        this.getAIProviderFromString(createDto.service),
        createDto.model,
      );

      // Inline unified calculation (mirrors Express calculationUtils.calculateUnifiedSavings)
      const originalCost = originalEstimate.totalCost;
      const optimizedCost = optimizedEstimate.totalCost;
      const displayTokensSaved = Math.abs(
        totalOriginalTokens - optimizedTokens,
      );
      const displayCostSaved = Math.abs(originalCost - optimizedCost);
      const displayPercentage =
        totalOriginalTokens > 0
          ? Math.abs(
              ((totalOriginalTokens - optimizedTokens) / totalOriginalTokens) *
                100,
            )
          : 0;
      const unifiedCalc = {
        originalTokens: totalOriginalTokens,
        optimizedTokens,
        displayTokensSaved,
        displayCostSaved,
        displayPercentage,
        isIncrease: optimizedTokens > totalOriginalTokens,
        originalCost,
        optimizedCost,
      };

      const totalOptimizedTokens = unifiedCalc.optimizedTokens;
      const tokensSaved = unifiedCalc.displayTokensSaved;
      const costSaved = unifiedCalc.displayCostSaved;
      const improvementPercentage = Math.min(
        100,
        unifiedCalc.displayPercentage,
      );

      this.logger.log('🔍 Unified calculation results:', {
        originalTokens: totalOriginalTokens,
        optimizedTokens: totalOptimizedTokens,
        tokensSaved,
        costSaved,
        improvementPercentage: improvementPercentage.toFixed(1),
        isIncrease: unifiedCalc.isIncrease,
      });

      // Determine category based on optimization type
      const optimizationType =
        optimizationResult?.suggestions &&
        optimizationResult.suggestions.length > 0
          ? optimizationResult.suggestions[0].type
          : 'compression';
      const category = this.determineCategoryFromType(optimizationType);

      // Build metadata based on optimization type and include optimizedEstimate
      const metadata: any = {
        analysisTime: optimizationResult?.metadata?.processingTime || 0,
        confidence:
          optimizationResult?.suggestions &&
          optimizationResult.suggestions.length > 0
            ? optimizationResult.suggestions[0].confidence
            : 0.5,
        optimizationType: optimizationType,
        appliedTechniques: appliedOptimizations,
        isIncrease: unifiedCalc.isIncrease,
        // Also include raw cost estimates (original and optimized)
        originalEstimate: originalEstimate,
        optimizedEstimate: optimizedEstimate,
      };

      if (unifiedCalc.isIncrease) {
        const minimalFee = Math.max(0.0001, unifiedCalc.originalCost * 0.1);
        metadata.isAdjusted = true;
        metadata.minimalFee = minimalFee;
        metadata.adjustedCostIncrease = minimalFee;
      }

      // 🚀 ADD CORTEX METADATA if Cortex was used
      if (cortexResult) {
        metadata.cortex = cortexResult.cortexMetadata;
        metadata.cortexEnabled = true;

        if (!cortexResult.cortexMetadata.error) {
          metadata.cortexProcessingTime =
            cortexResult.cortexMetadata.processingTime;
          metadata.cortexSemanticIntegrity =
            cortexResult.cortexMetadata.semanticIntegrity;
          metadata.cortexTokenReduction = cortexResult.tokenReduction;
          if (!appliedOptimizations.includes('cortex_optimization')) {
            appliedOptimizations.push('cortex_optimization');
          }
        }
      } else {
        metadata.cortexEnabled = false;
      }

      if (
        optimizationResult?.suggestions &&
        optimizationResult.suggestions.length > 0
      ) {
        const bestSuggestion = optimizationResult.suggestions[0];
        if (bestSuggestion.compressionDetails) {
          metadata.compressionDetails = bestSuggestion.compressionDetails;
        }
        if (bestSuggestion.contextTrimDetails) {
          metadata.contextTrimDetails = bestSuggestion.contextTrimDetails;
        }
        if (bestSuggestion.fusionDetails) {
          metadata.fusionDetails = bestSuggestion.fusionDetails;
        }
      }

      const suggestionsPayload = [
        ...(optimizationResult?.suggestions
          .map((suggestion: any, index: number) => {
            // Support both optimizationUtilsService (description) and fallback (explanation)
            const description =
              suggestion.description ??
              suggestion.explanation ??
              'Optimization applied';
            // Support both estimatedSavings (fallback) and impact 0-1 (utils service)
            const impactLevel =
              typeof suggestion.estimatedSavings === 'number'
                ? suggestion.estimatedSavings > 30
                  ? 'high'
                  : suggestion.estimatedSavings > 15
                    ? 'medium'
                    : 'low'
                : typeof suggestion.impact === 'number'
                  ? suggestion.impact > 0.3
                    ? 'high'
                    : suggestion.impact > 0.15
                      ? 'medium'
                      : 'low'
                  : 'medium';
            return {
              type: suggestion.type ?? 'compression',
              description,
              impact: impactLevel,
              implemented: index === 0,
              optimizedEstimate: optimizedEstimate,
            };
          })
          .filter(
            (s: { type: string; description: string }) =>
              s.type && s.description && s.description.trim().length > 0,
          ) || []),
        ...(isPreview
          ? []
          : (await this.generatePromptCachingSuggestions(createDto)).map(
              (s: any) => ({
                type: s.type,
                description:
                  s.description ?? 'Enable caching to reduce token costs',
                impact: s.impact ?? 'medium',
                implemented: false,
              }),
            )),
      ];

      let optimization: any;
      if (!isPreview) {
        const serverProcessingTime = context
          ? Date.now() - context.startTime
          : 0;
        const requestTracking = context
          ? buildRequestTrackingFromRequest(context.req, {
              serverProcessingTimeMs: serverProcessingTime,
              frontendData: context.frontendRequestTracking as any,
            })
          : undefined;

        optimization = await this.optimizationModel.create({
          userId: createDto.userId,
          userQuery: createDto.prompt,
          generatedAnswer: optimizedPrompt,
          optimizationTechniques: appliedOptimizations,
          originalTokens: totalOriginalTokens,
          optimizedTokens: totalOptimizedTokens,
          tokensSaved,
          originalCost: unifiedCalc.originalCost,
          optimizedCost: unifiedCalc.optimizedCost,
          costSaved,
          improvementPercentage,
          service: createDto.service,
          model: createDto.model,
          category,
          suggestions: suggestionsPayload,
          metadata,
          cortexImpactMetrics: cortexResult
            ? this.convertToCortexMetrics(
                unifiedCalc,
                cortexResult.impactMetrics?.qualityMetrics,
                cortexResult.impactMetrics?.performanceMetrics,
                cortexResult.impactMetrics?.justification,
              )
            : undefined,
          ...(requestTracking && { requestTracking }),
        });

        this.queueBackgroundOperation(async () => {
          try {
            await this.userModel.findByIdAndUpdate(createDto.userId, {
              $inc: {
                'usage.currentMonth.optimizationsSaved': costSaved,
              },
            });

            await this.activityModel.create({
              userId: createDto.userId,
              type: 'optimization_created',
              title: 'Created Optimization',
              description: `Saved $${costSaved.toFixed(4)} (${improvementPercentage.toFixed(1)}% improvement)`,
              metadata: {
                optimizationId: optimization._id,
                service: createDto.service,
                model: createDto.model,
                cost: unifiedCalc.originalCost,
                saved: costSaved,
                techniques:
                  optimizationResult?.appliedOptimizations ||
                  appliedOptimizations,
                originalEstimate: originalEstimate,
                optimizedEstimate: optimizedEstimate,
              },
            });

            if (improvementPercentage > 30) {
              const newAlert = await this.alertModel.create({
                userId: createDto.userId,
                type: 'optimization_available',
                title: 'Significant Optimization Available',
                message: `You can save ${improvementPercentage.toFixed(1)}% on tokens using ${optimizationType} optimization.`,
                severity: 'medium',
                data: {
                  optimizationId: optimization._id,
                  savings: costSaved,
                  potentialSavings: costSaved,
                  percentage: improvementPercentage,
                  optimizationType: optimizationType,
                  recommendations: [
                    `Apply ${optimizationType} optimization to reduce tokens by ${improvementPercentage.toFixed(1)}%`,
                  ],
                  originalEstimate: originalEstimate,
                  optimizedEstimate: optimizedEstimate,
                },
              });

              this.logger.log('Created optimization alert', {
                alertId: newAlert._id,
              });
            }
          } catch (error) {
            this.logger.error('Background operation failed:', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        this.logger.log('Optimization created', {
          optimizationId: optimization._id,
          originalTokens: totalOriginalTokens,
          optimizedTokens: totalOptimizedTokens,
          savings: improvementPercentage,
          type: optimizationType,
          originalEstimate: originalEstimate,
          optimizedEstimate: optimizedEstimate,
        });
      } else {
        optimization = {
          _id: null,
          userQuery: createDto.prompt,
          generatedAnswer: optimizedPrompt,
          suggestions: suggestionsPayload,
          metadata,
          improvementPercentage,
          costSaved,
          tokensSaved,
        };
      }

      return this.buildResultDto(optimization);
    } catch (error) {
      this.logger.error('Error creating optimization:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get optimizations with pagination and filtering.
   * Supports (userId, query) for controller; returns { optimizations, total, page, limit }.
   */
  async getOptimizations(
    userIdOrFilters: string | any,
    options?: PaginationQueryDto,
  ): Promise<{
    data?: any[];
    pagination?: any;
    optimizations: (OptimizationResultDto & {
      costSavings?: number;
      percentageSavings?: number;
    })[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const filters =
        typeof userIdOrFilters === 'string'
          ? { userId: userIdOrFilters }
          : userIdOrFilters;
      const opts =
        options ??
        (typeof userIdOrFilters === 'object' &&
        userIdOrFilters?.page !== undefined
          ? userIdOrFilters
          : { page: 1, limit: 10 });

      const query: any = {};
      if (filters.userId)
        query.userId = new mongoose.Types.ObjectId(filters.userId);
      if (filters.category) query.category = filters.category;
      if (filters.minSavings !== undefined)
        query.costSaved = { $gte: filters.minSavings };
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = filters.startDate;
        if (filters.endDate) query.createdAt.$lte = filters.endDate;
      }

      const page = opts.page || 1;
      const limit = opts.limit || 10;
      const skip = (page - 1) * limit;
      const sort: any = opts.sort
        ? { [opts.sort]: opts.order === 'asc' ? 1 : -1 }
        : { createdAt: -1 };

      const [data, total] = await Promise.all([
        this.optimizationModel
          .find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        this.optimizationModel.countDocuments(query).exec(),
      ]);

      const optimizations = (data as any[]).map((doc) =>
        this.buildResultDto(doc as Optimization),
      );

      return {
        optimizations,
        total,
        page,
        limit,
        data: optimizations,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching optimizations:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get optimization network details for visualization (nodes/edges derived from optimization).
   */
  async getOptimizationNetworkDetails(
    userId: string,
    optimizationId: string,
  ): Promise<{
    optimizationId: string;
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ from: string; to: string }>;
    summary: Record<string, unknown>;
  }> {
    const opt = await this.optimizationModel
      .findOne({
        _id: new mongoose.Types.ObjectId(optimizationId),
        userId: new mongoose.Types.ObjectId(userId),
      })
      .lean()
      .exec();
    if (!opt) {
      throw new Error('Optimization not found');
    }
    const o = opt as Optimization & { _id: unknown };
    const nodes: Array<{ id: string; type: string; label: string }> = [
      { id: 'query', type: 'input', label: 'User query' },
      { id: 'answer', type: 'output', label: 'Generated answer' },
    ];
    (o.optimizationTechniques || []).forEach((t: string, i: number) => {
      nodes.push({
        id: `tech_${i}`,
        type: 'technique',
        label: t,
      });
    });
    const edges: Array<{ from: string; to: string }> = [
      { from: 'query', to: 'answer' },
    ];
    (o.optimizationTechniques || []).forEach((_: string, i: number) => {
      edges.push({ from: 'query', to: `tech_${i}` });
      edges.push({ from: `tech_${i}`, to: 'answer' });
    });
    return {
      optimizationId: String(o._id),
      nodes,
      edges,
      summary: {
        originalTokens: o.originalTokens,
        optimizedTokens: o.optimizedTokens,
        tokensSaved: o.tokensSaved,
        costSaved: o.costSaved,
        improvementPercentage: o.improvementPercentage,
        service: o.service,
        model: o.model,
        category: o.category,
      },
    };
  }

  /**
   * Legacy bulk optimize: accepts either promptIds (for generateBulkOptimizations) or requests (for createBatchOptimization).
   */
  async bulkOptimize(
    userId: string,
    body: {
      promptIds?: string[];
      requests?: Array<{
        id: string;
        prompt: string;
        timestamp: number;
        model: string;
        provider: string;
      }>;
      enableFusion?: boolean;
      cortexEnabled?: boolean;
      cortexConfig?: Record<string, unknown>;
    },
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    optimizations?: Optimization[] | unknown[];
  }> {
    if (body.promptIds && Array.isArray(body.promptIds)) {
      return this.generateBulkOptimizations(userId, body.promptIds, {
        cortexEnabled: body.cortexEnabled,
        cortexConfig: body.cortexConfig,
      });
    }
    if (body.requests && Array.isArray(body.requests)) {
      const optimizations = await this.createBatchOptimization({
        userId,
        requests: body.requests,
        enableFusion: body.enableFusion,
      });
      return {
        total: body.requests.length,
        successful: optimizations.length,
        failed: body.requests.length - optimizations.length,
        optimizations,
      };
    }
    throw new Error(
      'bulkOptimize body must contain promptIds (string[]) or requests (array of { id, prompt, timestamp, model, provider })',
    );
  }

  /**
   * Get single optimization by ID. Supports (userId, optimizationId) for controller.
   */
  async getOptimization(
    userIdOrId: string,
    optimizationId?: string,
  ): Promise<
    OptimizationResultDto & { costSavings?: number; percentageSavings?: number }
  > {
    try {
      const userId = optimizationId ? userIdOrId : undefined;
      const id = optimizationId ?? userIdOrId;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error('Invalid optimization ID');
      }
      const query: any = { _id: new mongoose.Types.ObjectId(id) };
      if (userId) query.userId = new mongoose.Types.ObjectId(userId);
      const doc = await this.optimizationModel.findOne(query).lean().exec();
      if (!doc) {
        throw new Error('Optimization not found');
      }
      return this.buildResultDto(doc as Optimization);
    } catch (error) {
      this.logger.error('Error fetching optimization:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Apply optimization (mark as applied). Supports (userId, optimizationId) for controller.
   */
  async applyOptimization(
    userIdOrOptimizationId: string,
    optimizationId?: string,
  ): Promise<
    OptimizationResultDto & { costSavings?: number; percentageSavings?: number }
  > {
    try {
      const userId = optimizationId ? userIdOrOptimizationId : undefined;
      const id = optimizationId ?? userIdOrOptimizationId;
      const optimization = await this.optimizationModel.findOne({
        _id: id,
        ...(userId && { userId: new mongoose.Types.ObjectId(userId) }),
      });

      if (!optimization) {
        throw new Error('Optimization not found');
      }

      await optimization.save();

      await this.activityModel.create({
        userId: optimization.userId,
        type: 'optimization_applied',
        title: 'Applied Optimization',
        description: `Applied optimization saving $${optimization.costSaved.toFixed(4)}`,
        metadata: {
          optimizationId: optimization._id,
          service: optimization.service,
          model: optimization.model,
          saved: optimization.costSaved,
        },
      });

      this.logger.log('Optimization applied', {
        optimizationId: id,
        userId: optimization.userId,
      });

      return this.buildResultDto(optimization);
    } catch (error) {
      this.logger.error('Error applying optimization:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Provide feedback on optimization
   */
  async provideFeedback(
    optimizationId: string,
    userId: string,
    feedback: FeedbackDto,
  ): Promise<void> {
    try {
      const optimization = await this.optimizationModel.findOne({
        _id: optimizationId,
        userId,
      });

      if (!optimization) {
        throw new Error('Optimization not found');
      }

      optimization.feedback = {
        ...feedback,
        helpful: feedback.helpful ?? false,
        submittedAt: new Date(),
      } as any;
      await optimization.save();

      this.logger.log('Optimization feedback provided', {
        optimizationId,
        helpful: feedback.helpful,
        rating: feedback.rating,
      });
    } catch (error) {
      this.logger.error('Error providing optimization feedback:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get optimization summary statistics
   */
  async getOptimizationSummary(
    userId: string,
    timeframe: string = '30d',
  ): Promise<any> {
    try {
      let startDate: Date;
      const endDate = new Date();

      switch (timeframe) {
        case '7d':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
          startDate = new Date(0);
          break;
        default:
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }

      let userIdObj: mongoose.Types.ObjectId;
      try {
        userIdObj = new mongoose.Types.ObjectId(userId);
      } catch {
        this.logger.warn('Invalid userId for optimization summary', { userId });
        return this.emptySummary();
      }

      const matchQuery: Record<string, unknown> = {
        $or: [{ userId: userIdObj }, { userId }],
        createdAt: { $gte: startDate, $lte: endDate },
      };

      // Use unified aggregation pipeline for all summary data
      const [summaryResult] = await this.optimizationModel.aggregate([
        { $match: matchQuery },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  totalSaved: {
                    $sum: {
                      $ifNull: [
                        '$costSaved',
                        {
                          $ifNull: [
                            '$metadata.costBreakdown.savings.amount',
                            0,
                          ],
                        },
                      ],
                    },
                  },
                  totalTokensSaved: {
                    $sum: { $ifNull: ['$tokensSaved', 0] },
                  },
                  avgImprovement: {
                    $avg: { $ifNull: ['$improvementPercentage', 0] },
                  },
                  cortexCount: {
                    $sum: {
                      $cond: [
                        { $eq: ['$metadata.cortexEnabled', true] },
                        1,
                        { $cond: [{ $eq: ['$cortexEnabled', true] }, 1, 0] },
                      ],
                    },
                  },
                },
              },
            ],
            categories: [
              {
                $group: {
                  _id: { $ifNull: ['$category', 'uncategorized'] },
                  count: { $sum: 1 },
                  avgSavings: { $avg: { $ifNull: ['$costSaved', 0] } },
                },
              },
            ],
            topOptimizations: [
              {
                $sort: {
                  costSaved: -1,
                  'metadata.costBreakdown.savings.amount': -1,
                  createdAt: -1,
                },
              },
              { $limit: 5 },
              {
                $project: {
                  userQuery: 1,
                  generatedAnswer: 1,
                  costSaved: 1,
                  tokensSaved: 1,
                  improvementPercentage: 1,
                  category: 1,
                  metadata: 1,
                  cortexEnabled: 1,
                },
              },
            ],
          },
        },
      ]);

      const summaryStats = summaryResult?.summary?.[0];
      const categoryStats = summaryResult?.categories || [];
      const topOptimizations = summaryResult?.topOptimizations || [];

      if (!summaryStats || (summaryStats.total ?? 0) === 0) {
        return this.computeSummaryFallback(userId, startDate, endDate);
      }

      const totalCount = summaryStats.total || 0;
      const cortexPct =
        totalCount > 0 && summaryStats.cortexCount != null
          ? (summaryStats.cortexCount / totalCount) * 100
          : 0;

      const summary = {
        total: totalCount,
        totalSaved: summaryStats.totalSaved ?? 0,
        totalTokensSaved: summaryStats.totalTokensSaved ?? 0,
        avgImprovement: summaryStats.avgImprovement ?? 0,
        byCategory: categoryStats.reduce((acc: any, cat: any) => {
          const key = cat._id ?? 'uncategorized';
          acc[key] = {
            count: cat.count ?? 0,
            avgSavings: cat.avgSavings ?? 0,
          };
          return acc;
        }, {}),
        topOptimizations,
        totalOptimizations: totalCount,
        totalTokenReduction: summaryStats.totalTokensSaved ?? 0,
        totalCostSavings: summaryStats.totalSaved ?? 0,
        averageReduction: summaryStats.avgImprovement ?? 0,
        cortexUsagePercentage: cortexPct,
        recentOptimizations: (topOptimizations as any[]).map((doc) =>
          this.buildResultDto(doc as Optimization),
        ),
      };

      this.logger.log('Optimization summary retrieved', {
        timeframe,
        total: summary.total,
      });

      return summary;
    } catch (error) {
      this.logger.error('Error getting optimization summary:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private emptySummary(): Record<string, unknown> {
    return {
      total: 0,
      totalSaved: 0,
      totalTokensSaved: 0,
      avgImprovement: 0,
      byCategory: {},
      topOptimizations: [],
      totalOptimizations: 0,
      totalTokenReduction: 0,
      totalCostSavings: 0,
      averageReduction: 0,
      cortexUsagePercentage: 0,
      recentOptimizations: [],
    };
  }

  private async computeSummaryFallback(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    const docs = await this.optimizationModel
      .find({
        $or: [{ userId: new mongoose.Types.ObjectId(userId) }, { userId }],
        createdAt: { $gte: startDate, $lte: endDate },
      })
      .sort({ costSaved: -1, createdAt: -1 })
      .limit(500)
      .lean()
      .exec();

    if (!docs?.length) {
      return this.emptySummary();
    }

    let totalSaved = 0;
    let totalTokensSaved = 0;
    let totalImprovement = 0;
    const byCategory: Record<string, { count: number; avgSavings: number }> =
      {};
    let cortexCount = 0;

    for (const doc of docs as any[]) {
      const cost =
        doc.costSaved ?? doc.metadata?.costBreakdown?.savings?.amount ?? 0;
      const tokens = doc.tokensSaved ?? 0;
      const improvement = doc.improvementPercentage ?? 0;

      totalSaved += Number(cost);
      totalTokensSaved += Number(tokens);
      totalImprovement += improvement;
      if (doc.metadata?.cortexEnabled || doc.cortexEnabled) cortexCount++;

      const cat = doc.category ?? 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, avgSavings: 0 };
      byCategory[cat].count += 1;
      byCategory[cat].avgSavings += cost;
    }

    for (const k of Object.keys(byCategory)) {
      byCategory[k].avgSavings =
        byCategory[k].count > 0
          ? byCategory[k].avgSavings / byCategory[k].count
          : 0;
    }

    const topOptimizations = docs.slice(0, 5);
    return {
      total: docs.length,
      totalSaved,
      totalTokensSaved,
      avgImprovement: docs.length > 0 ? totalImprovement / docs.length : 0,
      byCategory,
      topOptimizations,
      totalOptimizations: docs.length,
      totalTokenReduction: totalTokensSaved,
      totalCostSavings: totalSaved,
      averageReduction: docs.length > 0 ? totalImprovement / docs.length : 0,
      cortexUsagePercentage:
        docs.length > 0 ? (cortexCount / docs.length) * 100 : 0,
      recentOptimizations: topOptimizations.map((doc) =>
        this.buildResultDto(doc as Optimization),
      ),
    };
  }

  /**
   * Analyze optimization opportunities
   */
  async analyzeOptimizationOpportunities(userId: string): Promise<any> {
    try {
      // Get recent high-cost usage patterns for the user
      const recentUsage = await this.usageModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(50);

      const suggestions = recentUsage
        .filter((usage) => usage.cost > 0.01) // High cost threshold
        .map((usage) => ({
          id: usage._id.toString(),
          type: 'prompt_optimization',
          originalPrompt: usage.prompt,
          estimatedSavings: usage.cost * 0.2, // Estimate 20% savings
          confidence: 0.8,
          explanation: `This prompt could be optimized to reduce token usage and costs.`,
          implementation:
            'Consider simplifying the prompt or using a more efficient model.',
        }))
        .slice(0, 10); // Top 10 opportunities

      // Create alerts for top opportunities
      if (suggestions.length > 0) {
        const topOpportunity = suggestions[0];
        const newAlert = await this.alertModel.create({
          userId,
          type: 'optimization_available',
          title: 'Optimization Opportunities Found',
          message: `You have ${suggestions.length} prompts that could be optimized. The top opportunity could save approximately ${topOpportunity.estimatedSavings.toFixed(2)}%.`,
          severity: 'low',
          data: {
            opportunitiesCount: suggestions.length,
            topOpportunity,
            potentialSavings: topOpportunity.estimatedSavings,
            recommendations: suggestions
              .slice(0, 3)
              .map(
                (s: any, i: number) =>
                  `${i + 1}. ${s.prompt?.substring(0, 50)}... - Save ${s.estimatedSavings.toFixed(1)}%`,
              ),
          },
        });

        this.logger.log('Created optimization opportunities alert', {
          alertId: newAlert._id,
        });
      }

      return {
        opportunities: suggestions,
        totalPotentialSavings: suggestions.reduce(
          (sum: number, s: any) => sum + s.estimatedSavings,
          0,
        ),
      };
    } catch (error) {
      this.logger.error('Error analyzing optimization opportunities:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get prompts for bulk optimization
   */
  async getPromptsForBulkOptimization(
    userId: string,
    filters: {
      service?: string;
      minCalls?: number;
      timeframe?: string;
    },
  ): Promise<any[]> {
    try {
      const { service, minCalls = 5, timeframe = '30d' } = filters;

      // Calculate date range
      const startDate = new Date();
      const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
      startDate.setDate(startDate.getDate() - days);

      // Build aggregation pipeline
      const matchStage: any = {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate },
      };

      if (service) {
        matchStage.service = service;
      }

      const prompts = await this.usageModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$prompt',
            count: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            avgTokens: { $avg: '$totalTokens' },
            models: { $addToSet: '$model' },
            services: { $addToSet: '$service' },
          },
        },
        { $match: { count: { $gte: minCalls } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
        {
          $project: {
            prompt: '$_id',
            count: 1,
            promptId: { $toString: '$_id' },
            totalCost: 1,
            avgTokens: 1,
            models: 1,
            services: 1,
          },
        },
      ]);

      return prompts;
    } catch (error) {
      this.logger.error('Get prompts for bulk optimization error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to get prompts for bulk optimization');
    }
  }

  /**
   * Get the complete optimization configuration, with documentation for each option.
   * When userId is provided, fetches user-specific overrides from User.optimizationConfig and merges with defaults.
   */
  async getOptimizationConfig(userId?: string): Promise<any> {
    // Default config object with complete keys, explanations, and options
    const defaultConfig = {
      enabledTechniques: process.env.ENABLED_OPTIMIZATION_TECHNIQUES?.split(
        ',',
      ) || [
        'prompt_compression', // Enables prompt compression to reduce prompt size
        'context_trimming', // Enables trimming of context/history for lower token usage
        'request_fusion', // Enables fusing similar adjacent requests to save costs
      ],
      defaultSettings: {
        promptCompression: {
          enabled: process.env.PROMPT_COMPRESSION_ENABLED !== 'false', // Toggle prompt compression module
          minCompressionRatio: parseFloat(
            process.env.MIN_COMPRESSION_RATIO || '0.2',
          ), // Minimum required compression ratio to apply changes
          jsonCompressionThreshold: parseInt(
            process.env.JSON_COMPRESSION_THRESHOLD || '1000',
            10,
          ), // Apply JSON/minification for prompts over this token threshold
          removeStopwords: process.env.REMOVE_STOPWORDS !== 'false', // Optionally remove stopwords for additional compression
          aggressiveCompression: process.env.AGGRESSIVE_COMPRESSION === 'true', // If true, compress even at the risk of minor quality drop
        },
        contextTrimming: {
          enabled: process.env.CONTEXT_TRIMMING_ENABLED !== 'false', // Toggle context trimming
          maxContextLength: parseInt(
            process.env.MAX_CONTEXT_LENGTH || '4000',
            10,
          ), // Max total tokens to include from conversation history
          preserveRecentMessages: parseInt(
            process.env.PRESERVE_RECENT_MESSAGES || '3',
            10,
          ), // Always preserve this many most recent messages (if present)
          overlapPreservationRatio: parseFloat(
            process.env.OVERLAP_PRESERVATION_RATIO || '0.15',
          ), // Fraction of most recent messages to compare for overlap
          minContextToPreserve: parseInt(
            process.env.MIN_CONTEXT_TO_PRESERVE || '1',
            10,
          ), // Always keep at least this many context messages if available
        },
        requestFusion: {
          enabled: process.env.REQUEST_FUSION_ENABLED !== 'false', // Toggle request fusion feature
          maxFusionBatch: parseInt(process.env.MAX_FUSION_BATCH || '5', 10), // Maximum requests to fuse/batch together
          fusionWaitTime: parseInt(process.env.FUSION_WAIT_TIME || '1000', 10), // Time in ms to wait for more requests to batch
          allowCrossModelFusion:
            process.env.ALLOW_CROSS_MODEL_FUSION === 'true', // If true, allows fusion across different models
          minPromptSimilarity: parseFloat(
            process.env.MIN_PROMPT_SIMILARITY || '0.85',
          ), // Cosine similarity threshold for fusion
        },
      },
      thresholds: {
        highCostPerRequest: parseFloat(
          process.env.HIGH_COST_PER_REQUEST || '0.01',
        ), // Requests above this USD cost are flagged as high
        highTokenUsage: parseInt(process.env.HIGH_TOKEN_USAGE || '2000', 10), // Requests above this token count are flagged as high
        frequencyThreshold: parseInt(
          process.env.FREQUENCY_THRESHOLD || '5',
          10,
        ), // Calls above this per time period are frequent
        batchingThreshold: parseInt(process.env.BATCHING_THRESHOLD || '3', 10), // Minimum similar requests to consider for fusion
        modelDowngradeConfidence: parseFloat(
          process.env.MODEL_DOWNGRADE_CONFIDENCE || '0.8',
        ), // Confidence threshold for suggesting lower-cost models
        minQualityRetention: parseFloat(
          process.env.MIN_QUALITY_RETENTION || '0.95',
        ), // Minimum acceptable quality score in downgrades
      },
    };

    if (userId) {
      const user = await this.userModel
        .findById(userId)
        .select('optimizationConfig')
        .lean();
      const stored = (user as any)?.optimizationConfig;
      if (stored && typeof stored === 'object') {
        return this.deepMergeConfig(defaultConfig, stored);
      }
    }

    return defaultConfig;
  }

  /**
   * Deep merge user config overrides into default config
   */
  private deepMergeConfig(
    defaultConfig: Record<string, any>,
    overrides: Record<string, any>,
  ): Record<string, any> {
    const result = { ...defaultConfig };
    for (const key of Object.keys(overrides)) {
      if (
        overrides[key] !== undefined &&
        typeof overrides[key] === 'object' &&
        !Array.isArray(overrides[key]) &&
        defaultConfig[key] &&
        typeof defaultConfig[key] === 'object' &&
        !Array.isArray(defaultConfig[key])
      ) {
        result[key] = this.deepMergeConfig(defaultConfig[key], overrides[key]);
      } else if (overrides[key] !== undefined) {
        result[key] = overrides[key];
      }
    }
    return result;
  }

  /**
   * Update optimization configuration.
   * (userId, config) updates user document; (config) updates system config in OptimizationConfig collection.
   */
  async updateOptimizationConfig(
    userIdOrConfig: string | Record<string, any>,
    config?: any,
  ): Promise<any> {
    if (typeof userIdOrConfig === 'string' && config !== undefined) {
      await this.userModel.findByIdAndUpdate(
        userIdOrConfig,
        { $set: { optimizationConfig: config } },
        { new: true, upsert: false },
      );
      this.logger.log('Optimization configuration updated (user)', {
        userId: userIdOrConfig,
        configKeys: Object.keys(config || {}),
      });
      return config;
    }
    const systemConfig = userIdOrConfig as Record<string, any>;
    const updates = Object.entries(systemConfig).map(([key, value]) => ({
      updateOne: {
        filter: { key, scope: 'system' },
        update: { value, updatedAt: new Date() },
        upsert: true,
      },
    }));
    if (updates.length > 0) {
      await this.optimizationConfigModel.bulkWrite(updates);
      this.logger.log(
        `Updated ${updates.length} optimization configuration values`,
      );
    }
    return systemConfig;
  }

  /**
   * Get optimization templates
   */
  async getOptimizationTemplates(category?: string): Promise<any[]> {
    try {
      // Get real optimization templates from database
      const matchStage: any = {};
      if (category) {
        matchStage.category = category;
      }

      const templates = await this.optimizationModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            avgImprovement: { $avg: '$improvementPercentage' },
            totalSaved: { $sum: '$costSaved' },
            examples: {
              $push: {
                before: '$userQuery',
                after: '$generatedAnswer',
                savings: '$improvementPercentage',
              },
            },
          },
        },
        {
          $project: {
            id: '$_id',
            name: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$_id', 'prompt_reduction'] },
                    then: 'Prompt Reduction',
                  },
                  {
                    case: { $eq: ['$_id', 'context_optimization'] },
                    then: 'Context Optimization',
                  },
                  {
                    case: { $eq: ['$_id', 'compression'] },
                    then: 'Compression',
                  },
                  {
                    case: { $eq: ['$_id', 'model_selection'] },
                    then: 'Model Selection',
                  },
                ],
                default: 'General Optimization',
              },
            },
            category: '$_id',
            description: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$_id', 'prompt_reduction'] },
                    then: 'Optimize prompts for better efficiency and cost reduction',
                  },
                  {
                    case: { $eq: ['$_id', 'context_optimization'] },
                    then: 'Reduce context length while maintaining quality',
                  },
                  {
                    case: { $eq: ['$_id', 'compression'] },
                    then: 'Compress prompts using various techniques',
                  },
                  {
                    case: { $eq: ['$_id', 'model_selection'] },
                    then: 'Switch to more cost-effective models',
                  },
                ],
                default: 'General optimization techniques',
              },
            },
            examples: { $slice: ['$examples', 3] },
            techniques: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$_id', 'prompt_reduction'] },
                    then: [
                      'rewriting',
                      'simplification',
                      'structure_optimization',
                    ],
                  },
                  {
                    case: { $eq: ['$_id', 'context_optimization'] },
                    then: [
                      'sliding_window',
                      'relevance_filtering',
                      'summarization',
                    ],
                  },
                  {
                    case: { $eq: ['$_id', 'compression'] },
                    then: [
                      'json_compression',
                      'pattern_replacement',
                      'abbreviation',
                    ],
                  },
                  {
                    case: { $eq: ['$_id', 'model_selection'] },
                    then: [
                      'cost_analysis',
                      'performance_comparison',
                      'capability_matching',
                    ],
                  },
                ],
                default: ['general_optimization'],
              },
            },
            avgImprovement: { $round: ['$avgImprovement', 2] },
          },
        },
      ]);

      return templates;
    } catch (error) {
      this.logger.error('Get optimization templates error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to get optimization templates');
    }
  }

  /**
   * Get optimization history
   */
  async getOptimizationHistory(
    promptHash: string,
    userId: string,
  ): Promise<any> {
    try {
      // Get optimization history for a specific prompt
      const history = await this.optimizationModel
        .find({
          userId: new mongoose.Types.ObjectId(userId),
          $or: [
            { userQuery: { $regex: promptHash, $options: 'i' } },
            { generatedAnswer: { $regex: promptHash, $options: 'i' } },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .select(
          'userQuery generatedAnswer tokensSaved costSaved improvementPercentage createdAt',
        )
        .lean();

      const formattedHistory = history.map((opt, index) => ({
        id: opt._id,
        version: history.length - index, // Calculate version based on order
        prompt: opt.generatedAnswer || opt.userQuery, // Updated field names
        tokens: opt.tokensSaved || 0,
        cost: opt.costSaved || 0,
        createdAt: opt.createdAt,
      }));

      return {
        history: formattedHistory,
        currentVersion:
          formattedHistory.length > 0 ? formattedHistory[0].version : 1,
      };
    } catch (error) {
      this.logger.error('Get optimization history error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to get optimization history');
    }
  }

  /**
   * Revert optimization to previous version. Supports (userId, optimizationId, version?) for controller.
   */
  async revertOptimization(
    userIdOrOptimizationId: string,
    optimizationIdOrVersion?: string | number,
    version?: number,
  ): Promise<OptimizationResultDto & { message?: string; revertedAt?: Date }> {
    try {
      const userId =
        typeof optimizationIdOrVersion === 'string'
          ? userIdOrOptimizationId
          : undefined;
      const id =
        typeof optimizationIdOrVersion === 'string'
          ? optimizationIdOrVersion
          : userIdOrOptimizationId;
      const ver =
        typeof optimizationIdOrVersion === 'number'
          ? optimizationIdOrVersion
          : version;

      const optimization = await this.optimizationModel.findOne({
        _id: new mongoose.Types.ObjectId(id),
        ...(userId && { userId: new mongoose.Types.ObjectId(userId) }),
      });

      if (!optimization) {
        throw new Error('Optimization not found');
      }

      if (!optimization.metadata) {
        optimization.metadata = {};
      }
      optimization.metadata.revertedAt = new Date();
      optimization.metadata.revertedVersion = ver ?? 1;
      await optimization.save();

      this.logger.log('Optimization reverted:', {
        optimizationId: id,
        userId: optimization.userId,
        revertedAt: optimization.metadata.revertedAt,
      });

      const result = this.buildResultDto(
        optimization,
      ) as OptimizationResultDto & { message?: string; revertedAt?: Date };
      result.message = 'Optimization reverted successfully';
      result.revertedAt = optimization.metadata.revertedAt as Date;
      return result;
    } catch (error) {
      this.logger.error('Revert optimization error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to revert optimization');
    }
  }

  /**
   * Get Cortex cache statistics
   */
  async getCortexCacheStats(): Promise<any> {
    try {
      const stats = (this.cortexCacheService as any).getCacheStats?.() ?? {};

      return {
        cache: stats,
        performance: {
          hitRatePercentage: stats.hitRate
            ? (stats.hitRate * 100).toFixed(1)
            : '0.0',
          utilizationPercentage: (
            (stats.size / stats.maxEntries) *
            100
          ).toFixed(1),
          estimatedMemorySavedMB:
            stats.size > 0 ? ((stats.size * 2.5) / 1000).toFixed(2) : '0.00', // Rough estimate
        },
      };
    } catch (error) {
      this.logger.error('Error getting Cortex cache stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clear Cortex cache
   */
  async clearCortexCache(): Promise<void> {
    try {
      (this.cortexCacheService as any).clearCache?.();

      this.logger.log('Cortex cache cleared successfully');
    } catch (error) {
      this.logger.error('Error clearing Cortex cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get optimization history by prompt hash
   */
  public async getOptimizationHistoryByPromptHash(
    userId: string,
    promptHash: string,
  ): Promise<{
    optimizations: OptimizationResultDto[];
    totalSaved: number;
    averageReduction: number;
    mostUsedModel: string | null;
    totalOptimizations: number;
    timeRange: { start: Date; end: Date } | null;
    modelDistribution: Record<string, number>;
    trend: 'improving' | 'stable' | 'declining' | null;
  }> {
    try {
      // Find all optimizations for the user
      const allOptimizations = await this.optimizationModel
        .find({ userId })
        .exec();

      // Find optimizations with matching prompt hash (schema uses userQuery)
      const matchingOptimizations = allOptimizations.filter((opt) => {
        const calculatedHash = this.calculatePromptHash(opt.userQuery);
        return calculatedHash === promptHash;
      });

      if (matchingOptimizations.length === 0) {
        return {
          optimizations: [],
          totalSaved: 0,
          averageReduction: 0,
          mostUsedModel: null,
          totalOptimizations: 0,
          timeRange: null,
          modelDistribution: {},
          trend: null,
        };
      }

      // Convert to DTOs (schema uses costSaved, improvementPercentage)
      const optimizationDtos = matchingOptimizations.map((opt) =>
        this.buildResultDto(opt),
      );

      const totalSaved = matchingOptimizations.reduce(
        (sum, opt) => sum + opt.costSaved,
        0,
      );
      const averageReduction =
        matchingOptimizations.reduce(
          (sum, opt) => sum + opt.improvementPercentage,
          0,
        ) / matchingOptimizations.length;

      // Find most used model
      const modelCounts = matchingOptimizations.reduce(
        (acc, opt) => {
          acc[opt.model] = (acc[opt.model] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const mostUsedModel =
        Object.entries(modelCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ||
        null;

      // Calculate time range
      const sortedByDate = matchingOptimizations.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const timeRange =
        sortedByDate.length > 0
          ? {
              start: sortedByDate[0].createdAt,
              end: sortedByDate[sortedByDate.length - 1].createdAt,
            }
          : null;

      // Calculate model distribution
      const modelDistribution = matchingOptimizations.reduce(
        (acc, opt) => {
          acc[opt.model] = (acc[opt.model] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Determine trend
      const trend = this.calculateOptimizationTrend(matchingOptimizations);

      return {
        optimizations: optimizationDtos,
        totalSaved,
        averageReduction,
        mostUsedModel,
        totalOptimizations: matchingOptimizations.length,
        timeRange,
        modelDistribution,
        trend,
      };
    } catch (error) {
      this.logger.error(
        `Error retrieving optimization history for prompt hash ${promptHash}`,
        error,
      );
      throw new Error('Failed to retrieve optimization history');
    }
  }

  private calculatePromptHash(prompt: string): string {
    // Simple hash calculation for prompt content
    return crypto
      .createHash('sha256')
      .update(prompt.trim().toLowerCase())
      .digest('hex')
      .substring(0, 16);
  }

  private calculateOptimizationTrend(
    optimizations: Optimization[],
  ): 'improving' | 'stable' | 'declining' | null {
    if (optimizations.length < 2) return null;

    // Sort by creation date
    const sorted = optimizations.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    // Calculate trend in percentage savings over time
    const recent = sorted.slice(-Math.min(5, sorted.length)); // Last 5 optimizations
    const older = sorted.slice(0, Math.max(0, sorted.length - 5)); // Earlier optimizations

    if (recent.length === 0 || older.length === 0) return null;

    const recentAvg =
      recent.reduce((sum, opt) => sum + opt.improvementPercentage, 0) /
      recent.length;
    const olderAvg =
      older.reduce((sum, opt) => sum + opt.improvementPercentage, 0) /
      older.length;

    const difference = recentAvg - olderAvg;

    if (difference > 2) return 'improving'; // Significant improvement
    if (difference < -2) return 'declining'; // Significant decline
    return 'stable';
  }

  /**
   * Record feedback for an optimization
   */
  public async recordOptimizationFeedback(
    userId: string,
    optimizationId: string,
    feedback: FeedbackDto,
  ): Promise<{
    optimization: OptimizationResultDto;
    recordedAt: Date;
  }> {
    try {
      // Find the optimization and verify ownership
      const optimization = await this.optimizationModel
        .findOne({
          _id: optimizationId,
          userId: userId,
        })
        .exec();

      if (!optimization) {
        throw new Error('Optimization not found or access denied');
      }

      const rating = feedback.rating ?? 0;
      const feedbackData = {
        helpful: rating >= 4,
        rating,
        comment: feedback.comment,
        submittedAt: new Date(),
      };

      if (feedback.appliedResult) {
        optimization.metadata = {
          ...optimization.metadata,
          appliedResult: feedback.appliedResult,
          feedbackRecordedAt: new Date(),
        };
      }

      optimization.feedback = feedbackData;
      optimization.updatedAt = new Date();

      // Save the updated optimization
      const savedOptimization = await optimization.save();

      // Log the feedback activity
      await this.logOptimizationFeedbackActivity(
        userId,
        optimizationId,
        feedback,
      );

      // Update user usage statistics if this feedback indicates the optimization was helpful
      if (feedbackData.helpful) {
        await this.updateUserFeedbackStats(userId, optimizationId, rating);
      }

      return {
        optimization: this.buildResultDto(savedOptimization),
        recordedAt: feedbackData.submittedAt,
      };
    } catch (error) {
      this.logger.error(
        `Error recording feedback for optimization ${optimizationId}`,
        error,
      );
      throw new Error('Failed to record optimization feedback');
    }
  }

  private async logOptimizationFeedbackActivity(
    userId: string,
    optimizationId: string,
    feedback: FeedbackDto,
  ): Promise<void> {
    try {
      await this.activityModel.create({
        userId,
        type: 'optimization_feedback',
        description: `User provided feedback (rating: ${feedback.rating ?? 0}) for optimization ${optimizationId}`,
        metadata: {
          optimizationId,
          rating: feedback.rating ?? 0,
          comment: feedback.comment,
          appliedResult: feedback.appliedResult,
          helpful: (feedback.rating ?? 0) >= 4,
        },
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log feedback activity: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async updateUserFeedbackStats(
    userId: string,
    optimizationId: string,
    rating: number,
  ): Promise<void> {
    try {
      // Update user's feedback statistics for a specific optimization
      await this.userModel.findByIdAndUpdate(
        userId,
        {
          $inc: {
            [`usageStats.optimizationFeedback.${optimizationId}.feedbackCount`]: 1,
            [`usageStats.optimizationFeedback.${optimizationId}.helpfulFeedbackCount`]:
              rating >= 4 ? 1 : 0,
            [`usageStats.optimizationFeedback.${optimizationId}.totalRating`]:
              rating,
          },
          $set: {
            [`usageStats.optimizationFeedback.${optimizationId}.lastFeedbackAt`]:
              new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to update user feedback stats for optimization ${optimizationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Apply compression optimization to prompt
   */
  private async applyCompressionOptimization(
    prompt: string,
    dto: CreateOptimizationDto,
  ): Promise<string> {
    // Use dto for options if present, otherwise apply defaults
    try {
      const targetReduction = (dto as any).targetReduction ?? 0.3;
      const preserveSemantics =
        'preserveSemantics' in dto ? (dto as any).preserveSemantics : true;

      const compressionRequest = {
        input: { frameType: 'query', action: prompt },
        operation: 'compress',
        options: {
          targetReduction,
          preserveSemantics,
        },
      };

      const result = await this.cortexCoreService.compress(
        compressionRequest.input as import('../cortex/types/cortex.types').CortexFrame,
        targetReduction,
      );
      // result.output.action may not exist, fallback to prompt
      return result.output && (result.output as any).action
        ? (result.output as any).action
        : prompt;
    } catch (error) {
      this.logger.warn(
        'Cortex compression failed, using traditional compression',
        error,
      );
      return this.applyTraditionalCompression(prompt);
    }
  }

  /**
   * Apply context trimming optimization
   */
  private async applyContextTrimmingOptimization(
    prompt: string,
    conversationHistory: any[],
  ): Promise<string> {
    if (!conversationHistory || conversationHistory.length === 0) {
      return prompt;
    }

    try {
      // Use optimization utils for context trimming
      const contextMessages = conversationHistory.map((h) => ({
        role: h.role || 'user',
        content: h.content || '',
        timestamp: h.timestamp,
      }));

      const maxContextSize = 2000;
      const currentWindowSize = contextMessages.reduce(
        (s, m) => s + (m.content?.length ? Math.ceil(m.content.length / 4) : 0),
        0,
      );
      const trimmedContext =
        this.optimizationUtilsService.trimConversationContext({
          messages: contextMessages,
          currentWindowSize,
          maxContextSize,
          utilization: currentWindowSize / maxContextSize,
        });

      // Combine trimmed context with current prompt
      const contextText = trimmedContext.messages
        .slice(-5) // Keep last 5 messages for context
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      return `${contextText}\n\nCurrent request: ${prompt}`;
    } catch (error) {
      this.logger.warn('Context trimming failed', error);
      return this.applyTraditionalContextTrimming(prompt, conversationHistory);
    }
  }

  /**
   * Apply request fusion optimization
   */
  private async applyRequestFusionOptimization(
    prompt: string,
    dto: CreateOptimizationDto,
  ): Promise<string> {
    // Request fusion combines similar requests or extracts common patterns
    try {
      if (dto.conversationHistory && dto.conversationHistory.length > 1) {
        // Analyze conversation history for patterns
        const recentMessages = dto.conversationHistory.slice(-3);
        const fusedRequest = this.fuseRelatedRequests(prompt, recentMessages);

        if (fusedRequest !== prompt) {
          this.logger.log('Applied request fusion optimization');
          return fusedRequest;
        }
      }

      return prompt;
    } catch (error) {
      this.logger.warn('Request fusion failed', error);
      return prompt;
    }
  }

  /**
   * Traditional compression fallback
   */
  private applyTraditionalCompression(prompt: string): string {
    // Simple compression: remove redundant words, shorten sentences
    return prompt
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\b(the|and|or|but|in|on|at|to|for|of|with|by)\s+/gi, '') // Remove common words
      .replace(/([.!?])\s+/g, '$1 ') // Normalize punctuation spacing
      .trim();
  }

  /**
   * Traditional context trimming fallback
   */
  private applyTraditionalContextTrimming(
    prompt: string,
    conversationHistory: any[],
  ): string {
    if (!conversationHistory || conversationHistory.length === 0) {
      return prompt;
    }

    // Simple context trimming: keep only recent messages
    const recentContext = conversationHistory
      .slice(-2) // Keep last 2 messages
      .map((h) => `${h.role || 'user'}: ${h.content || ''}`)
      .join('\n');

    return `${recentContext}\n\n${prompt}`;
  }

  /**
   * Fuse related requests based on conversation history
   */
  private fuseRelatedRequests(
    currentPrompt: string,
    recentMessages: any[],
  ): string {
    // Simple fusion: if recent messages are related, combine them
    const recentContent = recentMessages
      .map((m) => m.content || '')
      .join(' ')
      .toLowerCase();
    const currentContent = currentPrompt.toLowerCase();

    // Check for overlapping keywords
    const currentWords = new Set(currentContent.split(/\s+/));
    const recentWords = new Set(recentContent.split(/\s+/));

    const overlap = [...currentWords].filter(
      (word) => recentWords.has(word) && word.length > 3,
    );
    const overlapRatio = overlap.length / currentWords.size;

    if (overlapRatio > 0.3) {
      // Significant overlap - create fused request
      const combinedContext = recentMessages.map((m) => m.content).join(' ');
      return `Based on our conversation: ${combinedContext}\n\nCurrent request: ${currentPrompt}`;
    }

    return currentPrompt;
  }

  /**
   * Detect prompt caching opportunities based on usage patterns and semantic similarity
   */
  async detectPromptCachingOpportunities(
    userId: string,
    options: {
      timeRange?: { from: Date; to: Date };
      minFrequency?: number;
      minSavings?: number;
      includeEmbeddings?: boolean;
    } = {},
  ): Promise<{
    opportunities: Array<{
      promptPattern: string;
      frequency: number;
      estimatedSavings: number;
      confidence: number;
      similarPrompts: string[];
      recommendedCacheKey: string;
      implementationComplexity: 'low' | 'medium' | 'high';
    }>;
    summary: {
      totalOpportunities: number;
      totalEstimatedSavings: number;
      averageConfidence: number;
      implementationEffort: 'low' | 'medium' | 'high';
    };
  }> {
    try {
      this.logger.log('Detecting prompt caching opportunities', {
        userId,
        options,
      });

      const timeRange = options.timeRange || {
        from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        to: new Date(),
      };

      // Get user's recent usage data
      const usageData = await this.usageModel
        .find({
          userId,
          createdAt: { $gte: timeRange.from, $lte: timeRange.to },
        })
        .sort({ createdAt: -1 })
        .limit(1000)
        .exec();

      if (usageData.length === 0) {
        return {
          opportunities: [],
          summary: {
            totalOpportunities: 0,
            totalEstimatedSavings: 0,
            averageConfidence: 0,
            implementationEffort: 'low',
          },
        };
      }

      // Extract prompts from usage data
      const prompts = usageData
        .filter((usage) => usage.prompt && usage.prompt.length > 10)
        .map((usage) => ({
          text: usage.prompt,
          timestamp: usage.createdAt,
          tokens: usage.totalTokens || 0,
          cost: usage.cost || 0,
          model: usage.model,
        }));

      // Group similar prompts using semantic clustering
      const promptClusters = await this.clusterSimilarPrompts(
        prompts,
        options.includeEmbeddings,
      );

      // Analyze each cluster for caching opportunities
      const opportunities = await Promise.all(
        promptClusters
          .filter((cluster) => cluster.frequency >= (options.minFrequency || 3))
          .map(async (cluster) => {
            const estimatedSavings = this.calculateCachingSavings(cluster);
            const implementationComplexity =
              this.assessImplementationComplexity(cluster);

            return {
              promptPattern: cluster.representativePrompt,
              frequency: cluster.frequency,
              estimatedSavings,
              confidence: cluster.confidence,
              similarPrompts: cluster.prompts.slice(0, 5), // Top 5 similar prompts
              recommendedCacheKey: this.generateCacheKey(
                cluster.representativePrompt,
              ),
              implementationComplexity,
            };
          }),
      );

      // Filter by minimum savings threshold
      const filteredOpportunities = opportunities.filter(
        (opp) => opp.estimatedSavings >= (options.minSavings || 1.0),
      );

      // Sort by potential savings
      filteredOpportunities.sort(
        (a, b) => b.estimatedSavings - a.estimatedSavings,
      );

      const totalSavings = filteredOpportunities.reduce(
        (sum, opp) => sum + opp.estimatedSavings,
        0,
      );
      const avgConfidence =
        filteredOpportunities.length > 0
          ? filteredOpportunities.reduce(
              (sum, opp) => sum + opp.confidence,
              0,
            ) / filteredOpportunities.length
          : 0;

      const summary = {
        totalOpportunities: filteredOpportunities.length,
        totalEstimatedSavings: totalSavings,
        averageConfidence: avgConfidence,
        implementationEffort: this.calculateOverallEffort(
          filteredOpportunities,
        ),
      };

      this.logger.log('Prompt caching opportunities detected', {
        userId,
        opportunities: filteredOpportunities.length,
        totalSavings,
      });

      return {
        opportunities: filteredOpportunities,
        summary,
      };
    } catch (error) {
      this.logger.error('Failed to detect prompt caching opportunities', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      return {
        opportunities: [],
        summary: {
          totalOpportunities: 0,
          totalEstimatedSavings: 0,
          averageConfidence: 0,
          implementationEffort: 'low',
        },
      };
    }
  }

  /**
   * Cluster similar prompts using semantic analysis
   */
  private async clusterSimilarPrompts(
    prompts: Array<{
      text: string;
      timestamp: Date;
      tokens: number;
      cost: number;
      model: string;
    }>,
    includeEmbeddings?: boolean,
  ): Promise<
    Array<{
      representativePrompt: string;
      prompts: string[];
      frequency: number;
      confidence: number;
      avgTokens: number;
      avgCost: number;
      models: string[];
    }>
  > {
    const clusters: Array<{
      representativePrompt: string;
      prompts: string[];
      frequency: number;
      confidence: number;
      avgTokens: number;
      avgCost: number;
      models: string[];
    }> = [];

    // Simple clustering based on text similarity (could be enhanced with embeddings)
    const processedPrompts = new Set<string>();

    for (const prompt of prompts) {
      if (processedPrompts.has(prompt.text)) continue;

      const similarPrompts = this.findSimilarPrompts(prompt.text, prompts);
      if (similarPrompts.length >= 2) {
        const cluster = {
          representativePrompt:
            this.extractRepresentativePrompt(similarPrompts),
          prompts: similarPrompts.map((p) => p.text),
          frequency: similarPrompts.length,
          confidence: this.calculateClusterConfidence(similarPrompts),
          avgTokens:
            similarPrompts.reduce((sum, p) => sum + p.tokens, 0) /
            similarPrompts.length,
          avgCost:
            similarPrompts.reduce((sum, p) => sum + p.cost, 0) /
            similarPrompts.length,
          models: [...new Set(similarPrompts.map((p) => p.model))],
        };

        clusters.push(cluster);
        similarPrompts.forEach((p) => processedPrompts.add(p.text));
      }
    }

    return clusters;
  }

  /**
   * Find prompts similar to the given prompt
   */
  private findSimilarPrompts(
    targetPrompt: string,
    allPrompts: Array<{
      text: string;
      timestamp: Date;
      tokens: number;
      cost: number;
      model: string;
    }>,
    threshold: number = 0.7,
  ): Array<{
    text: string;
    timestamp: Date;
    tokens: number;
    cost: number;
    model: string;
  }> {
    const similar: Array<{
      text: string;
      timestamp: Date;
      tokens: number;
      cost: number;
      model: string;
    }> = [];

    for (const prompt of allPrompts) {
      if (prompt.text === targetPrompt) {
        similar.push(prompt);
        continue;
      }

      const similarity = this.calculateTextSimilarity(
        targetPrompt,
        prompt.text,
      );
      if (similarity >= threshold) {
        similar.push(prompt);
      }
    }

    return similar;
  }

  /**
   * Calculate text similarity using simple Jaccard similarity
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(
      text1
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
    const words2 = new Set(
      text2
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Extract a representative prompt from a cluster
   */
  private extractRepresentativePrompt(
    prompts: Array<{
      text: string;
      timestamp: Date;
      tokens: number;
      cost: number;
      model: string;
    }>,
  ): string {
    // Use the most frequent or longest prompt as representative
    return prompts.reduce(
      (longest, current) =>
        current.text.length > longest.length ? current.text : longest,
      prompts[0].text,
    );
  }

  /**
   * Calculate confidence score for a cluster
   */
  private calculateClusterConfidence(
    prompts: Array<{
      text: string;
      timestamp: Date;
      tokens: number;
      cost: number;
      model: string;
    }>,
  ): number {
    if (prompts.length < 2) return 0;

    // Calculate average similarity within the cluster
    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < prompts.length; i++) {
      for (let j = i + 1; j < prompts.length; j++) {
        totalSimilarity += this.calculateTextSimilarity(
          prompts[i].text,
          prompts[j].text,
        );
        pairCount++;
      }
    }

    const avgSimilarity = totalSimilarity / pairCount;

    // Boost confidence based on frequency and consistency
    const frequencyBonus = Math.min(prompts.length / 10, 1); // Max bonus at 10+ occurrences
    const consistencyBonus = avgSimilarity;

    return Math.min(frequencyBonus * 0.4 + consistencyBonus * 0.6, 1);
  }

  /**
   * Calculate potential savings from caching a prompt cluster
   */
  private calculateCachingSavings(cluster: {
    frequency: number;
    avgTokens: number;
    avgCost: number;
  }): number {
    // Estimate cache hit rate (conservative estimate)
    const estimatedCacheHitRate = Math.min(
      cluster.frequency / (cluster.frequency + 5),
      0.8,
    );

    // Calculate token savings (input tokens only, since cached prompts skip processing)
    const tokenSavings =
      cluster.avgTokens * cluster.frequency * estimatedCacheHitRate;

    // Estimate cost savings (rough approximation: $0.0001 per token)
    const costSavings = tokenSavings * 0.0001;

    // Add time savings benefit (estimated at $0.01 per second saved)
    const timeSavings = cluster.frequency * estimatedCacheHitRate * 0.01;

    return costSavings + timeSavings;
  }

  /**
   * Assess implementation complexity for caching a prompt pattern
   */
  private assessImplementationComplexity(cluster: {
    representativePrompt: string;
    prompts: string[];
    models: string[];
  }): 'low' | 'medium' | 'high' {
    const promptLength = cluster.representativePrompt.length;
    const modelVariety = cluster.models.length;
    const promptVariability = this.calculatePromptVariability(cluster.prompts);

    if (promptLength < 100 && modelVariety === 1 && promptVariability < 0.3) {
      return 'low';
    } else if (
      promptLength < 500 &&
      modelVariety <= 2 &&
      promptVariability < 0.5
    ) {
      return 'medium';
    } else {
      return 'high';
    }
  }

  /**
   * Calculate variability within a prompt cluster
   */
  private calculatePromptVariability(prompts: string[]): number {
    if (prompts.length < 2) return 0;

    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < prompts.length; i++) {
      for (let j = i + 1; j < prompts.length; j++) {
        totalSimilarity += this.calculateTextSimilarity(prompts[i], prompts[j]);
        pairCount++;
      }
    }

    return 1 - totalSimilarity / pairCount; // Lower similarity = higher variability
  }

  /**
   * Generate a cache key for a prompt
   */
  private generateCacheKey(prompt: string): string {
    // Create a deterministic cache key based on prompt content
    const hash = crypto
      .createHash('sha256')
      .update(prompt.trim().toLowerCase())
      .digest('hex');
    return `prompt_cache:${hash.substring(0, 16)}`;
  }

  /**
   * Calculate overall implementation effort
   */
  private calculateOverallEffort(
    opportunities: Array<{
      implementationComplexity: 'low' | 'medium' | 'high';
    }>,
  ): 'low' | 'medium' | 'high' {
    if (opportunities.length === 0) return 'low';

    const complexityScores = { low: 1, medium: 2, high: 3 };
    const avgScore =
      opportunities.reduce(
        (sum, opp) => sum + complexityScores[opp.implementationComplexity],
        0,
      ) / opportunities.length;

    if (avgScore <= 1.5) return 'low';
    if (avgScore <= 2.5) return 'medium';
    return 'high';
  }
}
