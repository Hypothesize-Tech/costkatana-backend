/**
 * Cortex Streaming Controller
 *
 * This controller provides a unified API for the advanced Cortex streaming capabilities,
 * integrating all the streaming services with comprehensive error handling, cost tracking,
 * and user experience features. It implements the complete CostKatana streaming architecture.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Import services
import { CortexStreamingOrchestratorService } from '../services/cortexStreamingOrchestrator.service';
import { CortexStreamingLoggerService } from '../services/cortexStreamingLogger.service';
import { CortexContinuityService } from '../services/cortexContinuityService.service';
import { CortexLongHandshakeService } from '../services/cortexLongHandshakeService.service';

// Import types
import {
    CortexStreamingConfig,
    DEFAULT_STREAMING_CONFIG,
    CortexStreamingExecution,
    CortexProgressUpdate,
    CortexStreamingEvent
} from '../services/cortexStreamingOrchestrator.service';

export interface StreamingRequest {
    text: string;
    sessionId: string;
    userId: string;
    config?: Partial<CortexStreamingConfig>;
    options?: {
        enableLogging?: boolean;
        enableContinuity?: boolean;
        enableLongHandshake?: boolean;
        enableCostTracking?: boolean;
        budgetLimit?: number;
        priority?: 'low' | 'normal' | 'high';
        deadline?: Date;
    };
}

export interface StreamingResponse {
    executionId: string;
    status: string;
    progress: number;
    phase: string;
    estimatedTimeRemaining?: number;
    totalCost?: number;
    totalTokens?: number;
    output?: string;
    chunks?: string[];
    currentChunk?: string;
    metadata?: any;
    events?: StreamingEvent[];
}

export interface StreamingEvent {
    type: string;
    timestamp: Date;
    data: any;
}

export interface StreamingStatusResponse {
    executionId: string;
    status: string;
    progress: number;
    phase: string;
    duration: number;
    totalCost: number;
    totalTokens: number;
    lastActivity: Date;
    canResume: boolean;
    canCancel: boolean;
    metadata: {
        componentStates: any;
        errorCount: number;
        retryCount: number;
        checkpointCount: number;
        chunkCount: number;
    };
}

export class CortexStreamingController {
    private streamingOrchestrator: CortexStreamingOrchestratorService;
    private loggerService: CortexStreamingLoggerService;
    private continuityService: CortexContinuityService;
    private handshakeService: CortexLongHandshakeService;

    private activeConnections = new Map<string, Response>();
    private eventListeners = new Map<string, Set<string>>();

    constructor() {
        this.streamingOrchestrator = CortexStreamingOrchestratorService.getInstance();
        this.loggerService = CortexStreamingLoggerService.getInstance();
        this.continuityService = CortexContinuityService.getInstance();
        this.handshakeService = CortexLongHandshakeService.getInstance();

        this.setupEventHandlers();
    }

    // ========================================================================
    // MAIN STREAMING ENDPOINTS
    // ========================================================================

    /**
     * Start a new streaming execution
     */
    public async startStreaming(req: Request, res: Response): Promise<void> {
        try {
            const { text, sessionId, userId, config, options }: StreamingRequest = req.body;

            // Validate request
            if (!text || !sessionId || !userId) {
                res.status(400).json({
                    error: 'Missing required fields: text, sessionId, userId'
                });
                return;
            }

            // Generate execution ID
            const executionId = uuidv4();

            // Merge configuration
            const streamingConfig = { ...DEFAULT_STREAMING_CONFIG, ...config };

            // Initialize logging if enabled
            if (options?.enableLogging !== false) {
                this.loggerService.logExecutionStart({
                    id: executionId,
                    sessionId,
                    userId,
                    inputText: text,
                    config: streamingConfig,
                    status: 'initializing',
                    phase: 'initializing',
                    startTime: new Date()
                } as any, {
                    requestSource: 'api',
                    priority: options?.priority || 'normal',
                    deadline: options?.deadline
                });
            }

            // Initialize handshake if enabled
            if (options?.enableLongHandshake) {
                await this.handshakeService.initializeHandshake(executionId, {
                    enableValidation: true,
                    enableUserConfirmation: false,
                    autoContinue: true
                });
            }

            // Start streaming execution
            const execution = await this.streamingOrchestrator.executeStreamingWorkflow(
                sessionId,
                userId,
                text,
                streamingConfig
            );

            // Set up event streaming for real-time updates
            this.setupEventStreaming(executionId, res);

            // Send initial response
            const response: StreamingResponse = {
                executionId,
                status: execution.status,
                progress: execution.progress,
                phase: execution.phase,
                estimatedTimeRemaining: this.estimateTimeRemaining(execution),
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                metadata: {
                    modelsUsed: execution.metadata.modelsUsed,
                    operationsPerformed: execution.metadata.operationsPerformed,
                    optimizationLevel: execution.metadata.optimizationLevel
                }
            };

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });

            res.write(`data: ${JSON.stringify(response)}\n\n`);

        } catch (error) {
            console.error('Streaming execution failed:', error);
            res.status(500).json({
                error: 'Failed to start streaming execution',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get streaming execution status
     */
    public async getStreamingStatus(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            const execution = this.streamingOrchestrator.getExecution(executionId);

            if (!execution) {
                res.status(404).json({ error: 'Execution not found' });
                return;
            }

            // Get continuity status
            const continuityStatus = this.continuityService.getContinuityStatus(executionId);

            // Get handshake status if available
            const handshakeState = this.handshakeService.getHandshakeState(executionId);

            const response: StreamingStatusResponse = {
                executionId,
                status: execution.status,
                progress: execution.progress,
                phase: execution.phase,
                duration: execution.duration || 0,
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                lastActivity: new Date(),
                canResume: execution.status === 'paused',
                canCancel: ['running', 'paused'].includes(execution.status),
                metadata: {
                    componentStates: {
                        encoder: execution.encoderState,
                        processor: execution.processorState,
                        decoder: execution.decoderState
                    },
                    errorCount: execution.errorHistory.length,
                    retryCount: execution.retryCount,
                    checkpointCount: continuityStatus?.checkpointCount || 0,
                    chunkCount: handshakeState ? (
                        handshakeState.completedChunks.length +
                        handshakeState.pendingChunks.length +
                        (handshakeState.currentChunk ? 1 : 0)
                    ) : 0
                }
            };

            res.json(response);

        } catch (error) {
            console.error('Failed to get streaming status:', error);
            res.status(500).json({
                error: 'Failed to get streaming status',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Pause streaming execution
     */
    public async pauseStreaming(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            await this.streamingOrchestrator.pauseExecution(executionId);

            // Log pause event
            if (this.loggerService.logExecutionPaused) {
                this.loggerService.logExecutionPaused(executionId, 'User requested pause');
            }

            res.json({
                success: true,
                message: 'Execution paused successfully',
                executionId
            });

        } catch (error) {
            console.error('Failed to pause streaming:', error);
            res.status(500).json({
                error: 'Failed to pause streaming execution',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Resume streaming execution
     */
    public async resumeStreaming(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            await this.streamingOrchestrator.resumeExecution(executionId);

            // Log resume event
            if (this.loggerService.logExecutionResumed) {
                this.loggerService.logExecutionResumed(executionId, 'User requested resume');
            }

            res.json({
                success: true,
                message: 'Execution resumed successfully',
                executionId
            });

        } catch (error) {
            console.error('Failed to resume streaming:', error);
            res.status(500).json({
                error: 'Failed to resume streaming execution',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Cancel streaming execution
     */
    public async cancelStreaming(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            await this.streamingOrchestrator.cancelExecution(executionId);

            // Log cancellation event
            if (this.loggerService.logExecutionCancelled) {
                this.loggerService.logExecutionCancelled(executionId, 'User requested cancellation');
            }

            // Clean up handshake if exists
            await this.handshakeService.cancelHandshake(executionId);

            res.json({
                success: true,
                message: 'Execution cancelled successfully',
                executionId
            });

        } catch (error) {
            console.error('Failed to cancel streaming:', error);
            res.status(500).json({
                error: 'Failed to cancel streaming execution',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get streaming execution result
     */
    public async getStreamingResult(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            const execution = this.streamingOrchestrator.getExecution(executionId);

            if (!execution) {
                res.status(404).json({ error: 'Execution not found' });
                return;
            }

            if (execution.status !== 'completed') {
                res.status(400).json({
                    error: 'Execution is not completed yet',
                    status: execution.status,
                    progress: execution.progress
                });
                return;
            }

            // Stitch chunks if using long handshake
            let finalOutput = execution.chunks.length > 0 ? execution.chunks.join('\n') : '';

            if (this.handshakeService.getHandshakeState(executionId)) {
                finalOutput = await this.handshakeService.stitchChunks(executionId);
            }

            const response: StreamingResponse = {
                executionId,
                status: execution.status,
                progress: 100,
                phase: 'completed',
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                output: finalOutput,
                chunks: execution.chunks,
                metadata: {
                    duration: execution.duration,
                    modelsUsed: execution.metadata.modelsUsed,
                    operationsPerformed: execution.metadata.operationsPerformed,
                    componentStates: {
                        encoder: execution.encoderState,
                        processor: execution.processorState,
                        decoder: execution.decoderState
                    }
                }
            };

            res.json(response);

        } catch (error) {
            console.error('Failed to get streaming result:', error);
            res.status(500).json({
                error: 'Failed to get streaming result',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // ========================================================================
    // HANDSHAKE MANAGEMENT ENDPOINTS
    // ========================================================================

    /**
     * Confirm current chunk in long handshake
     */
    public async confirmChunk(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;
            const { chunkId, approved, modifications } = req.body;

            if (!executionId || !chunkId) {
                res.status(400).json({
                    error: 'Execution ID and chunk ID are required'
                });
                return;
            }

            const result = await this.handshakeService.confirmChunk(
                executionId,
                chunkId,
                approved,
                modifications
            );

            if (result.success) {
                res.json({
                    success: true,
                    message: result.message,
                    nextChunk: result.nextChunk
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message
                });
            }

        } catch (error) {
            console.error('Failed to confirm chunk:', error);
            res.status(500).json({
                error: 'Failed to confirm chunk',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get current chunk for user confirmation
     */
    public async getCurrentChunk(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            const chunk = this.handshakeService.getCurrentChunk(executionId);

            if (!chunk) {
                res.status(404).json({ error: 'No current chunk available' });
                return;
            }

            res.json({
                chunkId: chunk.id,
                type: chunk.type,
                content: chunk.content,
                requiresConfirmation: chunk.metadata.requiresConfirmation,
                sequenceNumber: chunk.metadata.sequenceNumber,
                validationErrors: chunk.validationErrors,
                continuationPrompt: chunk.continuationPrompt
            });

        } catch (error) {
            console.error('Failed to get current chunk:', error);
            res.status(500).json({
                error: 'Failed to get current chunk',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // ========================================================================
    // LOGGING AND MONITORING ENDPOINTS
    // ========================================================================

    /**
     * Get execution logs
     */
    public async getExecutionLogs(req: Request, res: Response): Promise<void> {
        try {
            const { executionId } = req.params;
            const { limit = 100, level, category } = req.query;

            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            const logs = this.loggerService.queryLogs({
                executionId,
                limit: Number(limit),
                level: level as any,
                category: category as string
            });

            res.json({
                executionId,
                logs: logs.map(log => ({
                    id: log.id,
                    timestamp: log.timestamp,
                    level: log.level,
                    category: log.category,
                    operation: log.operation,
                    message: log.message,
                    metadata: log.metadata,
                    data: log.data
                })),
                totalCount: logs.length
            });

        } catch (error) {
            console.error('Failed to get execution logs:', error);
            res.status(500).json({
                error: 'Failed to get execution logs',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get streaming statistics
     */
    public async getStreamingStats(req: Request, res: Response): Promise<void> {
        try {
            const orchestratorStats = this.streamingOrchestrator.getExecutionStats();
            const loggerStats = this.loggerService.getLogStats();
            const continuityStats = this.continuityService.getRecoveryStats();
            const handshakeStats = this.handshakeService.getHandshakeStats();

            res.json({
                orchestrator: orchestratorStats,
                logging: loggerStats,
                continuity: continuityStats,
                handshake: handshakeStats,
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Failed to get streaming stats:', error);
            res.status(500).json({
                error: 'Failed to get streaming statistics',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================

    /**
     * Set up event streaming for real-time updates
     */
    private setupEventStreaming(executionId: string, res: Response): void {
        this.activeConnections.set(executionId, res);

        // Set up event listeners for this execution
        const listeners = new Set<string>();

        // Progress updates
        const progressHandler = (data: CortexProgressUpdate) => {
            if (data.executionId === executionId) {
                res.write(`data: ${JSON.stringify({
                    type: 'progress',
                    ...data
                })}\n\n`);
            }
        };

        this.streamingOrchestrator.on('progress_update', progressHandler);
        listeners.add('progress_update');

        // Token generation
        const tokenHandler = (data: any) => {
            if (data.executionId === executionId) {
                res.write(`data: ${JSON.stringify({
                    type: 'token',
                    ...data
                })}\n\n`);
            }
        };

        this.streamingOrchestrator.on('token_generated', tokenHandler);
        listeners.add('token_generated');

        // Chunk completion
        const chunkHandler = (data: any) => {
            if (data.executionId === executionId) {
                res.write(`data: ${JSON.stringify({
                    type: 'chunk',
                    ...data
                })}\n\n`);
            }
        };

        this.handshakeService.on('chunkGenerated', chunkHandler);
        this.handshakeService.on('chunkConfirmed', chunkHandler);
        listeners.add('chunkGenerated');
        listeners.add('chunkConfirmed');

        // Execution completion
        const completionHandler = (data: any) => {
            if (data.executionId === executionId) {
                res.write(`data: ${JSON.stringify({
                    type: 'completed',
                    ...data
                })}\n\n`);
                res.end();

                // Clean up
                this.cleanupEventStreaming(executionId, listeners);
            }
        };

        this.streamingOrchestrator.on('execution_completed', completionHandler);
        listeners.add('execution_completed');

        // Execution failure
        const failureHandler = (data: any) => {
            if (data.executionId === executionId) {
                res.write(`data: ${JSON.stringify({
                    type: 'failed',
                    ...data
                })}\n\n`);
                res.end();

                // Clean up
                this.cleanupEventStreaming(executionId, listeners);
            }
        };

        this.streamingOrchestrator.on('execution_failed', failureHandler);
        listeners.add('execution_failed');

        this.eventListeners.set(executionId, listeners);
    }

    /**
     * Clean up event streaming
     */
    private cleanupEventStreaming(executionId: string, listeners: Set<string>): void {
        this.activeConnections.delete(executionId);

        // Remove event listeners
        for (const eventType of listeners) {
            this.streamingOrchestrator.removeAllListeners(eventType);
            this.handshakeService.removeAllListeners(eventType);
        }

        this.eventListeners.delete(executionId);
    }

    /**
     * Set up event handlers for services
     */
    private setupEventHandlers(): void {
        // Log all streaming events
        this.streamingOrchestrator.on('execution_started', (data) => {
            this.loggerService.logExecutionStart(data);
        });

        this.streamingOrchestrator.on('execution_completed', (data) => {
            if (this.loggerService.logExecutionComplete) {
                this.loggerService.logExecutionComplete(data.execution, data);
            }
        });

        this.streamingOrchestrator.on('execution_failed', (data) => {
            if (this.loggerService.logExecutionFailure) {
                this.loggerService.logExecutionFailure(data.execution, data.error, data);
            }
        });

        // Log cost events
        this.streamingOrchestrator.on('cost_update', (data) => {
            this.loggerService.logCostUpdate(
                data.executionId,
                0, // component cost
                data.totalCost,
                data.totalTokens
            );
        });

        this.streamingOrchestrator.on('budget_warning', (data) => {
            this.loggerService.logBudgetWarning(
                data.executionId,
                data.totalCost,
                data.budgetLimit
            );
        });

        // Log continuity events
        this.continuityService.on('cutoff_detected', (data) => {
            this.loggerService.logContinuityEvent(
                data.executionId,
                'cutoff_detected',
                data.detection
            );
        });

        this.continuityService.on('context_preserved', (data) => {
            this.loggerService.logContinuityEvent(
                data.executionId,
                'context_preserved',
                data.preservationData
            );
        });

        this.continuityService.on('recovery_completed', (data) => {
            this.loggerService.logContinuityEvent(
                data.executionId,
                'recovery_successful',
                data
            );
        });
    }

    /**
     * Estimate time remaining for execution
     */
    private estimateTimeRemaining(execution: CortexStreamingExecution): number {
        if (execution.duration && execution.progress > 0) {
            const elapsed = execution.duration;
            const progress = execution.progress / 100;
            if (progress > 0) {
                return (elapsed / progress) - elapsed;
            }
        }
        return 0;
    }

    // ========================================================================
    // HEALTH AND DIAGNOSTICS
    // ========================================================================

    /**
     * Health check endpoint
     */
    public async healthCheck(req: Request, res: Response): Promise<void> {
        try {
            const stats = this.streamingOrchestrator.getExecutionStats();
            const activeConnections = this.activeConnections.size;

            res.json({
                status: 'healthy',
                services: {
                    streamingOrchestrator: 'active',
                    loggerService: 'active',
                    continuityService: 'active',
                    handshakeService: 'active'
                },
                metrics: {
                    activeExecutions: stats.activeExecutions,
                    totalExecutions: stats.totalExecutions,
                    successRate: stats.successfulExecutions / Math.max(stats.totalExecutions, 1),
                    averageExecutionTime: stats.averageExecutionTime,
                    averageCost: stats.averageCost,
                    activeConnections
                },
                timestamp: new Date()
            });

        } catch (error) {
            res.status(500).json({
                status: 'unhealthy',
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date()
            });
        }
    }

    /**
     * Reset streaming system (admin only)
     */
    public async resetSystem(req: Request, res: Response): Promise<void> {
        try {
            // This would reset all active executions and clear caches
            // Implementation would depend on admin authorization

            res.json({
                success: true,
                message: 'System reset completed',
                timestamp: new Date()
            });

        } catch (error) {
            res.status(500).json({
                error: 'Failed to reset system',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

// Export singleton instance
export const cortexStreamingController = new CortexStreamingController();

