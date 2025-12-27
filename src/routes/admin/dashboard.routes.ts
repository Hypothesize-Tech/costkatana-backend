import express from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { AdminDashboardController } from '../../controllers/adminDashboard.controller';

const router = express.Router();

// Apply authentication and admin authorization to all routes
router.use(authenticate);
router.use(authorize('admin'));

// User Growth & Engagement
router.get('/analytics/user-growth', AdminDashboardController.getUserGrowthTrends);
router.get('/analytics/engagement', AdminDashboardController.getUserEngagementMetrics);
router.get('/analytics/user-segments', AdminDashboardController.getUserSegments);

// Anomaly Detection & Alerts
router.get('/alerts', AdminDashboardController.getCurrentAlerts);
router.get('/anomalies/spending', AdminDashboardController.detectSpendingAnomalies);
router.get('/anomalies/errors', AdminDashboardController.detectErrorAnomalies);

// Model/Service Comparison
router.get('/analytics/model-comparison', AdminDashboardController.getModelComparison);
router.get('/analytics/service-comparison', AdminDashboardController.getServiceComparison);

// Feature Analytics
router.get('/analytics/feature-usage', AdminDashboardController.getFeatureUsageStats);
router.get('/analytics/feature-adoption', AdminDashboardController.getFeatureAdoptionRates);
router.get('/analytics/feature-cost', AdminDashboardController.getFeatureCostAnalysis);

// Project & Workspace Analytics
router.get('/analytics/projects', AdminDashboardController.getProjectAnalytics);
router.get('/analytics/workspaces', AdminDashboardController.getWorkspaceAnalytics);
router.get('/analytics/projects/:projectId/trends', AdminDashboardController.getProjectTrends);

// User Management Routes
router.get('/users', AdminDashboardController.getAllUsers);
router.get('/users/stats', AdminDashboardController.getUserStats);
router.get('/users/:userId', AdminDashboardController.getUserDetail);
router.patch('/users/:userId/status', AdminDashboardController.updateUserStatus);
router.patch('/users/:userId/role', AdminDashboardController.updateUserRole);
router.delete('/users/:userId', AdminDashboardController.deleteUser);

// Activity Feed Routes - place before dynamic routes like /users/:userId
router.get('/analytics/activity/recent', AdminDashboardController.getRecentActivity);
router.get('/analytics/activity/feed', AdminDashboardController.initializeActivityFeed);

// Revenue & Billing Analytics
router.get('/analytics/revenue', AdminDashboardController.getRevenueMetrics);
router.get('/analytics/subscriptions', AdminDashboardController.getSubscriptionMetrics);
router.get('/analytics/conversions', AdminDashboardController.getConversionMetrics);
router.get('/analytics/renewals', AdminDashboardController.getUpcomingRenewals);

// API Key Management
router.get('/api-keys/stats', AdminDashboardController.getApiKeyStats);
router.get('/api-keys/usage', AdminDashboardController.getApiKeyUsage);
router.get('/api-keys/top', AdminDashboardController.getTopApiKeys);
router.get('/api-keys/expiring', AdminDashboardController.getExpiringApiKeys);
router.get('/api-keys/over-budget', AdminDashboardController.getApiKeysOverBudget);

// Endpoint Performance
router.get('/analytics/endpoints/performance', AdminDashboardController.getEndpointPerformance);
router.get('/analytics/endpoints/trends', AdminDashboardController.getEndpointTrends);
router.get('/analytics/endpoints/top', AdminDashboardController.getTopEndpoints);

// Geographic & Usage Patterns
router.get('/analytics/geographic/usage', AdminDashboardController.getGeographicUsage);
router.get('/analytics/geographic/peak-times', AdminDashboardController.getPeakUsageTimes);
router.get('/analytics/geographic/patterns', AdminDashboardController.getUsagePatterns);
router.get('/analytics/geographic/regions', AdminDashboardController.getMostActiveRegions);
router.get('/analytics/geographic/cost-distribution', AdminDashboardController.getGeographicCostDistribution);

// Budget Management
router.get('/budget/overview', AdminDashboardController.getBudgetOverview);
router.get('/budget/alerts', AdminDashboardController.getBudgetAlerts);
router.get('/budget/projects', AdminDashboardController.getProjectBudgetStatus);
router.get('/budget/trends', AdminDashboardController.getBudgetTrends);

// Integration Analytics
router.get('/analytics/integrations', AdminDashboardController.getIntegrationStats);
router.get('/analytics/integrations/trends', AdminDashboardController.getIntegrationTrends);
router.get('/analytics/integrations/health', AdminDashboardController.getIntegrationHealth);
router.get('/analytics/integrations/top', AdminDashboardController.getTopIntegrations);

// Report Export
router.post('/reports/export', AdminDashboardController.exportReport);

// Vectorization Monitoring
router.get('/dashboard/vectorization', AdminDashboardController.getVectorizationDashboard);

export default router;

