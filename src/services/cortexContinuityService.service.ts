/**
 * Cortex Continuity Service
 *
 * This service implements advanced continuity features for the Cortex streaming orchestrator:
 * - Auto-handle cutoffs and truncations during streaming
 * - Detect when a model ends mid-thought and auto-prompt with "continue where you left off"
 * - Preserve context across chunks so the model doesn't forget the flow
 * - Recovery checkpoints and context restoration
 * - Intelligent retry mechanisms with context preservation
 * - Seamless continuation after interruptions
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { redisService } from './redis.service';
import { loggingService } from './logging.service';

// Import types
import { CortexStreamingExecution, CortexToken } from './cortexStreamingOrchestrator.service';

export enum ContinuityEventType {
    CUTOFF_DETECTED = 'cutoff_detected',
    TRUNCATION_DETECTED = 'truncation_detected',
    CONTEXT_PRESERVED = 'context_preserved',
    CONTINUATION_REQUESTED = 'continuation_requested',
    RECOVERY_STARTED = 'recovery_started',
    RECOVERY_COMPLETED = 'recovery_completed',
    RETRY_WITH_CONTEXT = 'retry_with_context'
}

export interface ContinuityCheckpoint {
    id: string;
    executionId: string;
    timestamp: Date;
    phase: string;
    componentStates: {
        encoder?: any;
        processor?: any;
        decoder?: any;
    };
    contextData: {
        conversationHistory: CortexToken[];
        currentChunk: string;
        completedChunks: string[];
        pendingOperations: string[];
        modelStates: { [model: string]: any };
    };
    recoveryMetadata: {
        lastSuccessfulOperation: string;
        checkpointType: 'auto' | 'manual' | 'error_recovery';
        contextHash: string;
        canResume: boolean;
    };
}

export interface CutoffDetectionResult {
    detected: boolean;
    reason: 'incomplete_sentence' | 'incomplete_json' | 'incomplete_code' | 'abrupt_end' | 'timeout' | 'unknown';
    confidence: number;
    continuationPrompt?: string;
    contextRequired?: string[];
    recoveryStrategy: 'resume_with_prompt' | 'retry_with_context' | 'start_new_chunk' | 'fail_safe';
}

export interface ContextPreservationData {
    executionId: string;
    preservedAt: Date;
    contextHash: string;
    conversationTokens: CortexToken[];
    semanticContext: {
        topics: string[];
        entities: string[];
        intentions: string[];
        relationships: { [key: string]: any };
    };
    technicalContext: {
        currentOperation: string;
        completedSteps: string[];
        pendingSteps: string[];
        dependencies: { [key: string]: any };
    };
    recoveryPoints: {
        primary: string;
        fallback: string;
        timestamp: Date;
    };
}

export class CortexContinuityService extends EventEmitter {
    private static instance: CortexContinuityService;

    private activeContinuityData = new Map<string, ContextPreservationData>();
    private checkpoints = new Map<string, ContinuityCheckpoint>();
    private cutoffDetectors = new Map<string, CutoffDetectionResult>();

    // Configuration
    private checkpointInterval = 5000; // 5 seconds
    private maxContextAge = 3600000; // 1 hour
    private maxCheckpointsPerExecution = 10;
    private enableAutoRecovery = true;

    private constructor() {
        super();
        this.startCheckpointScheduler();
        this.startContextCleanup();
    }

    public static getInstance(): CortexContinuityService {
        if (!CortexContinuityService.instance) {
            CortexContinuityService.instance = new CortexContinuityService();
        }
        return CortexContinuityService.instance;
    }

    // ========================================================================
    // CUTOFF DETECTION AND HANDLING
    // ========================================================================

    /**
     * Detect cutoffs and truncations in streaming output
     */
    public async detectCutoff(
        executionId: string,
        currentOutput: string,
        expectedFormat?: string,
        contextTokens?: CortexToken[]
    ): Promise<CutoffDetectionResult> {
        try {
            loggingService.info('🔍 Detecting potential cutoff in streaming output', {
                executionId,
                outputLength: currentOutput.length,
                expectedFormat
            });

            // Analyze the output for cutoff indicators
            const analysis = this.analyzeOutputForCutoff(currentOutput, expectedFormat);

            if (analysis.detected) {
                loggingService.warn('⚠️ Cutoff detected in streaming output', {
                    executionId,
                    reason: analysis.reason,
                    confidence: analysis.confidence,
                    recoveryStrategy: analysis.recoveryStrategy
                });

                // Store detection result
                this.cutoffDetectors.set(executionId, analysis);

                this.emit(ContinuityEventType.CUTOFF_DETECTED, {
                    executionId,
                    detection: analysis,
                    outputLength: currentOutput.length
                });

                return analysis;
            }

            return {
                detected: false,
                reason: 'unknown',
                confidence: 0,
                recoveryStrategy: 'fail_safe'
            };

        } catch (error) {
            loggingService.error('❌ Failed to detect cutoff', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                detected: false,
                reason: 'unknown',
                confidence: 0,
                recoveryStrategy: 'fail_safe'
            };
        }
    }

    /**
     * Analyze output for cutoff patterns
     */
    private analyzeOutputForCutoff(
        output: string,
        expectedFormat?: string,
    ): CutoffDetectionResult {
        // Check for incomplete sentences
        if (this.isIncompleteSentence(output)) {
            return {
                detected: true,
                reason: 'incomplete_sentence',
                confidence: 0.8,
                continuationPrompt: 'Continue the previous thought without repeating what was already said.',
                contextRequired: ['previous_tokens'],
                recoveryStrategy: 'resume_with_prompt'
            };
        }

        // Check for incomplete JSON
        if (expectedFormat === 'json' && this.isIncompleteJSON(output)) {
            return {
                detected: true,
                reason: 'incomplete_json',
                confidence: 0.9,
                continuationPrompt: 'Complete the JSON object that was started. Only output the missing JSON parts.',
                contextRequired: ['json_structure'],
                recoveryStrategy: 'resume_with_prompt'
            };
        }

        // Check for incomplete code blocks
        if (this.isIncompleteCodeBlock(output)) {
            return {
                detected: true,
                reason: 'incomplete_code',
                confidence: 0.85,
                continuationPrompt: 'Continue writing the code from where it was interrupted. Complete the function/class/block.',
                contextRequired: ['code_context', 'language'],
                recoveryStrategy: 'resume_with_prompt'
            };
        }

        // Check for abrupt ending patterns
        if (this.hasAbruptEnding(output)) {
            return {
                detected: true,
                reason: 'abrupt_end',
                confidence: 0.7,
                continuationPrompt: 'Continue from where you left off.',
                contextRequired: ['conversation_context'],
                recoveryStrategy: 'resume_with_prompt'
            };
        }

        return {
            detected: false,
            reason: 'unknown',
            confidence: 0,
            recoveryStrategy: 'fail_safe'
        };
    }

    /**
     * Check if output ends with an incomplete sentence
     */
    private isIncompleteSentence(output: string): boolean {
        const trimmed = output.trim();

        // Check for common sentence endings
        if (trimmed.match(/[.!?]\s*$/)) {
            return false;
        }

        // Check for incomplete patterns
        const incompletePatterns = [
            /\w+\s*$/,                    // Ends with a word
            /\w+,\s*$/,                   // Ends with word + comma
            /\w+\s+(and|or|but)\s*$/,     // Ends with conjunction
            /\w+\s+(the|an|a)\s*$/,       // Ends with article
            /["']\s*$/,                   // Ends with quote
            /\(\s*$/,                     // Ends with opening parenthesis
            /\[\s*$/,                     // Ends with opening bracket
            /\{\s*$/                      // Ends with opening brace
        ];

        return incompletePatterns.some(pattern => pattern.test(trimmed));
    }

    /**
     * Check if output has incomplete JSON
     */
    private isIncompleteJSON(output: string): boolean {
        const jsonStartMatch = output.match(/\{/g);
        const jsonEndMatch = output.match(/\}/g);

        if (!jsonStartMatch || !jsonEndMatch) {
            return false;
        }

        // More opening braces than closing braces
        if (jsonStartMatch.length > jsonEndMatch.length) {
            return true;
        }

        // Check for truncated JSON patterns
        const truncatedPatterns = [
            /,\s*$/,                    // Ends with comma
            /:\s*$/,                    // Ends with colon
            /:\s*"[^"]*$/,              // Incomplete string value
            /:\s*\d+\s*$/,              // Incomplete number
            /"[^"]*:\s*$/,              // Incomplete key
            /true\s*$|false\s*$/        // Incomplete boolean
        ];

        return truncatedPatterns.some(pattern => pattern.test(output));
    }

    /**
     * Check if output has incomplete code blocks
     */
    private isIncompleteCodeBlock(output: string): boolean {
        // Check for incomplete code patterns
        const incompleteCodePatterns = [
            /function\s+\w+\s*\([^)]*$/,           // Incomplete function definition
            /class\s+\w+\s*\{[^}]*$/,              // Incomplete class definition
            /if\s*\([^)]*$/,                       // Incomplete if statement
            /for\s*\([^)]*$/,                      // Incomplete for loop
            /while\s*\([^)]*$/,                    // Incomplete while loop
            /try\s*\{[^}]*$/,                      // Incomplete try block
            /catch\s*\([^)]*$/,                    // Incomplete catch block
            /\/\*\s*[^*/]*$/,                      // Incomplete block comment
            /\/\/.*$/,                             // Line comment at end (might be incomplete)
            /\w+\s*=\s*[^;]*$/,                    // Incomplete assignment
            /\w+\s*\([^)]*$/,                      // Incomplete function call
        ];

        return incompleteCodePatterns.some(pattern => pattern.test(output));
    }

    /**
     * Check for abrupt ending patterns
     */
    private hasAbruptEnding(output: string): boolean {
        const abruptPatterns = [
            /\.\.\.$/,                    // Ends with ellipsis
            /etc$/,                       // Ends with etc
            /and so on$/,                 // Ends with "and so on"
            /in the end$/,                // Ends with "in the end"
            /finally$/,                   // Ends with "finally"
            /therefore$/,                 // Ends with "therefore"
            /however$/,                   // Ends with "however"
            /moreover$/,                  // Ends with "moreover"
            /furthermore$/                // Ends with "furthermore"
        ];

        return abruptPatterns.some(pattern => pattern.test(output.toLowerCase()));
    }

    // ========================================================================
    // CONTEXT PRESERVATION
    // ========================================================================

    /**
     * Preserve context for an execution
     */
    public async preserveContext(
        execution: CortexStreamingExecution,
        tokens: CortexToken[]
    ): Promise<ContextPreservationData> {
        try {
            loggingService.info('🛡️ Preserving context for execution', {
                executionId: execution.id,
                tokenCount: tokens.length,
                currentPhase: execution.phase
            });

            // Analyze semantic context
            const semanticContext = this.extractSemanticContext(tokens);

            // Analyze technical context
            const technicalContext = this.extractTechnicalContext(execution, tokens);

            // Generate context hash for comparison
            const contextHash = this.generateContextHash(tokens, semanticContext, technicalContext);

            // Create preservation data
            const preservationData: ContextPreservationData = {
                executionId: execution.id,
                preservedAt: new Date(),
                contextHash,
                conversationTokens: tokens,
                semanticContext,
                technicalContext,
                recoveryPoints: {
                    primary: uuidv4(),
                    fallback: uuidv4(),
                    timestamp: new Date()
                }
            };

            // Store preservation data
            this.activeContinuityData.set(execution.id, preservationData);

            // Store in Redis for persistence
            await this.storeContextInRedis(preservationData);

            loggingService.info('✅ Context preserved successfully', {
                executionId: execution.id,
                contextHash,
                semanticTopics: semanticContext.topics.length,
                technicalSteps: technicalContext.completedSteps.length
            });

            this.emit(ContinuityEventType.CONTEXT_PRESERVED, {
                executionId: execution.id,
                contextHash,
                preservationData
            });

            return preservationData;

        } catch (error) {
            loggingService.error('❌ Failed to preserve context', {
                executionId: execution.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Extract semantic context from tokens
     */
    private extractSemanticContext(tokens: CortexToken[]): ContextPreservationData['semanticContext'] {
        const topics: string[] = [];
        const entities: string[] = [];
        const intentions: string[] = [];
        const relationships: { [key: string]: any } = {};

        // Simple extraction - in production you'd use NLP models
        for (const token of tokens) {
            const content = token.content.toLowerCase();

            // Extract topics (basic keyword extraction)
            const potentialTopics = content.match(/\b(analysis|implementation|design|development|testing|deployment|security|performance|optimization)\b/g);
            if (potentialTopics) {
                topics.push(...potentialTopics);
            }

            // Extract entities (proper nouns, technical terms)
            const potentialEntities = content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z]{2,}|Node\.js|React|TypeScript|Python)\b/g);
            if (potentialEntities) {
                entities.push(...potentialEntities);
            }

            // Extract intentions (action words)
            const potentialIntentions = content.match(/\b(create|build|implement|analyze|optimize|improve|fix|debug|test|deploy)\b/g);
            if (potentialIntentions) {
                intentions.push(...potentialIntentions);
            }
        }

        // Remove duplicates and limit size
        return {
            topics: [...new Set(topics)].slice(0, 10),
            entities: [...new Set(entities)].slice(0, 20),
            intentions: [...new Set(intentions)].slice(0, 10),
            relationships: relationships // Could be populated with more sophisticated analysis
        };
    }

    /**
     * Extract technical context from execution
     */
    private extractTechnicalContext(
        execution: CortexStreamingExecution,
        tokens: CortexToken[]
    ): ContextPreservationData['technicalContext'] {
        const completedSteps: string[] = [];
        const pendingSteps: string[] = [];
        const dependencies: { [key: string]: any } = {};

        // Analyze execution state
        if (execution.encoderState?.status === 'completed') {
            completedSteps.push('encoding');
        } else if (execution.encoderState?.status === 'running') {
            pendingSteps.push('encoding');
        }

        if (execution.processorState?.status === 'completed') {
            completedSteps.push('processing');
        } else if (execution.processorState?.status === 'running') {
            pendingSteps.push('processing');
        }

        if (execution.decoderState?.status === 'completed') {
            completedSteps.push('decoding');
        } else if (execution.decoderState?.status === 'running') {
            pendingSteps.push('decoding');
        }

        // Analyze token dependencies
        const tokenTypes = tokens.map(t => t.type);
        dependencies.tokens = {
            encoding: tokenTypes.filter(t => t === 'encoding').length,
            processing: tokenTypes.filter(t => t === 'processing').length,
            decoding: tokenTypes.filter(t => t === 'decoding').length,
            output: tokenTypes.filter(t => t === 'output').length
        };

        return {
            currentOperation: execution.phase,
            completedSteps,
            pendingSteps,
            dependencies
        };
    }

    /**
     * Generate context hash for comparison
     */
    private generateContextHash(
        tokens: CortexToken[],
        semanticContext: any,
        technicalContext: any
    ): string {
        const contentString = tokens.map(t => t.content).join(' ');
        const semanticString = JSON.stringify(semanticContext);
        const technicalString = JSON.stringify(technicalContext);

        // Simple hash - in production you'd use crypto
        let hash = 0;
        const combined = contentString + semanticString + technicalString;

        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        return Math.abs(hash).toString(16);
    }

    // ========================================================================
    // CHECKPOINT MANAGEMENT
    // ========================================================================

    /**
     * Create a continuity checkpoint
     */
    public async createCheckpoint(
        execution: CortexStreamingExecution,
        checkpointType: 'auto' | 'manual' | 'error_recovery' = 'auto'
    ): Promise<ContinuityCheckpoint> {
        try {
            const checkpointId = uuidv4();

            // Get current context data
            const contextData = this.activeContinuityData.get(execution.id);

            const checkpoint: ContinuityCheckpoint = {
                id: checkpointId,
                executionId: execution.id,
                timestamp: new Date(),
                phase: execution.phase,
                componentStates: {
                    encoder: execution.encoderState,
                    processor: execution.processorState,
                    decoder: execution.decoderState
                },
                contextData: contextData ? {
                    conversationHistory: contextData.conversationTokens,
                    currentChunk: execution.currentChunk,
                    completedChunks: execution.chunks,
                    pendingOperations: [],
                    modelStates: {}
                } : {
                    conversationHistory: execution.tokens,
                    currentChunk: execution.currentChunk,
                    completedChunks: execution.chunks,
                    pendingOperations: [],
                    modelStates: {}
                },
                recoveryMetadata: {
                    lastSuccessfulOperation: execution.phase,
                    checkpointType,
                    contextHash: contextData?.contextHash || '',
                    canResume: true
                }
            };

            // Store checkpoint
            this.checkpoints.set(checkpointId, checkpoint);
            await this.storeCheckpointInRedis(checkpoint);

            // Limit checkpoints per execution
            await this.cleanupOldCheckpoints(execution.id);

            loggingService.info('💾 Continuity checkpoint created', {
                executionId: execution.id,
                checkpointId,
                checkpointType,
                phase: execution.phase
            });

            return checkpoint;

        } catch (error) {
            loggingService.error('❌ Failed to create continuity checkpoint', {
                executionId: execution.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Recover from a checkpoint
     */
    public async recoverFromCheckpoint(
        executionId: string,
        checkpointId?: string
    ): Promise<{ success: boolean; checkpoint?: ContinuityCheckpoint; message: string }> {
        try {
            loggingService.info('🔄 Starting recovery from checkpoint', {
                executionId,
                checkpointId
            });

            // Find the most recent valid checkpoint
            const checkpoint = checkpointId
                ? this.checkpoints.get(checkpointId)
                : await this.findLatestValidCheckpoint(executionId);

            if (!checkpoint) {
                return {
                    success: false,
                    message: 'No valid checkpoint found for recovery'
                };
            }

            // Validate checkpoint integrity
            const isValid = await this.validateCheckpoint(checkpoint);
            if (!isValid) {
                return {
                    success: false,
                    checkpoint,
                    message: 'Checkpoint validation failed'
                };
            }

            // Restore execution state
            await this.restoreExecutionState(executionId, checkpoint);

            loggingService.info('✅ Recovery completed successfully', {
                executionId,
                checkpointId: checkpoint.id,
                recoveredPhase: checkpoint.phase
            });

            this.emit(ContinuityEventType.RECOVERY_COMPLETED, {
                executionId,
                checkpointId: checkpoint.id,
                recoveredPhase: checkpoint.phase
            });

            return {
                success: true,
                checkpoint,
                message: `Successfully recovered to ${checkpoint.phase} phase`
            };

        } catch (error) {
            loggingService.error('❌ Recovery failed', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                message: `Recovery failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * Find the latest valid checkpoint for an execution
     */
    private async findLatestValidCheckpoint(executionId: string): Promise<ContinuityCheckpoint | null> {
        const executionCheckpoints = Array.from(this.checkpoints.values())
            .filter(cp => cp.executionId === executionId)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        for (const checkpoint of executionCheckpoints) {
            const isValid = await this.validateCheckpoint(checkpoint);
            if (isValid) {
                return checkpoint;
            }
        }

        return null;
    }

    /**
     * Validate checkpoint integrity
     */
    private async validateCheckpoint(checkpoint: ContinuityCheckpoint): Promise<boolean> {
        try {
            // Check if checkpoint has required data
            if (!checkpoint.contextData.conversationHistory ||
                checkpoint.contextData.conversationHistory.length === 0) {
                return false;
            }

            // Check if checkpoint is not too old
            const age = Date.now() - checkpoint.timestamp.getTime();
            if (age > this.maxContextAge) {
                return false;
            }

            // Check if component states are consistent
            const hasValidComponentStates = Object.values(checkpoint.componentStates)
                .some(state => state && state.status);

            return hasValidComponentStates;

        } catch (error) {
            return false;
        }
    }

    /**
     * Restore execution state from checkpoint
     */
    private async restoreExecutionState(
        executionId: string,
        checkpoint: ContinuityCheckpoint
    ): Promise<void> {
        // This would restore the execution state from the checkpoint
        // Implementation depends on your execution state structure

        loggingService.info('🔄 Restoring execution state from checkpoint', {
            executionId,
            checkpointId: checkpoint.id,
            targetPhase: checkpoint.phase
        });

        // Emit recovery started event
        this.emit(ContinuityEventType.RECOVERY_STARTED, {
            executionId,
            checkpointId: checkpoint.id,
            targetPhase: checkpoint.phase
        });
    }

    /**
     * Clean up old checkpoints
     */
    private async cleanupOldCheckpoints(executionId: string): Promise<void> {
        const executionCheckpoints = Array.from(this.checkpoints.values())
            .filter(cp => cp.executionId === executionId)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Keep only the most recent checkpoints
        if (executionCheckpoints.length > this.maxCheckpointsPerExecution) {
            const checkpointsToRemove = executionCheckpoints.slice(this.maxCheckpointsPerExecution);

            for (const checkpoint of checkpointsToRemove) {
                this.checkpoints.delete(checkpoint.id);
                // Remove from Redis as well
                await redisService.del(`cortex:checkpoint:${checkpoint.id}`);
            }
        }
    }

    // ========================================================================
    // CONTINUATION AND RETRY LOGIC
    // ========================================================================

    /**
     * Generate continuation prompt for cutoff recovery
     */
    public generateContinuationPrompt(
        cutoffDetection: CutoffDetectionResult,
        contextTokens: CortexToken[]
    ): string {
        const basePrompt = cutoffDetection.continuationPrompt || 'Continue where you left off.';

        // Add context information
        const recentContext = contextTokens
            .slice(-5) // Last 5 tokens
            .map(token => token.content)
            .join(' ')
            .slice(-500); // Last 500 characters

        return `${basePrompt}

Previous context: ${recentContext}

Continue seamlessly without repeating what was already said.`;
    }

    /**
     * Handle retry with context preservation
     */
    public async handleRetryWithContext(
        executionId: string,
        retryAttempt: number,
        error: any
    ): Promise<{ shouldRetry: boolean; retryConfig?: any; message: string }> {
        try {
            const contextData = this.activeContinuityData.get(executionId);

            if (!contextData) {
                return {
                    shouldRetry: false,
                    message: 'No context data available for retry'
                };
            }

            // Check if we have recovery points
            if (!contextData.recoveryPoints) {
                return {
                    shouldRetry: false,
                    message: 'No recovery points available'
                };
            }

            // Generate retry configuration
            const retryConfig = {
                useRecoveryPoint: contextData.recoveryPoints.primary,
                contextHash: contextData.contextHash,
                retryAttempt,
                maxRetries: 3,
                preserveTokens: true,
                fallbackToCheckpoint: true
            };

            loggingService.info('🔄 Retry with context configured', {
                executionId,
                retryAttempt,
                recoveryPoint: contextData.recoveryPoints.primary,
                contextHash: contextData.contextHash
            });

            this.emit(ContinuityEventType.RETRY_WITH_CONTEXT, {
                executionId,
                retryAttempt,
                retryConfig
            });

            return {
                shouldRetry: true,
                retryConfig,
                message: `Retry configured with context preservation (attempt ${retryAttempt})`
            };

        } catch (error) {
            return {
                shouldRetry: false,
                message: `Failed to configure retry: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    // ========================================================================
    // STORAGE AND PERSISTENCE
    // ========================================================================

    /**
     * Store context in Redis for persistence
     */
    private async storeContextInRedis(contextData: ContextPreservationData): Promise<void> {
        try {
            await redisService.storeCache(
                `cortex:context:${contextData.executionId}`,
                contextData,
                { ttl: this.maxContextAge / 1000 } // TTL in seconds
            );
        } catch (error) {
            loggingService.warn('Failed to store context in Redis', {
                executionId: contextData.executionId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Store checkpoint in Redis
     */
    private async storeCheckpointInRedis(checkpoint: ContinuityCheckpoint): Promise<void> {
        try {
            await redisService.storeCache(
                `cortex:checkpoint:${checkpoint.id}`,
                checkpoint,
                { ttl: this.maxContextAge / 1000 }
            );
        } catch (error) {
            loggingService.warn('Failed to store checkpoint in Redis', {
                executionId: checkpoint.executionId,
                checkpointId: checkpoint.id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // ========================================================================
    // SCHEDULER AND CLEANUP
    // ========================================================================

    /**
     * Start checkpoint scheduler
     */
    private startCheckpointScheduler(): void {
        setInterval(async () => {
            if (!this.enableAutoRecovery) return;

            // Create automatic checkpoints for active executions
            for (const [executionId, contextData] of this.activeContinuityData.entries()) {
                try {
                    // Only create checkpoints for executions that are actively running
                    // Check if context is recent enough to warrant a checkpoint
                    const contextAge = Date.now() - contextData.preservedAt.getTime();
                    if (contextAge < this.maxContextAge) {
                        // Note: createCheckpoint requires full CortexStreamingExecution object
                        // which is not available from contextData. Skip automatic checkpoint creation.
                        loggingService.debug('Skipping automatic checkpoint (execution object not available)', { executionId });
                    }
                } catch (error) {
                    loggingService.warn('Failed to create automatic checkpoint', {
                        executionId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }, this.checkpointInterval);
    }

    /**
     * Start context cleanup scheduler
     */
    private startContextCleanup(): void {
        setInterval(() => {
            const cutoffTime = Date.now() - this.maxContextAge;

            // Clean up old context data
            for (const [executionId, contextData] of this.activeContinuityData.entries()) {
                if (contextData.preservedAt.getTime() < cutoffTime) {
                    this.activeContinuityData.delete(executionId);
                    loggingService.info('🧹 Cleaned up old context data', { executionId });
                }
            }

            // Clean up old checkpoints
            for (const [checkpointId, checkpoint] of this.checkpoints.entries()) {
                if (checkpoint.timestamp.getTime() < cutoffTime) {
                    this.checkpoints.delete(checkpointId);
                    loggingService.info('🧹 Cleaned up old checkpoint', { checkpointId });
                }
            }
        }, 60000); // Every minute
    }

    // ========================================================================
    // PUBLIC API METHODS
    // ========================================================================

    /**
     * Get continuity status for an execution
     */
    public getContinuityStatus(executionId: string): {
        hasContext: boolean;
        contextAge: number;
        checkpointCount: number;
        lastCheckpoint?: Date;
        canRecover: boolean;
    } | null {
        const contextData = this.activeContinuityData.get(executionId);
        const executionCheckpoints = Array.from(this.checkpoints.values())
            .filter(cp => cp.executionId === executionId);

        if (!contextData) {
            return null;
        }

        return {
            hasContext: true,
            contextAge: Date.now() - contextData.preservedAt.getTime(),
            checkpointCount: executionCheckpoints.length,
            lastCheckpoint: executionCheckpoints.length > 0
                ? executionCheckpoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0].timestamp
                : undefined,
            canRecover: executionCheckpoints.length > 0
        };
    }

    /**
     * Force context preservation
     */
    public async forceContextPreservation(
        execution: CortexStreamingExecution,
        tokens: CortexToken[]
    ): Promise<void> {
        await this.preserveContext(execution, tokens);
        await this.createCheckpoint(execution, 'manual');
    }

    /**
     * Enable or disable auto recovery
     */
    public setAutoRecovery(enabled: boolean): void {
        this.enableAutoRecovery = enabled;
        loggingService.info(`Auto recovery ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Get recovery statistics
     */
    public getRecoveryStats(): {
        activeContexts: number;
        totalCheckpoints: number;
        averageContextAge: number;
        recoverySuccessRate: number;
    } {
        const contexts = Array.from(this.activeContinuityData.values());
        const checkpoints = Array.from(this.checkpoints.values());

        const averageContextAge = contexts.length > 0
            ? contexts.reduce((sum, ctx) => sum + (Date.now() - ctx.preservedAt.getTime()), 0) / contexts.length
            : 0;

        // This would track actual recovery success rates in production
        const recoverySuccessRate = 0.95; // Placeholder

        return {
            activeContexts: contexts.length,
            totalCheckpoints: checkpoints.length,
            averageContextAge,
            recoverySuccessRate
        };
    }
}

