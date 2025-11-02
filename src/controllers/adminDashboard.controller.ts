import { Response, NextFunction } from 'express';
import { AdminUserGrowthService } from '../services/adminUserGrowth.service';
import { AdminAnomalyDetectionService } from '../services/adminAnomalyDetection.service';
import { AdminModelComparisonService } from '../services/adminModelComparison.service';
import { AdminFeatureAnalyticsService } from '../services/adminFeatureAnalytics.service';
import { AdminProjectAnalyticsService } from '../services/adminProjectAnalytics.service';
import { AdminUserManagementService } from '../services/adminUserManagement.service';
import { AdminActivityFeedService } from '../services/adminActivityFeed.service';
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
}

