import { Response } from 'express';
import { TaggingService } from '../services/tagging.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class TaggingController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Request timeout configuration
    private static readonly DEFAULT_TIMEOUT = 10000; // 10 seconds
    private static readonly ANALYTICS_TIMEOUT = 15000; // 15 seconds for complex analytics
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }

    /**
     * Get comprehensive tag analytics
     * GET /api/tags/analytics
     */
    static async getTagAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTagAnalytics', req);

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

            // Check circuit breaker before proceeding
            if (TaggingController.isDbCircuitBreakerOpen()) {
                throw new Error('Service temporarily unavailable');
            }

            // Add timeout handling with configurable timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), TaggingController.ANALYTICS_TIMEOUT);
            });

            const analyticsPromise = TaggingService.getTagAnalytics(userId, options);

            const analytics = await Promise.race([analyticsPromise, timeoutPromise]);

            const totalCost = analytics.reduce((sum, tag) => sum + tag.totalCost, 0);
            const totalCalls = analytics.reduce((sum, tag) => sum + tag.totalCalls, 0);

            ControllerHelper.logRequestSuccess('getTagAnalytics', req, startTime, {
                totalTags: analytics.length,
                totalCost,
                totalCalls
            });

            // Queue background business event logging
            TaggingController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'tag_analytics_retrieved',
                    category: 'tagging',
                    value: Date.now() - startTime,
                    metadata: {
                        userId,
                        totalTags: analytics.length,
                        totalCost,
                        totalCalls,
                        hasDateRange: !!(startDate && endDate)
                    }
                });
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
            TaggingController.recordDbFailure();
            
            if (error.message === 'Request timeout') {
                res.status(408).json({ 
                    success: false,
                    message: 'Request timeout - analysis took too long. Please try with fewer tags or a smaller date range.' 
                });
            } else if (error.message === 'Service temporarily unavailable') {
                res.status(503).json({ 
                    success: false,
                    message: 'Service temporarily unavailable. Please try again later.' 
                });
            } else {
                ControllerHelper.handleError('getTagAnalytics', error, req, res, startTime);
            }
        }
    }

    /**
     * Get real-time tag metrics
     * GET /api/tags/realtime
     */
    static async getRealTimeMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getRealTimeMetrics', req);

            const { tags } = req.query;

            // Check circuit breaker before proceeding
            if (TaggingController.isDbCircuitBreakerOpen()) {
                throw new Error('Service temporarily unavailable');
            }

            const tagFilter = tags ? (tags as string).split(',') : undefined;

            // Add timeout handling for real-time metrics
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), TaggingController.DEFAULT_TIMEOUT);
            });

            const metricsPromise = TaggingService.getRealTimeTagMetrics(userId, tagFilter);
            const metrics = await Promise.race([metricsPromise, timeoutPromise]);

            const totalCurrentCost = metrics.reduce((sum, tag) => sum + tag.currentCost, 0);
            const totalProjectedDailyCost = metrics.reduce((sum, tag) => sum + tag.projectedDailyCost, 0);

            ControllerHelper.logRequestSuccess('getRealTimeMetrics', req, startTime, {
                totalTags: metrics.length,
                totalCurrentCost,
                totalProjectedDailyCost
            });

            // Log business event
            loggingService.logBusiness({
                event: 'realtime_tag_metrics_retrieved',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getRealTimeMetrics', error, req, res, startTime);
        }
    }

    /**
     * Create tag hierarchy
     * POST /api/tags/hierarchy
     */
    static async createTagHierarchy(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('createTagHierarchy', req);

            const { name, parent, color, description } = req.body;

            if (!name) {
                res.status(400).json({ message: 'Tag name is required' });
                return;
            }

            if (parent) {
                ServiceHelper.validateObjectId(parent, 'parent');
            }

            const hierarchy = await TaggingService.createTagHierarchy(userId, {
                name,
                parent,
                color,
                description
            });

            ControllerHelper.logRequestSuccess('createTagHierarchy', req, startTime, {
                hierarchyId: hierarchy?.id
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_hierarchy_created',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('createTagHierarchy', error, req, res, startTime);
        }
    }

    /**
     * Get tag suggestions
     * GET /api/tags/suggestions
     */
    static async getTagSuggestions(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTagSuggestions', req);

            const { service, model, prompt, projectId } = req.query;

            if (projectId) {
                ServiceHelper.validateObjectId(projectId as string, 'projectId');
            }

            const suggestions = await TaggingService.getTagSuggestions(userId, {
                service: service as string,
                model: model as string,
                prompt: prompt as string,
                projectId: projectId as string
            });

            ControllerHelper.logRequestSuccess('getTagSuggestions', req, startTime, {
                totalSuggestions: suggestions.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_suggestions_retrieved',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getTagSuggestions', error, req, res, startTime);
        }
    }

    /**
     * Create cost allocation rule
     * POST /api/tags/allocation-rules
     */
    static async createCostAllocationRule(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('createCostAllocationRule', req);

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
                return;
            }

            // Validate allocation percentage
            if (allocationPercentage < 0 || allocationPercentage > 100) {
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

            ControllerHelper.logRequestSuccess('createCostAllocationRule', req, startTime, {
                ruleId: rule?.id
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cost_allocation_rule_created',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('createCostAllocationRule', error, req, res, startTime);
        }
    }

    /**
     * Get tag analytics by specific tags
     * POST /api/tags/analytics/batch
     */
    static async getBatchTagAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getBatchTagAnalytics', req);

            const { tags, startDate, endDate } = req.body;

            if (!tags || !Array.isArray(tags)) {
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

            const totalCost = analytics.reduce((sum, tag) => sum + tag.totalCost, 0);
            const totalCalls = analytics.reduce((sum, tag) => sum + tag.totalCalls, 0);

            ControllerHelper.logRequestSuccess('getBatchTagAnalytics', req, startTime, {
                requestedTags: tags.length,
                foundTags: analytics.length,
                totalCost,
                totalCalls
            });

            // Log business event
            loggingService.logBusiness({
                event: 'batch_tag_analytics_retrieved',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getBatchTagAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get tag cost breakdown
     * GET /api/tags/:tag/breakdown
     */
    static async getTagCostBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTagCostBreakdown', req);

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
                return;
            }

            const tagData = analytics[0];

            ControllerHelper.logRequestSuccess('getTagCostBreakdown', req, startTime, {
                tag,
                totalCost: tagData.totalCost,
                totalCalls: tagData.totalCalls
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tag_cost_breakdown_retrieved',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getTagCostBreakdown', error, req, res, startTime);
        }
    }

    /**
     * Get tag comparison
     * POST /api/tags/compare
     */
    static async compareTags(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('compareTags', req);

            const { tags, startDate, endDate } = req.body;

            if (!tags || !Array.isArray(tags) || tags.length < 2) {
                res.status(400).json({ message: 'At least 2 tags are required for comparison' });
                return;
            }

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                tagFilter: tags
            };

            const analytics = await TaggingService.getTagAnalytics(userId, options);

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

            ControllerHelper.logRequestSuccess('compareTags', req, startTime, {
                comparedTags: tags.length,
                foundTags: analytics.length,
                totalCost,
                totalCalls
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tags_compared',
                category: 'tagging',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('compareTags', error, req, res, startTime);
        }
    }


    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
    }
}