import { Response, NextFunction } from 'express';
import { AdminUserAnalyticsService, AdminUserAnalyticsFilters } from '../services/adminUserAnalytics.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class AdminUserAnalyticsController {
    /**
     * Get all users spending summary
     * GET /api/admin/users/spending
     */
    static async getAllUsersSpending(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            ControllerHelper.logRequestStart('getAllUsersSpending', req);

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }
            if (req.query.service) {
                filters.service = req.query.service as string;
            }
            if (req.query.model) {
                filters.model = req.query.model as string;
            }
            if (req.query.projectId) {
                ServiceHelper.validateObjectId(req.query.projectId as string, 'projectId');
                filters.projectId = req.query.projectId as string;
            }
            if (req.query.workflowId) {
                ServiceHelper.validateObjectId(req.query.workflowId as string, 'workflowId');
                filters.workflowId = req.query.workflowId as string;
            }
            if (req.query.userId) {
                ServiceHelper.validateObjectId(req.query.userId as string, 'userId');
                filters.userId = req.query.userId as string;
            }
            if (req.query.minCost) {
                filters.minCost = parseFloat(req.query.minCost as string);
            }
            if (req.query.maxCost) {
                filters.maxCost = parseFloat(req.query.maxCost as string);
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

            ControllerHelper.logRequestSuccess('getAllUsersSpending', req, startTime, {
                userCount: filteredResults.length
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
            ControllerHelper.handleError('getAllUsersSpending', error, req, res, startTime);
        }
    }

    /**
     * Get detailed spending for a specific user
     * GET /api/admin/users/:userId/spending
     */
    static async getUserDetailedSpending(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('getUserDetailedSpending', req);

            const { userId } = req.params;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(userId, 'userId');

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }
            if (req.query.service) {
                filters.service = req.query.service as string;
            }
            if (req.query.model) {
                filters.model = req.query.model as string;
            }
            if (req.query.projectId) {
                ServiceHelper.validateObjectId(req.query.projectId as string, 'projectId');
                filters.projectId = req.query.projectId as string;
            }

            const userSpending = await AdminUserAnalyticsService.getUserDetailedSpending(userId, filters);

            if (!userSpending) {
                res.status(404).json({
                    success: false,
                    message: 'User spending data not found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getUserDetailedSpending', req, startTime, {
                userId
            });

            res.json({
                success: true,
                data: userSpending
            });
        } catch (error) {
            ControllerHelper.handleError('getUserDetailedSpending', error, req, res, startTime);
        }
    }

    /**
     * Get users filtered by service
     * GET /api/admin/users/spending/by-service/:service
     */
    static async getUsersByService(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('getUsersByService', req);

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
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }

            const usersSpending = await AdminUserAnalyticsService.getUsersByService(service, filters);

            ControllerHelper.logRequestSuccess('getUsersByService', req, startTime, {
                service,
                userCount: usersSpending.length
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
            ControllerHelper.handleError('getUsersByService', error, req, res, startTime);
        }
    }

    /**
     * Get spending trends
     * GET /api/admin/users/spending/trends
     */
    static async getSpendingTrends(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('getSpendingTrends', req);

            const timeRange = (req.query.timeRange || 'daily') as 'daily' | 'weekly' | 'monthly';

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }
            if (req.query.service) {
                filters.service = req.query.service as string;
            }
            if (req.query.model) {
                filters.model = req.query.model as string;
            }
            if (req.query.projectId) {
                ServiceHelper.validateObjectId(req.query.projectId as string, 'projectId');
                filters.projectId = req.query.projectId as string;
            }
            if (req.query.userId) {
                ServiceHelper.validateObjectId(req.query.userId as string, 'userId');
                filters.userId = req.query.userId as string;
            }

            const trends = await AdminUserAnalyticsService.getSpendingTrends(timeRange, filters);

            ControllerHelper.logRequestSuccess('getSpendingTrends', req, startTime, {
                timeRange,
                dataPoints: trends.length
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
            ControllerHelper.handleError('getSpendingTrends', error, req, res, startTime);
        }
    }

    /**
     * Get platform summary statistics
     * GET /api/admin/users/spending/summary
     */
    static async getPlatformSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('getPlatformSummary', req);

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }
            if (req.query.service) {
                filters.service = req.query.service as string;
            }

            const summary = await AdminUserAnalyticsService.getPlatformSummary(filters);

            ControllerHelper.logRequestSuccess('getPlatformSummary', req, startTime);

            res.json({
                success: true,
                data: summary
            });
        } catch (error) {
            ControllerHelper.handleError('getPlatformSummary', error, req, res, startTime);
        }
    }

    /**
     * Export user spending data
     * GET /api/admin/users/spending/export
     */
    static async exportUserSpending(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const adminUserId = req.userId!;
            ControllerHelper.logRequestStart('exportUserSpending', req);

            const format = (req.query.format || 'json') as 'json' | 'csv';

            const filters: AdminUserAnalyticsFilters = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }
            if (req.query.service) {
                filters.service = req.query.service as string;
            }
            if (req.query.model) {
                filters.model = req.query.model as string;
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

            ControllerHelper.logRequestSuccess('exportUserSpending', req, startTime, {
                format,
                recordCount: usersSpending.length
            });
        } catch (error) {
            ControllerHelper.handleError('exportUserSpending', error, req, res, startTime);
        }
    }
}

