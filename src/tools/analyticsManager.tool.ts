import { Tool } from "@langchain/core/tools";
import { Usage } from "../models/Usage";
import { Optimization } from "../models/Optimization";
import { loggingService } from '../services/logging.service';

interface AnalyticsOperation {
    operation: 'dashboard' | 'cost_trends' | 'usage_patterns' | 'model_performance' | 'project_analytics' | 'user_stats' | 'comparative_analysis' | 'forecasting' | 'anomaly_detection' | 'token_usage';
    userId?: string;
    projectId?: string;
    timeRange?: {
        startDate?: string;
        endDate?: string;
        period?: 'day' | 'week' | 'month' | 'quarter' | 'year';
    };
    filters?: {
        models?: string[];
        providers?: string[];
        tags?: string[];
    };
    comparison?: {
        compareWith?: 'previous_period' | 'other_project' | 'baseline';
        referenceId?: string;
    };
}

export class AnalyticsManagerTool extends Tool {
    name = "analytics_manager";
    description = `Comprehensive analytics and reporting tool that provides insights into AI costs, usage patterns, and performance metrics.
    
    This tool can:
    - Generate dashboard analytics and KPIs
    - Analyze cost trends and spending patterns
    - Track usage patterns across models and projects
    - Compare model performance and efficiency
    - Provide project-specific analytics
    - Generate user statistics and insights
    - Perform comparative analysis between time periods
    - Detect cost anomalies and unusual patterns
    - Forecast future costs and usage
    
    Input should be a JSON string with:
    {{
        "operation": "dashboard|cost_trends|usage_patterns|model_performance|project_analytics|user_stats|comparative_analysis|forecasting|anomaly_detection",
        "userId": "user-id-string",
        "projectId": "project-id" (optional, for project-specific analytics),
        "timeRange": {{
            "startDate": "2024-01-01",
            "endDate": "2024-01-31",
            "period": "month"
        }},
        "filters": {{
            "models": ["gpt-4", "claude-3-sonnet"],
            "providers": ["OpenAI", "Anthropic"],
            "tags": ["production", "testing"]
        }},
        "comparison": {{
            "compareWith": "previous_period",
            "referenceId": "reference-project-id"
        }}
    }}`;

    async _call(input: string): Promise<string> {
        try {
            const operation: AnalyticsOperation = JSON.parse(input);
            
            if (!this.isValidOperation(operation)) {
                return "Invalid operation: Check operation type and required fields.";
            }

            switch (operation.operation) {
                case 'dashboard':
                    return await this.getDashboardAnalytics(operation);
                case 'cost_trends':
                    return await this.getCostTrends(operation);
                case 'usage_patterns':
                    return await this.getUsagePatterns(operation);
                case 'model_performance':
                    return await this.getModelPerformance(operation);
                case 'project_analytics':
                    return await this.getProjectAnalytics(operation);
                case 'user_stats':
                    return await this.getUserStats(operation);
                case 'comparative_analysis':
                    return await this.getComparativeAnalysis(operation);
                case 'forecasting':
                    return await this.getForecastingData(operation);
                case 'anomaly_detection':
                    return await this.detectAnomalies(operation);
                case 'token_usage':
                    return await this.getTokenUsage(operation);
                default:
                    return "Unsupported operation.";
            }

        } catch (error) {
            loggingService.error('Analytics operation failed', {
                component: 'analyticsManagerTool',
                operation: '_call',
                step: 'error',
                error: error instanceof Error ? error.message : String(error),
                errorType: error instanceof SyntaxError ? 'SyntaxError' : 'Unknown'
            });
            
            if (error instanceof SyntaxError) {
                return "Invalid JSON input. Please provide a valid operation object.";
            }
            
            return `Analytics error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async getDashboardAnalytics(operation: AnalyticsOperation): Promise<string> {
        try {
            // Use broader time range to capture more data - default to last 30 days
            const timeRange = operation.timeRange ? 
                this.getTimeRange(operation.timeRange) : 
                {
                    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
                    end: new Date()
                };
            
            const userId = operation.userId;

            // Get overall statistics
            const totalUsage = await Usage.countDocuments({
                userId: new (require('mongoose')).Types.ObjectId(userId),
                createdAt: { $gte: timeRange.start, $lte: timeRange.end }
            });

            const costAggregation = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose').Types.ObjectId)(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: { $add: ['$promptTokens', '$completionTokens'] } },
                        avgCostPerRequest: { $avg: '$cost' },
                        uniqueModels: { $addToSet: '$model' },
                        uniqueProviders: { $addToSet: '$provider' }
                    }
                }
            ]);

            const costData = costAggregation[0] || {
                totalCost: 0,
                totalTokens: 0,
                avgCostPerRequest: 0,
                uniqueModels: [],
                uniqueProviders: []
            };

            // If no data in current timeRange, try last 90 days
            if (totalUsage === 0) {
                const extendedTimeRange = {
                    start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                    end: new Date()
                };

                const extendedUsage = await Usage.countDocuments({
                    userId: new (require('mongoose')).Types.ObjectId(userId),
                    createdAt: { $gte: extendedTimeRange.start, $lte: extendedTimeRange.end }
                });

                if (extendedUsage > 0) {
                    return JSON.stringify({
                        success: true,
                        operation: 'dashboard_analytics',
                        data: {
                            message: `I found ${extendedUsage} API requests in your extended history (last 90 days). Let me get detailed analytics for you.`,
                            totalRequests: extendedUsage,
                            suggestion: "Would you like me to analyze your usage patterns from the past 90 days?"
                        }
                    }, null, 2);
                }
            }

            // Get top models by usage
            const topModels = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: '$model',
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgCost: { $avg: '$cost' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]);

            // Get recent optimizations
            const recentOptimizations = await Optimization.find({
                userId: new (require('mongoose')).Types.ObjectId(userId),
                createdAt: { $gte: timeRange.start }
            })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('category costSaved applied createdAt');

            const dashboard = {
                summary: {
                    totalRequests: totalUsage,
                    totalCost: Number(costData.totalCost?.toFixed(4) || 0),
                    totalTokens: costData.totalTokens,
                    avgCostPerRequest: Number(costData.avgCostPerRequest?.toFixed(6) || 0),
                    uniqueModels: costData.uniqueModels?.length || 0,
                    uniqueProviders: costData.uniqueProviders?.length || 0
                },
                topModels: topModels.map(model => ({
                    model: model._id,
                    requests: model.count,
                    totalCost: Number(model.totalCost?.toFixed(4) || 0),
                    avgCost: Number(model.avgCost?.toFixed(6) || 0)
                })),
                recentOptimizations: recentOptimizations.map(opt => ({
                    type: opt.category,
                    estimatedSavings: opt.costSaved,
                    status: opt.applied ? 'applied' : 'pending',
                    date: opt.createdAt
                })),
                timeRange: {
                    start: timeRange.start,
                    end: timeRange.end,
                    period: operation.timeRange?.period || 'month'
                }
            };

            return JSON.stringify({
                success: true,
                operation: 'dashboard_analytics',
                data: dashboard,
                insights: this.generateDashboardInsights(dashboard)
            }, null, 2);

        } catch (error) {
            return `Failed to get dashboard analytics: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async getCostTrends(operation: AnalyticsOperation): Promise<string> {
        try {
            const timeRange = this.getTimeRange(operation.timeRange);
            const userId = operation.userId;

            // Daily cost trends
            const costTrends = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$timestamp' },
                            month: { $month: '$timestamp' },
                            day: { $dayOfMonth: '$timestamp' }
                        },
                        dailyCost: { $sum: '$cost' },
                        dailyRequests: { $sum: 1 },
                        dailyTokens: { $sum: { $add: ['$promptTokens', '$completionTokens'] } }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ]);

            // Cost by provider trends
            const providerTrends = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: {
                            provider: '$provider',
                            date: {
                                year: { $year: '$timestamp' },
                                month: { $month: '$timestamp' },
                                day: { $dayOfMonth: '$timestamp' }
                            }
                        },
                        cost: { $sum: '$cost' },
                        requests: { $sum: 1 }
                    }
                },
                { $sort: { '_id.date.year': 1, '_id.date.month': 1, '_id.date.day': 1 } }
            ]);

            const trends = {
                dailyTrends: costTrends.map(trend => ({
                    date: `${trend._id.year}-${String(trend._id.month).padStart(2, '0')}-${String(trend._id.day).padStart(2, '0')}`,
                    cost: Number(trend.dailyCost?.toFixed(4) || 0),
                    requests: trend.dailyRequests,
                    tokens: trend.dailyTokens,
                    avgCostPerRequest: Number((trend.dailyCost / trend.dailyRequests)?.toFixed(6) || 0)
                })),
                providerTrends: this.groupProviderTrends(providerTrends),
                summary: {
                    totalDays: costTrends.length,
                    avgDailyCost: costTrends.length > 0 ? 
                        Number((costTrends.reduce((sum, day) => sum + day.dailyCost, 0) / costTrends.length).toFixed(4)) : 0,
                    highestDay: costTrends.length > 0 ? 
                        costTrends.reduce((max, day) => day.dailyCost > max.dailyCost ? day : max) : null,
                    lowestDay: costTrends.length > 0 ? 
                        costTrends.reduce((min, day) => day.dailyCost < min.dailyCost ? day : min) : null
                }
            };

            return JSON.stringify({
                success: true,
                operation: 'cost_trends',
                data: trends,
                insights: this.generateTrendInsights(trends)
            }, null, 2);

        } catch (error) {
            return `Failed to get cost trends: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async getModelPerformance(operation: AnalyticsOperation): Promise<string> {
        try {
            // Use broader time range to capture more data - default to last 3 months
            const timeRange = operation.timeRange ? 
                this.getTimeRange(operation.timeRange) : 
                {
                    start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 3 months ago
                    end: new Date()
                };
            
            const userId = operation.userId;

            const modelPerformance = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose').Types.ObjectId)(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: {
                            model: '$model',
                            provider: '$provider'
                        },
                        totalRequests: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgCost: { $avg: '$cost' },
                        totalTokens: { $sum: { $add: ['$promptTokens', '$completionTokens'] } },
                        avgTokens: { $avg: { $add: ['$promptTokens', '$completionTokens'] } },
                        avgResponseTime: { $avg: '$responseTime' },
                        errorCount: {
                            $sum: {
                                $cond: [
                                    { $or: [{ $eq: ['$status', 'error'] }, { $eq: ['$status', 'failed'] }] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                },
                {
                    $addFields: {
                        successRate: {
                            $multiply: [
                                {
                                    $divide: [
                                        { $subtract: ['$totalRequests', '$errorCount'] },
                                        '$totalRequests'
                                    ]
                                },
                                100
                            ]
                        },
                        costPerToken: { $divide: ['$totalCost', '$totalTokens'] },
                        efficiency: {
                            $divide: [
                                { $subtract: ['$totalRequests', '$errorCount'] },
                                '$totalCost'
                            ]
                        }
                    }
                },
                { $sort: { totalRequests: -1 } }
            ]);

            const performance = {
                models: modelPerformance.map(model => ({
                    model: model._id.model,
                    provider: model._id.provider,
                    totalRequests: model.totalRequests,
                    totalCost: Number(model.totalCost?.toFixed(4) || 0),
                    avgCost: Number(model.avgCost?.toFixed(6) || 0),
                    totalTokens: model.totalTokens,
                    avgTokens: Math.round(model.avgTokens || 0),
                    avgResponseTime: Math.round(model.avgResponseTime || 0),
                    successRate: Number(model.successRate?.toFixed(2) || 100),
                    costPerToken: Number(model.costPerToken?.toFixed(8) || 0),
                    efficiency: Number(model.efficiency?.toFixed(2) || 0)
                })),
                rankings: {
                    mostUsed: modelPerformance[0]?._id.model || 'N/A',
                    mostCostEffective: modelPerformance
                        .sort((a, b) => (a.costPerToken || 0) - (b.costPerToken || 0))[0]?._id.model || 'N/A',
                    fastest: modelPerformance
                        .sort((a, b) => (a.avgResponseTime || 0) - (b.avgResponseTime || 0))[0]?._id.model || 'N/A',
                    mostReliable: modelPerformance
                        .sort((a, b) => (b.successRate || 0) - (a.successRate || 0))[0]?._id.model || 'N/A'
                }
            };

            return JSON.stringify({
                success: true,
                operation: 'model_performance',
                data: performance,
                insights: this.generateModelInsights(performance)
            }, null, 2);

        } catch (error) {
            return `Failed to get model performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async detectAnomalies(operation: AnalyticsOperation): Promise<string> {
        try {
            const timeRange = this.getTimeRange(operation.timeRange);
            const userId = operation.userId;

            // Get historical average for comparison
            const historicalData = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { 
                            $gte: new Date(timeRange.start.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days before
                            $lt: timeRange.start
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgDailyCost: { $avg: '$cost' },
                        avgTokens: { $avg: { $add: ['$promptTokens', '$completionTokens'] } },
                        avgResponseTime: { $avg: '$responseTime' }
                    }
                }
            ]);

            const baseline = historicalData[0] || {
                avgDailyCost: 0,
                avgTokens: 0,
                avgResponseTime: 0
            };

            // Detect cost anomalies
            const costAnomalies = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end },
                        cost: { $gt: baseline.avgDailyCost * 3 } // 3x higher than average
                    }
                },
                {
                    $project: {
                        createdAt: 1,
                        cost: 1,
                        model: 1,
                        provider: 1,
                        anomalyScore: { $divide: ['$cost', baseline.avgDailyCost] }
                    }
                },
                { $sort: { anomalyScore: -1 } },
                { $limit: 10 }
            ]);

            // Detect usage spikes
            const usageSpikes = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$timestamp' },
                            month: { $month: '$timestamp' },
                            day: { $dayOfMonth: '$timestamp' },
                            hour: { $hour: '$timestamp' }
                        },
                        hourlyRequests: { $sum: 1 },
                        hourlyCost: { $sum: '$cost' }
                    }
                },
                {
                    $match: {
                        $or: [
                            { hourlyRequests: { $gt: 100 } }, // More than 100 requests per hour
                            { hourlyCost: { $gt: baseline.avgDailyCost } } // Cost spike
                        ]
                    }
                },
                { $sort: { hourlyRequests: -1 } },
                { $limit: 10 }
            ]);

            const anomalies = {
                costAnomalies: costAnomalies.map(anomaly => ({
                    timestamp: anomaly.createdAt,
                    cost: Number(anomaly.cost?.toFixed(4) || 0),
                    model: anomaly.model,
                    provider: anomaly.provider,
                    anomalyScore: Number(anomaly.anomalyScore?.toFixed(2) || 0),
                    severity: this.getAnomalySeverity(anomaly.anomalyScore || 0)
                })),
                usageSpikes: usageSpikes.map(spike => ({
                    date: `${spike._id.year}-${String(spike._id.month).padStart(2, '0')}-${String(spike._id.day).padStart(2, '0')}`,
                    hour: spike._id.hour,
                    requests: spike.hourlyRequests,
                    cost: Number(spike.hourlyCost?.toFixed(4) || 0),
                    type: spike.hourlyRequests > 100 ? 'usage_spike' : 'cost_spike'
                })),
                summary: {
                    totalAnomalies: costAnomalies.length + usageSpikes.length,
                    highSeverityCount: costAnomalies.filter(a => (a.anomalyScore || 0) > 5).length,
                    recommendations: this.generateAnomalyRecommendations(costAnomalies, usageSpikes)
                }
            };

            return JSON.stringify({
                success: true,
                operation: 'anomaly_detection',
                data: anomalies,
                insights: this.generateAnomalyInsights(anomalies)
            }, null, 2);

        } catch (error) {
            return `Failed to detect anomalies: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    // Helper methods
    private getTimeRange(timeRange?: any) {
        const end = timeRange?.endDate ? new Date(timeRange.endDate) : new Date();
        let start: Date;

        if (timeRange?.startDate) {
            start = new Date(timeRange.startDate);
        } else {
            // Default to last 30 days
            start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        return { start, end };
    }

    private generateDashboardInsights(dashboard: any): string[] {
        const insights = [];
        
        if (dashboard.summary.totalCost > 100) {
            insights.push(`High spending detected: $${dashboard.summary.totalCost} this period`);
        }
        
        if (dashboard.summary.avgCostPerRequest > 0.01) {
            insights.push(`Average cost per request is $${dashboard.summary.avgCostPerRequest} - consider model optimization`);
        }
        
        if (dashboard.topModels.length > 0) {
            insights.push(`Most used model: ${dashboard.topModels[0].model} with ${dashboard.topModels[0].requests} requests`);
        }

        return insights;
    }

    private generateTrendInsights(trends: any): string[] {
        const insights = [];
        
        if (trends.summary.highestDay && trends.summary.lowestDay) {
            const variance = trends.summary.highestDay.dailyCost - trends.summary.lowestDay.dailyCost;
            if (variance > trends.summary.avgDailyCost) {
                insights.push(`High cost variance detected: ${variance.toFixed(2)} difference between highest and lowest days`);
            }
        }

        return insights;
    }

    private generateModelInsights(performance: any): string[] {
        const insights = [];
        
        if (performance.models.length > 0) {
            const mostExpensive = performance.models.sort((a: any, b: any) => b.costPerToken - a.costPerToken)[0];
            insights.push(`Most expensive model per token: ${mostExpensive.model} at $${mostExpensive.costPerToken} per token`);
        }

        return insights;
    }

    private generateAnomalyInsights(anomalies: any): string[] {
        const insights = [];
        
        if (anomalies.costAnomalies.length > 0) {
            insights.push(`Found ${anomalies.costAnomalies.length} cost anomalies requiring attention`);
        }
        
        if (anomalies.usageSpikes.length > 0) {
            insights.push(`Detected ${anomalies.usageSpikes.length} usage spikes in the analyzed period`);
        }

        return insights;
    }

    private async getTokenUsage(operation: AnalyticsOperation): Promise<string> {
        try {
            let timeRange = operation.timeRange ? 
                this.getTimeRange(operation.timeRange) : 
                {
                    start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
                    end: new Date()
                };
            
            const userId = operation.userId;

            // Debug logging
            loggingService.info('Token Usage Query Debug', {
                component: 'analyticsManagerTool',
                operation: 'getTokenUsage',
                step: 'debug',
                userId,
                originalTimeRange: timeRange,
                userIdType: typeof userId,
                isValidObjectId: require('mongoose').Types.ObjectId.isValid(userId)
            });

            // First, let's check if there's ANY usage data for this user
            const totalUserUsage = await Usage.countDocuments({
                userId: new (require('mongoose')).Types.ObjectId(userId)
            });

            loggingService.info('Total usage records for user', {
                component: 'analyticsManagerTool',
                operation: 'getTokenUsage',
                step: 'usageCount',
                userId,
                totalUserUsage
            });

            if (totalUserUsage === 0) {
                return JSON.stringify({
                    success: true,
                    operation: 'token_usage',
                    data: {
                        message: "I don't see any token usage records for your account.",
                        reasons: [
                            "You're new to the platform and haven't made API calls yet",
                            "Your API integration might not be properly set up",
                            "Usage tracking might not be enabled"
                        ],
                        suggestions: [
                            "Try making a test API call to generate usage data",
                            "Verify your API integration is working correctly",
                            "Check if usage tracking is enabled in your settings"
                        ],
                        nextSteps: "Would you like me to help you set up API tracking?",
                        debugInfo: {
                            totalRecords: totalUserUsage,
                            userId: userId
                        }
                    }
                }, null, 2);
            }

            // Get the actual data range for this user
            const dataRangeQuery = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: null,
                        earliest: { $min: '$createdAt' },
                        latest: { $max: '$createdAt' },
                        totalRecords: { $sum: 1 }
                    }
                }
            ]);

            const userDataRange = dataRangeQuery[0];
            loggingService.info('User data range', {
                component: 'analyticsManagerTool',
                operation: 'getTokenUsage',
                step: 'dataRange',
                userId,
                userDataRange
            });

            // Check if requested time range overlaps with user's data
            const hasOverlap = timeRange.end >= userDataRange.earliest && timeRange.start <= userDataRange.latest;
            
            if (!hasOverlap) {
                loggingService.warn('No overlap between requested range and user data, adjusting', {
                    component: 'analyticsManagerTool',
                    operation: 'getTokenUsage',
                    step: 'timeRangeAdjustment',
                    userId,
                    requestedRange: operation.timeRange,
                    userDataRange
                });
                
                // If no overlap, use the user's actual data range or recent data
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                
                // Use the most recent 30 days of user data, or their full range if less than 30 days
                timeRange = {
                    start: userDataRange.latest > thirtyDaysAgo ? userDataRange.earliest : thirtyDaysAgo,
                    end: userDataRange.latest
                };
                
                loggingService.info('Adjusted time range', {
                    component: 'analyticsManagerTool',
                    operation: 'getTokenUsage',
                    step: 'timeRangeAdjusted',
                    userId,
                    adjustedTimeRange: timeRange
                });
            }

            // Get sample usage records to understand the data structure
            const sampleUsage = await Usage.find({
                userId: new (require('mongoose')).Types.ObjectId(userId)
            }).limit(3).sort({ createdAt: -1 }).lean();

            loggingService.info('Sample usage records', {
                component: 'analyticsManagerTool',
                operation: 'getTokenUsage',
                step: 'sampleData',
                userId,
                sampleCount: sampleUsage.length,
                sampleData: sampleUsage.map(u => ({
                    id: u._id,
                    model: u.model,
                    service: u.service,
                    cost: u.cost,
                    totalTokens: u.totalTokens,
                    createdAt: u.createdAt
                }))
            });

            const tokenAnalysis = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalTokens: { $sum: { $add: ['$promptTokens', '$completionTokens'] } },
                        totalPromptTokens: { $sum: '$promptTokens' },
                        totalCompletionTokens: { $sum: '$completionTokens' },
                        totalCost: { $sum: '$cost' },
                        totalRequests: { $sum: 1 },
                        avgTokensPerRequest: { $avg: { $add: ['$promptTokens', '$completionTokens'] } }
                    }
                }
            ]);

            // Get token usage by model
            const modelTokens = await Usage.aggregate([
                {
                    $match: {
                        userId: new (require('mongoose')).Types.ObjectId(userId),
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: '$model',
                        totalTokens: { $sum: { $add: ['$promptTokens', '$completionTokens'] } },
                        totalCost: { $sum: '$cost' },
                        requests: { $sum: 1 },
                        avgTokensPerRequest: { $avg: { $add: ['$promptTokens', '$completionTokens'] } }
                    }
                },
                { $sort: { totalTokens: -1 } },
                { $limit: 10 }
            ]);

            const tokenData = tokenAnalysis[0];

            loggingService.info('Token Analysis Result', {
                component: 'analyticsManagerTool',
                operation: 'getTokenUsage',
                step: 'analysisResult',
                userId,
                tokenAnalysisLength: tokenAnalysis.length,
                tokenData,
                totalUserUsage,
                adjustedTimeRange: timeRange,
                userDataRange: userDataRange
            });

            if (!tokenData || tokenData.totalTokens === 0) {
                loggingService.warn('No data found in adjusted time range after adjustment', {
                    component: 'analyticsManagerTool',
                    operation: 'getTokenUsage',
                    step: 'noDataWarning',
                    userId,
                    totalRecords: totalUserUsage,
                    requestedRange: operation.timeRange,
                    adjustedRange: timeRange,
                    userDataRange: userDataRange
                });
                
                // This should rarely happen now due to our time range adjustment above
                // But if it does, provide a helpful fallback
                return JSON.stringify({
                    success: true,
                    operation: 'token_usage',
                    data: {
                        message: `I couldn't find usage data in the expected time range. Let me check your full usage history:`,
                        debugInfo: {
                            totalRecords: totalUserUsage,
                            requestedRange: operation.timeRange,
                            adjustedRange: timeRange,
                            userDataRange: userDataRange,
                            userId: userId
                        },
                        suggestions: [
                            "Let me try to get your complete usage history",
                            "There might be a data processing delay",
                            "Your usage data might be in a different format"
                        ],
                        nextSteps: "Let me fetch your complete usage data instead."
                    }
                }, null, 2);
            }

            const usage = {
                summary: {
                    totalTokens: tokenData.totalTokens,
                    promptTokens: tokenData.totalPromptTokens,
                    completionTokens: tokenData.totalCompletionTokens,
                    totalCost: Number(tokenData.totalCost?.toFixed(4) || 0),
                    totalRequests: tokenData.totalRequests,
                    avgTokensPerRequest: Math.round(tokenData.avgTokensPerRequest || 0),
                    costPerToken: Number((tokenData.totalCost / tokenData.totalTokens)?.toFixed(8) || 0)
                },
                modelBreakdown: modelTokens.map(model => ({
                    model: model._id,
                    totalTokens: model.totalTokens,
                    totalCost: Number(model.totalCost?.toFixed(4) || 0),
                    requests: model.requests,
                    avgTokensPerRequest: Math.round(model.avgTokensPerRequest || 0),
                    tokenPercentage: Number((model.totalTokens / tokenData.totalTokens * 100)?.toFixed(1) || 0)
                })),
                insights: this.generateTokenInsights(tokenData, modelTokens),
                timeRange: {
                    start: timeRange.start,
                    end: timeRange.end,
                    daysAnalyzed: Math.ceil((timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60 * 24))
                }
            };

            // Check if we adjusted the time range
            const originalTimeRange = operation.timeRange ? this.getTimeRange(operation.timeRange) : null;
            const wasAdjusted = originalTimeRange && (
                Math.abs(originalTimeRange.start.getTime() - timeRange.start.getTime()) > 1000 ||
                Math.abs(originalTimeRange.end.getTime() - timeRange.end.getTime()) > 1000
            );

            let message = `Here's your token usage for ${timeRange.start.toDateString()} to ${timeRange.end.toDateString()}:`;
            
            if (wasAdjusted) {
                message = `I adjusted the time range to show your available data (${timeRange.start.toDateString()} to ${timeRange.end.toDateString()}):`;
            }

            return JSON.stringify({
                success: true,
                operation: 'token_usage',
                data: {
                    ...usage,
                    message: message,
                    timeRangeAdjusted: wasAdjusted,
                    originalRequest: originalTimeRange ? {
                        start: originalTimeRange.start,
                        end: originalTimeRange.end
                    } : null
                },
                summary: `You've used ${tokenData.totalTokens.toLocaleString()} tokens across ${tokenData.totalRequests} requests, costing $${tokenData.totalCost.toFixed(4)}`
            }, null, 2);

        } catch (error) {
            return `Failed to get token usage: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private generateTokenInsights(tokenData: any, modelTokens: any[]): string[] {
        const insights = [];
        
        if (tokenData.totalTokens > 1000000) {
            insights.push(`High token usage: ${(tokenData.totalTokens / 1000000).toFixed(1)}M tokens used`);
        }
        
        if (tokenData.costPerToken && tokenData.costPerToken > 0.000005) {
            insights.push(`Token cost is above average at $${tokenData.costPerToken.toFixed(8)} per token`);
        }
        
        if (modelTokens.length > 0) {
            const topModel = modelTokens[0];
            insights.push(`${topModel._id} accounts for ${Math.round(topModel.totalTokens / tokenData.totalTokens * 100)}% of your token usage`);
        }
        
        if (tokenData.avgTokensPerRequest > 2000) {
            insights.push(`High average tokens per request (${tokenData.avgTokensPerRequest}) - consider prompt optimization`);
        }

        return insights;
    }

    private groupProviderTrends(trends: any[]): any {
        // Group provider trends by date
        const grouped: { [key: string]: any } = {};
        
        trends.forEach(trend => {
            const date = `${trend._id.date.year}-${String(trend._id.date.month).padStart(2, '0')}-${String(trend._id.date.day).padStart(2, '0')}`;
            if (!grouped[date]) {
                grouped[date] = {};
            }
            grouped[date][trend._id.provider] = {
                cost: Number(trend.cost?.toFixed(4) || 0),
                requests: trend.requests
            };
        });

        return grouped;
    }

    private getAnomalySeverity(score: number): string {
        if (score > 10) return 'critical';
        if (score > 5) return 'high';
        if (score > 3) return 'medium';
        return 'low';
    }

    private generateAnomalyRecommendations(costAnomalies: any[], usageSpikes: any[]): string[] {
        const recommendations = [];
        
        if (costAnomalies.length > 0) {
            recommendations.push('Review high-cost requests and consider model optimization');
            recommendations.push('Set up cost alerts to prevent future anomalies');
        }
        
        if (usageSpikes.length > 0) {
            recommendations.push('Investigate usage spikes to identify potential issues');
            recommendations.push('Consider implementing rate limiting during peak hours');
        }

        return recommendations;
    }

    private async getUsagePatterns(_operation: AnalyticsOperation): Promise<string> {
        // Implementation for usage pattern analysis
        return JSON.stringify({
            success: true,
            message: 'Usage patterns analysis - implementation pending'
        });
    }

    private async getProjectAnalytics(_operation: AnalyticsOperation): Promise<string> {
        // Implementation for project-specific analytics
        return JSON.stringify({
            success: true,
            message: 'Project analytics - implementation pending'
        });
    }

    private async getUserStats(_operation: AnalyticsOperation): Promise<string> {
        // Implementation for user statistics
        return JSON.stringify({
            success: true,
            message: 'User statistics - implementation pending'
        });
    }

    private async getComparativeAnalysis(_operation: AnalyticsOperation): Promise<string> {
        // Implementation for comparative analysis
        return JSON.stringify({
            success: true,
            message: 'Comparative analysis - implementation pending'
        });
    }

    private async getForecastingData(_operation: AnalyticsOperation): Promise<string> {
        // Implementation for forecasting
        return JSON.stringify({
            success: true,
            message: 'Forecasting data - implementation pending'
        });
    }

    private isValidOperation(operation: AnalyticsOperation): boolean {
        if (!operation.operation) return false;
        
        const validOperations = [
            'dashboard', 'cost_trends', 'usage_patterns', 'model_performance', 
            'project_analytics', 'user_stats', 'comparative_analysis', 
            'forecasting', 'anomaly_detection', 'token_usage'
        ];
        
        return validOperations.includes(operation.operation);
    }
} 