import { Request, Response, NextFunction } from 'express';
import { redisService } from '../services/redis.service';

// Helper function to extract the prompt from various LLM API request formats
const extractPromptFromRequest = (req: Request): string | null => {
  const body = req.body;

  // OpenAI / Anthropic / new Bedrock format
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages
      .filter((msg: any) => msg.role === 'user' && msg.content)
      .map((msg: any) => msg.content)
      .join('\n');
  }

  // Older Bedrock / other models format
  if (typeof body.prompt === 'string') {
    return body.prompt;
  }

  return null;
};

export const cacheMiddleware = async (req: any, res: Response, next: NextFunction) => {
  // Import logger here to avoid circular dependencies
  const { logger } = require('../utils/logger');
  // Debug logging to see what paths are being checked - log all POST requests
  if (req.method === 'POST') {
    logger.info('🔍 Cache middleware called for POST request', { 
      path: req.path, 
      originalUrl: req.originalUrl, 
      url: req.url,
      method: req.method,
      fullPath: `${req.method} ${req.originalUrl}`,
      baseUrl: req.baseUrl,
      route: req.route?.path
    });
  }
  
  // Bypass cache for cost debugger endpoints to ensure fresh analysis
  // Check multiple path formats to handle different routing configurations
  const pathChecks = {
    'req.path includes /cost-debugger/': req.path.includes('/cost-debugger/'),
    'req.originalUrl includes /cost-debugger/': req.originalUrl.includes('/cost-debugger/'),
    'req.url includes /cost-debugger/': req.url.includes('/cost-debugger/'),
    'req.originalUrl includes /api/cost-debugger/': req.originalUrl.includes('/api/cost-debugger/'),
    'req.url includes /api/cost-debugger/': req.url.includes('/api/cost-debugger/')
  };
  
  const shouldBypass = Object.values(pathChecks).some(check => check);
  
  logger.info('🔍 Cache bypass check', { 
    path: req.path, 
    originalUrl: req.originalUrl,
    url: req.url,
    pathChecks,
    shouldBypass
  });
    
  if (shouldBypass) {
    logger.info('✅ Cache completely disabled for cost debugger endpoint', { 
      path: req.path, 
      originalUrl: req.originalUrl 
    });
    res.setHeader('X-Cache', 'DISABLED-COST-DEBUGGER');
    // Skip all cache logic for cost debugger endpoints
    return next();
  }

  // If we reach here, caching is enabled for this route
  logger.info('🔍 Cache enabled for this route, proceeding with cache check');

  const cacheControl = req.headers['cache-control'];
  if (cacheControl === 'no-cache') {
    res.setHeader('X-Cache', 'BYPASS');
    return next();
  }

  const prompt = extractPromptFromRequest(req);
  if (!prompt) {
    return next(); // Cannot cache without a prompt
  }

  try {
    const cacheResult = await redisService.checkCache(prompt, {
      model: req.body.model,
      // userId: req.user.id, // Example of passing user ID if available
    });

    if (cacheResult.hit) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Type', cacheResult.strategy?.toUpperCase() ?? 'UNKNOWN');
      return res.status(200).send(cacheResult.data);
    }
  } catch (err) {
    console.error('Cache check failed:', err);
    // Do not block request if cache fails
  }

  // If miss, proxy to actual LLM API and cache the response
  res.setHeader('X-Cache', 'MISS');
  const originalSend = res.send.bind(res);

  res.send = (body: any): Response => {
    // Intercept the response to cache it
    if (res.statusCode >= 200 && res.statusCode < 300) {
      (async () => {
        try {
          const responseBody = JSON.parse(body);
          let ttl = 3600; // Default TTL 1 hour
          if (cacheControl && cacheControl.includes('max-age')) {
            const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
            if (maxAgeMatch) {
              ttl = parseInt(maxAgeMatch[1], 10);
            }
          }

          await redisService.storeCache(prompt, responseBody, {
            model: req.body.model,
            ttl,
            userId: req.user.id, 
          });
        } catch (err) {
          // Catches JSON parsing errors or other issues
          console.error('Failed to cache response:', err);
        }
      })();
    }
    return originalSend(body);
  };

  next();
};
