import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface ModelComparison {
    model: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    averageResponseTime: number;
    averageCostPerRequest: number;
    averageTokensPerRequest: number;
    efficiencyScore: number;
    costPerToken: number;
    tokensPerDollar: number;
    requestsPerDollar: number;
}

export interface ServiceComparison {
    service: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    averageResponseTime: number;
    averageCostPerRequest: number;
    averageTokensPerRequest: number;
    efficiencyScore: number;
    uniqueModels: string[];
    costPerToken: number;
    tokensPerDollar: number;
    requestsPerDollar: number;
}

export interface AdminModelComparisonFilters {
    startDate?: Date;
    endDate?: Date;
    service?: string;
    userId?: string;
}

export class AdminModelComparisonService {
    /**
     * Get model comparison statistics
     */
    static async getModelComparison(
        filters: AdminModelComparisonFilters = {}
    ): Promise<ModelComparison[]> {
        try {
            const matchStage: any = {};

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            if (filters.service) {
                matchStage.service = filters.service;
            }

            if (filters.userId) {
                matchStage.userId = new mongoose.Types.ObjectId(filters.userId);
            }

            // Aggregate by model
            const modelStats = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$model',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                        totalResponseTime: { $sum: '$responseTime' },
                        costs: { $push: '$cost' }
                    }
                },
                {
                    $project: {
                        model: '$_id',
                        totalCost: 1,
                        totalTokens: 1,
                        totalRequests: 1,
                        errorCount: 1,
                        errorRate: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$errorCount', '$totalRequests'] },
                                0
                            ]
                        },
                        averageResponseTime: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$totalResponseTime', '$totalRequests'] },
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

            // Calculate efficiency metrics
            const comparisons: ModelComparison[] = modelStats.map((stat: any) => {
                const costPerToken = stat.totalTokens > 0 ? stat.totalCost / stat.totalTokens : 0;
                const tokensPerDollar = stat.totalCost > 0 ? stat.totalTokens / stat.totalCost : 0;
                const requestsPerDollar = stat.totalCost > 0 ? stat.totalRequests / stat.totalCost : 0;

                // Efficiency score: Higher is better (normalize tokens/$ and requests/$)
                // Score = (tokensPerDollar / maxTokensPerDollar) * 0.6 + (requestsPerDollar / maxRequestsPerDollar) * 0.4 - (errorRate * 100)
                // For now, use a simpler formula
                const efficiencyScore = Math.max(0, 
                    (tokensPerDollar / 10000) * 40 + 
                    (requestsPerDollar / 100) * 40 - 
                    (stat.errorRate * 20)
                );

                return {
                    model: stat.model || 'Unknown',
                    totalCost: stat.totalCost || 0,
                    totalTokens: stat.totalTokens || 0,
                    totalRequests: stat.totalRequests || 0,
                    errorCount: stat.errorCount || 0,
                    errorRate: stat.errorRate || 0,
                    averageResponseTime: stat.averageResponseTime || 0,
                    averageCostPerRequest: stat.averageCostPerRequest || 0,
                    averageTokensPerRequest: stat.averageTokensPerRequest || 0,
                    efficiencyScore: Math.round(efficiencyScore * 100) / 100,
                    costPerToken,
                    tokensPerDollar: Math.round(tokensPerDollar),
                    requestsPerDollar: Math.round(requestsPerDollar * 100) / 100
                };
            });

            return comparisons.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting model comparison:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminModelComparisonService',
                operation: 'getModelComparison'
            });
            throw error;
        }
    }

    /**
     * Get service comparison statistics
     */
    static async getServiceComparison(
        filters: AdminModelComparisonFilters = {}
    ): Promise<ServiceComparison[]> {
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

            // Aggregate by service
            const serviceStats = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$service',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                        totalResponseTime: { $sum: '$responseTime' },
                        models: { $addToSet: '$model' }
                    }
                },
                {
                    $project: {
                        service: '$_id',
                        totalCost: 1,
                        totalTokens: 1,
                        totalRequests: 1,
                        errorCount: 1,
                        errorRate: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$errorCount', '$totalRequests'] },
                                0
                            ]
                        },
                        averageResponseTime: {
                            $cond: [
                                { $gt: ['$totalRequests', 0] },
                                { $divide: ['$totalResponseTime', '$totalRequests'] },
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
                        },
                        uniqueModels: 1
                    }
                }
            ]);

            // Calculate efficiency metrics
            const comparisons: ServiceComparison[] = serviceStats.map((stat: any) => {
                const costPerToken = stat.totalTokens > 0 ? stat.totalCost / stat.totalTokens : 0;
                const tokensPerDollar = stat.totalCost > 0 ? stat.totalTokens / stat.totalCost : 0;
                const requestsPerDollar = stat.totalCost > 0 ? stat.totalRequests / stat.totalCost : 0;

                const efficiencyScore = Math.max(0, 
                    (tokensPerDollar / 10000) * 40 + 
                    (requestsPerDollar / 100) * 40 - 
                    (stat.errorRate * 20)
                );

                return {
                    service: stat.service || 'Unknown',
                    totalCost: stat.totalCost || 0,
                    totalTokens: stat.totalTokens || 0,
                    totalRequests: stat.totalRequests || 0,
                    errorCount: stat.errorCount || 0,
                    errorRate: stat.errorRate || 0,
                    averageResponseTime: stat.averageResponseTime || 0,
                    averageCostPerRequest: stat.averageCostPerRequest || 0,
                    averageTokensPerRequest: stat.averageTokensPerRequest || 0,
                    efficiencyScore: Math.round(efficiencyScore * 100) / 100,
                    uniqueModels: stat.uniqueModels || [],
                    costPerToken,
                    tokensPerDollar: Math.round(tokensPerDollar),
                    requestsPerDollar: Math.round(requestsPerDollar * 100) / 100
                };
            });

            return comparisons.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting service comparison:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminModelComparisonService',
                operation: 'getServiceComparison'
            });
            throw error;
        }
    }

    /**
     * Calculate efficiency score for a model or service
     */
    static calculateEfficiencyScore(
        tokensPerDollar: number,
        requestsPerDollar: number,
        errorRate: number
    ): number {
        // Normalize and weight metrics
        const tokenScore = Math.min(1, tokensPerDollar / 10000) * 0.4;
        const requestScore = Math.min(1, requestsPerDollar / 100) * 0.4;
        const errorPenalty = errorRate * 0.2;

        return Math.max(0, Math.min(100, (tokenScore + requestScore - errorPenalty) * 100));
    }
}

