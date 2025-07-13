import { TraceService, CreateTraceRequest, AddSpanRequest } from './trace.service';
import { logger } from '../utils/logger';
import { calculateCost } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';

export interface InstrumentationConfig {
    userId: string;
    projectId?: string;
    environment?: string;
    version?: string;
    sessionId?: string;
    tags?: string[];
    autoTrace: boolean;
    sampleRate: number;
    enableAutoInstrumentation: boolean;
    excludePatterns?: string[];
    includePatterns?: string[];
}

export interface TraceContext {
    traceId: string;
    spanId?: string;
    parentSpanId?: string;
    userId: string;
    projectId?: string;
    metadata: Record<string, any>;
}

export interface AICallMetadata {
    provider: string;
    model: string;
    prompt: string;
    completion?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number;
    parameters?: Record<string, any>;
    cacheHit?: boolean;
    retryCount?: number;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    error?: Error;
}

// Global context storage (in production, use AsyncLocalStorage or similar)
const contextStore = new Map<string, TraceContext>();

export class InstrumentationService {
    private static config: InstrumentationConfig | null = null;
    private static activeTraces = new Map<string, string>(); // sessionId -> traceId
    // private static originalFunctions = new Map<string, Function>(); // For future auto-instrumentation

    /**
     * Initialize the instrumentation service
     */
    static initialize(config: InstrumentationConfig): void {
        this.config = config;

        if (config.enableAutoInstrumentation) {
            this.setupAutoInstrumentation();
        }

        logger.info('Instrumentation service initialized', {
            userId: config.userId,
            projectId: config.projectId,
            autoTrace: config.autoTrace,
            sampleRate: config.sampleRate
        });
    }

    /**
     * Start a new trace for a workflow
     */
    static async startTrace(
        name: string,
        metadata?: Record<string, any>
    ): Promise<TraceContext> {
        if (!this.config) {
            throw new Error('Instrumentation service not initialized');
        }

        // Check sampling
        if (Math.random() > this.config.sampleRate) {
            logger.debug('Trace skipped due to sampling');
            return this.createMockContext();
        }

        try {
            const request: CreateTraceRequest = {
                name,
                projectId: this.config.projectId,
                metadata: {
                    environment: this.config.environment,
                    version: this.config.version,
                    sessionId: this.config.sessionId,
                    tags: this.config.tags,
                    customAttributes: metadata
                }
            };

            const trace = await TraceService.createTrace(this.config.userId, request);

            const context: TraceContext = {
                traceId: trace.traceId,
                userId: this.config.userId,
                projectId: this.config.projectId,
                metadata: metadata || {}
            };

            // Store context
            if (this.config.sessionId) {
                this.activeTraces.set(this.config.sessionId, trace.traceId);
                contextStore.set(trace.traceId, context);
            }

            logger.info('Trace started', { traceId: trace.traceId, name });
            return context;
        } catch (error) {
            logger.error('Failed to start trace', { error, name });
            return this.createMockContext();
        }
    }

    /**
     * Add a span to the current trace
     */
    static async addSpan(
        name: string,
        operation: 'ai_call' | 'processing' | 'database' | 'http_request' | 'custom',
        aiCallMetadata?: AICallMetadata,
        parentContext?: TraceContext
    ): Promise<string> {
        if (!this.config) {
            throw new Error('Instrumentation service not initialized');
        }

        const context = parentContext || this.getCurrentContext();
        if (!context || !context.traceId) {
            logger.debug('No active trace context, skipping span');
            return '';
        }

        try {
            const spanRequest: AddSpanRequest = {
                name,
                operation,
                parentSpanId: context.spanId,
                tags: {
                    environment: this.config.environment || '',
                    version: this.config.version || ''
                }
            };

            // Add AI call data if provided
            if (aiCallMetadata) {
                spanRequest.aiCall = {
                    provider: aiCallMetadata.provider,
                    model: aiCallMetadata.model,
                    prompt: aiCallMetadata.prompt,
                    completion: aiCallMetadata.completion,
                    promptTokens: aiCallMetadata.promptTokens || 0,
                    completionTokens: aiCallMetadata.completionTokens || 0,
                    totalTokens: aiCallMetadata.totalTokens || 0,
                    cost: aiCallMetadata.cost || 0,
                    parameters: aiCallMetadata.parameters || {},
                    cacheHit: aiCallMetadata.cacheHit || false,
                    retryCount: aiCallMetadata.retryCount || 0
                };

                spanRequest.performance = {
                    latency: aiCallMetadata.duration || 0,
                    processingTime: aiCallMetadata.duration || 0
                };
            }

            // Add error if present
            if (aiCallMetadata?.error) {
                spanRequest.error = {
                    message: aiCallMetadata.error.message,
                    code: aiCallMetadata.error.name,
                    stack: aiCallMetadata.error.stack,
                    recoverable: !aiCallMetadata.error.message.includes('fatal')
                };
            }

            const updatedTrace = await TraceService.addSpan(
                context.traceId,
                context.userId,
                spanRequest
            );

            const spanId = updatedTrace.spans[updatedTrace.spans.length - 1].spanId;
            logger.debug('Span added', { traceId: context.traceId, spanId, operation });

            return spanId;
        } catch (error) {
            logger.error('Failed to add span', { error, traceId: context.traceId, name });
            return '';
        }
    }

    /**
     * Complete a span
     */
    static async completeSpan(
        spanId: string,
        completion?: {
            endTime?: Date;
            duration?: number;
            aiCall?: Partial<AICallMetadata>;
            logs?: Array<{
                level: 'debug' | 'info' | 'warn' | 'error';
                message: string;
                data?: any;
            }>;
        },
        context?: TraceContext
    ): Promise<void> {
        const traceContext = context || this.getCurrentContext();
        if (!traceContext || !traceContext.traceId) {
            return;
        }

        try {
            await TraceService.completeSpan(
                traceContext.traceId,
                spanId,
                traceContext.userId,
                completion
            );

            logger.debug('Span completed', { traceId: traceContext.traceId, spanId });
        } catch (error) {
            logger.error('Failed to complete span', { error, spanId });
        }
    }

    /**
     * Complete the current trace
     */
    static async completeTrace(context?: TraceContext): Promise<void> {
        const traceContext = context || this.getCurrentContext();
        if (!traceContext || !traceContext.traceId) {
            return;
        }

        try {
            await TraceService.completeTrace(traceContext.traceId, traceContext.userId);

            // Clean up context
            contextStore.delete(traceContext.traceId);
            if (this.config?.sessionId) {
                this.activeTraces.delete(this.config.sessionId);
            }

            logger.info('Trace completed', { traceId: traceContext.traceId });
        } catch (error) {
            logger.error('Failed to complete trace', { error, traceId: traceContext.traceId });
        }
    }

    /**
     * Automatically instrument an AI API call
     */
    static async instrumentAICall<T>(
        callName: string,
        provider: string,
        model: string,
        prompt: string,
        parameters: Record<string, any>,
        apiCall: () => Promise<T>,
        parseResponse?: (response: T) => {
            completion: string;
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            cost?: number;
        }
    ): Promise<T> {
        const startTime = new Date();
        let spanId = '';

        try {
            // Estimate tokens and cost beforehand
            const estimatedPromptTokens = estimateTokens(prompt);
            const estimatedCost = calculateCost(estimatedPromptTokens, 0, provider, model);

            // Start span
            const metadata: AICallMetadata = {
                provider,
                model,
                prompt,
                promptTokens: estimatedPromptTokens,
                completionTokens: 0,
                totalTokens: estimatedPromptTokens,
                cost: estimatedCost,
                parameters,
                startTime,
                cacheHit: false,
                retryCount: 0
            };

            spanId = await this.addSpan(callName, 'ai_call', metadata);

            // Make the actual API call
            const response = await apiCall();
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            // Parse response if parser provided
            let responseData;
            if (parseResponse) {
                try {
                    responseData = parseResponse(response);
                } catch (parseError) {
                    logger.warn('Failed to parse AI response', { parseError });
                }
            }

            // Complete span with actual data
            if (spanId) {
                const actualCost = responseData?.cost || calculateCost(
                    responseData?.promptTokens || estimatedPromptTokens,
                    responseData?.completionTokens || 0,
                    provider,
                    model
                );

                await this.completeSpan(spanId, {
                    endTime,
                    duration,
                    aiCall: {
                        completion: responseData?.completion,
                        promptTokens: responseData?.promptTokens,
                        completionTokens: responseData?.completionTokens,
                        totalTokens: responseData?.totalTokens,
                        cost: actualCost
                    },
                    logs: [{
                        level: 'info',
                        message: 'AI call completed successfully',
                        data: {
                            duration,
                            cost: actualCost,
                            tokens: responseData?.totalTokens || estimatedPromptTokens
                        }
                    }]
                });
            }

            return response;
        } catch (error) {
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            logger.error('AI call failed', { error, provider, model, duration });

            // Complete span with error
            if (spanId) {
                await this.completeSpan(spanId, {
                    endTime,
                    duration,
                    logs: [{
                        level: 'error',
                        message: 'AI call failed',
                        data: {
                            error: error instanceof Error ? error.message : String(error),
                            duration
                        }
                    }]
                });
            }

            throw error;
        }
    }

    /**
     * Setup automatic instrumentation for common AI libraries
     */
    private static setupAutoInstrumentation(): void {
        try {
            // Instrument OpenAI
            this.instrumentOpenAI();
            // Instrument Anthropic
            this.instrumentAnthropic();
            // Instrument other providers...

            logger.info('Auto-instrumentation setup completed');
        } catch (error) {
            logger.error('Failed to setup auto-instrumentation', { error });
        }
    }

    /**
     * Instrument OpenAI SDK
     */
    private static instrumentOpenAI(): void {
        try {
            // This would require dynamic import and monkey-patching
            // For now, we'll just log that it's available
            logger.debug('OpenAI instrumentation available');
        } catch (error) {
            logger.debug('OpenAI not available for instrumentation');
        }
    }

    /**
     * Instrument Anthropic SDK
     */
    private static instrumentAnthropic(): void {
        try {
            // Similar to OpenAI instrumentation
            logger.debug('Anthropic instrumentation available');
        } catch (error) {
            logger.debug('Anthropic not available for instrumentation');
        }
    }

    /**
     * Get current trace context
     */
    private static getCurrentContext(): TraceContext | null {
        if (!this.config?.sessionId) {
            return null;
        }

        const traceId = this.activeTraces.get(this.config.sessionId);
        if (!traceId) {
            return null;
        }

        return contextStore.get(traceId) || null;
    }

    /**
     * Create a mock context for when tracing is disabled
     */
    private static createMockContext(): TraceContext {
        return {
            traceId: '',
            userId: this.config?.userId || '',
            projectId: this.config?.projectId,
            metadata: {}
        };
    }

    /**
     * Set current trace context (for manual context management)
     */
    static setContext(context: TraceContext): void {
        if (context.traceId) {
            contextStore.set(context.traceId, context);
            if (this.config?.sessionId) {
                this.activeTraces.set(this.config.sessionId, context.traceId);
            }
        }
    }

    /**
     * Clear current trace context
     */
    static clearContext(): void {
        if (this.config?.sessionId) {
            const traceId = this.activeTraces.get(this.config.sessionId);
            if (traceId) {
                contextStore.delete(traceId);
                this.activeTraces.delete(this.config.sessionId);
            }
        }
    }

    /**
     * Create a child context for nested operations
     */
    static createChildContext(spanId: string): TraceContext | null {
        const currentContext = this.getCurrentContext();
        if (!currentContext) {
            return null;
        }

        return {
            ...currentContext,
            spanId,
            parentSpanId: currentContext.spanId
        };
    }

    /**
     * Utility method to wrap any async function with tracing
     */
    static async withTrace<T>(
        traceName: string,
        operation: () => Promise<T>,
        metadata?: Record<string, any>
    ): Promise<T> {
        const context = await this.startTrace(traceName, metadata);

        try {
            const result = await operation();
            await this.completeTrace(context);
            return result;
        } catch (error) {
            await this.completeTrace(context);
            throw error;
        }
    }

    /**
     * Utility method to wrap any async function with a span
     */
    static async withSpan<T>(
        spanName: string,
        operation: 'ai_call' | 'processing' | 'database' | 'http_request' | 'custom',
        asyncOperation: () => Promise<T>,
        metadata?: Record<string, any>
    ): Promise<T> {
        const spanId = await this.addSpan(spanName, operation);
        const startTime = new Date();

        try {
            const result = await asyncOperation();
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            await this.completeSpan(spanId, {
                endTime,
                duration,
                logs: [{
                    level: 'info',
                    message: 'Operation completed successfully',
                    data: { duration, ...metadata }
                }]
            });

            return result;
        } catch (error) {
            const endTime = new Date();
            const duration = endTime.getTime() - startTime.getTime();

            await this.completeSpan(spanId, {
                endTime,
                duration,
                logs: [{
                    level: 'error',
                    message: 'Operation failed',
                    data: {
                        error: error instanceof Error ? error.message : String(error),
                        duration,
                        ...metadata
                    }
                }]
            });

            throw error;
        }
    }

    /**
     * Get instrumentation statistics
     */
    static getStats(): {
        activeTraces: number;
        totalContexts: number;
        config: InstrumentationConfig | null;
    } {
        return {
            activeTraces: this.activeTraces.size,
            totalContexts: contextStore.size,
            config: this.config
        };
    }
} 