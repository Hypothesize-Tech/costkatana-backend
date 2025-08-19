import { Request, Response } from 'express';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { AICostTrackerService } from '../services/aiCostTracker.service';
import { ProjectService } from '../services/project.service';
import { FailoverService } from '../services/failover.service';
import { redisService } from '../services/redis.service';
import { IntelligentRoutingService } from '../services/intelligentRouting.service';
import { CPIOptimizationStrategy } from '../types/cpi.types';
import https from 'https';

// Create a connection pool for better performance
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000
});

interface CacheEntry {
    response: any;
    timestamp: number;
    headers: Record<string, string>;
    ttl?: number;
    userScope?: string;
}
const DEFAULT_CACHE_TTL = 604800; // 7 days in seconds for Redis

// Smart Retry defaults (as per documentation)
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_FACTOR = 2;
const DEFAULT_RETRY_MIN_TIMEOUT = 1000; // 1 second
const DEFAULT_RETRY_MAX_TIMEOUT = 10000; // 10 seconds

// Circuit breaker for provider endpoints
const circuitBreakers = new Map<string, { failures: number; lastFailure: number; state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }>();

const CIRCUIT_BREAKER_THRESHOLD = 5; // Number of failures before opening
const CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds timeout

export class GatewayController {
    /**
     * Main gateway proxy handler - routes requests to AI providers
     */
    static async proxyRequest(req: Request, res: Response): Promise<void> {
        // Check if intelligent routing is enabled
        if (req.headers['x-costkatana-intelligent-routing'] === 'true') {
            await this.handleIntelligentRouting(req, res);
            return;
        }

        // Fall back to standard routing
        await this.handleStandardRouting(req, res);
    }

    /**
     * Handle intelligent routing using CPI system
     */
    private static async handleIntelligentRouting(req: Request, res: Response): Promise<void> {
        try {
            const context = req.gatewayContext!;
            
            logger.info('=== INTELLIGENT ROUTING REQUEST STARTED ===', {
                requestId: context.requestId,
                userId: context.userId,
                intelligentRouting: true
            });

            // Parse optimization strategy from headers
            const strategy = this.parseOptimizationStrategy(req);
            
            // Get intelligent routing decision
            const routingDecision = await IntelligentRoutingService.getRoutingDecision(
                req.body,
                strategy,
                (context as any).availableProviders
            );

            logger.info('Intelligent routing decision made', {
                selectedProvider: routingDecision.selectedProvider,
                selectedModel: routingDecision.selectedModel,
                cpiScore: routingDecision.confidence,
                reasoning: routingDecision.reasoning
            });

            // Update context with selected provider
            context.targetUrl = this.getProviderUrl(routingDecision.selectedProvider);
            (context as any).selectedModel = routingDecision.selectedModel;
            (context as any).routingDecision = routingDecision;

            // Add routing headers
            res.setHeader('CostKatana-Intelligent-Routing', 'true');
            res.setHeader('CostKatana-Selected-Provider', routingDecision.selectedProvider);
            res.setHeader('CostKatana-Selected-Model', routingDecision.selectedModel);
            res.setHeader('CostKatana-CPI-Score', routingDecision.confidence.toString());
            res.setHeader('CostKatana-Routing-Confidence', routingDecision.confidence.toString());

            // Proceed with standard routing using the selected provider
            await this.handleStandardRouting(req, res);

        } catch (error) {
            logger.error('Intelligent routing failed, falling back to standard routing:', error);
            
            // Fall back to standard routing
            await this.handleStandardRouting(req, res);
        }
    }

    /**
     * Handle standard routing (existing logic)
     */
    private static async handleStandardRouting(req: Request, res: Response): Promise<void> {
        const context = req.gatewayContext!;
        
                    logger.info('=== GATEWAY PROXY REQUEST STARTED ===', {
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
                cacheBucketMaxSize: context.cacheBucketMaxSize
            });

        try {
            // Check cache first if enabled
            if (context.cacheEnabled) {
                const cachedResponse = await GatewayController.checkCache(req);
                if (cachedResponse) {
                    logger.info('Cache hit - returning cached response');
                    res.setHeader('CostKatana-Cache-Status', 'HIT');
                    
                    // Add CostKatana-Request-Id header for feedback tracking
                    if (context.requestId) {
                        res.setHeader('CostKatana-Request-Id', context.requestId);
                    }
                    
                    res.status(200).json(cachedResponse.response);
                    return;
                }
            }

            // Check budget constraints if budget ID is provided
            if (context.budgetId) {
                const budgetCheck = await GatewayController.checkBudgetConstraints(req);
                if (!budgetCheck.allowed) {
                    res.status(429).json({
                        error: 'Budget limit exceeded',
                        message: budgetCheck.message,
                        budgetId: context.budgetId
                    });
                    return;
                }
            }

            // Check firewall if enabled
            if (context.firewallEnabled || context.firewallAdvanced) {
                const firewallResult = await GatewayController.checkFirewall(req);
                if (firewallResult.isBlocked) {
                    // Determine response code based on containment action
                    let statusCode = 400;
                    let errorCode = 'PROMPT_BLOCKED_BY_FIREWALL';
                    
                    if (firewallResult.containmentAction === 'human_review') {
                        statusCode = 202; // Accepted, but requires review
                        errorCode = 'PROMPT_REQUIRES_REVIEW';
                    }

                    const response: any = {
                        success: false,
                        error: {
                            code: errorCode,
                            message: firewallResult.containmentAction === 'human_review'
                                ? 'The request requires human review due to security considerations.'
                                : 'The request was blocked by the CostKATANA security system due to a detected threat.',
                            details: `${firewallResult.reason}. View threat category and details in your CostKATANA security dashboard for request ID: ${req.headers['x-request-id'] || 'unknown'}`
                        },
                        security: {
                            category: firewallResult.threatCategory,
                            confidence: firewallResult.confidence,
                            riskScore: firewallResult.riskScore,
                            stage: firewallResult.stage,
                            containmentAction: firewallResult.containmentAction,
                            matchedPatterns: firewallResult.matchedPatterns?.length || 0
                        }
                    };

                    // Add human review information if applicable
                    if (firewallResult.humanReviewId) {
                        response.humanReview = {
                            reviewId: firewallResult.humanReviewId,
                            status: 'pending',
                            message: 'Your request is pending human review. You will be notified once reviewed.'
                        };
                    }

                    res.status(statusCode).json(response);
                    return;
                }
            }

            // Handle failover vs single provider requests
            let response: AxiosResponse;
            let retryAttempts = 0;
            let requestSuccess = false;
            let failoverProviderIndex = -1;

            if (context.failoverEnabled && context.failoverPolicy) {
                // Handle failover request
                logger.info('Processing failover request', { requestId: context.requestId });
                
                try {
                    const policy = FailoverService.parseFailoverPolicy(context.failoverPolicy);
                    const proxyRequest = await GatewayController.prepareProxyRequest(req);
                    
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
                            config: proxyRequest
                        } as AxiosResponse;
                        
                        failoverProviderIndex = failoverResult.successfulProviderIndex;
                        requestSuccess = true;

                        logger.info('Failover request succeeded', {
                            requestId: context.requestId,
                            successfulProviderIndex: failoverProviderIndex,
                            totalDuration: failoverResult.totalDuration,
                            providersAttempted: failoverResult.providersAttempted
                        });
                    } else {
                        throw new Error(`All ${failoverResult.providersAttempted} providers failed: ${failoverResult.finalError?.message || 'Unknown error'}`);
                    }
                } catch (error) {
                    logger.error('Failover request failed', {
                        requestId: context.requestId,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                    throw error;
                }
            } else {
                // Handle single provider request (existing logic)
                const proxyRequest = await GatewayController.prepareProxyRequest(req);
                
                // Check circuit breaker
                const provider = GatewayController.inferServiceFromUrl(context.targetUrl!);
                if (!GatewayController.checkCircuitBreaker(provider)) {
                    res.status(503).json({
                        error: 'Service temporarily unavailable',
                        message: `Circuit breaker is open for ${provider}`,
                        retryAfter: Math.ceil(CIRCUIT_BREAKER_TIMEOUT / 1000)
                    });
                    return;
                }
                
                try {
                    if (context.retryEnabled) {
                        const result = await GatewayController.makeRequestWithRetry(proxyRequest, context);
                        response = result.response;
                        retryAttempts = result.retryAttempts;
                    } else {
                        response = await axios(proxyRequest);
                    }
                    requestSuccess = true;
                } catch (error) {
                    // If the main request fails, try with a different approach
                    logger.warn('Primary request failed, trying fallback approach');
                    
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
                            const result = await GatewayController.makeRequestWithRetry(fallbackRequest, context);
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
                const provider = GatewayController.inferServiceFromUrl(context.targetUrl!);
                GatewayController.updateCircuitBreaker(provider, true);
            }

            // Process the response
            const processedResponse = await GatewayController.processResponse(req, response);

            // Apply output moderation if enabled
            const moderatedResponse = await GatewayController.moderateOutput(req, processedResponse);

            // Cache the response if caching is enabled (cache the moderated response)
            if (context.cacheEnabled) {
                await GatewayController.cacheResponse(req, moderatedResponse.response);
                res.setHeader('CostKatana-Cache-Status', 'MISS');
            }

            // Track usage and costs
            await GatewayController.trackUsage(req, moderatedResponse.response, retryAttempts);

            // Return the response
            res.status(response.status);
            
            // Add CostKatana-Request-Id header for feedback tracking
            if (context.requestId) {
                res.setHeader('CostKatana-Request-Id', context.requestId);
            }
            
            // Add CostKatana-Failover-Index header for failover requests
            if (context.failoverEnabled && failoverProviderIndex >= 0) {
                res.setHeader('CostKatana-Failover-Index', failoverProviderIndex.toString());
            }
            
            // Copy relevant headers from the AI provider response
            const headersToForward = ['content-type', 'content-length', 'content-encoding'];
            headersToForward.forEach(header => {
                if (response.headers[header]) {
                    res.setHeader(header, response.headers[header]);
                }
            });

            // Add moderation headers
            if (moderatedResponse.moderationApplied) {
                res.setHeader('CostKatana-Moderation-Applied', 'true');
                res.setHeader('CostKatana-Moderation-Action', moderatedResponse.action);
                if (moderatedResponse.violationCategories.length > 0) {
                    res.setHeader('CostKatana-Moderation-Categories', moderatedResponse.violationCategories.join(','));
                }
            }

            res.send(moderatedResponse.response);

        } catch (error) {
            logger.error('Gateway proxy error:', error);
            
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                const statusCode = axiosError.response?.status || 500;
                const errorData = axiosError.response?.data || { error: 'Request failed' };
                
                logger.error('Axios error details:', {
                    status: statusCode,
                    data: errorData,
                    url: axiosError.config?.url,
                    method: axiosError.config?.method,
                    headers: axiosError.config?.headers
                });
                
                res.status(statusCode).json(errorData);
            } else {
                logger.error('Non-axios error:', error);
                res.status(500).json({
                    error: 'Gateway error',
                    message: 'Internal server error in gateway',
                    details: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    }

    /**
     * Check if response exists in cache using Redis with semantic matching
     */
    private static async checkCache(req: Request): Promise<CacheEntry | null> {
        const context = req.gatewayContext!;
        
        try {
            // Extract prompt from request body
            const prompt = GatewayController.extractPromptFromRequest(req.body);
            if (!prompt) {
                logger.info('No prompt found in request, skipping cache');
                return null;
            }
            
            // Check Redis cache with semantic matching
            const cacheResult = await redisService.checkCache(prompt, {
                userId: context.cacheUserScope ? context.userId : undefined,
                model: req.body?.model,
                provider: context.provider,
                enableSemantic: context.semanticCacheEnabled !== false,
                enableDeduplication: context.deduplicationEnabled !== false,
                similarityThreshold: context.similarityThreshold || 0.85
            });
            
            if (cacheResult.hit) {
                logger.info('Redis cache hit', { 
                    strategy: cacheResult.strategy,
                    similarity: cacheResult.similarity,
                    userId: context.userId
                });
                
                // Convert to CacheEntry format
                return {
                    response: cacheResult.data,
                    timestamp: Date.now(),
                    headers: {},
                    ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
                    userScope: context.userId
                };
            }
        } catch (error) {
            logger.error('Redis cache check failed:', error);
        }
        
        return null;
    }









    /**
     * Cache the response with Redis and in-memory fallback
     */
    private static async cacheResponse(req: Request, response: any): Promise<void> {
        const context = req.gatewayContext!;
        
        try {
            // Extract prompt for Redis caching
            const prompt = GatewayController.extractPromptFromRequest(req.body);
            
            if (prompt) {
                // Calculate tokens and cost for cache metadata
                const inputTokens = req.gatewayContext?.inputTokens || 0;
                const outputTokens = req.gatewayContext?.outputTokens || 0;
                const cost = req.gatewayContext?.cost || 0;
                
                // Store in Redis with semantic embedding
                await redisService.storeCache(prompt, response, {
                    userId: context.cacheUserScope ? context.userId : undefined,
                    model: req.body?.model,
                    provider: context.provider,
                    ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
                    tokens: inputTokens + outputTokens,
                    cost,
                    enableSemantic: context.semanticCacheEnabled !== false,
                    enableDeduplication: context.deduplicationEnabled !== false
                });
                
                logger.info('Response cached in Redis', { 
                    userId: context.userId,
                    model: req.body?.model,
                    provider: context.provider,
                    ttl: context.cacheTTL || DEFAULT_CACHE_TTL
                });
            }
        } catch (error) {
            logger.error('Failed to cache in Redis:', error);
        }
    }



    /**
     * Check budget constraints before making request
     */
    private static async checkBudgetConstraints(req: Request): Promise<{ allowed: boolean; message?: string }> {
        const context = req.gatewayContext!;
        
        try {
            if (!context.budgetId || !context.userId) {
                return { allowed: true };
            }

            // Get project for budget check
            const projects = await ProjectService.getUserProjects(context.userId);
            const project = projects.find(p => p._id.toString() === context.budgetId);
            
            if (!project) {
                return { allowed: false, message: 'Budget ID not found' };
            }

            // Simple budget check - in production, this would estimate the cost first
            const currentSpending = project.spending.current;
            const budgetAmount = project.budget.amount;
            
            if (currentSpending >= budgetAmount) {
                return { 
                    allowed: false, 
                    message: `Budget limit of ${budgetAmount} ${project.budget.currency} exceeded. Current: ${currentSpending}` 
                };
            }

            return { allowed: true };
        } catch (error) {
            logger.error('Budget check error:', error);
            return { allowed: true }; // Allow on error to prevent blocking
        }
    }

    /**
     * Prepare the proxy request to the AI provider
     */
    private static async prepareProxyRequest(req: Request): Promise<any> {
        const context = req.gatewayContext!;
        
        // Build the full target URL
        const targetUrl = new URL(context.targetUrl!);
        const fullUrl = `${targetUrl.origin}${req.path}`;
        
        // Prepare headers - remove gateway-specific headers
        const headers = { ...req.headers };
        Object.keys(headers).forEach(key => {
            if (key.toLowerCase().startsWith('costkatana-')) {
                delete headers[key];
            }
        });
        
        // Add Content-Type if not present
        if (!headers['content-type']) {
            headers['content-type'] = 'application/json';
        }

        // Add provider API key - check if we have a resolved proxy key first
        let providerApiKey: string | null = null;
        
        if (context.providerKey) {
            // Use the resolved provider API key from proxy key authentication
            providerApiKey = context.providerKey;
            logger.info('Using resolved proxy key for provider:', { 
                hostname: targetUrl.hostname, 
                provider: context.provider,
                proxyKeyId: context.proxyKeyId
            });
        } else {
            // Fall back to environment variables
            providerApiKey = GatewayController.getProviderApiKey(targetUrl.hostname);
            logger.info('Using environment API key for provider:', { 
                hostname: targetUrl.hostname, 
                hasKey: !!providerApiKey 
            });
        }
        
        if (providerApiKey) {
            headers['authorization'] = `Bearer ${providerApiKey}`;
        } else {
            logger.warn('No API key found for provider:', { hostname: targetUrl.hostname });
        }

        // Override model if specified
        let body = req.body;
        if (context.modelOverride && body && typeof body === 'object') {
            body = { ...body, model: context.modelOverride };
        }

        // Add headers to bypass Cloudflare detection
        headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headers['Accept'] = 'application/json, text/plain, */*';
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['Accept-Encoding'] = 'gzip, deflate, br';
        headers['Connection'] = 'keep-alive';
        headers['Sec-Fetch-Dest'] = 'empty';
        headers['Sec-Fetch-Mode'] = 'cors';
        headers['Sec-Fetch-Site'] = 'cross-site';
        
        // Add proper Host header to bypass Cloudflare
        headers['Host'] = targetUrl.hostname;

        return {
            method: req.method,
            url: fullUrl,
            headers,
            data: body,
            timeout: 120000, // 2 minutes timeout
            validateStatus: () => true, // Don't throw on HTTP error status
            httpsAgent: httpsAgent, // Use shared connection pool
            maxRedirects: 5,
            decompress: true
        };
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
                logger.warn(`Circuit breaker opened for ${provider} after ${breaker.failures} failures`);
            }
        }

        circuitBreakers.set(provider, breaker);
    }

    /**
     * Get the appropriate API key for the target provider
     */
    private static getProviderApiKey(hostname: string): string | null {
        const host = hostname.toLowerCase();
        
        if (host.includes('openai.com')) {
            return process.env.OPENAI_API_KEY || null;
        }
        
        if (host.includes('anthropic.com')) {
            return process.env.ANTHROPIC_API_KEY || null;
        }
        
        if (host.includes('googleapis.com')) {
            return process.env.GOOGLE_API_KEY || null;
        }
        
        if (host.includes('amazonaws.com')) {
            // AWS Bedrock uses AWS credentials, not API key
            return null;
        }
        
        if (host.includes('cohere.ai')) {
            return process.env.COHERE_API_KEY || null;
        }
        
        if (host.includes('deepseek.com')) {
            return process.env.DEEPSEEK_API_KEY || null;
        }
        
        if (host.includes('groq.com')) {
            return process.env.GROQ_API_KEY || null;
        }
        
        if (host.includes('huggingface.co')) {
            return process.env.HUGGINGFACE_API_KEY || null;
        }
        
        logger.warn(`No API key configured for provider: ${hostname}`);
        return null;
    }

    /**
     * Make request with configurable retry logic and exponential backoff
     */
    private static async makeRequestWithRetry(
        requestConfig: any, 
        context: any
    ): Promise<{ response: AxiosResponse; retryAttempts: number }> {
        // Get retry configuration from context or use defaults
        const maxRetries = context.retryCount ?? DEFAULT_RETRY_COUNT;
        const retryFactor = context.retryFactor ?? DEFAULT_RETRY_FACTOR;
        const minTimeout = context.retryMinTimeout ?? DEFAULT_RETRY_MIN_TIMEOUT;
        const maxTimeout = context.retryMaxTimeout ?? DEFAULT_RETRY_MAX_TIMEOUT;
        
        let lastError: Error;
        let retryAttempts = 0;
        
        logger.info('Starting request with retry configuration', {
            maxRetries,
            retryFactor,
            minTimeout,
            maxTimeout
        });
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Log attempt
                if (attempt > 0) {
                    logger.info(`Retry attempt ${attempt}/${maxRetries}`);
                }
                
                const response = await axios(requestConfig);
                
                // Log successful response after retries
                if (attempt > 0) {
                    logger.info(`Request succeeded after ${attempt} retry attempts`, {
                        status: response.status,
                        totalAttempts: attempt + 1
                    });
                }
                
                // Return successful responses or client errors (don't retry 4xx except 429)
                if (response.status < 400 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
                    return { response, retryAttempts };
                }
                
                // For 429 (rate limit) and 5xx errors, retry if we have attempts left
                if (attempt < maxRetries) {
                    retryAttempts++;
                    const delay = GatewayController.calculateRetryDelay(attempt, retryFactor, minTimeout, maxTimeout);
                    
                    logger.warn(`Request failed with status ${response.status}, retrying in ${delay}ms`, {
                        attempt: attempt + 1,
                        maxRetries: maxRetries + 1,
                        status: response.status,
                        delay
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                // If this was the last attempt, return the response (even if it's an error)
                return { response, retryAttempts };
                
            } catch (error) {
                lastError = error as Error;
                
                if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError;
                    
                    // Determine if we should retry based on error type
                    const shouldRetry = GatewayController.shouldRetryError(axiosError);
                    
                    if (shouldRetry && attempt < maxRetries) {
                        retryAttempts++;
                        const delay = GatewayController.calculateRetryDelay(attempt, retryFactor, minTimeout, maxTimeout);
                        
                        const errorInfo = axiosError.response 
                            ? `HTTP ${axiosError.response.status}` 
                            : axiosError.code || 'Network Error';
                        
                        logger.warn(`Request failed with ${errorInfo}, retrying in ${delay}ms`, {
                            attempt: attempt + 1,
                            maxRetries: maxRetries + 1,
                            error: errorInfo,
                            delay
                        });
                        
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }
                
                // If we can't or shouldn't retry, throw the error
                if (attempt === maxRetries) {
                    logger.error(`Request failed after ${maxRetries + 1} attempts`, {
                        totalAttempts: maxRetries + 1,
                        retryAttempts,
                        error: lastError.message
                    });
                    throw lastError;
                }
            }
        }
        
        throw lastError!;
    }

    /**
     * Calculate retry delay with exponential backoff and jitter
     */
    private static calculateRetryDelay(
        attempt: number, 
        factor: number, 
        minTimeout: number, 
        maxTimeout: number
    ): number {
        // Calculate exponential backoff: minTimeout * (factor ^ attempt)
        let delay = minTimeout * Math.pow(factor, attempt);
        
        // Cap at maximum timeout
        delay = Math.min(delay, maxTimeout);
        
        // Add jitter (±25% randomness) to avoid thundering herd
        const jitter = delay * 0.25 * (Math.random() - 0.5);
        delay = Math.max(minTimeout, delay + jitter);
        
        return Math.round(delay);
    }

    /**
     * Determine if an error should trigger a retry
     */
    private static shouldRetryError(error: AxiosError): boolean {
        // Network/connection errors - always retry
        if (error.code === 'ECONNRESET' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ECONNABORTED') {
            return true;
        }
        
        // HTTP status-based retries
        if (error.response) {
            const status = error.response.status;
            
            // Rate limiting - always retry
            if (status === 429) {
                return true;
            }
            
            // Server errors - retry
            if (status >= 500) {
                return true;
            }
            
            // Client errors - don't retry (except 429 handled above)
            if (status >= 400 && status < 500) {
                return false;
            }
        }
        
        // Default: retry for unknown errors
        return true;
    }

    /**
     * Process response from AI provider
     */
    private static async processResponse(req: Request, response: AxiosResponse): Promise<any> {
        const context = req.gatewayContext!;
        let responseData = response.data;

        // Apply privacy settings if configured
        if (context.omitResponse) {
            logger.info('Response content omitted due to privacy settings');
            responseData = { 
                message: 'Response content omitted for privacy',
                costKatanaNote: 'Original response was processed but not returned due to CostKatana-Omit-Response header'
            };
        }

        return responseData;
    }

    /**
     * Apply output moderation to AI response
     */
    private static async moderateOutput(req: Request, responseData: any): Promise<{
        response: any;
        moderationApplied: boolean;
        action: string;
        violationCategories: string[];
        isBlocked: boolean;
    }> {
        const context = req.gatewayContext!;

        try {
            // Check if output moderation is enabled via headers
            const outputModerationEnabled = req.headers['costkatana-output-moderation-enabled'] === 'true';
            
            // Default moderation config (can be customized via headers)
            const moderationConfig = {
                enableOutputModeration: outputModerationEnabled,
                toxicityThreshold: parseFloat(req.headers['costkatana-toxicity-threshold'] as string || '0.7'),
                enablePIIDetection: req.headers['costkatana-pii-detection-enabled'] !== 'false',
                enableToxicityCheck: req.headers['costkatana-toxicity-check-enabled'] !== 'false',
                enableHateSpeechCheck: req.headers['costkatana-hate-speech-check-enabled'] !== 'false',
                enableSexualContentCheck: req.headers['costkatana-sexual-content-check-enabled'] !== 'false',
                enableViolenceCheck: req.headers['costkatana-violence-check-enabled'] !== 'false',
                enableSelfHarmCheck: req.headers['costkatana-self-harm-check-enabled'] !== 'false',
                action: (req.headers['costkatana-moderation-action'] as string || 'block') as 'allow' | 'annotate' | 'redact' | 'block'
            };

            if (!moderationConfig.enableOutputModeration) {
                // Return original response without moderation
                return {
                    response: responseData,
                    moderationApplied: false,
                    action: 'allow',
                    violationCategories: [],
                    isBlocked: false
                };
            }

            // Extract content from response
            const responseContent = GatewayController.extractContentFromResponse(responseData);
            
            if (!responseContent) {
                logger.debug('No content found to moderate in response');
                return {
                    response: responseData,
                    moderationApplied: false,
                    action: 'allow',
                    violationCategories: [],
                    isBlocked: false
                };
            }

            // Apply output moderation
            const { OutputModerationService } = await import('../services/outputModerationService');
            const moderationResult = await OutputModerationService.moderateOutput(
                responseContent,
                moderationConfig,
                context.requestId || 'unknown',
                GatewayController.inferModelFromRequest(req)
            );

            logger.info('Output moderation completed', {
                requestId: context.requestId,
                isBlocked: moderationResult.isBlocked,
                action: moderationResult.action,
                violationCategories: moderationResult.violationCategories
            });

            // Handle different moderation actions
            let finalResponse = responseData;
            
            if (moderationResult.isBlocked) {
                switch (moderationResult.action) {
                    case 'block':
                        finalResponse = {
                            error: 'Content blocked by moderation',
                            message: 'The AI response was blocked due to policy violations.',
                            details: `Violation categories: ${moderationResult.violationCategories.join(', ')}`,
                            costKatanaNote: 'Response blocked by CostKATANA output moderation system'
                        };
                        break;
                        
                    case 'redact':
                        if (moderationResult.sanitizedContent) {
                            // Replace original content with sanitized version
                            finalResponse = GatewayController.replaceContentInResponse(responseData, moderationResult.sanitizedContent);
                        }
                        break;
                        
                    case 'annotate':
                        // Add annotation to response
                        if (typeof finalResponse === 'object') {
                            finalResponse.costKatanaModerationNote = `This response was flagged for: ${moderationResult.violationCategories.join(', ')}`;
                        }
                        break;
                        
                    default: // allow
                        break;
                }
            }

            return {
                response: finalResponse,
                moderationApplied: true,
                action: moderationResult.action,
                violationCategories: moderationResult.violationCategories,
                isBlocked: moderationResult.isBlocked
            };

        } catch (error) {
            logger.error('Output moderation error:', error);
            // In case of moderation error, return original response (fail-open)
            return {
                response: responseData,
                moderationApplied: false,
                action: 'allow',
                violationCategories: [],
                isBlocked: false
            };
        }
    }

    /**
     * Extract text content from AI response for moderation
     */
    private static extractContentFromResponse(responseData: any): string | null {
        try {
            if (!responseData) return null;
            
            // Handle different response formats
            if (typeof responseData === 'string') {
                return responseData;
            }
            
            // OpenAI/Anthropic format
            if (responseData.choices && responseData.choices[0]?.message?.content) {
                return responseData.choices[0].message.content;
            }
            
            // Anthropic format
            if (responseData.content && Array.isArray(responseData.content) && responseData.content[0]?.text) {
                return responseData.content[0].text;
            }
            
            // Direct content field
            if (responseData.content) {
                return typeof responseData.content === 'string' ? responseData.content : JSON.stringify(responseData.content);
            }
            
            // Text completion format
            if (responseData.text) {
                return responseData.text;
            }
            
            // Completion format
            if (responseData.completion) {
                return responseData.completion;
            }
            
            // If we can't find specific content fields, stringify the whole response
            return JSON.stringify(responseData);
            
        } catch (error) {
            logger.warn('Error extracting content from response:', error);
            return null;
        }
    }

    /**
     * Replace content in AI response structure
     */
    private static replaceContentInResponse(responseData: any, newContent: string): any {
        try {
            if (!responseData || typeof responseData !== 'object') {
                return newContent;
            }
            
            const modifiedResponse = JSON.parse(JSON.stringify(responseData)); // Deep clone
            
            // Handle different response formats
            if (modifiedResponse.choices && modifiedResponse.choices[0]?.message) {
                modifiedResponse.choices[0].message.content = newContent;
            } else if (modifiedResponse.content && Array.isArray(modifiedResponse.content) && modifiedResponse.content[0]) {
                modifiedResponse.content[0].text = newContent;
            } else if (modifiedResponse.content) {
                modifiedResponse.content = newContent;
            } else if (modifiedResponse.text) {
                modifiedResponse.text = newContent;
            } else if (modifiedResponse.completion) {
                modifiedResponse.completion = newContent;
            } else {
                // If we can't identify the structure, return the new content with a note
                return {
                    ...modifiedResponse,
                    content: newContent,
                    costKatanaModerationNote: 'Content was modified by output moderation'
                };
            }
            
            return modifiedResponse;
            
        } catch (error) {
            logger.warn('Error replacing content in response:', error);
            return responseData;
        }
    }

    /**
     * Infer model from request for moderation purposes
     */
    private static inferModelFromRequest(req: Request): string | undefined {
        try {
            if (req.body?.model) {
                return req.body.model;
            }
            
            // Try to infer from URL path
            const url = req.gatewayContext?.targetUrl || '';
            if (url.includes('claude')) return 'claude';
            if (url.includes('gpt-4')) return 'gpt-4';
            if (url.includes('gpt-3.5')) return 'gpt-3.5';
            if (url.includes('llama')) return 'llama';
            
            return 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    /**
     * Track usage and costs for the request
     */
    private static async trackUsage(req: Request, response: any, retryAttempts?: number): Promise<void> {
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
            } catch (error) {
                logger.warn('Could not extract prompt from request:', error);
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
            } catch (error) {
                logger.warn('Could not extract model from request:', error);
            }

            // Build metadata for tracking
            const metadata = {
                service: GatewayController.inferServiceFromUrl(context.targetUrl!),
                model: model,
                endpoint: req.path,
                projectId: context.projectId || context.budgetId, // Use new projectId header or fallback to budgetId
                tags: context.properties ? Object.keys(context.properties) : [],
                costAllocation: context.properties,
                // Add workflow tracking data
                workflowId: context.workflowId,
                workflowName: context.workflowName,
                workflowStep: context.workflowStep,
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
                        enabled: context.retryEnabled,
                        attempts: retryAttempts,
                        maxRetries: context.retryCount ?? DEFAULT_RETRY_COUNT,
                        factor: context.retryFactor ?? DEFAULT_RETRY_FACTOR,
                        minTimeout: context.retryMinTimeout ?? DEFAULT_RETRY_MIN_TIMEOUT,
                        maxTimeout: context.retryMaxTimeout ?? DEFAULT_RETRY_MAX_TIMEOUT
                    } : undefined,
                    // Include workflow context in metadata
                    workflowContext: {
                        workflowId: context.workflowId,
                        workflowName: context.workflowName,
                        workflowStep: context.workflowStep,
                        sessionId: context.sessionId,
                        traceId: context.traceId
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
                    const estimatedCost = GatewayController.estimateRequestCost(req.body, response);
                    
                    // Import KeyVaultService dynamically to avoid circular dependency
                    const { KeyVaultService } = await import('../services/keyVault.service');
                    await KeyVaultService.updateProxyKeyUsage(context.proxyKeyId, estimatedCost, 1);
                    
                    logger.info('Proxy key usage updated', {
                        proxyKeyId: context.proxyKeyId,
                        cost: estimatedCost,
                        userId: context.userId
                    });
                } catch (error) {
                    logger.warn('Failed to update proxy key usage:', error);
                    // Don't fail the request if proxy key usage tracking fails
                }
            }

            logger.info('Gateway usage tracked successfully', {
                userId: context.userId,
                service: metadata.service,
                projectId: context.budgetId,
                workflowId: context.workflowId,
                workflowName: context.workflowName,
                workflowStep: context.workflowStep,
                retryAttempts: retryAttempts || 0,
                retryEnabled: context.retryEnabled,
                proxyKeyId: context.proxyKeyId
            });

        } catch (error) {
            logger.error('Failed to track gateway usage:', error);
            // Don't fail the request if tracking fails
        }
    }

    /**
     * Infer service name from target URL
     */
    private static inferServiceFromUrl(url: string): string {
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
     * Estimate cost of a request (simplified calculation)
     */
    private static estimateRequestCost(requestBody: any, response: any): number {
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
        } catch (error) {
            logger.warn('Failed to estimate request cost:', error);
            return 0.001; // Default minimum cost
        }
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
        try {
            const redisStats = await redisService.getCacheStats();
            const stats = {
                cache: redisStats,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                timestamp: new Date().toISOString()
            };

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Failed to get gateway stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve gateway statistics'
            });
        }
    }

    /**
     * Get cache statistics and status (Redis only)
     */
    static async getCacheStats(_req: Request, res: Response): Promise<void> {
        try {
            const redisStats = await redisService.getCacheStats();

            res.json({
                success: true,
                data: {
                    redis: redisStats,
                    config: {
                        defaultTTL: DEFAULT_CACHE_TTL,
                        defaultTTLHours: DEFAULT_CACHE_TTL / (60 * 60)
                    }
                }
            });
        } catch (error) {
            logger.error('Failed to get cache stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve cache statistics'
            });
        }
    }

    /**
     * Clear cache entries (Redis only)
     */
    static async clearCache(req: Request, res: Response): Promise<void> {
        try {
            const { userScope, model, provider } = req.query;
            
            const clearedCount = await redisService.clearCache({
                userId: userScope as string,
                model: model as string,
                provider: provider as string
            });

            res.json({
                success: true,
                message: `Redis cache cleared successfully`,
                clearedEntries: clearedCount
            });
        } catch (error) {
            logger.error('Failed to clear cache:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to clear cache'
            });
        }
    }

    /**
     * Check request through comprehensive security system
     */
    private static async checkFirewall(req: Request): Promise<any> {
        const context = req.gatewayContext!;
        
        try {
            // Import LLMSecurityService dynamically to avoid circular dependencies
            const { LLMSecurityService } = await import('../services/llmSecurity.service');
            
            // Extract prompt from request body
            const prompt = GatewayController.extractPromptFromRequest(req.body);
            if (!prompt) {
                // If no prompt found, allow the request
                return {
                    isBlocked: false,
                    confidence: 0.0,
                    reason: 'No prompt content found to analyze',
                    stage: 'prompt-guard',
                    containmentAction: 'allow'
                };
            }

            // Extract tool calls if present (for comprehensive tool security)
            const toolCalls = GatewayController.extractToolCallsFromRequest(req.body);

            // Estimate cost for this request (for analytics)
            const estimatedCost = GatewayController.estimateRequestCost(req.body, null);
            
            // Generate request ID for tracking
            const requestId = req.headers['x-request-id'] as string || 
                             `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Run comprehensive security check
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                prompt,
                requestId,
                context.userId,
                {
                    toolCalls,
                    provenanceSource: context.targetUrl,
                    estimatedCost
                }
            );

            const result = securityCheck.result;

            // Handle different containment actions
            if (result.containmentAction === 'human_review') {
                // For human review, we'll block the request but provide special handling
                return {
                    ...result,
                    isBlocked: true,
                    reason: `Request requires human approval. Review ID: ${securityCheck.humanReviewId}`,
                    humanReviewId: securityCheck.humanReviewId
                };
            } else if (result.containmentAction === 'sandbox') {
                // For sandbox, we could implement request sandboxing
                // For now, we'll allow but log as sandboxed
                logger.info('Request sandboxed - proceeding with monitoring', {
                    requestId,
                    userId: context.userId,
                    threatCategory: result.threatCategory,
                    riskScore: result.riskScore
                });
                
                // Allow the request but mark it as sandboxed
                return {
                    ...result,
                    isBlocked: false,
                    reason: 'Request allowed in sandbox mode - monitoring enabled'
                };
            }

            // Standard block/allow behavior
            if (context.userId && result.isBlocked) {
                // Enhanced logging with new security data
                logger.info('Security system blocked request', {
                    requestId,
                    userId: context.userId,
                    threatCategory: result.threatCategory,
                    confidence: result.confidence,
                    riskScore: result.riskScore,
                    stage: result.stage,
                    containmentAction: result.containmentAction,
                    costSaved: estimatedCost,
                    matchedPatterns: result.matchedPatterns
                });
            }

            return result;

        } catch (error) {
            logger.error('Error in security check', error as Error, {
                userId: context.userId,
                targetUrl: context.targetUrl
            });

            // In case of error, allow the request to proceed (fail-open)
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'Security check failed - allowing request',
                stage: 'prompt-guard',
                containmentAction: 'allow'
            };
        }
    }

    /**
     * Extract prompt text from various request formats
     */
    private static extractPromptFromRequest(requestBody: any): string | null {
        if (!requestBody) return null;

        try {
            // OpenAI format
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                return requestBody.messages
                    .map((msg: any) => msg.content || '')
                    .filter((content: string) => content.trim().length > 0)
                    .join('\n');
            }

            // Anthropic format
            if (requestBody.prompt && typeof requestBody.prompt === 'string') {
                return requestBody.prompt;
            }

            // Google AI format
            if (requestBody.contents && Array.isArray(requestBody.contents)) {
                return requestBody.contents
                    .flatMap((content: any) => content.parts || [])
                    .map((part: any) => part.text || '')
                    .filter((text: string) => text.trim().length > 0)
                    .join('\n');
            }

            // Cohere format
            if (requestBody.message && typeof requestBody.message === 'string') {
                return requestBody.message;
            }

            // Generic text field
            if (requestBody.text && typeof requestBody.text === 'string') {
                return requestBody.text;
            }

            // Input field
            if (requestBody.input && typeof requestBody.input === 'string') {
                return requestBody.input;
            }

            return null;

        } catch (error) {
            logger.error('Error extracting prompt from request', error as Error);
            return null;
        }
    }

    /**
     * Extract tool calls from various request formats
     */
    private static extractToolCallsFromRequest(requestBody: any): any[] | undefined {
        if (!requestBody) return undefined;

        try {
            // OpenAI format - tools can be in different places
            if (requestBody.tools && Array.isArray(requestBody.tools)) {
                return requestBody.tools;
            }

            // Function calling in messages
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                const toolCalls: any[] = [];
                
                requestBody.messages.forEach((msg: any) => {
                    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                        toolCalls.push(...msg.tool_calls);
                    }
                });
                
                return toolCalls.length > 0 ? toolCalls : undefined;
            }

            // Anthropic function calling
            if (requestBody.tools && Array.isArray(requestBody.tools)) {
                return requestBody.tools;
            }

            // Google AI function calling
            if (requestBody.function_declarations && Array.isArray(requestBody.function_declarations)) {
                return requestBody.function_declarations;
            }

            return undefined;

        } catch (error) {
            logger.warn('Error extracting tool calls from request', error as Error);
            return undefined;
        }
    }

    /**
     * Get failover analytics
     */
    static async getFailoverAnalytics(res: Response): Promise<void> {
        try {
            const metrics = FailoverService.getMetrics();
            const healthStatus = FailoverService.getProviderHealthStatus();

            res.json({
                success: true,
                data: {
                    metrics,
                    healthStatus,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting failover analytics:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve failover analytics'
            });
        }
    }

    /**
     * Get firewall analytics
     */
    static async getFirewallAnalytics(req: Request, res: Response): Promise<void> {
        try {
            const { PromptFirewallService } = await import('../services/promptFirewall.service');
            
            const userId = req.query.userId as string;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
            
            const dateRange = startDate && endDate ? { start: startDate, end: endDate } : undefined;
            
            const analytics = await PromptFirewallService.getFirewallAnalytics(userId, dateRange);
            
            res.status(200).json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error('Error getting firewall analytics', error as Error);
            res.status(500).json({
                success: false,
                message: 'Failed to get firewall analytics'
            });
        }
    }

    /**
     * Parse optimization strategy from request headers
     */
    private static parseOptimizationStrategy(req: Request): CPIOptimizationStrategy {
        const strategyHeader = req.headers['x-costkatana-optimization-strategy'];
        
        if (strategyHeader) {
            try {
                return JSON.parse(strategyHeader as string);
            } catch (error) {
                logger.warn('Invalid optimization strategy header, using default');
            }
        }

        // Default balanced strategy
        return {
            strategy: 'balanced',
            weightings: {
                cost: 0.3,
                performance: 0.3,
                quality: 0.2,
                reliability: 0.2
            },
            constraints: {}
        };
    }

    /**
     * Get provider URL based on provider name
     */
    private static getProviderUrl(provider: string): string {
        const providerUrls: Record<string, string> = {
            'openai': 'https://api.openai.com/v1',
            'anthropic': 'https://api.anthropic.com',
            'aws-bedrock': 'https://bedrock-runtime.us-east-1.amazonaws.com',
            'google-ai': 'https://generativelanguage.googleapis.com',
            'cohere': 'https://api.cohere.ai'
        };

        return providerUrls[provider] || 'https://api.openai.com/v1';
    }
}