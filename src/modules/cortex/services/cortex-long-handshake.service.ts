/**
 * Cortex Long Handshake Service
 *
 * Handles long-running handshake operations for Cortex processing,
 * including multi-turn conversations and complex state management.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { estimateTokenCount } from '../../../utils/token-count.utils';
import { CortexCoreService } from './cortex-core.service';
import { CortexEncoderService } from './cortex-encoder.service';
import { CortexDecoderService } from './cortex-decoder.service';
import type { CortexProcessingResult } from '../types/cortex.types';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface HandshakeSession {
  id: string;
  userId: string;
  initialPrompt: string;
  currentState: HandshakeState;
  history: HandshakeStep[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  metadata: Map<string, any>;
}

export interface HandshakeState {
  phase:
    | 'initializing'
    | 'negotiating'
    | 'processing'
    | 'finalizing'
    | 'completed'
    | 'failed';
  confidence: number;
  data: Map<string, any>;
  errors: string[];
}

export interface HandshakeStep {
  id: string;
  timestamp: Date;
  type: 'request' | 'response' | 'error' | 'state_change';
  content: any;
  metadata?: any;
}

@Injectable()
export class CortexLongHandshakeService {
  private readonly logger = new Logger(CortexLongHandshakeService.name);
  private sessions = new Map<string, HandshakeSession>();

  constructor(
    private eventEmitter: EventEmitter2,
    private readonly cortexCore: CortexCoreService,
    private readonly cortexEncoder: CortexEncoderService,
    private readonly cortexDecoder: CortexDecoderService,
  ) {}

  /**
   * Initialize a long handshake session
   */
  initializeSession(
    sessionId: string,
    userId: string,
    initialPrompt: string,
  ): HandshakeSession {
    const session: HandshakeSession = {
      id: sessionId,
      userId,
      initialPrompt,
      currentState: {
        phase: 'initializing',
        confidence: 0,
        data: new Map(),
        errors: [],
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      metadata: new Map(),
    };

    this.sessions.set(sessionId, session);

    // Add initial step
    this.addStep(sessionId, 'state_change', {
      phase: 'initializing',
      message: 'Handshake session initialized',
    });

    this.logger.log('Initialized long handshake session', {
      sessionId,
      userId,
      promptLength: initialPrompt.length,
    });

    return session;
  }

  /**
   * Get handshake session
   */
  getSession(sessionId: string): HandshakeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session state
   */
  updateState(sessionId: string, updates: Partial<HandshakeState>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Handshake session ${sessionId} not found`);
    }

    const oldPhase = session.currentState.phase;
    session.currentState = { ...session.currentState, ...updates };
    session.updatedAt = new Date();

    // Log state change
    if (updates.phase && updates.phase !== oldPhase) {
      this.addStep(sessionId, 'state_change', {
        fromPhase: oldPhase,
        toPhase: updates.phase,
        confidence: session.currentState.confidence,
      });

      this.logger.log('Handshake state updated', {
        sessionId,
        fromPhase: oldPhase,
        toPhase: updates.phase,
        confidence: session.currentState.confidence,
      });

      // Emit event
      this.eventEmitter.emit('cortex.handshake.state.changed', {
        sessionId,
        fromPhase: oldPhase,
        toPhase: updates.phase,
        confidence: session.currentState.confidence,
      });
    }
  }

  /**
   * Add a step to the handshake history
   */
  addStep(
    sessionId: string,
    type: HandshakeStep['type'],
    content: any,
    metadata?: any,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const step: HandshakeStep = {
      id: generateSecureId('step'),
      timestamp: new Date(),
      type,
      content,
      metadata,
    };

    session.history.push(step);
    session.updatedAt = new Date();

    this.logger.debug('Added handshake step', {
      sessionId,
      stepId: step.id,
      type,
      hasContent: !!content,
    });
  }

  /**
   * Process a handshake request
   */
  async processRequest(sessionId: string, request: any): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Handshake session ${sessionId} not found`);
    }

    // Add request to history
    this.addStep(sessionId, 'request', request);

    try {
      // Process based on current state
      const response = await this.processBasedOnState(session, request);

      // Add response to history
      this.addStep(sessionId, 'response', response);

      // Update state confidence
      const newConfidence = Math.min(1, session.currentState.confidence + 0.1);
      this.updateState(sessionId, { confidence: newConfidence });

      return response;
    } catch (error) {
      // Add error to history
      this.addStep(sessionId, 'error', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });

      // Update state with error
      this.updateState(sessionId, {
        errors: [
          ...session.currentState.errors,
          error instanceof Error ? error.message : String(error),
        ],
      });

      throw error;
    }
  }

  /**
   * Process request based on current state
   */
  private async processBasedOnState(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    switch (session.currentState.phase) {
      case 'initializing':
        return this.processInitialization(session, request);

      case 'negotiating':
        return this.processNegotiation(session, request);

      case 'processing':
        return this.processCore(session, request);

      case 'finalizing':
        return this.processFinalization(session, request);

      default:
        throw new Error(
          `Cannot process request in phase: ${session.currentState.phase}`,
        );
    }
  }

  /**
   * Process initialization phase
   */
  private async processInitialization(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    // Analyze initial request and determine requirements
    const analysis = await this.analyzeInitialRequest(session, request);

    // Store analysis in session state
    session.currentState.data.set('initialAnalysis', analysis);

    // Move to negotiating phase
    this.updateState(session.id, {
      phase: 'negotiating',
      data: session.currentState.data,
    });

    return {
      type: 'initial_analysis',
      analysis,
      nextPhase: 'negotiating',
      message: 'Initial analysis complete. Proceeding to negotiation phase.',
    };
  }

  /**
   * Process negotiation phase
   */
  private async processNegotiation(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    // Negotiate processing parameters
    const parameters = await this.negotiateParameters(session, request);

    // Store parameters in session state
    session.currentState.data.set('negotiatedParameters', parameters);

    // Move to processing phase
    this.updateState(session.id, {
      phase: 'processing',
      confidence: 0.7,
      data: session.currentState.data,
    });

    return {
      type: 'parameter_negotiation',
      parameters,
      nextPhase: 'processing',
      message: 'Parameters negotiated. Proceeding to processing phase.',
    };
  }

  /**
   * Process core processing phase
   */
  private async processCore(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    // Perform core processing
    const result = await this.performCoreProcessing(session, request);

    // Store result in session state
    session.currentState.data.set('processingResult', result);

    // Move to finalizing phase
    this.updateState(session.id, {
      phase: 'finalizing',
      confidence: 0.9,
      data: session.currentState.data,
    });

    return {
      type: 'processing_result',
      result,
      nextPhase: 'finalizing',
      message: 'Core processing complete. Proceeding to finalization.',
    };
  }

  /**
   * Process finalization phase
   */
  private async processFinalization(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    // Finalize and cleanup
    const finalResult = await this.finalizeSession(session, request);

    // Move to completed phase
    this.updateState(session.id, {
      phase: 'completed',
      confidence: 1.0,
      data: session.currentState.data,
    });

    return {
      type: 'final_result',
      result: finalResult,
      completed: true,
      message: 'Handshake session completed successfully.',
    };
  }

  /**
   * Analyze initial request using tiktoken-based token count and complexity scoring.
   */
  private async analyzeInitialRequest(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    const promptText = typeof request.prompt === 'string' ? request.prompt : '';
    const estimatedTokens = promptText ? estimateTokenCount(promptText) : 100;

    const complexity = this.computeRequestComplexity(
      promptText,
      estimatedTokens,
    );

    return {
      complexity,
      estimatedTokens,
      processingType: request.enableCortex ? 'cortex' : 'standard',
      requirements: {
        hasContext: !!request.context,
        hasExamples: !!request.conversationHistory,
        needsOptimization: true,
      },
    };
  }

  /**
   * Compute request complexity from token count and structural signals.
   */
  private computeRequestComplexity(
    prompt: string,
    estimatedTokens: number,
  ): 'low' | 'medium' | 'high' {
    let score = 0;
    if (estimatedTokens > 2000) score += 2;
    else if (estimatedTokens > 500) score += 1;
    if (prompt && /```[\s\S]*?```/g.test(prompt)) score += 1;
    if (prompt && (prompt.match(/\n/g) ?? []).length > 10) score += 1;
    if (prompt && (prompt.match(/\?/g) ?? []).length > 2) score += 1;
    if (score >= 3) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
  }

  /**
   * Negotiate processing parameters
   */
  private async negotiateParameters(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    const initialAnalysis = session.currentState.data.get('initialAnalysis');

    return {
      model: request.model || 'claude-3-5-sonnet',
      maxTokens: request.maxTokens || 4000,
      temperature: request.temperature || 0.7,
      processingMode: initialAnalysis.processingType,
      enableStreaming: request.enableStreaming !== false,
      priority: request.priority || 'normal',
    };
  }

  /**
   * Perform core processing via Cortex pipeline: encode -> optimize -> decode.
   */
  private async performCoreProcessing(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    const prompt =
      typeof request.prompt === 'string'
        ? request.prompt
        : session.initialPrompt;
    if (!prompt || prompt.trim().length === 0) {
      return {
        processed: true,
        tokensUsed: 0,
        processingTime: Date.now() - session.createdAt.getTime(),
        quality: 'none',
        optimizations: [],
        message: 'No prompt to process',
      };
    }

    try {
      const encodeResult = await this.cortexEncoder.encode({
        text: prompt,
        language: 'en',
      });

      const processResult: CortexProcessingResult =
        await this.cortexCore.process({
          input: encodeResult.cortexFrame,
          operation: 'optimize',
          options: {
            preserveSemantics: true,
            enableInference: true,
          },
          metadata: request.metadata,
        });

      let decodedText: string | undefined;
      try {
        const decodeResult = await this.cortexDecoder.decode({
          cortexStructure: processResult.output,
          targetLanguage: 'en',
          style: 'conversational',
        });
        decodedText = decodeResult.text;
      } catch (decodeError) {
        this.logger.warn('Cortex decode step failed, using raw output', {
          sessionId: session.id,
          error:
            decodeError instanceof Error
              ? decodeError.message
              : String(decodeError),
        });
      }

      const tokensUsed =
        (encodeResult.inputTokens ?? 0) +
        (processResult.inputTokens ?? 0) +
        (processResult.outputTokens ?? 0);
      const processingTime = Date.now() - session.createdAt.getTime();
      const optimizations = processResult.optimizations?.map((o) => o.type) ?? [
        'compression',
        'context_trimming',
      ];

      return {
        processed: true,
        tokensUsed,
        processingTime,
        quality:
          (processResult.metadata?.semanticIntegrity ?? 0) >= 0.8
            ? 'high'
            : 'medium',
        optimizations,
        outputFrame: processResult.output,
        decodedText,
        semanticIntegrity: processResult.metadata?.semanticIntegrity,
        operationsApplied: processResult.metadata?.operationsApplied,
      };
    } catch (error) {
      this.logger.error('Cortex core processing failed in handshake', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        processed: false,
        tokensUsed: Math.ceil(prompt.length / 4) || 100,
        processingTime: Date.now() - session.createdAt.getTime(),
        quality: 'low',
        optimizations: [],
        error:
          error instanceof Error ? error.message : 'Cortex processing failed',
      };
    }
  }

  /**
   * Finalize session
   */
  /**
   * Finalize session
   * @param session The handshake session to finalize
   * @param request The request data associated with the session
   * @returns An object containing the final session summary and relevant request info
   */
  private async finalizeSession(
    session: HandshakeSession,
    request: any,
  ): Promise<any> {
    const processingResult = session.currentState.data.get('processingResult');

    // Include information from request for better traceability.
    // For example, echo back requestId and user if present.
    // (You may adjust the list depending on what 'request' contains in your app.)
    const requestSummary =
      request && typeof request === 'object'
        ? {
            requestId: request.requestId ?? undefined,
            user: request.user ?? undefined,
            source: request.source ?? undefined,
          }
        : {};

    return {
      sessionId: session.id,
      totalTime: Date.now() - session.createdAt.getTime(),
      steps: session.history.length,
      finalResult: processingResult,
      request: requestSummary,
      summary: {
        phases: session.currentState.phase,
        confidence: session.currentState.confidence,
        errors: session.currentState.errors.length,
        dataPoints: Array.from(session.currentState.data.keys()),
      },
    };
  }

  /**
   * Check if session is still valid
   */
  isSessionValid(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    return session.expiresAt > new Date();
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
        cleaned++;

        this.logger.log('Cleaned up expired handshake session', {
          sessionId,
          age: now.getTime() - session.createdAt.getTime(),
        });
      }
    }

    if (cleaned > 0) {
      this.logger.log('Cleaned up expired handshake sessions', {
        count: cleaned,
      });
    }
  }

  /**
   * Get session history
   */
  getHistory(sessionId: string): HandshakeStep[] {
    const session = this.sessions.get(sessionId);
    return session?.history || [];
  }

  /**
   * Get session metadata
   */
  getMetadata(sessionId: string, key: string): any {
    const session = this.sessions.get(sessionId);
    return session?.metadata.get(key);
  }

  /**
   * Set session metadata
   */
  setMetadata(sessionId: string, key: string, value: any): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.metadata.set(key, value);
      session.updatedAt = new Date();
    }
  }
}
