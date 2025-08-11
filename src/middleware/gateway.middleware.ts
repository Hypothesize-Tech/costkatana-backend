import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { User } from '../models/User';
import { AuthService } from '../services/auth.service';
import { decrypt } from '../utils/helpers';
import { KeyVaultService } from '../services/keyVault.service';
import { v4 as uuidv4 } from 'uuid';
import { GuardrailsService } from '../services/guardrails.service';

// In-memory rate limiting store (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Extend Request interface to include gateway-specific properties
declare global {
    namespace Express {
        interface Request {
            gatewayContext?: {
                startTime: number;
                requestId?: string; // CostKatana-Request-Id for feedback tracking
                targetUrl?: string;
                projectId?: string; // CostKatana-Project-Id for project tracking
                authMethodOverride?: 'gateway' | 'standard'; // CostKatana-Auth-Method override
                cacheEnabled?: boolean;
                retryEnabled?: boolean;
                budgetId?: string;
                userId?: string;
                properties?: Record<string, string>;
                sessionId?: string;
                traceId?: string;
                modelOverride?: string;
                omitRequest?: boolean;
                omitResponse?: boolean;
                securityEnabled?: boolean;
                rateLimitPolicy?: string;
                firewallEnabled?: boolean;
                firewallAdvanced?: boolean;
                firewallPromptThreshold?: number;
                firewallLlamaThreshold?: number;
                workflowId?: string;
                workflowName?: string;
                workflowStep?: string;
                cacheUserScope?: string;
                cacheTTL?: number;
                cacheBucketMaxSize?: number;
                retryCount?: number;
                retryFactor?: number;
                retryMinTimeout?: number;
                retryMaxTimeout?: number;
                // Proxy key specific properties
                proxyKeyId?: string;
                providerKey?: string;
                provider?: string;
                // Failover specific properties
                failoverEnabled?: boolean;
                failoverPolicy?: string;
                isFailoverRequest?: boolean;
                // New cache-related properties
                semanticCacheEnabled?: boolean;
                deduplicationEnabled?: boolean;
                similarityThreshold?: number;
                inputTokens?: number;
                outputTokens?: number;
                cost?: number;
            };
        }
    }
}

/**
 * Handle proxy key authentication
 */
async function handleProxyKeyAuth(proxyKeyId: string, req: Request, res: Response): Promise<{
    user: any;
    userId: string;
    decryptedApiKey: string;
    provider: string;
} | null> {
    try {
        // Resolve proxy key to get master provider key
        const result = await KeyVaultService.resolveProxyKey(proxyKeyId);
        
        if (!result) {
            res.status(401).json({
                error: 'Invalid proxy key',
                message: 'Proxy key not found, expired, or over budget'
            });
            return null;
        }

        const { proxyKey, providerKey, decryptedApiKey } = result;

        // Get user information
        const user = await User.findById(proxyKey.userId);
        if (!user) {
            res.status(401).json({
                error: 'Invalid proxy key',
                message: 'User not found for proxy key'
            });
            return null;
        }

        // Check rate limiting if configured
        if (proxyKey.rateLimit) {
            const rateLimitResult = await checkRateLimit(proxyKeyId, proxyKey.rateLimit, req, res);
            if (!rateLimitResult.allowed) {
                return null; // Rate limit exceeded, response already sent
            }
        }

        // Check IP whitelist if configured
        if (proxyKey.allowedIPs && proxyKey.allowedIPs.length > 0) {
            const clientIP = req.ip || req.connection.remoteAddress || '';
            if (!proxyKey.allowedIPs.includes(clientIP)) {
                logger.warn('IP not allowed for proxy key', {
                    proxyKeyId,
                    clientIP,
                    allowedIPs: proxyKey.allowedIPs
                });
                res.status(403).json({
                    error: 'Access denied',
                    message: 'Your IP address is not allowed to use this proxy key'
                });
                return null;
            }
        }

        return {
            user,
            userId: user._id.toString(),
            decryptedApiKey,
            provider: providerKey.provider
        };
    } catch (error) {
        logger.error('Error handling proxy key authentication', error as Error, {
            proxyKeyId
        });
        res.status(500).json({
            error: 'Authentication error',
            message: 'Internal server error during proxy key authentication'
        });
        return null;
    }
}

/**
 * Gateway authentication middleware - processes CostKatana-Auth header
 */
// Rate limiting helper function
async function checkRateLimit(
    proxyKeyId: string, 
    rateLimit: any, 
    _req: Request, 
    res: Response
): Promise<{ allowed: boolean }> {
    try {
        const now = Date.now();
        const windowMs = rateLimit.windowMs || 60000; // Default 1 minute
        const maxRequests = rateLimit.maxRequests || 100; // Default 100 requests
        
        const key = `rate_limit:${proxyKeyId}`;
        const rateLimitData = rateLimitStore.get(key);
        
        // Reset window if expired
        if (!rateLimitData || now > rateLimitData.resetTime) {
            rateLimitStore.set(key, {
                count: 1,
                resetTime: now + windowMs
            });
            
            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', maxRequests);
            res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
            res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
            
            return { allowed: true };
        }
        
        // Check if limit exceeded
        if (rateLimitData.count >= maxRequests) {
            const resetTime = new Date(rateLimitData.resetTime);
            
            res.status(429).json({
                success: false,
                error: 'Rate limit exceeded',
                message: `Too many requests. Limit: ${maxRequests} per ${windowMs}ms`,
                retryAfter: Math.ceil((rateLimitData.resetTime - now) / 1000)
            });
            
            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', maxRequests);
            res.setHeader('X-RateLimit-Remaining', 0);
            res.setHeader('X-RateLimit-Reset', resetTime.toISOString());
            res.setHeader('Retry-After', Math.ceil((rateLimitData.resetTime - now) / 1000));
            
            logger.warn('Rate limit exceeded', {
                proxyKeyId,
                count: rateLimitData.count,
                limit: maxRequests,
                resetTime: resetTime.toISOString()
            });
            
            return { allowed: false };
        }
        
        // Increment counter
        rateLimitData.count++;
        rateLimitStore.set(key, rateLimitData);
        
        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', maxRequests - rateLimitData.count);
        res.setHeader('X-RateLimit-Reset', new Date(rateLimitData.resetTime).toISOString());
        
        return { allowed: true };
    } catch (error) {
        logger.error('Error checking rate limit:', error);
        // Allow request on error to avoid blocking legitimate traffic
        return { allowed: true };
    }
}

export const gatewayAuth = async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    logger.info('=== GATEWAY AUTHENTICATION STARTED ===');

    try {
        const authHeader = req.headers['costkatana-auth'] as string;
        
        if (!authHeader) {
            res.status(401).json({
                error: 'CostKatana-Auth header is required',
                message: 'Please provide authentication via CostKatana-Auth header'
            });
            return;
        }

        // Extract Bearer token or API key
        let token: string | undefined;
        let apiKey: string | undefined;
        let user: any;
        let userId: string = '';

        if (authHeader.startsWith('Bearer ')) {
            const authValue = authHeader.substring(7);
            
            // Check if it's an API key (starts with 'dak_'), proxy key (starts with 'ck-proxy-'), or JWT token
            if (authValue.startsWith('dak_')) {
                apiKey = authValue;
                logger.info('Dashboard API key found in CostKatana-Auth header');
            } else if (authValue.startsWith('ck-proxy-')) {
                // Handle proxy key authentication
                const proxyKeyResult = await handleProxyKeyAuth(authValue, req, res);
                if (!proxyKeyResult) {
                    return; // Response already sent in handleProxyKeyAuth
                }
                
                // Set user context from proxy key
                user = proxyKeyResult.user;
                userId = proxyKeyResult.userId;
                
                // Add proxy key context to request
                req.gatewayContext = {
                    startTime,
                    userId,
                    proxyKeyId: authValue,
                    providerKey: proxyKeyResult.decryptedApiKey,
                    provider: proxyKeyResult.provider
                };
                
                logger.info('Proxy key authenticated successfully', {
                    proxyKeyId: authValue,
                    userId,
                    provider: proxyKeyResult.provider
                });
                
                // Process gateway headers and continue
                processGatewayHeaders(req, res, next);
                return;
            } else {
                token = authValue;
                logger.info('JWT token found in CostKatana-Auth header');
            }
        } else {
            res.status(401).json({
                error: 'Invalid CostKatana-Auth format',
                message: 'CostKatana-Auth must be in format: Bearer YOUR_TOKEN'
            });
            return;
        }

        if (apiKey) {
            // Parse API key
            const parsedKey = AuthService.parseApiKey(apiKey);
            if (!parsedKey) {
                res.status(401).json({
                    error: 'Invalid API key format',
                    message: 'CostKatana API key format is invalid'
                });
                return;
            }

            // Find user and validate API key
            user = await User.findById(parsedKey.userId);
            if (!user) {
                res.status(401).json({
                    error: 'Invalid API key',
                    message: 'User not found for provided API key'
                });
                return;
            }

            // Find matching API key in user's dashboard keys
            const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
            if (!userApiKey) {
                res.status(401).json({
                    error: 'Invalid API key',
                    message: 'API key not found in user account'
                });
                return;
            }

            // Decrypt and validate the full API key
            try {
                const [iv, authTag, encrypted] = userApiKey.encryptedKey.split(':');
                const decryptedKey = decrypt(encrypted, iv, authTag);

                if (decryptedKey !== apiKey) {
                    res.status(401).json({
                        error: 'Invalid API key',
                        message: 'API key validation failed'
                    });
                    return;
                }
            } catch (error) {
                logger.error('Error decrypting API key in gateway:', error);
                res.status(401).json({
                    error: 'Invalid API key',
                    message: 'API key validation failed'
                });
                return;
            }

            // Check if API key is expired
            if (userApiKey.expiresAt && userApiKey.expiresAt < new Date()) {
                res.status(401).json({
                    error: 'API key expired',
                    message: 'Your API key has expired'
                });
                return;
            }

            userId = user._id.toString();
        } else if (token) {
            // JWT token validation (reuse existing logic)
            try {
                const decoded = AuthService.verifyAccessToken(token);
                userId = decoded.id;
                user = await User.findById(userId);
                
                if (!user) {
                    res.status(401).json({
                        error: 'Invalid token',
                        message: 'User not found for provided token'
                    });
                    return;
                }
            } catch (error) {
                logger.error('JWT validation failed in gateway:', error);
                res.status(401).json({
                    error: 'Invalid token',
                    message: 'Token validation failed'
                });
                return;
            }
        }

        // Initialize gateway context
        req.gatewayContext = {
            startTime,
            userId
        };

        // Attach user to request
        req.user = user;

        logger.info(`Gateway authentication successful for user: ${userId}`);
        next();

    } catch (error) {
        logger.error('Gateway authentication error:', error);
        res.status(500).json({
            error: 'Authentication failed',
            message: 'Internal server error during authentication'
        });
    }
};

/**
 * Gateway header processing middleware - processes all CostKATANA headers
 */
export const processGatewayHeaders = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.gatewayContext) {
        req.gatewayContext = { startTime: Date.now() };
    }

    const context = req.gatewayContext;

    // Process CostKatana-Request-Id header (for feedback tracking)
    let requestId = req.headers['costkatana-request-id'] as string;
    if (!requestId) {
        // Generate a unique request ID if not provided
        requestId = uuidv4();
    }
    context.requestId = requestId;

    // Process CostKatana-Project-Id header (for project tracking)
    const projectId = req.headers['costkatana-project-id'] as string;
    if (projectId) {
        context.projectId = projectId;
        logger.debug('Project ID detected', { projectId, requestId: context.requestId });
    }

    // Process CostKatana-Auth-Method header (for authentication method override)
    const authMethodOverride = req.headers['costkatana-auth-method'] as string;
    if (authMethodOverride && (authMethodOverride === 'gateway' || authMethodOverride === 'standard')) {
        context.authMethodOverride = authMethodOverride as 'gateway' | 'standard';
        logger.debug('Auth method override detected', { authMethodOverride, requestId: context.requestId });
    }

    // Check for failover policy first
    const failoverPolicy = req.headers['costkatana-failover-policy'] as string;
    if (failoverPolicy) {
        context.failoverEnabled = true;
        context.failoverPolicy = failoverPolicy;
        context.isFailoverRequest = true;
        // For failover requests, we don't need a single target URL
        logger.debug('Failover policy detected', { requestId: context.requestId });
    } else {
        // Core routing header (required for non-failover requests)
        const targetUrl = req.headers['costkatana-target-url'] as string;
        if (!targetUrl) {
            res.status(400).json({
                error: 'Missing required header',
                message: 'Either CostKatana-Target-Url or CostKatana-Failover-Policy header is required for routing'
            });
            return;
        }

        // Validate target URL format
        try {
            new URL(targetUrl);
            context.targetUrl = targetUrl;
            context.failoverEnabled = false;
            context.isFailoverRequest = false;
        } catch (error) {
            res.status(400).json({
                error: 'Invalid target URL',
                message: 'CostKatana-Target-Url must be a valid URL'
            });
            return;
        }
    }

    // Process feature flags
    context.cacheEnabled = req.headers['costkatana-cache-enabled'] === 'true';
    context.retryEnabled = req.headers['costkatana-retry-enabled'] === 'true';
    context.securityEnabled = req.headers['costkatana-llm-security-enabled'] === 'true';
    context.omitRequest = req.headers['costkatana-omit-request'] === 'true';
    context.omitResponse = req.headers['costkatana-omit-response'] === 'true';
    
    // Process cache-specific headers
    context.semanticCacheEnabled = req.headers['costkatana-semantic-cache-enabled'] !== 'false';
    context.deduplicationEnabled = req.headers['costkatana-deduplication-enabled'] !== 'false';
    const similarityThreshold = parseFloat(req.headers['costkatana-similarity-threshold'] as string);
    context.similarityThreshold = !isNaN(similarityThreshold) ? similarityThreshold : 0.85;
    
    // Process firewall headers
    context.firewallEnabled = req.headers['costkatana-firewall-enabled'] === 'true';
    context.firewallAdvanced = req.headers['costkatana-firewall-advanced'] === 'true';
    
    // Firewall thresholds (optional custom values)
    const promptThreshold = req.headers['costkatana-firewall-prompt-threshold'] as string;
    if (promptThreshold) {
        const threshold = parseFloat(promptThreshold);
        if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
            context.firewallPromptThreshold = threshold;
        }
    }
    
    const llamaThreshold = req.headers['costkatana-firewall-llama-threshold'] as string;
    if (llamaThreshold) {
        const threshold = parseFloat(llamaThreshold);
        if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
            context.firewallLlamaThreshold = threshold;
        }
    }

    // Process retry configuration headers
    if (context.retryEnabled) {
        // CostKatana-Retry-Count: Maximum number of retry attempts (default: 3)
        const retryCount = req.headers['costkatana-retry-count'] as string;
        if (retryCount) {
            const count = parseInt(retryCount);
            if (!isNaN(count) && count >= 0 && count <= 10) { // Reasonable bounds
                context.retryCount = count;
            }
        }

        // CostKatana-Retry-Factor: Exponential backoff factor (default: 2)
        const retryFactor = req.headers['costkatana-retry-factor'] as string;
        if (retryFactor) {
            const factor = parseFloat(retryFactor);
            if (!isNaN(factor) && factor >= 1 && factor <= 5) { // Reasonable bounds
                context.retryFactor = factor;
            }
        }

        // CostKatana-Retry-Min-Timeout: Minimum wait time in ms (default: 1000)
        const retryMinTimeout = req.headers['costkatana-retry-min-timeout'] as string;
        if (retryMinTimeout) {
            const timeout = parseInt(retryMinTimeout);
            if (!isNaN(timeout) && timeout >= 100 && timeout <= 60000) { // 100ms to 60s
                context.retryMinTimeout = timeout;
            }
        }

        // CostKatana-Retry-Max-Timeout: Maximum wait time in ms (default: 10000)
        const retryMaxTimeout = req.headers['costkatana-retry-max-timeout'] as string;
        if (retryMaxTimeout) {
            const timeout = parseInt(retryMaxTimeout);
            if (!isNaN(timeout) && timeout >= 1000 && timeout <= 300000) { // 1s to 5min
                context.retryMaxTimeout = timeout;
            }
        }
    }

    // Process cache-specific headers
    context.cacheUserScope = req.headers['costkatana-cache-user-scope'] as string;
    
    // Process Cache-Control header for TTL
    const cacheControl = req.headers['cache-control'] as string;
    if (cacheControl && cacheControl.includes('max-age=')) {
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        if (maxAgeMatch) {
            context.cacheTTL = parseInt(maxAgeMatch[1]) * 1000; // Convert seconds to milliseconds
        }
    }
    
    // Process bucket size for response variety
    const bucketSize = req.headers['costkatana-cache-bucket-max-size'] as string;
    if (bucketSize) {
        const size = parseInt(bucketSize);
        if (!isNaN(size) && size > 0 && size <= 10) { // Limit to reasonable range
            context.cacheBucketMaxSize = size;
        }
    }

    // Process identification headers
    context.sessionId = req.headers['costkatana-session-id'] as string;
    context.traceId = req.headers['costkatana-property-trace-id'] as string;
    context.budgetId = req.headers['costkatana-budget-id'] as string;
    context.modelOverride = req.headers['costkatana-model-override'] as string;
    context.rateLimitPolicy = req.headers['costkatana-ratelimit-policy'] as string;

    // Process workflow headers
    context.workflowId = req.headers['costkatana-workflow-id'] as string;
    context.workflowName = req.headers['costkatana-workflow-name'] as string;
    context.workflowStep = req.headers['costkatana-workflow-step'] as string;

    // Process custom properties (CostKatana-Property-[Name])
    context.properties = {};
    Object.keys(req.headers).forEach(header => {
        if (header.toLowerCase().startsWith('costkatana-property-')) {
            const propertyName = header.substring('costkatana-property-'.length);
            context.properties![propertyName] = req.headers[header] as string;
        }
    });

    // Process user ID if provided
    const userIdHeader = req.headers['costkatana-user-id'] as string;
    if (userIdHeader) {
        context.properties!['user-id'] = userIdHeader;
    }

    logger.info('Gateway headers processed', {
        targetUrl: context.targetUrl,
        cacheEnabled: context.cacheEnabled,
        retryEnabled: context.retryEnabled,
        retryCount: context.retryCount,
        retryFactor: context.retryFactor,
        retryMinTimeout: context.retryMinTimeout,
        retryMaxTimeout: context.retryMaxTimeout,
        propertyCount: Object.keys(context.properties || {}).length,
        sessionId: context.sessionId,
        traceId: context.traceId,
        workflowId: context.workflowId,
        workflowName: context.workflowName,
        workflowStep: context.workflowStep
    });

    // Apply guardrails checking if user is authenticated
    if (context.userId) {
        GuardrailsService.checkRequestGuardrails(
            context.userId,
            'request',
            1,
            req.body?.model
        ).then(violation => {
            if (violation && violation.action === 'block') {
                res.status(429).json({
                    success: false,
                    error: 'Usage limit exceeded',
                    violation,
                    upgradeUrl: 'https://costkatana.com/pricing'
                });
                return;
            }
            next();
        }).catch(error => {
            logger.error('Error checking guardrails:', error);
            next(); // Don't block on errors
        });
    } else {
        next();
    }
};

/**
 * Rate limiting middleware for gateway requests
 */
export const gatewayRateLimit = (maxRequests: number = 1000, windowMs: number = 60000) => {
    const requests = new Map<string, number[]>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const userId = req.gatewayContext?.userId || req.ip || 'unknown';
        const now = Date.now();
        const userRequests = requests.get(userId) || [];
        
        // Remove old requests outside the window
        const validRequests = userRequests.filter(time => now - time < windowMs);
        
        if (validRequests.length >= maxRequests) {
            logger.warn('Gateway rate limit exceeded', { 
                userId, 
                requests: validRequests.length,
                limit: maxRequests 
            });
            
            res.status(429).json({
                error: 'Rate limit exceeded',
                message: `Too many requests. Limit: ${maxRequests} per ${windowMs/1000} seconds`,
                'retry-after': Math.ceil(windowMs / 1000)
            });
            return;
        }
        
        validRequests.push(now);
        requests.set(userId, validRequests);
        
        next();
    };
};

/**
 * Add response headers with gateway metadata
 */
export const addGatewayResponseHeaders = (req: Request, res: Response, next: NextFunction): void => {
    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function(body: any) {
        addResponseMetadata(req, res);
        return originalSend.call(this, body);
    };

    res.json = function(obj: any) {
        addResponseMetadata(req, res);
        return originalJson.call(this, obj);
    };

    next();
};

function addResponseMetadata(req: Request, res: Response): void {
    const context = req.gatewayContext;
    if (!context) return;

    // Add gateway-specific response headers
    res.setHeader('CostKatana-Id', generateRequestId());
    
    if (context.cacheEnabled) {
        // This will be set by the caching logic
        res.setHeader('CostKatana-Cache-Status', res.getHeader('CostKatana-Cache-Status') || 'MISS');
    }

    // Add processing time
    const processingTime = Date.now() - context.startTime;
    res.setHeader('CostKatana-Processing-Time', `${processingTime}ms`);

    // Add rate limit info if available
    if (context.userId) {
        // This would be populated by budget/rate limit logic
        const remainingBudget = res.getHeader('CostKatana-Budget-Remaining');
        if (remainingBudget) {
            res.setHeader('CostKatana-Budget-Remaining', remainingBudget);
        }
    }

    logger.debug('Gateway response headers added', {
        processingTime,
        userId: context.userId,
        cacheEnabled: context.cacheEnabled
    });
}

function generateRequestId(): string {
    return `gw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}