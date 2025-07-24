import { Response, NextFunction } from 'express';
import { UsageService } from '../services/usage.service';
import { trackUsageSchema, paginationSchema, sdkTrackUsageSchema } from '../utils/validators';
import { logger } from '../utils/logger';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export function getUserIdFromToken(req: any): string | null {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/, '');
    if (!token) return null;
    try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        return decoded.id || decoded.userId || null;
    } catch (err) {
        return null;
    }
}

export class UsageController {
    static async trackUsage(req: any, res: Response, next: NextFunction): Promise<void> {
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
                    id: usage?._id,
                    cost: usage?.cost,
                    tokens: usage?.totalTokens,
                    optimizationApplied: usage?.optimizationApplied,
                },
            });
        } catch (error: any) {
            logger.error('Track usage error:', error);
            next(error);
        }
    }

    static async trackUsageFromSDK(req: any, res: Response): Promise<void> {
        try {
            console.log('trackUsageFromSDK raw body:', req.body);
            // Normalize payload
            let body = { ...req.body };
            let transformed = false;
            // Flatten 'usage' object if exists
            if (body.usage && typeof body.usage === 'object') {
                body = { ...body, ...body.usage };
                delete body.usage;
                transformed = true;
            }
            // Convert 'provider' to 'service' (model expects 'service')
            if (body.provider && !body.service) {
                body.service = body.provider;
                delete body.provider;
                transformed = true;
            }
            // Handle cost field
            if (body.estimatedCost && !body.cost) {
                body.cost = body.estimatedCost;
                delete body.estimatedCost;
                transformed = true;
            }
            if (transformed) {
                logger.warn('trackUsageFromSDK: Transformed payload', { original: req.body, transformed: body });
            }
            // Get userId from JWT token
            let userId = getUserIdFromToken(req);
            if (!userId) {
                userId = req.user?.id || req.user?._id || req.userId;
            }
            if (!userId) {
                logger.error('No user ID found in request or token');
                res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }
            console.log('Found userId:', userId);
            // Validate transformed data
            const validationResult = sdkTrackUsageSchema.safeParse(body);
            if (!validationResult.success) {
                logger.error('SDK usage validation failed:', validationResult.error.issues);
                res.status(400).json({
                    success: false,
                    error: 'Invalid usage data',
                    details: validationResult.error.issues
                });
            }
            const data: any = validationResult.data;
            // Extract projectId from multiple possible sources
            let projectId = (data as any).projectId || req.query.projectId;

            // If projectId is not found at top level, check in metadata (legacy support)
            if (!projectId && data.metadata && (data.metadata as any).projectId) {
                projectId = (data.metadata as any).projectId;
                console.log('Found projectId in metadata (legacy approach):', projectId);
            }

            // Ensure all required fields have values
            const usageData = {
                userId,
                service: (data as any).service || data.provider || 'openai',
                model: data.model,
                prompt: data.prompt || '',
                completion: data.completion || undefined,
                promptTokens: data.promptTokens,
                completionTokens: data.completionTokens,
                totalTokens: data.totalTokens || (data.promptTokens + data.completionTokens),
                cost: (data as any).cost || data.estimatedCost || calculateCost(
                    (data as any).service || data.provider || 'openai',
                    data.model,
                    data.promptTokens,
                    data.completionTokens
                ),
                responseTime: data.responseTime || 0,
                metadata: data.metadata || {},
                tags: data.tags || [],
                optimizationApplied: false,
                errorOccurred: false
            };

            // Only add projectId if it exists and is valid
            if (projectId && typeof projectId === 'string' && projectId.trim() !== '') {
                (usageData as any).projectId = projectId.trim();
            }
            console.log('Prepared usage data:', usageData);
            // Track usage
            const usage = await UsageService.trackUsage(usageData);
            if (!usage) {
                throw new Error('Usage creation returned null');
            }
            console.log('Usage tracked successfully:', usage._id);
            res.status(201).json({
                success: true,
                message: 'Usage tracked successfully from SDK',
                data: {
                    id: usage?._id,
                    cost: usage?.cost,
                    totalTokens: usage?.totalTokens
                }
            });
        } catch (error: any) {
            logger.error('Track usage from SDK error:', error);
            console.error('Full error:', error);
            // Always return a response
            res.status(500).json({
                success: false,
                error: 'Failed to track usage',
                message: error.message || 'Internal server error'
            });
        }
    }

    static async getUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            const filters = {
                userId,
                projectId: req.query.projectId as string,
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

    static async getUsageByProject(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { projectId } = req.params;
            const { page, limit, sort, order } = paginationSchema.parse(req.query);

            const filters = {
                userId,
                projectId,
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
            logger.error('Get usage by project error:', error);
            next(error);
        }
    }

    static async getUsageStats(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const period = (req.query.period as 'daily' | 'weekly' | 'monthly') || 'monthly';
            const projectId = req.query.projectId as string;

            const stats = await UsageService.getUsageStats(userId, period, projectId);

            res.json({
                success: true,
                data: stats,
            });
        } catch (error: any) {
            logger.error('Get usage stats error:', error);
            next(error);
        }
    }

    static async bulkUploadUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { usageData } = req.body;

            if (!Array.isArray(usageData)) {
                res.status(400).json({
                    success: false,
                    message: 'Usage data must be an array',
                });
                return;
            }

            const results = [];
            const errors = [];

            for (let i = 0; i < usageData.length; i++) {
                try {
                    const validatedData = trackUsageSchema.parse(usageData[i]);
                    const usage = await UsageService.trackUsage({
                        userId,
                        ...validatedData,
                    });
                    results.push({
                        index: i,
                        id: usage?._id,
                        success: true,
                    });
                } catch (error: any) {
                    errors.push({
                        index: i,
                        error: error.message,
                        data: usageData[i],
                    });
                }
            }

            res.json({
                success: true,
                message: `Processed ${usageData.length} usage records`,
                data: {
                    successful: results.length,
                    failed: errors.length,
                    results,
                    errors,
                },
            });
        } catch (error: any) {
            logger.error('Bulk upload usage error:', error);
            next(error);
        }
    }

    static async updateUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { usageId } = req.params;
            const updateData = req.body;

            // Validate that the usage belongs to the user
            const existingUsage = await UsageService.getUsageById(usageId, userId);
            if (!existingUsage) {
                res.status(404).json({
                    success: false,
                    message: 'Usage record not found',
                });
                return;
            }

            const updatedUsage = await UsageService.updateUsage(usageId, updateData);

            res.json({
                success: true,
                message: 'Usage updated successfully',
                data: updatedUsage,
            });
        } catch (error: any) {
            logger.error('Update usage error:', error);
            next(error);
        }
    }

    static async deleteUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { usageId } = req.params;

            // Validate that the usage belongs to the user
            const existingUsage = await UsageService.getUsageById(usageId, userId);
            if (!existingUsage) {
                res.status(404).json({
                    success: false,
                    message: 'Usage record not found',
                });
                return;
            }

            await UsageService.deleteUsage(usageId);

            res.json({
                success: true,
                message: 'Usage deleted successfully',
            });
        } catch (error: any) {
            logger.error('Delete usage error:', error);
            next(error);
        }
    }

    static async detectAnomalies(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const projectId = req.query.projectId as string;

            const anomalies = await UsageService.detectAnomalies(userId, projectId);

            res.json({
                success: true,
                data: anomalies,
            });
        } catch (error: any) {
            logger.error('Detect anomalies error:', error);
            next(error);
        }
    }

    static async searchUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { q, page, limit, projectId } = req.query;

            if (!q) {
                res.status(400).json({
                    success: false,
                    message: 'Search query is required',
                });
            }

            const paginationOptions = paginationSchema.parse({ page, limit });
            const result = await UsageService.searchUsage(
                userId,
                q as string,
                paginationOptions,
                projectId as string
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

    static async exportUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const format = (req.query.format as 'json' | 'csv') || 'json';

            const filters = {
                userId,
                projectId: req.query.projectId as string,
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

    static async getRealTimeUsageSummary(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { projectId } = req.query;

            const summary = await UsageService.getRealTimeUsageSummary(userId, projectId);

            res.json({
                success: true,
                data: summary
            });
        } catch (error: any) {
            logger.error('Get real-time usage summary error:', error);
            next(error);
        }
    }

    static async getRealTimeRequests(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { projectId, limit = 100 } = req.query;

            const requests = await UsageService.getRealTimeRequests(userId, projectId, parseInt(limit as string));

            res.json({
                success: true,
                data: requests
            });
        } catch (error: any) {
            logger.error('Get real-time requests error:', error);
            next(error);
        }
    }

    static async getUsageAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { 
                timeRange, 
                status, 
                model, 
                service, 
                projectId 
            } = req.query;

            const analytics = await UsageService.getUsageAnalytics(userId, {
                timeRange: timeRange as '1h' | '24h' | '7d' | '30d',
                status: status as 'all' | 'success' | 'error',
                model: model as string,
                service: service as string,
                projectId: projectId as string
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            logger.error('Get usage analytics error:', error);
            next(error);
        }
    }
}

// Add the cost calculation function for SDK usage
function calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
    // Only OpenAI and Anthropic for now, extend as needed
    const pricing: Record<string, Record<string, { prompt: number; completion: number }>> = {
        openai: {
            'gpt-4': { prompt: 0.03, completion: 0.06 },
            'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
            'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
            'gpt-3.5-turbo-16k': { prompt: 0.003, completion: 0.004 }
        },
        anthropic: {
            'claude-3-opus': { prompt: 0.015, completion: 0.075 },
            'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
            'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 }
        }
    };
    const modelPricing = pricing[provider]?.[model];
    if (!modelPricing) {
        logger.warn(`No pricing found for ${provider}/${model}`);
        return 0;
    }
    const promptCost = (promptTokens / 1000) * modelPricing.prompt;
    const completionCost = (completionTokens / 1000) * modelPricing.completion;
    return Number((promptCost + completionCost).toFixed(6));
}