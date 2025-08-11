import { Router } from 'express';
import { GuardrailsController } from '../controllers/guardrails.controller';
import { authenticate } from '../middleware/auth.middleware';
import { GuardrailsService } from '../services/guardrails.service';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Apply guardrails middleware to all routes (after authentication)
router.use(GuardrailsService.enforceGuardrails);

// Usage endpoints
router.get('/usage', GuardrailsController.getUserUsage);
router.get('/usage/trend', GuardrailsController.getUsageTrend);
router.get('/usage/alerts', GuardrailsController.getUsageAlerts);

// Guardrails checking
router.post('/check', GuardrailsController.checkGuardrails);

// Plan information
router.get('/plans/:plan', GuardrailsController.getPlanLimits);

// Subscription management
router.put('/subscription', GuardrailsController.updateSubscription);

// Admin endpoints
router.post('/usage/track/:userId?', GuardrailsController.trackUsage);
router.post('/usage/reset', GuardrailsController.resetMonthlyUsage);
router.post('/usage/simulate', GuardrailsController.simulateUsage);

export default router;
