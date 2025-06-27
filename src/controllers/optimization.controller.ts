import { Response, NextFunction } from 'express';
import { OptimizationService } from '../services/optimization.service';
import { optimizationRequestSchema, paginationSchema } from '../utils/validators';
import { logger } from '../utils/logger';

export class OptimizationController {
    static async createOptimization(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const validatedData = optimizationRequestSchema.parse(req.body);

            const optimization = await OptimizationService.createOptimization({
                userId,
                ...validatedData,
            });

            res.status(201).json({
                success: true,
                message: 'Optimization created successfully',
                data: {
                    id: optimization._id,
                    originalPrompt: optimization.originalPrompt,
                    optimizedPrompt: optimization.optimizedPrompt,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    suggestions: optimization.suggestions,
                },
            });
        } catch (error: any) {
            logger.error('Create optimization error:', error);
            next(error);
        }
    }

    static async getOptimizations(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            const filters = {
                userId,
                applied: req.query.applied !== undefined ? req.query.applied === 'true' : undefined,
                category: req.query.category as string,
                minSavings: req.query.minSavings ? parseFloat(req.query.minSavings as string) : undefined,
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
            };

            const result = await OptimizationService.getOptimizations(filters, {
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
            logger.error('Get optimizations error:', error);
            next(error);
        }
    }

    static async getOptimization(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            const result = await OptimizationService.getOptimizations(
                { userId },
                { page: 1, limit: 1 }
            );

            const optimization = result.data.find(o => o._id.toString() === id);

            if (!optimization) {
                return res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
            }

            res.json({
                success: true,
                data: optimization,
            });
        } catch (error: any) {
            logger.error('Get optimization error:', error);
            next(error);
        }
        return;
    }

    static async applyOptimization(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            await OptimizationService.applyOptimization(id, userId);

            res.json({
                success: true,
                message: 'Optimization applied successfully',
            });
        } catch (error: any) {
            logger.error('Apply optimization error:', error);

            if (error.message === 'Optimization not found') {
                return res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
            }

            next(error);
        }
        return;
    }

    static async provideFeedback(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { id } = req.params;
            const { helpful, rating, comment } = req.body;

            if (helpful === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'Feedback helpful status is required',
                });
            }

            if (rating !== undefined && (rating < 1 || rating > 5)) {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be between 1 and 5',
                });
            }

            await OptimizationService.provideFeedback(id, userId, {
                helpful,
                rating,
                comment,
            });

            res.json({
                success: true,
                message: 'Feedback submitted successfully',
            });
        } catch (error: any) {
            logger.error('Provide feedback error:', error);

            if (error.message === 'Optimization not found') {
                return res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
            }

            next(error);
        }
        return;
    }

    static async analyzeOpportunities(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            const opportunities = await OptimizationService.analyzeOptimizationOpportunities(userId);

            res.json({
                success: true,
                data: opportunities,
            });
        } catch (error: any) {
            logger.error('Analyze opportunities error:', error);
            next(error);
        }
    }

    static async getPromptsForBulkOptimization(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { service, minCalls, timeframe } = req.query;

            const prompts = await OptimizationService.getPromptsForBulkOptimization(userId, {
                service: service as string,
                minCalls: minCalls ? parseInt(minCalls as string) : undefined,
                timeframe: timeframe as string,
            });

            res.json({
                success: true,
                data: prompts,
            });
        } catch (error: any) {
            logger.error('Get prompts for bulk optimization error:', error);
            next(error);
        }
    }

    static async bulkOptimize(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { promptIds } = req.body;

            if (!Array.isArray(promptIds) || promptIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Array of prompt IDs is required',
                });
            }

            if (promptIds.length > 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Maximum 10 prompts can be optimized at once',
                });
            }

            const result = await OptimizationService.generateBulkOptimizations(userId, promptIds);

            res.json({
                success: true,
                message: `Successfully optimized ${result.successful} out of ${result.total} prompts`,
                data: result,
            });
        } catch (error: any) {
            logger.error('Bulk optimize error:', error);
            next(error);
        }
        return;
    }

    static async getOptimizationSummary(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const timeframe = (req.query.timeframe as string) || '30d';

            let startDate: Date;
            const endDate = new Date();

            switch (timeframe) {
                case '7d':
                    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case 'all':
                    startDate = new Date(0);
                    break;
                default:
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            }

            const result = await OptimizationService.getOptimizations(
                { userId, startDate, endDate },
                { page: 1, limit: 1000 }
            );

            if (!result) {
                return res.status(404).json({
                    success: false,
                    message: 'Optimization summary not found',
                });
            }

            const summary = {
                total: result.pagination.total,
                totalSaved: result.data.reduce((sum, o) => sum + o.costSaved, 0),
                totalTokensSaved: result.data.reduce((sum, o) => sum + o.tokensSaved, 0),
                avgImprovement: result.data.length > 0
                    ? result.data.reduce((sum, o) => sum + o.improvementPercentage, 0) / result.data.length
                    : 0,
                applied: result.data.filter(o => o.applied).length,
                applicationRate: result.data.length > 0
                    ? (result.data.filter(o => o.applied).length / result.data.length) * 100
                    : 0,
                byCategory: OptimizationController.groupByCategory(result.data),
                topOptimizations: result.data
                    .sort((a, b) => b.costSaved - a.costSaved)
                    .slice(0, 5),
            };

            res.json({
                success: true,
                data: summary,
            });
            return;
        } catch (error: any) {
            logger.error('Get optimization summary error:', error);
            next(error);
            return;
        }
    }

    private static groupByCategory(optimizations: any[]) {
        const categories: Record<string, any> = {};

        for (const opt of optimizations) {
            if (!categories[opt.category]) {
                categories[opt.category] = {
                    count: 0,
                    totalSaved: 0,
                    avgImprovement: 0,
                };
            }

            categories[opt.category].count++;
            categories[opt.category].totalSaved += opt.costSaved;
            categories[opt.category].avgImprovement += opt.improvementPercentage;
        }

        // Calculate averages
        for (const category in categories) {
            if (categories[category].count > 0) {
                categories[category].avgImprovement /= categories[category].count;
            }
        }

        return categories;
    }
}