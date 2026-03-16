/**
 * Cortex Streaming Orchestrator Service (NestJS) - Chat Module Version
 *
 * Adapted for chat service streaming capabilities.
 * Provides advanced streaming orchestration for complex chat workflows.
 * Ported from Express CortexStreamingOrchestratorService with NestJS patterns.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { BedrockService } from '../../../services/bedrock.service';
import { CostEstimator } from '../utils/cost-estimator';

/**
 * Represents a single token in the streaming pipeline
 */
export interface CortexToken {
  id: string;
  content: string;
  type:
    | 'input'
    | 'encoding'
    | 'processing'
    | 'decoding'
    | 'output'
    | 'control'
    | 'error'
    | 'metadata';
  timestamp: Date;
  metadata?: {
    model?: string;
    tokenCount?: number;
    cost?: number;
    stage?: string;
    confidence?: number;
    [key: string]: any;
  };
  parentTokenId?: string;
  childTokenIds?: string[];
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
  RETRYING = 'retrying',
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
  chunkSize: number;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  budgetLimit?: number;
  models: {
    encoder: string;
    processor: string;
    decoder: string;
  };
  streaming: {
    enableTokenStreaming: boolean;
    enableProgressUpdates: boolean;
    enablePauseResume: boolean;
    progressUpdateInterval: number;
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
  chunkSize: 1000,
  maxRetries: 5,
  retryDelay: 1000,
  timeout: 300000,
  budgetLimit: 1.0,
  models: {
    encoder: 'claude-3-haiku',
    processor: 'claude-3-sonnet',
    decoder: 'claude-3-haiku',
  },
  streaming: {
    enableTokenStreaming: true,
    enableProgressUpdates: true,
    enablePauseResume: true,
    progressUpdateInterval: 100,
  },
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
  status:
    | 'initializing'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
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
    result?: any;
    error?: string;
  };

  processorState?: {
    status: 'pending' | 'running' | 'completed' | 'failed';
    inputTokens: number;
    outputTokens: number;
    cost: number;
    result?: any;
    error?: string;
  };

  decoderState?: {
    status: 'pending' | 'running' | 'completed' | 'failed';
    inputTokens: number;
    outputTokens: number;
    cost: number;
    result?: any;
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
  progress: number;

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

  // Callback for streaming
  onChunk?: (chunk: string, done: boolean) => void;
}

/**
 * Cortex Streaming Orchestrator for Chat Service
 * Provides advanced streaming capabilities for complex chat workflows
 */
@Injectable()
export class CortexStreamingOrchestratorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CortexStreamingOrchestratorService.name);

  // Active executions
  private activeExecutions = new Map<string, CortexStreamingExecution>();

  // Performance tracking
  private totalExecutions = 0;
  private successfulExecutions = 0;
  private failedExecutions = 0;
  private averageExecutionTime = 0;
  private averageCost = 0;

  // Configuration
  private defaultConfig: CortexStreamingConfig = DEFAULT_STREAMING_CONFIG;

  // Interval ID for progress updates
  private progressUpdateInterval?: NodeJS.Timeout;

  constructor(
    private readonly bedrockService: BedrockService,
    private readonly eventEmitter: EventEmitter2,
    private readonly costEstimator: CostEstimator,
  ) {}

  async onModuleInit() {
    this.logger.log(
      '🚀 Initializing Cortex Streaming Orchestrator for chat service...',
    );
    // Start progress update interval
    this.startProgressUpdates();
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Shutting down Cortex Streaming Orchestrator...');
    // Clear progress update interval
    if (this.progressUpdateInterval) {
      clearInterval(this.progressUpdateInterval);
      this.progressUpdateInterval = undefined;
    }
  }

  // ========================================================================
  // INITIALIZATION AND CONFIGURATION
  // ========================================================================

  /**
   * Initialize the streaming orchestrator
   */
  async initialize(config?: Partial<CortexStreamingConfig>): Promise<void> {
    try {
      this.logger.log('🚀 Initializing Cortex Streaming Orchestrator...');

      // Merge configuration
      this.defaultConfig = { ...DEFAULT_STREAMING_CONFIG, ...config };

      this.logger.log(
        '✅ Cortex Streaming Orchestrator initialized successfully',
        {
          config: this.defaultConfig,
          activeExecutions: this.activeExecutions.size,
        },
      );
    } catch (error) {
      this.logger.error(
        '❌ Failed to initialize Cortex Streaming Orchestrator',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }

  /**
   * Update streaming configuration
   */
  updateConfig(config: Partial<CortexStreamingConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    this.logger.log('⚙️ Streaming orchestrator configuration updated', {
      config,
    });
  }

  // ========================================================================
  // MAIN STREAMING EXECUTION METHODS
  // ========================================================================

  /**
   * Execute a complete Cortex streaming workflow
   */
  async executeStreamingWorkflow(
    sessionId: string,
    userId: string,
    inputText: string,
    config?: Partial<CortexStreamingConfig>,
    onChunk?: (chunk: string, done: boolean) => void,
  ): Promise<string> {
    const executionId = uuidv4();
    const mergedConfig = { ...this.defaultConfig, ...config };

    const execution: CortexStreamingExecution = {
      id: executionId,
      sessionId,
      userId,
      inputText,
      config: mergedConfig,
      status: 'initializing',
      phase: CortexStreamingPhase.INITIALIZING,
      startTime: new Date(),
      tokens: [],
      chunks: [],
      currentChunk: '',
      chunkIndex: 0,
      totalChunks: 0,
      totalCost: 0,
      totalTokens: 0,
      budgetUsed: 0,
      budgetRemaining: mergedConfig.budgetLimit || 0,
      progress: 0,
      retryCount: 0,
      errorHistory: [],
      contextPreserved: false,
      metadata: {
        modelsUsed: [],
        operationsPerformed: [],
        optimizationLevel: 'standard',
        cacheHits: 0,
        totalOperations: 0,
      },
      onChunk,
    };

    // Initialize component states
    execution.encoderState = {
      status: 'pending',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };
    execution.processorState = {
      status: 'pending',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };
    execution.decoderState = {
      status: 'pending',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };

    this.activeExecutions.set(executionId, execution);
    this.totalExecutions++;

    try {
      execution.status = 'running';
      await this.runStreamingWorkflow(execution);

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();

      this.successfulExecutions++;
      this.updatePerformanceMetrics(execution);

      this.logger.log('✅ Streaming workflow completed successfully', {
        executionId,
        sessionId,
        userId,
        duration: execution.duration,
        totalCost: execution.totalCost,
        totalTokens: execution.totalTokens,
        chunks: execution.chunks.length,
      });

      // Return the final output
      return execution.chunks.join('');
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      execution.lastError =
        error instanceof Error ? error.message : String(error);
      execution.errorHistory.push(execution.lastError);

      this.failedExecutions++;
      this.logger.error('❌ Streaming workflow failed', {
        executionId,
        sessionId,
        userId,
        error: execution.lastError,
        retryCount: execution.retryCount,
        duration: execution.duration,
      });

      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Run the actual streaming workflow
   */
  private async runStreamingWorkflow(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Initialize execution state
      await this.initializeExecutionState(execution);

      // Execute components based on configuration
      if (execution.config.parallelExecution) {
        await this.executeParallelComponents(execution);
      } else {
        await this.executeSequentialComponents(execution);
      }

      // Process results and generate final output
      await this.processResults(execution);
      await this.generateFinalOutput(execution);

      // Final progress update
      execution.progress = 100;
      this.emitProgressUpdate(execution);
    } catch (error) {
      this.logger.error('Streaming workflow execution failed', {
        executionId: execution.id,
        phase: execution.phase,
        error: error instanceof Error ? error.message : String(error),
      });

      execution.phase = CortexStreamingPhase.ERROR;
      throw error;
    }
  }

  // ========================================================================
  // COMPONENT EXECUTION METHODS
  // ========================================================================

  /**
   * Execute components in parallel
   */
  private async executeParallelComponents(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    const promises = [
      this.executeEncoderWithStreaming(execution),
      this.executeProcessorWithStreaming(execution),
      this.executeDecoderWithStreaming(execution),
    ];

    const results = await Promise.allSettled(promises);

    // Check for failures and handle retries
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      await this.handleComponentFailures(execution, failures);
    }
  }

  /**
   * Execute components sequentially
   */
  private async executeSequentialComponents(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    await this.executeEncoderWithStreaming(execution);
    await this.executeProcessorWithStreaming(execution);
    await this.executeDecoderWithStreaming(execution);
  }

  /**
   * Execute encoder with streaming
   */
  private async executeEncoderWithStreaming(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    if (!execution.encoderState) return;

    execution.phase = CortexStreamingPhase.ENCODING;
    execution.encoderState.status = 'running';
    execution.progress = 10;
    this.emitProgressUpdate(execution);

    try {
      const startTime = Date.now();

      // Add input token
      this.addToken(execution, {
        id: uuidv4(),
        content: execution.inputText,
        type: 'input',
        timestamp: new Date(),
        metadata: {
          stage: 'encoder_input',
          tokenCount: this.estimateTokens(execution.inputText),
        },
      });

      // Execute encoding with retry logic
      const encodedResult = await this.executeWithRetry(
        execution,
        async () => {
          // Use Bedrock service to encode the input with a simple prompt
          const prompt = `Please encode the following text for processing: ${execution.inputText}`;
          const result = await this.bedrockService.invokeModelDirectly(
            execution.config.models.encoder,
            {
              prompt,
              max_tokens: 1000,
              temperature: 0.3,
              useSystemPrompt: false,
            },
          );
          return {
            data: result.response || execution.inputText,
            tokens:
              result.outputTokens ||
              this.estimateTokens(result.response || execution.inputText),
            cost: this.calculateCost(
              execution.config.models.encoder,
              execution.inputText,
            ),
          };
        },
        'encoder',
      );

      execution.encoderState.status = 'completed';
      execution.encoderState.inputTokens = this.estimateTokens(
        execution.inputText,
      );
      execution.encoderState.outputTokens = encodedResult.tokens;
      execution.encoderState.cost = encodedResult.cost;
      execution.encoderState.result = encodedResult.data;

      execution.totalTokens +=
        execution.encoderState.inputTokens +
        execution.encoderState.outputTokens;
      execution.totalCost += execution.encoderState.cost;

      // Add output token
      this.addToken(execution, {
        id: uuidv4(),
        content: 'Input encoded successfully',
        type: 'encoding',
        timestamp: new Date(),
        metadata: {
          stage: 'encoder_output',
          tokenCount: execution.encoderState.outputTokens,
          cost: execution.encoderState.cost,
          duration: Date.now() - startTime,
        },
      });

      // Send progress update
      if (execution.onChunk) {
        execution.onChunk('Input encoding completed...', false);
      }

      this.logger.debug('Encoder execution completed', {
        executionId: execution.id,
        inputTokens: execution.encoderState.inputTokens,
        outputTokens: execution.encoderState.outputTokens,
        cost: execution.encoderState.cost,
      });
    } catch (error) {
      execution.encoderState.status = 'failed';
      execution.encoderState.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Execute processor with streaming
   */
  private async executeProcessorWithStreaming(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    if (!execution.processorState) return;

    execution.phase = CortexStreamingPhase.PROCESSING;
    execution.processorState.status = 'running';
    execution.progress = 40;
    this.emitProgressUpdate(execution);

    try {
      const startTime = Date.now();

      // Get input from encoder or use original input
      const processorInput =
        execution.encoderState?.result || execution.inputText;

      // Execute processing with retry logic
      const processedResult = await this.executeWithRetry(
        execution,
        async () => {
          // Use Bedrock service to process the encoded input with a simple prompt
          const prompt = `Please process and analyze the following content: ${processorInput}`;
          const result = await this.bedrockService.invokeModelDirectly(
            execution.config.models.processor,
            {
              prompt,
              max_tokens: 2000,
              temperature: 0.5,
              useSystemPrompt: false,
            },
          );
          return {
            data: result.response || processorInput,
            tokens:
              result.outputTokens ||
              this.estimateTokens(result.response || processorInput),
            cost: this.calculateCost(
              execution.config.models.processor,
              processorInput,
            ),
          };
        },
        'processor',
      );

      execution.processorState.status = 'completed';
      execution.processorState.inputTokens =
        this.estimateTokens(processorInput);
      execution.processorState.outputTokens = processedResult.tokens;
      execution.processorState.cost = processedResult.cost;
      execution.processorState.result = processedResult.data;

      execution.totalTokens +=
        execution.processorState.inputTokens +
        execution.processorState.outputTokens;
      execution.totalCost += execution.processorState.cost;

      // Add output token
      this.addToken(execution, {
        id: uuidv4(),
        content: 'Processing completed successfully',
        type: 'processing',
        timestamp: new Date(),
        metadata: {
          stage: 'processor_output',
          tokenCount: execution.processorState.outputTokens,
          cost: execution.processorState.cost,
          duration: Date.now() - startTime,
        },
      });

      // Send progress update
      if (execution.onChunk) {
        execution.onChunk('Processing request...', false);
      }

      this.logger.debug('Processor execution completed', {
        executionId: execution.id,
        inputTokens: execution.processorState.inputTokens,
        outputTokens: execution.processorState.outputTokens,
        cost: execution.processorState.cost,
      });
    } catch (error) {
      execution.processorState.status = 'failed';
      execution.processorState.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Execute decoder with streaming
   */
  private async executeDecoderWithStreaming(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    if (!execution.decoderState) return;

    execution.phase = CortexStreamingPhase.DECODING;
    execution.decoderState.status = 'running';
    execution.progress = 70;
    this.emitProgressUpdate(execution);

    try {
      const startTime = Date.now();

      // Get input from processor or encoder
      const decoderInput =
        execution.processorState?.result ||
        execution.encoderState?.result ||
        execution.inputText;

      // Execute decoding with streaming
      const decodedResult = await this.executeWithRetry(
        execution,
        async () => {
          // Use Bedrock service to decode the processed input with a simple prompt
          const prompt = `Please provide a well-formatted response based on the following processed content: ${decoderInput}`;
          const result = await this.bedrockService.invokeModelDirectly(
            execution.config.models.decoder,
            {
              prompt,
              max_tokens: 4000,
              temperature: 0.7,
              useSystemPrompt: false,
            },
          );
          return {
            data: result.response || decoderInput,
            tokens:
              result.outputTokens ||
              this.estimateTokens(result.response || decoderInput),
            cost: this.calculateCost(
              execution.config.models.decoder,
              decoderInput,
            ),
          };
        },
        'decoder',
      );

      execution.decoderState.status = 'completed';
      execution.decoderState.inputTokens = this.estimateTokens(decoderInput);
      execution.decoderState.outputTokens = decodedResult.tokens;
      execution.decoderState.cost = decodedResult.cost;
      execution.decoderState.result = decodedResult.data;

      execution.totalTokens +=
        execution.decoderState.inputTokens +
        execution.decoderState.outputTokens;
      execution.totalCost += execution.decoderState.cost;

      // Split result into chunks for streaming
      const chunks = this.splitIntoChunks(
        decodedResult.data,
        execution.config.chunkSize,
      );
      execution.chunks = chunks;
      execution.totalChunks = chunks.length;

      // Stream chunks
      for (let i = 0; i < chunks.length; i++) {
        execution.chunkIndex = i;
        execution.currentChunk = chunks[i];
        execution.progress = 70 + (i / chunks.length) * 25;

        // Add token for each chunk
        this.addToken(execution, {
          id: uuidv4(),
          content: chunks[i],
          type: 'decoding',
          timestamp: new Date(),
          metadata: {
            stage: 'decoder_output',
            chunkIndex: i,
            totalChunks: chunks.length,
            tokenCount: this.estimateTokens(chunks[i]),
          },
        });

        // Send chunk to client
        const isLastChunk = i === chunks.length - 1;
        if (execution.onChunk) {
          execution.onChunk(chunks[i], isLastChunk);
        }

        // Small delay between chunks for streaming effect
        if (execution.config.streaming.enableTokenStreaming && !isLastChunk) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      this.logger.debug('Decoder execution completed', {
        executionId: execution.id,
        inputTokens: execution.decoderState.inputTokens,
        outputTokens: execution.decoderState.outputTokens,
        cost: execution.decoderState.cost,
        chunks: execution.chunks.length,
      });
    } catch (error) {
      execution.decoderState.status = 'failed';
      execution.decoderState.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  // ========================================================================
  // RESULT PROCESSING AND OUTPUT GENERATION
  // ========================================================================

  /**
   * Process results from all components
   */
  private async processResults(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    execution.progress = 95;
    this.emitProgressUpdate(execution);

    // Combine and validate results
    const encoderResult = execution.encoderState?.result;
    const processorResult = execution.processorState?.result;
    const decoderResult = execution.decoderState?.result;

    // Update metadata
    execution.metadata.modelsUsed = [
      execution.config.models.encoder,
      execution.config.models.processor,
      execution.config.models.decoder,
    ].filter((model, index, arr) => arr.indexOf(model) === index); // Remove duplicates

    execution.metadata.operationsPerformed = [
      'encoding',
      'processing',
      'decoding',
    ];
    execution.metadata.totalOperations =
      execution.metadata.operationsPerformed.length;

    // Update budget tracking
    execution.budgetUsed = execution.totalCost;
    execution.budgetRemaining =
      (execution.config.budgetLimit || 0) - execution.budgetUsed;

    this.logger.debug('Results processed successfully', {
      executionId: execution.id,
      modelsUsed: execution.metadata.modelsUsed,
      totalOperations: execution.metadata.totalOperations,
      budgetUsed: execution.budgetUsed,
      budgetRemaining: execution.budgetRemaining,
    });
  }

  /**
   * Generate final output
   */
  private async generateFinalOutput(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    execution.phase = CortexStreamingPhase.COMPLETED;

    // Add final metadata token
    this.addToken(execution, {
      id: uuidv4(),
      content: 'Streaming workflow completed',
      type: 'metadata',
      timestamp: new Date(),
      metadata: {
        stage: 'completion',
        totalTokens: execution.totalTokens,
        totalCost: execution.totalCost,
        duration: execution.duration,
        chunksProcessed: execution.chunks.length,
      },
    });

    this.logger.log('🎉 Final output generated successfully', {
      executionId: execution.id,
      totalTokens: execution.totalTokens,
      totalCost: execution.totalCost,
      chunks: execution.chunks.length,
      tokens: execution.tokens.length,
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Initialize execution state
   */
  private async initializeExecutionState(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    execution.phase = CortexStreamingPhase.INITIALIZING;

    // Add initial token
    this.addToken(execution, {
      id: uuidv4(),
      content: 'Initializing streaming workflow',
      type: 'control',
      timestamp: new Date(),
      metadata: {
        stage: 'initialization',
        sessionId: execution.sessionId,
        userId: execution.userId,
      },
    });

    // Update progress
    execution.progress = 5;
    this.emitProgressUpdate(execution);

    this.logger.debug('Execution state initialized', {
      executionId: execution.id,
      sessionId: execution.sessionId,
      config: execution.config,
    });
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    execution: CortexStreamingExecution,
    operation: () => Promise<T>,
    component: string,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= execution.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          execution.phase = CortexStreamingPhase.RETRYING;
          execution.retryCount = attempt;

          // Exponential backoff
          const delay = execution.config.retryDelay * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));

          this.logger.warn(`Retrying ${component} operation`, {
            executionId: execution.id,
            attempt,
            delay,
          });
        }

        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        this.logger.warn(`${component} operation failed`, {
          executionId: execution.id,
          attempt,
          error: lastError.message,
        });

        // Add error token
        this.addToken(execution, {
          id: uuidv4(),
          content: `${component} operation failed`,
          type: 'error',
          timestamp: new Date(),
          metadata: {
            stage: component,
            attempt,
            error: lastError.message,
          },
        });
      }
    }

    throw lastError!;
  }

  /**
   * Handle component failures
   */
  private async handleComponentFailures(
    execution: CortexStreamingExecution,
    failures: PromiseSettledResult<any>[],
  ): Promise<void> {
    const errorMessages = failures
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || 'Unknown error');

    this.logger.error('Component failures detected', {
      executionId: execution.id,
      failureCount: failures.length,
      errors: errorMessages,
    });

    throw new Error(`Multiple component failures: ${errorMessages.join(', ')}`);
  }

  /**
   * Add token to execution
   */
  private addToken(
    execution: CortexStreamingExecution,
    token: CortexToken,
  ): void {
    execution.tokens.push(token);
  }

  /**
   * Split text into chunks for streaming
   */
  private splitIntoChunks(text: string, chunkSize: number): string[] {
    if (!text || text.length <= chunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;

      // Try to break at word boundaries
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end);
        if (lastSpace > start && lastSpace > end - 100) {
          end = lastSpace;
        }
      }

      chunks.push(text.slice(start, end));
      start = end;
    }

    return chunks;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost for operation
   */
  private calculateCost(model: string, text: string): number {
    const tokenCount = Math.ceil(text.length / 4); // Rough approximation
    return CostEstimator.estimateCost(model, tokenCount, tokenCount);
  }

  /**
   * Emit progress update
   */
  private emitProgressUpdate(execution: CortexStreamingExecution): void {
    if (execution.config.streaming.enableProgressUpdates) {
      this.eventEmitter.emit('cortex.streaming.progress', {
        executionId: execution.id,
        sessionId: execution.sessionId,
        userId: execution.userId,
        progress: execution.progress,
        phase: execution.phase,
        totalCost: execution.totalCost,
        totalTokens: execution.totalTokens,
      });
    }
  }

  /**
   * Start progress update interval
   */
  private startProgressUpdates(): void {
    this.progressUpdateInterval = setInterval(() => {
      for (const execution of this.activeExecutions.values()) {
        if (execution.status === 'running') {
          this.emitProgressUpdate(execution);
        }
      }
    }, 1000); // Update every second
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(execution: CortexStreamingExecution): void {
    if (execution.duration) {
      // Simple moving average
      this.averageExecutionTime =
        (this.averageExecutionTime + execution.duration) / 2;
    }

    if (execution.totalCost > 0) {
      this.averageCost = (this.averageCost + execution.totalCost) / 2;
    }
  }

  // ========================================================================
  // PUBLIC CONTROL METHODS
  // ========================================================================

  /**
   * Cancel execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    execution.status = 'cancelled';
    execution.phase = CortexStreamingPhase.ERROR;
    execution.endTime = new Date();
    execution.duration =
      execution.endTime.getTime() - execution.startTime.getTime();

    this.activeExecutions.delete(executionId);

    // Add cancellation token
    this.addToken(execution, {
      id: uuidv4(),
      content: 'Execution cancelled by user',
      type: 'control',
      timestamp: new Date(),
      metadata: {
        stage: 'cancellation',
        duration: execution.duration,
      },
    });

    this.logger.log('Execution cancelled', {
      executionId,
      sessionId: execution.sessionId,
      userId: execution.userId,
      duration: execution.duration,
    });
  }

  /**
   * Pause execution
   */
  async pauseExecution(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (!execution.config.streaming.enablePauseResume) {
      throw new Error('Pause/resume not enabled for this execution');
    }

    execution.status = 'paused';
    execution.phase = CortexStreamingPhase.PAUSED;

    // Create checkpoint for resumption
    execution.checkpointData = {
      currentChunk: execution.chunkIndex,
      tokensProcessed: execution.tokens.length,
      timestamp: new Date(),
    };

    // Add pause token
    this.addToken(execution, {
      id: uuidv4(),
      content: 'Execution paused',
      type: 'control',
      timestamp: new Date(),
      metadata: {
        stage: 'pause',
        checkpoint: execution.checkpointData,
      },
    });

    this.logger.log('Execution paused', {
      executionId,
      sessionId: execution.sessionId,
      userId: execution.userId,
      currentChunk: execution.chunkIndex,
    });
  }

  /**
   * Resume execution
   */
  async resumeExecution(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (!execution.config.streaming.enablePauseResume) {
      throw new Error('Pause/resume not enabled for this execution');
    }

    execution.status = 'running';
    execution.phase = CortexStreamingPhase.RESUMED;

    // Add resume token
    this.addToken(execution, {
      id: uuidv4(),
      content: 'Execution resumed',
      type: 'control',
      timestamp: new Date(),
      metadata: {
        stage: 'resume',
        checkpoint: execution.checkpointData,
      },
    });

    // Resume from checkpoint
    await this.resumeFromCheckpoint(execution);

    this.logger.log('Execution resumed', {
      executionId,
      sessionId: execution.sessionId,
      userId: execution.userId,
      resumedFromChunk: execution.chunkIndex,
    });
  }

  /**
   * Resume execution from checkpoint
   */
  private async resumeFromCheckpoint(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    // Continue streaming from the current chunk
    const remainingChunks = execution.chunks.slice(execution.chunkIndex);

    for (let i = 0; i < remainingChunks.length; i++) {
      const chunkIndex = execution.chunkIndex + i;
      execution.currentChunk = remainingChunks[i];
      execution.progress =
        70 + ((chunkIndex + 1) / execution.chunks.length) * 25;

      // Add token for resumed chunk
      this.addToken(execution, {
        id: uuidv4(),
        content: remainingChunks[i],
        type: 'decoding',
        timestamp: new Date(),
        metadata: {
          stage: 'decoder_output_resumed',
          chunkIndex,
          totalChunks: execution.chunks.length,
          tokenCount: this.estimateTokens(remainingChunks[i]),
          resumed: true,
        },
      });

      // Send chunk to client
      const isLastChunk = i === remainingChunks.length - 1;
      if (execution.onChunk) {
        execution.onChunk(remainingChunks[i], isLastChunk);
      }

      // Small delay between chunks
      if (execution.config.streaming.enableTokenStreaming && !isLastChunk) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // Complete the execution
    await this.generateFinalOutput(execution);
  }

  /**
   * Get execution status
   */
  getExecutionStatus(executionId: string): CortexStreamingExecution | null {
    return this.activeExecutions.get(executionId) || null;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
      successRate:
        this.totalExecutions > 0
          ? this.successfulExecutions / this.totalExecutions
          : 0,
      averageExecutionTime: this.averageExecutionTime,
      averageCost: this.averageCost,
    };
  }
}
