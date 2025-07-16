import { Usage, IUsage } from '../models/Usage';
import { logger } from '../utils/logger';

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

            // Base query for usage data
            const baseQuery: any = {
                userId,
                createdAt: { $gte: startDate, $lte: endDate }
            };

            if (tagFilter && tagFilter.length > 0) {
                baseQuery.tags = { $in: tagFilter };
            }

            // Get all usage data with tags
            const usageData = await Usage.find(baseQuery).lean();

            // Group by tags
            const tagGroups = new Map<string, IUsage[]>();

            usageData.forEach(usage => {
                if (usage.tags && usage.tags.length > 0) {
                    usage.tags.forEach(tag => {
                        if (!tagGroups.has(tag)) {
                            tagGroups.set(tag, []);
                        }
                        tagGroups.get(tag)!.push(usage);
                    });
                }
            });

            // Calculate analytics for each tag
            const tagAnalytics: TagAnalytics[] = [];

            for (const [tag, tagUsages] of tagGroups.entries()) {
                const totalCost = tagUsages.reduce((sum, usage) => sum + usage.cost, 0);
                const totalCalls = tagUsages.length;
                const totalTokens = tagUsages.reduce((sum, usage) => sum + usage.totalTokens, 0);
                const averageCost = totalCost / totalCalls;

                // Calculate trend (compare with previous period)
                const trendData = await this.calculateTagTrend(userId, tag, startDate, endDate);

                // Get service breakdown
                const serviceBreakdown = this.getServiceBreakdown(tagUsages);

                // Get model breakdown
                const modelBreakdown = this.getModelBreakdown(tagUsages);

                // Generate time series data
                const timeSeriesData = this.generateTimeSeriesData(tagUsages, startDate, endDate);

                tagAnalytics.push({
                    tag,
                    totalCost,
                    totalCalls,
                    totalTokens,
                    averageCost,
                    trend: trendData.trend,
                    trendPercentage: trendData.percentage,
                    lastUsed: new Date(Math.max(...tagUsages.map(u => u.createdAt.getTime()))),
                    topServices: serviceBreakdown,
                    topModels: modelBreakdown,
                    timeSeriesData
                });
            }

            // Sort by total cost descending
            tagAnalytics.sort((a, b) => b.totalCost - a.totalCost);

            return tagAnalytics;
        } catch (error) {
            logger.error('Error getting tag analytics:', error);
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
            logger.error('Error getting real-time tag metrics:', error);
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
            logger.error('Error creating tag hierarchy:', error);
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
            logger.error('Error getting tag suggestions:', error);
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
            logger.error('Error creating cost allocation rule:', error);
            throw error;
        }
    }

    /**
     * Calculate tag trend comparison
     */
    private static async calculateTagTrend(
        userId: string,
        tag: string,
        startDate: Date,
        endDate: Date
    ): Promise<{ trend: 'up' | 'down' | 'stable'; percentage: number }> {
        try {
            const periodLength = endDate.getTime() - startDate.getTime();
            const previousStartDate = new Date(startDate.getTime() - periodLength);
            const previousEndDate = startDate;

            // Current period data
            const currentData = await Usage.find({
                userId,
                tags: tag,
                createdAt: { $gte: startDate, $lte: endDate }
            }).lean();

            // Previous period data
            const previousData = await Usage.find({
                userId,
                tags: tag,
                createdAt: { $gte: previousStartDate, $lte: previousEndDate }
            }).lean();

            const currentCost = currentData.reduce((sum, usage) => sum + usage.cost, 0);
            const previousCost = previousData.reduce((sum, usage) => sum + usage.cost, 0);

            if (previousCost === 0) {
                return { trend: 'stable', percentage: 0 };
            }

            const percentage = ((currentCost - previousCost) / previousCost) * 100;
            const trend = percentage > 5 ? 'up' : percentage < -5 ? 'down' : 'stable';

            return { trend, percentage };
        } catch (error) {
            logger.error('Error calculating tag trend:', error);
            return { trend: 'stable', percentage: 0 };
        }
    }

    /**
     * Get service breakdown for tag usages
     */
    private static getServiceBreakdown(usages: IUsage[]): Array<{
        service: string;
        cost: number;
        percentage: number;
    }> {
        const serviceMap = new Map<string, number>();
        const totalCost = usages.reduce((sum, usage) => sum + usage.cost, 0);

        usages.forEach(usage => {
            serviceMap.set(usage.service, (serviceMap.get(usage.service) || 0) + usage.cost);
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
     * Get model breakdown for tag usages
     */
    private static getModelBreakdown(usages: IUsage[]): Array<{
        model: string;
        cost: number;
        percentage: number;
    }> {
        const modelMap = new Map<string, number>();
        const totalCost = usages.reduce((sum, usage) => sum + usage.cost, 0);

        usages.forEach(usage => {
            modelMap.set(usage.model, (modelMap.get(usage.model) || 0) + usage.cost);
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
     * Generate time series data for tag usages
     */
    private static generateTimeSeriesData(
        usages: IUsage[],
        startDate: Date,
        endDate: Date
    ): Array<{
        date: string;
        cost: number;
        calls: number;
        tokens: number;
    }> {
        const timeSeriesMap = new Map<string, { cost: number; calls: number; tokens: number }>();

        // Initialize all dates in range
        const current = new Date(startDate);
        while (current <= endDate) {
            const dateKey = current.toISOString().split('T')[0];
            timeSeriesMap.set(dateKey, { cost: 0, calls: 0, tokens: 0 });
            current.setDate(current.getDate() + 1);
        }

        // Aggregate usage data by date
        usages.forEach(usage => {
            const dateKey = usage.createdAt.toISOString().split('T')[0];
            if (timeSeriesMap.has(dateKey)) {
                const data = timeSeriesMap.get(dateKey)!;
                data.cost += usage.cost;
                data.calls += 1;
                data.tokens += usage.totalTokens;
            }
        });

        return Array.from(timeSeriesMap.entries())
            .map(([date, data]) => ({
                date,
                cost: data.cost,
                calls: data.calls,
                tokens: data.tokens
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
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