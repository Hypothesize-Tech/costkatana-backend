import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate, requirePermission } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { updateProfileSchema, addSecondaryEmailSchema, setPrimaryEmailSchema, initiateAccountClosureSchema } from '../utils/validators';
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

// Extended alert routes
router.get('/alerts/settings', asyncHandler(UserController.getAlertSettings));
router.put('/alerts/settings', asyncHandler(UserController.updateAlertSettings));
router.post('/alerts/test', asyncHandler(UserController.testAlert));
router.get('/alerts/unread-count', asyncHandler(UserController.getUnreadAlertCount));
router.put('/alerts/:id/snooze', asyncHandler(UserController.snoozeAlert));
router.get('/alerts/history', asyncHandler(UserController.getAlertHistory));

// Subscription routes
router.get('/subscription', asyncHandler(UserController.getSubscription));
router.put('/subscription', asyncHandler(UserController.updateSubscription));
router.post('/subscription/upgrade', asyncHandler(UserController.upgradeSubscription));
router.post('/subscription/create-stripe-setup-intent', asyncHandler(UserController.createStripeSetupIntent));
router.post('/subscription/confirm-stripe-payment', asyncHandler(UserController.confirmStripePayment));
router.post('/subscription/create-paypal-plan', asyncHandler(UserController.createPayPalPlan));
router.post('/subscription/approve-paypal', asyncHandler(UserController.approvePayPalSubscription));
router.post('/subscription/create-razorpay-order', asyncHandler(UserController.createRazorpayOrder));
router.post('/subscription/confirm-razorpay-payment', asyncHandler(UserController.confirmRazorpayPayment));
router.post('/subscription/downgrade', asyncHandler(UserController.downgradeSubscription));
router.post('/subscription/cancel', asyncHandler(UserController.cancelSubscription));
router.post('/subscription/reactivate', asyncHandler(UserController.reactivateSubscription));
router.post('/subscription/pause', asyncHandler(UserController.pauseSubscription));
router.post('/subscription/resume', asyncHandler(UserController.resumeSubscription));
router.put('/subscription/payment-method', asyncHandler(UserController.updatePaymentMethod));
router.put('/subscription/billing-cycle', asyncHandler(UserController.updateBillingCycle));
router.post('/subscription/validate-discount', asyncHandler(UserController.validateDiscountCode));
router.post('/subscription/discount', asyncHandler(UserController.applyDiscountCode));
router.get('/subscription/plans', asyncHandler(UserController.getAvailablePlans));
router.get('/subscription/usage', asyncHandler(UserController.getUsageAnalytics));
router.get('/subscription/history', asyncHandler(UserController.getSubscriptionHistory));
router.get('/spending', asyncHandler(UserController.getUserSpending));

// Preferences routes (including session replay settings)
router.get('/preferences', asyncHandler(UserController.getPreferences));
router.patch('/preferences', asyncHandler(UserController.updatePreferences));

// Email management routes
router.get('/emails', asyncHandler(UserController.getEmails));
router.post('/emails/secondary', validate(addSecondaryEmailSchema), asyncHandler(UserController.addSecondaryEmail));
router.delete('/emails/secondary/:email', asyncHandler(UserController.removeSecondaryEmail));
router.put('/emails/primary', validate(setPrimaryEmailSchema), asyncHandler(UserController.setPrimaryEmail));
router.post('/emails/:email/resend-verification', asyncHandler(UserController.resendVerification));

// Account closure routes
router.post('/account/closure/initiate', validate(initiateAccountClosureSchema), asyncHandler(UserController.initiateAccountClosure));
router.post('/account/closure/confirm/:token', asyncHandler(UserController.confirmAccountClosure));
router.post('/account/closure/cancel', asyncHandler(UserController.cancelAccountClosure));
router.get('/account/closure/status', asyncHandler(UserController.getAccountClosureStatus));
router.post('/account/reactivate', asyncHandler(UserController.reactivateAccount));

export default router;