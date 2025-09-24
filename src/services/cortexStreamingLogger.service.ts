/**
 * Cortex Streaming Logger Service
 *
 * This service provides comprehensive logging for the Cortex streaming orchestrator,
 * capturing every step of the parallel execution process for verification and debugging.
 * It implements structured logging with correlation IDs, performance metrics,
 * and detailed step-by-step tracking of all streaming operations.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';

// Import types
import {
    CortexStreamingExecution,
    CortexToken,
    CortexProgressUpdate,
    CortexStreamingEvent,
    CortexStreamingPhase
} from './cortexStreamingOrchestrator.service';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    CRITICAL = 4
}

export interface StreamingLogEntry {
    id: string;
    timestamp: Date;
    executionId?: string;
    sessionId?: string;
    userId?: string;
    level: LogLevel;
    category: string;
    operation: string;
    message: string;
    data?: any;
    metadata?: {
        duration?: number;
        cost?: number;
        tokens?: number;
        model?: string;
        phase?: CortexStreamingPhase;
        component?: string;
        correlationId?: string;
        parentLogId?: string;
        [key: string]: any;
    };
    tags?: string[];
    stackTrace?: string;
}

export interface StreamingLogQuery {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    level?: LogLevel;
    category?: string;
    operation?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
}

export interface StreamingLogStats {
    totalLogs: number;
    logsByLevel: { [key in LogLevel]: number };
    logsByCategory: { [key: string]: number };
    logsByOperation: { [key: string]: number };
    averageLogsPerExecution: number;
    errorRate: number;
    recentErrors: StreamingLogEntry[];
}

export class CortexStreamingLoggerService extends EventEmitter {
    private static instance: CortexStreamingLoggerService;

    private logs: StreamingLogEntry[] = [];
    private maxLogsInMemory = 10000; // Keep last 10k logs in memory
    private logRetentionDays = 7; // Keep logs for 7 days
    private correlationIdMap = new Map<string, string>(); // Maps executionId to correlationId
    private executionContextMap = new Map<string, any>(); // Maps executionId to context

    private constructor() {
        super();
        this.startLogCleanup();
    }

    public static getInstance(): CortexStreamingLoggerService {
        if (!CortexStreamingLoggerService.instance) {
            CortexStreamingLoggerService.instance = new CortexStreamingLoggerService();
        }
        return CortexStreamingLoggerService.instance;
    }

    // ========================================================================
    // LOGGING METHODS
    // ========================================================================

    /**
     * Log execution start
     */
    public logExecutionStart(
        execution: CortexStreamingExecution,
        additionalData?: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.generateCorrelationId(execution.id);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId: execution.id,
            sessionId: execution.sessionId,
            userId: execution.userId,
            level: LogLevel.INFO,
            category: 'execution',
            operation: 'start',
            message: 'Cortex streaming execution started',
            data: {
                inputLength: execution.inputText.length,
                config: execution.config,
                estimatedCost: this.estimateExecutionCost(execution),
                ...additionalData
            },
            metadata: {
                correlationId,
                phase: CortexStreamingPhase.INITIALIZING,
                duration: 0
            },
            tags: ['execution', 'start', 'streaming']
        };

        this.storeLogEntry(logEntry);
        this.setExecutionContext(execution.id, { correlationId, startTime: execution.startTime });

        loggingService.info('🚀 Cortex streaming execution started', {
            executionId: execution.id,
            correlationId,
            inputLength: execution.inputText.length
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log execution completion
     */
    public logExecutionComplete(
        execution: CortexStreamingExecution,
        additionalData?: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(execution.id);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId: execution.id,
            sessionId: execution.sessionId,
            userId: execution.userId,
            level: LogLevel.INFO,
            category: 'execution',
            operation: 'complete',
            message: 'Cortex streaming execution completed successfully',
            data: {
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                duration: execution.duration,
                chunksGenerated: execution.chunks.length,
                progress: execution.progress,
                ...additionalData
            },
            metadata: {
                correlationId,
                phase: CortexStreamingPhase.COMPLETED,
                duration: execution.duration,
                cost: execution.totalCost,
                tokens: execution.totalTokens
            },
            tags: ['execution', 'complete', 'success', 'streaming']
        };

        this.storeLogEntry(logEntry);

        loggingService.info('✅ Cortex streaming execution completed', {
            executionId: execution.id,
            correlationId,
            duration: execution.duration,
            totalCost: execution.totalCost,
            totalTokens: execution.totalTokens
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log execution failure
     */
    public logExecutionFailure(
        execution: CortexStreamingExecution,
        error: any,
        additionalData?: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(execution.id);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId: execution.id,
            sessionId: execution.sessionId,
            userId: execution.userId,
            level: LogLevel.ERROR,
            category: 'execution',
            operation: 'failure',
            message: 'Cortex streaming execution failed',
            data: {
                error: error instanceof Error ? error.message : String(error),
                stackTrace: error instanceof Error ? error.stack : undefined,
                totalCost: execution.totalCost,
                totalTokens: execution.totalTokens,
                duration: execution.duration,
                progress: execution.progress,
                retryCount: execution.retryCount,
                lastError: execution.lastError,
                ...additionalData
            },
            metadata: {
                correlationId,
                phase: CortexStreamingPhase.ERROR,
                duration: execution.duration,
                cost: execution.totalCost,
                tokens: execution.totalTokens
            },
            tags: ['execution', 'failure', 'error', 'streaming'],
            stackTrace: error instanceof Error ? error.stack : undefined
        };

        this.storeLogEntry(logEntry);

        loggingService.error('❌ Cortex streaming execution failed', {
            executionId: execution.id,
            correlationId,
            error: error instanceof Error ? error.message : String(error),
            duration: execution.duration,
            totalCost: execution.totalCost
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log component execution start
     */
    public logComponentStart(
        executionId: string,
        componentName: string,
        model: string,
        inputData: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'component',
            operation: `${componentName}_start`,
            message: `${componentName} execution started`,
            data: {
                component: componentName,
                model,
                inputSize: JSON.stringify(inputData).length,
                inputType: typeof inputData
            },
            metadata: {
                correlationId,
                component: componentName,
                model,
                phase: this.getPhaseForComponent(componentName)
            },
            tags: ['component', componentName, 'start']
        };

        this.storeLogEntry(logEntry);

        loggingService.info(`📝 ${componentName} execution started`, {
            executionId,
            correlationId,
            component: componentName,
            model
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log component execution completion
     */
    public logComponentComplete(
        executionId: string,
        componentName: string,
        model: string,
        result: any,
        duration: number,
        cost: number,
        tokens: number
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'component',
            operation: `${componentName}_complete`,
            message: `${componentName} execution completed successfully`,
            data: {
                component: componentName,
                model,
                duration,
                cost,
                tokens,
                outputSize: JSON.stringify(result).length,
                resultType: typeof result
            },
            metadata: {
                correlationId,
                component: componentName,
                model,
                duration,
                cost,
                tokens,
                phase: this.getPhaseForComponent(componentName)
            },
            tags: ['component', componentName, 'complete', 'success']
        };

        this.storeLogEntry(logEntry);

        loggingService.info(`✅ ${componentName} execution completed`, {
            executionId,
            correlationId,
            component: componentName,
            model,
            duration,
            cost,
            tokens
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log component execution failure
     */
    public logComponentFailure(
        executionId: string,
        componentName: string,
        model: string,
        error: any,
        duration: number,
        retryAttempt?: number
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.ERROR,
            category: 'component',
            operation: `${componentName}_failure`,
            message: `${componentName} execution failed`,
            data: {
                component: componentName,
                model,
                duration,
                retryAttempt,
                error: error instanceof Error ? error.message : String(error),
                stackTrace: error instanceof Error ? error.stack : undefined
            },
            metadata: {
                correlationId,
                component: componentName,
                model,
                duration,
                phase: this.getPhaseForComponent(componentName)
            },
            tags: ['component', componentName, 'failure', 'error'],
            stackTrace: error instanceof Error ? error.stack : undefined
        };

        this.storeLogEntry(logEntry);

        loggingService.error(`❌ ${componentName} execution failed`, {
            executionId,
            correlationId,
            component: componentName,
            model,
            error: error instanceof Error ? error.message : String(error),
            retryAttempt
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log token generation
     */
    public logTokenGenerated(
        executionId: string,
        token: CortexToken,
        additionalData?: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: token.timestamp,
            executionId,
            level: LogLevel.DEBUG,
            category: 'token',
            operation: 'generated',
            message: `Token generated: ${token.type}`,
            data: {
                tokenId: token.id,
                tokenType: token.type,
                contentLength: token.content.length,
                hasMetadata: !!token.metadata,
                ...additionalData
            },
            metadata: {
                correlationId,
                tokenId: token.id,
                tokenType: token.type,
                contentLength: token.content.length,
                cost: token.metadata?.cost,
                model: token.metadata?.model,
                phase: this.getPhaseForTokenType(token.type)
            },
            tags: ['token', 'generated', token.type]
        };

        this.storeLogEntry(logEntry);

        // Only emit debug logs if detailed logging is enabled
        // For now, always emit logs (can be refined later)
        this.emit('log', logEntry);

        return logId;
    }

    /**
     * Log progress update
     */
    public logProgressUpdate(
        executionId: string,
        progressUpdate: CortexProgressUpdate
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'progress',
            operation: 'update',
            message: `Progress update: ${progressUpdate.message}`,
            data: {
                progress: progressUpdate.progress,
                phase: progressUpdate.phase,
                message: progressUpdate.message,
                tokensProcessed: progressUpdate.metadata?.tokensProcessed,
                costIncurred: progressUpdate.metadata?.costIncurred,
                estimatedTimeRemaining: progressUpdate.metadata?.estimatedTimeRemaining,
                currentOperation: progressUpdate.metadata?.currentOperation
            },
            metadata: {
                correlationId,
                phase: progressUpdate.phase,
                progress: progressUpdate.progress,
                cost: progressUpdate.metadata?.costIncurred,
                tokens: progressUpdate.metadata?.tokensProcessed
            },
            tags: ['progress', 'update', progressUpdate.phase]
        };

        this.storeLogEntry(logEntry);

        loggingService.info(`📊 Progress update: ${progressUpdate.progress}% - ${progressUpdate.message}`, {
            executionId,
            correlationId,
            phase: progressUpdate.phase,
            progress: progressUpdate.progress
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log execution paused
     */
    public logExecutionPaused(executionId: string, reason: string): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'execution',
            operation: 'paused',
            message: `Execution paused: ${reason}`,
            metadata: {
                correlationId,
                phase: CortexStreamingPhase.PAUSED
            },
            tags: ['execution', 'paused']
        };

        this.storeLogEntry(logEntry);
        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log execution resumed
     */
    public logExecutionResumed(executionId: string, reason: string): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'execution',
            operation: 'resumed',
            message: `Execution resumed: ${reason}`,
            metadata: {
                correlationId,
                phase: CortexStreamingPhase.RESUMED
            },
            tags: ['execution', 'resumed']
        };

        this.storeLogEntry(logEntry);
        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log execution cancelled
     */
    public logExecutionCancelled(executionId: string, reason: string): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'execution',
            operation: 'cancelled',
            message: `Execution cancelled: ${reason}`,
            metadata: {
                correlationId,
                phase: CortexStreamingPhase.ERROR // Using ERROR since CANCELLED doesn't exist
            },
            tags: ['execution', 'cancelled']
        };

        this.storeLogEntry(logEntry);
        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log retry attempt
     */
    public logRetryAttempt(
        executionId: string,
        componentName: string,
        retryCount: number,
        delay: number,
        error: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.WARN,
            category: 'retry',
            operation: 'attempt',
            message: `Retry attempt ${retryCount} for ${componentName}`,
            data: {
                component: componentName,
                retryCount,
                delay,
                error: error instanceof Error ? error.message : String(error),
                maxRetries: 5 // This should come from config
            },
            metadata: {
                correlationId,
                component: componentName,
                retryCount,
                delay,
                phase: CortexStreamingPhase.RETRYING
            },
            tags: ['retry', 'attempt', componentName]
        };

        this.storeLogEntry(logEntry);

        loggingService.warn(`🔄 Retry attempt ${retryCount} for ${componentName}`, {
            executionId,
            correlationId,
            component: componentName,
            retryCount,
            delay,
            error: error instanceof Error ? error.message : String(error)
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log cost update
     */
    public logCostUpdate(
        executionId: string,
        componentCost: number,
        totalCost: number,
        tokensUsed: number,
        budgetRemaining?: number
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'cost',
            operation: 'update',
            message: `Cost update: $${totalCost.toFixed(4)} total, $${componentCost.toFixed(4)} this component`,
            data: {
                componentCost,
                totalCost,
                tokensUsed,
                budgetRemaining,
                costPerToken: totalCost / Math.max(tokensUsed, 1)
            },
            metadata: {
                correlationId,
                cost: totalCost,
                tokens: tokensUsed,
                budgetRemaining
            },
            tags: ['cost', 'update']
        };

        this.storeLogEntry(logEntry);

        loggingService.info(`💰 Cost update: $${totalCost.toFixed(4)} total`, {
            executionId,
            correlationId,
            componentCost: componentCost.toFixed(4),
            totalCost: totalCost.toFixed(4),
            tokensUsed,
            budgetRemaining: budgetRemaining?.toFixed(4)
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log budget warning
     */
    public logBudgetWarning(
        executionId: string,
        currentCost: number,
        budgetLimit: number,
        warningThreshold: number = 0.8
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.WARN,
            category: 'budget',
            operation: 'warning',
            message: `Budget warning: ${((currentCost / budgetLimit) * 100).toFixed(1)}% of budget used`,
            data: {
                currentCost,
                budgetLimit,
                usagePercentage: (currentCost / budgetLimit) * 100,
                warningThreshold: warningThreshold * 100,
                remainingBudget: budgetLimit - currentCost
            },
            metadata: {
                correlationId,
                cost: currentCost,
                budgetLimit,
                budgetRemaining: budgetLimit - currentCost
            },
            tags: ['budget', 'warning']
        };

        this.storeLogEntry(logEntry);

        loggingService.warn(`⚠️ Budget warning: ${((currentCost / budgetLimit) * 100).toFixed(1)}% used`, {
            executionId,
            correlationId,
            currentCost: currentCost.toFixed(4),
            budgetLimit: budgetLimit.toFixed(4),
            remaining: (budgetLimit - currentCost).toFixed(4)
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log budget exceeded
     */
    public logBudgetExceeded(
        executionId: string,
        currentCost: number,
        budgetLimit: number
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.CRITICAL,
            category: 'budget',
            operation: 'exceeded',
            message: `Budget exceeded: $${currentCost.toFixed(4)} > $${budgetLimit.toFixed(4)}`,
            data: {
                currentCost,
                budgetLimit,
                overrun: currentCost - budgetLimit,
                overrunPercentage: ((currentCost - budgetLimit) / budgetLimit) * 100
            },
            metadata: {
                correlationId,
                cost: currentCost,
                budgetLimit,
                budgetRemaining: 0
            },
            tags: ['budget', 'exceeded', 'critical']
        };

        this.storeLogEntry(logEntry);

        loggingService.error(`💸 Budget exceeded: $${currentCost.toFixed(4)} > $${budgetLimit.toFixed(4)}`, {
            executionId,
            correlationId,
            currentCost: currentCost.toFixed(4),
            budgetLimit: budgetLimit.toFixed(4),
            overrun: (currentCost - budgetLimit).toFixed(4)
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log continuity event
     */
    public logContinuityEvent(
        executionId: string,
        eventType: 'cutoff_detected' | 'context_preserved' | 'recovery_successful' | 'retry_successful',
        details: any
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: new Date(),
            executionId,
            level: LogLevel.INFO,
            category: 'continuity',
            operation: eventType,
            message: `Continuity event: ${eventType}`,
            data: details,
            metadata: {
                correlationId,
                eventType
            },
            tags: ['continuity', eventType]
        };

        this.storeLogEntry(logEntry);

        loggingService.info(`🔄 Continuity event: ${eventType}`, {
            executionId,
            correlationId,
            details
        });

        this.emit('log', logEntry);
        return logId;
    }

    /**
     * Log performance metrics
     */
    public logPerformanceMetrics(
        executionId: string,
        metrics: {
            componentName: string;
            operation: string;
            startTime: Date;
            endTime: Date;
            inputSize: number;
            outputSize: number;
            cost: number;
            tokens: number;
            success: boolean;
        }
    ): string {
        const logId = uuidv4();
        const correlationId = this.getCorrelationId(executionId);
        const duration = metrics.endTime.getTime() - metrics.startTime.getTime();

        const logEntry: StreamingLogEntry = {
            id: logId,
            timestamp: metrics.endTime,
            executionId,
            level: LogLevel.INFO,
            category: 'performance',
            operation: metrics.operation,
            message: `Performance metrics for ${metrics.componentName}: ${duration}ms, $${metrics.cost.toFixed(4)}`,
            data: {
                component: metrics.componentName,
                operation: metrics.operation,
                duration,
                inputSize: metrics.inputSize,
                outputSize: metrics.outputSize,
                cost: metrics.cost,
                tokens: metrics.tokens,
                success: metrics.success,
                throughput: metrics.outputSize / Math.max(duration, 1) * 1000, // bytes per second
                costPerToken: metrics.cost / Math.max(metrics.tokens, 1)
            },
            metadata: {
                correlationId,
                component: metrics.componentName,
                duration,
                cost: metrics.cost,
                tokens: metrics.tokens
            },
            tags: ['performance', metrics.componentName, metrics.operation]
        };

        this.storeLogEntry(logEntry);

        loggingService.info(`📊 Performance: ${metrics.componentName} - ${duration}ms, $${metrics.cost.toFixed(4)}`, {
            executionId,
            correlationId,
            component: metrics.componentName,
            duration,
            cost: metrics.cost.toFixed(4),
            tokens: metrics.tokens
        });

        this.emit('log', logEntry);
        return logId;
    }

    // ========================================================================
    // QUERY AND ANALYSIS METHODS
    // ========================================================================

    /**
     * Query logs with filters
     */
    public queryLogs(query: StreamingLogQuery): StreamingLogEntry[] {
        let filteredLogs = [...this.logs];

        if (query.executionId) {
            filteredLogs = filteredLogs.filter(log => log.executionId === query.executionId);
        }

        if (query.sessionId) {
            filteredLogs = filteredLogs.filter(log => log.sessionId === query.sessionId);
        }

        if (query.userId) {
            filteredLogs = filteredLogs.filter(log => log.userId === query.userId);
        }

        if (query.level !== undefined) {
            filteredLogs = filteredLogs.filter(log => log.level === query.level);
        }

        if (query.category) {
            filteredLogs = filteredLogs.filter(log => log.category === query.category);
        }

        if (query.operation) {
            filteredLogs = filteredLogs.filter(log => log.operation === query.operation);
        }

        if (query.startTime) {
            filteredLogs = filteredLogs.filter(log => log.timestamp >= query.startTime!);
        }

        if (query.endTime) {
            filteredLogs = filteredLogs.filter(log => log.timestamp <= query.endTime!);
        }

        // Sort by timestamp (newest first)
        filteredLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Apply pagination
        const offset = query.offset || 0;
        const limit = query.limit || 100;
        return filteredLogs.slice(offset, offset + limit);
    }

    /**
     * Get logs for a specific execution
     */
    public getExecutionLogs(executionId: string): StreamingLogEntry[] {
        return this.queryLogs({ executionId, limit: 1000 });
    }

    /**
     * Get error logs for an execution
     */
    public getExecutionErrors(executionId: string): StreamingLogEntry[] {
        return this.queryLogs({ executionId, level: LogLevel.ERROR, limit: 100 });
    }

    /**
     * Get streaming log statistics
     */
    public getLogStats(): StreamingLogStats {
        const totalLogs = this.logs.length;

        const logsByLevel = Object.values(LogLevel)
            .filter(level => typeof level === 'number')
            .reduce((acc, level) => {
                acc[level as LogLevel] = this.logs.filter(log => log.level === level).length;
                return acc;
            }, {} as { [key in LogLevel]: number });

        const logsByCategory = this.logs.reduce((acc, log) => {
            acc[log.category] = (acc[log.category] || 0) + 1;
            return acc;
        }, {} as { [key: string]: number });

        const logsByOperation = this.logs.reduce((acc, log) => {
            acc[log.operation] = (acc[log.operation] || 0) + 1;
            return acc;
        }, {} as { [key: string]: number });

        // Calculate error rate
        const errorLogs = this.logs.filter(log => log.level >= LogLevel.ERROR).length;
        const errorRate = totalLogs > 0 ? (errorLogs / totalLogs) * 100 : 0;

        // Get recent errors (last 10)
        const recentErrors = this.logs
            .filter(log => log.level >= LogLevel.ERROR)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, 10);

        // Calculate average logs per execution
        const executions = new Set(this.logs.map(log => log.executionId).filter(Boolean));
        const averageLogsPerExecution = executions.size > 0 ? totalLogs / executions.size : 0;

        return {
            totalLogs,
            logsByLevel,
            logsByCategory,
            logsByOperation,
            averageLogsPerExecution,
            errorRate,
            recentErrors
        };
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    private storeLogEntry(logEntry: StreamingLogEntry): void {
        this.logs.push(logEntry);

        // Keep only recent logs in memory
        if (this.logs.length > this.maxLogsInMemory) {
            this.logs = this.logs.slice(-this.maxLogsInMemory);
        }

        // Store important logs in Redis for persistence
        this.storeLogInRedis(logEntry);
    }

    private async storeLogInRedis(logEntry: StreamingLogEntry): Promise<void> {
        try {
            // Store critical logs in Redis for persistence
            if (logEntry.level >= LogLevel.ERROR || logEntry.category === 'execution') {
                await redisService.storeCache(
                    `cortex:log:${logEntry.id}`,
                    logEntry,
                    { ttl: this.logRetentionDays * 24 * 60 * 60 } // TTL in seconds
                );
            }
        } catch (error) {
            // Don't let Redis errors affect logging
            console.warn('Failed to store log in Redis:', error);
        }
    }

    private generateCorrelationId(executionId: string): string {
        if (!this.correlationIdMap.has(executionId)) {
            this.correlationIdMap.set(executionId, uuidv4());
        }
        return this.correlationIdMap.get(executionId)!;
    }

    private getCorrelationId(executionId: string): string {
        return this.correlationIdMap.get(executionId) || 'unknown';
    }

    private setExecutionContext(executionId: string, context: any): void {
        this.executionContextMap.set(executionId, context);
    }

    private getExecutionContext(executionId: string): any {
        return this.executionContextMap.get(executionId) || {};
    }

    private getPhaseForComponent(componentName: string): CortexStreamingPhase {
        switch (componentName.toLowerCase()) {
            case 'encoder': return CortexStreamingPhase.ENCODING;
            case 'processor': return CortexStreamingPhase.PROCESSING;
            case 'decoder': return CortexStreamingPhase.DECODING;
            default: return CortexStreamingPhase.INITIALIZING;
        }
    }

    private getPhaseForTokenType(tokenType: string): CortexStreamingPhase {
        switch (tokenType) {
            case 'encoding': return CortexStreamingPhase.ENCODING;
            case 'processing': return CortexStreamingPhase.PROCESSING;
            case 'decoding': return CortexStreamingPhase.DECODING;
            case 'output': return CortexStreamingPhase.COMPLETED;
            default: return CortexStreamingPhase.INITIALIZING;
        }
    }

    private estimateExecutionCost(execution: CortexStreamingExecution): number {
        // Simple cost estimation based on input size and configuration
        const inputTokens = execution.inputText.length / 4;
        const estimatedOutputTokens = inputTokens * 2;

        // This is a simplified calculation - in production you'd use actual model pricing
        return (inputTokens + estimatedOutputTokens) * 0.000001; // Rough estimate
    }

    private startLogCleanup(): void {
        // Clean up old logs every hour
        setInterval(() => {
            const cutoffTime = Date.now() - (this.logRetentionDays * 24 * 60 * 60 * 1000);
            this.logs = this.logs.filter(log => log.timestamp.getTime() > cutoffTime);

            // Clean up correlation ID map
            for (const [executionId] of this.correlationIdMap.entries()) {
                const context = this.getExecutionContext(executionId);
                if (context.startTime && context.startTime.getTime() < cutoffTime) {
                    this.correlationIdMap.delete(executionId);
                    this.executionContextMap.delete(executionId);
                }
            }
        }, 60 * 60 * 1000); // Every hour
    }
}

