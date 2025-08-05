import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { OptimizationService } from '../services/optimization.service';
import { optimizationRequestSchema, paginationSchema } from '../utils/validators';
import { logger } from '../utils/logger';
import { Optimization } from '../models';

export class OptimizationController {
    static async createOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const validatedData = optimizationRequestSchema.parse(req.body);

            const optimization = await OptimizationService.createOptimization({
                userId,
                ...validatedData,
                conversationHistory: req.body.conversationHistory,
                options: {
                    ...validatedData.options,
                    enableCompression: req.body.enableCompression !== false,
                    enableContextTrimming: req.body.enableContextTrimming !== false,
                    enableRequestFusion: req.body.enableRequestFusion !== false,
                }
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
                    metadata: optimization.metadata,
                },
            });
        } catch (error: any) {
            logger.error('Create optimization error:', error);
            next(error);
        }
    }

    static async getOptimizations(req: any, res: Response, next: NextFunction): Promise<void> {
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

    static async getOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            const result = await OptimizationService.getOptimizations(
                { userId },
                { page: 1, limit: 1 }
            );

            const optimization = result.data.find(o => o._id.toString() === id);

            if (!optimization) {
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            res.json({
                success: true,
                data: optimization,
            });
        } catch (error: any) {
            logger.error('Get optimization error:', error);
            next(error);
        }
    }

    static async applyOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
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
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            next(error);
        }
    }

    static async provideFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { id } = req.params;
            const { helpful, rating, comment } = req.body;

            if (helpful === undefined) {
                res.status(400).json({
                    success: false,
                    message: 'Feedback helpful status is required',
                });
                return;
            }

            if (rating !== undefined && (rating < 1 || rating > 5)) {
                res.status(400).json({
                    success: false,
                    message: 'Rating must be between 1 and 5',
                });
                return;
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
                res.status(404).json({
                    success: false,
                    message: 'Optimization not found',
                });
                return;
            }

            next(error);
        }
    }

    static async analyzeOpportunities(req: any, res: Response, next: NextFunction): Promise<void> {
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

    static async getPromptsForBulkOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
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

    static async bulkOptimize(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { promptIds } = req.body;

            if (!Array.isArray(promptIds) || promptIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Array of prompt IDs is required',
                });
                return;
            }

            if (promptIds.length > 10) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum 10 prompts can be optimized at once',
                });
                return;
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
    }

    static async getOptimizationSummary(req: any, res: Response, next: NextFunction): Promise<void> {
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

            // Calculate summary from database directly for accurate totals
            const [summaryStats] = await Optimization.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        totalSaved: { $sum: '$costSaved' },
                        totalTokensSaved: { $sum: '$tokensSaved' },
                        avgImprovement: { $avg: '$improvementPercentage' },
                        applied: {
                            $sum: { $cond: [{ $eq: ['$applied', true] }, 1, 0] }
                        }
                    }
                }
            ]);

            if (!summaryStats) {
                res.json({
                    success: true,
                    data: {
                        total: 0,
                        totalSaved: 0,
                        totalTokensSaved: 0,
                        avgImprovement: 0,
                        applied: 0,
                        applicationRate: 0,
                        byCategory: {},
                        topOptimizations: [],
                    },
                });
                return;
            }

            // Get category breakdown
            const categoryStats = await Optimization.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 },
                        avgSavings: { $avg: '$costSaved' }
                    }
                }
            ]);

            // Get top optimizations
            const topOptimizations = await Optimization.find({
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startDate, $lte: endDate }
            })
            .sort({ costSaved: -1 })
            .limit(5)
            .select('originalPrompt optimizedPrompt costSaved tokensSaved improvementPercentage category')
            .lean();

            const summary = {
                total: summaryStats.total,
                totalSaved: summaryStats.totalSaved,
                totalTokensSaved: summaryStats.totalTokensSaved,
                avgImprovement: summaryStats.avgImprovement || 0,
                applied: summaryStats.applied,
                applicationRate: summaryStats.total > 0
                    ? (summaryStats.applied / summaryStats.total) * 100
                    : 0,
                byCategory: categoryStats.reduce((acc: any, cat: any) => {
                    acc[cat._id] = {
                        count: cat.count,
                        avgSavings: cat.avgSavings
                    };
                    return acc;
                }, {}),
                topOptimizations,
            };

            res.json({
                success: true,
                data: summary,
            });
        } catch (error: any) {
            logger.error('Get optimization summary error:', error);
            next(error);
        }
    }

    static async createBatchOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { requests } = req.body;

            if (!Array.isArray(requests) || requests.length < 2) {
                res.status(400).json({
                    success: false,
                    message: 'At least 2 requests are required for batch optimization',
                });
                return;
            }

            if (requests.length > 10) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum 10 requests can be optimized in a batch',
                });
                return;
            }

            const optimizations = await OptimizationService.createBatchOptimization({
                userId,
                requests,
                enableFusion: req.body.enableFusion !== false,
            });

            res.status(201).json({
                success: true,
                message: `Successfully created ${optimizations.length} batch optimizations`,
                data: optimizations.map((opt: any) => ({
                    id: opt._id,
                    improvementPercentage: opt.improvementPercentage,
                    costSaved: opt.costSaved,
                    tokensSaved: opt.tokensSaved,
                    fusionStrategy: opt.metadata?.fusionStrategy,
                })),
            });
        } catch (error: any) {
            logger.error('Create batch optimization error:', error);
            next(error);
        }
    }

    static async optimizeConversation(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { messages, model, service } = req.body;

            if (!Array.isArray(messages) || messages.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Array of conversation messages is required',
                });
                return;
            }

            // Validate message format
            const isValidMessages = messages.every((msg: any) =>
                msg.role && ['user', 'assistant', 'system'].includes(msg.role) &&
                typeof msg.content === 'string'
            );

            if (!isValidMessages) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid message format. Each message must have role and content',
                });
                return;
            }

            const optimization = await OptimizationService.createOptimization({
                userId,
                prompt: messages.map((m: any) => `${m.role}: ${m.content}`).join('\n'),
                service,
                model,
                conversationHistory: messages,
                options: {
                    enableCompression: req.body.enableCompression !== false,
                    enableContextTrimming: req.body.enableContextTrimming !== false,
                }
            });

            res.status(201).json({
                success: true,
                message: 'Conversation optimization created successfully',
                data: {
                    id: optimization._id,
                    originalMessages: messages.length,
                    trimmedMessages: optimization.metadata?.contextTrimDetails?.trimmedMessages,
                    improvementPercentage: optimization.improvementPercentage,
                    costSaved: optimization.costSaved,
                    tokensSaved: optimization.tokensSaved,
                    optimizationType: optimization.metadata?.optimizationType,
                    trimmingTechnique: optimization.metadata?.contextTrimDetails?.technique,
                },
            });
        } catch (error: any) {
            logger.error('Optimize conversation error:', error);
            next(error);
        }
    }

    static async getOptimizationPreview(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { prompt, model, service, conversationHistory, enableCompression, enableContextTrimming, enableRequestFusion } = req.body;

            if (!prompt || !model || !service) {
                res.status(400).json({
                    success: false,
                    message: 'Prompt, model, and service are required',
                });
                return;
            }

            const optimization = await OptimizationService.createOptimization({
                userId,
                prompt,
                model,
                service,
                conversationHistory,
                options: {
                    enableCompression: enableCompression !== false,
                    enableContextTrimming: enableContextTrimming !== false,
                    enableRequestFusion: enableRequestFusion !== false,
                }
            });

            res.json({
                success: true,
                data: {
                    suggestions: optimization.suggestions,
                    totalSavings: optimization.costSaved,
                    techniques: optimization.optimizationTechniques,
                    originalTokens: optimization.originalTokens,
                    optimizedTokens: optimization.optimizedTokens,
                    improvementPercentage: optimization.improvementPercentage,
                },
            });
        } catch (error: any) {
            logger.error('Get optimization preview error:', error);
            next(error);
        }
    }

    static async getOptimizationConfig(res: Response, next: NextFunction): Promise<void> {
        try {

            // For now, return default configuration
            // In a real implementation, this would be stored per user in the database
            const defaultConfig = {
                enabledTechniques: [
                    'prompt_compression',
                    'context_trimming',
                    'request_fusion'
                ],
                defaultSettings: {
                    promptCompression: {
                        enabled: true,
                        minCompressionRatio: 0.2,
                        jsonCompressionThreshold: 1000
                    },
                    contextTrimming: {
                        enabled: true,
                        maxContextLength: 4000,
                        preserveRecentMessages: 3
                    },
                    requestFusion: {
                        enabled: true,
                        maxFusionBatch: 5,
                        fusionWaitTime: 1000
                    }
                },
                thresholds: {
                    highCostPerRequest: 0.01,
                    highTokenUsage: 2000,
                    frequencyThreshold: 5,
                    batchingThreshold: 3,
                    modelDowngradeConfidence: 0.8
                }
            };

            res.json({
                success: true,
                data: defaultConfig,
            });
        } catch (error: any) {
            logger.error('Get optimization config error:', error);
            next(error);
        }
    }

    static async updateOptimizationConfig(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const config = req.body;

            // For now, just acknowledge the update
            // In a real implementation, this would update the user's configuration in the database
            logger.info('Optimization config updated for user:', { userId, config });

            res.json({
                success: true,
                message: 'Optimization configuration updated successfully',
                data: config,
            });
        } catch (error: any) {
            logger.error('Update optimization config error:', error);
            next(error);
        }
    }

    static async getOptimizationTemplates(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { category } = req.query;

            // Get real optimization templates from database
            const templates = await OptimizationService.getOptimizationTemplates(category);

            res.json({
                success: true,
                data: templates,
            });
        } catch (error: any) {
            logger.error('Get optimization templates error:', error);
            next(error);
        }
    }

    static async getOptimizationHistory(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { promptHash } = req.params;
            const userId = req.user!.id;

            // Get real optimization history from database
            const history = await OptimizationService.getOptimizationHistory(promptHash, userId);

            res.json({
                success: true,
                data: history,
            });
        } catch (error: any) {
            logger.error('Get optimization history error:', error);
            next(error);
        }
    }

    static async revertOptimization(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const userId = req.user!.id;
            const { version } = req.body;

            // Revert optimization to previous version
            await OptimizationService.revertOptimization(id, userId, version);

            res.json({
                success: true,
                message: 'Optimization reverted successfully',
            });
        } catch (error: any) {
            logger.error('Revert optimization error:', error);
            next(error);
        }
    }


}