import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { updateProfileSchema, addApiKeySchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Profile routes
router.get('/profile', asyncHandler(UserController.getProfile));
router.put('/profile', validate(updateProfileSchema), asyncHandler(UserController.updateProfile));

// API key routes
router.get('/api-keys', asyncHandler(UserController.getApiKeys));
router.post('/api-keys', validate(addApiKeySchema), asyncHandler(UserController.addApiKey));
router.delete('/api-keys/:service', asyncHandler(UserController.removeApiKey));

// Alert routes
router.get('/alerts', asyncHandler(UserController.getAlerts));
router.put('/alerts/:id/read', asyncHandler(UserController.markAlertAsRead));
router.put('/alerts/read-all', asyncHandler(UserController.markAllAlertsAsRead));
router.delete('/alerts/:id', asyncHandler(UserController.deleteAlert));

// Subscription routes
router.get('/subscription', asyncHandler(UserController.getSubscription));
router.put('/subscription', asyncHandler(UserController.updateSubscription));

export default router;