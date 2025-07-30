import { Request, Response } from 'express';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { AICostTrackerService } from '../services/aiCostTracker.service';
import { ProjectService } from '../services/project.service';
import https from 'https';

import crypto from 'crypto';

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

interface CacheBucket {
    entries: CacheEntry[];
    currentIndex: number;
}

// Enhanced in-memory cache with user scoping and buckets
const responseCache = new Map<string, CacheEntry>();
const cacheBuckets = new Map<string, CacheBucket>();
const DEFAULT_CACHE_TTL = 604800000; // 7 days (as per documentation)

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
                    res.status(400).json({
                        success: false,
                        error: {
                            code: 'PROMPT_BLOCKED_BY_FIREWALL',
                            message: 'The request was blocked by the CostKATANA security firewall due to a detected threat.',
                            details: `${firewallResult.reason}. View threat category and details in your CostKATANA dashboard for request ID: ${req.headers['x-request-id'] || 'unknown'}`
                        },
                        threat: {
                            category: firewallResult.threatCategory,
                            confidence: firewallResult.confidence,
                            stage: firewallResult.stage
                        }
                    });
                    return;
                }
            }

            // Prepare the request to the AI provider
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
            
            // Make the request with retry logic if enabled
            let response: AxiosResponse;
            let retryAttempts = 0;
            let requestSuccess = false;
            
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
            
            // Update circuit breaker on success
            if (requestSuccess) {
                GatewayController.updateCircuitBreaker(provider, true);
            }

            // Process the response
            const processedResponse = await GatewayController.processResponse(req, response);

            // Cache the response if caching is enabled
            if (context.cacheEnabled) {
                await GatewayController.cacheResponse(req, processedResponse);
                res.setHeader('CostKatana-Cache-Status', 'MISS');
            }

            // Track usage and costs
            await GatewayController.trackUsage(req, processedResponse, retryAttempts);

            // Return the response
            res.status(response.status);
            
            // Copy relevant headers from the AI provider response
            const headersToForward = ['content-type', 'content-length', 'content-encoding'];
            headersToForward.forEach(header => {
                if (response.headers[header]) {
                    res.setHeader(header, response.headers[header]);
                }
            });

            res.send(processedResponse);

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
     * Check if response exists in cache with enhanced TTL and bucket support
     */
    private static async checkCache(req: Request): Promise<CacheEntry | null> {
        const context = req.gatewayContext!;
        const cacheKey = GatewayController.generateCacheKey(req);
        
        // Check if we're using bucket-based caching for response variety
        if (context.cacheBucketMaxSize && context.cacheBucketMaxSize > 1) {
            return GatewayController.checkCacheBucket(cacheKey, context);
        }
        
        // Standard single-response caching
        const cached = responseCache.get(cacheKey);
        
        if (cached) {
            // Use custom TTL if provided, otherwise use entry's TTL or default
            const ttl = context.cacheTTL || cached.ttl || DEFAULT_CACHE_TTL;
            
            if (Date.now() - cached.timestamp < ttl) {
                logger.info('Cache hit', { 
                    cacheKey: cacheKey.substring(0, 8) + '...', 
                    userScope: context.cacheUserScope,
                    age: Date.now() - cached.timestamp,
                    ttl
                });
                return cached;
            }
            
            // Remove expired cache entry
            responseCache.delete(cacheKey);
            logger.info('Cache expired and removed', { cacheKey: cacheKey.substring(0, 8) + '...' });
        }
        
        return null;
    }

    /**
     * Check cache bucket for response variety
     */
    private static checkCacheBucket(cacheKey: string, context: any): CacheEntry | null {
        const bucket = cacheBuckets.get(cacheKey);
        
        if (!bucket || bucket.entries.length === 0) {
            return null;
        }
        
        // Check if any entries are still valid
        const ttl = context.cacheTTL || DEFAULT_CACHE_TTL;
        const validEntries = bucket.entries.filter(entry => 
            Date.now() - entry.timestamp < ttl
        );
        
        if (validEntries.length === 0) {
            // All entries expired, remove bucket
            cacheBuckets.delete(cacheKey);
            return null;
        }
        
        // Update bucket with valid entries
        if (validEntries.length !== bucket.entries.length) {
            bucket.entries = validEntries;
            bucket.currentIndex = bucket.currentIndex % validEntries.length;
        }
        
        // Return next entry in rotation
        const selectedEntry = bucket.entries[bucket.currentIndex];
        bucket.currentIndex = (bucket.currentIndex + 1) % bucket.entries.length;
        
        logger.info('Cache bucket hit', { 
            cacheKey: cacheKey.substring(0, 8) + '...', 
            bucketSize: bucket.entries.length,
            selectedIndex: bucket.currentIndex - 1
        });
        
        return selectedEntry;
    }

    /**
     * Generate cache key based on request content and user scope
     */
    private static generateCacheKey(req: Request): string {
        const context = req.gatewayContext!;
        const cacheableData = {
            targetUrl: context.targetUrl,
            body: req.body,
            method: req.method,
            path: req.path,
            modelOverride: context.modelOverride,
            userScope: context.cacheUserScope // Include user scope in cache key
        };
        
        return crypto
            .createHash('md5')
            .update(JSON.stringify(cacheableData))
            .digest('hex');
    }

    /**
     * Cache the response with enhanced bucket and TTL support
     */
    private static async cacheResponse(req: Request, response: any): Promise<void> {
        const context = req.gatewayContext!;
        const cacheKey = GatewayController.generateCacheKey(req);
        
        const cacheEntry: CacheEntry = {
            response,
            timestamp: Date.now(),
            headers: {},
            ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
            userScope: context.cacheUserScope
        };
        
        // Check if we're using bucket-based caching for response variety
        if (context.cacheBucketMaxSize && context.cacheBucketMaxSize > 1) {
            GatewayController.cacheToBucket(cacheKey, cacheEntry, context.cacheBucketMaxSize);
        } else {
            // Standard single-response caching
            responseCache.set(cacheKey, cacheEntry);
        }
        
        logger.info('Response cached', { 
            cacheKey: cacheKey.substring(0, 8) + '...', 
            userScope: context.cacheUserScope,
            ttl: cacheEntry.ttl,
            bucketMode: !!context.cacheBucketMaxSize
        });
    }

    /**
     * Cache response to bucket for variety
     */
    private static cacheToBucket(cacheKey: string, entry: CacheEntry, maxSize: number): void {
        let bucket = cacheBuckets.get(cacheKey);
        
        if (!bucket) {
            bucket = {
                entries: [],
                currentIndex: 0
            };
            cacheBuckets.set(cacheKey, bucket);
        }
        
        // Add new entry to bucket
        bucket.entries.push(entry);
        
        // If bucket exceeds max size, remove oldest entry
        if (bucket.entries.length > maxSize) {
            bucket.entries.shift(); // Remove first (oldest) entry
            bucket.currentIndex = Math.max(0, bucket.currentIndex - 1);
        }
        
        logger.info('Response cached to bucket', {
            cacheKey: cacheKey.substring(0, 8) + '...',
            bucketSize: bucket.entries.length,
            maxSize
        });
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
                projectId: context.budgetId,
                tags: context.properties ? Object.keys(context.properties) : [],
                costAllocation: context.properties,
                // Add workflow tracking data
                workflowId: context.workflowId,
                workflowName: context.workflowName,
                workflowStep: context.workflowStep,
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
                    }
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
            cacheSize: responseCache.size
        });
    }

    /**
     * Get gateway statistics
     */
    static async getStats(_req: Request, res: Response): Promise<void> {
        try {
            const stats = {
                cacheSize: responseCache.size,
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
     * Get cache statistics and status
     */
    static async getCacheStats(_req: Request, res: Response): Promise<void> {
        try {
            const cacheStats = {
                singleResponseCache: {
                    size: responseCache.size,
                    entries: Array.from(responseCache.entries()).map(([key, entry]) => ({
                        key: key.substring(0, 8) + '...',
                        timestamp: entry.timestamp,
                        age: Date.now() - entry.timestamp,
                        ttl: entry.ttl,
                        userScope: entry.userScope,
                        expired: Date.now() - entry.timestamp > (entry.ttl || DEFAULT_CACHE_TTL)
                    }))
                },
                bucketCache: {
                    size: cacheBuckets.size,
                    buckets: Array.from(cacheBuckets.entries()).map(([key, bucket]) => ({
                        key: key.substring(0, 8) + '...',
                        entryCount: bucket.entries.length,
                        currentIndex: bucket.currentIndex,
                        entries: bucket.entries.map(entry => ({
                            timestamp: entry.timestamp,
                            age: Date.now() - entry.timestamp,
                            ttl: entry.ttl,
                            userScope: entry.userScope
                        }))
                    }))
                },
                config: {
                    defaultTTL: DEFAULT_CACHE_TTL,
                    defaultTTLHours: DEFAULT_CACHE_TTL / (1000 * 60 * 60)
                }
            };

            res.json({
                success: true,
                data: cacheStats
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
     * Clear cache entries (for testing/debugging)
     */
    static async clearCache(req: Request, res: Response): Promise<void> {
        try {
            const { userScope, expired } = req.query;
            let clearedCount = 0;

            if (expired === 'true') {
                // Clear only expired entries
                const now = Date.now();
                
                // Clear expired single response cache entries
                for (const [key, entry] of responseCache.entries()) {
                    const ttl = entry.ttl || DEFAULT_CACHE_TTL;
                    if (now - entry.timestamp > ttl) {
                        responseCache.delete(key);
                        clearedCount++;
                    }
                }
                
                // Clear expired bucket entries
                for (const [key, bucket] of cacheBuckets.entries()) {
                    const validEntries = bucket.entries.filter(entry => {
                        const ttl = entry.ttl || DEFAULT_CACHE_TTL;
                        return now - entry.timestamp <= ttl;
                    });
                    
                    if (validEntries.length === 0) {
                        cacheBuckets.delete(key);
                        clearedCount++;
                    } else if (validEntries.length !== bucket.entries.length) {
                        bucket.entries = validEntries;
                        bucket.currentIndex = bucket.currentIndex % validEntries.length;
                        clearedCount += bucket.entries.length - validEntries.length;
                    }
                }
            } else if (userScope) {
                // Clear entries for specific user scope
                for (const [key, entry] of responseCache.entries()) {
                    if (entry.userScope === userScope) {
                        responseCache.delete(key);
                        clearedCount++;
                    }
                }
                
                for (const [key, bucket] of cacheBuckets.entries()) {
                    const validEntries = bucket.entries.filter(entry => entry.userScope !== userScope);
                    if (validEntries.length === 0) {
                        cacheBuckets.delete(key);
                        clearedCount++;
                    } else if (validEntries.length !== bucket.entries.length) {
                        bucket.entries = validEntries;
                        bucket.currentIndex = bucket.currentIndex % validEntries.length;
                        clearedCount += bucket.entries.length - validEntries.length;
                    }
                }
            } else {
                // Clear all cache
                clearedCount = responseCache.size + cacheBuckets.size;
                responseCache.clear();
                cacheBuckets.clear();
            }

            res.json({
                success: true,
                message: `Cache cleared successfully`,
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
     * Check request through firewall
     */
    private static async checkFirewall(req: Request): Promise<any> {
        const context = req.gatewayContext!;
        
        try {
            // Import PromptFirewallService dynamically to avoid circular dependencies
            const { PromptFirewallService } = await import('../services/promptFirewall.service');
            
            // Extract prompt from request body
            const prompt = GatewayController.extractPromptFromRequest(req.body);
            if (!prompt) {
                // If no prompt found, allow the request
                return {
                    isBlocked: false,
                    confidence: 0.0,
                    reason: 'No prompt content found to analyze',
                    stage: 'prompt-guard'
                };
            }

            // Build firewall configuration from context
            const firewallConfig = {
                enableBasicFirewall: context.firewallEnabled || false,
                enableAdvancedFirewall: context.firewallAdvanced || false,
                promptGuardThreshold: context.firewallPromptThreshold || 0.5,
                llamaGuardThreshold: context.firewallLlamaThreshold || 0.8
            };

            // Estimate cost for this request (for analytics)
            const estimatedCost = GatewayController.estimateRequestCost(req.body, null);
            
            // Generate request ID for tracking
            const requestId = req.headers['x-request-id'] as string || 
                             `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Run firewall check
            const result = await PromptFirewallService.checkPrompt(
                prompt,
                firewallConfig,
                requestId,
                estimatedCost
            );

            // Add user ID to the result for logging
            if (context.userId && result.isBlocked) {
                // Log with user context for better analytics
                logger.info('Firewall blocked request', {
                    requestId,
                    userId: context.userId,
                    threatCategory: result.threatCategory,
                    confidence: result.confidence,
                    stage: result.stage,
                    costSaved: estimatedCost
                });
            }

            return result;

        } catch (error) {
            logger.error('Error in firewall check', error as Error, {
                userId: context.userId,
                targetUrl: context.targetUrl
            });

            // In case of error, allow the request to proceed (fail-open)
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'Firewall check failed - allowing request',
                stage: 'prompt-guard'
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
}