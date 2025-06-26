import { Response, NextFunction } from 'express';
import { UsageService } from '../services/usage.service';
import { trackUsageSchema, paginationSchema, sdkTrackUsageSchema } from '../utils/validators';
import { logger } from '../utils/logger';

export class UsageController {
    static async trackUsage(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const validatedData = trackUsageSchema.parse(req.body);

            const usage = await UsageService.trackUsage({
                userId,
                ...validatedData,
            });

            res.status(201).json({
                success: true,
                message: 'Usage tracked successfully',
                data: {
                    id: usage._id,
                    cost: usage.cost,
                    tokens: usage.totalTokens,
                    optimizationApplied: usage.optimizationApplied,
                },
            });
        } catch (error: any) {
            logger.error('Track usage error:', error);
            next(error);
        }
    }

    static async trackUsageFromSDK(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const validatedData = sdkTrackUsageSchema.parse(req.body);

            const usage = await UsageService.trackUsage({
                userId,
                ...validatedData,
                service: validatedData.provider,
                cost: validatedData.estimatedCost,
            });

            res.status(201).json({
                success: true,
                message: 'Usage tracked successfully from SDK',
                data: {
                    id: usage._id,
                },
            });
        } catch (error: any) {
            logger.error('Track usage from SDK error:', error);
            next(error);
        }
    }

    static async getUsage(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            const filters = {
                userId,
                service: req.query.service as string,
                model: req.query.model as string,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
                minCost: req.query.minCost ? parseFloat(req.query.minCost as string) : undefined,
                maxCost: req.query.maxCost ? parseFloat(req.query.maxCost as string) : undefined,
            };

            const result = await UsageService.getUsage(filters, {
                page,
                limit,
                sort,
                order,
            });

            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error: any) {
            logger.error('Get usage error:', error);
            next(error);
        }
    }

    static async getUsageStats(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'monthly';

            const stats = await UsageService.getUsageStats(userId, period);

            res.json({
                success: true,
                data: stats,
            });
        } catch (error: any) {
            logger.error('Get usage stats error:', error);
            next(error);
        }
    }

    static async detectAnomalies(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            const anomalies = await UsageService.detectAnomalies(userId);

            res.json({
                success: true,
                data: anomalies,
            });
        } catch (error: any) {
            logger.error('Detect anomalies error:', error);
            next(error);
        }
    }

    static async searchUsage(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { q, page, limit } = req.query;

            if (!q) {
                return res.status(400).json({
                    success: false,
                    message: 'Search query is required',
                });
            }

            const paginationOptions = paginationSchema.parse({ page, limit });
            const result = await UsageService.searchUsage(
                userId,
                q as string,
                paginationOptions
            );

            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error: any) {
            logger.error('Search usage error:', error);
            next(error);
        }
        return;
    }

    static async exportUsage(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const format = (req.query.format as 'json' | 'csv') || 'json';

            const filters = {
                userId,
                service: req.query.service as string,
                model: req.query.model as string,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };

            // Get all data without pagination for export
            const result = await UsageService.getUsage(filters, {
                page: 1,
                limit: 10000, // Max export limit
            });

            if (format === 'csv') {
                const csv = [
                    'Date,Service,Model,Prompt,Tokens,Cost,Response Time',
                    ...result.data.map(u =>
                        `"${u.createdAt}","${u.service}","${u.model}","${u.prompt.replace(/"/g, '""')}",${u.totalTokens},${u.cost},${u.responseTime}`
                    ),
                ].join('\n');

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=usage-export.csv');
                res.send(csv);
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename=usage-export.json');
                res.json(result.data);
            }
        } catch (error: any) {
            logger.error('Export usage error:', error);
            next(error);
        }
    }
}