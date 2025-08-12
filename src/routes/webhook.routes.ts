import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { WebhookController } from '../controllers/webhook.controller';
import { asyncHandler } from '../middleware/error.middleware';
import { rateLimitMiddleware } from '../middleware/rateLimit.middleware';

const router = Router();

/**
 * Webhook Management Routes
 * All routes require authentication
 */

// Apply authentication to all webhook routes
router.use(authenticate);

// Get available webhook events
router.get('/events', asyncHandler(WebhookController.getAvailableEvents));

// Get queue statistics (admin only)
router.get('/queue/stats', asyncHandler(WebhookController.getQueueStats));

// CRUD operations for webhooks
router.get('/', asyncHandler(WebhookController.getWebhooks));
router.post('/', 
    rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }), // 10 webhooks per minute
    asyncHandler(WebhookController.createWebhook)
);

// Single webhook operations
router.get('/:id', asyncHandler(WebhookController.getWebhook));
router.put('/:id', asyncHandler(WebhookController.updateWebhook));
router.delete('/:id', asyncHandler(WebhookController.deleteWebhook));

// Test webhook
router.post('/:id/test', 
    rateLimitMiddleware({ maxRequests: 5, windowMs: 60000 }), // 5 tests per minute
    asyncHandler(WebhookController.testWebhook)
);

// Get webhook statistics
router.get('/:id/stats', asyncHandler(WebhookController.getWebhookStats));

// Delivery operations
router.get('/:id/deliveries', asyncHandler(WebhookController.getDeliveries));

// Single delivery operations
router.get('/deliveries/:deliveryId', asyncHandler(WebhookController.getDelivery));
router.post('/deliveries/:deliveryId/replay', 
    rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }), // 10 replays per minute
    asyncHandler(WebhookController.replayDelivery)
);

export default router;
