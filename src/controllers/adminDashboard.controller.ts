import { Response, NextFunction } from 'express';
import { AdminUserGrowthService } from '../services/adminUserGrowth.service';
import { AdminAnomalyDetectionService } from '../services/adminAnomalyDetection.service';
import { AdminModelComparisonService } from '../services/adminModelComparison.service';
import { AdminFeatureAnalyticsService } from '../services/adminFeatureAnalytics.service';
import { AdminProjectAnalyticsService } from '../services/adminProjectAnalytics.service';
import { AdminUserManagementService } from '../services/adminUserManagement.service';
import { AdminActivityFeedService } from '../services/adminActivityFeed.service';
import { AdminRevenueAnalyticsService } from '../services/adminRevenueAnalytics.service';
import { AdminApiKeyManagementService } from '../services/adminApiKeyManagement.service';
import { AdminEndpointPerformanceService } from '../services/adminEndpointPerformance.service';
import { AdminGeographicPatternsService } from '../services/adminGeographicPatterns.service';
import { AdminBudgetManagementService } from '../services/adminBudgetManagement.service';
import { AdminIntegrationAnalyticsService } from '../services/adminIntegrationAnalytics.service';
import { AdminReportingService } from '../services/adminReporting.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';
import { loggingService } from '../services/logging.service';

export class AdminDashboardController {
    /**
     * Get user growth trends
     * GET /api/admin/analytics/user-growth
     */
    static async getUserGrowthTrends(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUserGrowthTrends', req);

            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'daily';
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const trends = await AdminUserGrowthService.getUserGrowthTrends(period, startDate, endDate);

            ControllerHelper.logRequestSuccess('getUserGrowthTrends', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: trends
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserGrowthTrends', error, req, res, startTime);
        }
    }

    /**
     * Get user engagement metrics
     * GET /api/admin/analytics/engagement
     */
    static async getUserEngagementMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUserEngagementMetrics', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const metrics = await AdminUserGrowthService.getUserEngagementMetrics(startDate, endDate);

            ControllerHelper.logRequestSuccess('getUserEngagementMetrics', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserEngagementMetrics', error, req, res, startTime);
        }
    }

    /**
     * Get user segments
     * GET /api/admin/analytics/user-segments
     */
    static async getUserSegments(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUserSegments', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const segments = await AdminUserGrowthService.getUserSegments(startDate, endDate);

            ControllerHelper.logRequestSuccess('getUserSegments', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: segments
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserSegments', error, req, res, startTime);
        }
    }

    /**
     * Get current alerts
     * GET /api/admin/alerts
     */
    static async getCurrentAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getCurrentAlerts', req);

            const alerts = await AdminAnomalyDetectionService.getCurrentAlerts();

            ControllerHelper.logRequestSuccess('getCurrentAlerts', req, startTime, { adminUserId: userId, alertCount: alerts.length });

            res.json({
                success: true,
                data: alerts
            });
        } catch (error: any) {
            ControllerHelper.handleError('getCurrentAlerts', error, req, res, startTime);
        }
    }

    /**
     * Detect spending anomalies
     * GET /api/admin/anomalies/spending
     */
    static async detectSpendingAnomalies(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('detectSpendingAnomalies', req);

            const timeWindow = (req.query.timeWindow as 'hour' | 'day' | 'week') || 'day';
            const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : 2.0;

            const anomalies = await AdminAnomalyDetectionService.detectSpendingAnomalies(timeWindow, threshold);

            ControllerHelper.logRequestSuccess('detectSpendingAnomalies', req, startTime, { adminUserId: userId, anomalyCount: anomalies.length });

            res.json({
                success: true,
                data: anomalies
            });
        } catch (error: any) {
            ControllerHelper.handleError('detectSpendingAnomalies', error, req, res, startTime);
        }
    }

    /**
     * Detect error anomalies
     * GET /api/admin/anomalies/errors
     */
    static async detectErrorAnomalies(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('detectErrorAnomalies', req);

            const timeWindow = (req.query.timeWindow as 'hour' | 'day' | 'week') || 'day';
            const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : 0.1;

            const anomalies = await AdminAnomalyDetectionService.detectErrorAnomalies(timeWindow, threshold);

            ControllerHelper.logRequestSuccess('detectErrorAnomalies', req, startTime, { adminUserId: userId, anomalyCount: anomalies.length });

            res.json({
                success: true,
                data: anomalies
            });
        } catch (error: any) {
            ControllerHelper.handleError('detectErrorAnomalies', error, req, res, startTime);
        }
    }

    /**
     * Get model comparison
     * GET /api/admin/analytics/model-comparison
     */
    static async getModelComparison(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getModelComparison', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                service: req.query.service as string | undefined,
                userId: req.query.userId as string | undefined
            };

            const comparison = await AdminModelComparisonService.getModelComparison(filters);

            ControllerHelper.logRequestSuccess('getModelComparison', req, startTime, { adminUserId: userId, modelCount: comparison.length });

            res.json({
                success: true,
                data: comparison
            });
        } catch (error: any) {
            ControllerHelper.handleError('getModelComparison', error, req, res, startTime);
        }
    }

    /**
     * Get service comparison
     * GET /api/admin/analytics/service-comparison
     */
    static async getServiceComparison(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getServiceComparison', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                service: req.query.service as string | undefined,
                userId: req.query.userId as string | undefined
            };

            const comparison = await AdminModelComparisonService.getServiceComparison(filters);

            ControllerHelper.logRequestSuccess('getServiceComparison', req, startTime, { adminUserId: userId, serviceCount: comparison.length });

            res.json({
                success: true,
                data: comparison
            });
        } catch (error: any) {
            ControllerHelper.handleError('getServiceComparison', error, req, res, startTime);
        }
    }

    /**
     * Get feature usage stats
     * GET /api/admin/analytics/feature-usage
     */
    static async getFeatureUsageStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getFeatureUsageStats', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                userId: req.query.userId as string | undefined
            };

            const stats = await AdminFeatureAnalyticsService.getFeatureUsageStats(filters);

            ControllerHelper.logRequestSuccess('getFeatureUsageStats', req, startTime, { adminUserId: userId, featureCount: stats.length });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getFeatureUsageStats', error, req, res, startTime);
        }
    }

    /**
     * Get feature adoption rates
     * GET /api/admin/analytics/feature-adoption
     */
    static async getFeatureAdoptionRates(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getFeatureAdoptionRates', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined
            };

            const adoption = await AdminFeatureAnalyticsService.getFeatureAdoptionRates(filters);

            ControllerHelper.logRequestSuccess('getFeatureAdoptionRates', req, startTime, { adminUserId: userId, featureCount: adoption.length });

            res.json({
                success: true,
                data: adoption
            });
        } catch (error: any) {
            ControllerHelper.handleError('getFeatureAdoptionRates', error, req, res, startTime);
        }
    }

    /**
     * Get feature cost analysis
     * GET /api/admin/analytics/feature-cost
     */
    static async getFeatureCostAnalysis(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getFeatureCostAnalysis', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined
            };

            const analysis = await AdminFeatureAnalyticsService.getFeatureCostAnalysis(filters);

            ControllerHelper.logRequestSuccess('getFeatureCostAnalysis', req, startTime, { adminUserId: userId, featureCount: analysis.length });

            res.json({
                success: true,
                data: analysis
            });
        } catch (error: any) {
            ControllerHelper.handleError('getFeatureCostAnalysis', error, req, res, startTime);
        }
    }

    /**
     * Get project analytics
     * GET /api/admin/analytics/projects
     */
    static async getProjectAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getProjectAnalytics', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                workspaceId: req.query.workspaceId as string | undefined,
                isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined
            };

            const analytics = await AdminProjectAnalyticsService.getProjectAnalytics(filters);

            ControllerHelper.logRequestSuccess('getProjectAnalytics', req, startTime, { adminUserId: userId, projectCount: analytics.length });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProjectAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get workspace analytics
     * GET /api/admin/analytics/workspaces
     */
    static async getWorkspaceAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getWorkspaceAnalytics', req);

            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined
            };

            const analytics = await AdminProjectAnalyticsService.getWorkspaceAnalytics(filters);

            ControllerHelper.logRequestSuccess('getWorkspaceAnalytics', req, startTime, { adminUserId: userId, workspaceCount: analytics.length });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getWorkspaceAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get project trends
     * GET /api/admin/analytics/projects/:projectId/trends
     */
    static async getProjectTrends(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getProjectTrends', req);

            const { projectId } = req.params;
            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'daily';
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            if (!projectId) {
                res.status(400).json({
                    success: false,
                    error: 'Project ID is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(projectId, 'projectId');

            const trends = await AdminProjectAnalyticsService.getProjectTrends(
                projectId,
                period,
                startDate,
                endDate
            );

            ControllerHelper.logRequestSuccess('getProjectTrends', req, startTime, { adminUserId: userId, projectId });

            res.json({
                success: true,
                data: trends
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProjectTrends', error, req, res, startTime);
        }
    }

    /**
     * Get all users (admin management)
     * GET /api/admin/users
     */
    static async getAllUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getAllUsers', req);

            const filters: any = {
                search: req.query.search,
                role: req.query.role,
                isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
                emailVerified: req.query.emailVerified !== undefined ? req.query.emailVerified === 'true' : undefined,
                subscriptionPlan: req.query.subscriptionPlan,
                sortBy: req.query.sortBy,
                sortOrder: req.query.sortOrder,
                limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
                offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
            };

            // Remove undefined values
            Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

            const users = await AdminUserManagementService.getAllUsers(filters);

            ControllerHelper.logRequestSuccess('getAllUsers', req, startTime, { adminUserId: userId, count: users.length });

            res.json({
                success: true,
                data: users
            });
        } catch (error: any) {
            ControllerHelper.handleError('getAllUsers', error, req, res, startTime);
        }
    }

    /**
     * Get user detail
     * GET /api/admin/users/:userId
     */
    static async getUserDetail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('getUserDetail', req);

            const { userId } = req.params;
            ServiceHelper.validateObjectId(userId, 'userId');
            const user = await AdminUserManagementService.getUserDetail(userId);

            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getUserDetail', req, startTime, { adminUserId, userId });

            res.json({
                success: true,
                data: user
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserDetail', error, req, res, startTime);
        }
    }

    /**
     * Update user status
     * PATCH /api/admin/users/:userId/status
     */
    static async updateUserStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('updateUserStatus', req);

            const { userId } = req.params;
            const { isActive } = req.body;

            ServiceHelper.validateObjectId(userId, 'userId');

            if (typeof isActive !== 'boolean') {
                res.status(400).json({
                    success: false,
                    message: 'isActive must be a boolean'
                });
                return;
            }

            const updated = await AdminUserManagementService.updateUserStatus(userId, isActive);

            if (!updated) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('updateUserStatus', req, startTime, { adminUserId, userId, isActive });

            res.json({
                success: true,
                message: `User ${isActive ? 'activated' : 'suspended'} successfully`
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateUserStatus', error, req, res, startTime);
        }
    }

    /**
     * Update user role
     * PATCH /api/admin/users/:userId/role
     */
    static async updateUserRole(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('updateUserRole', req);

            const { userId } = req.params;
            const { role } = req.body;

            ServiceHelper.validateObjectId(userId, 'userId');

            if (!role || !['user', 'admin'].includes(role)) {
                res.status(400).json({
                    success: false,
                    message: 'role must be "user" or "admin"'
                });
                return;
            }

            const updated = await AdminUserManagementService.updateUserRole(userId, role);

            if (!updated) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('updateUserRole', req, startTime, { adminUserId, userId, role });

            res.json({
                success: true,
                message: 'User role updated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateUserRole', error, req, res, startTime);
        }
    }

    /**
     * Delete user (soft delete)
     * DELETE /api/admin/users/:userId
     */
    static async deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('deleteUser', req);

            const { userId } = req.params;

            ServiceHelper.validateObjectId(userId, 'userId');

            // Prevent deleting yourself
            if (userId === adminUserId) {
                res.status(400).json({
                    success: false,
                    message: 'You cannot delete your own account'
                });
                return;
            }

            const deleted = await AdminUserManagementService.deleteUser(userId);

            if (!deleted) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('deleteUser', req, startTime, { adminUserId, userId });

            res.json({
                success: true,
                message: 'User deleted successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteUser', error, req, res, startTime);
        }
    }

    /**
     * Get user statistics
     * GET /api/admin/users/stats
     */
    static async getUserStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUserStats', req);

            const stats = await AdminUserManagementService.getUserStats();

            ControllerHelper.logRequestSuccess('getUserStats', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserStats', error, req, res, startTime);
        }
    }

    /**
     * Get recent activity events
     * GET /api/admin/analytics/activity/recent
     */
    static async getRecentActivity(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getRecentActivity', req);

            const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
            const filters: any = {
                severity: req.query.severity ? (req.query.severity as string).split(',') : undefined,
                types: req.query.types ? (req.query.types as string).split(',') : undefined,
                userId: req.query.userId,
                projectId: req.query.projectId,
            };

            // Remove undefined values
            Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

            const events = await AdminActivityFeedService.getRecentEvents(limit, filters);

            ControllerHelper.logRequestSuccess('getRecentActivity', req, startTime, { adminUserId: userId, count: events.length });

            res.json({
                success: true,
                data: events
            });
        } catch (error: any) {
            ControllerHelper.handleError('getRecentActivity', error, req, res, startTime);
        }
    }

    /**
     * Initialize SSE connection for admin activity feed
     * GET /api/admin/dashboard/activity/feed
     */
    static async initializeActivityFeed(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const adminId = req.userId!;
            ControllerHelper.logRequestStart('initializeActivityFeed', req);

            const filters: any = {
                severity: req.query.severity ? (req.query.severity as string).split(',') : undefined,
                types: req.query.types ? (req.query.types as string).split(',') : undefined,
                userId: req.query.userId,
                projectId: req.query.projectId,
            };

            // Remove undefined values
            Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

            AdminActivityFeedService.initializeAdminFeed(adminId, res, filters);

            ControllerHelper.logRequestSuccess('initializeActivityFeed', req, startTime, { adminUserId: adminId });
        } catch (error: any) {
            ControllerHelper.handleError('initializeActivityFeed', error, req, res, startTime);
        }
    }

    // ============ Revenue & Billing Analytics ============

    /**
     * Get revenue metrics
     * GET /api/admin/analytics/revenue
     */
    static async getRevenueMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getRevenueMetrics', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const metrics = await AdminRevenueAnalyticsService.getRevenueMetrics(startDate, endDate);

            ControllerHelper.logRequestSuccess('getRevenueMetrics', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getRevenueMetrics', error, req, res, startTime);
        }
    }

    /**
     * Get subscription metrics
     * GET /api/admin/analytics/subscriptions
     */
    static async getSubscriptionMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getSubscriptionMetrics', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const metrics = await AdminRevenueAnalyticsService.getSubscriptionMetrics(startDate, endDate);

            ControllerHelper.logRequestSuccess('getSubscriptionMetrics', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getSubscriptionMetrics', error, req, res, startTime);
        }
    }

    /**
     * Get conversion metrics
     * GET /api/admin/analytics/conversions
     */
    static async getConversionMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getConversionMetrics', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const metrics = await AdminRevenueAnalyticsService.getConversionMetrics(startDate, endDate);

            ControllerHelper.logRequestSuccess('getConversionMetrics', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error: any) {
            ControllerHelper.handleError('getConversionMetrics', error, req, res, startTime);
        }
    }

    /**
     * Get upcoming renewals
     * GET /api/admin/analytics/renewals
     */
    static async getUpcomingRenewals(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUpcomingRenewals', req);

            const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

            const renewals = await AdminRevenueAnalyticsService.getUpcomingRenewals(days);

            ControllerHelper.logRequestSuccess('getUpcomingRenewals', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: renewals
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUpcomingRenewals', error, req, res, startTime);
        }
    }

    // ============ API Key Management ============

    /**
     * Get API key statistics
     * GET /api/admin/api-keys/stats
     */
    static async getApiKeyStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getApiKeyStats', req);

            const stats = await AdminApiKeyManagementService.getApiKeyStats();

            ControllerHelper.logRequestSuccess('getApiKeyStats', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getApiKeyStats', error, req, res, startTime);
        }
    }

    /**
     * Get API key usage
     * GET /api/admin/api-keys/usage
     */
    static async getApiKeyUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getApiKeyUsage', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const usage = await AdminApiKeyManagementService.getApiKeyUsage(startDate, endDate);

            ControllerHelper.logRequestSuccess('getApiKeyUsage', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: usage
            });
        } catch (error: any) {
            ControllerHelper.handleError('getApiKeyUsage', error, req, res, startTime);
        }
    }

    /**
     * Get top API keys
     * GET /api/admin/api-keys/top
     */
    static async getTopApiKeys(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTopApiKeys', req);

            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const topKeys = await AdminApiKeyManagementService.getTopApiKeys(limit);

            ControllerHelper.logRequestSuccess('getTopApiKeys', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: topKeys
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTopApiKeys', error, req, res, startTime);
        }
    }

    /**
     * Get expiring API keys
     * GET /api/admin/api-keys/expiring
     */
    static async getExpiringApiKeys(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getExpiringApiKeys', req);

            const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

            const expiringKeys = await AdminApiKeyManagementService.getExpiringApiKeys(days);

            ControllerHelper.logRequestSuccess('getExpiringApiKeys', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: expiringKeys
            });
        } catch (error: any) {
            ControllerHelper.handleError('getExpiringApiKeys', error, req, res, startTime);
        }
    }

    /**
     * Get API keys over budget
     * GET /api/admin/api-keys/over-budget
     */
    static async getApiKeysOverBudget(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getApiKeysOverBudget', req);

            const overBudgetKeys = await AdminApiKeyManagementService.getApiKeysOverBudget();

            ControllerHelper.logRequestSuccess('getApiKeysOverBudget', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: overBudgetKeys
            });
        } catch (error: any) {
            ControllerHelper.handleError('getApiKeysOverBudget', error, req, res, startTime);
        }
    }

    // ============ Endpoint Performance ============

    /**
     * Get endpoint performance
     * GET /api/admin/analytics/endpoints/performance
     */
    static async getEndpointPerformance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getEndpointPerformance', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const performance = await AdminEndpointPerformanceService.getEndpointPerformance(startDate, endDate);

            ControllerHelper.logRequestSuccess('getEndpointPerformance', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: performance
            });
        } catch (error: any) {
            ControllerHelper.handleError('getEndpointPerformance', error, req, res, startTime);
        }
    }

    /**
     * Get endpoint trends
     * GET /api/admin/analytics/endpoints/trends
     */
    static async getEndpointTrends(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getEndpointTrends', req);

            const endpoint = req.query.endpoint as string | undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const trends = await AdminEndpointPerformanceService.getEndpointTrends(endpoint, startDate, endDate);

            ControllerHelper.logRequestSuccess('getEndpointTrends', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: trends
            });
        } catch (error: any) {
            ControllerHelper.handleError('getEndpointTrends', error, req, res, startTime);
        }
    }

    /**
     * Get top endpoints
     * GET /api/admin/analytics/endpoints/top
     */
    static async getTopEndpoints(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTopEndpoints', req);

            const metric = (req.query.metric as 'requests' | 'cost' | 'responseTime' | 'errors') || 'requests';
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const topEndpoints = await AdminEndpointPerformanceService.getTopEndpoints(metric, limit);

            ControllerHelper.logRequestSuccess('getTopEndpoints', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: topEndpoints
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTopEndpoints', error, req, res, startTime);
        }
    }

    // ============ Geographic & Usage Patterns ============

    /**
     * Get geographic usage
     * GET /api/admin/analytics/geographic/usage
     */
    static async getGeographicUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getGeographicUsage', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const usage = await AdminGeographicPatternsService.getGeographicUsage(startDate, endDate);

            ControllerHelper.logRequestSuccess('getGeographicUsage', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: usage
            });
        } catch (error: any) {
            ControllerHelper.handleError('getGeographicUsage', error, req, res, startTime);
        }
    }

    /**
     * Get peak usage times
     * GET /api/admin/analytics/geographic/peak-times
     */
    static async getPeakUsageTimes(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getPeakUsageTimes', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const peakTimes = await AdminGeographicPatternsService.getPeakUsageTimes(startDate, endDate);

            ControllerHelper.logRequestSuccess('getPeakUsageTimes', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: peakTimes
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPeakUsageTimes', error, req, res, startTime);
        }
    }

    /**
     * Get usage patterns
     * GET /api/admin/analytics/geographic/patterns
     */
    static async getUsagePatterns(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getUsagePatterns', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const patterns = await AdminGeographicPatternsService.getUsagePatterns(startDate, endDate);

            ControllerHelper.logRequestSuccess('getUsagePatterns', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: patterns
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUsagePatterns', error, req, res, startTime);
        }
    }

    /**
     * Get most active regions
     * GET /api/admin/analytics/geographic/regions
     */
    static async getMostActiveRegions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getMostActiveRegions', req);

            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const regions = await AdminGeographicPatternsService.getMostActiveRegions(limit);

            ControllerHelper.logRequestSuccess('getMostActiveRegions', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: regions
            });
        } catch (error: any) {
            ControllerHelper.handleError('getMostActiveRegions', error, req, res, startTime);
        }
    }

    /**
     * Get geographic cost distribution
     * GET /api/admin/analytics/geographic/cost-distribution
     */
    static async getGeographicCostDistribution(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getGeographicCostDistribution', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const distribution = await AdminGeographicPatternsService.getGeographicCostDistribution(startDate, endDate);

            ControllerHelper.logRequestSuccess('getGeographicCostDistribution', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: distribution
            });
        } catch (error: any) {
            ControllerHelper.handleError('getGeographicCostDistribution', error, req, res, startTime);
        }
    }

    // ============ Budget Management ============

    /**
     * Get budget overview
     * GET /api/admin/budget/overview
     */
    static async getBudgetOverview(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getBudgetOverview', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const overview = await AdminBudgetManagementService.getBudgetOverview(startDate, endDate);

            ControllerHelper.logRequestSuccess('getBudgetOverview', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: overview
            });
        } catch (error: any) {
            ControllerHelper.handleError('getBudgetOverview', error, req, res, startTime);
        }
    }

    /**
     * Get budget alerts
     * GET /api/admin/budget/alerts
     */
    static async getBudgetAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getBudgetAlerts', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const alerts = await AdminBudgetManagementService.getBudgetAlerts(startDate, endDate);

            ControllerHelper.logRequestSuccess('getBudgetAlerts', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: alerts
            });
        } catch (error: any) {
            ControllerHelper.handleError('getBudgetAlerts', error, req, res, startTime);
        }
    }

    /**
     * Get project budget status
     * GET /api/admin/budget/projects
     */
    static async getProjectBudgetStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getProjectBudgetStatus', req);

            const projectId = req.query.projectId ? (req.query.projectId as string) : undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            if (projectId) {
                ServiceHelper.validateObjectId(projectId, 'projectId');
            }

            const status = await AdminBudgetManagementService.getProjectBudgetStatus(projectId, startDate, endDate);

            ControllerHelper.logRequestSuccess('getProjectBudgetStatus', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: status
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProjectBudgetStatus', error, req, res, startTime);
        }
    }

    /**
     * Get budget trends
     * GET /api/admin/budget/trends
     */
    static async getBudgetTrends(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getBudgetTrends', req);

            const projectId = req.query.projectId ? (req.query.projectId as string) : undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            if (projectId) {
                ServiceHelper.validateObjectId(projectId, 'projectId');
            }

            const trends = await AdminBudgetManagementService.getBudgetTrends(projectId, startDate, endDate);

            ControllerHelper.logRequestSuccess('getBudgetTrends', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: trends
            });
        } catch (error: any) {
            ControllerHelper.handleError('getBudgetTrends', error, req, res, startTime);
        }
    }

    // ============ Integration Analytics ============

    /**
     * Get integration statistics
     * GET /api/admin/analytics/integrations
     */
    static async getIntegrationStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getIntegrationStats', req);

            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const stats = await AdminIntegrationAnalyticsService.getIntegrationStats(startDate, endDate);

            ControllerHelper.logRequestSuccess('getIntegrationStats', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getIntegrationStats', error, req, res, startTime);
        }
    }

    /**
     * Get integration trends
     * GET /api/admin/analytics/integrations/trends
     */
    static async getIntegrationTrends(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getIntegrationTrends', req);

            const service = req.query.service as string | undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

            const trends = await AdminIntegrationAnalyticsService.getIntegrationTrends(service, startDate, endDate);

            ControllerHelper.logRequestSuccess('getIntegrationTrends', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: trends
            });
        } catch (error: any) {
            ControllerHelper.handleError('getIntegrationTrends', error, req, res, startTime);
        }
    }

    /**
     * Get integration health
     * GET /api/admin/analytics/integrations/health
     */
    static async getIntegrationHealth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getIntegrationHealth', req);

            const health = await AdminIntegrationAnalyticsService.getIntegrationHealth();

            ControllerHelper.logRequestSuccess('getIntegrationHealth', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: health
            });
        } catch (error: any) {
            ControllerHelper.handleError('getIntegrationHealth', error, req, res, startTime);
        }
    }

    /**
     * Get top integrations
     * GET /api/admin/analytics/integrations/top
     */
    static async getTopIntegrations(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTopIntegrations', req);

            const metric = (req.query.metric as 'requests' | 'cost' | 'errors') || 'requests';
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const topIntegrations = await AdminIntegrationAnalyticsService.getTopIntegrations(metric, limit);

            ControllerHelper.logRequestSuccess('getTopIntegrations', req, startTime, { adminUserId: userId });

            res.json({
                success: true,
                data: topIntegrations
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTopIntegrations', error, req, res, startTime);
        }
    }

    /**
     * Export report in specified format
     * POST /api/admin/reports/export
     */
    static async exportReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('exportReport', req);

            const { format, startDate, endDate, includeCharts, sections } = req.body;

            if (!format || !['csv', 'excel', 'json'].includes(format)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid format. Must be csv, excel, or json'
                });
                return;
            }

            const config = {
                format: format as 'csv' | 'excel' | 'json',
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                includeCharts: includeCharts || false,
                sections: sections || []
            };

            const reportData = await AdminReportingService.exportReport(config);

            ControllerHelper.logRequestSuccess('exportReport', req, startTime, { adminUserId: userId, format });

            // Set appropriate headers based on format
            if (format === 'json') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="admin-report-${new Date().toISOString().split('T')[0]}.json"`);
                res.send(reportData as string);
            } else if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="admin-report-${new Date().toISOString().split('T')[0]}.csv"`);
                res.send(reportData as string);
            } else if (format === 'excel') {
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="admin-report-${new Date().toISOString().split('T')[0]}.xlsx"`);
                res.send(reportData as Buffer);
            }
        } catch (error: any) {
            ControllerHelper.handleError('exportReport', error, req, res, startTime);
        }
    }

    /**
     * Get vectorization system health and statistics
     * GET /api/admin/dashboard/vectorization
     */
    static async getVectorizationDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getVectorizationDashboard', req);

            // Import services dynamically to avoid circular dependencies
            const { backgroundVectorizationService } = await import('../services/backgroundVectorization.service');
            const { smartSamplingService } = await import('../services/smartSampling.service');
            const { vectorMemoryService } = await import('../services/vectorMemory.service');

            // Get comprehensive vectorization statistics
            const [
                healthStats,
                timeEstimates,
                samplingStats,
                crossModelStats
            ] = await Promise.all([
                backgroundVectorizationService.getVectorizationHealth(),
                backgroundVectorizationService.estimateProcessingTime(),
                smartSamplingService.getSamplingStats(),
                vectorMemoryService.getCrossModelStats()
            ]);

            // Calculate additional metrics
            const totalVectorizedRecords = 
                healthStats.storageUsage.userMemories.vectorized +
                healthStats.storageUsage.conversations.vectorized +
                healthStats.storageUsage.messages.vectorized;

            const totalRecords = 
                healthStats.storageUsage.userMemories.total +
                healthStats.storageUsage.conversations.total +
                healthStats.storageUsage.messages.total;

            const overallVectorizationRate = totalRecords > 0 ? 
                Math.round((totalVectorizedRecords / totalRecords) * 100) : 0;

            // Prepare dashboard data matching frontend interface
            const dashboardData = {
                health: {
                    embeddingService: healthStats.embeddingService,
                    vectorIndexes: healthStats.vectorIndexes,
                    storageUsage: {
                        current: healthStats.storageUsage.current,
                        projected: healthStats.storageUsage.projected,
                        userMemories: healthStats.storageUsage.userMemories,
                        conversations: healthStats.storageUsage.conversations,
                        messages: healthStats.storageUsage.messages
                    },
                    lastProcessing: healthStats.lastProcessing,
                    currentlyProcessing: healthStats.currentlyProcessing
                },
                processingStats: {
                    userMemories: {
                        total: timeEstimates.userMemories.total,
                        estimated: timeEstimates.userMemories.estimated
                    },
                    conversations: {
                        total: timeEstimates.conversations.total,
                        estimated: timeEstimates.conversations.estimated
                    },
                    messages: {
                        total: timeEstimates.messages.total,
                        estimated: timeEstimates.messages.estimated
                    },
                    totalEstimated: timeEstimates.totalEstimated
                },
                crossModalStats: {
                    totalVectors: crossModelStats.totalVectors,
                    avgEmbeddingDimensions: crossModelStats.avgEmbeddingDimensions,
                    memoryEfficiency: crossModelStats.totalVectors > 1000 ? 'high' as const : 
                                    crossModelStats.totalVectors > 100 ? 'medium' as const : 'building' as const
                },
                alerts: [] as Array<{ level: string; message: string; action: string }>
            };

            // Generate system alerts
            if (healthStats.embeddingService === 'error') {
                dashboardData.alerts.push({
                    level: 'error',
                    message: 'Embedding service is down - vectorization halted',
                    action: 'Check AWS Bedrock connectivity and credentials'
                });
            }

            if (healthStats.vectorIndexes === 'error') {
                dashboardData.alerts.push({
                    level: 'error', 
                    message: 'Vector indexes are not optimal',
                    action: 'Check MongoDB Atlas vector search index configuration'
                });
            }

            if (overallVectorizationRate < 30) {
                dashboardData.alerts.push({
                    level: 'warning',
                    message: `Low vectorization coverage (${overallVectorizationRate}%)`,
                    action: 'Consider running manual vectorization or adjusting cron schedules'
                });
            }

            if (timeEstimates.totalEstimated > 3600) { // > 1 hour
                dashboardData.alerts.push({
                    level: 'info',
                    message: `Large backlog detected (${Math.round(timeEstimates.totalEstimated / 3600)} hours)`,
                    action: 'Monitor processing progress or consider increasing batch sizes'
                });
            }

            // Add sampling-related alerts based on selection rate
            if (samplingStats.selectionRate < 0.05) {
                dashboardData.alerts.push({
                    level: 'info',
                    message: `Smart sampling active at ${Math.round(samplingStats.selectionRate * 100)}% rate`,
                    action: 'System is intelligently sampling to optimize processing'
                });
            }

            // Log business event for dashboard usage
            loggingService.logBusiness({
                event: 'admin_vectorization_dashboard_accessed',
                category: 'admin_operations',
                value: Date.now() - startTime,
                metadata: {
                    adminUserId: userId,
                    overallVectorizationRate,
                    systemHealth: healthStats.embeddingService,
                    totalVectorizedRecords,
                    alertsGenerated: dashboardData.alerts.length,
                    samplingRate: samplingStats.selectionRate
                }
            });

            ControllerHelper.logRequestSuccess('getVectorizationDashboard', req, startTime, {
                adminUserId: userId,
                overallVectorizationRate,
                systemHealth: healthStats.embeddingService,
                alertsCount: dashboardData.alerts.length,
                samplingRate: samplingStats.selectionRate
            });

            res.json({
                success: true,
                data: dashboardData,
                timestamp: new Date().toISOString(),
                refreshedAt: new Date().toISOString()
            });
        } catch (error: any) {
            // Log business error event
            loggingService.logBusiness({
                event: 'admin_vectorization_dashboard_error',
                category: 'admin_operations_errors',
                value: 1,
                metadata: {
                    adminUserId: req.userId,
                    error: error instanceof Error ? error.message : String(error),
                    duration: Date.now() - startTime
                }
            });

            ControllerHelper.handleError('getVectorizationDashboard', error, req, res, startTime);
        }
    }
}

