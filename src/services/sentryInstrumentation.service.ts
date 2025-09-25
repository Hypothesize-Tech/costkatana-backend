import * as Sentry from '@sentry/node';
import { loggingService } from './logging.service';
import { addBreadcrumb, captureError, setBusinessContext } from '../config/sentry';

/**
 * Sentry Instrumentation Service
 *
 * Provides custom instrumentation for tracking errors and breadcrumbs
 * in key business operations. Performance monitoring is handled by
 * Sentry's automatic instrumentation.
 */
export class SentryInstrumentationService {
    private static instance: SentryInstrumentationService;

    private constructor() {}

    static getInstance(): SentryInstrumentationService {
        if (!SentryInstrumentationService.instance) {
            SentryInstrumentationService.instance = new SentryInstrumentationService();
        }
        return SentryInstrumentationService.instance;
    }

    /**
     * Instrument AI model calls with error tracking and breadcrumbs
     */
    async instrumentAIModelCall<T>(
        operation: string,
        modelName: string,
        inputTokens: number,
        options: {
            userId?: string;
            projectId?: string;
            provider?: string;
            temperature?: number;
            maxTokens?: number;
        },
        operationFn: () => Promise<T>
    ): Promise<T> {
        // Set business context
        setBusinessContext({
            operation: `ai_${operation}`,
            component: 'ai_services',
            feature: 'ai_interactions',
            userId: options.userId,
            projectId: options.projectId
        });

        // Add breadcrumb
        addBreadcrumb(
            `AI ${operation} started with ${modelName}`,
            'ai',
            'info',
            {
                model: modelName,
                provider: options.provider,
                inputTokens,
                temperature: options.temperature,
                maxTokens: options.maxTokens
            }
        );

        const startTime = Date.now();

        try {
            const result = await operationFn();
            const duration = Date.now() - startTime;

            // Add success breadcrumb
            addBreadcrumb(
                `AI ${operation} completed successfully`,
                'ai',
                'info',
                {
                    model: modelName,
                    duration: `${duration}ms`,
                    success: true
                }
            );

            // Log performance metrics
            loggingService.info('AI model call completed', {
                component: 'SentryInstrumentation',
                operation: 'instrumentAIModelCall',
                type: 'ai_performance',
                model: modelName,
                provider: options.provider,
                inputTokens,
                duration,
                success: true
            });

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;

            // Add error breadcrumb
            addBreadcrumb(
                `AI ${operation} failed`,
                'ai',
                'error',
                {
                    model: modelName,
                    duration: `${duration}ms`,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            );

            // Capture error with AI context
            captureError(error as Error, {
                business: {
                    operation: `ai_${operation}`,
                    component: 'ai_services',
                    feature: 'ai_interactions',
                    userId: options.userId,
                    projectId: options.projectId
                },
                tags: {
                    'ai.model': modelName,
                    'ai.operation': operation,
                    'ai.provider': options.provider || 'unknown',
                    'ai.input_tokens': inputTokens.toString(),
                    'error.type': 'ai_model_error'
                },
                extra: {
                    ai: {
                        model: modelName,
                        provider: options.provider,
                        inputTokens,
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        duration
                    }
                }
            });

            // Log error
            loggingService.error('AI model call failed', {
                component: 'SentryInstrumentation',
                operation: 'instrumentAIModelCall',
                type: 'ai_error',
                model: modelName,
                provider: options.provider,
                inputTokens,
                duration,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });

            throw error;
        }
    }

    /**
     * Add custom performance metrics
     */
    addPerformanceMetric(
        name: string,
        value: number,
        tags: Record<string, string> = {}
    ): void {
        // Log to our logging service with performance context
        loggingService.info('Performance metric recorded', {
            component: 'SentryInstrumentation',
            operation: 'addPerformanceMetric',
            type: 'performance_metric',
            metric: name,
            value,
            tags
        });

        // Add breadcrumb for significant metrics
        if (value > 1000) { // Log slow operations
            addBreadcrumb(
                `Performance metric: ${name} = ${value}ms`,
                'performance',
                'warning',
                { name, value, ...tags }
            );
        }
    }

    /**
     * Record custom business events
     */
    recordBusinessEvent(
        eventName: string,
        properties: Record<string, any>,
        level: Sentry.SeverityLevel = 'info'
    ): void {
        // Add breadcrumb
        addBreadcrumb(
            `Business event: ${eventName}`,
            'business',
            level,
            properties
        );

        // Log to our logging service
        loggingService.info('Business event recorded', {
            component: 'SentryInstrumentation',
            operation: 'recordBusinessEvent',
            type: 'business_event',
            event: eventName,
            properties,
            level
        });
    }
}

// Export singleton instance
export const sentryInstrumentation = SentryInstrumentationService.getInstance();