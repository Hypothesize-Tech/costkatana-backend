import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

interface TemplateUsageFilters {
    startDate?: Date;
    endDate?: Date;
    category?: string;
    context?: 'chat' | 'optimization' | 'visual-compliance' | 'workflow' | 'api';
    templateId?: string;
}

interface TemplateUsageStats {
    totalTemplatesUsed: number;
    totalUsageCount: number;
    totalCostSaved: number;
    totalTokensSaved: number;
    averageTokenReduction: number;
    mostUsedTemplate: {
        id: string;
        name: string;
        usageCount: number;
    } | null;
    contextBreakdown: Array<{
        context: string;
        count: number;
        percentage: number;
    }>;
    categoryBreakdown: Array<{
        category: string;
        count: number;
        percentage: number;
    }>;
}

interface TemplateBreakdown {
    templateId: string;
    templateName: string;
    templateCategory: string;
    usageCount: number;
    totalCost: number;
    totalTokens: number;
    averageCost: number;
    averageTokens: number;
    contextUsage: Array<{
        context: string;
        count: number;
    }>;
    recentUsages: Array<{
        date: Date;
        cost: number;
        tokens: number;
        context: string;
    }>;
    variablesUsage: Array<{
        variableName: string;
        usageCount: number;
        commonValues: string[];
    }>;
}

interface TopTemplate {
    rank: number;
    templateId: string;
    templateName: string;
    templateCategory: string;
    usageCount: number;
    totalCost: number;
    totalTokens: number;
    averageCost: number;
    lastUsed: Date;
    costSavingsEstimate: number;
}

interface CostSavingsReport {
    totalSavings: number;
    savingsByTemplate: Array<{
        templateId: string;
        templateName: string;
        savings: number;
        usageCount: number;
        averageSavingsPerUse: number;
    }>;
    savingsByContext: Array<{
        context: string;
        savings: number;
        percentage: number;
    }>;
    projectedMonthlySavings: number;
    trend: 'increasing' | 'decreasing' | 'stable';
}

export class TemplateAnalyticsService {
    /**
     * Get overall template usage statistics
     */
    static async getTemplateUsageStats(
        userId: string,
        filters: TemplateUsageFilters = {}
    ): Promise<TemplateUsageStats> {
        try {
            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                'templateUsage.templateId': { $exists: true }
            };

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            if (filters.category) {
                matchStage['templateUsage.templateCategory'] = filters.category;
            }

            if (filters.context) {
                matchStage['templateUsage.context'] = filters.context;
            }

            if (filters.templateId) {
                matchStage['templateUsage.templateId'] = new mongoose.Types.ObjectId(filters.templateId);
            }

            // Aggregate all metrics in a single query
            const [stats] = await Usage.aggregate([
                { $match: matchStage },
                {
                    $facet: {
                        overview: [
                            {
                                $group: {
                                    _id: null,
                                    totalUsageCount: { $sum: 1 },
                                    uniqueTemplates: { $addToSet: '$templateUsage.templateId' },
                                    totalCost: { $sum: '$cost' },
                                    totalTokens: { $sum: '$totalTokens' }
                                }
                            }
                        ],
                        contextBreakdown: [
                            {
                                $group: {
                                    _id: '$templateUsage.context',
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { count: -1 } }
                        ],
                        categoryBreakdown: [
                            {
                                $group: {
                                    _id: '$templateUsage.templateCategory',
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { count: -1 } }
                        ],
                        mostUsed: [
                            {
                                $group: {
                                    _id: {
                                        templateId: '$templateUsage.templateId',
                                        templateName: '$templateUsage.templateName'
                                    },
                                    usageCount: { $sum: 1 }
                                }
                            },
                            { $sort: { usageCount: -1 } },
                            { $limit: 1 }
                        ]
                    }
                }
            ]);

            const overview = stats.overview[0] || {
                totalUsageCount: 0,
                uniqueTemplates: [],
                totalCost: 0,
                totalTokens: 0
            };

            const totalCount = overview.totalUsageCount;

            const contextBreakdown = stats.contextBreakdown.map((ctx: any) => ({
                context: ctx._id || 'unknown',
                count: ctx.count,
                percentage: totalCount > 0 ? (ctx.count / totalCount) * 100 : 0
            }));

            const categoryBreakdown = stats.categoryBreakdown.map((cat: any) => ({
                category: cat._id || 'unknown',
                count: cat.count,
                percentage: totalCount > 0 ? (cat.count / totalCount) * 100 : 0
            }));

            const mostUsed = stats.mostUsed[0];

            // Estimate cost and token savings (rough estimate: 10% savings)
            const estimatedSavingsRate = 0.1;
            const totalCostSaved = overview.totalCost * estimatedSavingsRate;
            const totalTokensSaved = overview.totalTokens * estimatedSavingsRate;

            return {
                totalTemplatesUsed: overview.uniqueTemplates.length,
                totalUsageCount: overview.totalUsageCount,
                totalCostSaved,
                totalTokensSaved,
                averageTokenReduction: totalTokensSaved / (overview.totalUsageCount || 1),
                mostUsedTemplate: mostUsed ? {
                    id: mostUsed._id.templateId.toString(),
                    name: mostUsed._id.templateName,
                    usageCount: mostUsed.usageCount
                } : null,
                contextBreakdown,
                categoryBreakdown
            };
        } catch (error) {
            loggingService.error('Error getting template usage stats:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get detailed breakdown for a specific template
     */
    static async getTemplateBreakdown(
        templateId: string,
        userId: string,
        filters: Omit<TemplateUsageFilters, 'templateId'> = {}
    ): Promise<TemplateBreakdown> {
        try {
            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                'templateUsage.templateId': new mongoose.Types.ObjectId(templateId)
            };

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            const [breakdown] = await Usage.aggregate([
                { $match: matchStage },
                {
                    $facet: {
                        summary: [
                            {
                                $group: {
                                    _id: null,
                                    usageCount: { $sum: 1 },
                                    totalCost: { $sum: '$cost' },
                                    totalTokens: { $sum: '$totalTokens' },
                                    templateName: { $first: '$templateUsage.templateName' },
                                    templateCategory: { $first: '$templateUsage.templateCategory' }
                                }
                            }
                        ],
                        contextUsage: [
                            {
                                $group: {
                                    _id: '$templateUsage.context',
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { count: -1 } }
                        ],
                        recentUsages: [
                            {
                                $project: {
                                    date: '$createdAt',
                                    cost: 1,
                                    tokens: '$totalTokens',
                                    context: '$templateUsage.context'
                                }
                            },
                            { $sort: { date: -1 } },
                            { $limit: 10 }
                        ],
                        variablesUsage: [
                            { $unwind: '$templateUsage.variablesResolved' },
                            {
                                $group: {
                                    _id: '$templateUsage.variablesResolved.variableName',
                                    usageCount: { $sum: 1 },
                                    values: { $addToSet: '$templateUsage.variablesResolved.value' }
                                }
                            },
                            { $sort: { usageCount: -1 } },
                            { $limit: 10 }
                        ]
                    }
                }
            ]);

            const summary = breakdown.summary[0] || {
                usageCount: 0,
                totalCost: 0,
                totalTokens: 0,
                templateName: 'Unknown',
                templateCategory: 'unknown'
            };

            const contextUsage = breakdown.contextUsage.map((ctx: any) => ({
                context: ctx._id || 'unknown',
                count: ctx.count
            }));

            const recentUsages = breakdown.recentUsages.map((usage: any) => ({
                date: usage.date,
                cost: usage.cost,
                tokens: usage.tokens,
                context: usage.context
            }));

            const variablesUsage = breakdown.variablesUsage.map((v: any) => ({
                variableName: v._id,
                usageCount: v.usageCount,
                commonValues: v.values.slice(0, 5) // Top 5 common values
            }));

            return {
                templateId,
                templateName: summary.templateName,
                templateCategory: summary.templateCategory,
                usageCount: summary.usageCount,
                totalCost: summary.totalCost,
                totalTokens: summary.totalTokens,
                averageCost: summary.usageCount > 0 ? summary.totalCost / summary.usageCount : 0,
                averageTokens: summary.usageCount > 0 ? summary.totalTokens / summary.usageCount : 0,
                contextUsage,
                recentUsages,
                variablesUsage
            };
        } catch (error) {
            loggingService.error('Error getting template breakdown:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get top templates by usage
     */
    static async getTopTemplates(
        userId: string,
        period: '24h' | '7d' | '30d' | '90d' = '30d',
        limit: number = 10
    ): Promise<TopTemplate[]> {
        try {
            const startDate = new Date();
            switch (period) {
                case '24h':
                    startDate.setHours(startDate.getHours() - 24);
                    break;
                case '7d':
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(startDate.getDate() - 30);
                    break;
                case '90d':
                    startDate.setDate(startDate.getDate() - 90);
                    break;
            }

            const topTemplates = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        'templateUsage.templateId': { $exists: true },
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$templateUsage.templateId',
                        templateName: { $first: '$templateUsage.templateName' },
                        templateCategory: { $first: '$templateUsage.templateCategory' },
                        usageCount: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        lastUsed: { $max: '$createdAt' }
                    }
                },
                { $sort: { usageCount: -1 } },
                { $limit: limit }
            ]);

            return topTemplates.map((template, index) => ({
                rank: index + 1,
                templateId: template._id.toString(),
                templateName: template.templateName,
                templateCategory: template.templateCategory,
                usageCount: template.usageCount,
                totalCost: template.totalCost,
                totalTokens: template.totalTokens,
                averageCost: template.usageCount > 0 ? template.totalCost / template.usageCount : 0,
                lastUsed: template.lastUsed,
                costSavingsEstimate: template.totalCost * 0.1 // 10% estimated savings
            }));
        } catch (error) {
            loggingService.error('Error getting top templates:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get cost savings report from template usage
     */
    static async getTemplateCostSavings(
        userId: string,
        period: '24h' | '7d' | '30d' | '90d' = '30d'
    ): Promise<CostSavingsReport> {
        try {
            const startDate = new Date();
            let days = 30;
            switch (period) {
                case '24h':
                    startDate.setHours(startDate.getHours() - 24);
                    days = 1;
                    break;
                case '7d':
                    startDate.setDate(startDate.getDate() - 7);
                    days = 7;
                    break;
                case '30d':
                    startDate.setDate(startDate.getDate() - 30);
                    days = 30;
                    break;
                case '90d':
                    startDate.setDate(startDate.getDate() - 90);
                    days = 90;
                    break;
            }

            const [savings] = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        'templateUsage.templateId': { $exists: true },
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $facet: {
                        byTemplate: [
                            {
                                $group: {
                                    _id: '$templateUsage.templateId',
                                    templateName: { $first: '$templateUsage.templateName' },
                                    totalCost: { $sum: '$cost' },
                                    usageCount: { $sum: 1 }
                                }
                            },
                            { $sort: { totalCost: -1 } }
                        ],
                        byContext: [
                            {
                                $group: {
                                    _id: '$templateUsage.context',
                                    totalCost: { $sum: '$cost' }
                                }
                            }
                        ],
                        overall: [
                            {
                                $group: {
                                    _id: null,
                                    totalCost: { $sum: '$cost' }
                                }
                            }
                        ]
                    }
                }
            ]);

            const estimatedSavingsRate = 0.1; // 10% savings estimate
            const totalCost = savings.overall[0]?.totalCost || 0;
            const totalSavings = totalCost * estimatedSavingsRate;

            const savingsByTemplate = savings.byTemplate.map((t: any) => ({
                templateId: t._id.toString(),
                templateName: t.templateName,
                savings: t.totalCost * estimatedSavingsRate,
                usageCount: t.usageCount,
                averageSavingsPerUse: (t.totalCost * estimatedSavingsRate) / t.usageCount
            }));

            const totalContextCost = savings.byContext.reduce((sum: number, ctx: any) => sum + ctx.totalCost, 0);
            const savingsByContext = savings.byContext.map((ctx: any) => ({
                context: ctx._id || 'unknown',
                savings: ctx.totalCost * estimatedSavingsRate,
                percentage: totalContextCost > 0 ? (ctx.totalCost / totalContextCost) * 100 : 0
            }));

            // Calculate monthly projection
            const projectedMonthlySavings = (totalSavings / days) * 30;

            // Determine trend (simplified - would need historical data for accurate trend)
            const trend: 'increasing' | 'decreasing' | 'stable' = 'stable';

            return {
                totalSavings,
                savingsByTemplate,
                savingsByContext,
                projectedMonthlySavings,
                trend
            };
        } catch (error) {
            loggingService.error('Error getting template cost savings:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get templates by context usage
     */
    static async getTemplatesByContext(
        userId: string,
        context: 'chat' | 'optimization' | 'visual-compliance' | 'workflow' | 'api',
        filters: Omit<TemplateUsageFilters, 'context'> = {}
    ): Promise<Array<{
        templateId: string;
        templateName: string;
        templateCategory: string;
        usageCount: number;
        totalCost: number;
        averageCost: number;
    }>> {
        try {
            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                'templateUsage.templateId': { $exists: true },
                'templateUsage.context': context
            };

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            if (filters.category) {
                matchStage['templateUsage.templateCategory'] = filters.category;
            }

            const templates = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$templateUsage.templateId',
                        templateName: { $first: '$templateUsage.templateName' },
                        templateCategory: { $first: '$templateUsage.templateCategory' },
                        usageCount: { $sum: 1 },
                        totalCost: { $sum: '$cost' }
                    }
                },
                { $sort: { usageCount: -1 } }
            ]);

            return templates.map(t => ({
                templateId: t._id.toString(),
                templateName: t.templateName,
                templateCategory: t.templateCategory,
                usageCount: t.usageCount,
                totalCost: t.totalCost,
                averageCost: t.usageCount > 0 ? t.totalCost / t.usageCount : 0
            }));
        } catch (error) {
            loggingService.error('Error getting templates by context:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

