import { Request, Response, NextFunction } from 'express';
import { redisService } from '../services/redis.service';

const extractPromptFromRequest = (req: Request): string | null => {
    const body = req.body;
    if (Array.isArray(body.messages) && body.messages.length > 0) {
        return body.messages
            .filter((msg: any) => msg.role === 'user' && msg.content)
            .map((msg: any) => msg.content)
            .join('\n');
    }
    if (typeof body.prompt === 'string') {
        return body.prompt;
    }
    return null;
};

export const cacheMiddleware = async (req: any, res: Response, next: NextFunction) => {
    const { loggingService } = require('../services/logging.service');
    const startTime = Date.now();

    if (req.method === 'POST') {
        loggingService.info('=== CACHE MIDDLEWARE STARTED ===', {
            component: 'CacheMiddleware',
            operation: 'cacheMiddleware',
            type: 'cache',
            step: 'start',
            path: req.path,
            method: req.method,
            originalUrl: req.originalUrl,
            url: req.url,
            baseUrl: req.baseUrl,
            route: req.route?.path
        });
    }

    const pathChecks = {
        reqPath: req.path.includes('/cost-debugger/'),
        reqOriginalUrl: req.originalUrl.includes('/cost-debugger/'),
        reqUrl: req.url.includes('/cost-debugger/'),
        reqOriginalUrlApi: req.originalUrl.includes('/api/cost-debugger/'),
        reqUrlApi: req.url.includes('/api/cost-debugger/')
    };

    const shouldBypass = Object.values(pathChecks).some(Boolean);

    loggingService.info('Cache bypass check', {
        component: 'CacheMiddleware',
        operation: 'cacheMiddleware',
        type: 'cache',
        step: 'bypass_check',
        path: req.path,
        originalUrl: req.originalUrl,
        url: req.url,
        pathChecks,
        shouldBypass
    });

    if (shouldBypass) {
        loggingService.info('Cache disabled for cost debugger endpoint', {
            component: 'CacheMiddleware',
            operation: 'cacheMiddleware',
            type: 'cache',
            step: 'bypass',
            path: req.path,
            originalUrl: req.originalUrl
        });
        res.setHeader('X-Cache', 'DISABLED-COST-DEBUGGER');
        return next();
    }

    loggingService.info('Cache enabled for this route, proceeding with cache check', {
        component: 'CacheMiddleware',
        operation: 'cacheMiddleware',
        type: 'cache',
        step: 'enabled',
        path: req.path,
        method: req.method
    });

    const cacheControl = req.headers['cache-control'];
    if (cacheControl === 'no-cache') {
        loggingService.info('Cache bypassed due to no-cache header', {
            component: 'CacheMiddleware',
            operation: 'cacheMiddleware',
            type: 'cache',
            step: 'no_cache_header',
            path: req.path
        });
        res.setHeader('X-Cache', 'BYPASS');
        return next();
    }

    const prompt = extractPromptFromRequest(req);
    if (!prompt) {
        loggingService.info('No prompt found in request, skipping cache', {
            component: 'CacheMiddleware',
            operation: 'cacheMiddleware',
            type: 'cache',
            step: 'no_prompt',
            path: req.path
        });
        return next();
    }

    try {
        loggingService.info('Checking cache for prompt', {
            component: 'CacheMiddleware',
            operation: 'cacheMiddleware',
            type: 'cache',
            step: 'check_cache',
            prompt,
            model: req.body.model
        });

        const cacheResult = await redisService.checkCache(prompt, {
            model: req.body.model
        });

        if (cacheResult.hit) {
            loggingService.info('Cache HIT', {
                component: 'CacheMiddleware',
                operation: 'cacheMiddleware',
                type: 'cache',
                step: 'hit',
                prompt,
                model: req.body.model,
                strategy: cacheResult.strategy,
                timeTaken: Date.now() - startTime + 'ms'
            });
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('X-Cache-Type', cacheResult.strategy?.toUpperCase() ?? 'UNKNOWN');
            return res.status(200).send(cacheResult.data);
        }
    } catch (err) {
        loggingService.logError(err as Error, {
            component: 'CacheMiddleware',
            operation: 'cacheMiddleware',
            type: 'cache',
            step: 'cache_check_error',
            path: req.path
        });
    }

    res.setHeader('X-Cache', 'MISS');
    const originalSend = res.send.bind(res);

    res.send = (body: any): Response => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            (async () => {
                try {
                    const responseBody = JSON.parse(body);
                    let ttl = 3600;
                    if (cacheControl && cacheControl.includes('max-age')) {
                        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
                        if (maxAgeMatch) {
                            ttl = parseInt(maxAgeMatch[1], 10);
                        }
                    }
                    await redisService.storeCache(prompt, responseBody, {
                        model: req.body.model,
                        ttl,
                        userId: req.user?.id
                    });
                    loggingService.info('Response cached successfully', {
                        component: 'CacheMiddleware',
                        operation: 'cacheMiddleware',
                        type: 'cache',
                        step: 'store_cache',
                        prompt,
                        model: req.body.model,
                        ttl
                    });
                } catch (err) {
                    loggingService.logError(err as Error, {
                        component: 'CacheMiddleware',
                        operation: 'cacheMiddleware',
                        type: 'cache',
                        step: 'store_cache_error',
                        prompt,
                        model: req.body.model
                    });
                }
            })();
        }
        return originalSend(body);
    };

    loggingService.info('=== CACHE MIDDLEWARE COMPLETED ===', {
        component: 'CacheMiddleware',
        operation: 'cacheMiddleware',
        type: 'cache',
        step: 'completed',
        path: req.path,
        method: req.method,
        timeTaken: Date.now() - startTime + 'ms'
    });

    next();
};
