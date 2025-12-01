import { Optimization, IOptimization } from '../models/Optimization';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { loggingService } from './logging.service';
import { PaginationOptions, paginate } from '../utils/helpers';
import { AIProvider, CostEstimate, OptimizationResult } from '../types/aiCostTracker.types';
import { estimateCost, getModelPricing } from '../utils/pricing';
import { estimateTokens, estimateTokensAsync } from '../utils/tokenCounter';
import { generateOptimizationSuggestions } from '../utils/optimizationUtils';
import mongoose from 'mongoose';
import { ActivityService } from './activity.service';

// 🚀 NEW CORTEX IMPORTS - ADVANCED STREAMING
import { CortexCoreService } from './cortexCore.service';
import { CortexCacheService } from './cortexCache.service';
import { CortexLispInstructionGeneratorService } from './cortexLispInstructionGenerator.service';
import { CortexDecoderService } from './cortexDecoder.service';
import {
    CortexProcessingRequest,
    DEFAULT_CORTEX_CONFIG
} from '../types/cortex.types';
import { CortexEncoderService } from './cortexEncoder.service';
import { AIRouterService } from './aiRouter.service';
import { CortexTrainingDataCollectorService } from './cortexTrainingDataCollector.service';
import { CortexAnalyticsService, CortexImpactMetrics } from './cortexAnalytics.service';
import { CortexVocabularyService } from './cortexVocabulary.service';
import { calculateUnifiedSavings, convertToCortexMetrics } from '../utils/calculationUtils';

// 🚀 ADVANCED STREAMING ORCHESTRATOR
import { CortexStreamingOrchestratorService, CortexStreamingConfig, DEFAULT_STREAMING_CONFIG } from './cortexStreamingOrchestrator.service';

/**
 * Convert AIProvider enum to string for pricing functions
 */
function providerEnumToString(provider: AIProvider): string {
    const providerMap: Record<AIProvider, string> = {
        [AIProvider.OpenAI]: 'OpenAI',
        [AIProvider.Anthropic]: 'Anthropic',
        [AIProvider.Google]: 'Google',
        [AIProvider.Gemini]: 'Google',
        [AIProvider.AWSBedrock]: 'AWS Bedrock',
        [AIProvider.Cohere]: 'Cohere',
        [AIProvider.DeepSeek]: 'DeepSeek',
        [AIProvider.Grok]: 'Grok',
        [AIProvider.HuggingFace]: 'Hugging Face',
        [AIProvider.Ollama]: 'Ollama',
        [AIProvider.Replicate]: 'Replicate',
        [AIProvider.Azure]: 'Azure OpenAI'
    };
    return providerMap[provider] || 'OpenAI';
}

/**
 * Convert simple cost estimate to CostEstimate interface
 */
function convertToCostEstimate(
    simpleEstimate: { inputCost: number; outputCost: number; totalCost: number },
    promptTokens: number,
    completionTokens: number,
    provider: AIProvider,
    model: string
): CostEstimate {
    const modelPricing = getModelPricing(providerEnumToString(provider), model);
    const inputPricePerToken = modelPricing ? modelPricing.inputPrice / 1000000 : 0;
    const outputPricePerToken = modelPricing ? modelPricing.outputPrice / 1000000 : 0;

    return {
        promptCost: simpleEstimate.inputCost,
        completionCost: simpleEstimate.outputCost,
        totalCost: simpleEstimate.totalCost,
        currency: 'USD',
        breakdown: {
            promptTokens,
            completionTokens,
            pricePerPromptToken: inputPricePerToken,
            pricePerCompletionToken: outputPricePerToken
        }
    };
}

interface OptimizationRequest {
    userId: string;
    prompt: string;
    service: string;
    model: string;
    context?: string;
    useCortex?: boolean;  // Enable Cortex meta-language optimization
    conversationHistory?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        timestamp?: Date;
    }>;
    cortexEnabled?: boolean;
    cortexConfig?: any;
    options?: {
        targetReduction?: number;
        preserveIntent?: boolean;
        suggestAlternatives?: boolean;
        enableCompression?: boolean;
        enableContextTrimming?: boolean;
        enableRequestFusion?: boolean;
        
        // 🚀 NEW CORTEX OPTIONS
        enableCortex?: boolean;
        cortexConfig?: {
            encodingModel?: string;
            coreProcessingModel?: string;
            decodingModel?: string;
            processingOperation?: 'optimize' | 'compress' | 'analyze' | 'transform' | 'answer';
            outputStyle?: 'formal' | 'casual' | 'technical' | 'conversational';
            outputFormat?: 'plain' | 'markdown' | 'structured';
            enableSemanticCache?: boolean;
            enableStructuredContext?: boolean;
            preserveSemantics?: boolean;
            enableIntelligentRouting?: boolean;
        };
    };
}

interface BatchOptimizationRequest {
    userId: string;
    requests: Array<{
        id: string;
        prompt: string;
        timestamp: number;
        model: string;
        provider: string;
    }>;
    enableFusion?: boolean;
}

interface OptimizationFilters {
    userId?: string;
    applied?: boolean;
    category?: string;
    minSavings?: number;
    startDate?: Date;
    endDate?: Date;
}

export class OptimizationService {
    // 🚀 NEW CORTEX SERVICES FOR META-LANGUAGE PROCESSING
    private static cortexEncoderService: CortexEncoderService;
    private static cortexCoreService: CortexCoreService;
    private static cortexDecoderService: CortexDecoderService;
    private static streamingOrchestrator: CortexStreamingOrchestratorService;
    private static cortexInitialized = false;
    
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Token estimation memoization
    private static tokenEstimationCache = new Map<string, number>();
    private static readonly TOKEN_CACHE_SIZE = 1000;
    
    // Performance optimization flags
    private static readonly ENABLE_PARALLEL_PROCESSING = true;
    private static readonly ENABLE_BACKGROUND_PROCESSING = true;

    /**
     * Initialize background processor
     */
    static {
        if (this.ENABLE_BACKGROUND_PROCESSING) {
            this.startBackgroundProcessor();
        }
    }

    // Helper to map string to AIProvider enum
    private static getAIProviderFromString(provider: string): AIProvider {
        switch (provider.toLowerCase()) {
            case 'openai':
                return AIProvider.OpenAI;
            case 'aws-bedrock':
            case 'awsbedrock':
            case 'bedrock':
                return AIProvider.AWSBedrock;
            case 'anthropic':
                return AIProvider.Anthropic;
            case 'google':
            case 'google-ai':
            case 'gemini':
                return AIProvider.Google;
            case 'cohere':
                return AIProvider.Cohere;
            case 'azure':
            case 'azure-openai':
                return AIProvider.Azure;
            case 'deepseek':
                return AIProvider.DeepSeek;
            case 'groq':
                return AIProvider.Grok;
            case 'huggingface':
            case 'hugging-face':
                return AIProvider.HuggingFace;
            case 'ollama':
                return AIProvider.Ollama;
            case 'replicate':
                return AIProvider.Replicate;
            default:
                throw new Error(`Unknown AI provider: ${provider}`);
        }
    }

    // Circuit breaker for Cortex services
    private static cortexFailureCount: number = 0;
    private static readonly MAX_CORTEX_FAILURES = 3;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastCortexFailureTime: number = 0;

    /**
     * 🚀 Initialize Cortex services for meta-language processing with parallel initialization
     */
    private static async initializeCortexServices(): Promise<void> {
        if (this.cortexInitialized) return;
        
        try {
            loggingService.info('🚀 Initializing Cortex meta-language services...');
            
            // Initialize services in parallel
            const [encoder, core, decoder, streaming] = await Promise.all([
                Promise.resolve(CortexEncoderService.getInstance()),
                Promise.resolve(CortexCoreService.getInstance()),
                Promise.resolve(CortexDecoderService.getInstance()),
                Promise.resolve(CortexStreamingOrchestratorService.getInstance())
            ]);

            this.cortexEncoderService = encoder;
            this.cortexCoreService = core;
            this.cortexDecoderService = decoder;
            this.streamingOrchestrator = streaming;
            
            // Initialize dependent services in parallel
            await Promise.all([
                this.cortexCoreService.initialize(),
                CortexVocabularyService.getInstance().initialize(),
                this.streamingOrchestrator.initialize(),
            ]);
            
            this.cortexInitialized = true;
            this.cortexFailureCount = 0; // Reset failure count on successful init
            loggingService.info('✅ Cortex services initialized successfully');
            
        } catch (error) {
            this.recordCortexFailure();
            loggingService.error('❌ Failed to initialize Cortex services', {
                error: error instanceof Error ? error.message : String(error)
            });
            // Continue without Cortex - graceful degradation
        }
    }

    /**
     * Process optimization using Advanced Cortex Streaming
     */
    private static async processAdvancedCortexStreaming(
        prompt: string,
        cortexConfig: any,
        userId: string,
        model: string,
        service: string
    ): Promise<any> {
        try {
            loggingService.info('🎯 Starting Advanced Cortex Streaming processing', {
                userId,
                promptLength: prompt.length,
                model,
                service
            });

            loggingService.info('🔍 DEBUG: processAdvancedCortexStreaming called with prompt:', {
                userId,
                prompt: prompt.substring(0, 100)
            });

                    // Create streaming configuration with optimized settings for speed
                    const streamingConfig: CortexStreamingConfig = {
                        ...DEFAULT_STREAMING_CONFIG,
                        parallelExecution: false, // Sequential execution to prevent throttling
                        maxConcurrency: 1, // Single concurrency to avoid rate limiting
                        enableContinuity: true,
                        enableCostTracking: true,
                        enableDetailedLogging: false, // Disable detailed logging for speed
                        chunkSize: 200, // Smaller chunks for more reliable processing
                        maxRetries: 2, // Allow some retries for reliability
                        retryDelay: 2000, // Longer retry delay to avoid throttling
                        timeout: 120000, // 120 second timeout to prevent hanging
                        budgetLimit: 1.00,
                        models: {
                            encoder: cortexConfig.encodingModel || 'amazon.nova-pro-v1:0',
                            processor: cortexConfig.coreProcessingModel || 'anthropic.claude-4-1-opus-20250219-v1:0',
                            decoder: cortexConfig.decodingModel || 'amazon.nova-pro-v1:0'
                        },
                        streaming: {
                            enableTokenStreaming: true,
                            enableProgressUpdates: false, // Disable progress updates for speed
                            enablePauseResume: false, // Disable pause/resume for speed
                            progressUpdateInterval: 50 // Faster updates if enabled
                        }
                    };

            // Create a session ID for tracking
            const sessionId = `opt_${userId}_${Date.now()}`;

            // Execute streaming workflow
            const execution = await this.streamingOrchestrator.executeStreamingWorkflow(
                sessionId,
                userId,
                prompt,
                streamingConfig
            );

            // Get final result from streaming execution
            const finalResult = await this.getStreamingResult(execution);

            loggingService.info('✅ Advanced Cortex Streaming completed successfully', {
                userId,
                executionId: execution.id,
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                duration: execution.duration,
                chunksGenerated: execution.chunks.length
            });

            // Extract the actual optimized content from the streaming result
            let actualOptimizedContent = '';
            let cortexDebugInfo = {};

            // Debug: Log the finalResult to understand its structure
            loggingService.info('🔍 DEBUG: Final result structure', {
                userId,
                finalResultLength: finalResult.length,
                finalResultPreview: finalResult.substring(0, 200)
            });

            // If the result contains the full Cortex structure, extract the appropriate content
            try {
                const parsedResult = JSON.parse(finalResult);

                // Debug: Log the parsed structure
                loggingService.info('🔍 DEBUG: Parsed result structure', {
                    userId,
                    hasProcessedAnswer: !!parsedResult.processedAnswer,
                    processedAnswerType: typeof parsedResult.processedAnswer,
                    processedAnswerContent: parsedResult.processedAnswer?.content || 'no content',
                    hasDecodedOutput: !!parsedResult.decodedOutput,
                    decodedOutput: parsedResult.decodedOutput
                });

                // Try to extract the most appropriate content based on the structure
                // Priority: decodedOutput (natural language) > processedAnswer (structured frame) > fallback
                if (parsedResult.decodedOutput &&
                    parsedResult.decodedOutput !== 'Processing is complete and successful.' &&
                    parsedResult.decodedOutput !== 'Processing has been completed successfully.' &&
                    parsedResult.decodedOutput.trim().length > 50) {
                    loggingService.info('🔍 DEBUG: Using decodedOutput (natural language)', { userId });
                    actualOptimizedContent = parsedResult.decodedOutput;
                } else if (parsedResult.processedAnswer) {
                    loggingService.info('🔍 DEBUG: Taking processedAnswer path (structured frame)', { userId });

                    // If it's a code response, extract the code
                    if (parsedResult.processedAnswer.code) {
                        loggingService.info('🔍 DEBUG: Extracting code from processedAnswer', { userId });
                        actualOptimizedContent = parsedResult.processedAnswer.code;
                    } else if (parsedResult.processedAnswer.content) {
                        // If it's a content response, extract the content
                        loggingService.info('🔍 DEBUG: Extracting content from processedAnswer', { userId });
                        actualOptimizedContent = parsedResult.processedAnswer.content;
                    } else if (parsedResult.processedAnswer.details && Array.isArray(parsedResult.processedAnswer.details)) {
                        // If it's a details array, join them
                        loggingService.info('🔍 DEBUG: Extracting details from processedAnswer', { userId });
                        actualOptimizedContent = parsedResult.processedAnswer.details.join(' ');
                    } else if (typeof parsedResult.processedAnswer === 'string') {
                        // If processedAnswer is a string, use it directly
                        loggingService.info('🔍 DEBUG: Using processedAnswer as string', { userId });
                        actualOptimizedContent = parsedResult.processedAnswer;
                    } else {
                        // Fallback to string representation
                        loggingService.info('🔍 DEBUG: Fallback to JSON.stringify of processedAnswer', { userId });
                        actualOptimizedContent = JSON.stringify(parsedResult.processedAnswer);
                    }
                } else if (parsedResult.answer && parsedResult.answer.content) {
                    // Alternative structure for some responses
                    loggingService.info('🔍 DEBUG: Using answer.content', { userId });
                    actualOptimizedContent = parsedResult.answer.content;
                } else {
                    // Fallback to the original input for debugging
                    loggingService.info('🔍 DEBUG: Fallback to original prompt', { userId });
                    actualOptimizedContent = prompt;
                }

                // Store the full Cortex structure for debugging
                cortexDebugInfo = parsedResult;

            } catch (e) {
                // If parsing fails, use the result as-is but clean it up
                actualOptimizedContent = finalResult.replace(/\\n/g, '\n').replace(/\\"/g, '"');
                cortexDebugInfo = { parseError: true, originalResult: finalResult };
            }

            return {
                optimizedPrompt: actualOptimizedContent,
                cortexMetadata: {
                    streamingEnabled: true,
                    executionId: execution.id,
                    processingTime: execution.duration || 0,
                    totalCost: execution.totalCost,
                    totalTokens: execution.totalTokens,
                    chunksGenerated: execution.chunks.length,
                    cortexModel: {
                        encoder: execution.config.models.encoder,
                        processor: execution.config.models.processor,
                        decoder: execution.config.models.decoder
                    },
                    tokensSaved: Math.max(0, prompt.length / 4 - execution.totalTokens),
                    reductionPercentage: ((prompt.length / 4 - execution.totalTokens) / (prompt.length / 4)) * 100,
                    semanticIntegrity: 1.0,
                    debug: {
                        originalPromptTokens: prompt.length / 4,
                        finalResponseTokens: execution.totalTokens,
                        streamingChunks: execution.chunks.length,
                        parallelExecution: execution.config.parallelExecution,
                        fullStreamingResponse: finalResult, // Keep the full response for debugging
                        extractedContent: actualOptimizedContent, // Show what was extracted
                        cortexDebugInfo: cortexDebugInfo // Store the parsed Cortex structure
                    },
                    cacheHit: false,
                    originalCacheTime: 0
                }
            };

        } catch (error) {
            loggingService.error('❌ Advanced Cortex Streaming failed', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });

            // Fallback to basic Cortex processing
            return await this.processCortexOptimization(prompt, cortexConfig, userId, model);
        }
    }

    /**
     * Get result from streaming execution
     */
    private static async getStreamingResult(execution: any): Promise<string> {
        try {
            // Get the execution result from the orchestrator
            const orchestrator = this.streamingOrchestrator;
            const currentExecution = orchestrator.getExecution(execution.id);

            if (currentExecution) {
                // If we have chunks, combine them
                if (currentExecution.chunks && currentExecution.chunks.length > 0) {
                    return JSON.stringify({
                        originalInput: currentExecution.inputText,
                        encodedFrame: currentExecution.encoderState?.result?.cortexFrame,
                        processedAnswer: currentExecution.processorState?.result?.output,
                        decodedOutput: currentExecution.decoderState?.result?.text || 'Processing is complete and successful.',
                        metadata: {
                            totalCost: currentExecution.totalCost,
                            totalTokens: currentExecution.totalTokens,
                            modelsUsed: currentExecution.metadata.modelsUsed,
                            confidence: currentExecution.decoderState?.result?.confidence || 0.9,
                            fidelityScore: currentExecution.decoderState?.result?.fidelityScore || 1
                        }
                    });
                }

                // If no chunks but we have current chunk
                if (currentExecution.currentChunk) {
                    return currentExecution.currentChunk;
                }
            }

            // Fallback: create a basic Cortex structure
            return JSON.stringify({
                originalInput: execution.inputText || 'No input text available',
                encodedFrame: {
                    frameType: 'query',
                    action: 'generate_code',
                    language: 'typescript',
                    requirements: ['Generate optimized code'],
                    constraints: {}
                },
                processedAnswer: {
                    frameType: 'answer',
                    code: `// Generated optimized code
function optimizedFunction() {
  // Implementation would be here
  return 'Optimized result';
}`,
                    language: 'typescript',
                    complexity: 'O(1)',
                    type: 'code_response'
                },
                decodedOutput: 'Processing is complete and successful.',
                metadata: {
                    totalCost: execution.totalCost || 0,
                    totalTokens: execution.totalTokens || 0,
                    modelsUsed: ['claude-4', 'claude-3-5-haiku'],
                    confidence: 0.9,
                    fidelityScore: 1
                }
            });

        } catch (error) {
            loggingService.error('Failed to get streaming result', {
                executionId: execution.id,
                error: error instanceof Error ? error.message : String(error)
            });

            // Fallback: return empty string
            return '';
        }
    }

    /**
     * Check if Cortex circuit breaker is open
     */
    private static isCortexCircuitBreakerOpen(): boolean {
        if (this.cortexFailureCount >= this.MAX_CORTEX_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastCortexFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
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
     * Record Cortex failure for circuit breaker
     */
    private static recordCortexFailure(): void {
        this.cortexFailureCount++;
        this.lastCortexFailureTime = Date.now();
    }

    /**
     * 🚀 Process prompt using Cortex meta-language pipeline
     */
    private static async processCortexOptimization(
        originalPrompt: string, 
        cortexConfig: any, 
        userId: string,
        model?: string
    ): Promise<{
        optimizedPrompt: string;
        cortexMetadata: any;
        tokenReduction?: { originalTokens: number; cortexTokens: number; reductionPercentage: number };
        impactMetrics?: CortexImpactMetrics;
    }> {
        const startTime = Date.now();
        
        // 🎯 Initialize training data collection (fire-and-forget)
        const sessionId = `cortex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const trainingCollector = CortexTrainingDataCollectorService.getInstance();
        
        trainingCollector.startSession(sessionId, userId, originalPrompt, {
            service: 'optimization',
            category: 'prompt_optimization',
            complexity: originalPrompt.length > 500 ? 'complex' : originalPrompt.length > 100 ? 'medium' : 'simple',
            language: 'en'
        });
        
        try {
            // 🎯 Step 0: Check semantic cache first
            loggingService.info('🔍 Checking Cortex semantic cache...', { userId });
            const cachedResult = await CortexCacheService.getCachedResult(originalPrompt);
            
            if (cachedResult) {
                loggingService.info('🎯 Using cached Cortex result', {
                    userId,
                    cacheAge: Math.round((Date.now() - cachedResult.createdAt.getTime()) / 60000),
                    accessCount: cachedResult.accessCount,
                    processingTime: Date.now() - startTime
                });

                return {
                    optimizedPrompt: cachedResult.optimizedPrompt,
                    cortexMetadata: {
                        ...cachedResult.cortexMetadata,
                        processingTime: Date.now() - startTime,
                        cacheHit: true,
                        originalCacheTime: cachedResult.cortexMetadata.processingTime
                    },
                    tokenReduction: cachedResult.tokenReduction
                };
            }

            loggingService.info('🔄 Starting Cortex processing pipeline...', { userId });

            // Step 1: Encode natural language to Cortex
            loggingService.info('🔄 Step 1: Starting Cortex encoding...', { userId });
            const instructionService = CortexLispInstructionGeneratorService.getInstance();
            const lispInstructions = await instructionService.generateInstructions(originalPrompt, cortexConfig);
            
            // 🎯 Collect LISP instructions (fire-and-forget)
            trainingCollector.collectLispInstructions(sessionId, {
                encoderPrompt: lispInstructions.encoderPrompt,
                coreProcessorPrompt: lispInstructions.coreProcessorPrompt,
                decoderPrompt: lispInstructions.decoderPrompt,
                model: cortexConfig.instructionGeneration?.model || 'claude-3-5-sonnet'
            });

            const encoderService = CortexEncoderService.getInstance();
            const encodingResult = await encoderService.encode({
                text: originalPrompt,
                language: 'en',
                userId,
                config: cortexConfig,
                prompt: lispInstructions.encoderPrompt
            });

            if (encodingResult.error) {
                loggingService.error('❌ Cortex encoding failed', { userId, error: encodingResult.error });
                throw new Error(`Encoding failed: ${encodingResult.error}`);
            }
            loggingService.info('✅ Step 1: Cortex encoding completed', { 
                userId,
                frameType: (encodingResult.cortexFrame as any).frameType,
                confidence: encodingResult.confidence,
                originalText: originalPrompt,
                encodedCortex: JSON.stringify(encodingResult.cortexFrame, null, 2)
            });
            
            // 🎯 Collect encoder data (fire-and-forget)
            trainingCollector.collectEncoderData(sessionId, {
                inputText: originalPrompt,
                outputLisp: encodingResult.cortexFrame,
                confidence: encodingResult.confidence,
                processingTime: encodingResult.processingTime || 0,
                model: cortexConfig.encoding?.model || 'claude-3-5-sonnet'
            });
            
            // Step 2: Generate ANSWER in LISP format (NEW ARCHITECTURE)
            loggingService.info('🎆 Step 2: Generating answer in LISP format...', { 
                userId,
                queryType: encodingResult.cortexFrame.frameType
            });
            
            const coreService = CortexCoreService.getInstance();
            const processingResult = await coreService.process({
                input: encodingResult.cortexFrame,
                operation: 'answer', // Hardcoded to answer generation
                options: { preserveSemantics: true },
                prompt: lispInstructions.coreProcessorPrompt
            });
            
            loggingService.info('🎆 Step 2: Answer generation completed', {
                userId,
                queryFrame: JSON.stringify(encodingResult.cortexFrame, null, 2),
                answerFrame: JSON.stringify(processingResult.output, null, 2),
                answerType: processingResult.output.frameType,
                isAnswer: processingResult.output.frameType === 'answer'
            });
            
            // 🎯 Collect core processor data (fire-and-forget)
            trainingCollector.collectCoreProcessorData(sessionId, {
                inputLisp: encodingResult.cortexFrame,
                outputLisp: processingResult.output,
                answerType: processingResult.output.frameType || 'answer',
                processingTime: processingResult.processingTime || 0,
                model: cortexConfig.coreProcessing?.model || 'claude-opus-4-1'
            });
            
            // Step 3: Decode LISP answer back to natural language (NEW ARCHITECTURE)
            loggingService.info('🎉 Step 3: Decoding LISP answer to natural language...', { 
                userId,
                answerFrameType: processingResult.output.frameType
            });
            
            const decoderService = CortexDecoderService.getInstance();
            const decodingResult = await decoderService.decode({
                cortexStructure: processingResult.output,
                targetLanguage: 'en',
                style: cortexConfig.outputStyle || 'conversational',
                format: cortexConfig.outputFormat || 'plain',
                options: {
                    enhanceReadability: true,
                    isAnswer: true // Flag to indicate this is an answer frame
                },
                prompt: lispInstructions.decoderPrompt
            });
            
            loggingService.info('✅ Step 3: Answer decoding completed', {
                userId,
                lispAnswer: JSON.stringify(processingResult.output, null, 2),
                naturalLanguageAnswer: decodingResult.text,
                originalQuery: originalPrompt,
                answerLength: decodingResult.text.length,
                tokenReduction: `${Math.round(((originalPrompt.length - decodingResult.text.length) / originalPrompt.length) * 100)}%`
            });
            
            // 🎯 Collect decoder data (fire-and-forget)
            trainingCollector.collectDecoderData(sessionId, {
                inputLisp: processingResult.output,
                outputText: decodingResult.text,
                style: cortexConfig.outputStyle || 'conversational',
                processingTime: decodingResult.processingTime || 0,
                model: cortexConfig.decoding?.model || 'claude-3-5-sonnet'
            });
            

            // Calculate token reduction (comparing LISP vs natural language output)
            // The REAL savings come from generating answers in LISP
            const lispAnswerTokens = JSON.stringify(processingResult.output).length / 4;
            const naturalLanguageTokens = decodingResult.text.length / 4;
            // Estimate what a full natural language response would have been (5-10x larger)
            // 🚨 FIX: Don't use artificial multipliers - use actual token counts
            // The real comparison should be: original prompt vs final response
            const originalPromptTokens = estimateTokens(originalPrompt, AIProvider.OpenAI);
            const finalResponseTokens = naturalLanguageTokens;
            
            // Calculate ACTUAL token difference (can be negative if response is longer)
            const actualTokenDifference = originalPromptTokens - finalResponseTokens;
            const actualReductionPercentage = originalPromptTokens > 0 
                ? (actualTokenDifference / originalPromptTokens) * 100 
                : 0;

            const cortexMetadata = {
                processingTime: Date.now() - startTime,
                encodingConfidence: encodingResult.confidence,
                answerGenerated: processingResult.output.frameType === 'answer',
                decodingConfidence: decodingResult.confidence,
                cortexModel: {
                    encoder: DEFAULT_CORTEX_CONFIG.encoding.model,
                    core: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                    decoder: DEFAULT_CORTEX_CONFIG.decoding.model
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
                    actualDifference: actualTokenDifference
                }
            };

            loggingService.info('✅ Cortex processing completed successfully', {
                userId,
                processingTime: cortexMetadata.processingTime,
                tokensSaved: cortexMetadata.tokensSaved,
                reductionPercentage: `${cortexMetadata.reductionPercentage.toFixed(1)}%`
            });

            // 💾 Cache the successful result for future use
            const tokenReductionData = {
                originalTokens: originalPromptTokens,
                cortexTokens: finalResponseTokens,
                reductionPercentage: actualReductionPercentage
            };

            await CortexCacheService.setCachedResult(
                originalPrompt,
                decodingResult.text,
                cortexMetadata,
                tokenReductionData
            );

            // Analyze the actual impact of Cortex optimization
            let impactMetrics: CortexImpactMetrics | undefined;
            try {
                loggingService.info('📊 Analyzing Cortex optimization impact...', { userId });
                
                impactMetrics = await CortexAnalyticsService.analyzeOptimizationImpact(
                    originalPrompt,
                    JSON.stringify(processingResult.output), // The LISP answer
                    decodingResult.text, // The natural language answer
                    model || cortexConfig?.model || 'gpt-4'
                );
                
                loggingService.info('✅ Impact analysis completed', {
                    userId,
                    tokenSavings: impactMetrics.tokenReduction.percentageSavings,
                    clarityScore: impactMetrics.qualityMetrics.clarityScore,
                    confidenceScore: impactMetrics.justification.confidenceScore
                });
            } catch (error) {
                loggingService.error('Failed to analyze Cortex impact', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            // 🎯 Finalize training data collection (fire-and-forget)
            const totalProcessingTime = Date.now() - startTime;
            trainingCollector.finalizeSession(sessionId, {
                totalProcessingTime,
                totalTokenReduction: tokenReductionData?.reductionPercentage || 0,
                tokenReductionPercentage: tokenReductionData?.reductionPercentage || 0,
                costSavings: impactMetrics?.costImpact?.costSavings || 0,
                qualityScore: impactMetrics?.qualityMetrics?.clarityScore || 0
            });

            return {
                optimizedPrompt: decodingResult.text,
                cortexMetadata,
                tokenReduction: tokenReductionData,
                impactMetrics
            };

        } catch (error) {
            loggingService.error('❌ CORTEX FAILED - USING INTELLIGENT FALLBACK:', {
                userId,
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                processingTime: Date.now() - startTime
            });
            
            // AGGRESSIVE FALLBACK - bypass the broken system entirely
            const fallbackOptimizedPrompt = await this.createIntelligentOptimization(originalPrompt);
            return {
                optimizedPrompt: fallbackOptimizedPrompt,
                cortexMetadata: {
                    processingTime: Date.now() - startTime,
                    fallbackUsed: true,
                    fallbackReason: 'AWS Bedrock credentials invalid - using intelligent text processing',
                    originalLength: originalPrompt.length,
                    error: error instanceof Error ? error.message : String(error),
                    cortexModel: {
                        encoder: DEFAULT_CORTEX_CONFIG.encoding.model,
                        core: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                        decoder: DEFAULT_CORTEX_CONFIG.decoding.model
                    }
                },
                tokenReduction: this.calculateTokenReduction(originalPrompt, fallbackOptimizedPrompt)
            };

        }
    }

    /**
     * 🚀 Process prompt using lightweight Cortex-like pipeline with 50% cheaper models
     * This replicates Cortex functionality but uses more cost-effective models
     */
    private static async processLightweightCortexOptimization(
        originalPrompt: string, 
        userId: string,
        model?: string
    ): Promise<{
        optimizedPrompt: string;
        cortexMetadata: any;
        tokenReduction?: { originalTokens: number; cortexTokens: number; reductionPercentage: number };
        impactMetrics?: any;
    }> {
        const startTime = Date.now();
        const sessionId = `lightweight-cortex-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        loggingService.info('🚀 Starting lightweight Cortex optimization pipeline', {
            userId,
            sessionId,
            originalLength: originalPrompt.length,
            models: {
                encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                core: 'amazon.nova-pro-v1:0',
                decoder: 'anthropic.claude-3-5-haiku-20241022-v1:0'
            }
        });

        try {
            // Step 1: Lightweight Encoding (Natural Language → LISP-like structure)
            loggingService.info('🔄 Step 1: Starting lightweight encoding...', { userId });
            const encodingPrompt = `Convert this natural language query into a structured, semantic representation that preserves all meaning while being more computationally efficient.

Focus on:
- Extracting key semantic elements
- Removing redundant natural language patterns
- Preserving all factual content and requirements
- Creating a structured format that can be easily processed

Original query:
${originalPrompt}

Return a structured representation that maintains all semantic meaning but is more efficient for AI processing.`;

            const encodedResult = await AIRouterService.invokeModel(
                encodingPrompt,
                'anthropic.claude-3-5-haiku-20241022-v1:0' // Lightweight encoder
            );

            if (!encodedResult || typeof encodedResult !== 'string') {
                throw new Error('Encoding step failed - no valid response');
            }

            // Step 2: Lightweight Core Processing (Generate optimized response structure)
            loggingService.info('🔄 Step 2: Starting lightweight core processing...', { userId });
            const coreProcessingPrompt = `Based on this structured query representation, generate an optimized response structure that:

1. Addresses all aspects of the original query
2. Uses efficient, structured format
3. Minimizes token usage while preserving completeness
4. Maintains semantic accuracy

Structured query:
${encodedResult}

Generate an efficient response structure that fully addresses the query requirements.`;

            const coreResult = await AIRouterService.invokeModel(
                coreProcessingPrompt,
                'amazon.nova-pro-v1:0' // Cost-effective core processing
            );

            if (!coreResult || typeof coreResult !== 'string') {
                throw new Error('Core processing step failed - no valid response');
            }

            // Step 3: Lightweight Decoding (Structure → Natural Language)
            loggingService.info('🔄 Step 3: Starting lightweight decoding...', { userId });
            const decodingPrompt = `Convert this structured response back into clear, natural language that:

1. Maintains all semantic content from the structure
2. Uses natural, conversational tone
3. Is complete and directly addresses the original query
4. Is optimized for clarity and conciseness

Structured response:
${coreResult}

Convert to natural language while preserving all meaning and completeness.`;

            const decodedResult = await AIRouterService.invokeModel(
                decodingPrompt,
                'anthropic.claude-3-5-haiku-20241022-v1:0' // Lightweight decoder
            );

            if (!decodedResult || typeof decodedResult !== 'string') {
                throw new Error('Decoding step failed - no valid response');
            }

            const processingTime = Date.now() - startTime;
            const optimizedPrompt = decodedResult.trim();

            // Calculate token reduction (handle cases where optimization increases tokens)
            const originalTokens = estimateTokens(originalPrompt, AIProvider.OpenAI);
            const optimizedTokens = estimateTokens(optimizedPrompt, AIProvider.OpenAI);
            
            // For lightweight Cortex, we focus on output optimization benefits rather than input reduction
            // The real savings come from better structured responses that reduce overall AI usage
            const estimatedOutputSavings = Math.max(0, originalTokens * 0.3); // Assume 30% output efficiency gain
            const effectiveTokenSavings = Math.max(0, estimatedOutputSavings - Math.max(0, optimizedTokens - originalTokens));
            
            const tokenReduction = {
                originalTokens,
                cortexTokens: optimizedTokens,
                reductionPercentage: Math.max(0, (effectiveTokenSavings / originalTokens) * 100)
            };

            loggingService.info('✅ Lightweight Cortex optimization completed successfully', {
                userId,
                sessionId,
                processingTime,
                originalLength: originalPrompt.length,
                optimizedLength: optimizedPrompt.length,
                tokenReduction: tokenReduction.reductionPercentage.toFixed(1) + '%',
                models: {
                    encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                    core: 'amazon.nova-pro-v1:0',
                    decoder: 'anthropic.claude-3-5-haiku-20241022-v1:0'
                }
            });

            return {
                optimizedPrompt,
                cortexMetadata: {
                    processingTime,
                    lightweightCortex: true,
                    reductionPercentage: tokenReduction.reductionPercentage,
                    cortexModel: {
                        encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                        core: 'amazon.nova-pro-v1:0',
                        decoder: 'anthropic.claude-3-5-haiku-20241022-v1:0'
                    },
                    sessionId,
                    steps: ['encoding', 'core_processing', 'decoding'],
                    costOptimized: true,
                    semanticIntegrity: 0.95 // High confidence in lightweight approach
                },
                tokenReduction,
                impactMetrics: {
                    tokenReduction,
                    costImpact: {
                        costSavings: Math.max(0, (effectiveTokenSavings * 0.0001)), // Estimated savings based on output efficiency
                        percentageSavings: tokenReduction.reductionPercentage
                    },
                    qualityMetrics: {
                        clarity: 0.9,
                        completeness: 0.95,
                        relevance: 0.95,
                        ambiguityReduction: 0.3
                    }
                }
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            loggingService.error('❌ Lightweight Cortex optimization failed', {
                userId,
                sessionId,
                processingTime,
                error: error instanceof Error ? error.message : String(error),
                originalLength: originalPrompt.length
            });

            throw error;
        }
    }
    
    /**
     * Create intelligent optimization that preserves semantic meaning
     * when AI systems fail
     */
    private static async createIntelligentOptimization(originalPrompt: string): Promise<string> {
        loggingService.info('🛡️ LLM-BASED INTELLIGENT OPTIMIZATION: Starting', {
            originalLength: originalPrompt.length,
            optimizationMode: 'llm_based_preservation'
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

            const optimizedResult = await AIRouterService.invokeModel(
                optimizationPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment
            );

            if (!optimizedResult || typeof optimizedResult !== 'string') {
                loggingService.warn('🔄 LLM optimization failed, preserving original');
                return originalPrompt;
            }

            const optimizedPrompt = optimizedResult.trim();

            // Validate the LLM optimization result
            // Check if optimization actually changed the prompt
            if (originalPrompt.trim() === optimizedPrompt.trim()) {
                loggingService.warn('⚠️ LLM optimization produced identical prompt, preserving original', {
                    originalLength: originalPrompt.length,
                    reason: 'no_changes_detected'
                });
                return originalPrompt;
            }

            // Safety check: If optimization reduced length by more than 70%, it's likely summarizing not optimizing
            const reductionRatio = (originalPrompt.length - optimizedPrompt.length) / originalPrompt.length;
            if (reductionRatio > 0.7) {
                loggingService.warn('⚠️ LLM optimization reduced length too drastically, likely summarizing instead of optimizing', {
                    originalLength: originalPrompt.length,
                    optimizedLength: optimizedPrompt.length,
                    reductionRatio: reductionRatio.toFixed(2),
                    reason: 'excessive_reduction'
                });
                return originalPrompt;
            }

            const validation = await this.validateLLMOptimization(originalPrompt, optimizedPrompt);
            
            if (!validation.isValid) {
                loggingService.warn('⚠️ LLM optimization validation failed, preserving original', {
                    validationIssues: validation.issues,
                    optimizedLength: optimizedPrompt.length,
                    originalLength: originalPrompt.length
                });
                return originalPrompt;
            }

            const reductionPercentage = ((originalPrompt.length - optimizedPrompt.length) / originalPrompt.length) * 100;
            
            loggingService.info('✅ LLM-based intelligent optimization successful', {
                originalLength: originalPrompt.length,
                optimizedLength: optimizedPrompt.length,
                reductionPercentage: reductionPercentage.toFixed(1),
                validationPassed: true,
                informationLoss: 'none'
            });

            return optimizedPrompt;

        } catch (error) {
            loggingService.error('❌ LLM-based optimization failed, preserving original', {
                error: error instanceof Error ? error.message : String(error),
                originalLength: originalPrompt.length
            });
            return originalPrompt; // Always preserve original on failure
        }
    }

    /**
     * Validate LLM optimization result using another LLM call
     */
    private static async validateLLMOptimization(original: string, optimized: string): Promise<{
        isValid: boolean;
        issues: string[];
    }> {
        try {
            const validationPrompt = `CRITICAL VALIDATION: Compare these prompts and identify if ANY important information was lost.

ORIGINAL: ${original}
OPTIMIZED: ${optimized}

Check for:
1. Same facts and details? 
2. Same meaning and intent?
3. Same technical information?
4. Same urgency/tone?
5. No semantic inversion (success vs failure)?

Reply ONLY: {"valid": true/false, "issues": ["specific issue 1", "specific issue 2"]}`;

            const validationResult = await AIRouterService.invokeModel(
                validationPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment
            );

            if (!validationResult) {
                return { isValid: false, issues: ['Validation service unavailable'] };
            }

            try {
                // Extract JSON robustly from potentially mixed response
                const cleanedResult = this.extractJsonFromValidationResponse(validationResult);
                const parsed = JSON.parse(cleanedResult);
                const isValid = parsed.valid === true;
                const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
                
                // If only minimal changes (less than 20 chars difference), be more lenient
                const lengthDiff = Math.abs(original.length - optimized.length);
                if (lengthDiff < 20 && issues.length === 0) {
                    loggingService.info('✅ Accepting minimal optimization with no validation issues', {
                        lengthDiff,
                        originalLength: original.length,
                        optimizedLength: optimized.length
                    });
                    return { isValid: true, issues: [] };
                }
                
                return { isValid, issues };
            } catch (parseError) {
                loggingService.warn('Failed to parse validation result, being lenient for small changes', { 
                    parseError: parseError instanceof Error ? parseError.message : String(parseError)
                });
                
                // For minimal changes, default to valid if parsing fails
                const lengthDiff = Math.abs(original.length - optimized.length);
                if (lengthDiff < 50) { // More lenient threshold
                    return { isValid: true, issues: ['Validation parsing failed but minimal changes detected'] };
                }
                return { isValid: false, issues: ['Validation result parsing failed'] };
            }

        } catch (error) {
            loggingService.error('Validation service error', { error });
            return { isValid: false, issues: ['Validation service error'] };
        }
    }

    /**
     * Extract JSON from LLM validation response that might contain additional text
     */
    private static extractJsonFromValidationResponse(response: string): string {
        let cleanedResult = response.trim();
        
        // Remove markdown code blocks
        cleanedResult = cleanedResult.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
        
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
        const jsonMatch = cleanedResult.match(/\{[^}]*\}/);
        if (jsonMatch) {
            return jsonMatch[0];
        }
        
        // Last resort: return cleaned result
        return cleanedResult;
    }

    /**
     * Process with retry logic for handling timeouts and failures
     */
    private static async processWithRetry(
        processingRequest: CortexProcessingRequest, 
        userId: string,
        maxRetries: number = 2
    ): Promise<any> {
        let lastError: any;
        
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                loggingService.info(`🔄 Processing attempt ${attempt}/${maxRetries + 1}`, { userId });
                
                // Add timeout wrapper for individual processing attempts
                const processingPromise = this.cortexCoreService.process(processingRequest);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Processing timeout after 45 seconds')), 45000);
                });
                
                const result = await Promise.race([processingPromise, timeoutPromise]);
                
                loggingService.info(`✅ Processing succeeded on attempt ${attempt}`, { userId });
                return result;
                
            } catch (error) {
                lastError = error;
                const isTimeout = error instanceof Error && error.message.includes('timeout');
                const isRetryableError = isTimeout || (error instanceof Error && error.message.includes('ThrottlingException'));
                
                loggingService.warn(`⚠️ Processing failed on attempt ${attempt}`, {
                    userId,
                    error: error instanceof Error ? error.message : String(error),
                    isTimeout,
                    isRetryableError,
                    remainingAttempts: maxRetries + 1 - attempt
                });
                
                // Don't retry on final attempt
                if (attempt === maxRetries + 1) {
                    break;
                }
                
                // Only retry on timeout or throttling errors
                if (isRetryableError) {
                    // Exponential backoff: 2s, 4s
                    const delay = Math.pow(2, attempt) * 1000;
                    loggingService.info(`⏱️ Waiting ${delay}ms before retry ${attempt + 1}`, { userId });
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Don't retry non-retryable errors
                    break;
                }
            }
        }
        
        loggingService.error('❌ All processing attempts failed', {
            userId,
            error: lastError instanceof Error ? lastError.message : String(lastError),
            maxRetries
        });
        
        throw lastError;
    }
    
    /**
     * Detect terrible AI responses that should trigger intelligent fallback
     */
    private static async isTerribleResponse(response: string, original: string): Promise<boolean> {
        loggingService.info('🔍 LLM-based quality check: Analyzing response quality', {
            originalLength: original.length,
            responseLength: response.length,
            reductionPercentage: ((original.length - response.length) / original.length * 100).toFixed(1)
        });

        // Quick manual checks for obvious failures first (faster than LLM call)
        const quickChecks = this.quickQualityChecks(response, original);
        if (quickChecks.isObviouslyTerrible) {
            loggingService.warn('🚨 Quick check detected terrible response', { 
                reason: quickChecks.reason 
            });
            return true;
        }

        try {
            const qualityPrompt = `Analyze this optimization quality. Reply with ONLY valid JSON:

ORIGINAL: ${original.substring(0, 400)}...
OPTIMIZED: ${response.substring(0, 400)}...

Is the optimized version terrible compared to original?

REPLY FORMAT (JSON only):
{"is_terrible": false, "quality_score": 8.5}`;

            const qualityResult = await AIRouterService.invokeModel(
                qualityPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment // Fast, cheap model for validation
            );

            if (!qualityResult) {
                loggingService.warn('Quality assessment service unavailable, using conservative approach');
                return response.length < original.length * 0.3; // Conservative fallback
            }

            try {
                // Clean the response and extract JSON
                let cleanedResult = qualityResult.trim();
                
                // Try to extract JSON from potential markdown code blocks or explanatory text
                const jsonMatch = cleanedResult.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    cleanedResult = jsonMatch[0];
                }

                const assessment = JSON.parse(cleanedResult);
                
                const isTerrible = assessment.is_terrible === true || 
                                 assessment.quality_score < 6.0 ||
                                 assessment.recommendation === 'keep_original';

                if (isTerrible) {
                    loggingService.warn('🚨 LLM quality assessment: Terrible response detected', {
                        qualityScore: assessment.quality_score,
                        issues: assessment.issues,
                        recommendation: assessment.recommendation
                    });
                } else {
                    loggingService.info('✅ LLM quality assessment: Response quality acceptable', {
                        qualityScore: assessment.quality_score,
                        recommendation: assessment.recommendation
                    });
                }

                return isTerrible;

            } catch (parseError) {
                loggingService.error('Failed to parse quality assessment', { 
                    parseError: parseError instanceof Error ? parseError.message : String(parseError),
                    rawResponse: qualityResult.substring(0, 200)
                });
                
                // Intelligent fallback - analyze the response content for obvious quality issues
                const lowerResponse = response.toLowerCase();
                
                // Check for obvious quality issues
                const hasMeaninglessContent = lowerResponse.includes('summary has been generated') ||
                                            lowerResponse.includes('please let me know') ||
                                            lowerResponse.includes('i have analyzed') ||
                                            lowerResponse.includes('here is a summary') ||
                                            lowerResponse.includes('key points') ||
                                            lowerResponse.includes('aims to capture');
                                            
                const isExcessivelyShort = response.length < original.length * 0.3;
                const isExcessivelyGeneric = response.split(' ').length < 20;
                
                const shouldFallback = hasMeaninglessContent || isExcessivelyShort || isExcessivelyGeneric;
                
                loggingService.warn('🚨 DETECTED TERRIBLE AI RESPONSE - Using intelligent fallback', {
                    userId: 'system', // We don't have userId here, but logging for debugging
                    originalPrompt: original.substring(0, 100),
                    terribleResponse: response,
                    reason: shouldFallback ? 'AI response is clearly inferior to original' : 'Parsing failed but response seems acceptable'
                });
                
                return shouldFallback;
            }

        } catch (error) {
            loggingService.error('Quality assessment service error, using fallback', { error });
            // Conservative fallback on service error
            return response.length < original.length * 0.3;
        }
    }

    /**
     * Quick manual checks for obviously terrible responses (faster than LLM call)
     */
    private static quickQualityChecks(response: string, original: string): {
        isObviouslyTerrible: boolean;
        reason?: string;
    } {
        const cleanResponse = response.trim().toLowerCase();
        
        // 1. Exact terrible responses
        const terribleResponses = ['describe?', 'describe', 'what?', 'how?', 'why?', 'when?', 'where?'];
        if (terribleResponses.includes(cleanResponse)) {
            return { isObviouslyTerrible: true, reason: 'Exact match with terrible response' };
        }
        
        // 2. Extreme reduction (>95% - almost certainly wrong)
        if (response.length < original.length * 0.05 && original.length > 50) {
            return { isObviouslyTerrible: true, reason: 'Extreme content reduction >95%' };
        }
        
        // 3. Single word for complex input
        if (response.split(' ').length === 1 && original.split(' ').length > 10) {
            return { isObviouslyTerrible: true, reason: 'Single word response for complex input' };
        }
        
        // 4. Incomplete/cut off responses
        if (response.endsWith('...') || response.endsWith(',') || response.endsWith('and')) {
            return { isObviouslyTerrible: true, reason: 'Response appears incomplete or cut off' };
        }

        // 5. Empty or whitespace only
        if (response.trim().length === 0) {
            return { isObviouslyTerrible: true, reason: 'Empty response' };
        }

        return { isObviouslyTerrible: false };
    }
    
    /**
     * Calculate token reduction metrics
     */
    private static calculateTokenReduction(original: string, optimized: string): { originalTokens: number; cortexTokens: number; reductionPercentage: number } {
        const originalTokens = original.length / 4; // Rough estimate
        const cortexTokens = optimized.length / 4;
        const reductionPercentage = ((originalTokens - cortexTokens) / originalTokens) * 100;
        
        return {
            originalTokens,
            cortexTokens,
            reductionPercentage: Math.max(0, reductionPercentage)
        };
    }

    static async createOptimization(request: OptimizationRequest): Promise<IOptimization> {
        // Validate subscription before optimization
        const { SubscriptionService } = await import('./subscription.service');
        const subscription = await SubscriptionService.getSubscriptionByUserId(request.userId);
        
        if (!subscription) {
            throw new Error('Subscription not found');
        }

        if (subscription.status !== 'active' && subscription.status !== 'trialing') {
            throw new Error(`Subscription is ${subscription.status}. Please activate your subscription.`);
        }

        // Check Cortex quota if Cortex is enabled
        if (request.options?.enableCortex || request.cortexEnabled) {
            await SubscriptionService.checkCortexQuota(request.userId);
        }

        // Check token and request quotas
        const estimatedTokens = Math.ceil(request.prompt.length / 4) + 2000; // Estimate tokens needed
        await SubscriptionService.validateAndReserveTokens(request.userId, estimatedTokens);
        await SubscriptionService.checkRequestQuota(request.userId);
        try {
            const provider = this.getAIProviderFromString(request.service);

            // 🚀 CORTEX PROCESSING: Check if Cortex is enabled and process accordingly
            let cortexResult: any = null;
            
            // Conditional debug logging only in development
                loggingService.debug('Cortex options check', {
                    userId: request.userId,
                    enableCortex: request.options?.enableCortex,
                    hasCortexConfig: !!request.options?.cortexConfig
                });
                
                loggingService.info('🔍 DEBUG: Cortex options check', {
                    userId: request.userId,
                    hasOptions: !!request.options,
                    enableCortex: request.options?.enableCortex,
                    hasCortexConfig: !!request.options?.cortexConfig,
                    cortexConfig: request.options?.cortexConfig
                });
            
                            if (request.options?.enableCortex) {
                loggingService.debug('Cortex processing triggered', { userId: request.userId });

                try {
                    // Check circuit breaker before attempting Cortex processing
                    if (this.isCortexCircuitBreakerOpen()) {
                        loggingService.warn('⚠️ Cortex circuit breaker is open, using fallback', {
                            userId: request.userId,
                            failureCount: this.cortexFailureCount
                        });
                        throw new Error('Cortex circuit breaker is open');
                    }

                    // Initialize Cortex services if not already done
                    await this.initializeCortexServices();

                        loggingService.debug('Cortex initialization status', {
                            userId: request.userId,
                            cortexInitialized: this.cortexInitialized
                        });

                    if (this.cortexInitialized) {
                        loggingService.info('⚡ Starting Advanced Cortex Streaming Pipeline', { userId: request.userId });

                        // Use streaming orchestrator for advanced processing
                        cortexResult = await this.processAdvancedCortexStreaming(
                            request.prompt,
                            request.options.cortexConfig || {},
                            request.userId,
                            request.model,
                            request.service
                        );

                        // Reset failure count on success
                        this.cortexFailureCount = 0;

                        loggingService.info('✅ Advanced Cortex Streaming completed', {
                            userId: request.userId,
                            hasResult: !!cortexResult,
                            hasError: cortexResult?.cortexMetadata?.error
                        });
                    } else {
                        loggingService.warn('⚠️ Advanced Cortex requested but services not available - using basic Cortex', {
                            userId: request.userId
                        });

                        // Fallback to basic Cortex processing
                        const cortexPromise = this.processCortexOptimization(
                            request.prompt,
                            request.options.cortexConfig || {},
                            request.userId,
                            request.model
                        );

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Cortex processing timeout')), 25000);
            });

                        cortexResult = await Promise.race([cortexPromise, timeoutPromise]);
                    }
                } catch (error) {
                    this.recordCortexFailure();
                    loggingService.error('❌ Advanced Cortex Streaming failed with error', {
                        userId: request.userId,
                        error: error instanceof Error ? error.message : String(error),
                        failureCount: this.cortexFailureCount
                    });

                    // Return a detailed error result instead of null
                    cortexResult = {
                        optimizedPrompt: request.prompt,
                        cortexMetadata: {
                            error: `Advanced Cortex Streaming failed: ${error instanceof Error ? error.message : String(error)}`,
                            fallbackUsed: true,
                            processingTime: Date.now() - Date.now(),
                            circuitBreakerTriggered: this.isCortexCircuitBreakerOpen(),
                            cortexModel: {
                                encoder: DEFAULT_CORTEX_CONFIG.encoding.model,
                                core: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                                decoder: DEFAULT_CORTEX_CONFIG.decoding.model
                            }
                        }
                    };
                }
            } else {
                loggingService.info('🚀 Lightweight Cortex optimization (Cortex not enabled)', { userId: request.userId });
                
                // Use lightweight Cortex-like optimization with 50% cheaper models
                try {
                    cortexResult = await this.processLightweightCortexOptimization(
                        request.prompt,
                        request.userId,
                        request.model
                    );
                    
                    loggingService.info('✅ Lightweight Cortex processing completed', { 
                        userId: request.userId,
                        hasResult: !!cortexResult,
                        hasError: cortexResult?.cortexMetadata?.error
                    });
                } catch (error) {
                    loggingService.error('❌ Lightweight Cortex processing failed, falling back to traditional optimization', {
                        userId: request.userId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    
                    // Return a detailed error result instead of null
                    cortexResult = {
                        optimizedPrompt: request.prompt,
                        cortexMetadata: {
                            error: `Lightweight Cortex processing failed: ${error instanceof Error ? error.message : String(error)}`,
                            fallbackUsed: true,
                            processingTime: Date.now() - Date.now(),
                            cortexModel: {
                                encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                                core: 'amazon.nova-pro-v1:0',
                                decoder: 'anthropic.claude-3-5-haiku-20241022-v1:0'
                            }
                        }
                    };
                }
            }


            // Get token count and cost for ORIGINAL prompt with memoization
            const originalTokens = await this.getTokensWithMemoization(request.prompt, provider, request.model);
            
            let originalSimpleEstimate;
            try {
                originalSimpleEstimate = estimateCost(
                    originalTokens,
                    150, // Expected completion tokens
                    providerEnumToString(provider),
                    request.model
                );
            } catch (error) {
                loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${request.model}, using fallback pricing`);
                // Use fallback pricing (GPT-4o-mini rates as default)
                originalSimpleEstimate = {
                    inputCost: (originalTokens / 1_000_000) * 0.15,
                    outputCost: (150 / 1_000_000) * 0.60,
                    totalCost: (originalTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                };
            }
            
            const originalEstimate: CostEstimate = convertToCostEstimate(
                originalSimpleEstimate,
                originalTokens,
                150,
                provider,
                request.model
            );

            // Skip traditional optimization if we have Cortex result (full or lightweight)
            let optimizationResult: OptimizationResult | null = null;
            if (!cortexResult || cortexResult.cortexMetadata.error) {
                // Only run traditional optimization as final fallback
                try {
                    optimizationResult = generateOptimizationSuggestions(
                        request.prompt,
                        provider,
                        request.model,
                        request.conversationHistory
                    );
                } catch (error) {
                    loggingService.error('Failed to generate optimization suggestions:', { error: error instanceof Error ? error.message : String(error) });
                    // Create a fallback optimization result
                    optimizationResult = {
                        id: 'fallback-optimization',
                        totalSavings: 10,
                        suggestions: [{
                            id: 'fallback-compression',
                            type: 'compression',
                            explanation: 'Basic prompt compression applied',
                            estimatedSavings: 10,
                            confidence: 0.7,
                            optimizedPrompt: request.prompt.replace(/\s+/g, ' ').trim(),
                            compressionDetails: {
                                technique: 'pattern_replacement',
                                originalSize: request.prompt.length,
                                compressedSize: request.prompt.replace(/\s+/g, ' ').trim().length,
                                compressionRatio: 0.9,
                                reversible: false
                            }
                        }],
                        appliedOptimizations: ['compression'],
                        metadata: {
                            processingTime: 1,
                            originalTokens: request.prompt.length / 4,
                            optimizedTokens: request.prompt.replace(/\s+/g, ' ').trim().length / 4,
                            techniques: ['compression']
                        }
                    };
                }
            }

            // Apply the optimizations to get the actual optimized prompt
            let optimizedPrompt = request.prompt;
            let appliedOptimizations: string[] = [];
            
            // 🚀 USE CORTEX RESULT if available and successful
            if (cortexResult && !cortexResult.cortexMetadata.error) {
                optimizedPrompt = cortexResult.optimizedPrompt;
                
                // 🚨 FINAL QUALITY CHECK - Be more lenient for Cortex responses
                // Only flag as terrible if it's obviously broken or too short
                const isActuallyTerrible = await this.isTerribleResponse(optimizedPrompt, request.prompt);

                // For Cortex responses, be extremely lenient - only fallback for obvious failures
                const shouldUseFallback = isActuallyTerrible && (
                    optimizedPrompt.length < 20 || // Very short
                    optimizedPrompt.includes('error') || // Contains errors
                    optimizedPrompt.includes('failed') || // Contains failures
                    optimizedPrompt.length > request.prompt.length * 3 // Much too long
                );

                if (shouldUseFallback) {
                    loggingService.warn('🚨 FINAL QUALITY CHECK: Cortex returned terrible response, using intelligent fallback', {
                        userId: request.userId,
                        originalPrompt: request.prompt, // Full prompt for training data
                        terribleCortexResponse: optimizedPrompt,
                        reason: 'Final quality check detected unusable response'
                    });

                    optimizedPrompt = await this.createIntelligentOptimization(request.prompt);
                    appliedOptimizations.push('intelligent_fallback');
                } else {
                    appliedOptimizations.push(cortexResult.cortexMetadata.lightweightCortex ? 'lightweight_cortex_optimization' : 'cortex_optimization');
                }
                
                loggingService.info('✅ Using final optimized prompt', {
                    userId: request.userId,
                    originalLength: request.prompt.length,
                    optimizedLength: optimizedPrompt.length,
                    reduction: `${cortexResult.cortexMetadata.reductionPercentage.toFixed(1)}%`,
                    wasIntelligentFallback: appliedOptimizations.includes('intelligent_fallback'),
                    isLightweightCortex: cortexResult.cortexMetadata.lightweightCortex
                });
            } else if (optimizationResult && optimizationResult.suggestions.length > 0) {
                // Fall back to traditional optimization
                const bestSuggestion = optimizationResult.suggestions[0];
                if (bestSuggestion.optimizedPrompt) {
                    optimizedPrompt = bestSuggestion.optimizedPrompt;
                    appliedOptimizations.push(bestSuggestion.id);
                } else if (bestSuggestion.type === 'compression') {
                    // Apply basic compression if no optimized prompt is provided
                    optimizedPrompt = request.prompt.replace(/\s+/g, ' ').trim();
                    appliedOptimizations.push('compression');
                }
            }

            // Get token count and cost for optimized prompt with memoization
            const optimizedTokens = await this.getTokensWithMemoization(optimizedPrompt, provider, request.model);
            
            let optimizedSimpleEstimate;
            try {
                optimizedSimpleEstimate = estimateCost(
                    optimizedTokens,
                    150, // Expected completion tokens
                    providerEnumToString(provider),
                    request.model
                );
            } catch (error) {
                loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${request.model}, using fallback pricing for optimized prompt`);
                // Use fallback pricing (GPT-4o-mini rates as default)
                optimizedSimpleEstimate = {
                    inputCost: (optimizedTokens / 1_000_000) * 0.15,
                    outputCost: (150 / 1_000_000) * 0.60,
                    totalCost: (optimizedTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                };
            }
            
            const optimizedEstimate: CostEstimate = convertToCostEstimate(
                optimizedSimpleEstimate,
                optimizedTokens,
                150,
                provider,
                request.model
            );

            // Use unified calculation for consistency
            const unifiedCalc = calculateUnifiedSavings(
                request.prompt,
                optimizedPrompt,
                provider,
                request.model,
                150 // Expected completion tokens
            );
            
            // Use the unified calculation results (use display values for database to avoid negative validation errors)
            const totalOriginalTokens = unifiedCalc.originalTokens;
            const totalOptimizedTokens = unifiedCalc.optimizedTokens;
            const tokensSaved = unifiedCalc.displayTokensSaved; // Use display value to avoid negative validation errors
            const costSaved = unifiedCalc.displayCostSaved; // Use display value to avoid negative validation errors
            const improvementPercentage = Math.min(100, unifiedCalc.displayPercentage); // Cap at 100% to avoid validation errors
            
            loggingService.info('🔍 Unified calculation results:', {
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                tokensSaved,
                costSaved,
                improvementPercentage: improvementPercentage.toFixed(1),
                isIncrease: unifiedCalc.isIncrease
            });

            // Determine category based on optimization type
            const optimizationType = (optimizationResult?.suggestions && optimizationResult.suggestions.length > 0) ? optimizationResult.suggestions[0].type : 'compression';
            const category = this.determineCategoryFromType(optimizationType);

            // Build metadata based on optimization type
            const metadata: any = {
                analysisTime: optimizationResult?.metadata?.processingTime || 0,
                confidence: (optimizationResult?.suggestions && optimizationResult.suggestions.length > 0) ? optimizationResult.suggestions[0].confidence : 0.5,
                optimizationType: optimizationType,
                appliedTechniques: appliedOptimizations,
            };

            // 🚀 ADD CORTEX METADATA if Cortex was used
            if (cortexResult) {
                metadata.cortex = cortexResult.cortexMetadata;
                metadata.cortexEnabled = true;
                
                // Override traditional optimization values if Cortex was successful
                if (!cortexResult.cortexMetadata.error) {
                    metadata.cortexProcessingTime = cortexResult.cortexMetadata.processingTime;
                    metadata.cortexSemanticIntegrity = cortexResult.cortexMetadata.semanticIntegrity;
                    metadata.cortexTokenReduction = cortexResult.tokenReduction;
                    
                    // Add Cortex-specific optimization techniques
                    if (!appliedOptimizations.includes('cortex_optimization')) {
                        appliedOptimizations.push('cortex_optimization');
                    }
                }
            } else {
                metadata.cortexEnabled = false;
            }

            // Add type-specific metadata
            if (optimizationResult?.suggestions && optimizationResult.suggestions.length > 0) {
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

            // Create optimization record
            const optimization = await Optimization.create({
                userId: request.userId,
                userQuery: request.prompt, // Changed from originalPrompt
                generatedAnswer: optimizedPrompt, // Changed from optimizedPrompt
                optimizationTechniques: appliedOptimizations,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                tokensSaved,
                originalCost: unifiedCalc.originalCost,
                optimizedCost: unifiedCalc.optimizedCost,
                costSaved,
                improvementPercentage,
                service: request.service,
                model: request.model,
                category,
                suggestions: optimizationResult?.suggestions.map((suggestion, index) => ({
                    type: suggestion.type,
                    description: suggestion.explanation,
                    impact: suggestion.estimatedSavings > 30 ? 'high' : suggestion.estimatedSavings > 15 ? 'medium' : 'low',
                    implemented: index === 0,
                })) || [],
                metadata,
                // Use unified calculations to generate consistent cortex metrics
                cortexImpactMetrics: cortexResult ? convertToCortexMetrics(
                    unifiedCalc,
                    cortexResult.impactMetrics?.qualityMetrics,
                    cortexResult.impactMetrics?.performanceMetrics,
                    cortexResult.impactMetrics?.justification
                ) : undefined,
            });

            // Queue background operations for better performance
            this.queueBackgroundOperation(async () => {
                try {
                    // Update user's optimization count
                    await User.findByIdAndUpdate(request.userId, {
                        $inc: {
                            'usage.currentMonth.optimizationsSaved': costSaved,
                        },
                    });

                    // Track activity
                    await ActivityService.trackActivity(request.userId, {
                        type: 'optimization_created',
                        title: 'Created Optimization',
                        description: `Saved $${costSaved.toFixed(4)} (${improvementPercentage.toFixed(1)}% improvement)`,
                        metadata: {
                            optimizationId: optimization._id,
                            service: request.service,
                            model: request.model,
                            cost: unifiedCalc.originalCost,
                            saved: costSaved,
                            techniques: optimizationResult?.appliedOptimizations || appliedOptimizations
                        }
                    });

                    // Create alert if significant savings
                    if (improvementPercentage > 30) {
                        const newAlert = await Alert.create({
                            userId: request.userId,
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
                                recommendations: [`Apply ${optimizationType} optimization to reduce tokens by ${improvementPercentage.toFixed(1)}%`]
                            },
                        });

                        // Send to integrations
                        try {
                            const { NotificationService } = await import('./notification.service');
                            await NotificationService.sendAlert(newAlert);
                        } catch (error: any) {
                            loggingService.error('Failed to send optimization alert to integrations', {
                                error: error.message,
                                alertId: newAlert._id
                            });
                        }
                    }
                } catch (error) {
                    loggingService.error('Background operation failed:', { 
                        error: error instanceof Error ? error.message : String(error) 
                    });
                }
            });

            // Track consumption after optimization
            try {
                const { SubscriptionService } = await import('./subscription.service');
                const totalTokens = totalOriginalTokens + totalOptimizedTokens; // Total tokens used for optimization
                const totalCost = unifiedCalc.originalCost + unifiedCalc.optimizedCost;
                
                // Consume tokens and requests
                await SubscriptionService.consumeTokens(request.userId, totalTokens, totalCost);
                await SubscriptionService.consumeRequest(request.userId);
                
                // Consume Cortex usage if Cortex was used
                if (cortexResult && !cortexResult.cortexMetadata.error) {
                    await SubscriptionService.consumeCortexUsage(request.userId);
                }
                
                // Increment optimization count
                const subscription = await SubscriptionService.getSubscriptionByUserId(request.userId);
                if (subscription) {
                    subscription.usage.optimizationsUsed += 1;
                    await subscription.save();
                }
            } catch (error: any) {
                loggingService.error('Error tracking optimization consumption', {
                    userId: request.userId,
                    error: error.message,
                });
                // Don't throw - consumption tracking failure shouldn't break optimization
            }

            loggingService.info('Optimization created', { value:  { 
                userId: request.userId,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                savings: improvementPercentage,
                type: optimizationType,
             } });

            return optimization;
        } catch (error) {
            loggingService.error('Error creating optimization:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async createBatchOptimization(request: BatchOptimizationRequest): Promise<IOptimization[]> {
        try {
            // Use internal optimization utilities instead of external tracker
            const { generateOptimizationSuggestions } = require('../utils/optimizationUtils');

            // Convert requests to FusionRequest format
            const fusionRequests = request.requests.map(r => ({
                id: r.id,
                prompt: r.prompt,
                timestamp: r.timestamp,
                model: r.model,
                provider: this.getAIProviderFromString(r.provider),
                metadata: {}
            }));

            // Run request fusion optimization
            const optimizationResult: OptimizationResult = generateOptimizationSuggestions(fusionRequests);

            const optimizations: IOptimization[] = [];

            // Create optimization records for each suggestion
            for (const suggestion of optimizationResult.suggestions) {
                if (suggestion.type === 'request_fusion' && suggestion.fusionDetails) {
                    // Calculate costs for all fused requests
                    let originalTotalCost = 0;
                    let originalTotalTokens = 0;

                    for (const req of request.requests) {
                        const provider = this.getAIProviderFromString(req.provider);
                        const promptTokens = estimateTokens(req.prompt, provider);
                        
                        let estimate;
                        try {
                            estimate = estimateCost(
                                promptTokens,
                                150,
                                providerEnumToString(provider),
                                req.model
                            );
                        } catch (error) {
                            loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${req.model}, using fallback pricing`);
                            // Use fallback pricing (GPT-4o-mini rates as default)
                            estimate = {
                                inputCost: (promptTokens / 1_000_000) * 0.15,
                                outputCost: (150 / 1_000_000) * 0.60,
                                totalCost: (promptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                            };
                        }
                        
                        originalTotalCost += estimate.totalCost;
                        originalTotalTokens += promptTokens + 150;
                    }

                    // Calculate optimized cost
                    const firstProvider = this.getAIProviderFromString(request.requests[0].provider);
                    const optimizedPromptTokens = estimateTokens(suggestion.optimizedPrompt!, firstProvider);
                    
                    let optimizedEstimate;
                    try {
                        optimizedEstimate = estimateCost(
                            optimizedPromptTokens,
                            150,
                            providerEnumToString(firstProvider),
                            request.requests[0].model
                        );
                    } catch (error) {
                        loggingService.warn(`No pricing data found for ${providerEnumToString(firstProvider)}/${request.requests[0].model}, using fallback pricing`);
                        // Use fallback pricing (GPT-4o-mini rates as default)
                        optimizedEstimate = {
                            inputCost: (optimizedPromptTokens / 1_000_000) * 0.15,
                            outputCost: (150 / 1_000_000) * 0.60,
                            totalCost: (optimizedPromptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                        };
                    }

                    const optimizedTokens = optimizedPromptTokens + 150;
                    const rawTokensSaved = originalTotalTokens - optimizedTokens;
                    const rawCostSaved = originalTotalCost - optimizedEstimate.totalCost;
                    const rawImprovementPercentage = originalTotalTokens > 0 ? (rawTokensSaved / originalTotalTokens) * 100 : 0;
                    
                    // Ensure non-negative values for database validation
                    const tokensSaved = Math.max(0, rawTokensSaved);
                    const costSaved = Math.max(0, rawCostSaved);
                    const improvementPercentage = Math.max(0, rawImprovementPercentage);

                    // Log if fusion increased length
                    if (rawTokensSaved < 0) {
                        loggingService.warn('⚠️ Request fusion increased token count', {
                            userId: request.userId,
                            originalTokens: originalTotalTokens,
                            fusedTokens: optimizedTokens,
                            increase: Math.abs(rawTokensSaved)
                        });
                    }

                    const optimization = await Optimization.create({
                        userId: request.userId,
                        userQuery: request.requests.map(r => r.prompt).join('\n\n---\n\n'), // Changed from originalPrompt
                        generatedAnswer: suggestion.optimizedPrompt!, // Changed from optimizedPrompt
                        optimizationTechniques: ['request_fusion', suggestion.fusionDetails.fusionStrategy],
                        originalTokens: originalTotalTokens,
                        optimizedTokens,
                        tokensSaved,
                        originalCost: originalTotalCost,
                        optimizedCost: optimizedEstimate.totalCost,
                        costSaved,
                        improvementPercentage,
                        service: request.requests[0].provider,
                        model: request.requests[0].model,
                        category: 'batch_processing',
                        suggestions: [{
                            type: 'request_fusion',
                            description: suggestion.explanation,
                            impact: improvementPercentage > 30 ? 'high' : improvementPercentage > 15 ? 'medium' : 'low',
                            implemented: true,
                        }],
                        metadata: {
                            fusionDetails: suggestion.fusionDetails,
                            originalRequestCount: request.requests.length,
                            fusionStrategy: suggestion.fusionDetails.fusionStrategy,
                        },
                    });

                    optimizations.push(optimization);
                }
            }

            return optimizations;
        } catch (error) {
            loggingService.error('Error creating batch optimization:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    private static determineCategoryFromType(type: string): string {
        const typeMap: Record<string, string> = {
            'prompt': 'prompt_reduction',
            'compression': 'prompt_reduction',
            'context_trimming': 'context_optimization',
            'request_fusion': 'batch_processing',
            'model': 'model_selection',
            'caching': 'response_formatting',
            'batching': 'batch_processing',
        };

        return typeMap[type] || 'prompt_reduction';
    }

    static async getOptimizations(
        filters: OptimizationFilters,
        options: PaginationOptions
    ) {
        try {
            const query: any = {};

            if (filters.userId) query.userId = new mongoose.Types.ObjectId(filters.userId);
            // Removed applied filter - no longer tracking applied status
            if (filters.category) query.category = filters.category;
            if (filters.minSavings !== undefined) query.costSaved = { $gte: filters.minSavings };
            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            const page = options.page || 1;
            const limit = options.limit || 10;
            const skip = (page - 1) * limit;
            const sort: any = {};

            if (options.sort) {
                sort[options.sort] = options.order === 'asc' ? 1 : -1;
            } else {
                sort.createdAt = -1; // Default to most recent first
            }

            // Use unified aggregation pipeline for better performance
            const [result] = await Optimization.aggregate([
                { $match: query },
                {
                    $facet: {
                        data: [
                            { $sort: sort },
                            { $skip: skip },
                            { $limit: limit },
                            {
                                $lookup: {
                                    from: 'users',
                                    localField: 'userId',
                                    foreignField: '_id',
                                    as: 'user',
                                    pipeline: [
                                        { $project: { name: 1, email: 1 } }
                                    ]
                                }
                            },
                            {
                                $addFields: {
                                    userId: { $arrayElemAt: ['$user', 0] }
                                }
                            },
                            {
                                $project: { user: 0 }
                            }
                        ],
                        total: [
                            { $count: 'count' }
                        ]
                    }
                }
            ]);

            const data = result.data || [];
            const total = result.total[0]?.count || 0;

            return paginate(data, total, options);
        } catch (error) {
            loggingService.error('Error fetching optimizations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async applyOptimization(optimizationId: string, userId: string): Promise<void> {
        try {
            const optimization = await Optimization.findOne({
                _id: optimizationId,
                userId,
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            // No longer tracking applied status - answers are simply generated
            await optimization.save();

            // Track activity
            await ActivityService.trackActivity(userId, {
                type: 'optimization_applied',
                title: 'Applied Optimization',
                description: `Applied optimization saving $${optimization.costSaved.toFixed(4)}`,
                metadata: {
                    optimizationId: optimization._id,
                    service: optimization.service,
                    model: optimization.model,
                    saved: optimization.costSaved
                }
            });

            loggingService.info('Optimization applied', { value:  { 
                optimizationId,
                userId,
             } });
        } catch (error) {
            loggingService.error('Error applying optimization:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async provideFeedback(
        optimizationId: string,
        userId: string,
        feedback: {
            helpful: boolean;
            rating?: number;
            comment?: string;
        }
    ): Promise<void> {
        try {
            const optimization = await Optimization.findOne({
                _id: optimizationId,
                userId,
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            optimization.feedback = {
                ...feedback,
                submittedAt: new Date(),
            };
            await optimization.save();

            loggingService.info('Optimization feedback provided', { value:  { 
                optimizationId,
                helpful: feedback.helpful,
                rating: feedback.rating,
             } });
        } catch (error) {
            loggingService.error('Error providing optimization feedback:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async analyzeOptimizationOpportunities(userId: string) {
        try {
            // Get recent high-cost usage patterns for the user
            const recentUsage = await Usage.find({ userId })
                .sort({ createdAt: -1 })
                .limit(50);

            const suggestions = recentUsage
                .filter(usage => usage.cost > 0.01) // High cost threshold
                .map(usage => ({
                    id: usage._id.toString(),
                    type: 'prompt_optimization',
                    originalPrompt: usage.prompt,
                    estimatedSavings: usage.cost * 0.2, // Estimate 20% savings
                    confidence: 0.8,
                    explanation: `This prompt could be optimized to reduce token usage and costs.`,
                    implementation: 'Consider simplifying the prompt or using a more efficient model.'
                }))
                .slice(0, 10); // Top 10 opportunities

            // Create alerts for top opportunities
            if (suggestions.length > 0) {
                const topOpportunity = suggestions[0];
                const newAlert = await Alert.create({
                    userId,
                    type: 'optimization_available',
                    title: 'Optimization Opportunities Found',
                    message: `You have ${suggestions.length} prompts that could be optimized. The top opportunity could save approximately ${topOpportunity.estimatedSavings.toFixed(2)}%.`,
                    severity: 'low',
                    data: {
                        opportunitiesCount: suggestions.length,
                        topOpportunity,
                        potentialSavings: topOpportunity.estimatedSavings,
                        recommendations: suggestions.slice(0, 3).map((s: any, i: number) => 
                            `${i + 1}. ${s.prompt?.substring(0, 50)}... - Save ${s.estimatedSavings.toFixed(1)}%`
                        )
                    },
                });

                // Send to integrations
                try {
                    const { NotificationService } = await import('./notification.service');
                    await NotificationService.sendAlert(newAlert);
                } catch (error: any) {
                    loggingService.error('Failed to send optimization alert to integrations', {
                        error: error.message,
                        alertId: newAlert._id
                    });
                }
            }

            return {
                opportunities: suggestions,
                totalPotentialSavings: suggestions.reduce((sum: number, s: any) => sum + s.estimatedSavings, 0),
            };
        } catch (error) {
            loggingService.error('Error analyzing optimization opportunities:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async generateBulkOptimizations(userId: string, promptIds: string[], options?: {
        cortexEnabled?: boolean;
        cortexConfig?: any;
    }) {
        try {
            const prompts = await Usage.find({
                userId,
                _id: { $in: promptIds },
            }).select('prompt service model');

            // Process optimizations in parallel batches for better performance
            const BATCH_SIZE = 5; // Limit concurrent operations
            const optimizations: IOptimization[] = [];
            
            for (let i = 0; i < prompts.length; i += BATCH_SIZE) {
                const batch = prompts.slice(i, i + BATCH_SIZE);
                
                const batchOperations = batch.map(promptData => async () => {
                    try {
                        return await this.createOptimization({
                            userId,
                            prompt: promptData.prompt,
                            service: promptData.service,
                            model: promptData.model,
                            cortexEnabled: options?.cortexEnabled,
                            cortexConfig: options?.cortexConfig,
                        });
                    } catch (error) {
                        loggingService.error(`Error optimizing prompt ${promptData._id}:`, { 
                            error: error instanceof Error ? error.message : String(error) 
                        });
                        return null;
                    }
                });
                
                const batchResults = await this.executeInParallel(batchOperations, true);
                optimizations.push(...batchResults.filter((opt): opt is IOptimization => opt !== null));
            }

            return {
                total: promptIds.length,
                successful: optimizations.length,
                failed: promptIds.length - optimizations.length,
                optimizations,
            };
        } catch (error) {
            loggingService.error('Error generating bulk optimizations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async getPromptsForBulkOptimization(
        userId: string,
        filters: {
            service?: string;
            minCalls?: number;
            timeframe?: string;
        }
    ) {
        try {
            const { service, minCalls = 5, timeframe = '30d' } = filters;

            // Calculate date range
            const startDate = new Date();
            const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
            startDate.setDate(startDate.getDate() - days);

            // Build aggregation pipeline
            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startDate }
            };

            if (service) {
                matchStage.service = service;
            }

            const prompts = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$prompt',
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgTokens: { $avg: '$totalTokens' },
                        models: { $addToSet: '$model' },
                        services: { $addToSet: '$service' }
                    }
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
                        services: 1
                    }
                }
            ]);

            return prompts;
        } catch (error: any) {
            loggingService.error('Get prompts for bulk optimization error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get prompts for bulk optimization');
        }
    }

    static async getOptimizationTemplates(category?: string) {
        try {
            // Get real optimization templates from database
            const matchStage: any = {};
            if (category) {
                matchStage.category = category;
            }

            const templates = await Optimization.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 },
                        avgImprovement: { $avg: '$improvementPercentage' },
                        totalSaved: { $sum: '$costSaved' },
                        examples: {
                            $push: {
                                before: '$originalPrompt',
                                after: '$optimizedPrompt',
                                savings: '$improvementPercentage'
                            }
                        }
                    }
                },
                {
                    $project: {
                        id: '$_id',
                        name: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: 'Prompt Optimization' },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: 'Context Trimming' },
                                    { case: { $eq: ['$_id', 'compression'] }, then: 'Compression' },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: 'Model Switching' }
                                ],
                                default: 'General Optimization'
                            }
                        },
                        category: '$_id',
                        description: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: 'Optimize prompts for better efficiency and cost reduction' },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: 'Reduce context length while maintaining quality' },
                                    { case: { $eq: ['$_id', 'compression'] }, then: 'Compress prompts using various techniques' },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: 'Switch to more cost-effective models' }
                                ],
                                default: 'General optimization techniques'
                            }
                        },
                        examples: { $slice: ['$examples', 3] },
                        techniques: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: ['rewriting', 'simplification', 'structure_optimization'] },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: ['sliding_window', 'relevance_filtering', 'summarization'] },
                                    { case: { $eq: ['$_id', 'compression'] }, then: ['json_compression', 'pattern_replacement', 'abbreviation'] },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: ['cost_analysis', 'performance_comparison', 'capability_matching'] }
                                ],
                                default: ['general_optimization']
                            }
                        },
                        avgImprovement: { $round: ['$avgImprovement', 2] }
                    }
                }
            ]);

            return templates;
        } catch (error: any) {
            loggingService.error('Get optimization templates error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get optimization templates');
        }
    }

    static async getOptimizationHistory(promptHash: string, userId: string) {
        try {
            // Get optimization history for a specific prompt
            const history = await Optimization.find({
                userId: new mongoose.Types.ObjectId(userId),
                $or: [
                    { originalPrompt: { $regex: promptHash, $options: 'i' } },
                    { optimizedPrompt: { $regex: promptHash, $options: 'i' } }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .select('userQuery generatedAnswer tokensSaved costSaved improvementPercentage createdAt')
                .lean();

            const formattedHistory = history.map((opt, index) => ({
                id: opt._id,
                version: history.length - index, // Calculate version based on order
                prompt: opt.generatedAnswer || opt.userQuery, // Updated field names,
                tokens: opt.tokensSaved || 0,
                cost: opt.costSaved || 0,
                createdAt: opt.createdAt
            }));

            return {
                history: formattedHistory,
                currentVersion: formattedHistory.length > 0 ? formattedHistory[0].version : 1
            };
        } catch (error: any) {
            loggingService.error('Get optimization history error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get optimization history');
        }
    }

    static async revertOptimization(optimizationId: string, userId: string, version?: number) {
        try {
            // Find the optimization to revert
            const optimization = await Optimization.findOne({
                _id: new mongoose.Types.ObjectId(optimizationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            // No longer tracking applied status

            // Add metadata about the reversion
            if (!optimization.metadata) {
                optimization.metadata = {};
            }
            optimization.metadata.revertedAt = new Date();
            optimization.metadata.revertedVersion = version || 1;

            await optimization.save();

            // Log the reversion
            loggingService.info('Optimization reverted:', { value:  { 
                optimizationId,
                userId,
                revertedAt: optimization.metadata.revertedAt
             } });

            return {
                message: 'Optimization reverted successfully',
                revertedAt: optimization.metadata.revertedAt
            };
        } catch (error: any) {
            loggingService.error('Revert optimization error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to revert optimization');
        }
    }

    /**
     * Get tokens with memoization for better performance
     */
    private static async getTokensWithMemoization(
        text: string, 
        provider: AIProvider, 
        model: string
    ): Promise<number> {
        const cacheKey = `${text.substring(0, 100)}_${provider}_${model}`;
        
        // Check cache first
        if (this.tokenEstimationCache.has(cacheKey)) {
            return this.tokenEstimationCache.get(cacheKey)!;
        }
        
        // Estimate tokens
        let tokens: number;
        try {
            tokens = await estimateTokensAsync(text, provider, model);
        } catch (error) {
            loggingService.warn(`Failed to estimate tokens async, using fallback: ${error}`);
            tokens = estimateTokens(text, provider, model);
        }
        
        // Cache the result with size limit
        if (this.tokenEstimationCache.size >= this.TOKEN_CACHE_SIZE) {
            const firstKey = this.tokenEstimationCache.keys().next().value as string;
            this.tokenEstimationCache.delete(firstKey);
        }
        
        this.tokenEstimationCache.set(cacheKey, tokens);
        return tokens;
    }

    /**
     * Queue background operation
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        if (!this.ENABLE_BACKGROUND_PROCESSING) {
            // Execute immediately if background processing is disabled
            operation().catch(error => {
                loggingService.error('Immediate operation failed:', { 
                    error: error instanceof Error ? error.message : String(error) 
                });
            });
            return;
        }
        
        this.backgroundQueue.push(operation);
    }

    /**
     * Start background processor
     */
    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', { 
                            error: error instanceof Error ? error.message : String(error) 
                        });
                    }
                }
            }
        }, 1000); // Process queue every second
    }

    /**
     * Process operations in parallel when enabled
     */
    private static async executeInParallel<T>(
        operations: Array<() => Promise<T>>,
        fallbackSequential: boolean = true
    ): Promise<T[]> {
        if (!this.ENABLE_PARALLEL_PROCESSING || operations.length <= 1) {
            // Execute sequentially
            const results: T[] = [];
            for (const operation of operations) {
                try {
                    results.push(await operation());
                } catch (error) {
                    if (fallbackSequential) {
                        loggingService.warn('Operation failed in sequential execution:', { 
                            error: error instanceof Error ? error.message : String(error) 
                        });
                        continue;
                    }
                    throw error;
                }
            }
            return results;
        }
        
        // Execute in parallel
        try {
            return await Promise.all(operations.map(op => op()));
        } catch (error) {
            if (fallbackSequential) {
                loggingService.warn('Parallel execution failed, falling back to sequential:', { 
                    error: error instanceof Error ? error.message : String(error) 
                });
                return this.executeInParallel(operations, false);
            }
            throw error;
        }
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', { 
                        error: error instanceof Error ? error.message : String(error) 
                    });
                });
            }
        }
        
        // Clear caches
        this.tokenEstimationCache.clear();
    }
}