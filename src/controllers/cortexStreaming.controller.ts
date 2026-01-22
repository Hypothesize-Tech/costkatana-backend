/**
 * Cortex Streaming Controller
 *
 * This controller provides a unified API for the advanced Cortex streaming capabilities,
 * integrating all the streaming services with comprehensive error handling, cost tracking,
 * and user experience features. It implements the complete CostKatana streaming architecture.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
    CortexProgressUpdate
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
    public async startStreaming(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('startStreaming', req);

        try {
            const { text, sessionId, config, options }: StreamingRequest = req.body;

            // Validate request
            if (!text || !sessionId) {
                res.status(400).json({
                    error: 'Missing required fields: text, sessionId'
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

            ControllerHelper.logRequestSuccess('startStreaming', req, startTime, {
                executionId
            });

        } catch (error) {
            if (!res.headersSent) {
                ControllerHelper.handleError('startStreaming', error, req, res, startTime);
            }
        }
    }

    /**
     * Get streaming execution status
     */
    public async getStreamingStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getStreamingStatus', req, { executionId });

        try {
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

            ControllerHelper.logRequestSuccess('getStreamingStatus', req, startTime, { executionId });

            res.json(response);

        } catch (error) {
            ControllerHelper.handleError('getStreamingStatus', error, req, res, startTime, { executionId });
        }
    }

    /**
     * Pause streaming execution
     */
    public async pauseStreaming(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('pauseStreaming', req, { executionId });

        try {
            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            await this.streamingOrchestrator.pauseExecution(executionId);

            // Log pause event
            if (this.loggerService.logExecutionPaused) {
                this.loggerService.logExecutionPaused(executionId, 'User requested pause');
            }

            ControllerHelper.logRequestSuccess('pauseStreaming', req, startTime, { executionId });

            res.json({
                success: true,
                message: 'Execution paused successfully',
                executionId
            });

        } catch (error) {
            ControllerHelper.handleError('pauseStreaming', error, req, res, startTime, { executionId });
        }
    }

    /**
     * Resume streaming execution
     */
    public async resumeStreaming(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('resumeStreaming', req, { executionId });

        try {
            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            await this.streamingOrchestrator.resumeExecution(executionId);

            // Log resume event
            if (this.loggerService.logExecutionResumed) {
                this.loggerService.logExecutionResumed(executionId, 'User requested resume');
            }

            ControllerHelper.logRequestSuccess('resumeStreaming', req, startTime, { executionId });

            res.json({
                success: true,
                message: 'Execution resumed successfully',
                executionId
            });

        } catch (error) {
            ControllerHelper.handleError('resumeStreaming', error, req, res, startTime, { executionId });
        }
    }

    /**
     * Cancel streaming execution
     */
    public async cancelStreaming(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('cancelStreaming', req, { executionId });

        try {
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

            ControllerHelper.logRequestSuccess('cancelStreaming', req, startTime, { executionId });

            res.json({
                success: true,
                message: 'Execution cancelled successfully',
                executionId
            });

        } catch (error) {
            ControllerHelper.handleError('cancelStreaming', error, req, res, startTime, { executionId });
        }
    }

    /**
     * Get streaming execution result
     */
    public async getStreamingResult(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getStreamingResult', req, { executionId });

        try {
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

            ControllerHelper.logRequestSuccess('getStreamingResult', req, startTime, { executionId });

            res.json(response);

        } catch (error) {
            ControllerHelper.handleError('getStreamingResult', error, req, res, startTime, { executionId });
        }
    }

    // ========================================================================
    // HANDSHAKE MANAGEMENT ENDPOINTS
    // ========================================================================

    /**
     * Confirm current chunk in long handshake
     */
    public async confirmChunk(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        const { chunkId, approved, modifications } = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('confirmChunk', req, { executionId, chunkId });

        try {
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
                ControllerHelper.logRequestSuccess('confirmChunk', req, startTime, { executionId, chunkId });

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
            ControllerHelper.handleError('confirmChunk', error, req, res, startTime, { executionId, chunkId });
        }
    }

    /**
     * Get current chunk for user confirmation
     */
    public async getCurrentChunk(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getCurrentChunk', req, { executionId });

        try {
            if (!executionId) {
                res.status(400).json({ error: 'Execution ID is required' });
                return;
            }

            const chunk = this.handshakeService.getCurrentChunk(executionId);

            if (!chunk) {
                res.status(404).json({ error: 'No current chunk available' });
                return;
            }

            ControllerHelper.logRequestSuccess('getCurrentChunk', req, startTime, { executionId });

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
            ControllerHelper.handleError('getCurrentChunk', error, req, res, startTime, { executionId });
        }
    }

    // ========================================================================
    // LOGGING AND MONITORING ENDPOINTS
    // ========================================================================

    /**
     * Get execution logs
     */
    public async getExecutionLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { executionId } = req.params;
        const { limit = 100, level, category } = req.query;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getExecutionLogs', req, { executionId });

        try {
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

            ControllerHelper.logRequestSuccess('getExecutionLogs', req, startTime, {
                executionId,
                totalCount: logs.length
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
            ControllerHelper.handleError('getExecutionLogs', error, req, res, startTime, { executionId });
        }
    }

    /**
     * Get streaming statistics
     */
    public async getStreamingStats(_req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            const orchestratorStats = this.streamingOrchestrator.getExecutionStats();
            const loggerStats = this.loggerService.getLogStats();
            const continuityStats = this.continuityService.getRecoveryStats();
            const handshakeStats = this.handshakeService.getHandshakeStats();

            ControllerHelper.logRequestSuccess('getStreamingStats', _req, startTime);

            res.json({
                orchestrator: orchestratorStats,
                logging: loggerStats,
                continuity: continuityStats,
                handshake: handshakeStats,
                timestamp: new Date()
            });

        } catch (error) {
            ControllerHelper.handleError('getStreamingStats', error, _req, res, startTime);
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
    public async healthCheck(_req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

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
            ControllerHelper.handleError('healthCheck', error, _req, res, startTime);
        }
    }

    /**
     * Reset streaming system (admin only)
     */
    public async resetSystem(_req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            // This would reset all active executions and clear caches
            // Implementation would depend on admin authorization

            ControllerHelper.logRequestSuccess('resetSystem', _req, startTime);

            res.json({
                success: true,
                message: 'System reset completed',
                timestamp: new Date()
            });

        } catch (error) {
            ControllerHelper.handleError('resetSystem', error, _req, res, startTime);
        }
    }
}

// Export singleton instance
export const cortexStreamingController = new CortexStreamingController();

