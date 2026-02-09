import { Request, Response } from 'express';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { loggingService } from '../services/logging.service';
import { FailoverService } from '../services/failover.service';
import { redisService } from '../services/redis.service';
import { BudgetService } from '../services/budget.service';
import { ControllerHelper } from '@utils/controllerHelper';
import {
    GatewayCacheService,
    BudgetEnforcementService,
    GatewayFirewallService,
    GatewayRetryService,
    RequestProcessingService,
    ResponseHandlingService,
    GatewayAnalyticsService
} from '../services/gateway';
import { promptCachingService } from '../services/promptCaching.service';
import { contextEngineeringService } from '../services/contextEngineering.service';
import { AnthropicPromptCaching } from '../services/providers/anthropic/promptCaching';
import { OpenAIPromptCaching } from '../services/providers/openai/promptCaching';
import { GoogleGeminiPromptCaching } from '../services/providers/google/promptCaching';

// Circuit breaker for provider endpoints
const circuitBreakers = new Map<string, { failures: number; lastFailure: number; state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }>();

const CIRCUIT_BREAKER_THRESHOLD = 5; // Number of failures before opening
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds timeout

export class GatewayController {
    // Optimization: Circuit breaker batch processing
    private static circuitBreakerBatch = new Map<string, { success: boolean; timestamp: number }>();
    private static batchTimer?: NodeJS.Timeout;

    // Optimization: Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;

    /**
     * Main gateway proxy handler - routes requests to AI providers with optimizations
     */
    static async proxyRequest(req: Request, res: Response): Promise<void> {
        // Fall back to standard routing
        await this.handleStandardRouting(req, res);
    }

    /**
     * Handle standard routing (existing logic)
     */
    private static async handleStandardRouting(req: Request, res: Response): Promise<void> {
        const context = req.gatewayContext!;
        
        // Log request start using analytics service
        GatewayAnalyticsService.logRequestStart(req);

        try {
            // Parallel security and validation pipeline
            const [cachedResponse, budgetCheck, firewallResult] = await Promise.all([
                context.cacheEnabled ? GatewayCacheService.checkCache(req) : Promise.resolve(null),
                context.budgetId ? BudgetEnforcementService.checkBudgetConstraints(req) : Promise.resolve({ allowed: true }),
                (context.firewallEnabled || context.firewallAdvanced) ? GatewayFirewallService.checkFirewallRules(req) : Promise.resolve({ isBlocked: false })
            ]);

            // Handle cache hit using response service
            if (cachedResponse) {
                ResponseHandlingService.sendCacheHitResponse(req, res, cachedResponse);
                return;
            }

            // Handle budget constraint violation with hard blocking using response service
            if (!budgetCheck.allowed) {
                const blockData = budgetCheck as { 
                    allowed: boolean; 
                    message?: string; 
                    simulation?: any;
                    cheaperAlternatives?: any[];
                };

                ResponseHandlingService.sendBudgetExceededResponse(req, res, blockData);
                return;
            }
            
            // Store reservation ID and simulation data in context for later confirmation/release
            const reservationId = (budgetCheck as { allowed: boolean; reservationId?: string; simulation?: any }).reservationId;
            const simulation = (budgetCheck as { allowed: boolean; simulation?: any }).simulation;
            
            if (reservationId) {
                context.budgetReservationId = reservationId;
            }
            
            if (simulation) {
                context.simulationId = simulation.requestId;
                context.estimatedCost = simulation.originalRequest.estimatedCost;
            }

            // Handle firewall blocking using response service
            if (firewallResult.isBlocked) {
                ResponseHandlingService.sendFirewallBlockedResponse(req, res, firewallResult);
                return;
            }

            // Handle failover vs single provider requests
            let response: AxiosResponse;
            let retryAttempts = 0;
            let requestSuccess = false;
            let failoverProviderIndex = -1;

            if (context.failoverEnabled && context.failoverPolicy) {
                // Handle failover request using analytics logging
                GatewayAnalyticsService.logFailoverRequest(context, req.headers['x-request-id'] as string);
                
                try {
                    const policy = FailoverService.parseFailoverPolicy(context.failoverPolicy);
                    const proxyRequest = await RequestProcessingService.prepareProxyRequest(req);
                    
                    const failoverResult = await FailoverService.executeFailover(
                        proxyRequest,
                        policy,
                        context.requestId
                    );

                    if (failoverResult.success) {
                        response = {
                            data: failoverResult.response,
                            status: failoverResult.statusCode || 200,
                            statusText: 'OK',
                            headers: failoverResult.responseHeaders || {},
                            config: proxyRequest as any
                        } as AxiosResponse;
                        
                        failoverProviderIndex = failoverResult.successfulProviderIndex;
                        requestSuccess = true;

                        GatewayAnalyticsService.logFailoverSuccess(
                            context, 
                            failoverResult, 
                            req.headers['x-request-id'] as string
                        );
                    } else {
                        throw new Error(`All ${failoverResult.providersAttempted} providers failed: ${failoverResult.finalError?.message || 'Unknown error'}`);
                    }
                } catch (error: any) {
                    GatewayAnalyticsService.logFailoverError(
                        context,
                        error,
                        req.headers['x-request-id'] as string
                    );
                    throw error;
                }
            } else {
                // Handle single provider request (existing logic)
                let proxyRequest = await RequestProcessingService.prepareProxyRequest(req);

                // 🚀 PROMPT CACHING: Optimize request for KV-pair caching
                proxyRequest = await this.applyPromptCaching(req, proxyRequest);

                // Apply lazy summarization using request processing service
                proxyRequest = await RequestProcessingService.applyLazySummarization(req, proxyRequest);
                
                // Apply prompt compiler using request processing service
                proxyRequest = await RequestProcessingService.applyPromptCompiler(req, proxyRequest);
                
                // Apply Cortex processing using request processing service
                proxyRequest = await RequestProcessingService.applyCortexProcessing(req, proxyRequest);
                
                // Check circuit breaker
                const provider = RequestProcessingService.inferServiceFromUrl(context.targetUrl!);
                if (!GatewayController.checkCircuitBreaker(provider)) {
                    ResponseHandlingService.sendCircuitBreakerResponse(
                        res, 
                        provider, 
                        Math.ceil(CIRCUIT_BREAKER_TIMEOUT / 1000)
                    );
                    return;
                }
                
                try {
                    if (context.retryEnabled) {
                        const result = await GatewayRetryService.executeWithRetry(proxyRequest, {
                            retryCount: context.retryCount,
                            retryFactor: context.retryFactor,
                            retryMinTimeout: context.retryMinTimeout,
                            retryMaxTimeout: context.retryMaxTimeout
                        });
                        response = result.response;
                        retryAttempts = result.retryAttempts;
                    } else {
                        response = await axios(proxyRequest);
                    }
                    requestSuccess = true;
                } catch (error) {
                    // If the main request fails, try with a different approach
                    loggingService.warn('Primary request failed, trying fallback approach', {
                        requestId: req.headers['x-request-id'] as string
                    });
                    
                    // Try with different headers or endpoint
                    const fallbackRequest = { ...proxyRequest };
                    fallbackRequest.headers = {
                        ...fallbackRequest.headers,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Origin': 'https://openai.com',
                        'Referer': 'https://openai.com/'
                    };
                    
                    try {
                        if (context.retryEnabled) {
                            const result = await GatewayRetryService.executeWithRetry(fallbackRequest, {
                                retryCount: context.retryCount,
                                retryFactor: context.retryFactor,
                                retryMinTimeout: context.retryMinTimeout,
                                retryMaxTimeout: context.retryMaxTimeout
                            });
                            response = result.response;
                            retryAttempts = result.retryAttempts;
                        } else {
                            response = await axios(fallbackRequest);
                        }
                        requestSuccess = true;
                    } catch (fallbackError) {
                        // Both attempts failed
                        GatewayController.updateCircuitBreaker(provider, false);
                        throw fallbackError;
                    }
                }
            }
            
            // Update circuit breaker on success (only for single provider requests)
            if (requestSuccess && !context.failoverEnabled) {
                const provider = RequestProcessingService.inferServiceFromUrl(context.targetUrl!);
                GatewayController.updateCircuitBreaker(provider, true);
                
                // Track latency for routing decisions using analytics service
                const latency = Date.now() - context.startTime;
                const model = req.body?.model || context.modelOverride || 'unknown';
                
                this.queueBackgroundOperation(async () => {
                    await GatewayAnalyticsService.trackLatency(provider, model, latency, true);
                });
            }

            // Parallel response processing and moderation using response handling service
            const processedResponse = await ResponseHandlingService.processResponse(req, response);
            const moderatedResponse = await ResponseHandlingService.moderateOutput(req, processedResponse);

            // Confirm budget reservation with actual cost
            if (context.budgetReservationId) {
                const actualCost = context.cost || 0;
                this.queueBackgroundOperation(async () => {
                    await BudgetService.confirmBudget(context.budgetReservationId!, actualCost);
                    
                    // Record simulation accuracy (Layer 6) using analytics service
                    if (context.simulationId && context.estimatedCost) {
                        GatewayAnalyticsService.recordSimulationAccuracy(
                            context.simulationId,
                            actualCost,
                            context.estimatedCost
                        );
                    }
                });
            }
            
            // Non-blocking background operations
            const provider = RequestProcessingService.inferServiceFromUrl(context.targetUrl!);
            this.queueBackgroundOperation(async () => {
                await Promise.allSettled([
                    context.cacheEnabled ? GatewayCacheService.cacheResponse(req, moderatedResponse.response) : Promise.resolve(),
                    GatewayAnalyticsService.trackUsage(req, moderatedResponse.response, retryAttempts),
                    Promise.resolve(this.updateCircuitBreakerBatched(provider, true)),
                    // Record model performance for dynamic routing
                    GatewayAnalyticsService.recordModelPerformance(req, moderatedResponse.response, context)
                ]);
            });

            // Set cache status header immediately
            if (context.cacheEnabled) {
                res.setHeader('CostKatana-Cache-Status', 'MISS');
            }

            // Add response headers using response handling service
            ResponseHandlingService.addResponseHeaders(req, res, response, moderatedResponse, failoverProviderIndex);

            // Send the response
            res.send(moderatedResponse.response);

        } catch (error: any) {
            // Release budget reservation on error
            if (context.budgetReservationId) {
                this.queueBackgroundOperation(async () => {
                    await BudgetEnforcementService.releaseBudgetReservation(context.budgetReservationId!);
                });
            }
            
            // Track latency for failed requests using analytics service
            if (!context.failoverEnabled) {
                const provider = RequestProcessingService.inferServiceFromUrl(context.targetUrl!);
                const latency = Date.now() - context.startTime;
                const model = req.body?.model || context.modelOverride || 'unknown';
                
                this.queueBackgroundOperation(async () => {
                    await GatewayAnalyticsService.trackLatency(provider, model, latency, false);
                });
            }
            
            loggingService.error('Gateway proxy error', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: req.headers['x-request-id'] as string
            });
            
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                const statusCode = axiosError.response?.status || 500;
                const errorData = axiosError.response?.data || { error: 'Request failed' };
                
                loggingService.error('Axios error details', {
                    status: statusCode,
                    data: errorData,
                    url: axiosError.config?.url,
                    method: axiosError.config?.method,
                    headers: axiosError.config?.headers,
                    requestId: req.headers['x-request-id'] as string
                });
                
                res.status(statusCode).json(errorData);
            } else {
                loggingService.error('Non-axios error', {
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    requestId: req.headers['x-request-id'] as string
                });
                res.status(500).json({
                    error: 'Gateway error',
                    message: 'Internal server error in gateway',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    }

    /**
     * Check circuit breaker state for a provider
     */
    private static checkCircuitBreaker(provider: string): boolean {
        const breaker = circuitBreakers.get(provider);
        if (!breaker) {
            circuitBreakers.set(provider, { failures: 0, lastFailure: 0, state: 'CLOSED' });
            return true;
        }

        const now = Date.now();

        // If circuit is open, check if timeout has passed
        if (breaker.state === 'OPEN') {
            if (now - breaker.lastFailure > CIRCUIT_BREAKER_TIMEOUT) {
                breaker.state = 'HALF_OPEN';
                return true;
            }
            return false;
        }

        return true;
    }

    /**
     * Update circuit breaker state
     */
    private static updateCircuitBreaker(provider: string, success: boolean): void {
        const breaker = circuitBreakers.get(provider) || { failures: 0, lastFailure: 0, state: 'CLOSED' };

        if (success) {
            breaker.failures = 0;
            breaker.state = 'CLOSED';
        } else {
            breaker.failures++;
            breaker.lastFailure = Date.now();
            
            if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
                breaker.state = 'OPEN';
                loggingService.warn(`Circuit breaker opened for ${provider} after ${breaker.failures} failures`, {
                    provider,
                    failures: breaker.failures,
                    threshold: CIRCUIT_BREAKER_THRESHOLD
                });
            }
        }

        circuitBreakers.set(provider, breaker);
    }

    /**
     * Health check endpoint for gateway
     */
    static async healthCheck(_req: Request, res: Response): Promise<void> {
        res.status(200).json({
            status: 'healthy',
            service: 'CostKATANA Gateway',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            cache: 'Redis Only'
        });
    }

    /**
     * Get gateway statistics
     */
    static async getStats(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const redisStats = await redisService.getCacheStats();
            const stats = {
                cache: redisStats,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                timestamp: new Date().toISOString()
            };

            loggingService.info('Gateway stats retrieved successfully', {
                duration: Date.now() - startTime,
                uptime: stats.uptime
            });

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getStats', error, _req as any, res, startTime);
        }
    }

    /**
     * Get cache statistics and status (Redis only)
     */
    static async getCacheStats(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const redisStats = await redisService.getCacheStats();

            loggingService.info('Cache stats retrieved successfully', {
                duration: Date.now() - startTime
            });

            res.json({
                success: true,
                data: {
                    redis: redisStats,
                    config: {
                        defaultTTL: 604800,
                        defaultTTLHours: 604800 / (60 * 60)
                    }
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getCacheStats', error, _req as any, res, startTime);
        }
    }

    /**
     * Clear cache entries (Redis only)
     */
    static async clearCache(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const { userScope, model, provider } = req.query;
            
            const clearedCount = await redisService.clearCache({
                userId: userScope as string,
                model: model as string,
                provider: provider as string
            });

            loggingService.info('Cache cleared successfully', {
                duration: Date.now() - startTime,
                clearedCount
            });

            res.json({
                success: true,
                message: `Redis cache cleared successfully`,
                clearedEntries: clearedCount
            });
        } catch (error: any) {
            ControllerHelper.handleError('clearCache', error, req as any, res, startTime);
        }
    }

    /**
     * Get failover analytics
     */
    static async getFailoverAnalytics(res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const metrics = FailoverService.getMetrics();
            const healthStatus = FailoverService.getProviderHealthStatus();

            loggingService.info('Failover analytics retrieved successfully', {
                duration: Date.now() - startTime
            });

            res.json({
                success: true,
                data: {
                    metrics,
                    healthStatus,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getFailoverAnalytics', error, {} as any, res, startTime);
        }
    }

    /**
     * Get firewall analytics
     */
    static async getFirewallAnalytics(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const { PromptFirewallService } = await import('../services/promptFirewall.service');
            
            const userId = req.query.userId as string;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
            
            const dateRange = startDate && endDate ? { start: startDate, end: endDate } : undefined;
            
            const analytics = await PromptFirewallService.getFirewallAnalytics(userId, dateRange);

            loggingService.info('Firewall analytics retrieved successfully', {
                duration: Date.now() - startTime,
                userId,
                hasDateRange: !!dateRange
            });
            
            res.status(200).json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            ControllerHelper.handleError('getFirewallAnalytics', error, req as any, res, startTime);
        }
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * 🚀 PROMPT CACHING: Apply true KV-pair caching optimizations to requests
     * This implements true prompt caching (not output caching) by optimizing
     * message structure for provider-specific KV-pair caching
     */
    private static async applyPromptCaching(
        req: Request,
        proxyRequest: any
    ): Promise<any> {
        const context = req.gatewayContext!;
        const startTime = Date.now();

        try {
            // Check if prompt caching is enabled
            const promptCachingEnabled = req.headers['costkatana-prompt-caching'] === 'true' ||
                                       context.cortexEnabled === true; // Enable for Cortex requests

            if (!promptCachingEnabled) {
                loggingService.debug('Prompt caching disabled for request', {
                    requestId: context.requestId,
                    userId: context.userId
                });
                return proxyRequest;
            }

            // Detect provider and model
            const provider = this.detectProvider(proxyRequest.url, context.provider);
            const model = this.extractModelFromRequest(proxyRequest.data);

            if (!provider || !model) {
                loggingService.debug('Unable to detect provider/model for prompt caching', {
                    url: proxyRequest.url,
                    provider: context.provider,
                    requestId: context.requestId
                });
                return proxyRequest;
            }

            // Check if provider supports prompt caching
            if (!promptCachingService.isProviderSupported(provider, model)) {
                loggingService.debug('Provider/model does not support prompt caching', {
                    provider,
                    model,
                    requestId: context.requestId
                });
                return proxyRequest;
            }

            // Extract and optimize messages
            const messages = this.extractMessagesFromRequest(proxyRequest.data);
            if (!messages || messages.length === 0) {
                loggingService.debug('No messages found for prompt caching', {
                    requestId: context.requestId
                });
                return proxyRequest;
            }

            // Apply context engineering optimizations
            const optimized = contextEngineeringService.optimizeForCaching(
                messages,
                provider,
                model,
                context.userId
            );

            if (!optimized.cacheAnalysis.isCacheable) {
                loggingService.debug('Messages not suitable for prompt caching', {
                    provider,
                    model,
                    reason: 'Not cacheable',
                    requestId: context.requestId
                });

                // Still apply structure optimization even if not cacheable
                const reorderedMessages = contextEngineeringService.reorderForCaching(messages);
                const updatedRequest = this.updateRequestWithMessages(proxyRequest, reorderedMessages);

                return updatedRequest;
            }

            // Apply provider-specific caching transformations
            let finalMessages = optimized.messages;
            let cacheHeaders: Record<string, string> = {};

            switch (provider.toLowerCase()) {
                case 'anthropic':
                    if (AnthropicPromptCaching.isModelSupported(model)) {
                        const result = AnthropicPromptCaching.processMessages(
                            this.convertToAnthropicFormat(finalMessages),
                            optimized.cacheConfig
                        );
                        finalMessages = this.convertFromAnthropicFormat(result.processedMessages);
                        cacheHeaders = AnthropicPromptCaching.generateCacheHeaders(
                            result.breakpoints,
                            result.metrics.regularTokens! + (result.metrics.cacheCreationTokens || 0),
                            result.metrics.cacheCreationTokens || 0
                        );
                    }
                    break;

                case 'openai':
                    if (OpenAIPromptCaching.isModelSupported(model)) {
                        const openaiMessages = this.convertToOpenAIFormat(finalMessages);
                        finalMessages = this.convertFromOpenAIFormat(
                            OpenAIPromptCaching.optimizeMessageOrder(openaiMessages)
                        );
                        const analysis = OpenAIPromptCaching.analyzeMessages(
                            this.convertToOpenAIFormat(finalMessages),
                            optimized.cacheConfig
                        );
                        cacheHeaders = OpenAIPromptCaching.generateCacheHeaders(analysis);
                    }
                    break;

                case 'google':
                    if (GoogleGeminiPromptCaching.isModelSupported(model)) {
                        const geminiMessages = GoogleGeminiPromptCaching.convertToGeminiFormat(finalMessages);
                        const analysis = GoogleGeminiPromptCaching.analyzeMessages(geminiMessages, optimized.cacheConfig);
                        // Keep structure as-is for Gemini (API handles caching)
                        cacheHeaders = GoogleGeminiPromptCaching.generateCacheHeaders(analysis);
                    }
                    break;
            }

            // Update request with optimized messages
            const updatedRequest = this.updateRequestWithMessages(proxyRequest, finalMessages);

            // Store cache metadata in context for response headers
            context.promptCaching = {
                enabled: true,
                type: optimized.cacheAnalysis.cacheType,
                estimatedSavings: optimized.cacheAnalysis.estimatedSavings,
                cacheHeaders
            };

            const processingTime = Date.now() - startTime;

            loggingService.info('Prompt caching applied to request', {
                provider,
                model,
                cacheType: optimized.cacheAnalysis.cacheType,
                estimatedSavings: optimized.cacheAnalysis.estimatedSavings.toFixed(6),
                processingTimeMs: processingTime,
                requestId: context.requestId,
                userId: context.userId
            });

            return updatedRequest;

        } catch (error) {
            const processingTime = Date.now() - startTime;

            loggingService.error('Error applying prompt caching', {
                error: error instanceof Error ? error.message : String(error),
                provider: context.provider,
                processingTimeMs: processingTime,
                requestId: context.requestId
            });

            // Return original request on error
            return proxyRequest;
        }
    }

    /**
     * Detect provider from URL or context
     */
    private static detectProvider(url: string, contextProvider?: string): string | null {
        if (contextProvider) return contextProvider;

        if (url.includes('anthropic')) return 'anthropic';
        if (url.includes('openai')) return 'openai';
        if (url.includes('googleapis') || url.includes('generativelanguage')) return 'google';
        if (url.includes('bedrock')) return 'anthropic'; // Assume Claude via Bedrock

        return null;
    }

    /**
     * Extract model from request data
     */
    private static extractModelFromRequest(data: any): string | null {
        return data?.model || data?.modelId || null;
    }

    /**
     * Extract messages from various request formats
     */
    private static extractMessagesFromRequest(data: any): any[] | null {
        // OpenAI format
        if (data?.messages && Array.isArray(data.messages)) {
            return data.messages.map((msg: any) => ({
                role: msg.role,
                content: msg.content
            }));
        }

        // Anthropic format
        if (data?.messages && Array.isArray(data.messages)) {
            return data.messages;
        }

        // Generic format
        if (data?.prompt) {
            return [{
                role: 'user',
                content: data.prompt
            }];
        }

        if (data?.input) {
            return [{
                role: 'user',
                content: data.input
            }];
        }

        return null;
    }

    /**
     * Update request with optimized messages
     */
    private static updateRequestWithMessages(proxyRequest: any, messages: any[]): any {
        const updatedRequest = { ...proxyRequest };
        const data = { ...proxyRequest.data };

        // Update based on format
        if (data.messages && Array.isArray(data.messages)) {
            data.messages = messages;
        } else if (data.prompt) {
            // Convert back to single prompt if needed
            data.prompt = messages.map(m => m.content).join('\n');
        } else if (data.input) {
            data.input = messages.map(m => m.content).join('\n');
        }

        updatedRequest.data = data;
        return updatedRequest;
    }

    /**
     * Convert internal message format to Anthropic format
     */
    private static convertToAnthropicFormat(messages: any[]): any[] {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: Array.isArray(msg.content) ? msg.content : [{
                type: 'text',
                text: msg.content
            }]
        }));
    }

    /**
     * Convert from Anthropic format back to internal format
     */
    private static convertFromAnthropicFormat(anthropicMessages: any[]): any[] {
        return anthropicMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Convert internal message format to OpenAI format
     */
    private static convertToOpenAIFormat(messages: any[]): any[] {
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Convert from OpenAI format back to internal format
     */
    private static convertFromOpenAIFormat(openaiMessages: any[]): any[] {
        return openaiMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Background operation queue for non-critical tasks
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
        
        if (!this.backgroundProcessor) {
            this.backgroundProcessor = setTimeout(() => {
                this.processBackgroundQueue();
            }, 100); // Process queue every 100ms
        }
    }

    private static async processBackgroundQueue(): Promise<void> {
        if (this.backgroundQueue.length === 0) {
            this.backgroundProcessor = undefined;
            return;
        }

        const operations = this.backgroundQueue.splice(0, 10); // Process 10 operations at a time
        
        try {
            await Promise.allSettled(operations.map(op => op()));
        } catch (error) {
            loggingService.warn('Background operation failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Continue processing if more operations are queued
        if (this.backgroundQueue.length > 0) {
            this.backgroundProcessor = setTimeout(() => {
                this.processBackgroundQueue();
            }, 100);
        } else {
            this.backgroundProcessor = undefined;
        }
    }

    /**
     * Batched circuit breaker updates for better performance
     */
    private static updateCircuitBreakerBatched(provider: string, success: boolean): void {
        this.circuitBreakerBatch.set(provider, { success, timestamp: Date.now() });
        
        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => {
                this.processBatchedCircuitBreakerUpdates();
            }, 1000); // Batch updates every 1 second
        }
    }

    private static processBatchedCircuitBreakerUpdates(): void {
        if (this.circuitBreakerBatch.size === 0) {
            this.batchTimer = undefined;
            return;
        }

        for (const [provider, update] of Array.from(this.circuitBreakerBatch.entries())) {
            this.updateCircuitBreaker(provider, update.success);
        }

        this.circuitBreakerBatch.clear();
        this.batchTimer = undefined;
    }
}
