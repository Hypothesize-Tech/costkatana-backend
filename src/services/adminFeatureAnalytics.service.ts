import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface FeatureUsageStats {
    feature: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    uniqueUsers: number;
    averageCostPerRequest: number;
    averageTokensPerRequest: number;
    errorCount: number;
    errorRate: number;
}

export interface FeatureAdoption {
    feature: string;
    totalUsers: number;
    activeUsers: number;
    adoptionRate: number;
    growthRate: number;
}

export interface FeatureCostAnalysis {
    feature: string;
    totalCost: number;
    percentageOfTotal: number;
    averageCostPerUser: number;
    trend: 'increasing' | 'decreasing' | 'stable';
}

export class AdminFeatureAnalyticsService {
    /**
     * Get feature usage statistics
     */
    static async getFeatureUsageStats(
        filters: {
            startDate?: Date;
            endDate?: Date;
            userId?: string;
        } = {}
    ): Promise<FeatureUsageStats[]> {
        try {
            const matchStage: any = {};

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            if (filters.userId) {
                matchStage.userId = new mongoose.Types.ObjectId(filters.userId);
            }

            // Group by feature (extracted from metadata.endpoint)
            const featureStats = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            $cond: [
                                { $ne: ['$metadata.endpoint', null] },
                                {
                                    $switch: {
                                        branches: [
                                            {
                                                case: {
                                                    $or: [
                                                        { $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'chat|agent' } },
                                                        { $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: '/api/chat' } }
                                                    ]
                                                },
                                                then: 'Chat'
                                            },
                                            {
                                                case: {
                                                    $or: [
                                                        { $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'experimentation|what-if' } },
                                                        { $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: '/api/experimentation' } }
                                                    ]
                                                },
                                                then: 'Experimentation'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'gateway' }
                                                },
                                                then: 'Gateway'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'integration' }
                                                },
                                                then: 'Integration'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'workflow' }
                                                },
                                                then: 'Workflow'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'optimization' }
                                                },
                                                then: 'Optimization'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'analytics' }
                                                },
                                                then: 'Analytics'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'notebook' }
                                                },
                                                then: 'Notebook'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'template' }
                                                },
                                                then: 'Template'
                                            },
                                            {
                                                case: {
                                                    $regexMatch: { input: { $toLower: '$metadata.endpoint' }, regex: 'intelligence|predictive' }
                                                },
                                                then: 'Intelligence'
                                            }
                                        ],
                                        default: 'Other'
                                    }
                                },
                                'Other'
                            ]
                        },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                        userIds: { $addToSet: '$userId' }
                    }
                },
                {
                    $project: {
                        feature: '$_id',
                        totalCost: 1,
                        totalTokens: 1,
                        totalRequests: 1,
                        errorCount: 1,
                        uniqueUsers: { $size: '$userIds' },
                        errorRate: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$errorCount', '$totalRequests'] },
                                0
                            ]
                        },
                        averageCostPerRequest: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$totalCost', '$totalRequests'] },
                                0
                            ]
                        },
                        averageTokensPerRequest: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$totalTokens', '$totalRequests'] },
                                0
                            ]
                        }
                    }
                }
            ]);

            return featureStats.map((stat: any) => ({
                feature: stat.feature || 'Other',
                totalCost: stat.totalCost || 0,
                totalTokens: stat.totalTokens || 0,
                totalRequests: stat.totalRequests || 0,
                uniqueUsers: stat.uniqueUsers || 0,
                averageCostPerRequest: stat.averageCostPerRequest || 0,
                averageTokensPerRequest: stat.averageTokensPerRequest || 0,
                errorCount: stat.errorCount || 0,
                errorRate: stat.errorRate || 0
            })).sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting feature usage stats:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminFeatureAnalyticsService',
                operation: 'getFeatureUsageStats'
            });
            throw error;
        }
    }

    /**
     * Get feature adoption rates
     */
    static async getFeatureAdoptionRates(
        filters: {
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<FeatureAdoption[]> {
        try {
            const matchStage: any = {};

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            // Get total users
            const totalUsers = await Usage.distinct('userId', matchStage).then(ids => ids.length);

            // Get feature usage by period for growth calculation
            const now = new Date();
            const previousPeriodStart = new Date(now.getTime() - (now.getTime() - (filters.startDate?.getTime() || now.getTime() - 30 * 24 * 60 * 60 * 1000)));

            const getFeatureFromEndpoint = (endpoint: string | null | undefined): string => {
                if (!endpoint) return 'Other';
                const normalized = endpoint.toLowerCase();
                if (normalized.includes('/chat') || normalized.includes('/agent') || normalized.includes('chat')) return 'Chat';
                if (normalized.includes('/experimentation') || normalized.includes('/what-if') || normalized.includes('experimentation')) return 'Experimentation';
                if (normalized.includes('/gateway') || normalized.includes('gateway')) return 'Gateway';
                if (normalized.includes('/integration') || normalized.includes('integration')) return 'Integration';
                if (normalized.includes('/workflow') || normalized.includes('workflow')) return 'Workflow';
                if (normalized.includes('/optimization') || normalized.includes('optimization')) return 'Optimization';
                if (normalized.includes('/analytics') || normalized.includes('analytics')) return 'Analytics';
                if (normalized.includes('/notebook') || normalized.includes('notebook')) return 'Notebook';
                if (normalized.includes('/template') || normalized.includes('template')) return 'Template';
                if (normalized.includes('/intelligence') || normalized.includes('/predictive') || normalized.includes('intelligence') || normalized.includes('predictive')) return 'Intelligence';
                return 'Other';
            };

            const currentData = await Usage.find({
                ...matchStage,
                createdAt: { $gte: filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
            }).lean();

            const currentFeatureMap = new Map<string, Set<string>>();
            for (const usage of currentData) {
                const feature = getFeatureFromEndpoint(usage.metadata?.endpoint as string);
                if (!currentFeatureMap.has(feature)) {
                    currentFeatureMap.set(feature, new Set());
                }
                if (usage.userId) {
                    currentFeatureMap.get(feature)!.add(usage.userId.toString());
                }
            }

            const previousData = await Usage.find({
                createdAt: { $gte: previousPeriodStart, $lt: filters.startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
            }).lean();

            const previousFeatureMap = new Map<string, Set<string>>();
            for (const usage of previousData) {
                const feature = getFeatureFromEndpoint(usage.metadata?.endpoint as string);
                if (!previousFeatureMap.has(feature)) {
                    previousFeatureMap.set(feature, new Set());
                }
                if (usage.userId) {
                    previousFeatureMap.get(feature)!.add(usage.userId.toString());
                }
            }

            const currentFeatureUsers = Array.from(currentFeatureMap.entries()).map(([feature, userIds]) => ({
                _id: feature,
                userIds: Array.from(userIds)
            }));

            const previousFeatureUsers = Array.from(previousFeatureMap.entries()).map(([feature, userIds]) => ({
                _id: feature,
                userIds: Array.from(userIds)
            }));

            const currentMap = new Map(currentFeatureUsers.map((f: any) => [f._id, f.userIds.length]));
            const previousMap = new Map(previousFeatureUsers.map((f: any) => [f._id, f.userIds.length]));

            const adoptions: FeatureAdoption[] = [];

            for (const item of currentFeatureUsers) {
                const feature = item._id || 'Other';
                const activeUsers = item.userIds.length;
                const previousActive = previousMap.get(feature) || 0;
                const growthRate = previousActive > 0 
                    ? ((activeUsers - previousActive) / previousActive) * 100 
                    : activeUsers > 0 ? 100 : 0;

                adoptions.push({
                    feature,
                    totalUsers,
                    activeUsers,
                    adoptionRate: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0,
                    growthRate: Math.round(growthRate * 100) / 100
                });
            }

            return adoptions.sort((a, b) => b.activeUsers - a.activeUsers);
        } catch (error) {
            loggingService.error('Error getting feature adoption rates:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminFeatureAnalyticsService',
                operation: 'getFeatureAdoptionRates'
            });
            throw error;
        }
    }

    /**
     * Get feature cost analysis
     */
    static async getFeatureCostAnalysis(
        filters: {
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<FeatureCostAnalysis[]> {
        try {
            const usageStats = await this.getFeatureUsageStats(filters);

            const totalCost = usageStats.reduce((sum, stat) => sum + stat.totalCost, 0);

            // Get previous period for trend analysis
            const now = new Date();
            const periodDuration = filters.endDate && filters.startDate
                ? filters.endDate.getTime() - filters.startDate.getTime()
                : 30 * 24 * 60 * 60 * 1000;

            const previousStart = new Date((filters.startDate?.getTime() || now.getTime()) - periodDuration);
            const previousEnd = filters.startDate || new Date(now.getTime() - periodDuration);
            const previousStats = await this.getFeatureUsageStats({
                startDate: previousStart,
                endDate: previousEnd
            });

            const previousCostMap = new Map(previousStats.map(s => [s.feature, s.totalCost]));

            const analysis: FeatureCostAnalysis[] = usageStats.map(stat => {
                const previousCost = previousCostMap.get(stat.feature) || 0;
                let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
                
                if (previousCost > 0) {
                    const changePercent = ((stat.totalCost - previousCost) / previousCost) * 100;
                    if (changePercent > 10) trend = 'increasing';
                    else if (changePercent < -10) trend = 'decreasing';
                } else if (stat.totalCost > 0) {
                    trend = 'increasing';
                }

                return {
                    feature: stat.feature,
                    totalCost: stat.totalCost,
                    percentageOfTotal: totalCost > 0 ? (stat.totalCost / totalCost) * 100 : 0,
                    averageCostPerUser: stat.uniqueUsers > 0 ? stat.totalCost / stat.uniqueUsers : 0,
                    trend
                };
            });

            return analysis.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting feature cost analysis:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminFeatureAnalyticsService',
                operation: 'getFeatureCostAnalysis'
            });
            throw error;
        }
    }
}

