import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { User } from '../models/User';
import { AuthService } from '../services/auth.service';
import { decrypt } from '../utils/helpers';
import { KeyVaultService } from '../services/keyVault.service';
import { v4 as uuidv4 } from 'uuid';
import { GuardrailsService } from '../services/guardrails.service';
import { cacheService } from '../services/cache.service';

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
            const rateLimitResult = await checkRateLimit(req, res);
            if (!rateLimitResult.allowed) {
                return null; // Rate limit exceeded, response already sent
            }
        }

        // Check IP whitelist if configured
        if (proxyKey.allowedIPs && proxyKey.allowedIPs.length > 0) {
            const clientIP = req.ip || req.connection.remoteAddress || '';
            if (!proxyKey.allowedIPs.includes(clientIP)) {
                loggingService.warn('IP not allowed for proxy key', {
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
        loggingService.logError(error as Error, {
            component: 'GatewayMiddleware',
            operation: 'handleProxyKeyAuth',
            type: 'proxy_key_auth',
            step: 'error',
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
 * Check rate limit for gateway requests with Redis primary and in-memory fallback
 */
async function checkRateLimit(req: any, _res: Response): Promise<{ allowed: boolean; retryAfter?: number }> {
    const startTime = Date.now();
    
    loggingService.info('=== GATEWAY RATE LIMIT CHECK STARTED ===', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Generating rate limit key for gateway request', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'generate_key'
    });

    // Generate rate limit key based on user or IP
    const key = req.user?.id || req.ip || 'anonymous';
    const cacheKey = `gateway_rate_limit:${key}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;

    loggingService.info('Gateway rate limit key generated', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'key_generated',
        key,
        cacheKey,
        hasUser: !!req.user?.id,
        hasIP: !!req.ip,
        maxRequests,
        windowMs
    });

    loggingService.info('Step 2: Retrieving gateway rate limit record from cache', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'retrieve_record'
    });

    // Get rate limit record from Redis/in-memory cache
    let record: { count: number; resetTime: number } | null = null;
    try {
        const cachedRecord = await cacheService.get(cacheKey);
        if (cachedRecord) {
            record = cachedRecord as { count: number; resetTime: number };
            
            loggingService.info('Gateway rate limit record retrieved from cache', {
                component: 'GatewayMiddleware',
                operation: 'checkRateLimit',
                type: 'gateway_rate_limit',
                step: 'record_retrieved',
                key,
                cacheKey,
                currentCount: record.count,
                resetTime: new Date(record.resetTime).toISOString(),
                timeUntilReset: record.resetTime - now
            });
        }
    } catch (error) {
        loggingService.warn('Failed to retrieve gateway rate limit record from cache', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'cache_retrieve_failed',
            key,
            cacheKey,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }

    loggingService.info('Step 3: Processing gateway rate limit record', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'process_record'
    });

    // Check if record exists and is still valid
    if (!record || record.resetTime < now) {
        // Create new record
        record = {
            count: 1,
            resetTime: now + windowMs
        };
        
        loggingService.info('New gateway rate limit record created', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'record_created',
            key,
            cacheKey,
            resetTime: new Date(record.resetTime).toISOString(),
            windowMs
        });
    } else {
        // Increment existing record
        record.count++;
        
        loggingService.info('Existing gateway rate limit record incremented', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'record_incremented',
            key,
            cacheKey,
            newCount: record.count,
            maxRequests,
            remaining: maxRequests - record.count
        });
    }

    loggingService.info('Step 4: Checking gateway rate limit status', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'check_limit'
    });

    // Check if limit exceeded
    if (record.count > maxRequests) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        
        loggingService.warn('Gateway rate limit exceeded', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'limit_exceeded',
            key,
            cacheKey,
            count: record.count,
            maxRequests,
            retryAfter,
            resetTime: new Date(record.resetTime).toISOString()
        });

        loggingService.info('Gateway rate limit check completed - limit exceeded', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'check_complete_exceeded',
            key,
            allowed: false,
            retryAfter,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== GATEWAY RATE LIMIT CHECK COMPLETED (LIMIT EXCEEDED) ===', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'completed_limit_exceeded',
            totalTime: `${Date.now() - startTime}ms`
        });

        return { allowed: false, retryAfter };
    }

    loggingService.info('Step 5: Storing updated gateway rate limit record in cache', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'store_record'
    });

    // Store updated record in cache
    try {
        const ttl = Math.ceil((record.resetTime - now) / 1000);
        await cacheService.set(cacheKey, record, ttl, {
            type: 'gateway_rate_limit',
            key,
            maxRequests,
            windowMs
        });
        
        loggingService.info('Gateway rate limit record stored in cache successfully', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'record_stored',
            key,
            cacheKey,
            ttl,
            count: record.count,
            resetTime: new Date(record.resetTime).toISOString()
        });
    } catch (error) {
        loggingService.warn('Failed to store gateway rate limit record in cache', {
            component: 'GatewayMiddleware',
            operation: 'checkRateLimit',
            type: 'gateway_rate_limit',
            step: 'cache_store_failed',
            key,
            cacheKey,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }

    loggingService.info('Gateway rate limit check completed successfully', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'check_complete_allowed',
        key,
        allowed: true,
        currentCount: record.count,
        maxRequests,
        remaining: maxRequests - record.count,
        totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== GATEWAY RATE LIMIT CHECK COMPLETED ===', {
        component: 'GatewayMiddleware',
        operation: 'checkRateLimit',
        type: 'gateway_rate_limit',
        step: 'completed',
        key,
        totalTime: `${Date.now() - startTime}ms`
    });

    return { allowed: true };
}

/**
 * Gateway rate limiting middleware with Redis primary and in-memory fallback
 */
export function gatewayRateLimit(
    maxRequests: number = 100,
    windowMs: number = 60000
): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        loggingService.info('=== GATEWAY RATE LIMIT MIDDLEWARE STARTED ===', {
            component: 'GatewayMiddleware',
            operation: 'gatewayRateLimit',
            type: 'gateway_rate_limit',
            path: req.path,
            method: req.method,
            maxRequests,
            windowMs
        });

        loggingService.info('Step 1: Checking gateway rate limit', {
            component: 'GatewayMiddleware',
            operation: 'gatewayRateLimit',
            type: 'gateway_rate_limit',
            step: 'check_rate_limit'
        });

        const rateLimitResult = await checkRateLimit(req, res);
        
        if (!rateLimitResult.allowed) {
            loggingService.info('Step 1a: Rate limit exceeded, sending response', {
                component: 'GatewayMiddleware',
                operation: 'gatewayRateLimit',
                type: 'gateway_rate_limit',
                step: 'send_limit_response'
            });

            res.setHeader('Retry-After', rateLimitResult.retryAfter!.toString());
            res.status(429).json({
                error: 'Gateway rate limit exceeded',
                message: 'Too many requests to gateway, please try again later.',
                retryAfter: rateLimitResult.retryAfter
            });

            loggingService.info('Gateway rate limit exceeded response sent', {
                component: 'GatewayMiddleware',
                operation: 'gatewayRateLimit',
                type: 'gateway_rate_limit',
                step: 'response_sent',
                statusCode: 429,
                retryAfter: rateLimitResult.retryAfter,
                totalTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== GATEWAY RATE LIMIT MIDDLEWARE COMPLETED (LIMIT EXCEEDED) ===', {
                component: 'GatewayMiddleware',
                operation: 'gatewayRateLimit',
                type: 'gateway_rate_limit',
                step: 'completed_limit_exceeded',
                totalTime: `${Date.now() - startTime}ms`
            });

            return;
        }

        loggingService.info('Gateway rate limit check passed', {
            component: 'GatewayMiddleware',
            operation: 'gatewayRateLimit',
            type: 'gateway_rate_limit',
            step: 'rate_limit_passed',
            allowed: true,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== GATEWAY RATE LIMIT MIDDLEWARE COMPLETED ===', {
            component: 'GatewayMiddleware',
            operation: 'gatewayRateLimit',
            type: 'gateway_rate_limit',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

        next();
    };
}

/**
 * Gateway authentication middleware - processes CostKatana-Auth header
 */
export const gatewayAuth = async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    
    loggingService.info('=== GATEWAY AUTHENTICATION MIDDLEWARE STARTED ===', {
        component: 'GatewayMiddleware',
        operation: 'gatewayAuth',
        type: 'gateway_authentication',
        path: req.originalUrl,
        method: req.method
    });

    loggingService.info('Step 1: Extracting authentication header', {
        component: 'GatewayMiddleware',
        operation: 'gatewayAuth',
        type: 'gateway_authentication',
        step: 'extract_header'
    });

    try {
        const authHeader = req.headers['costkatana-auth'] as string;
        
        if (!authHeader) {
            loggingService.warn('CostKatana-Auth header missing', {
                component: 'GatewayMiddleware',
                operation: 'gatewayAuth',
                type: 'gateway_authentication',
                step: 'header_missing',
                path: req.originalUrl,
                method: req.method
            });
            res.status(401).json({
                error: 'CostKatana-Auth header is required',
                message: 'Please provide authentication via CostKatana-Auth header'
            });
            return;
        }

        loggingService.info('Step 2: Analyzing authentication type', {
            component: 'GatewayMiddleware',
            operation: 'gatewayAuth',
            type: 'gateway_authentication',
            step: 'analyze_auth_type'
        });

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
                loggingService.info('Dashboard API key found in CostKatana-Auth header', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'api_key_detected',
                    authType: 'dashboard_api_key'
                });
            } else if (authValue.startsWith('ck-proxy-')) {
                loggingService.info('Proxy key detected, processing authentication', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'proxy_key_detected',
                    authType: 'proxy_key'
                });
                
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
                
                loggingService.info('Proxy key authenticated successfully', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'proxy_key_success',
                    proxyKeyId: authValue,
                    userId,
                    provider: proxyKeyResult.provider
                });
                
                loggingService.info('Step 3: Processing gateway headers for proxy key', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'process_headers'
                });
                
                // Process gateway headers and continue
                processGatewayHeaders(req, res, next);
                return;
            } else {
                token = authValue;
                loggingService.info('JWT token found in CostKatana-Auth header', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'jwt_token_detected',
                    authType: 'jwt_token'
                });
            }
        } else {
            loggingService.warn('Invalid CostKatana-Auth format', {
                component: 'GatewayMiddleware',
                operation: 'gatewayAuth',
                type: 'gateway_authentication',
                step: 'invalid_format',
                headerValue: authHeader.substring(0, 20) + '...'
            });
            res.status(401).json({
                error: 'Invalid CostKatana-Auth format',
                message: 'CostKatana-Auth must be in format: Bearer YOUR_TOKEN'
            });
            return;
        }

        loggingService.info('Step 3: Processing authentication', {
            component: 'GatewayMiddleware',
            operation: 'gatewayAuth',
            type: 'gateway_authentication',
            step: 'process_auth'
        });

        if (apiKey) {
            loggingService.info('Step 3a: Processing API key authentication', {
                component: 'GatewayMiddleware',
                operation: 'gatewayAuth',
                type: 'gateway_authentication',
                step: 'process_api_key'
            });
            
            // Parse API key
            const parsedKey = AuthService.parseApiKey(apiKey);
            if (!parsedKey) {
                loggingService.warn('Invalid API key format', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'invalid_api_key_format',
                    apiKey: apiKey.substring(0, 10) + '...'
                });
                res.status(401).json({
                    error: 'Invalid API key format',
                    message: 'CostKatana API key format is invalid'
                });
                return;
            }

            // Find user and validate API key
            user = await User.findById(parsedKey.userId);
            if (!user) {
                loggingService.warn('User not found for API key', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'user_not_found',
                    userId: parsedKey.userId
                });
                res.status(401).json({
                    error: 'Invalid API key',
                    message: 'User not found for provided API key'
                });
                return;
            }

            // Find matching API key in user's dashboard keys
            const userApiKey = user.dashboardApiKeys.find((key: any) => key.keyId === parsedKey.keyId);
            if (!userApiKey) {
                loggingService.warn('API key not found in user account', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'api_key_not_found',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId
                });
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
                    loggingService.warn('API key validation failed', {
                        component: 'GatewayMiddleware',
                        operation: 'gatewayAuth',
                        type: 'gateway_authentication',
                        step: 'api_key_validation_failed',
                        userId: parsedKey.userId,
                        keyId: parsedKey.keyId
                    });
                    res.status(401).json({
                        error: 'Invalid API key',
                        message: 'API key validation failed'
                    });
                    return;
                }
            } catch (error) {
                loggingService.logError(error as Error, {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'api_key_decryption_error',
                    apiKeyId: parsedKey.keyId
                });
                res.status(401).json({
                    error: 'Invalid API key',
                    message: 'API key validation failed'
                });
                return;
            }

            // Check if API key is expired
            if (userApiKey.expiresAt && userApiKey.expiresAt < new Date()) {
                loggingService.warn('API key has expired', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'api_key_expired',
                    userId: parsedKey.userId,
                    keyId: parsedKey.keyId,
                    expiresAt: userApiKey.expiresAt
                });
                res.status(401).json({
                    error: 'API key expired',
                    message: 'Your API key has expired'
                });
                return;
            }

            userId = user._id.toString();
            
            loggingService.info('API key authentication successful', {
                component: 'GatewayMiddleware',
                operation: 'gatewayAuth',
                type: 'gateway_authentication',
                step: 'api_key_success',
                userId,
                keyId: parsedKey.keyId
            });
            
        } else if (token) {
            loggingService.info('Step 3b: Processing JWT token authentication', {
                component: 'GatewayMiddleware',
                operation: 'gatewayAuth',
                type: 'gateway_authentication',
                step: 'process_jwt'
            });
            
            // JWT token validation (reuse existing logic)
            try {
                const decoded = AuthService.verifyAccessToken(token);
                userId = decoded.id;
                user = await User.findById(userId);
                
                if (!user) {
                    loggingService.warn('User not found for JWT token', {
                        component: 'GatewayMiddleware',
                        operation: 'gatewayAuth',
                        type: 'gateway_authentication',
                        step: 'jwt_user_not_found',
                        userId: decoded.id
                    });
                    res.status(401).json({
                        error: 'Invalid token',
                        message: 'User not found for provided token'
                    });
                    return;
                }
                
                loggingService.info('JWT token validation successful', {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'jwt_success',
                    userId
                });
                
            } catch (error) {
                loggingService.logError(error as Error, {
                    component: 'GatewayMiddleware',
                    operation: 'gatewayAuth',
                    type: 'gateway_authentication',
                    step: 'jwt_validation_error',
                    tokenId: token.substring(0, 10) + '...'
                });
                res.status(401).json({
                    error: 'Invalid token',
                    message: 'Token validation failed'
                });
                return;
            }
        }

        loggingService.info('Step 4: Setting up gateway context', {
            component: 'GatewayMiddleware',
            operation: 'gatewayAuth',
            type: 'gateway_authentication',
            step: 'setup_context'
        });

        // Initialize gateway context
        req.gatewayContext = {
            startTime,
            userId
        };

        // Attach user to request
        req.user = user;

        loggingService.info('Gateway authentication completed successfully', {
            component: 'GatewayMiddleware',
            operation: 'gatewayAuth',
            type: 'gateway_authentication',
            step: 'completed',
            userId,
            authMethod: apiKey ? 'API Key' : 'JWT Token',
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== GATEWAY AUTHENTICATION MIDDLEWARE COMPLETED ===', {
            component: 'GatewayMiddleware',
            operation: 'gatewayAuth',
            type: 'gateway_authentication',
            step: 'completed',
            userId,
            totalTime: `${Date.now() - startTime}ms`
        });

        next();

    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'GatewayMiddleware',
            operation: 'gatewayAuth',
            type: 'gateway_authentication',
            step: 'error',
            totalTime: `${Date.now() - startTime}ms`
        });
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
        loggingService.debug('Project ID detected', {
            component: 'GatewayMiddleware',
            operation: 'processGatewayHeaders',
            type: 'project_id_detected',
            projectId,
            requestId: context.requestId
        });
    }

    // Process CostKatana-Auth-Method header (for authentication method override)
    const authMethodOverride = req.headers['costkatana-auth-method'] as string;
    if (authMethodOverride && (authMethodOverride === 'gateway' || authMethodOverride === 'standard')) {
        context.authMethodOverride = authMethodOverride as 'gateway' | 'standard';
        loggingService.debug('Auth method override detected', {
            component: 'GatewayMiddleware',
            operation: 'processGatewayHeaders',
            type: 'auth_method_override',
            authMethodOverride,
            requestId: context.requestId
        });
    }

    // Check for failover policy first
    const failoverPolicy = req.headers['costkatana-failover-policy'] as string;
    if (failoverPolicy) {
        context.failoverEnabled = true;
        context.failoverPolicy = failoverPolicy;
        context.isFailoverRequest = true;
        // For failover requests, we don't need a single target URL
        loggingService.debug('Failover policy detected', {
            component: 'GatewayMiddleware',
            operation: 'processGatewayHeaders',
            type: 'failover_policy',
            requestId: context.requestId
        });
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

    loggingService.info('Gateway headers processed', {
        component: 'GatewayMiddleware',
        operation: 'processGatewayHeaders',
        type: 'headers_processed',
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
            loggingService.logError(error as Error, {
                component: 'GatewayMiddleware',
                operation: 'processGatewayHeaders',
                type: 'guardrails_check',
                step: 'error',
                userId: context.userId
            });
            next(); // Don't block on errors
        });
    } else {
        next();
    }
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

    loggingService.debug('Gateway response headers added', {
        component: 'GatewayMiddleware',
        operation: 'addGatewayResponseHeaders',
        type: 'response_headers_added',
        processingTime,
        userId: context.userId,
        cacheEnabled: context.cacheEnabled
    });
}

function generateRequestId(): string {
    return `gw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}