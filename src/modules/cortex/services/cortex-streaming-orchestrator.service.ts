/**
 * Cortex Streaming Orchestrator Service (NestJS)
 *
 * Core of the advanced streaming capabilities for complex, long-running LLM workflows.
 * Coordinates streaming execution across encoding, processing, and decoding phases.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CortexEncoderService } from './cortex-encoder.service';
import { CortexDecoderService } from './cortex-decoder.service';
import { CortexCoreService } from './cortex-core.service';
import { CortexVocabularyService } from './cortex-vocabulary.service';
import { generateSecureId } from '../../../common/utils/secure-id.util';

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
    encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    processor: 'us.anthropic.claude-sonnet-4-6',
    decoder: 'mistral.mistral-large-3-675b-instruct',
  },
  streaming: {
    enableTokenStreaming: true,
    enableProgressUpdates: true,
    enablePauseResume: true,
    progressUpdateInterval: 100,
  },
};

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
  encoderState?: any;
  processorState?: any;
  decoderState?: any;
  tokens: CortexToken[];
  progress: number;
  totalCost: number;
  errors: string[];
  phaseData?: unknown;
}

@Injectable()
export class CortexStreamingOrchestratorService {
  private readonly logger = new Logger(CortexStreamingOrchestratorService.name);
  private executions = new Map<string, CortexStreamingExecution>();
  private progressIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly cortexEncoderService: CortexEncoderService,
    private readonly cortexDecoderService: CortexDecoderService,
    private readonly cortexCoreService: CortexCoreService,
    private readonly cortexVocabularyService: CortexVocabularyService,
  ) {}

  /**
   * Start a new streaming execution
   */
  public async startStreamingExecution(
    inputText: string,
    userId: string,
    sessionId: string,
    config: Partial<CortexStreamingConfig> = {},
  ): Promise<string> {
    const executionId = generateSecureId('stream');
    const executionConfig = { ...DEFAULT_STREAMING_CONFIG, ...config };

    const execution: CortexStreamingExecution = {
      id: executionId,
      sessionId,
      userId,
      inputText,
      config: executionConfig,
      status: 'initializing',
      phase: CortexStreamingPhase.INITIALIZING,
      startTime: new Date(),
      tokens: [],
      progress: 0,
      totalCost: 0,
      errors: [],
    };

    this.executions.set(executionId, execution);

    this.logger.log(`🚀 Starting streaming execution: ${executionId}`);

    // Start execution asynchronously
    setImmediate(() => this.executeStreamingWorkflow(executionId));

    // Set up progress tracking if enabled
    if (executionConfig.streaming.enableProgressUpdates) {
      this.startProgressTracking(executionId);
    }

    return executionId;
  }

  /**
   * Get execution status
   */
  public getExecutionStatus(
    executionId: string,
  ): CortexStreamingExecution | null {
    return this.executions.get(executionId) || null;
  }

  /** Alias for controller: start streaming session (sessionId = executionId). */
  public async startStreamingSession(
    userId: string,
    prompt: string,
    options?: {
      modelId?: string;
      streamingConfig?: Partial<CortexStreamingConfig>;
    },
  ): Promise<string> {
    const sessionId = generateSecureId('session');
    const config: Partial<CortexStreamingConfig> =
      options?.streamingConfig ?? {};
    if (options?.modelId) {
      config.models = {
        ...DEFAULT_STREAMING_CONFIG.models,
        encoder: options.modelId,
        processor: options.modelId,
        decoder: options.modelId,
      };
    }
    await this.startStreamingExecution(prompt, userId, sessionId, config);
    return sessionId;
  }

  /** Alias for controller: get streaming status by sessionId; enforces userId ownership. */
  public async getStreamingStatus(
    sessionId: string,
    userId: string,
  ): Promise<CortexStreamingExecution | null> {
    const execution = Array.from(this.executions.values()).find(
      (e) => e.sessionId === sessionId,
    );
    if (!execution) return null;
    if (execution.userId !== userId) {
      this.logger.warn('getStreamingStatus: userId mismatch', {
        sessionId,
        executionUserId: execution.userId,
        requestUserId: userId,
      });
      return null;
    }
    return execution;
  }

  /** Alias for controller: pause by sessionId; enforces userId ownership. */
  public async pauseStreaming(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const execution = Array.from(this.executions.entries()).find(
      ([_, e]) => e.sessionId === sessionId,
    );
    if (execution && execution[1].userId === userId) {
      this.pauseExecution(execution[0]);
    } else if (execution) {
      this.logger.warn('pauseStreaming: userId mismatch', {
        sessionId,
        requestUserId: userId,
      });
    }
  }

  /** Alias for controller: resume by sessionId; enforces userId ownership. */
  public async resumeStreaming(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const execution = Array.from(this.executions.entries()).find(
      ([_, e]) => e.sessionId === sessionId,
    );
    if (execution && execution[1].userId === userId) {
      this.resumeExecution(execution[0]);
    } else if (execution) {
      this.logger.warn('resumeStreaming: userId mismatch', {
        sessionId,
        requestUserId: userId,
      });
    }
  }

  /** Alias for controller: stop by sessionId; enforces userId ownership. */
  public async stopStreaming(
    sessionId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    const execution = Array.from(this.executions.entries()).find(
      ([_, e]) => e.sessionId === sessionId,
    );
    if (!execution) return { success: false };
    if (execution[1].userId !== userId) {
      this.logger.warn('stopStreaming: userId mismatch', {
        sessionId,
        requestUserId: userId,
      });
      return { success: false };
    }
    const ok = this.cancelExecution(execution[0]);
    return { success: ok };
  }

  /**
   * Return execution IDs for a user and optional date range (for analytics/history filtering).
   */
  public getExecutionIdsByUserAndDate(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): string[] {
    return Array.from(this.executions.entries())
      .filter(([_, e]) => {
        if (e.userId !== userId) return false;
        const t = e.startTime.getTime();
        if (startDate && t < startDate.getTime()) return false;
        if (endDate && t > endDate.getTime()) return false;
        return true;
      })
      .map(([id]) => id);
  }

  /** Alias for controller: stream updates for sessionId; enforces userId ownership. */
  public streamUpdates(
    sessionId: string,
    userId: string,
  ): { subscribe: (fn: (v: unknown) => void) => { unsubscribe: () => void } } {
    const execution = Array.from(this.executions.entries()).find(
      ([_, e]) => e.sessionId === sessionId,
    );
    if (!execution || execution[1].userId !== userId) {
      this.logger.warn('streamUpdates: access denied or session not found', {
        sessionId,
        requestUserId: userId,
      });
      return {
        subscribe(_fn: (v: unknown) => void) {
          return { unsubscribe: () => {} };
        },
      };
    }
    return {
      subscribe(_fn: (v: unknown) => void) {
        return { unsubscribe: () => {} };
      },
    };
  }

  /**
   * Pause execution
   */
  public pauseExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') {
      return false;
    }

    execution.status = 'paused';
    execution.phase = CortexStreamingPhase.PAUSED;

    this.emitEvent(executionId, 'execution.paused', { executionId });
    this.logger.log(`⏸️ Paused execution: ${executionId}`);

    return true;
  }

  /**
   * Resume execution
   */
  public resumeExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'paused') {
      return false;
    }

    execution.status = 'running';
    execution.phase = CortexStreamingPhase.RESUMED;

    this.emitEvent(executionId, 'execution.resumed', { executionId });
    this.logger.log(`▶️ Resumed execution: ${executionId}`);

    // Continue execution
    setImmediate(() => this.continueStreamingWorkflow(executionId));

    return true;
  }

  /**
   * Cancel execution
   */
  public cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (
      !execution ||
      ['completed', 'failed', 'cancelled'].includes(execution.status)
    ) {
      return false;
    }

    execution.status = 'cancelled';
    execution.endTime = new Date();
    execution.duration =
      execution.endTime.getTime() - execution.startTime.getTime();

    this.stopProgressTracking(executionId);
    this.emitEvent(executionId, 'execution.cancelled', { executionId });

    this.logger.log(`❌ Cancelled execution: ${executionId}`);
    return true;
  }

  /**
   * Get streaming tokens for execution
   */
  public getStreamingTokens(executionId: string, since?: Date): CortexToken[] {
    const execution = this.executions.get(executionId);
    if (!execution) return [];

    let tokens = execution.tokens;
    if (since) {
      tokens = tokens.filter((token) => token.timestamp >= since);
    }

    return tokens;
  }

  // Private methods

  private async executeStreamingWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    try {
      execution.status = 'running';

      // Phase 1: Encoding
      execution.phase = CortexStreamingPhase.ENCODING;
      await this.executeEncodingPhase(execution);

      // Phase 2: Processing
      execution.phase = CortexStreamingPhase.PROCESSING;
      await this.executeProcessingPhase(execution);

      // Phase 3: Decoding
      execution.phase = CortexStreamingPhase.DECODING;
      await this.executeDecodingPhase(execution);

      // Complete execution
      execution.status = 'completed';
      execution.phase = CortexStreamingPhase.COMPLETED;
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      execution.progress = 100;

      this.stopProgressTracking(executionId);
      this.emitEvent(executionId, 'execution.completed', {
        executionId,
        totalCost: execution.totalCost,
        duration: execution.duration,
      });

      this.logger.log(`✅ Completed streaming execution: ${executionId}`, {
        duration: execution.duration,
        totalCost: execution.totalCost,
        tokensProcessed: execution.tokens.length,
      });
    } catch (error) {
      execution.status = 'failed';
      execution.phase = CortexStreamingPhase.ERROR;
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      execution.errors.push(
        error instanceof Error ? error.message : String(error),
      );

      this.stopProgressTracking(executionId);
      this.emitEvent(executionId, 'execution.failed', {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.logger.error(`❌ Failed streaming execution: ${executionId}`, error);
    }
  }

  private async continueStreamingWorkflow(executionId: string): Promise<void> {
    // Resume from current phase
    await this.executeStreamingWorkflow(executionId);
  }

  private async executeEncodingPhase(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    this.addToken(execution, {
      id: `token_${Date.now()}_encoding_start`,
      content: 'Starting encoding phase',
      type: 'control',
      timestamp: new Date(),
      metadata: { stage: 'encoding_start' },
    });

    try {
      const encodingResult = await this.cortexEncoderService.encode({
        text: execution.inputText,
        language: 'en',
        model: execution.config.models.encoder,
        options: {
          streaming: execution.config.streaming.enableTokenStreaming,
          onToken: (token: unknown) =>
            this.handleEncodingToken(execution, token),
        },
      });

      execution.encoderState = {
        status: 'completed',
        inputTokens: encodingResult.inputTokens,
        outputTokens: encodingResult.outputTokens,
        cost: encodingResult.cost,
        result: encodingResult,
      };

      execution.totalCost += encodingResult.cost ?? 0;
      execution.progress = 33;

      this.addToken(execution, {
        id: `token_${Date.now()}_encoding_complete`,
        content: 'Encoding phase completed',
        type: 'control',
        timestamp: new Date(),
        metadata: {
          stage: 'encoding_complete',
          tokens: encodingResult.outputTokens,
          cost: encodingResult.cost,
        },
      });
    } catch (error) {
      execution.encoderState = {
        status: 'failed',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  /**
   * Executes the processing phase, using frames from the encoder phase.
   *
   * Populates frames from encoderState.result.frames, if available.
   * Throws an error if encoderState or its frames are missing.
   */
  private async executeProcessingPhase(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    this.addToken(execution, {
      id: `token_${Date.now()}_processing_start`,
      content: 'Starting processing phase',
      type: 'control',
      timestamp: new Date(),
      metadata: { stage: 'processing_start' },
    });

    try {
      // === PENDING: Populate frames from encoder result ===
      const encoderState = execution.encoderState;
      if (
        !encoderState ||
        encoderState.status !== 'completed' ||
        !encoderState.result
      ) {
        execution.processorState = {
          status: 'failed',
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          error:
            'Missing or failed encoder state: cannot proceed to processing phase',
        };
        throw new Error(
          'Missing or failed encoder state: cannot proceed to processing phase',
        );
      }

      // Attempt to extract frames from encoderState.result
      // We expect .frames, but fallback or propagate error if not present.
      const frames = Array.isArray(encoderState.result.frames)
        ? encoderState.result.frames
        : [];

      if (frames.length === 0) {
        execution.processorState = {
          status: 'failed',
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          error: 'No frames found from encoding phase for processing',
        };
        throw new Error('No frames found from encoding phase for processing');
      }

      const processingResult = await this.cortexCoreService.process({
        input: Array.isArray(frames) ? frames[0] : frames,
        operation: 'optimize',
        metadata: { model: execution.config.models.processor },
        options: {
          streaming: execution.config.streaming.enableTokenStreaming,
          onToken: (token: unknown) =>
            this.handleProcessingToken(execution, token),
        },
      });

      execution.processorState = {
        status: 'completed',
        inputTokens: processingResult.inputTokens,
        outputTokens: processingResult.outputTokens,
        cost: processingResult.cost,
        result: processingResult,
      };

      execution.totalCost += processingResult.cost ?? 0;
      execution.progress = 66;

      this.addToken(execution, {
        id: `token_${Date.now()}_processing_complete`,
        content: 'Processing phase completed',
        type: 'control',
        timestamp: new Date(),
        metadata: {
          stage: 'processing_complete',
          tokens: processingResult.outputTokens,
          cost: processingResult.cost,
        },
      });
    } catch (error) {
      execution.processorState = {
        status: 'failed',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  /**
   * Executes the decoding phase for the provided execution.
   * Pulls processed frames from processorState, streams tokens via onToken.
   * Throws if no processing result found.
   */
  private async executeDecodingPhase(
    execution: CortexStreamingExecution,
  ): Promise<void> {
    // Get processed frames from processing phase
    const processingResult = execution.processorState?.result;
    const frames =
      processingResult && Array.isArray(processingResult.frames)
        ? processingResult.frames
        : undefined;

    this.addToken(execution, {
      id: `token_${Date.now()}_decoding_start`,
      content: 'Starting decoding phase',
      type: 'control',
      timestamp: new Date(),
      metadata: { stage: 'decoding_start' },
    });

    if (!frames || frames.length === 0) {
      execution.decoderState = {
        status: 'failed',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        error: 'No frames found from processing phase for decoding',
      };
      throw new Error('No frames found from processing phase for decoding');
    }

    try {
      const decodingResult = await this.cortexDecoderService.decode({
        cortexStructure: Array.isArray(frames) ? frames[0] : frames,
        config: {
          decoding: {
            model: execution.config.models.decoder,
            style: 'conversational' as const,
          },
        },
        options: {
          streaming: execution.config.streaming.enableTokenStreaming,
          onToken: (token: unknown) =>
            this.handleDecodingToken(execution, token),
        },
      });

      execution.decoderState = {
        status: 'completed',
        inputTokens: decodingResult.inputTokens,
        outputTokens: decodingResult.outputTokens,
        cost: decodingResult.cost,
        result: decodingResult,
      };

      execution.totalCost += decodingResult.cost ?? 0;
      execution.progress = 100;

      this.addToken(execution, {
        id: `token_${Date.now()}_decoding_complete`,
        content: 'Decoding phase completed',
        type: 'control',
        timestamp: new Date(),
        metadata: {
          stage: 'decoding_complete',
          tokens: decodingResult.outputTokens,
          cost: decodingResult.cost,
        },
      });
    } catch (error) {
      execution.decoderState = {
        status: 'failed',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private handleEncodingToken(
    execution: CortexStreamingExecution,
    token: any,
  ): void {
    const cortexToken: CortexToken = {
      id: generateSecureId('token'),
      content: token.content || '',
      type: 'encoding',
      timestamp: new Date(),
      metadata: {
        model: execution.config.models.encoder,
        stage: 'encoding',
        ...token.metadata,
      },
    };

    this.addToken(execution, cortexToken);
    this.emitEvent(execution.id, 'token.encoding', cortexToken);
  }

  private handleProcessingToken(
    execution: CortexStreamingExecution,
    token: any,
  ): void {
    const cortexToken: CortexToken = {
      id: generateSecureId('token'),
      content: token.content || '',
      type: 'processing',
      timestamp: new Date(),
      metadata: {
        model: execution.config.models.processor,
        stage: 'processing',
        ...token.metadata,
      },
    };

    this.addToken(execution, cortexToken);
    this.emitEvent(execution.id, 'token.processing', cortexToken);
  }

  private handleDecodingToken(
    execution: CortexStreamingExecution,
    token: any,
  ): void {
    const cortexToken: CortexToken = {
      id: generateSecureId('token'),
      content: token.content || '',
      type: 'decoding',
      timestamp: new Date(),
      metadata: {
        model: execution.config.models.decoder,
        stage: 'decoding',
        ...token.metadata,
      },
    };

    this.addToken(execution, cortexToken);
    this.emitEvent(execution.id, 'token.decoding', cortexToken);
  }

  private addToken(
    execution: CortexStreamingExecution,
    token: CortexToken,
  ): void {
    execution.tokens.push(token);
  }

  private startProgressTracking(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    const interval = setInterval(() => {
      if (execution.status === 'running') {
        this.emitEvent(executionId, 'execution.progress', {
          executionId,
          progress: execution.progress,
          phase: execution.phase,
          totalCost: execution.totalCost,
        });
      } else {
        this.stopProgressTracking(executionId);
      }
    }, execution.config.streaming.progressUpdateInterval);

    this.progressIntervals.set(executionId, interval);
  }

  private stopProgressTracking(executionId: string): void {
    const interval = this.progressIntervals.get(executionId);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(executionId);
    }
  }

  private emitEvent(executionId: string, event: string, data: any): void {
    this.eventEmitter.emit(event, { executionId, ...data });
  }
}
