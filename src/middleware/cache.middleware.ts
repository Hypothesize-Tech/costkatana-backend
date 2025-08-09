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

export const cacheMiddleware = async (req: Request, res: Response, next: NextFunction) => {
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
            // userId: req.user.id, // Example
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
