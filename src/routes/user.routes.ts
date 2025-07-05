import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate, requirePermission } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { updateProfileSchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Profile routes
router.get('/profile', asyncHandler(UserController.getProfile));
router.put('/profile', validate(updateProfileSchema), asyncHandler(UserController.updateProfile));
router.post('/profile/avatar-upload-url', asyncHandler(UserController.getPresignedAvatarUrl));

// Get user stats
router.get('/stats', asyncHandler(UserController.getUserStats));

// Get user activities
router.get('/activities', asyncHandler(UserController.getUserActivities));

// Dashboard API key routes
router.get('/dashboard-api-keys', asyncHandler(UserController.getDashboardApiKeys));
router.post('/dashboard-api-keys', requirePermission('write', 'admin'), asyncHandler(UserController.createDashboardApiKey));
router.put('/dashboard-api-keys/:keyId', requirePermission('write', 'admin'), asyncHandler(UserController.updateDashboardApiKey));
router.delete('/dashboard-api-keys/:keyId', requirePermission('write', 'admin'), asyncHandler(UserController.deleteDashboardApiKey));

// Alert routes
router.get('/alerts', asyncHandler(UserController.getAlerts));
router.put('/alerts/:id/read', asyncHandler(UserController.markAlertAsRead));
router.put('/alerts/read-all', asyncHandler(UserController.markAllAlertsAsRead));
router.delete('/alerts/:id', asyncHandler(UserController.deleteAlert));

// Subscription routes
router.get('/subscription', asyncHandler(UserController.getSubscription));
router.put('/subscription', asyncHandler(UserController.updateSubscription));

export default router;