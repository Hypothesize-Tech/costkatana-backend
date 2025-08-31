import { Response } from 'express';
import { TaggingService } from '../services/tagging.service';
import { loggingService } from '../services/logging.service';

export class TaggingController {

    /**
     * Get comprehensive tag analytics
     * GET /api/tags/analytics
     */
    static async getTagAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const {
            startDate,
            endDate,
            tagFilter,
            includeHierarchy = true,
            includeRealTime = true
        } = req.query;

        try {
            loggingService.info('Tag analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate,
                tagFilter,
                hasTagFilter: !!tagFilter,
                includeHierarchy,
                includeRealTime
            });

            if (!userId) {
                loggingService.warn('Tag analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                tagFilter: tagFilter ? (tagFilter as string).split(',') : undefined,
                includeHierarchy: includeHierarchy === 'true',
                includeRealTime: includeRealTime === 'true'
            };

            // Add timeout handling (10 seconds)
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 10000);
            });

            const analyticsPromise = TaggingService.getTagAnalytics(userId, options);

            const analytics = await Promise.race([analyticsPromise, timeoutPromise]);
            const duration = Date.now() - startTime;

            const totalCost = analytics.reduce((sum, tag) => sum + tag.totalCost, 0);
            const totalCalls = analytics.reduce((sum, tag) => sum + tag.totalCalls, 0);

            loggingService.info('Tag analytics retrieved successfully', {
                userId,
                duration,
                startDate,
                endDate,
                hasTagFilter: !!options.tagFilter,
                tagFilterCount: options.tagFilter?.length || 0,
                includeHierarchy: options.includeHierarchy,
                includeRealTime: options.includeRealTime,
                totalTags: analytics.length,
                totalCost,
                totalCalls,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_analytics_retrieved',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    totalTags: analytics.length,
                    totalCost,
                    totalCalls,
                    hasDateRange: !!(startDate && endDate)
                }
            });

            res.json({
                success: true,
                data: analytics,
                metadata: {
                    totalTags: analytics.length,
                    totalCost,
                    totalCalls,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            if (error.message === 'Request timeout') {
                loggingService.warn('Tag analytics retrieval timed out', {
                    userId,
                    hasUserId: !!userId,
                    requestId,
                    startDate,
                    endDate,
                    tagFilter,
                    duration
                });
                
                res.status(408).json({ 
                    success: false,
                    message: 'Request timeout - analysis took too long. Please try with fewer tags or a smaller date range.' 
                });
            } else {
                loggingService.error('Tag analytics retrieval failed', {
                    userId,
                    hasUserId: !!userId,
                    requestId,
                    startDate,
                    endDate,
                    tagFilter,
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    duration
                });
                
                res.status(500).json({ 
                    success: false,
                    message: 'Internal server error' 
                });
            }
        }
    }

    /**
     * Get real-time tag metrics
     * GET /api/tags/realtime
     */
    static async getRealTimeMetrics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { tags } = req.query;

        try {
            loggingService.info('Real-time tag metrics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                tags,
                hasTags: !!tags
            });

            if (!userId) {
                loggingService.warn('Real-time tag metrics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const tagFilter = tags ? (tags as string).split(',') : undefined;

            const metrics = await TaggingService.getRealTimeTagMetrics(userId, tagFilter);
            const duration = Date.now() - startTime;

            const totalCurrentCost = metrics.reduce((sum, tag) => sum + tag.currentCost, 0);
            const totalProjectedDailyCost = metrics.reduce((sum, tag) => sum + tag.projectedDailyCost, 0);

            loggingService.info('Real-time tag metrics retrieved successfully', {
                userId,
                duration,
                tags,
                hasTagFilter: !!tagFilter,
                tagFilterCount: tagFilter?.length || 0,
                totalTags: metrics.length,
                totalCurrentCost,
                totalProjectedDailyCost,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'realtime_tag_metrics_retrieved',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    totalTags: metrics.length,
                    totalCurrentCost,
                    totalProjectedDailyCost,
                    hasTagFilter: !!tagFilter
                }
            });

            res.json({
                success: true,
                data: metrics,
                metadata: {
                    totalTags: metrics.length,
                    totalCurrentCost,
                    totalProjectedDailyCost,
                    lastUpdate: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Real-time tag metrics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                tags,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Create tag hierarchy
     * POST /api/tags/hierarchy
     */
    static async createTagHierarchy(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { name, parent, color, description } = req.body;

        try {
            loggingService.info('Tag hierarchy creation initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                name,
                hasName: !!name,
                parent,
                hasParent: !!parent,
                color,
                hasColor: !!color,
                description,
                hasDescription: !!description
            });

            if (!userId) {
                loggingService.warn('Tag hierarchy creation failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!name) {
                loggingService.warn('Tag hierarchy creation failed - tag name is required', {
                    userId,
                    requestId
                });
                res.status(400).json({ message: 'Tag name is required' });
                return;
            }

            const hierarchy = await TaggingService.createTagHierarchy(userId, {
                name,
                parent,
                color,
                description
            });
            const duration = Date.now() - startTime;

            loggingService.info('Tag hierarchy created successfully', {
                userId,
                duration,
                name,
                parent,
                hasColor: !!color,
                hasDescription: !!description,
                hierarchyId: hierarchy?.id,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_hierarchy_created',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    name,
                    hasParent: !!parent,
                    hasColor: !!color,
                    hasDescription: !!description
                }
            });

            res.status(201).json({
                success: true,
                data: hierarchy,
                message: 'Tag hierarchy created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Tag hierarchy creation failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                name,
                parent,
                color,
                description,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag suggestions
     * GET /api/tags/suggestions
     */
    static async getTagSuggestions(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { service, model, prompt, projectId } = req.query;

        try {
            loggingService.info('Tag suggestions retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                service,
                hasService: !!service,
                model,
                hasModel: !!model,
                hasPrompt: !!prompt,
                promptLength: prompt ? (prompt as string).length : 0,
                projectId,
                hasProjectId: !!projectId
            });

            if (!userId) {
                loggingService.warn('Tag suggestions retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const suggestions = await TaggingService.getTagSuggestions(userId, {
                service: service as string,
                model: model as string,
                prompt: prompt as string,
                projectId: projectId as string
            });
            const duration = Date.now() - startTime;

            loggingService.info('Tag suggestions retrieved successfully', {
                userId,
                duration,
                service,
                model,
                hasPrompt: !!prompt,
                projectId,
                totalSuggestions: suggestions.length,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_suggestions_retrieved',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    service,
                    model,
                    hasPrompt: !!prompt,
                    projectId,
                    totalSuggestions: suggestions.length
                }
            });

            res.json({
                success: true,
                data: suggestions,
                metadata: {
                    totalSuggestions: suggestions.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Tag suggestions retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                service,
                model,
                hasPrompt: !!prompt,
                projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Create cost allocation rule
     * POST /api/tags/allocation-rules
     */
    static async createCostAllocationRule(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const {
            name,
            tagFilters,
            allocationPercentage,
            department,
            team,
            costCenter
        } = req.body;

        try {
            loggingService.info('Cost allocation rule creation initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                name,
                hasName: !!name,
                hasTagFilters: !!tagFilters,
                tagFiltersCount: Array.isArray(tagFilters) ? tagFilters.length : 0,
                allocationPercentage,
                hasAllocationPercentage: allocationPercentage !== undefined,
                department,
                hasDepartment: !!department,
                team,
                hasTeam: !!team,
                costCenter,
                hasCostCenter: !!costCenter
            });

            if (!userId) {
                loggingService.warn('Cost allocation rule creation failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            // Validate required fields
            if (!name || !tagFilters || !allocationPercentage || !department || !team || !costCenter) {
                loggingService.warn('Cost allocation rule creation failed - missing required fields', {
                    userId,
                    requestId,
                    name: !!name,
                    tagFilters: !!tagFilters,
                    allocationPercentage: allocationPercentage !== undefined,
                    department: !!department,
                    team: !!team,
                    costCenter: !!costCenter
                });
                res.status(400).json({
                    message: 'All fields are required: name, tagFilters, allocationPercentage, department, team, costCenter'
                });
                return;
            }

            // Validate allocation percentage
            if (allocationPercentage < 0 || allocationPercentage > 100) {
                loggingService.warn('Cost allocation rule creation failed - invalid allocation percentage', {
                    userId,
                    requestId,
                    allocationPercentage
                });
                res.status(400).json({
                    message: 'Allocation percentage must be between 0 and 100'
                });
                return;
            }

            const rule = await TaggingService.createCostAllocationRule(userId, {
                name,
                tagFilters,
                allocationPercentage,
                department,
                team,
                costCenter
            });
            const duration = Date.now() - startTime;

            loggingService.info('Cost allocation rule created successfully', {
                userId,
                duration,
                name,
                tagFiltersCount: Array.isArray(tagFilters) ? tagFilters.length : 0,
                allocationPercentage,
                department,
                team,
                costCenter,
                ruleId: rule?.id,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cost_allocation_rule_created',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    name,
                    tagFiltersCount: Array.isArray(tagFilters) ? tagFilters.length : 0,
                    allocationPercentage,
                    department,
                    team,
                    costCenter
                }
            });

            res.status(201).json({
                success: true,
                data: rule,
                message: 'Cost allocation rule created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Cost allocation rule creation failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                name,
                tagFilters,
                allocationPercentage,
                department,
                team,
                costCenter,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag analytics by specific tags
     * POST /api/tags/analytics/batch
     */
    static async getBatchTagAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { tags, startDate, endDate } = req.body;

        try {
            loggingService.info('Batch tag analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                hasTags: !!tags,
                tagsCount: Array.isArray(tags) ? tags.length : 0,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Batch tag analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!tags || !Array.isArray(tags)) {
                loggingService.warn('Batch tag analytics retrieval failed - tags array is required', {
                    userId,
                    requestId
                });
                res.status(400).json({ message: 'Tags array is required' });
                return;
            }

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                tagFilter: tags,
                includeHierarchy: true,
                includeRealTime: true
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);
            const duration = Date.now() - startTime;

            const totalCost = analytics.reduce((sum, tag) => sum + tag.totalCost, 0);
            const totalCalls = analytics.reduce((sum, tag) => sum + tag.totalCalls, 0);

            loggingService.info('Batch tag analytics retrieved successfully', {
                userId,
                duration,
                tagsCount: tags.length,
                startDate,
                endDate,
                foundTags: analytics.length,
                totalCost,
                totalCalls,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'batch_tag_analytics_retrieved',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    requestedTags: tags.length,
                    foundTags: analytics.length,
                    totalCost,
                    totalCalls,
                    hasDateRange: !!(startDate && endDate)
                }
            });

            res.json({
                success: true,
                data: analytics,
                metadata: {
                    requestedTags: tags,
                    foundTags: analytics.length,
                    totalCost,
                    totalCalls,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Batch tag analytics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                tags,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag cost breakdown
     * GET /api/tags/:tag/breakdown
     */
    static async getTagCostBreakdown(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { tag } = req.params;
        const { startDate, endDate } = req.query;

        try {
            loggingService.info('Tag cost breakdown retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                tag,
                hasTag: !!tag,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Tag cost breakdown retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                tagFilter: [tag]
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);
            const duration = Date.now() - startTime;

            if (analytics.length === 0) {
                loggingService.warn('Tag cost breakdown retrieval failed - tag not found or no data available', {
                    userId,
                    requestId,
                    tag,
                    startDate,
                    endDate
                });
                res.status(404).json({ message: 'Tag not found or no data available' });
                return;
            }

            const tagData = analytics[0];

            loggingService.info('Tag cost breakdown retrieved successfully', {
                userId,
                duration,
                tag,
                startDate,
                endDate,
                totalCost: tagData.totalCost,
                totalCalls: tagData.totalCalls,
                totalTokens: tagData.totalTokens,
                averageCost: tagData.averageCost,
                trend: tagData.trend,
                trendPercentage: tagData.trendPercentage,
                hasServiceBreakdown: !!tagData.topServices,
                hasModelBreakdown: !!tagData.topModels,
                hasTimeSeriesData: !!tagData.timeSeriesData,
                lastUsed: tagData.lastUsed,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_cost_breakdown_retrieved',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    tag,
                    totalCost: tagData.totalCost,
                    totalCalls: tagData.totalCalls,
                    hasDateRange: !!(startDate && endDate)
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Tag cost breakdown retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                tag,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get tag comparison
     * POST /api/tags/compare
     */
    static async compareTags(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: any = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { tags, startDate, endDate } = req.body;

        try {
            loggingService.info('Tag comparison initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                hasTags: !!tags,
                tagsCount: Array.isArray(tags) ? tags.length : 0,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Tag comparison failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!tags || !Array.isArray(tags) || tags.length < 2) {
                loggingService.warn('Tag comparison failed - at least 2 tags are required for comparison', {
                    userId,
                    requestId,
                    tags,
                    tagsCount: Array.isArray(tags) ? tags.length : 0
                });
                res.status(400).json({ message: 'At least 2 tags are required for comparison' });
                return;
            }

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                tagFilter: tags
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);
            const duration = Date.now() - startTime;

            // Calculate comparison metrics
            const totalCost = analytics.reduce((sum, tag) => sum + tag.totalCost, 0);
            const totalCalls = analytics.reduce((sum, tag) => sum + tag.totalCalls, 0);
            const averageCostPerTag = totalCost / analytics.length;
            const mostExpensive = analytics.reduce((max, tag) => tag.totalCost > max.totalCost ? tag : max, analytics[0]);
            const mostUsed = analytics.reduce((max, tag) => tag.totalCalls > max.totalCalls ? tag : max, analytics[0]);
            const bestTrend = analytics.reduce((best, tag) => {
                if (tag.trend === 'down' && tag.trendPercentage < best.trendPercentage) return tag;
                if (tag.trend === 'up' && best.trend !== 'down') return tag;
                return best;
            }, analytics[0]);

            const comparison = {
                tags: analytics,
                summary: {
                    totalCost,
                    totalCalls,
                    averageCostPerTag,
                    mostExpensive,
                    mostUsed,
                    bestTrend
                }
            };

            loggingService.info('Tag comparison completed successfully', {
                userId,
                duration,
                tagsCount: tags.length,
                startDate,
                endDate,
                foundTags: analytics.length,
                totalCost,
                totalCalls,
                averageCostPerTag,
                mostExpensiveTag: mostExpensive?.tag,
                mostUsedTag: mostUsed?.tag,
                bestTrendTag: bestTrend?.tag,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tags_compared',
                category: 'tagging',
                value: duration,
                metadata: {
                    userId,
                    comparedTags: tags.length,
                    foundTags: analytics.length,
                    totalCost,
                    totalCalls,
                    hasDateRange: !!(startDate && endDate)
                }
            });

            res.json({
                success: true,
                data: comparison,
                metadata: {
                    comparedTags: tags,
                    foundTags: analytics.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Tag comparison failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                tags,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}