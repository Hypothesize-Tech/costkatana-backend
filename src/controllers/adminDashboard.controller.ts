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
import { loggingService } from '../services/logging.service';

export class AdminDashboardController {
    /**
     * Get user growth trends
     * GET /api/admin/analytics/user-growth
     */
    static async getUserGrowthTrends(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'daily';
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const trends = await AdminUserGrowthService.getUserGrowthTrends(period, startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('User growth trends retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUserGrowthTrends',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: trends
            });
        } catch (error) {
            loggingService.error('Error getting user growth trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUserGrowthTrends',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get user engagement metrics
     * GET /api/admin/analytics/engagement
     */
    static async getUserEngagementMetrics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const metrics = await AdminUserGrowthService.getUserEngagementMetrics(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('User engagement metrics retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUserEngagementMetrics',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error) {
            loggingService.error('Error getting user engagement metrics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUserEngagementMetrics',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get user segments
     * GET /api/admin/analytics/user-segments
     */
    static async getUserSegments(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const segments = await AdminUserGrowthService.getUserSegments(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('User segments retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUserSegments',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: segments
            });
        } catch (error) {
            loggingService.error('Error getting user segments:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUserSegments',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get current alerts
     * GET /api/admin/alerts
     */
    static async getCurrentAlerts(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const alerts = await AdminAnomalyDetectionService.getCurrentAlerts();

            const duration = Date.now() - startTime;
            loggingService.info('Current alerts retrieved', {
                component: 'AdminDashboardController',
                operation: 'getCurrentAlerts',
                adminUserId: req.user?.id,
                alertCount: alerts.length,
                duration
            });

            res.json({
                success: true,
                data: alerts
            });
        } catch (error) {
            loggingService.error('Error getting current alerts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getCurrentAlerts',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Detect spending anomalies
     * GET /api/admin/anomalies/spending
     */
    static async detectSpendingAnomalies(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const timeWindow = (req.query.timeWindow as 'hour' | 'day' | 'week') || 'day';
            const threshold = req.query.threshold ? parseFloat(req.query.threshold) : 2.0;

            const anomalies = await AdminAnomalyDetectionService.detectSpendingAnomalies(timeWindow, threshold);

            const duration = Date.now() - startTime;
            loggingService.info('Spending anomalies detected', {
                component: 'AdminDashboardController',
                operation: 'detectSpendingAnomalies',
                adminUserId: req.user?.id,
                anomalyCount: anomalies.length,
                duration
            });

            res.json({
                success: true,
                data: anomalies
            });
        } catch (error) {
            loggingService.error('Error detecting spending anomalies:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'detectSpendingAnomalies',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Detect error anomalies
     * GET /api/admin/anomalies/errors
     */
    static async detectErrorAnomalies(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const timeWindow = (req.query.timeWindow as 'hour' | 'day' | 'week') || 'day';
            const threshold = req.query.threshold ? parseFloat(req.query.threshold) : 0.1;

            const anomalies = await AdminAnomalyDetectionService.detectErrorAnomalies(timeWindow, threshold);

            const duration = Date.now() - startTime;
            loggingService.info('Error anomalies detected', {
                component: 'AdminDashboardController',
                operation: 'detectErrorAnomalies',
                adminUserId: req.user?.id,
                anomalyCount: anomalies.length,
                duration
            });

            res.json({
                success: true,
                data: anomalies
            });
        } catch (error) {
            loggingService.error('Error detecting error anomalies:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'detectErrorAnomalies',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get model comparison
     * GET /api/admin/analytics/model-comparison
     */
    static async getModelComparison(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
                service: req.query.service,
                userId: req.query.userId
            };

            const comparison = await AdminModelComparisonService.getModelComparison(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Model comparison retrieved', {
                component: 'AdminDashboardController',
                operation: 'getModelComparison',
                adminUserId: req.user?.id,
                modelCount: comparison.length,
                duration
            });

            res.json({
                success: true,
                data: comparison
            });
        } catch (error) {
            loggingService.error('Error getting model comparison:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getModelComparison',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get service comparison
     * GET /api/admin/analytics/service-comparison
     */
    static async getServiceComparison(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
                service: req.query.service,
                userId: req.query.userId
            };

            const comparison = await AdminModelComparisonService.getServiceComparison(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Service comparison retrieved', {
                component: 'AdminDashboardController',
                operation: 'getServiceComparison',
                adminUserId: req.user?.id,
                serviceCount: comparison.length,
                duration
            });

            res.json({
                success: true,
                data: comparison
            });
        } catch (error) {
            loggingService.error('Error getting service comparison:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getServiceComparison',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get feature usage stats
     * GET /api/admin/analytics/feature-usage
     */
    static async getFeatureUsageStats(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
                userId: req.query.userId
            };

            const stats = await AdminFeatureAnalyticsService.getFeatureUsageStats(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Feature usage stats retrieved', {
                component: 'AdminDashboardController',
                operation: 'getFeatureUsageStats',
                adminUserId: req.user?.id,
                featureCount: stats.length,
                duration
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            loggingService.error('Error getting feature usage stats:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getFeatureUsageStats',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get feature adoption rates
     * GET /api/admin/analytics/feature-adoption
     */
    static async getFeatureAdoptionRates(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined
            };

            const adoption = await AdminFeatureAnalyticsService.getFeatureAdoptionRates(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Feature adoption rates retrieved', {
                component: 'AdminDashboardController',
                operation: 'getFeatureAdoptionRates',
                adminUserId: req.user?.id,
                featureCount: adoption.length,
                duration
            });

            res.json({
                success: true,
                data: adoption
            });
        } catch (error) {
            loggingService.error('Error getting feature adoption rates:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getFeatureAdoptionRates',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get feature cost analysis
     * GET /api/admin/analytics/feature-cost
     */
    static async getFeatureCostAnalysis(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined
            };

            const analysis = await AdminFeatureAnalyticsService.getFeatureCostAnalysis(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Feature cost analysis retrieved', {
                component: 'AdminDashboardController',
                operation: 'getFeatureCostAnalysis',
                adminUserId: req.user?.id,
                featureCount: analysis.length,
                duration
            });

            res.json({
                success: true,
                data: analysis
            });
        } catch (error) {
            loggingService.error('Error getting feature cost analysis:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getFeatureCostAnalysis',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get project analytics
     * GET /api/admin/analytics/projects
     */
    static async getProjectAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
                workspaceId: req.query.workspaceId,
                isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined
            };

            const analytics = await AdminProjectAnalyticsService.getProjectAnalytics(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Project analytics retrieved', {
                component: 'AdminDashboardController',
                operation: 'getProjectAnalytics',
                adminUserId: req.user?.id,
                projectCount: analytics.length,
                duration
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error) {
            loggingService.error('Error getting project analytics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getProjectAnalytics',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get workspace analytics
     * GET /api/admin/analytics/workspaces
     */
    static async getWorkspaceAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters = {
                startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate) : undefined
            };

            const analytics = await AdminProjectAnalyticsService.getWorkspaceAnalytics(filters);

            const duration = Date.now() - startTime;
            loggingService.info('Workspace analytics retrieved', {
                component: 'AdminDashboardController',
                operation: 'getWorkspaceAnalytics',
                adminUserId: req.user?.id,
                workspaceCount: analytics.length,
                duration
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error) {
            loggingService.error('Error getting workspace analytics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getWorkspaceAnalytics',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get project trends
     * GET /api/admin/analytics/projects/:projectId/trends
     */
    static async getProjectTrends(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { projectId } = req.params;
            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'daily';
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            if (!projectId) {
                res.status(400).json({
                    success: false,
                    error: 'Project ID is required'
                });
                return;
            }

            const trends = await AdminProjectAnalyticsService.getProjectTrends(
                projectId,
                period,
                startDate,
                endDate
            );

            const duration = Date.now() - startTime;
            loggingService.info('Project trends retrieved', {
                component: 'AdminDashboardController',
                operation: 'getProjectTrends',
                adminUserId: req.user?.id,
                projectId,
                duration
            });

            res.json({
                success: true,
                data: trends
            });
        } catch (error) {
            loggingService.error('Error getting project trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getProjectTrends',
                adminUserId: req.user?.id,
                projectId: req.params.projectId
            });
            next(error);
        }
    }

    /**
     * Get all users (admin management)
     * GET /api/admin/users
     */
    static async getAllUsers(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
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

            const duration = Date.now() - startTime;
            loggingService.info('All users retrieved', {
                component: 'AdminDashboardController',
                operation: 'getAllUsers',
                adminUserId: req.user?.id,
                count: users.length,
                duration
            });

            res.json({
                success: true,
                data: users
            });
        } catch (error) {
            loggingService.error('Error getting all users:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getAllUsers',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get user detail
     * GET /api/admin/users/:userId
     */
    static async getUserDetail(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { userId } = req.params;
            const user = await AdminUserManagementService.getUserDetail(userId);

            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            const duration = Date.now() - startTime;
            loggingService.info('User detail retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUserDetail',
                adminUserId: req.user?.id,
                userId,
                duration
            });

            res.json({
                success: true,
                data: user
            });
        } catch (error) {
            loggingService.error('Error getting user detail:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUserDetail',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Update user status
     * PATCH /api/admin/users/:userId/status
     */
    static async updateUserStatus(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { userId } = req.params;
            const { isActive } = req.body;

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

            const duration = Date.now() - startTime;
            loggingService.info('User status updated', {
                component: 'AdminDashboardController',
                operation: 'updateUserStatus',
                adminUserId: req.user?.id,
                userId,
                isActive,
                duration
            });

            res.json({
                success: true,
                message: `User ${isActive ? 'activated' : 'suspended'} successfully`
            });
        } catch (error) {
            loggingService.error('Error updating user status:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'updateUserStatus',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Update user role
     * PATCH /api/admin/users/:userId/role
     */
    static async updateUserRole(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { userId } = req.params;
            const { role } = req.body;

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

            const duration = Date.now() - startTime;
            loggingService.info('User role updated', {
                component: 'AdminDashboardController',
                operation: 'updateUserRole',
                adminUserId: req.user?.id,
                userId,
                role,
                duration
            });

            res.json({
                success: true,
                message: 'User role updated successfully'
            });
        } catch (error) {
            loggingService.error('Error updating user role:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'updateUserRole',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Delete user (soft delete)
     * DELETE /api/admin/users/:userId
     */
    static async deleteUser(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { userId } = req.params;

            // Prevent deleting yourself
            if (userId === req.user?.id) {
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

            const duration = Date.now() - startTime;
            loggingService.info('User deleted', {
                component: 'AdminDashboardController',
                operation: 'deleteUser',
                adminUserId: req.user?.id,
                userId,
                duration
            });

            res.json({
                success: true,
                message: 'User deleted successfully'
            });
        } catch (error) {
            loggingService.error('Error deleting user:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'deleteUser',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get user statistics
     * GET /api/admin/users/stats
     */
    static async getUserStats(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const stats = await AdminUserManagementService.getUserStats();

            const duration = Date.now() - startTime;
            loggingService.info('User stats retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUserStats',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            loggingService.error('Error getting user stats:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUserStats',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get recent activity events
     * GET /api/admin/analytics/activity/recent
     */
    static async getRecentActivity(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
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

            const duration = Date.now() - startTime;
            loggingService.info('Recent activity retrieved', {
                component: 'AdminDashboardController',
                operation: 'getRecentActivity',
                adminUserId: req.user?.id,
                count: events.length,
                duration
            });

            res.json({
                success: true,
                data: events
            });
        } catch (error) {
            loggingService.error('Error getting recent activity:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getRecentActivity',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Initialize SSE connection for admin activity feed
     * GET /api/admin/dashboard/activity/feed
     */
    static async initializeActivityFeed(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const adminId = req.user?.id;
            if (!adminId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const filters: any = {
                severity: req.query.severity ? (req.query.severity as string).split(',') : undefined,
                types: req.query.types ? (req.query.types as string).split(',') : undefined,
                userId: req.query.userId,
                projectId: req.query.projectId,
            };

            // Remove undefined values
            Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

            AdminActivityFeedService.initializeAdminFeed(adminId, res, filters);

            loggingService.info('Activity feed SSE connection initialized', {
                component: 'AdminDashboardController',
                operation: 'initializeActivityFeed',
                adminUserId: adminId
            });
        } catch (error) {
            loggingService.error('Error initializing activity feed:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'initializeActivityFeed',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    // ============ Revenue & Billing Analytics ============

    /**
     * Get revenue metrics
     * GET /api/admin/analytics/revenue
     */
    static async getRevenueMetrics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const metrics = await AdminRevenueAnalyticsService.getRevenueMetrics(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Revenue metrics retrieved', {
                component: 'AdminDashboardController',
                operation: 'getRevenueMetrics',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error) {
            loggingService.error('Error getting revenue metrics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getRevenueMetrics',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get subscription metrics
     * GET /api/admin/analytics/subscriptions
     */
    static async getSubscriptionMetrics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const metrics = await AdminRevenueAnalyticsService.getSubscriptionMetrics(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Subscription metrics retrieved', {
                component: 'AdminDashboardController',
                operation: 'getSubscriptionMetrics',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error) {
            loggingService.error('Error getting subscription metrics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getSubscriptionMetrics',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get conversion metrics
     * GET /api/admin/analytics/conversions
     */
    static async getConversionMetrics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const metrics = await AdminRevenueAnalyticsService.getConversionMetrics(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Conversion metrics retrieved', {
                component: 'AdminDashboardController',
                operation: 'getConversionMetrics',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: metrics
            });
        } catch (error) {
            loggingService.error('Error getting conversion metrics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getConversionMetrics',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get upcoming renewals
     * GET /api/admin/analytics/renewals
     */
    static async getUpcomingRenewals(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

            const renewals = await AdminRevenueAnalyticsService.getUpcomingRenewals(days);

            const duration = Date.now() - startTime;
            loggingService.info('Upcoming renewals retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUpcomingRenewals',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: renewals
            });
        } catch (error) {
            loggingService.error('Error getting upcoming renewals:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUpcomingRenewals',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    // ============ API Key Management ============

    /**
     * Get API key statistics
     * GET /api/admin/api-keys/stats
     */
    static async getApiKeyStats(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const stats = await AdminApiKeyManagementService.getApiKeyStats();

            const duration = Date.now() - startTime;
            loggingService.info('API key stats retrieved', {
                component: 'AdminDashboardController',
                operation: 'getApiKeyStats',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            loggingService.error('Error getting API key stats:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getApiKeyStats',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get API key usage
     * GET /api/admin/api-keys/usage
     */
    static async getApiKeyUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const usage = await AdminApiKeyManagementService.getApiKeyUsage(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('API key usage retrieved', {
                component: 'AdminDashboardController',
                operation: 'getApiKeyUsage',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: usage
            });
        } catch (error) {
            loggingService.error('Error getting API key usage:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getApiKeyUsage',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get top API keys
     * GET /api/admin/api-keys/top
     */
    static async getTopApiKeys(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const topKeys = await AdminApiKeyManagementService.getTopApiKeys(limit);

            const duration = Date.now() - startTime;
            loggingService.info('Top API keys retrieved', {
                component: 'AdminDashboardController',
                operation: 'getTopApiKeys',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: topKeys
            });
        } catch (error) {
            loggingService.error('Error getting top API keys:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getTopApiKeys',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get expiring API keys
     * GET /api/admin/api-keys/expiring
     */
    static async getExpiringApiKeys(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

            const expiringKeys = await AdminApiKeyManagementService.getExpiringApiKeys(days);

            const duration = Date.now() - startTime;
            loggingService.info('Expiring API keys retrieved', {
                component: 'AdminDashboardController',
                operation: 'getExpiringApiKeys',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: expiringKeys
            });
        } catch (error) {
            loggingService.error('Error getting expiring API keys:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getExpiringApiKeys',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get API keys over budget
     * GET /api/admin/api-keys/over-budget
     */
    static async getApiKeysOverBudget(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const overBudgetKeys = await AdminApiKeyManagementService.getApiKeysOverBudget();

            const duration = Date.now() - startTime;
            loggingService.info('API keys over budget retrieved', {
                component: 'AdminDashboardController',
                operation: 'getApiKeysOverBudget',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: overBudgetKeys
            });
        } catch (error) {
            loggingService.error('Error getting API keys over budget:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getApiKeysOverBudget',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    // ============ Endpoint Performance ============

    /**
     * Get endpoint performance
     * GET /api/admin/analytics/endpoints/performance
     */
    static async getEndpointPerformance(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const performance = await AdminEndpointPerformanceService.getEndpointPerformance(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Endpoint performance retrieved', {
                component: 'AdminDashboardController',
                operation: 'getEndpointPerformance',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: performance
            });
        } catch (error) {
            loggingService.error('Error getting endpoint performance:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getEndpointPerformance',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get endpoint trends
     * GET /api/admin/analytics/endpoints/trends
     */
    static async getEndpointTrends(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const endpoint = req.query.endpoint as string | undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const trends = await AdminEndpointPerformanceService.getEndpointTrends(endpoint, startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Endpoint trends retrieved', {
                component: 'AdminDashboardController',
                operation: 'getEndpointTrends',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: trends
            });
        } catch (error) {
            loggingService.error('Error getting endpoint trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getEndpointTrends',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get top endpoints
     * GET /api/admin/analytics/endpoints/top
     */
    static async getTopEndpoints(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const metric = (req.query.metric as 'requests' | 'cost' | 'responseTime' | 'errors') || 'requests';
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const topEndpoints = await AdminEndpointPerformanceService.getTopEndpoints(metric, limit);

            const duration = Date.now() - startTime;
            loggingService.info('Top endpoints retrieved', {
                component: 'AdminDashboardController',
                operation: 'getTopEndpoints',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: topEndpoints
            });
        } catch (error) {
            loggingService.error('Error getting top endpoints:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getTopEndpoints',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    // ============ Geographic & Usage Patterns ============

    /**
     * Get geographic usage
     * GET /api/admin/analytics/geographic/usage
     */
    static async getGeographicUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const usage = await AdminGeographicPatternsService.getGeographicUsage(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Geographic usage retrieved', {
                component: 'AdminDashboardController',
                operation: 'getGeographicUsage',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: usage
            });
        } catch (error) {
            loggingService.error('Error getting geographic usage:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getGeographicUsage',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get peak usage times
     * GET /api/admin/analytics/geographic/peak-times
     */
    static async getPeakUsageTimes(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const peakTimes = await AdminGeographicPatternsService.getPeakUsageTimes(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Peak usage times retrieved', {
                component: 'AdminDashboardController',
                operation: 'getPeakUsageTimes',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: peakTimes
            });
        } catch (error) {
            loggingService.error('Error getting peak usage times:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getPeakUsageTimes',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get usage patterns
     * GET /api/admin/analytics/geographic/patterns
     */
    static async getUsagePatterns(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const patterns = await AdminGeographicPatternsService.getUsagePatterns(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Usage patterns retrieved', {
                component: 'AdminDashboardController',
                operation: 'getUsagePatterns',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: patterns
            });
        } catch (error) {
            loggingService.error('Error getting usage patterns:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getUsagePatterns',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get most active regions
     * GET /api/admin/analytics/geographic/regions
     */
    static async getMostActiveRegions(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const regions = await AdminGeographicPatternsService.getMostActiveRegions(limit);

            const duration = Date.now() - startTime;
            loggingService.info('Most active regions retrieved', {
                component: 'AdminDashboardController',
                operation: 'getMostActiveRegions',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: regions
            });
        } catch (error) {
            loggingService.error('Error getting most active regions:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getMostActiveRegions',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get geographic cost distribution
     * GET /api/admin/analytics/geographic/cost-distribution
     */
    static async getGeographicCostDistribution(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const distribution = await AdminGeographicPatternsService.getGeographicCostDistribution(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Geographic cost distribution retrieved', {
                component: 'AdminDashboardController',
                operation: 'getGeographicCostDistribution',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: distribution
            });
        } catch (error) {
            loggingService.error('Error getting geographic cost distribution:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getGeographicCostDistribution',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    // ============ Budget Management ============

    /**
     * Get budget overview
     * GET /api/admin/budget/overview
     */
    static async getBudgetOverview(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const overview = await AdminBudgetManagementService.getBudgetOverview(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Budget overview retrieved', {
                component: 'AdminDashboardController',
                operation: 'getBudgetOverview',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: overview
            });
        } catch (error) {
            loggingService.error('Error getting budget overview:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getBudgetOverview',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get budget alerts
     * GET /api/admin/budget/alerts
     */
    static async getBudgetAlerts(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const alerts = await AdminBudgetManagementService.getBudgetAlerts(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Budget alerts retrieved', {
                component: 'AdminDashboardController',
                operation: 'getBudgetAlerts',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: alerts
            });
        } catch (error) {
            loggingService.error('Error getting budget alerts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getBudgetAlerts',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get project budget status
     * GET /api/admin/budget/projects
     */
    static async getProjectBudgetStatus(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const projectId = req.query.projectId as string | undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const status = await AdminBudgetManagementService.getProjectBudgetStatus(projectId, startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Project budget status retrieved', {
                component: 'AdminDashboardController',
                operation: 'getProjectBudgetStatus',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            loggingService.error('Error getting project budget status:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getProjectBudgetStatus',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get budget trends
     * GET /api/admin/budget/trends
     */
    static async getBudgetTrends(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const projectId = req.query.projectId as string | undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const trends = await AdminBudgetManagementService.getBudgetTrends(projectId, startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Budget trends retrieved', {
                component: 'AdminDashboardController',
                operation: 'getBudgetTrends',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: trends
            });
        } catch (error) {
            loggingService.error('Error getting budget trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getBudgetTrends',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    // ============ Integration Analytics ============

    /**
     * Get integration statistics
     * GET /api/admin/analytics/integrations
     */
    static async getIntegrationStats(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const stats = await AdminIntegrationAnalyticsService.getIntegrationStats(startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Integration stats retrieved', {
                component: 'AdminDashboardController',
                operation: 'getIntegrationStats',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            loggingService.error('Error getting integration stats:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getIntegrationStats',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get integration trends
     * GET /api/admin/analytics/integrations/trends
     */
    static async getIntegrationTrends(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const service = req.query.service as string | undefined;
            const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;

            const trends = await AdminIntegrationAnalyticsService.getIntegrationTrends(service, startDate, endDate);

            const duration = Date.now() - startTime;
            loggingService.info('Integration trends retrieved', {
                component: 'AdminDashboardController',
                operation: 'getIntegrationTrends',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: trends
            });
        } catch (error) {
            loggingService.error('Error getting integration trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getIntegrationTrends',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get integration health
     * GET /api/admin/analytics/integrations/health
     */
    static async getIntegrationHealth(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const health = await AdminIntegrationAnalyticsService.getIntegrationHealth();

            const duration = Date.now() - startTime;
            loggingService.info('Integration health retrieved', {
                component: 'AdminDashboardController',
                operation: 'getIntegrationHealth',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: health
            });
        } catch (error) {
            loggingService.error('Error getting integration health:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getIntegrationHealth',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get top integrations
     * GET /api/admin/analytics/integrations/top
     */
    static async getTopIntegrations(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const metric = (req.query.metric as 'requests' | 'cost' | 'errors') || 'requests';
            const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

            const topIntegrations = await AdminIntegrationAnalyticsService.getTopIntegrations(metric, limit);

            const duration = Date.now() - startTime;
            loggingService.info('Top integrations retrieved', {
                component: 'AdminDashboardController',
                operation: 'getTopIntegrations',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: topIntegrations
            });
        } catch (error) {
            loggingService.error('Error getting top integrations:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getTopIntegrations',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Export report in specified format
     * POST /api/admin/reports/export
     */
    static async exportReport(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
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

            const duration = Date.now() - startTime;
            loggingService.info('Report exported successfully', {
                component: 'AdminDashboardController',
                operation: 'exportReport',
                adminUserId: req.user?.id,
                format,
                duration
            });

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
        } catch (error) {
            loggingService.error('Error exporting report:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'exportReport',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get vectorization system health and statistics
     * GET /api/admin/dashboard/vectorization
     */
    static async getVectorizationDashboard(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            loggingService.info('Getting vectorization dashboard data', {
                component: 'AdminDashboardController',
                operation: 'getVectorizationDashboard',
                adminUserId: req.user?.id
            });

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

            const duration = Date.now() - startTime;
            
            loggingService.info('Vectorization dashboard data retrieved successfully', {
                component: 'AdminDashboardController',
                operation: 'getVectorizationDashboard',
                adminUserId: req.user?.id,
                duration,
                overallVectorizationRate,
                systemHealth: healthStats.embeddingService,
                alertsCount: dashboardData.alerts.length,
                samplingRate: samplingStats.selectionRate
            });

            // Log business event for dashboard usage
            loggingService.logBusiness({
                event: 'admin_vectorization_dashboard_accessed',
                category: 'admin_operations',
                value: duration,
                metadata: {
                    adminUserId: req.user?.id,
                    overallVectorizationRate,
                    systemHealth: healthStats.embeddingService,
                    totalVectorizedRecords,
                    alertsGenerated: dashboardData.alerts.length,
                    samplingRate: samplingStats.selectionRate
                }
            });

            res.json({
                success: true,
                data: dashboardData,
                timestamp: new Date().toISOString(),
                refreshedAt: new Date().toISOString()
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Error getting vectorization dashboard:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDashboardController',
                operation: 'getVectorizationDashboard',
                adminUserId: req.user?.id,
                duration
            });

            // Log business error event
            loggingService.logBusiness({
                event: 'admin_vectorization_dashboard_error',
                category: 'admin_operations_errors',
                value: 1,
                metadata: {
                    adminUserId: req.user?.id,
                    error: error instanceof Error ? error.message : String(error),
                    duration
                }
            });

            next(error);
        }
    }
}

