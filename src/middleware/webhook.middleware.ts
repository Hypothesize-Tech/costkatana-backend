import { Request, Response, NextFunction } from 'express';
import { webhookService } from '../services/webhook.service';
import { loggingService } from '../services/logging.service';
import { cacheService } from '../services/cache.service';

/**
 * Verify webhook signature for inbound webhooks
 * This is used when Cost Katana receives webhooks from external services
 */
export function verifyWebhookSignature(
    secretKey?: string
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        const startTime = Date.now();
        
        loggingService.info('=== WEBHOOK SIGNATURE VERIFICATION MIDDLEWARE STARTED ===', {
            component: 'WebhookMiddleware',
            operation: 'verifyWebhookSignature',
            type: 'webhook_signature',
            path: req.path,
            method: req.method
        });

        try {
            loggingService.info('Step 1: Extracting webhook signature and timestamp', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'extract_signature'
            });

            // Get signature from headers
            const signature = req.headers['x-costkatana-signature'] as string;
            const timestamp = req.headers['x-costkatana-timestamp'] as string;

            loggingService.info('Webhook headers extracted', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'headers_extracted',
                hasSignature: !!signature,
                hasTimestamp: !!timestamp,
                signatureLength: signature?.length || 0,
                timestamp
            });

            if (!signature || !timestamp) {
                loggingService.warn('Missing webhook signature or timestamp', {
                    component: 'WebhookMiddleware',
                    operation: 'verifyWebhookSignature',
                    type: 'webhook_signature',
                    step: 'missing_credentials',
                    ip: req.ip,
                    path: req.path,
                    hasSignature: !!signature,
                    hasTimestamp: !!timestamp
                });
                res.status(401).json({ 
                    error: 'Missing signature or timestamp' 
                });
                return;
            }

            loggingService.info('Step 2: Validating webhook timestamp to prevent replay attacks', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'validate_timestamp'
            });

            // Check timestamp to prevent replay attacks (5 minutes tolerance)
            const currentTime = Date.now();
            const webhookTime = parseInt(timestamp);
            const timeDifference = Math.abs(currentTime - webhookTime);
            const tolerance = 300000; // 5 minutes

            loggingService.info('Timestamp validation details', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'timestamp_analysis',
                currentTime,
                webhookTime,
                timeDifference,
                tolerance,
                isWithinTolerance: timeDifference <= tolerance
            });

            if (timeDifference > tolerance) {
                loggingService.warn('Webhook timestamp too old', {
                    component: 'WebhookMiddleware',
                    operation: 'verifyWebhookSignature',
                    type: 'webhook_signature',
                    step: 'timestamp_expired',
                    ip: req.ip,
                    path: req.path,
                    timestamp,
                    timeDifference,
                    tolerance
                });
                res.status(401).json({ 
                    error: 'Timestamp too old' 
                });
                return;
            }

            loggingService.info('Step 3: Retrieving webhook secret for signature verification', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'get_secret'
            });

            // Get secret from environment or parameter
            const secret = secretKey || process.env.WEBHOOK_SECRET;
            if (!secret) {
                loggingService.error('No webhook secret configured', {
                    component: 'WebhookMiddleware',
                    operation: 'verifyWebhookSignature',
                    type: 'webhook_signature',
                    step: 'no_secret_configured',
                    hasSecretKey: !!secretKey,
                    hasEnvSecret: !!process.env.WEBHOOK_SECRET
                });
                res.status(500).json({ 
                    error: 'Webhook verification not configured' 
                });
                return;
            }

            loggingService.info('Webhook secret retrieved successfully', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'secret_retrieved',
                hasSecret: !!secret,
                secretSource: secretKey ? 'parameter' : 'environment'
            });

            loggingService.info('Step 4: Verifying webhook signature', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'verify_signature'
            });

            // Verify signature
            const payload = JSON.stringify(req.body);
            const isValid = webhookService.verifySignature(
                secret,
                payload,
                timestamp,
                signature
            );

            loggingService.info('Signature verification completed', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'signature_verified',
                isValid,
                payloadLength: payload.length,
                signatureLength: signature.length
            });

            if (!isValid) {
                loggingService.warn('Invalid webhook signature', {
                    component: 'WebhookMiddleware',
                    operation: 'verifyWebhookSignature',
                    type: 'webhook_signature',
                    step: 'invalid_signature',
                    ip: req.ip,
                    path: req.path,
                    signature,
                    timestamp
                });
                res.status(401).json({ 
                    error: 'Invalid signature' 
                });
                return;
            }

            loggingService.info('Webhook signature verification completed successfully', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'verification_success',
                totalTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== WEBHOOK SIGNATURE VERIFICATION MIDDLEWARE COMPLETED ===', {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'completed',
                totalTime: `${Date.now() - startTime}ms`
            });

            // Signature is valid
            next();
        } catch (error) {
            loggingService.logError(error as Error, {
                component: 'WebhookMiddleware',
                operation: 'verifyWebhookSignature',
                type: 'webhook_signature',
                step: 'error',
                totalTime: `${Date.now() - startTime}ms`
            });
            res.status(500).json({ 
                error: 'Failed to verify webhook' 
            });
            return;
        }
    };
}

/**
 * Log webhook requests for debugging
 */
export function logWebhookRequest(
    req: Request, 
    res: Response, 
    next: NextFunction
): void {
    const startTime = Date.now();
    
    loggingService.info('=== WEBHOOK REQUEST LOGGING MIDDLEWARE STARTED ===', {
        component: 'WebhookMiddleware',
        operation: 'logWebhookRequest',
        type: 'webhook_logging',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Logging incoming webhook request details', {
        component: 'WebhookMiddleware',
        operation: 'logWebhookRequest',
        type: 'webhook_logging',
        step: 'log_request'
    });

    // Log request
    loggingService.debug('Incoming webhook request', {
        component: 'WebhookMiddleware',
        operation: 'logWebhookRequest',
        type: 'webhook_logging',
        step: 'request_logged',
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body,
        ip: req.ip
    });

    loggingService.info('Step 2: Setting up response logging interception', {
        component: 'WebhookMiddleware',
        operation: 'logWebhookRequest',
        type: 'webhook_logging',
        step: 'setup_response_logging'
    });

    // Log response
    const originalSend = res.send;
    res.send = function(data: any) {
        const duration = Date.now() - startTime;
        
        loggingService.debug('Webhook response logged', {
            component: 'WebhookMiddleware',
            operation: 'logWebhookRequest',
            type: 'webhook_logging',
            step: 'response_logged',
            statusCode: res.statusCode,
            duration,
            path: req.path,
            responseTime: `${duration}ms`
        });
        
        return originalSend.call(this, data);
    };

    loggingService.info('Webhook request logging setup completed successfully', {
        component: 'WebhookMiddleware',
        operation: 'logWebhookRequest',
        type: 'webhook_logging',
        step: 'setup_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== WEBHOOK REQUEST LOGGING MIDDLEWARE COMPLETED ===', {
        component: 'WebhookMiddleware',
        operation: 'logWebhookRequest',
        type: 'webhook_logging',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
}

/**
 * Webhook rate limiting per source IP with Redis primary and in-memory fallback
 */
export function webhookRateLimit(
    options: {
        maxRequests: number;
        windowMs: number;
    } = {
        maxRequests: 100,
        windowMs: 60000 // 1 minute
    }
): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        loggingService.info('=== WEBHOOK RATE LIMIT MIDDLEWARE STARTED ===', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            path: req.path,
            method: req.method,
            maxRequests: options.maxRequests,
            windowMs: options.windowMs
        });

        const ip = req.ip || 'unknown';
        const now = Date.now();
        const cacheKey = `webhook_rate_limit:${ip}`;

        loggingService.info('Step 1: Retrieving webhook rate limit record from cache', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            step: 'retrieve_record',
            ip,
            cacheKey
        });

        // Get rate limit record from Redis/in-memory cache
        let record: { count: number; resetTime: number } | null = null;
        try {
            const cachedRecord = await cacheService.get(cacheKey);
            if (cachedRecord) {
                record = cachedRecord as { count: number; resetTime: number };
                
                loggingService.info('Webhook rate limit record retrieved from cache', {
                    component: 'WebhookMiddleware',
                    operation: 'webhookRateLimit',
                    type: 'webhook_rate_limit',
                    step: 'record_retrieved',
                    ip,
                    cacheKey,
                    currentCount: record.count,
                    resetTime: new Date(record.resetTime).toISOString(),
                    timeUntilReset: record.resetTime - now
                });
            }
        } catch (error) {
            loggingService.warn('Failed to retrieve webhook rate limit record from cache', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'cache_retrieve_failed',
                ip,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Step 2: Processing webhook rate limit record', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            step: 'process_record'
        });

        // Check if record exists and is still valid
        if (!record || record.resetTime < now) {
            // Create new record
            record = {
                count: 1,
                resetTime: now + options.windowMs
            };
            
            loggingService.info('New webhook rate limit record created', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'record_created',
                ip,
                cacheKey,
                resetTime: new Date(record.resetTime).toISOString(),
                windowMs: options.windowMs
            });
        } else {
            // Increment existing record
            record.count++;
            
            loggingService.info('Existing webhook rate limit record incremented', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'record_incremented',
                ip,
                cacheKey,
                newCount: record.count,
                maxRequests: options.maxRequests,
                remaining: options.maxRequests - record.count
            });
        }

        loggingService.info('Step 3: Checking webhook rate limit status', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            step: 'check_limit'
        });

        // Check if limit exceeded
        if (record.count > options.maxRequests) {
            const retryAfter = Math.ceil((record.resetTime - now) / 1000);
            
            loggingService.warn('Webhook rate limit exceeded', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'limit_exceeded',
                ip,
                cacheKey,
                count: record.count,
                maxRequests: options.maxRequests,
                retryAfter,
                resetTime: new Date(record.resetTime).toISOString()
            });

            loggingService.info('Step 3a: Sending rate limit exceeded response', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'send_limit_response'
            });

            res.status(429).json({ 
                error: 'Too many requests',
                retryAfter
            });

            loggingService.info('Webhook rate limit exceeded response sent', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'response_sent',
                statusCode: 429,
                retryAfter,
                totalTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== WEBHOOK RATE LIMIT MIDDLEWARE COMPLETED (LIMIT EXCEEDED) ===', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'completed_limit_exceeded',
                totalTime: `${Date.now() - startTime}ms`
            });

            return;
        }

        loggingService.info('Step 4: Storing updated webhook rate limit record in cache', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            step: 'store_record'
        });

        // Store updated record in cache
        try {
            const ttl = Math.ceil((record.resetTime - now) / 1000);
            await cacheService.set(cacheKey, record, ttl, {
                type: 'webhook_rate_limit',
                ip,
                maxRequests: options.maxRequests,
                windowMs: options.windowMs
            });
            
            loggingService.info('Webhook rate limit record stored in cache successfully', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'record_stored',
                ip,
                cacheKey,
                ttl,
                count: record.count,
                resetTime: new Date(record.resetTime).toISOString()
            });
        } catch (error) {
            loggingService.warn('Failed to store webhook rate limit record in cache', {
                component: 'WebhookMiddleware',
                operation: 'webhookRateLimit',
                type: 'webhook_rate_limit',
                step: 'cache_store_failed',
                ip,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Webhook rate limit check completed successfully', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            step: 'check_complete',
            ip,
            cacheKey,
            currentCount: record.count,
            maxRequests: options.maxRequests,
            remaining: options.maxRequests - record.count,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== WEBHOOK RATE LIMIT MIDDLEWARE COMPLETED ===', {
            component: 'WebhookMiddleware',
            operation: 'webhookRateLimit',
            type: 'webhook_rate_limit',
            step: 'completed',
            ip,
            totalTime: `${Date.now() - startTime}ms`
        });

        next();
    };
}

/**
 * Parse webhook payload based on content type
 */
export function parseWebhookPayload(
    req: Request, 
    res: Response, 
    next: NextFunction
): void {
    const startTime = Date.now();
    
    loggingService.info('=== WEBHOOK PAYLOAD PARSING MIDDLEWARE STARTED ===', {
        component: 'WebhookMiddleware',
        operation: 'parseWebhookPayload',
        type: 'webhook_payload_parsing',
        path: req.path,
        method: req.method
    });

    const contentType = req.headers['content-type'];

    loggingService.info('Step 1: Analyzing webhook content type for parsing', {
        component: 'WebhookMiddleware',
        operation: 'parseWebhookPayload',
        type: 'webhook_payload_parsing',
        step: 'analyze_content_type',
        contentType,
        hasContentType: !!contentType
    });

    try {
        if (contentType?.includes('application/x-www-form-urlencoded')) {
            loggingService.info('Step 2a: Parsing URL-encoded webhook payload', {
                component: 'WebhookMiddleware',
                operation: 'parseWebhookPayload',
                type: 'webhook_payload_parsing',
                step: 'parse_url_encoded'
            });

            // Parse URL-encoded payload
            const params = new URLSearchParams(req.body);
            req.body = Object.fromEntries(params);
            
            loggingService.info('URL-encoded payload parsed successfully', {
                component: 'WebhookMiddleware',
                operation: 'parseWebhookPayload',
                type: 'webhook_payload_parsing',
                step: 'url_encoded_parsed',
                paramCount: params.size,
                parsedKeys: Object.keys(req.body)
            });
        } else if (contentType?.includes('text/plain')) {
            loggingService.info('Step 2b: Parsing plain text webhook payload', {
                component: 'WebhookMiddleware',
                operation: 'parseWebhookPayload',
                type: 'webhook_payload_parsing',
                step: 'parse_plain_text'
            });

            // Parse plain text
            req.body = { text: req.body };
            
            loggingService.info('Plain text payload parsed successfully', {
                component: 'WebhookMiddleware',
                operation: 'parseWebhookPayload',
                type: 'webhook_payload_parsing',
                step: 'plain_text_parsed',
                originalBody: req.body.text,
                parsedStructure: 'text field'
            });
        } else {
            loggingService.info('Step 2c: Using JSON payload (already parsed by express.json())', {
                component: 'WebhookMiddleware',
                operation: 'parseWebhookPayload',
                type: 'webhook_payload_parsing',
                step: 'use_json_payload',
                reason: 'JSON already parsed by express.json()'
            });
        }

        loggingService.info('Webhook payload parsing completed successfully', {
            component: 'WebhookMiddleware',
            operation: 'parseWebhookPayload',
            type: 'webhook_payload_parsing',
            step: 'parsing_complete',
            finalBodyType: typeof req.body,
            hasBody: !!req.body,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== WEBHOOK PAYLOAD PARSING MIDDLEWARE COMPLETED ===', {
            component: 'WebhookMiddleware',
            operation: 'parseWebhookPayload',
            type: 'webhook_payload_parsing',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

        next();
    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'WebhookMiddleware',
            operation: 'parseWebhookPayload',
            type: 'webhook_payload_parsing',
            step: 'error',
            contentType,
            totalTime: `${Date.now() - startTime}ms`
        });
        
        res.status(400).json({ 
            error: 'Invalid payload format' 
        });
        return;
    }
}

/**
 * Add webhook metadata to request
 */
export function addWebhookMetadata(
    req: Request, 
    _res: Response, 
    next: NextFunction
): void {
    const startTime = Date.now();
    
    loggingService.info('=== WEBHOOK METADATA MIDDLEWARE STARTED ===', {
        component: 'WebhookMiddleware',
        operation: 'addWebhookMetadata',
        type: 'webhook_metadata',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Adding webhook-specific metadata to request', {
        component: 'WebhookMiddleware',
        operation: 'addWebhookMetadata',
        type: 'webhook_metadata',
        step: 'add_metadata'
    });

    // Add webhook-specific metadata to request
    (req as any).webhook = {
        receivedAt: new Date(),
        source: req.headers['user-agent'] || 'unknown',
        ip: req.ip,
        headers: req.headers,
        rawBody: (req as any).rawBody // If raw body was captured
    };

    loggingService.info('Webhook metadata added successfully', {
        component: 'WebhookMiddleware',
        operation: 'addWebhookMetadata',
        type: 'webhook_metadata',
        step: 'metadata_added',
        metadata: {
            receivedAt: (req as any).webhook.receivedAt,
            source: (req as any).webhook.source,
            ip: (req as any).webhook.ip,
            hasHeaders: !!(req as any).webhook.headers,
            hasRawBody: !!(req as any).webhook.rawBody
        },
        totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== WEBHOOK METADATA MIDDLEWARE COMPLETED ===', {
        component: 'WebhookMiddleware',
        operation: 'addWebhookMetadata',
        type: 'webhook_metadata',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    next();
}

/**
 * Deduplicate webhook requests based on event ID with Redis primary and in-memory fallback
 */
export function deduplicateWebhooks(
    options: {
        ttl: number; // Time to live in milliseconds
        headerName?: string; // Header containing event ID
    } = {
        ttl: 3600000, // 1 hour
        headerName: 'x-event-id'
    }
): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        loggingService.info('=== WEBHOOK DEDUPLICATION MIDDLEWARE STARTED ===', {
            component: 'WebhookMiddleware',
            operation: 'deduplicateWebhooks',
            type: 'webhook_deduplication',
            path: req.path,
            method: req.method,
            ttl: options.ttl,
            headerName: options.headerName
        });

        const eventId = req.headers[options.headerName || 'x-event-id'] as string || 
                       req.body.eventId || 
                       req.body.id;

        loggingService.info('Step 1: Extracting event ID for deduplication', {
            component: 'WebhookMiddleware',
            operation: 'deduplicateWebhooks',
            type: 'webhook_deduplication',
            step: 'extract_event_id',
            eventId,
            source: req.headers[options.headerName || 'x-event-id'] ? 'header' : 
                   req.body.eventId ? 'body.eventId' : 
                   req.body.id ? 'body.id' : 'none'
        });

        if (!eventId) {
            loggingService.info('No event ID found, skipping deduplication', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'no_event_id',
                reason: 'Cannot deduplicate without event ID'
            });
            // No event ID, can't deduplicate
            next();
            return;
        }

        const now = Date.now();
        const cacheKey = `webhook_dedup:${eventId}`;

        loggingService.info('Step 2: Checking if event has already been processed', {
            component: 'WebhookMiddleware',
            operation: 'deduplicateWebhooks',
            type: 'webhook_deduplication',
            step: 'check_duplicate',
            eventId,
            cacheKey
        });

        // Check if already processed using Redis/in-memory cache
        let isDuplicate = false;
        try {
            const processedTimestamp = await cacheService.get<number>(cacheKey);
            if (processedTimestamp !== null) {
                isDuplicate = true;
                
                loggingService.info('Duplicate webhook event detected', {
                    component: 'WebhookMiddleware',
                    operation: 'deduplicateWebhooks',
                    type: 'webhook_deduplication',
                    step: 'duplicate_detected',
                    eventId,
                    cacheKey,
                    processedAt: new Date(processedTimestamp).toISOString(),
                    age: `${Math.round((now - processedTimestamp) / 1000)}s`
                });
            }
        } catch (error) {
            loggingService.warn('Failed to check duplicate status from cache', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'cache_check_failed',
                eventId,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        if (isDuplicate) {
            loggingService.info('Step 2a: Sending duplicate event response', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'send_duplicate_response'
            });

            res.status(200).json({ 
                success: true,
                message: 'Event already processed',
                eventId
            });

            loggingService.info('Duplicate event response sent', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'response_sent',
                statusCode: 200,
                eventId,
                totalTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== WEBHOOK DEDUPLICATION MIDDLEWARE COMPLETED (DUPLICATE) ===', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'completed_duplicate',
                eventId,
                totalTime: `${Date.now() - startTime}ms`
            });

            return;
        }

        loggingService.info('Step 3: Marking event as processed in cache', {
            component: 'WebhookMiddleware',
            operation: 'deduplicateWebhooks',
            type: 'webhook_deduplication',
            step: 'mark_processed'
        });

        // Mark as processed in cache
        try {
            const ttl = Math.ceil(options.ttl / 1000);
            await cacheService.set(cacheKey, now, ttl, {
                type: 'webhook_deduplication',
                eventId,
                ttl: options.ttl
            });
            
            loggingService.info('Event marked as processed in cache successfully', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'event_processed',
                eventId,
                cacheKey,
                ttl,
                processedAt: new Date(now).toISOString()
            });
        } catch (error) {
            loggingService.warn('Failed to mark event as processed in cache', {
                component: 'WebhookMiddleware',
                operation: 'deduplicateWebhooks',
                type: 'webhook_deduplication',
                step: 'cache_mark_failed',
                eventId,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Webhook deduplication completed successfully', {
            component: 'WebhookMiddleware',
            operation: 'deduplicateWebhooks',
            type: 'webhook_deduplication',
            step: 'deduplication_complete',
            eventId,
            cacheKey,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== WEBHOOK DEDUPLICATION MIDDLEWARE COMPLETED ===', {
            component: 'WebhookMiddleware',
            operation: 'deduplicateWebhooks',
            type: 'webhook_deduplication',
            step: 'completed',
            eventId,
            totalTime: `${Date.now() - startTime}ms`
        });

        next();
    };
}

/**
 * Validate webhook payload schema
 */
export function validateWebhookPayload(
    _schema: any // You can use a validation library like Joi or Yup
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        const startTime = Date.now();
        
        loggingService.info('=== WEBHOOK PAYLOAD VALIDATION MIDDLEWARE STARTED ===', {
            component: 'WebhookMiddleware',
            operation: 'validateWebhookPayload',
            type: 'webhook_payload_validation',
            path: req.path,
            method: req.method
        });

        loggingService.info('Step 1: Running basic webhook payload validation', {
            component: 'WebhookMiddleware',
            operation: 'validateWebhookPayload',
            type: 'webhook_payload_validation',
            step: 'basic_validation'
        });

        // Simple validation example - replace with proper schema validation
        if (!req.body || typeof req.body !== 'object') {
            loggingService.warn('Invalid webhook payload format', {
                component: 'WebhookMiddleware',
                operation: 'validateWebhookPayload',
                type: 'webhook_payload_validation',
                step: 'invalid_format',
                bodyType: typeof req.body,
                hasBody: !!req.body,
                totalTime: `${Date.now() - startTime}ms`
            });
            
            res.status(400).json({ 
                error: 'Invalid payload' 
            });
            return;
        }

        loggingService.info('Basic webhook payload validation passed', {
            component: 'WebhookMiddleware',
            operation: 'validateWebhookPayload',
            type: 'webhook_payload_validation',
            step: 'validation_passed',
            bodyType: typeof req.body,
            hasBody: !!req.body,
            totalTime: `${Date.now() - startTime}ms`
        });

        // Add your schema validation logic here
        // Example: const { error } = schema.validate(req.body);

        loggingService.info('=== WEBHOOK PAYLOAD VALIDATION MIDDLEWARE COMPLETED ===', {
            component: 'WebhookMiddleware',
            operation: 'validateWebhookPayload',
            type: 'webhook_payload_validation',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

        next();
    };
}