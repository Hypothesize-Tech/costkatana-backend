/**
 * Cortex Advanced Streaming Orchestrator
 *
 * This is the core of the advanced streaming capabilities that make CostKatana
 * production-ready for complex, long-running LLM workflows.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { redisService } from './redis.service';
import { loggingService } from './logging.service';

// Import Cortex components
import { CortexEncoderService } from './cortexEncoder.service';
import { CortexDecoderService } from './cortexDecoder.service';
import { CortexCoreService } from './cortexCore.service';
import { CortexVocabularyService } from './cortexVocabulary.service';

// Import types
import {
    CortexFrame,
    CortexEncodingRequest,
    CortexEncodingResult,
    CortexProcessingRequest,
    CortexProcessingResult,
    CortexDecodingRequest,
    CortexDecodingResult
} from '../types/cortex.types';

// ============================================================================
// STREAMING TYPES AND INTERFACES
// ============================================================================

/**
 * Represents a single token in the streaming pipeline
 */
export interface CortexToken {
    id: string;
    content: string;
    type: 'input' | 'encoding' | 'processing' | 'decoding' | 'output' | 'control' | 'error' | 'metadata';
    timestamp: Date;
    metadata?: {
        model?: string;
        tokenCount?: number;
        cost?: number;
        stage?: string;
        confidence?: number;
        [key: string]: any;
    };
    parentTokenId?: string; // For token relationships
    childTokenIds?: string[]; // For token relationships
}

/**
 * Streaming execution phases
 */
export enum CortexStreamingPhase {
    INITIALIZING = 'initializing',
    ENCODING = 'encoding',
    PROCESSING = 'processing',
    DECODING = 'decoding',
    COMPLETED = 'completed',
    ERROR = 'error',
    PAUSED = 'paused',
    RESUMED = 'resumed',
    RETRYING = 'retrying'
}

/**
 * Configuration for the streaming orchestrator
 */
export interface CortexStreamingConfig {
    parallelExecution: boolean;
    maxConcurrency: number;
    enableContinuity: boolean;
    enableCostTracking: boolean;
    enableDetailedLogging: boolean;
    chunkSize: number; // Tokens per chunk for long responses
    maxRetries: number;
    retryDelay: number; // Base delay in ms for exponential backoff
    timeout: number; // Overall timeout in ms
    budgetLimit?: number; // Cost limit in USD
    models: {
        encoder: string;
        processor: string;
        decoder: string;
    };
    streaming: {
        enableTokenStreaming: boolean;
        enableProgressUpdates: boolean;
        enablePauseResume: boolean;
        progressUpdateInterval: number; // ms between progress updates
    };
}

/**
 * Default streaming configuration
 */
export const DEFAULT_STREAMING_CONFIG: CortexStreamingConfig = {
    parallelExecution: true,
    maxConcurrency: 4,
    enableContinuity: true,
    enableCostTracking: true,
    enableDetailedLogging: true,
    chunkSize: 1000, // 1000 tokens per chunk
    maxRetries: 5,
    retryDelay: 1000, // 1 second base delay
    timeout: 300000, // 5 minutes overall timeout
    budgetLimit: 1.00, // $1.00 budget limit
    models: {
        encoder: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        processor: 'anthropic.claude-4-1-opus-20250219-v1:0',
        decoder: 'global.anthropic.claude-haiku-4-5-20251001-v1:0'
    },
    streaming: {
        enableTokenStreaming: true,
        enableProgressUpdates: true,
        enablePauseResume: true,
        progressUpdateInterval: 100 // 100ms between progress updates
    }
};

/**
 * Execution state for a streaming session
 */
export interface CortexStreamingExecution {
    id: string;
    sessionId: string;
    userId: string;
    inputText: string;
    config: CortexStreamingConfig;
    status: 'initializing' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    phase: CortexStreamingPhase;
    startTime: Date;
    endTime?: Date;
    duration?: number;

    // Component states
    encoderState?: {
        status: 'pending' | 'running' | 'completed' | 'failed';
        inputTokens: number;
        outputTokens: number;
        cost: number;
        result?: CortexEncodingResult;
        error?: string;
    };

    processorState?: {
        status: 'pending' | 'running' | 'completed' | 'failed';
        inputTokens: number;
        outputTokens: number;
        cost: number;
        result?: CortexProcessingResult;
        error?: string;
    };

    decoderState?: {
        status: 'pending' | 'running' | 'completed' | 'failed';
        inputTokens: number;
        outputTokens: number;
        cost: number;
        result?: CortexDecodingResult;
        error?: string;
    };

    // Streaming data
    tokens: CortexToken[];
    chunks: string[];
    currentChunk: string;
    chunkIndex: number;
    totalChunks: number;

    // Cost and performance tracking
    totalCost: number;
    totalTokens: number;
    budgetUsed: number;
    budgetRemaining: number;
    progress: number; // 0-100 percentage

    // Error handling
    retryCount: number;
    lastError?: string;
    errorHistory: string[];

    // Continuity and recovery
    checkpointData?: any;
    recoveryPoint?: string;
    contextPreserved: boolean;

    // Metadata
    metadata: {
        modelsUsed: string[];
        operationsPerformed: string[];
        optimizationLevel: string;
        cacheHits: number;
        totalOperations: number;
        [key: string]: any;
    };
}

/**
 * Progress update event data
 */
export interface CortexProgressUpdate {
    executionId: string;
    phase: CortexStreamingPhase;
    progress: number; // 0-100
    message: string;
    metadata?: {
        tokensProcessed?: number;
        costIncurred?: number;
        estimatedTimeRemaining?: number;
        currentOperation?: string;
        [key: string]: any;
    };
}

/**
 * Streaming event types
 */
export enum CortexStreamingEvent {
    // Lifecycle events
    EXECUTION_STARTED = 'execution_started',
    EXECUTION_COMPLETED = 'execution_completed',
    EXECUTION_FAILED = 'execution_failed',
    EXECUTION_PAUSED = 'execution_paused',
    EXECUTION_RESUMED = 'execution_resumed',
    EXECUTION_CANCELLED = 'execution_cancelled',

    // Component events
    ENCODER_STARTED = 'encoder_started',
    ENCODER_COMPLETED = 'encoder_completed',
    ENCODER_FAILED = 'encoder_failed',
    PROCESSOR_STARTED = 'processor_started',
    PROCESSOR_COMPLETED = 'processor_completed',
    PROCESSOR_FAILED = 'processor_failed',
    DECODER_STARTED = 'decoder_started',
    DECODER_COMPLETED = 'decoder_completed',
    DECODER_FAILED = 'decoder_failed',

    // Token events
    TOKEN_GENERATED = 'token_generated',
    CHUNK_COMPLETED = 'chunk_completed',
    OUTPUT_READY = 'output_ready',

    // Progress events
    PROGRESS_UPDATE = 'progress_update',

    // Error events
    RETRY_ATTEMPT = 'retry_attempt',
    RECOVERY_STARTED = 'recovery_started',
    RECOVERY_COMPLETED = 'recovery_completed',

    // Cost events
    COST_UPDATE = 'cost_update',
    BUDGET_WARNING = 'budget_warning',
    BUDGET_EXCEEDED = 'budget_exceeded'
}

// ============================================================================
// CORTEX STREAMING ORCHESTRATOR SERVICE
// ============================================================================

export class CortexStreamingOrchestratorService extends EventEmitter {
    private static instance: CortexStreamingOrchestratorService;

    // Active executions
    private activeExecutions = new Map<string, CortexStreamingExecution>();

    // Service instances
    private encoderService: CortexEncoderService;
    private decoderService: CortexDecoderService;
    private coreService: CortexCoreService;
    private vocabularyService: CortexVocabularyService;

    // Configuration
    private defaultConfig: CortexStreamingConfig = DEFAULT_STREAMING_CONFIG;

    // Performance tracking
    private totalExecutions = 0;
    private successfulExecutions = 0;
    private failedExecutions = 0;
    private averageExecutionTime = 0;
    private averageCost = 0;

    // Redis client for recovery
    private redisClient: any = null;

    private constructor() {
        super();
        this.setMaxListeners(1000); // Support many concurrent streaming sessions

        // Initialize services
        this.encoderService = CortexEncoderService.getInstance();
        this.decoderService = CortexDecoderService.getInstance();
        this.coreService = CortexCoreService.getInstance();
        this.vocabularyService = CortexVocabularyService.getInstance();

        // Start progress update interval
        this.startProgressUpdates();
    }

    public static getInstance(): CortexStreamingOrchestratorService {
        if (!CortexStreamingOrchestratorService.instance) {
            CortexStreamingOrchestratorService.instance = new CortexStreamingOrchestratorService();
        }
        return CortexStreamingOrchestratorService.instance;
    }

    // ========================================================================
    // INITIALIZATION AND CONFIGURATION
    // ========================================================================

    /**
     * Initialize the streaming orchestrator
     */
    public async initialize(config?: Partial<CortexStreamingConfig>): Promise<void> {
        try {
            loggingService.info('🚀 Initializing Cortex Streaming Orchestrator...');

            // Merge configuration
            this.defaultConfig = { ...DEFAULT_STREAMING_CONFIG, ...config };

            // Initialize core services
            // await this.encoderService.initialize(); // No initialize method needed
            await this.decoderService.initialize();
            await this.coreService.initialize();

            // Load active executions from Redis (recovery)
            await this.loadActiveExecutions();

            loggingService.info('✅ Cortex Streaming Orchestrator initialized successfully', {
                config: this.defaultConfig,
                activeExecutions: this.activeExecutions.size
            });

        } catch (error) {
            loggingService.error('❌ Failed to initialize Cortex Streaming Orchestrator', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Update streaming configuration
     */
    public updateConfig(config: Partial<CortexStreamingConfig>): void {
        this.defaultConfig = { ...this.defaultConfig, ...config };
        loggingService.info('⚙️ Streaming orchestrator configuration updated', { config });
    }

    // ========================================================================
    // MAIN STREAMING EXECUTION METHODS
    // ========================================================================

    /**
     * Execute a complete Cortex streaming workflow
     */
    public async executeStreamingWorkflow(
        sessionId: string,
        userId: string,
        inputText: string,
        config?: Partial<CortexStreamingConfig>
    ): Promise<CortexStreamingExecution> {
        const executionId = uuidv4();
        const startTime = new Date();

        // Merge configuration
        const executionConfig = { ...this.defaultConfig, ...config };

        // Create execution record
        const execution: CortexStreamingExecution = {
            id: executionId,
            sessionId,
            userId,
            inputText,
            config: executionConfig,
            status: 'initializing',
            phase: CortexStreamingPhase.INITIALIZING,
            startTime,
            tokens: [],
            chunks: [],
            currentChunk: '',
            chunkIndex: 0,
            totalChunks: 0,
            totalCost: 0,
            totalTokens: 0,
            budgetUsed: 0,
            budgetRemaining: executionConfig.budgetLimit || 0,
            progress: 0,
            retryCount: 0,
            errorHistory: [],
            contextPreserved: false,
            metadata: {
                modelsUsed: [],
                operationsPerformed: [],
                optimizationLevel: 'high',
                cacheHits: 0,
                totalOperations: 0
            }
        };

        // Store execution
        this.activeExecutions.set(executionId, execution);

        // Emit start event
        this.emit(CortexStreamingEvent.EXECUTION_STARTED, {
            executionId,
            sessionId,
            userId,
            inputLength: inputText.length
        });

        try {
            loggingService.info('🎯 Starting Cortex streaming execution', {
                executionId,
                sessionId,
                inputLength: inputText.length,
                config: executionConfig
            });

            // Execute the streaming workflow
            await this.runStreamingWorkflow(execution);

            // Update success metrics
            this.updateSuccessMetrics(execution);

            loggingService.info('✅ Cortex streaming execution completed successfully', {
                executionId,
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                duration: execution.duration,
                chunksGenerated: execution.chunks.length
            });

            return execution;

        } catch (error) {
            await this.handleExecutionError(execution, error);
            throw error;
        }
    }

    /**
     * Run the actual streaming workflow with parallel execution
     */
    private async runStreamingWorkflow(execution: CortexStreamingExecution): Promise<void> {
        const { id: executionId, inputText, config } = execution;

        try {
            // Step 1: Initialize execution state
            await this.initializeExecutionState(execution);

            // Step 2: Execute components in parallel if enabled
            if (config.parallelExecution) {
                await this.executeParallelComponents(execution, inputText);
            } else {
                await this.executeSequentialComponents(execution, inputText);
            }

            // Step 3: Process and validate results
            await this.processResults(execution);

            // Step 4: Generate final output
            await this.generateFinalOutput(execution);

        } catch (error) {
            loggingService.error('❌ Streaming workflow failed', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Execute all components in parallel for maximum performance
     */
    private async executeParallelComponents(
        execution: CortexStreamingExecution,
        inputText: string
    ): Promise<void> {
        const { id: executionId, config } = execution;

        loggingService.info('⚡ Executing Cortex components in parallel', {
            executionId,
            inputLength: inputText.length
        });

        // Execute components sequentially to avoid throttling with timeout protection
        try {
            await Promise.race([
                this.executeEncoderWithStreaming(execution, inputText),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Encoder timeout after 60s')), 60000)
                )
            ]);
        } catch (error) {
            loggingService.error('❌ Encoder failed', { executionId, error: error instanceof Error ? error.message : String(error) });
            throw error;
        }

        try {
            await Promise.race([
                this.executeProcessorWithStreaming(execution, inputText),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Processor timeout after 120s')), 120000)
                )
            ]);
        } catch (error) {
            loggingService.error('❌ Processor failed', { executionId, error: error instanceof Error ? error.message : String(error) });
            throw error;
        }

        try {
            await Promise.race([
                this.executeDecoderWithStreaming(execution, inputText),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Decoder timeout after 60s')), 60000)
                )
            ]);
        } catch (error) {
            loggingService.error('❌ Decoder failed', { executionId, error: error instanceof Error ? error.message : String(error) });
            throw error;
        }

    }

    /**
     * Execute components sequentially (fallback mode)
     */
    private async executeSequentialComponents(
        execution: CortexStreamingExecution,
        inputText: string
    ): Promise<void> {
        const { id: executionId } = execution;

        loggingService.info('🔄 Executing Cortex components sequentially', {
            executionId
        });

        try {
            // Execute encoder
            await this.executeEncoderWithStreaming(execution, inputText);

            // Execute processor
            await this.executeProcessorWithStreaming(execution, inputText);

            // Execute decoder
            await this.executeDecoderWithStreaming(execution, inputText);

        } catch (error) {
            loggingService.error('❌ Sequential execution failed', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Execute encoder with streaming capabilities
     */
    private async executeEncoderWithStreaming(
        execution: CortexStreamingExecution,
        inputText: string
    ): Promise<void> {
        const { id: executionId } = execution;

        try {
            loggingService.info('📝 Starting encoder execution with streaming', {
                executionId,
                inputLength: inputText.length
            });

            execution.encoderState = {
                status: 'running',
                inputTokens: 0,
                outputTokens: 0,
                cost: 0
            };

            // Update execution status
            execution.phase = CortexStreamingPhase.ENCODING;
            execution.status = 'running';

            this.emit(CortexStreamingEvent.ENCODER_STARTED, {
                executionId,
                inputLength: inputText.length
            });

            // Create encoding request with streaming configuration
            const encoderRequest: CortexEncodingRequest = {
                text: inputText,
                language: 'en', // Default to English
                config: {
                    encoding: {
                        model: execution.config.models.encoder,
                        strategy: 'balanced'
                    }
                },
                prompt: undefined // Use default encoder prompt
            };

            // Execute encoding with streaming
            const encoderResult = await this.encoderService.encode(encoderRequest);

            // Update execution state
            execution.encoderState.status = 'completed';
            execution.encoderState.result = encoderResult;
            execution.encoderState.inputTokens = typeof encoderResult.analysis?.complexity === 'number' ? encoderResult.analysis.complexity : 0;
            execution.encoderState.outputTokens = JSON.stringify(encoderResult.cortexFrame).length / 4;
            execution.encoderState.cost = this.calculateTokenCost(
                execution.config.models.encoder,
                execution.encoderState.inputTokens,
                execution.encoderState.outputTokens
            );

            // Update overall cost
            execution.totalCost += execution.encoderState.cost;
            execution.totalTokens += execution.encoderState.inputTokens + execution.encoderState.outputTokens;

            // Create token for encoder output
            const encoderToken: CortexToken = {
                id: uuidv4(),
                content: JSON.stringify(encoderResult.cortexFrame),
                type: 'encoding',
                timestamp: new Date(),
                metadata: {
                    model: execution.config.models.encoder,
                    tokenCount: execution.encoderState.outputTokens,
                    cost: execution.encoderState.cost,
                    stage: 'encoding'
                }
            };

            execution.tokens.push(encoderToken);

            loggingService.info('✅ Encoder execution completed', {
                executionId,
                outputTokens: execution.encoderState.outputTokens,
                cost: execution.encoderState.cost
            });

            this.emit(CortexStreamingEvent.ENCODER_COMPLETED, {
                executionId,
                result: encoderResult
            });

        } catch (error) {
            execution.encoderState!.status = 'failed';
            execution.encoderState!.error = error instanceof Error ? error.message : String(error);

            loggingService.error('❌ Encoder execution failed', {
                executionId,
                error: execution.encoderState!.error
            });

            this.emit(CortexStreamingEvent.ENCODER_FAILED, {
                executionId,
                error: execution.encoderState!.error
            });

            throw error;
        }
    }

    /**
     * Execute processor with streaming capabilities
     */
    private async executeProcessorWithStreaming(
        execution: CortexStreamingExecution,
        inputText: string
    ): Promise<void> {
        const { id: executionId } = execution;

        try {
            loggingService.info('🧠 Starting processor execution with streaming', {
                executionId
            });

            execution.processorState = {
                status: 'running',
                inputTokens: 0,
                outputTokens: 0,
                cost: 0
            };

            execution.phase = CortexStreamingPhase.PROCESSING;

            this.emit(CortexStreamingEvent.PROCESSOR_STARTED, {
                executionId
            });

            // Create processing request
            const processorRequest: CortexProcessingRequest = {
                operation: 'answer',
                input: {
                    frameType: 'query',
                    content: inputText,
                    type: 'natural_language_query'
                } as CortexFrame,
                options: {
                    generateAnswer: true
                },
                prompt: undefined
            };

            // Execute processing with streaming
            const processorResult = await this.coreService.process(processorRequest);

            // Update execution state
            execution.processorState.status = 'completed';
            execution.processorState.result = processorResult;
            execution.processorState.inputTokens = JSON.stringify(processorRequest.input).length / 4;
            execution.processorState.outputTokens = JSON.stringify(processorResult.output).length / 4;
            execution.processorState.cost = this.calculateTokenCost(
                execution.config.models.processor,
                execution.processorState.inputTokens,
                execution.processorState.outputTokens
            );

            // Update overall cost
            execution.totalCost += execution.processorState.cost;
            execution.totalTokens += execution.processorState.inputTokens + execution.processorState.outputTokens;

            // Create token for processor output
            const processorToken: CortexToken = {
                id: uuidv4(),
                content: JSON.stringify(processorResult.output),
                type: 'processing',
                timestamp: new Date(),
                metadata: {
                    model: execution.config.models.processor,
                    tokenCount: execution.processorState.outputTokens,
                    cost: execution.processorState.cost,
                    stage: 'processing'
                }
            };

            execution.tokens.push(processorToken);

            loggingService.info('✅ Processor execution completed', {
                executionId,
                outputTokens: execution.processorState.outputTokens,
                cost: execution.processorState.cost
            });

            this.emit(CortexStreamingEvent.PROCESSOR_COMPLETED, {
                executionId,
                result: processorResult
            });

        } catch (error) {
            execution.processorState!.status = 'failed';
            execution.processorState!.error = error instanceof Error ? error.message : String(error);

            loggingService.error('❌ Processor execution failed', {
                executionId,
                error: execution.processorState!.error
            });

            this.emit(CortexStreamingEvent.PROCESSOR_FAILED, {
                executionId,
                error: execution.processorState!.error
            });

            throw error;
        }
    }

    /**
     * Execute decoder with streaming capabilities
     */
    private async executeDecoderWithStreaming(
        execution: CortexStreamingExecution,
        inputText: string
    ): Promise<void> {
        const { id: executionId } = execution;

        try {
            loggingService.info('📖 Starting decoder execution with streaming', {
                executionId
            });

            execution.decoderState = {
                status: 'running',
                inputTokens: 0,
                outputTokens: 0,
                cost: 0
            };

            execution.phase = CortexStreamingPhase.DECODING;

            this.emit(CortexStreamingEvent.DECODER_STARTED, {
                executionId
            });

            // Wait for processor to complete before starting decoder
            if (!execution.processorState?.result?.output) {
                loggingService.warn('⚠️ Processor not ready, waiting for completion...', {
                    executionId
                });

                // Wait a bit for processor to complete
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds max wait

                while (!execution.processorState?.result?.output && attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }

                if (!execution.processorState?.result?.output) {
                    loggingService.error('❌ Processor failed to complete, using fallback', {
                        executionId
                    });
                    execution.decoderState.status = 'failed';
                    return;
                }
            }

            // Create decoding request with actual processor output
            const decoderRequest: CortexDecodingRequest = {
                cortexStructure: execution.processorState.result.output,
                targetLanguage: 'en',
                style: 'conversational',
                format: 'plain',
                config: {
                    decoding: {
                        model: execution.config.models.decoder,
                        style: 'conversational'
                    }
                },
                prompt: inputText
            };

            // Execute decoding with streaming
            const decoderResult = await this.decoderService.decode(decoderRequest);

            // Update execution state
            execution.decoderState.status = 'completed';
            execution.decoderState.result = decoderResult;
            execution.decoderState.inputTokens = JSON.stringify(decoderRequest.cortexStructure).length / 4;
            execution.decoderState.outputTokens = decoderResult.text.length / 4;
            execution.decoderState.cost = this.calculateTokenCost(
                execution.config.models.decoder,
                execution.decoderState.inputTokens,
                execution.decoderState.outputTokens
            );

            // Update overall cost
            execution.totalCost += execution.decoderState.cost;
            execution.totalTokens += execution.decoderState.inputTokens + execution.decoderState.outputTokens;

            // Create token for decoder output
            const decoderToken: CortexToken = {
                id: uuidv4(),
                content: decoderResult.text,
                type: 'decoding',
                timestamp: new Date(),
                metadata: {
                    model: execution.config.models.decoder,
                    tokenCount: execution.decoderState.outputTokens,
                    cost: execution.decoderState.cost,
                    stage: 'decoding'
                }
            };

            execution.tokens.push(decoderToken);

            loggingService.info('✅ Decoder execution completed', {
                executionId,
                outputTokens: execution.decoderState.outputTokens,
                cost: execution.decoderState.cost
            });

            this.emit(CortexStreamingEvent.DECODER_COMPLETED, {
                executionId,
                result: decoderResult
            });

        } catch (error) {
            execution.decoderState!.status = 'failed';
            execution.decoderState!.error = error instanceof Error ? error.message : String(error);

            loggingService.error('❌ Decoder execution failed', {
                executionId,
                error: execution.decoderState!.error
            });

            this.emit(CortexStreamingEvent.DECODER_FAILED, {
                executionId,
                error: execution.decoderState!.error
            });

            throw error;
        }
    }

    /**
     * Process and validate component results
     */
    private async processResults(execution: CortexStreamingExecution): Promise<void> {
        const { id: executionId } = execution;

        try {
            loggingService.info('🔍 Processing and validating component results', {
                executionId
            });

            // Validate all components completed successfully
            const allComponentsSuccessful =
                execution.encoderState?.status === 'completed' &&
                execution.processorState?.status === 'completed' &&
                execution.decoderState?.status === 'completed';

            if (!allComponentsSuccessful) {
                throw new Error('One or more components failed to complete successfully');
            }

            // Validate results integrity
            await this.validateResultsIntegrity(execution);

            // Check budget constraints
            if (execution.config.enableCostTracking && execution.totalCost > (execution.config.budgetLimit || 0)) {
                this.emit(CortexStreamingEvent.BUDGET_EXCEEDED, {
                    executionId,
                    totalCost: execution.totalCost,
                    budgetLimit: execution.config.budgetLimit
                });

                throw new Error(`Budget limit exceeded: $${execution.totalCost} > $${execution.config.budgetLimit}`);
            }

            // Update progress
            execution.progress = 75;

            this.emit(CortexStreamingEvent.PROGRESS_UPDATE, {
                executionId,
                phase: execution.phase,
                progress: execution.progress,
                message: 'Results processed and validated'
            });

        } catch (error) {
            loggingService.error('❌ Results processing failed', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate final output from component results
     */
    private async generateFinalOutput(execution: CortexStreamingExecution): Promise<void> {
        const { id: executionId } = execution;

        try {
            loggingService.info('🎉 Generating final output', {
                executionId
            });

            // Combine results from all components
            const finalOutput = this.combineComponentResults(execution);

            // Add final output to chunks
            execution.chunks.push(finalOutput);
            execution.currentChunk = finalOutput;

            // Create final output token
            const outputToken: CortexToken = {
                id: uuidv4(),
                content: finalOutput,
                type: 'output',
                timestamp: new Date(),
                metadata: {
                    stage: 'final_output',
                    totalComponents: 3,
                    totalCost: execution.totalCost,
                    totalTokens: execution.totalTokens
                }
            };

            execution.tokens.push(outputToken);

            // Update execution status
            execution.status = 'completed';
            execution.phase = CortexStreamingPhase.COMPLETED;
            execution.endTime = new Date();
            execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
            execution.progress = 100;

            // Emit completion event
            this.emit(CortexStreamingEvent.EXECUTION_COMPLETED, {
                executionId,
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                duration: execution.duration,
                outputLength: finalOutput.length
            });

            this.emit(CortexStreamingEvent.OUTPUT_READY, {
                executionId,
                output: finalOutput
            });

            loggingService.info('✅ Final output generated successfully', {
                executionId,
                outputLength: finalOutput.length,
                duration: execution.duration
            });

        } catch (error) {
            loggingService.error('❌ Final output generation failed', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    /**
     * Initialize execution state
     */
    private async initializeExecutionState(execution: CortexStreamingExecution): Promise<void> {
        const { id: executionId } = execution;

        try {
            // Calculate total chunks based on input size
            execution.totalChunks = Math.ceil(execution.inputText.length / execution.config.chunkSize);

            // Initialize cost tracking
            if (execution.config.enableCostTracking) {
                // Cost tracker is initialized automatically when accessed
            }

            // Create checkpoint for recovery
            execution.checkpointData = {
                inputText: execution.inputText,
                config: execution.config,
                timestamp: new Date()
            };

            execution.contextPreserved = true;

            loggingService.info('🔧 Execution state initialized', {
                executionId,
                totalChunks: execution.totalChunks,
                estimatedCost: this.estimateExecutionCost(execution)
            });

        } catch (error) {
            loggingService.error('❌ Failed to initialize execution state', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Handle component failure with retry logic
     */
    private async handleComponentFailure(
        execution: CortexStreamingExecution,
        componentName: string,
        error: any
    ): Promise<void> {
        const { id: executionId, config } = execution;

        // Check if we should retry
        const shouldRetry = execution.retryCount < config.maxRetries;

        if (shouldRetry) {
            execution.retryCount++;

            // Calculate retry delay with exponential backoff
            const retryDelay = config.retryDelay * Math.pow(2, execution.retryCount - 1);

            loggingService.warn(`🔄 Retrying ${componentName} after failure`, {
                executionId,
                retryCount: execution.retryCount,
                retryDelay,
                error: error instanceof Error ? error.message : String(error)
            });

            this.emit(CortexStreamingEvent.RETRY_ATTEMPT, {
                executionId,
                componentName,
                retryCount: execution.retryCount,
                retryDelay
            });

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, retryDelay));

            // Retry the failed component
            // This would recursively call the appropriate execution method
            // For now, we'll just log the retry attempt

        } else {
            // Max retries exceeded
            execution.status = 'failed';
            execution.phase = CortexStreamingPhase.ERROR;
            execution.lastError = `Component ${componentName} failed after ${config.maxRetries} retries: ${error instanceof Error ? error.message : String(error)}`;
            execution.errorHistory.push(execution.lastError);

            loggingService.error('💥 Max retries exceeded for component failure', {
                executionId,
                componentName,
                maxRetries: config.maxRetries,
                error: execution.lastError
            });

            this.emit(CortexStreamingEvent.EXECUTION_FAILED, {
                executionId,
                error: execution.lastError,
                retryCount: execution.retryCount
            });

            throw new Error(execution.lastError);
        }
    }

    /**
     * Handle execution error
     */
    private async handleExecutionError(execution: CortexStreamingExecution, error: any): Promise<void> {
        const { id: executionId } = execution;

        execution.status = 'failed';
        execution.phase = CortexStreamingPhase.ERROR;
        execution.endTime = new Date();
        execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
        execution.lastError = error instanceof Error ? error.message : String(error);
        execution.errorHistory.push(execution.lastError);

        // Store error in Redis for analysis
        try {
            await redisService.storeCache(
                `cortex:error:${executionId}`,
                {
                    executionId,
                    error: execution.lastError,
                    timestamp: new Date(),
                    context: execution
                },
                { ttl: 86400 * 7 } // 7 days
            );
        } catch (redisError) {
            loggingService.warn('Failed to store error in Redis', {
                executionId,
                redisError: redisError instanceof Error ? redisError.message : String(redisError)
            });
        }

        loggingService.error('💥 Execution failed', {
            executionId,
            error: execution.lastError,
            duration: execution.duration,
            totalCost: execution.totalCost
        });

        this.emit(CortexStreamingEvent.EXECUTION_FAILED, {
            executionId,
            error: execution.lastError,
            duration: execution.duration,
            totalCost: execution.totalCost
        });
    }

    /**
     * Validate results integrity
     */
    private async validateResultsIntegrity(execution: CortexStreamingExecution): Promise<void> {
        // Basic validation - can be enhanced with more sophisticated checks
        const { encoderState, processorState, decoderState } = execution;

        if (!encoderState?.result) {
            throw new Error('Encoder result is missing');
        }

        if (!processorState?.result) {
            throw new Error('Processor result is missing');
        }

        if (!decoderState?.result) {
            throw new Error('Decoder result is missing');
        }

        // Validate semantic consistency between components
        // This is a basic check - can be enhanced with semantic similarity models
        const encoderOutput = JSON.stringify(encoderState.result.cortexFrame);
        const processorOutput = JSON.stringify(processorState.result.output);
        const decoderOutput = decoderState.result.text;

        if (encoderOutput.length < 10) {
            throw new Error('Encoder output is too short');
        }

        if (processorOutput.length < 10) {
            throw new Error('Processor output is too short');
        }

        if (decoderOutput.length < 10) {
            throw new Error('Decoder output is too short');
        }

        loggingService.info('✅ Results integrity validation passed', {
            executionId: execution.id,
            encoderSize: encoderOutput.length,
            processorSize: processorOutput.length,
            decoderSize: decoderOutput.length
        });
    }

    /**
     * Combine component results into final output
     */
    private combineComponentResults(execution: CortexStreamingExecution): string {
        const { encoderState, processorState, decoderState } = execution;

        if (!encoderState?.result || !processorState?.result || !decoderState?.result) {
            throw new Error('Cannot combine results - missing component outputs');
        }

        // Create a comprehensive result object
        const combinedResult = {
            originalInput: execution.inputText,
            encodedFrame: encoderState.result.cortexFrame,
            processedAnswer: processorState.result.output,
            decodedOutput: decoderState.result.text,
            metadata: {
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                processingTime: execution.duration,
                modelsUsed: execution.metadata.modelsUsed,
                confidence: decoderState.result.confidence,
                fidelityScore: decoderState.result.fidelityScore
            }
        };

        return JSON.stringify(combinedResult, null, 2);
    }

    /**
     * Calculate token cost based on model
     */
    private calculateTokenCost(model: string, inputTokens: number, outputTokens: number): number {
        // This is a simplified cost calculation - in production you'd use actual pricing
        const modelCosts: { [key: string]: { input: number, output: number } } = {
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 0.0000008, output: 0.000004 },
            'anthropic.claude-3-7-sonnet-20250219-v1:0': { input: 0.000003, output: 0.000015 },
            'anthropic.claude-4-1-opus-20250219-v1:0': { input: 0.000003, output: 0.000015 },
            'amazon.nova-pro-v1:0': { input: 0.0000008, output: 0.0000032 }
        };

        const costs = modelCosts[model] || { input: 0.000001, output: 0.000005 };

        return (inputTokens * costs.input) + (outputTokens * costs.output);
    }

    /**
     * Estimate execution cost
     */
    private estimateExecutionCost(execution: CortexStreamingExecution): number {
        const inputTokens = execution.inputText.length / 4;
        const estimatedOutputTokens = inputTokens * 2; // Rough estimate

        const encoderCost = this.calculateTokenCost(
            execution.config.models.encoder,
            inputTokens * 0.3, // Encoder uses ~30% of input
            inputTokens * 0.2   // Encoder outputs ~20% of input
        );

        const processorCost = this.calculateTokenCost(
            execution.config.models.processor,
            inputTokens,
            estimatedOutputTokens
        );

        const decoderCost = this.calculateTokenCost(
            execution.config.models.decoder,
            estimatedOutputTokens * 0.5,
            estimatedOutputTokens
        );

        return encoderCost + processorCost + decoderCost;
    }

    /**
     * Start progress update interval
     */
    private startProgressUpdates(): void {
        setInterval(() => {
            this.activeExecutions.forEach(execution => {
                if (execution.status === 'running' && execution.config.streaming.enableProgressUpdates) {
                    // Update progress based on component states
                    let progress = 0;

                    if (execution.encoderState?.status === 'completed') progress += 25;
                    else if (execution.encoderState?.status === 'running') progress += 10;

                    if (execution.processorState?.status === 'completed') progress += 25;
                    else if (execution.processorState?.status === 'running') progress += 10;

                    if (execution.decoderState?.status === 'completed') progress += 25;
                    else if (execution.decoderState?.status === 'running') progress += 10;

                    // Add remaining progress for final processing
                    if (progress > 0 && progress < 75) progress += 15;

                    execution.progress = Math.min(progress, 95); // Cap at 95% until completion

                    this.emit(CortexStreamingEvent.PROGRESS_UPDATE, {
                        executionId: execution.id,
                        phase: execution.phase,
                        progress: execution.progress,
                        message: `Processing: ${execution.phase}`,
                        metadata: {
                            tokensProcessed: execution.totalTokens,
                            costIncurred: execution.totalCost,
                            currentOperation: execution.phase
                        }
                    });
                }
            });
        }, this.defaultConfig.streaming.progressUpdateInterval);
    }

    /**
     * Load active executions from Redis (recovery mechanism)
     */
    private async loadActiveExecutions(): Promise<void> {
        try {
            // This would load active executions from Redis for recovery
            // Implementation would depend on your Redis schema
            loggingService.info('🔄 Loading active executions from Redis for recovery...');
            
            // Use existing redisService for recovery
            if (redisService.isConnected) {
                // Load active executions from Redis using redisService
                const activeExecutionKeys = await redisService.client.keys('cortex:execution:*');
                const recoveredExecutions: any[] = [];
                
                for (const key of activeExecutionKeys) {
                    try {
                        const executionData = await redisService.client.get(key);
                        if (executionData) {
                            const execution = JSON.parse(executionData);
                            const timeSinceStart = Date.now() - execution.startTime;
                            
                            // Only recover executions that are less than 1 hour old
                            if (timeSinceStart < 3600000) {
                                recoveredExecutions.push(execution);
                                loggingService.info(`🔄 Recovered execution: ${execution.id}`, {
                                    executionId: execution.id,
                                    userId: execution.userId,
                                    timeSinceStart: Math.round(timeSinceStart / 1000) + 's'
                                });
                            } else {
                                // Clean up old executions
                                await redisService.client.del(key);
                                loggingService.info(`🧹 Cleaned up old execution: ${execution.id}`);
                            }
                        }
                    } catch (parseError) {
                        loggingService.warn(`Failed to parse execution data for key ${key}`, {
                            error: parseError instanceof Error ? parseError.message : String(parseError)
                        });
                        // Clean up corrupted data
                        await redisService.client.del(key);
                    }
                }
                
                loggingService.info(`✅ Redis recovery completed: ${recoveredExecutions.length} executions recovered`);
            } else {
                loggingService.warn('Redis not connected, skipping execution recovery');
            }
            
        } catch (error) {
            loggingService.warn('Failed to load active executions from Redis', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Update success metrics
     */
    private updateSuccessMetrics(execution: CortexStreamingExecution): void {
        this.totalExecutions++;
        this.successfulExecutions++;
        this.averageExecutionTime = (this.averageExecutionTime + (execution.duration || 0)) / 2;
        this.averageCost = (this.averageCost + execution.totalCost) / 2;
    }

    // ========================================================================
    // PUBLIC API METHODS
    // ========================================================================

    /**
     * Get execution by ID
     */
    public getExecution(executionId: string): CortexStreamingExecution | null {
        return this.activeExecutions.get(executionId) || null;
    }

    /**
     * Get all active executions
     */
    public getActiveExecutions(): CortexStreamingExecution[] {
        return Array.from(this.activeExecutions.values());
    }

    /**
     * Get execution statistics
     */
    public getExecutionStats(): {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        averageExecutionTime: number;
        averageCost: number;
        activeExecutions: number;
    } {
        return {
            totalExecutions: this.totalExecutions,
            successfulExecutions: this.successfulExecutions,
            failedExecutions: this.failedExecutions,
            averageExecutionTime: this.averageExecutionTime,
            averageCost: this.averageCost,
            activeExecutions: this.activeExecutions.size
        };
    }

    /**
     * Cancel execution
     */
    public async cancelExecution(executionId: string): Promise<void> {
        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        execution.status = 'cancelled';
        execution.phase = CortexStreamingPhase.ERROR;
        execution.endTime = new Date();
        execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

        loggingService.info('🛑 Execution cancelled', {
            executionId,
            duration: execution.duration
        });

        this.emit(CortexStreamingEvent.EXECUTION_CANCELLED, {
            executionId,
            duration: execution.duration
        });

        this.activeExecutions.delete(executionId);
    }

    /**
     * Pause execution
     */
    public async pauseExecution(executionId: string): Promise<void> {
        const execution = this.activeExecutions.get(executionId);
        if (!execution || execution.status !== 'running') return;

        execution.status = 'paused';
        execution.phase = CortexStreamingPhase.PAUSED;

        loggingService.info('⏸️ Execution paused', {
            executionId,
            progress: execution.progress
        });

        this.emit(CortexStreamingEvent.EXECUTION_PAUSED, {
            executionId,
            progress: execution.progress
        });
    }

    /**
     * Resume execution
     */
    public async resumeExecution(executionId: string): Promise<void> {
        const execution = this.activeExecutions.get(executionId);
        if (!execution || execution.status !== 'paused') return;

        execution.status = 'running';
        execution.phase = CortexStreamingPhase.RESUMED;

        loggingService.info('▶️ Execution resumed', {
            executionId,
            progress: execution.progress
        });

        this.emit(CortexStreamingEvent.EXECUTION_RESUMED, {
            executionId,
            progress: execution.progress
        });
    }

    /**
     * Clean up old executions
     */
    public cleanupOldExecutions(maxAge: number = 3600000): void { // 1 hour default
        const cutoffTime = Date.now() - maxAge;

        for (const [executionId, execution] of this.activeExecutions.entries()) {
            if (execution.startTime.getTime() < cutoffTime &&
                (execution.status === 'completed' || execution.status === 'failed')) {
                this.activeExecutions.delete(executionId);
                loggingService.info('🧹 Cleaned up old execution', { executionId });
            }
        }
    }
}

