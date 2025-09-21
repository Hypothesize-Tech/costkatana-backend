import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface TagHierarchy {
    id: string;
    name: string;
    parent?: string;
    children?: string[];
    color?: string;
    description?: string;
    createdBy: string;
    createdAt: Date;
    isActive: boolean;
}

export interface CostAllocationRule {
    id: string;
    name: string;
    tagFilters: string[];
    allocationPercentage: number;
    department: string;
    team: string;
    costCenter: string;
    createdBy: string;
    isActive: boolean;
}

export interface TagAnalytics {
    tag: string;
    totalCost: number;
    totalCalls: number;
    totalTokens: number;
    averageCost: number;
    trend: 'up' | 'down' | 'stable';
    trendPercentage: number;
    lastUsed: Date;
    topServices: Array<{
        service: string;
        cost: number;
        percentage: number;
    }>;
    topModels: Array<{
        model: string;
        cost: number;
        percentage: number;
    }>;
    timeSeriesData: Array<{
        date: string;
        cost: number;
        calls: number;
        tokens: number;
    }>;
}

export interface RealTimeTagMetrics {
    tag: string;
    currentCost: number;
    currentCalls: number;
    hourlyRate: number;
    projectedDailyCost: number;
    projectedMonthlyCost: number;
    budgetUtilization?: number;
    alertThreshold?: number;
    lastUpdate: Date;
    isAboveBaseline?: boolean;
}

export class TaggingService {
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;

    /**
     * Get comprehensive tag analytics for a user (optimized with unified aggregation)
     */
    static async getTagAnalytics(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            tagFilter?: string[];
            includeHierarchy?: boolean;
            includeRealTime?: boolean;
        } = {}
    ): Promise<TagAnalytics[]> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const {
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate = new Date(),
                tagFilter
            } = options;

            const matchStage: any = {
                userId,
                createdAt: { $gte: startDate, $lte: endDate },
                tags: { $exists: true, $not: { $size: 0 } }
            };

            if (tagFilter && tagFilter.length > 0) {
                matchStage.tags = { $in: tagFilter };
            }

            // Use optimized aggregation pipeline with $facet for unified processing
            const [results] = await Usage.aggregate([
                { $match: matchStage },
                { $unwind: "$tags" },
                ...(tagFilter && tagFilter.length > 0 ? [{ $match: { tags: { $in: tagFilter } } }] : []),
                {
                    $facet: {
                        // Main analytics data
                        analytics: [
                            {
                                $group: {
                                    _id: "$tags",
                                    totalCost: { $sum: "$cost" },
                                    totalCalls: { $sum: 1 },
                                    totalTokens: { $sum: "$totalTokens" },
                                    lastUsed: { $max: "$createdAt" },
                                    // Service breakdown aggregation
                                    serviceBreakdown: {
                                        $push: {
                                            service: "$service",
                                            cost: "$cost"
                                        }
                                    },
                                    // Model breakdown aggregation
                                    modelBreakdown: {
                                        $push: {
                                            model: "$model",
                                            cost: "$cost"
                                        }
                                    },
                                    // Time series aggregation
                                    timeSeriesRaw: {
                                        $push: {
                                            date: {
                                                $dateToString: {
                                                    format: "%Y-%m-%d",
                                                    date: "$createdAt"
                                                }
                                            },
                                            cost: "$cost",
                                            tokens: "$totalTokens"
                                        }
                                    }
                                }
                            },
                            {
                                $project: {
                                    _id: 0,
                                    tag: "$_id",
                                    totalCost: 1,
                                    totalCalls: 1,
                                    totalTokens: 1,
                                    averageCost: { $divide: ["$totalCost", "$totalCalls"] },
                                    lastUsed: 1,
                                    serviceBreakdown: 1,
                                    modelBreakdown: 1,
                                    timeSeriesRaw: 1
                                }
                            },
                            { $sort: { totalCost: -1 } },
                            { $limit: 50 }
                        ]
                    }
                }
            ]);

            // Process the aggregated data efficiently
            const tagAnalytics: TagAnalytics[] = results.analytics.map((tagData: any) => {
                // Process breakdowns using optimized methods
                const topServices = this.processServiceBreakdownOptimized(tagData.serviceBreakdown, tagData.totalCost);
                const topModels = this.processModelBreakdownOptimized(tagData.modelBreakdown, tagData.totalCost);
                const timeSeriesData = this.processTimeSeriesDataOptimized(tagData.timeSeriesRaw);

                return {
                    tag: tagData.tag,
                    totalCost: tagData.totalCost,
                    totalCalls: tagData.totalCalls,
                    totalTokens: tagData.totalTokens,
                    averageCost: tagData.averageCost,
                    trend: 'stable' as const, // Simplified for performance
                    trendPercentage: 0,
                    lastUsed: tagData.lastUsed,
                    topServices,
                    topModels,
                    timeSeriesData
                };
            });

            // Reset failure count on success
            this.dbFailureCount = 0;

            return tagAnalytics;
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting tag analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get real-time tag metrics (optimized with unified aggregation)
     */
    static async getRealTimeTagMetrics(
        userId: string,
        tags?: string[]
    ): Promise<RealTimeTagMetrics[]> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const now = new Date();
            const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            const baseMatch: any = { userId };
            if (tags && tags.length > 0) {
                baseMatch.tags = { $in: tags };
            }

            // Use unified aggregation pipeline with $facet for both current hour and 24-hour data
            const [results] = await Usage.aggregate([
                { $match: baseMatch },
                { $unwind: "$tags" },
                ...(tags && tags.length > 0 ? [{ $match: { tags: { $in: tags } } }] : []),
                {
                    $facet: {
                        // Current hour metrics
                        currentHour: [
                            { $match: { createdAt: { $gte: hourAgo, $lte: now } } },
                            {
                                $group: {
                                    _id: "$tags",
                                    currentCost: { $sum: "$cost" },
                                    currentCalls: { $sum: 1 }
                                }
                            }
                        ],
                        // 24-hour baseline
                        baseline24h: [
                            { $match: { createdAt: { $gte: dayAgo, $lte: now } } },
                            {
                                $group: {
                                    _id: null,
                                    totalCost: { $sum: "$cost" }
                                }
                            }
                        ]
                    }
                }
            ]);

            // Calculate baseline
            const baseline24h = results.baseline24h[0]?.totalCost || 0;
            const avgHourlyBaseline = baseline24h / 24;

            // Process current hour data into metrics
            const tagMetrics: RealTimeTagMetrics[] = results.currentHour.map((tagData: any) => {
                const hourlyRate = tagData.currentCost;
                const projectedDailyCost = hourlyRate * 24;
                const projectedMonthlyCost = projectedDailyCost * 30;
                const isAboveBaseline = tagData.currentCost > (avgHourlyBaseline * 1.1);

                return {
                    tag: tagData._id,
                    currentCost: tagData.currentCost,
                    currentCalls: tagData.currentCalls,
                    hourlyRate,
                    projectedDailyCost,
                    projectedMonthlyCost,
                    lastUpdate: now,
                    isAboveBaseline
                };
            });

            // Reset failure count on success
            this.dbFailureCount = 0;

            return tagMetrics;
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting real-time tag metrics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Create or update tag hierarchy
     */
    static async createTagHierarchy(
        userId: string,
        tagData: {
            name: string;
            parent?: string;
            color?: string;
            description?: string;
        }
    ): Promise<TagHierarchy> {
        try {
            const tagHierarchy: TagHierarchy = {
                id: this.generateTagId(),
                name: tagData.name,
                parent: tagData.parent,
                children: [],
                color: tagData.color || this.generateRandomColor(),
                description: tagData.description,
                createdBy: userId,
                createdAt: new Date(),
                isActive: true
            };

            // In a real implementation, you would save this to a TagHierarchy collection
            // For now, we'll return the created hierarchy
            return tagHierarchy;
        } catch (error) {
            loggingService.error('Error creating tag hierarchy:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get tag suggestions based on usage patterns (optimized with aggregation)
     */
    static async getTagSuggestions(
        userId: string,
        context: {
            service?: string;
            model?: string;
            prompt?: string;
            projectId?: string;
        }
    ): Promise<string[]> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const suggestions = new Set<string>();

            // Use aggregation pipeline to get tag frequency efficiently
            const tagFrequencyData = await Usage.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                        tags: { $exists: true, $not: { $size: 0 } }
                    }
                },
                { $unwind: "$tags" },
                {
                    $group: {
                        _id: "$tags",
                        frequency: { $sum: 1 }
                    }
                },
                { $sort: { frequency: -1 } },
                { $limit: 10 },
                {
                    $project: {
                        _id: 0,
                        tag: "$_id",
                        frequency: 1
                    }
                }
            ]);

            // Add popular tags from aggregation
            tagFrequencyData.forEach(({ tag }) => suggestions.add(tag));

            // Add context-based suggestions
            if (context.service) {
                suggestions.add(context.service);
            }
            if (context.model) {
                suggestions.add(context.model);
            }
            if (context.projectId) {
                suggestions.add('project');
            }

            // Add common tag patterns (pre-computed for performance)
            const commonTags = [
                'development', 'production', 'testing', 'staging',
                'frontend', 'backend', 'api', 'ui', 'ml', 'data',
                'urgent', 'routine', 'experimental', 'optimization'
            ];

            commonTags.forEach(tag => suggestions.add(tag));

            // Reset failure count on success
            this.dbFailureCount = 0;

            return Array.from(suggestions).slice(0, 20);
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting tag suggestions:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Set up cost allocation rules
     */
    static async createCostAllocationRule(
        userId: string,
        ruleData: {
            name: string;
            tagFilters: string[];
            allocationPercentage: number;
            department: string;
            team: string;
            costCenter: string;
        }
    ): Promise<CostAllocationRule> {
        try {
            const rule: CostAllocationRule = {
                id: this.generateTagId(),
                name: ruleData.name,
                tagFilters: ruleData.tagFilters,
                allocationPercentage: ruleData.allocationPercentage,
                department: ruleData.department,
                team: ruleData.team,
                costCenter: ruleData.costCenter,
                createdBy: userId,
                isActive: true
            };

            // In a real implementation, you would save this to a CostAllocationRule collection
            return rule;
        } catch (error) {
            loggingService.error('Error creating cost allocation rule:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Process service breakdown efficiently (optimized version)
     */
    private static processServiceBreakdownOptimized(
        usagesByService: Array<{ service: string; cost: number }>,
        totalCost: number
    ): Array<{ service: string; cost: number; percentage: number }> {
        const serviceMap = new Map<string, number>();
        
        // Single pass aggregation
        for (const { service, cost } of usagesByService) {
            serviceMap.set(service, (serviceMap.get(service) || 0) + cost);
        }

        // Convert to array and sort in single operation
        return Array.from(serviceMap.entries())
            .map(([service, cost]) => ({
                service,
                cost,
                percentage: (cost / totalCost) * 100
            }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 5);
    }

    /**
     * Process service breakdown efficiently (legacy method for compatibility)
     */
    private static processServiceBreakdown(
        usagesByService: Array<{ service: string; cost: number }>,
        totalCost: number
    ): Array<{ service: string; cost: number; percentage: number }> {
        return this.processServiceBreakdownOptimized(usagesByService, totalCost);
    }

    /**
     * Process model breakdown efficiently (optimized version)
     */
    private static processModelBreakdownOptimized(
        usagesByModel: Array<{ model: string; cost: number }>,
        totalCost: number
    ): Array<{ model: string; cost: number; percentage: number }> {
        const modelMap = new Map<string, number>();
        
        // Single pass aggregation
        for (const { model, cost } of usagesByModel) {
            modelMap.set(model, (modelMap.get(model) || 0) + cost);
        }

        // Convert to array and sort in single operation
        return Array.from(modelMap.entries())
            .map(([model, cost]) => ({
                model,
                cost,
                percentage: (cost / totalCost) * 100
            }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 5);
    }

    /**
     * Process model breakdown efficiently (legacy method for compatibility)
     */
    private static processModelBreakdown(
        usagesByModel: Array<{ model: string; cost: number }>,
        totalCost: number
    ): Array<{ model: string; cost: number; percentage: number }> {
        return this.processModelBreakdownOptimized(usagesByModel, totalCost);
    }

    /**
     * Process time series data efficiently (optimized version)
     */
    private static processTimeSeriesDataOptimized(
        timeSeriesData: Array<{ date: string; cost: number; tokens: number }>
    ): Array<{ date: string; cost: number; calls: number; tokens: number }> {
        const dateMap = new Map<string, { cost: number; calls: number; tokens: number }>();
        
        // Single pass aggregation with optimized loop
        for (const { date, cost, tokens } of timeSeriesData) {
            const existing = dateMap.get(date);
            if (existing) {
                existing.cost += cost;
                existing.calls += 1;
                existing.tokens += tokens;
            } else {
                dateMap.set(date, { cost, calls: 1, tokens });
            }
        }

        // Convert to array and sort in single operation
        return Array.from(dateMap.entries())
            .map(([date, data]) => ({
                date,
                cost: data.cost,
                calls: data.calls,
                tokens: data.tokens
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30); // Only return last 30 days
    }

    /**
     * Process time series data efficiently (legacy method for compatibility)
     */
    private static processTimeSeriesData(
        timeSeriesData: Array<{ date: string; cost: number; tokens: number }>
    ): Array<{ date: string; cost: number; calls: number; tokens: number }> {
        return this.processTimeSeriesDataOptimized(timeSeriesData);
    }

    /**
     * Generate unique tag ID
     */
    private static generateTagId(): string {
        return `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate random color for tag
     */
    private static generateRandomColor(): string {
        const colors = [
            '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
            '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
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
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Reset circuit breaker state
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
    }
} 