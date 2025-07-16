import { Response } from 'express';
import { TaggingService } from '../services/tagging.service';
import { logger } from '../utils/logger';

export class TaggingController {

    /**
     * Get comprehensive tag analytics
     * GET /api/tags/analytics
     */
    static async getTagAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                startDate,
                endDate,
                tagFilter,
                includeHierarchy = true,
                includeRealTime = true
            } = req.query;

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                tagFilter: tagFilter ? (tagFilter as string).split(',') : undefined,
                includeHierarchy: includeHierarchy === 'true',
                includeRealTime: includeRealTime === 'true'
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);

            res.json({
                success: true,
                data: analytics,
                metadata: {
                    totalTags: analytics.length,
                    totalCost: analytics.reduce((sum, tag) => sum + tag.totalCost, 0),
                    totalCalls: analytics.reduce((sum, tag) => sum + tag.totalCalls, 0),
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting tag analytics:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get real-time tag metrics
     * GET /api/tags/realtime
     */
    static async getRealTimeMetrics(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tags } = req.query;
            const tagFilter = tags ? (tags as string).split(',') : undefined;

            const metrics = await TaggingService.getRealTimeTagMetrics(userId, tagFilter);

            res.json({
                success: true,
                data: metrics,
                metadata: {
                    totalTags: metrics.length,
                    totalCurrentCost: metrics.reduce((sum, tag) => sum + tag.currentCost, 0),
                    totalProjectedDailyCost: metrics.reduce((sum, tag) => sum + tag.projectedDailyCost, 0),
                    lastUpdate: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting real-time tag metrics:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Create tag hierarchy
     * POST /api/tags/hierarchy
     */
    static async createTagHierarchy(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { name, parent, color, description } = req.body;

            if (!name) {
                res.status(400).json({ message: 'Tag name is required' });
            }

            const hierarchy = await TaggingService.createTagHierarchy(userId, {
                name,
                parent,
                color,
                description
            });

            res.status(201).json({
                success: true,
                data: hierarchy,
                message: 'Tag hierarchy created successfully'
            });
        } catch (error) {
            logger.error('Error creating tag hierarchy:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag suggestions
     * GET /api/tags/suggestions
     */
    static async getTagSuggestions(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { service, model, prompt, projectId } = req.query;

            const suggestions = await TaggingService.getTagSuggestions(userId, {
                service: service as string,
                model: model as string,
                prompt: prompt as string,
                projectId: projectId as string
            });

            res.json({
                success: true,
                data: suggestions,
                metadata: {
                    totalSuggestions: suggestions.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting tag suggestions:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Create cost allocation rule
     * POST /api/tags/allocation-rules
     */
    static async createCostAllocationRule(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                name,
                tagFilters,
                allocationPercentage,
                department,
                team,
                costCenter
            } = req.body;

            // Validate required fields
            if (!name || !tagFilters || !allocationPercentage || !department || !team || !costCenter) {
                res.status(400).json({
                    message: 'All fields are required: name, tagFilters, allocationPercentage, department, team, costCenter'
                });
            }

            // Validate allocation percentage
            if (allocationPercentage < 0 || allocationPercentage > 100) {
                res.status(400).json({
                    message: 'Allocation percentage must be between 0 and 100'
                });
            }

            const rule = await TaggingService.createCostAllocationRule(userId, {
                name,
                tagFilters,
                allocationPercentage,
                department,
                team,
                costCenter
            });

            res.status(201).json({
                success: true,
                data: rule,
                message: 'Cost allocation rule created successfully'
            });
        } catch (error) {
            logger.error('Error creating cost allocation rule:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag analytics by specific tags
     * POST /api/tags/analytics/batch
     */
    static async getBatchTagAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tags, startDate, endDate } = req.body;

            if (!tags || !Array.isArray(tags)) {
                res.status(400).json({ message: 'Tags array is required' });
            }

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                tagFilter: tags,
                includeHierarchy: true,
                includeRealTime: true
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);

            res.json({
                success: true,
                data: analytics,
                metadata: {
                    requestedTags: tags,
                    foundTags: analytics.length,
                    totalCost: analytics.reduce((sum, tag) => sum + tag.totalCost, 0),
                    totalCalls: analytics.reduce((sum, tag) => sum + tag.totalCalls, 0),
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting batch tag analytics:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag cost breakdown
     * GET /api/tags/:tag/breakdown
     */
    static async getTagCostBreakdown(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tag } = req.params;
            const { startDate, endDate } = req.query;

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                tagFilter: [tag]
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);

            if (analytics.length === 0) {
                res.status(404).json({ message: 'Tag not found or no data available' });
            }

            const tagData = analytics[0];

            res.json({
                success: true,
                data: {
                    tag: tagData.tag,
                    totalCost: tagData.totalCost,
                    totalCalls: tagData.totalCalls,
                    totalTokens: tagData.totalTokens,
                    averageCost: tagData.averageCost,
                    trend: tagData.trend,
                    trendPercentage: tagData.trendPercentage,
                    serviceBreakdown: tagData.topServices,
                    modelBreakdown: tagData.topModels,
                    timeSeriesData: tagData.timeSeriesData,
                    lastUsed: tagData.lastUsed
                },
                metadata: {
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting tag cost breakdown:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag comparison
     * POST /api/tags/compare
     */
    static async compareTags(req: any, res: Response): Promise<void> {
        try {
            const userId: any = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tags, startDate, endDate } = req.body;

            if (!tags || !Array.isArray(tags) || tags.length < 2) {
                res.status(400).json({ message: 'At least 2 tags are required for comparison' });
            }

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                tagFilter: tags
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);

            // Calculate comparison metrics
            const comparison = {
                tags: analytics,
                summary: {
                    totalCost: analytics.reduce((sum, tag) => sum + tag.totalCost, 0),
                    totalCalls: analytics.reduce((sum, tag) => sum + tag.totalCalls, 0),
                    averageCostPerTag: analytics.reduce((sum, tag) => sum + tag.totalCost, 0) / analytics.length,
                    mostExpensive: analytics.reduce((max, tag) => tag.totalCost > max.totalCost ? tag : max, analytics[0]),
                    mostUsed: analytics.reduce((max, tag) => tag.totalCalls > max.totalCalls ? tag : max, analytics[0]),
                    bestTrend: analytics.reduce((best, tag) => {
                        if (tag.trend === 'down' && tag.trendPercentage < best.trendPercentage) return tag;
                        if (tag.trend === 'up' && best.trend !== 'down') return tag;
                        return best;
                    }, analytics[0])
                }
            };

            res.json({
                success: true,
                data: comparison,
                metadata: {
                    comparedTags: tags,
                    foundTags: analytics.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error comparing tags:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
} 