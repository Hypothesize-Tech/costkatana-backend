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

    /**
     * Get comprehensive tag analytics for a user
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

            // Use aggregation pipeline for better performance
            const tagAnalyticsData = await Usage.aggregate([
                { $match: matchStage },
                { $unwind: "$tags" },
                ...(tagFilter && tagFilter.length > 0 ? [{ $match: { tags: { $in: tagFilter } } }] : []),
                {
                    $group: {
                        _id: "$tags",
                        totalCost: { $sum: "$cost" },
                        totalCalls: { $sum: 1 },
                        totalTokens: { $sum: "$totalTokens" },
                        lastUsed: { $max: "$createdAt" },
                        services: { $addToSet: "$service" },
                        models: { $addToSet: "$model" },
                        usagesByService: {
                            $push: {
                                service: "$service",
                                cost: "$cost"
                            }
                        },
                        usagesByModel: {
                            $push: {
                                model: "$model",
                                cost: "$cost"
                            }
                        },
                        timeSeriesData: {
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
                        usagesByService: 1,
                        usagesByModel: 1,
                        timeSeriesData: 1
                    }
                },
                { $sort: { totalCost: -1 } },
                { $limit: 50 } // Limit to prevent excessive data
            ]);

            // Process the aggregated data and calculate trends in parallel
            const tagAnalytics: TagAnalytics[] = await Promise.all(
                tagAnalyticsData.map(async (tagData) => {
                    // Calculate trend (compare with previous period) - simplified for performance
                    const trendData = { trend: 'stable' as const, percentage: 0 };
                    
                    // Process service breakdown
                    const serviceBreakdown = this.processServiceBreakdown(tagData.usagesByService, tagData.totalCost);
                    
                    // Process model breakdown
                    const modelBreakdown = this.processModelBreakdown(tagData.usagesByModel, tagData.totalCost);
                    
                    // Generate time series data
                    const timeSeriesData = this.processTimeSeriesData(tagData.timeSeriesData);

                    return {
                        tag: tagData.tag,
                        totalCost: tagData.totalCost,
                        totalCalls: tagData.totalCalls,
                        totalTokens: tagData.totalTokens,
                        averageCost: tagData.averageCost,
                        trend: trendData.trend,
                        trendPercentage: trendData.percentage,
                        lastUsed: tagData.lastUsed,
                        topServices: serviceBreakdown,
                        topModels: modelBreakdown,
                        timeSeriesData
                    };
                })
            );

            return tagAnalytics;
        } catch (error) {
            loggingService.error('Error getting tag analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get real-time tag metrics
     */
    static async getRealTimeTagMetrics(
        userId: string,
        tags?: string[]
    ): Promise<RealTimeTagMetrics[]> {
        try {
            const now = new Date();
            const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            const baseQuery: any = { userId };
            if (tags && tags.length > 0) {
                baseQuery.tags = { $in: tags };
            }

            // Get current hour data
            const currentHourData = await Usage.find({
                ...baseQuery,
                createdAt: { $gte: hourAgo, $lte: now }
            }).lean();

            // Get last 24 hours for trend
            const last24HoursData = await Usage.find({
                ...baseQuery,
                createdAt: { $gte: dayAgo, $lte: now }
            }).lean();

            // Process metrics by tag
            const tagMetrics = new Map<string, RealTimeTagMetrics>();

            // Calculate baseline from 24 hours data
            const baseline24h = last24HoursData.reduce((sum, usage) => sum + usage.cost, 0);
            const avgHourlyBaseline = baseline24h / 24;

            // Process current hour data
            currentHourData.forEach(usage => {
                if (usage.tags && usage.tags.length > 0) {
                    usage.tags.forEach(tag => {
                        if (!tagMetrics.has(tag)) {
                            tagMetrics.set(tag, {
                                tag,
                                currentCost: 0,
                                currentCalls: 0,
                                hourlyRate: 0,
                                projectedDailyCost: 0,
                                projectedMonthlyCost: 0,
                                lastUpdate: now
                            });
                        }

                        const metric = tagMetrics.get(tag)!;
                        metric.currentCost += usage.cost;
                        metric.currentCalls += 1;
                    });
                }
            });

            // Calculate hourly rates and projections
            for (const [tag, metric] of tagMetrics.entries()) {
                metric.hourlyRate = metric.currentCost;
                metric.projectedDailyCost = metric.hourlyRate * 24;
                metric.projectedMonthlyCost = metric.projectedDailyCost * 30;

                // Compare with baseline for trend analysis
                const isAboveBaseline = metric.currentCost > (avgHourlyBaseline * 1.1);

                // Use tag name for validation/labeling and baseline comparison
                metric.tag = tag;
                metric.isAboveBaseline = isAboveBaseline;
            }

            return Array.from(tagMetrics.values());
        } catch (error) {
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
     * Get tag suggestions based on usage patterns
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
            const suggestions = new Set<string>();

            // Get recent usage patterns
            const recentUsage = await Usage.find({
                userId,
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            }).limit(100).lean();

            // Extract popular tags
            const tagFrequency = new Map<string, number>();
            recentUsage.forEach(usage => {
                if (usage.tags && usage.tags.length > 0) {
                    usage.tags.forEach(tag => {
                        tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
                    });
                }
            });

            // Get top tags
            const topTags = Array.from(tagFrequency.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([tag]) => tag);

            topTags.forEach(tag => suggestions.add(tag));

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

            // Add common tag patterns
            const commonTags = [
                'development', 'production', 'testing', 'staging',
                'frontend', 'backend', 'api', 'ui', 'ml', 'data',
                'urgent', 'routine', 'experimental', 'optimization'
            ];

            commonTags.forEach(tag => suggestions.add(tag));

            return Array.from(suggestions).slice(0, 20);
        } catch (error) {
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
     * Process service breakdown efficiently
     */
    private static processServiceBreakdown(
        usagesByService: Array<{ service: string; cost: number }>,
        totalCost: number
    ): Array<{ service: string; cost: number; percentage: number }> {
        const serviceMap = new Map<string, number>();
        
        usagesByService.forEach(({ service, cost }) => {
            serviceMap.set(service, (serviceMap.get(service) || 0) + cost);
        });

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
     * Process model breakdown efficiently
     */
    private static processModelBreakdown(
        usagesByModel: Array<{ model: string; cost: number }>,
        totalCost: number
    ): Array<{ model: string; cost: number; percentage: number }> {
        const modelMap = new Map<string, number>();
        
        usagesByModel.forEach(({ model, cost }) => {
            modelMap.set(model, (modelMap.get(model) || 0) + cost);
        });

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
     * Process time series data efficiently
     */
    private static processTimeSeriesData(
        timeSeriesData: Array<{ date: string; cost: number; tokens: number }>
    ): Array<{ date: string; cost: number; calls: number; tokens: number }> {
        const dateMap = new Map<string, { cost: number; calls: number; tokens: number }>();
        
        timeSeriesData.forEach(({ date, cost, tokens }) => {
            const existing = dateMap.get(date) || { cost: 0, calls: 0, tokens: 0 };
            existing.cost += cost;
            existing.calls += 1;
            existing.tokens += tokens;
            dateMap.set(date, existing);
        });

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
} 