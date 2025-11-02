import { Response, NextFunction } from 'express';
import { AdminUserAnalyticsService, AdminUserAnalyticsFilters } from '../services/adminUserAnalytics.service';
import { loggingService } from '../services/logging.service';

export class AdminUserAnalyticsController {
    /**
     * Get all users spending summary
     * GET /api/admin/users/spending
     */
    static async getAllUsersSpending(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }
            if (req.query.model) {
                filters.model = req.query.model;
            }
            if (req.query.projectId) {
                filters.projectId = req.query.projectId;
            }
            if (req.query.workflowId) {
                filters.workflowId = req.query.workflowId;
            }
            if (req.query.userId) {
                filters.userId = req.query.userId;
            }
            if (req.query.minCost) {
                filters.minCost = parseFloat(req.query.minCost);
            }
            if (req.query.maxCost) {
                filters.maxCost = parseFloat(req.query.maxCost);
            }

            const usersSpending = await AdminUserAnalyticsService.getAllUsersSpending(filters);

            // Apply cost filters if specified
            let filteredResults = usersSpending;
            if (filters.minCost !== undefined || filters.maxCost !== undefined) {
                filteredResults = usersSpending.filter(user => {
                    if (filters.minCost !== undefined && user.totalCost < filters.minCost) {
                        return false;
                    }
                    if (filters.maxCost !== undefined && user.totalCost > filters.maxCost) {
                        return false;
                    }
                    return true;
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('Admin users spending retrieved', {
                component: 'AdminUserAnalyticsController',
                operation: 'getAllUsersSpending',
                adminUserId: req.user?.id,
                userCount: filteredResults.length,
                duration
            });

            res.json({
                success: true,
                data: filteredResults,
                meta: {
                    total: filteredResults.length,
                    filters: Object.keys(filters).length > 0 ? filters : undefined
                }
            });
        } catch (error) {
            loggingService.error('Error getting all users spending:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsController',
                operation: 'getAllUsersSpending',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get detailed spending for a specific user
     * GET /api/admin/users/:userId/spending
     */
    static async getUserDetailedSpending(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { userId } = req.params;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }
            if (req.query.model) {
                filters.model = req.query.model;
            }
            if (req.query.projectId) {
                filters.projectId = req.query.projectId;
            }

            const userSpending = await AdminUserAnalyticsService.getUserDetailedSpending(userId, filters);

            if (!userSpending) {
                res.status(404).json({
                    success: false,
                    message: 'User spending data not found'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('User detailed spending retrieved', {
                component: 'AdminUserAnalyticsController',
                operation: 'getUserDetailedSpending',
                adminUserId: req.user?.id,
                userId,
                duration
            });

            res.json({
                success: true,
                data: userSpending
            });
        } catch (error) {
            loggingService.error('Error getting user detailed spending:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsController',
                operation: 'getUserDetailedSpending',
                adminUserId: req.user?.id,
                userId: req.params.userId
            });
            next(error);
        }
    }

    /**
     * Get users filtered by service
     * GET /api/admin/users/spending/by-service/:service
     */
    static async getUsersByService(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { service } = req.params;

            if (!service) {
                res.status(400).json({
                    success: false,
                    message: 'Service is required'
                });
                return;
            }

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }

            const usersSpending = await AdminUserAnalyticsService.getUsersByService(service, filters);

            const duration = Date.now() - startTime;

            loggingService.info('Users by service retrieved', {
                component: 'AdminUserAnalyticsController',
                operation: 'getUsersByService',
                adminUserId: req.user?.id,
                service,
                userCount: usersSpending.length,
                duration
            });

            res.json({
                success: true,
                data: usersSpending,
                meta: {
                    service,
                    total: usersSpending.length
                }
            });
        } catch (error) {
            loggingService.error('Error getting users by service:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsController',
                operation: 'getUsersByService',
                adminUserId: req.user?.id,
                service: req.params.service
            });
            next(error);
        }
    }

    /**
     * Get spending trends
     * GET /api/admin/users/spending/trends
     */
    static async getSpendingTrends(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const timeRange = (req.query.timeRange || 'daily') as 'daily' | 'weekly' | 'monthly';

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }
            if (req.query.model) {
                filters.model = req.query.model;
            }
            if (req.query.projectId) {
                filters.projectId = req.query.projectId;
            }
            if (req.query.userId) {
                filters.userId = req.query.userId;
            }

            const trends = await AdminUserAnalyticsService.getSpendingTrends(timeRange, filters);

            const duration = Date.now() - startTime;

            loggingService.info('Spending trends retrieved', {
                component: 'AdminUserAnalyticsController',
                operation: 'getSpendingTrends',
                adminUserId: req.user?.id,
                timeRange,
                dataPoints: trends.length,
                duration
            });

            res.json({
                success: true,
                data: trends,
                meta: {
                    timeRange,
                    total: trends.length
                }
            });
        } catch (error) {
            loggingService.error('Error getting spending trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsController',
                operation: 'getSpendingTrends',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Get platform summary statistics
     * GET /api/admin/users/spending/summary
     */
    static async getPlatformSummary(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }

            const summary = await AdminUserAnalyticsService.getPlatformSummary(filters);

            const duration = Date.now() - startTime;

            loggingService.info('Platform summary retrieved', {
                component: 'AdminUserAnalyticsController',
                operation: 'getPlatformSummary',
                adminUserId: req.user?.id,
                duration
            });

            res.json({
                success: true,
                data: summary
            });
        } catch (error) {
            loggingService.error('Error getting platform summary:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsController',
                operation: 'getPlatformSummary',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }

    /**
     * Export user spending data
     * GET /api/admin/users/spending/export
     */
    static async exportUserSpending(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const format = (req.query.format || 'json') as 'json' | 'csv';

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }
            if (req.query.model) {
                filters.model = req.query.model;
            }

            const usersSpending = await AdminUserAnalyticsService.getAllUsersSpending(filters);

            if (format === 'csv') {
                // Set CSV headers
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="user-spending-${Date.now()}.csv"`);

                // Write CSV header
                const header = 'User Email,User Name,Total Cost,Total Tokens,Total Requests,Avg Cost/Request,First Activity,Last Activity\n';
                res.write(header);

                // Write CSV rows
                for (const user of usersSpending) {
                    const row = [
                        user.userEmail,
                        user.userName,
                        user.totalCost.toFixed(4),
                        user.totalTokens,
                        user.totalRequests,
                        user.averageCostPerRequest.toFixed(4),
                        user.firstActivity.toISOString(),
                        user.lastActivity.toISOString()
                    ].map(field => `"${field}"`).join(',') + '\n';
                    res.write(row);
                }

                res.end();
            } else {
                // JSON export
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="user-spending-${Date.now()}.json"`);
                res.json({
                    success: true,
                    data: usersSpending,
                    meta: {
                        exportedAt: new Date().toISOString(),
                        total: usersSpending.length,
                        filters: Object.keys(filters).length > 0 ? filters : undefined
                    }
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('User spending data exported', {
                component: 'AdminUserAnalyticsController',
                operation: 'exportUserSpending',
                adminUserId: req.user?.id,
                format,
                recordCount: usersSpending.length,
                duration
            });
        } catch (error) {
            loggingService.error('Error exporting user spending:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsController',
                operation: 'exportUserSpending',
                adminUserId: req.user?.id
            });
            next(error);
        }
    }
}

