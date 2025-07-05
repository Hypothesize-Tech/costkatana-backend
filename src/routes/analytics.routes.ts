import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateQuery } from '../middleware/validation.middleware';
import { analyticsQuerySchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get analytics data
router.get('/', validateQuery(analyticsQuerySchema), asyncHandler(AnalyticsController.getAnalytics));

// Compare multiple projects - MUST come before /projects/:projectId 
router.get('/projects/compare', asyncHandler(AnalyticsController.getProjectComparison));

// Get project-specific analytics
router.get('/projects/:projectId', validateQuery(analyticsQuerySchema), asyncHandler(AnalyticsController.getProjectAnalytics));

// Get comparative analytics
router.post('/compare', asyncHandler(AnalyticsController.getComparativeAnalytics));

// Get insights
router.get('/insights', asyncHandler(AnalyticsController.getInsights));

// Get dashboard data
router.get('/dashboard', asyncHandler(AnalyticsController.getDashboardData));

// Export analytics
router.get('/export', validateQuery(analyticsQuerySchema), asyncHandler(AnalyticsController.exportAnalytics));

export default router;