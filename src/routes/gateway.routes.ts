import { Router } from 'express';
import { GatewayController } from '../controllers/gateway.controller';
import { 
    gatewayAuth, 
    processGatewayHeaders, 
    gatewayRateLimit, 
    addGatewayResponseHeaders 
} from '../middleware/gateway.middleware';
import { priorityQueueMiddleware, getQueueStatus } from '../middleware/priorityQueue.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { loggingService } from '../services/logging.service';

const router = Router();

/**
 * Gateway Health Check
 */
router.get('/health', GatewayController.healthCheck);

/**
 * Gateway Statistics (requires authentication)
 */
router.get('/stats', 
    authenticate,
    GatewayController.getStats
);

/**
 * Priority Queue Status (requires authentication)
 */
router.get('/queue/status',
    authenticate,
    getQueueStatus
);

/**
 * Cache Management Routes (requires authentication)
 */
router.get('/cache/stats', 
    authenticate,
    GatewayController.getCacheStats
);

router.delete('/cache', 
    authenticate,
    GatewayController.clearCache
);

/**
 * Failover Analytics Routes (requires authentication)
 */
router.get('/failover/analytics', 
    authenticate,
    GatewayController.getFailoverAnalytics
);

/**
 * Firewall Analytics Routes (requires authentication)
 */
router.get('/firewall/analytics', 
    authenticate,
    GatewayController.getFirewallAnalytics
);

/**
 * Main Gateway Routes
 * These routes proxy requests to AI providers with full CostKATANA features
 */

// Apply middleware stack for all gateway proxy routes
router.use('/', [
    addGatewayResponseHeaders,     // Add response headers
    gatewayAuth,                   // Authenticate using CostKatana-Auth header
    processGatewayHeaders,         // Process all CostKATANA headers
    priorityQueueMiddleware,       // Handle request prioritization
    gatewayRateLimit(1000, 60000), // Rate limit: 1000 requests per minute
]);

// Log gateway route setup
router.use('/', (req, _res, next) => {
    loggingService.debug('Gateway route matched', {
        method: req.method,
        path: req.path,
        targetUrl: req.gatewayContext?.targetUrl,
        userId: req.gatewayContext?.userId
    });
    next();
});

/**
 * OpenAI Compatible Routes
 * These routes are commonly used by OpenAI SDK and similar clients
 */
router.post('/v1/chat/completions', GatewayController.proxyRequest);
router.post('/v1/completions', GatewayController.proxyRequest);
router.post('/v1/embeddings', GatewayController.proxyRequest);
router.post('/v1/images/generations', GatewayController.proxyRequest);
router.post('/v1/audio/transcriptions', GatewayController.proxyRequest);
router.post('/v1/audio/translations', GatewayController.proxyRequest);

// Models endpoint
router.get('/v1/models', GatewayController.proxyRequest);
router.get('/v1/models/:model', GatewayController.proxyRequest);

/**
 * Anthropic Compatible Routes
 */
router.post('/v1/messages', GatewayController.proxyRequest);

/**
 * Google AI Compatible Routes
 */
router.post('/v1/models/:model:generateContent', GatewayController.proxyRequest);
router.post('/v1/models/:model:streamGenerateContent', GatewayController.proxyRequest);

/**
 * AWS Bedrock Compatible Routes
 */
router.post('/model/:model/invoke', GatewayController.proxyRequest);
router.post('/model/:model/invoke-with-response-stream', GatewayController.proxyRequest);

/**
 * Cohere Compatible Routes
 */
router.post('/v1/generate', GatewayController.proxyRequest);
router.post('/v1/embed', GatewayController.proxyRequest);
router.post('/v1/rerank', GatewayController.proxyRequest);

/**
 * Generic catch-all route for any other endpoints
 * This allows the gateway to proxy any API endpoint
 */
router.all('*', GatewayController.proxyRequest);

export { router as gatewayRoutes };