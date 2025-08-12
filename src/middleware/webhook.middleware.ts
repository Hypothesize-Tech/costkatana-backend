import { Request, Response, NextFunction } from 'express';
import { webhookService } from '../services/webhook.service';
import { logger } from '../utils/logger';

/**
 * Verify webhook signature for inbound webhooks
 * This is used when Cost Katana receives webhooks from external services
 */
export function verifyWebhookSignature(
    secretKey?: string
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            // Get signature from headers
            const signature = req.headers['x-costkatana-signature'] as string;
            const timestamp = req.headers['x-costkatana-timestamp'] as string;

            if (!signature || !timestamp) {
                logger.warn('Missing webhook signature or timestamp', {
                    ip: req.ip,
                    path: req.path
                });
                res.status(401).json({ 
                    error: 'Missing signature or timestamp' 
                });
                return;
            }

            // Check timestamp to prevent replay attacks (5 minutes tolerance)
            const currentTime = Date.now();
            const webhookTime = parseInt(timestamp);
            if (Math.abs(currentTime - webhookTime) > 300000) { // 5 minutes
                logger.warn('Webhook timestamp too old', {
                    ip: req.ip,
                    path: req.path,
                    timestamp
                });
                res.status(401).json({ 
                    error: 'Timestamp too old' 
                });
                return;
            }

            // Get secret from environment or parameter
            const secret = secretKey || process.env.WEBHOOK_SECRET;
            if (!secret) {
                logger.error('No webhook secret configured');
                res.status(500).json({ 
                    error: 'Webhook verification not configured' 
                });
                return;
            }

            // Verify signature
            const payload = JSON.stringify(req.body);
            const isValid = webhookService.verifySignature(
                secret,
                payload,
                timestamp,
                signature
            );

            if (!isValid) {
                logger.warn('Invalid webhook signature', {
                    ip: req.ip,
                    path: req.path
                });
                res.status(401).json({ 
                    error: 'Invalid signature' 
                });
                return;
            }

            // Signature is valid
            next();
        } catch (error) {
            logger.error('Error verifying webhook signature', { error });
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

    // Log request
    logger.debug('Incoming webhook request', {
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body,
        ip: req.ip
    });

    // Log response
    const originalSend = res.send;
    res.send = function(data: any) {
        const duration = Date.now() - startTime;
        logger.debug('Webhook response', {
            statusCode: res.statusCode,
            duration,
            path: req.path
        });
        return originalSend.call(this, data);
    };

    next();
}

/**
 * Webhook rate limiting per source IP
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
    const requests = new Map<string, { count: number; resetTime: number }>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const ip = req.ip || 'unknown';
        const now = Date.now();

        // Clean up old entries
        for (const [key, value] of requests.entries()) {
            if (value.resetTime < now) {
                requests.delete(key);
            }
        }

        // Check rate limit
        const record = requests.get(ip);
        if (record && record.resetTime > now) {
            if (record.count >= options.maxRequests) {
                logger.warn('Webhook rate limit exceeded', {
                    ip,
                    count: record.count
                });
                res.status(429).json({ 
                    error: 'Too many requests',
                    retryAfter: Math.ceil((record.resetTime - now) / 1000)
                });
                return;
            }
            record.count++;
        } else {
            requests.set(ip, {
                count: 1,
                resetTime: now + options.windowMs
            });
        }

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
    const contentType = req.headers['content-type'];

    try {
        if (contentType?.includes('application/x-www-form-urlencoded')) {
            // Parse URL-encoded payload
            const params = new URLSearchParams(req.body);
            req.body = Object.fromEntries(params);
        } else if (contentType?.includes('text/plain')) {
            // Parse plain text
            req.body = { text: req.body };
        }
        // JSON is already parsed by express.json()

        next();
    } catch (error) {
        logger.error('Error parsing webhook payload', { error, contentType });
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
    // Add webhook-specific metadata to request
    (req as any).webhook = {
        receivedAt: new Date(),
        source: req.headers['user-agent'] || 'unknown',
        ip: req.ip,
        headers: req.headers,
        rawBody: (req as any).rawBody // If raw body was captured
    };

    next();
}

/**
 * Deduplicate webhook requests based on event ID
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
    const processedEvents = new Map<string, number>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const eventId = req.headers[options.headerName || 'x-event-id'] as string || 
                       req.body.eventId || 
                       req.body.id;

        if (!eventId) {
            // No event ID, can't deduplicate
            next();
            return;
        }

        const now = Date.now();

        // Clean up old entries
        for (const [id, timestamp] of processedEvents.entries()) {
            if (now - timestamp > options.ttl) {
                processedEvents.delete(id);
            }
        }

        // Check if already processed
        if (processedEvents.has(eventId)) {
            logger.info('Duplicate webhook detected', { eventId });
            res.status(200).json({ 
                success: true,
                message: 'Event already processed',
                eventId
            });
            return;
        }

        // Mark as processed
        processedEvents.set(eventId, now);
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
        // Simple validation example - replace with proper schema validation
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({ 
                error: 'Invalid payload' 
            });
            return;
        }

        // Add your schema validation logic here
        // Example: const { error } = schema.validate(req.body);

        next();
    };
}