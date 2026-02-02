import { Request } from 'express';
import { loggingService } from '../../logging.service';
import { AICostTrackerService } from '../../aiCostTracker.service';
import { latencyRouterService } from '../../latencyRouter.service';
import { costSimulatorService } from '../../costSimulator.service';

// Smart Retry defaults (as per documentation)
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_FACTOR = 2;
const DEFAULT_RETRY_MIN_TIMEOUT = 1000; // 1 second
const DEFAULT_RETRY_MAX_TIMEOUT = 10000; // 10 seconds

/**
 * Interface for usage tracking metadata
 */
export interface UsageTrackingMetadata {
    service: string;
    model: string;
    endpoint: string;
    projectId?: string;
    tags: string[];
    costAllocation?: any;
    traceId?: string;
    traceName?: string;
    traceStep?: string;
    traceSequence?: number;
    requestId?: string;
    metadata: {
        workspace: { gatewayRequest: boolean };
        requestType: string;
        executionTime: number;
        contextFiles: string[];
        generatedFiles: string[];
        retryInfo?: {
            enabled: boolean;
            attempts: number;
            maxRetries: number;
            factor: number;
            minTimeout: number;
            maxTimeout: number;
        };
        traceContext: {
            traceId?: string;
            traceName?: string;
            traceStep?: string;
            traceSequence?: number;
            sessionId?: string;
        };
        requestId?: string;
    };
}

/**
 * GatewayAnalyticsService - Handles request analytics, metrics, and logging
 * 
 * @description This service extracts all analytics and tracking business logic from the gateway controller,
 * including usage tracking, cost estimation, latency monitoring, simulation recording, and proxy key usage.
 */
export class GatewayAnalyticsService {
    /**
     * Track usage and costs for the gateway request
     * 
     * @param req - Express request object
     * @param response - Response data from AI provider
     * @param retryAttempts - Number of retry attempts made
     */
    static async trackUsage(req: Request, response: any, retryAttempts?: number): Promise<void> {
        const context = req.gatewayContext!;

        try {
            // Extract prompt from request body
            let extractedPrompt = '';
            try {
                if (req.body && !context.omitRequest) {
                    if (req.body.prompt) {
                        extractedPrompt = req.body.prompt;
                    } else if (req.body.messages && Array.isArray(req.body.messages)) {
                        // For OpenAI/Claude style messages
                        extractedPrompt = req.body.messages
                            .map((msg: any) => `${msg.role}: ${msg.content}`)
                            .join('\n');
                    } else if (req.body.input) {
                        extractedPrompt = req.body.input;
                    }
                }
            } catch (error: any) {
                loggingService.warn('Could not extract prompt from request', {
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    requestId: req.headers['x-request-id'] as string
                });
            }

            // Don't track if request content should be omitted
            const trackingRequest = context.omitRequest ? 
                { message: 'Request content omitted for privacy' } : 
                { 
                    ...req.body, 
                    prompt: extractedPrompt,
                    model: req.body.model || context.modelOverride || 'unknown'
                };

            const trackingResponse = context.omitResponse ? 
                { message: 'Response content omitted for privacy' } : 
                response;

            // Extract model from request body if available
            let model = 'unknown';
            try {
                if (req.body && req.body.model) {
                    model = req.body.model;
                } else if (context.modelOverride) {
                    model = context.modelOverride;
                }
            } catch (error: any) {
                loggingService.warn('Could not extract model from request', {
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    requestId: req.headers['x-request-id'] as string
                });
            }

            // Build metadata for tracking
            const metadata: UsageTrackingMetadata = {
                service: this.inferServiceFromUrl(context.targetUrl!),
                model: model,
                endpoint: req.path,
                projectId: context.projectId || context.budgetId, // Use new projectId header or fallback to budgetId
                tags: context.properties ? Object.keys(context.properties) : [],
                costAllocation: context.properties,
                // Add workflow tracking data
                traceId: context.traceId,
                traceName: context.traceName,
                traceStep: context.traceStep,
                // Add request ID for feedback tracking
                requestId: context.requestId,
                metadata: {
                    workspace: { gatewayRequest: true },
                    requestType: 'gateway-proxy',
                    executionTime: Date.now() - context.startTime,
                    contextFiles: context.sessionId ? [context.sessionId] : [],
                    generatedFiles: context.traceId ? [context.traceId] : [],
                    // Include retry information
                    retryInfo: retryAttempts !== undefined ? {
                        enabled: context.retryEnabled ?? false,
                        attempts: retryAttempts,
                        maxRetries: context.retryCount ?? DEFAULT_RETRY_COUNT,
                        factor: context.retryFactor ?? DEFAULT_RETRY_FACTOR,
                        minTimeout: context.retryMinTimeout ?? DEFAULT_RETRY_MIN_TIMEOUT,
                        maxTimeout: context.retryMaxTimeout ?? DEFAULT_RETRY_MAX_TIMEOUT
                    } : undefined,
                    // Include agent trace context in metadata
                    traceContext: {
                        traceId: context.traceId,
                        traceName: context.traceName,
                        traceStep: context.traceStep,
                        traceSequence: (context as any).traceSequence,
                        sessionId: context.sessionId
                    },
                    // Add request ID for feedback correlation
                    requestId: context.requestId
                }
            };

            // Track with existing service
            await AICostTrackerService.trackRequest(
                trackingRequest,
                trackingResponse,
                context.userId!,
                metadata
            );

            // Update proxy key usage if this was a proxy key request
            if (context.proxyKeyId) {
                try {
                    // Calculate cost (simplified - you may want to use the actual cost calculation)
                    const estimatedCost = this.estimateRequestCost(req.body, response);
                    
                    // Import KeyVaultService dynamically to avoid circular dependency
                    const { KeyVaultService } = await import('../../keyVault.service');
                    await KeyVaultService.updateProxyKeyUsage(context.proxyKeyId, estimatedCost, 1);
                    
                    loggingService.info('Proxy key usage updated', {
                        proxyKeyId: context.proxyKeyId,
                        cost: estimatedCost,
                        userId: context.userId,
                        requestId: req.headers['x-request-id'] as string
                    });
                } catch (error: any) {
                    loggingService.warn('Failed to update proxy key usage', {
                        error: error.message || 'Unknown error',
                        stack: error.stack,
                        requestId: req.headers['x-request-id'] as string
                    });
                    // Don't fail the request if proxy key usage tracking fails
                }
            }

            loggingService.info('Gateway usage tracked successfully', {
                userId: context.userId,
                service: metadata.service,
                projectId: context.budgetId,
                traceId: context.traceId,
                traceName: context.traceName,
                traceStep: context.traceStep,
                retryAttempts: retryAttempts || 0,
                retryEnabled: context.retryEnabled,
                proxyKeyId: context.proxyKeyId,
                requestId: req.headers['x-request-id'] as string
            });

        } catch (error: any) {
            loggingService.error('Failed to track gateway usage', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: req.headers['x-request-id'] as string
            });
            // Don't fail the request if tracking fails
        }
    }

    /**
     * Track latency for routing decisions
     * 
     * @param provider - Provider name
     * @param model - Model name
     * @param latency - Latency in milliseconds
     * @param success - Whether the request succeeded
     */
    static async trackLatency(
        provider: string,
        model: string,
        latency: number,
        success: boolean
    ): Promise<void> {
        try {
            await latencyRouterService.trackModelLatency(provider, model, latency, success);
        } catch (error: any) {
            loggingService.warn('Failed to track latency', {
                error: error.message || 'Unknown error',
                provider,
                model,
                latency,
                success
            });
        }
    }

    /**
     * Record simulation accuracy for cost prediction improvement
     * 
     * @param simulationId - Simulation request ID
     * @param actualCost - Actual cost incurred
     * @param estimatedCost - Estimated cost from simulation
     */
    static recordSimulationAccuracy(
        simulationId: string,
        actualCost: number,
        estimatedCost: number
    ): void {
        try {
            costSimulatorService.recordActualCost(
                simulationId,
                actualCost,
                estimatedCost
            );
            
            loggingService.debug('Simulation accuracy recorded', {
                simulationId,
                actualCost,
                estimatedCost,
                accuracy: ((1 - Math.abs(actualCost - estimatedCost) / estimatedCost) * 100).toFixed(2) + '%'
            });
        } catch (error: any) {
            loggingService.warn('Failed to record simulation accuracy', {
                error: error.message || 'Unknown error',
                simulationId,
                actualCost,
                estimatedCost
            });
        }
    }

    /**
     * Record model performance for dynamic routing thresholds
     * 
     * @param req - Express request object
     * @param response - Response data
     * @param context - Gateway context
     */
    static async recordModelPerformance(
        req: Request,
        response: any,
        context: any
    ): Promise<void> {
        try {
            const { IntelligentRouterService } = await import('../../intelligentRouter.service');
            const router = IntelligentRouterService.getInstance();

            const modelId = req.body?.model || context.modelOverride || 'unknown';
            const latency = Date.now() - (context.startTime || Date.now());
            const cost = context.cost || 0;
            const success = response.status >= 200 && response.status < 300;

            router.recordModelPerformance(modelId, latency, cost, success);

            loggingService.debug('Recorded model performance for dynamic routing', {
                modelId,
                latency,
                cost,
                success
            });
        } catch (error) {
            // Fail silently - this is non-critical telemetry
            loggingService.debug('Failed to record model performance', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Estimate cost of a request (simplified calculation)
     * 
     * @param requestBody - Request body
     * @param response - Response data
     * @returns Estimated cost in USD
     */
    static estimateRequestCost(requestBody: any, response: any): number {
        try {
            // Simple estimation based on token usage from response
            if (response && response.usage) {
                const promptTokens = response.usage.prompt_tokens || 0;
                const completionTokens = response.usage.completion_tokens || 0;
                
                // Use basic pricing (can be refined based on actual model)
                const promptCost = promptTokens * 0.00001; // $0.01 per 1K tokens
                const completionCost = completionTokens * 0.00002; // $0.02 per 1K tokens
                
                return promptCost + completionCost;
            }
            
            // Fallback estimation based on request size
            const requestSize = JSON.stringify(requestBody || {}).length;
            return Math.max(0.001, requestSize * 0.000001); // Minimum $0.001
        } catch (error: any) {
            loggingService.warn('Failed to estimate request cost', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return 0.001; // Default minimum cost
        }
    }

    /**
     * Infer service name from target URL
     * 
     * @param url - Target URL
     * @returns Service name
     */
    static inferServiceFromUrl(url: string): string {
        const hostname = new URL(url).hostname.toLowerCase();
        
        if (hostname.includes('openai.com')) return 'openai';
        if (hostname.includes('anthropic.com')) return 'anthropic';
        if (hostname.includes('googleapis.com')) return 'google-ai';
        if (hostname.includes('cohere.ai')) return 'cohere';
        if (hostname.includes('amazonaws.com')) return 'aws-bedrock';
        if (hostname.includes('azure.com')) return 'azure';
        if (hostname.includes('deepseek.com')) return 'deepseek';
        if (hostname.includes('groq.com')) return 'groq';
        if (hostname.includes('huggingface.co')) return 'huggingface';
        
        return 'openai'; // Default to openai instead of unknown
    }

    /**
     * Log gateway request initiation with comprehensive context
     * 
     * @param req - Express request object
     */
    static logRequestStart(req: Request): void {
        const context = req.gatewayContext!;
        
        loggingService.info('=== GATEWAY PROXY REQUEST STARTED ===', {
            targetUrl: context.targetUrl,
            userId: context.userId,
            cacheEnabled: context.cacheEnabled,
            retryEnabled: context.retryEnabled,
            retryConfig: context.retryEnabled ? {
                count: context.retryCount || DEFAULT_RETRY_COUNT,
                factor: context.retryFactor || DEFAULT_RETRY_FACTOR,
                minTimeout: context.retryMinTimeout || DEFAULT_RETRY_MIN_TIMEOUT,
                maxTimeout: context.retryMaxTimeout || DEFAULT_RETRY_MAX_TIMEOUT
            } : null,
            cacheUserScope: context.cacheUserScope,
            cacheTTL: context.cacheTTL,
            cacheBucketMaxSize: context.cacheBucketMaxSize,
            requestId: req.headers['x-request-id'] as string
        });
    }

    /**
     * Log failover request details
     * 
     * @param context - Gateway context
     * @param requestId - Request ID from headers
     */
    static logFailoverRequest(context: any, requestId: string): void {
        loggingService.info('Processing failover request', { 
            requestId: context.requestId,
            headerRequestId: requestId
        });
    }

    /**
     * Log failover success
     * 
     * @param context - Gateway context
     * @param failoverResult - Failover execution result
     * @param requestId - Request ID from headers
     */
    static logFailoverSuccess(context: any, failoverResult: any, requestId: string): void {
        loggingService.info('Failover request succeeded', {
            requestId: context.requestId,
            successfulProviderIndex: failoverResult.successfulProviderIndex,
            totalDuration: failoverResult.totalDuration,
            providersAttempted: failoverResult.providersAttempted,
            headerRequestId: requestId
        });
    }

    /**
     * Log failover failure
     * 
     * @param context - Gateway context
     * @param error - Error that occurred
     * @param requestId - Request ID from headers
     */
    static logFailoverError(context: any, error: any, requestId: string): void {
        loggingService.error('Failover request failed', {
            requestId: context.requestId,
            error: error.message || 'Unknown error',
            stack: error.stack,
            headerRequestId: requestId
        });
    }
}
