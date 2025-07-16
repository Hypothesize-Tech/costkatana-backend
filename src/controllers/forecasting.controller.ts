import { Response } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import { logger } from '../utils/logger';

export class ForecastingController {

    /**
     * Generate cost forecast
     * POST /api/forecasting/generate
     */
    static async generateCostForecast(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                forecastType = 'daily',
                timeHorizon = 30,
                tags,
                budgetLimit
            } = req.body;

            // Validate inputs
            if (!['daily', 'weekly', 'monthly'].includes(forecastType)) {
                res.status(400).json({
                    message: 'Forecast type must be one of: daily, weekly, monthly'
                });
            }

            if (timeHorizon < 1 || timeHorizon > 365) {
                res.status(400).json({
                    message: 'Time horizon must be between 1 and 365 days'
                });
            }

            const forecast = await ForecastingService.generateCostForecast(userId, {
                forecastType,
                timeHorizon,
                tags,
                budgetLimit
            });

            res.json({
                success: true,
                data: forecast,
                metadata: {
                    generatedAt: new Date().toISOString(),
                    accuracy: forecast.modelAccuracy,
                    dataQuality: forecast.dataQuality
                }
            });
        } catch (error) {
            logger.error('Error generating cost forecast:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get predictive alerts
     * POST /api/forecasting/alerts
     */
    static async getPredictiveAlerts(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { budgetLimits } = req.body;

            if (!budgetLimits || typeof budgetLimits !== 'object') {
                res.status(400).json({
                    message: 'Budget limits object is required with daily, weekly, or monthly properties'
                });
            }

            const alerts = await ForecastingService.getPredictiveAlerts(userId, budgetLimits);

            res.json({
                success: true,
                data: alerts,
                metadata: {
                    totalAlerts: alerts.length,
                    highSeverityAlerts: alerts.filter(a => a.severity === 'high').length,
                    mediumSeverityAlerts: alerts.filter(a => a.severity === 'medium').length,
                    lowSeverityAlerts: alerts.filter(a => a.severity === 'low').length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting predictive alerts:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Analyze spending patterns
     * GET /api/forecasting/patterns
     */
    static async analyzeSpendingPatterns(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tags } = req.query;
            const tagFilter = tags ? (tags as string).split(',') : undefined;

            const patterns = await ForecastingService.analyzeSpendingPatterns(userId, tagFilter);

            res.json({
                success: true,
                data: patterns,
                metadata: {
                    overallTrend: patterns.trendAnalysis.overallTrend,
                    growthRate: patterns.trendAnalysis.growthRate,
                    volatility: patterns.trendAnalysis.volatility,
                    confidence: patterns.trendAnalysis.confidence,
                    anomaliesDetected: patterns.anomalies.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error analyzing spending patterns:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get budget utilization forecast
     * POST /api/forecasting/budget-utilization
     */
    static async getBudgetUtilizationForecast(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                budgetAmount,
                period = 'monthly',
                tags
            } = req.body;

            if (!budgetAmount || budgetAmount <= 0) {
                res.status(400).json({
                    message: 'Budget amount is required and must be positive'
                });
            }

            const timeHorizon = period === 'daily' ? 30 : period === 'weekly' ? 12 : 6;

            const forecast = await ForecastingService.generateCostForecast(userId, {
                forecastType: period,
                timeHorizon,
                tags,
                budgetLimit: budgetAmount
            });

            // Calculate budget utilization metrics
            const currentUtilization = (forecast.currentCost / budgetAmount) * 100;
            const projectedUtilization = (forecast.totalPredictedCost / budgetAmount) * 100;
            const utilizationTrend = projectedUtilization - currentUtilization;

            const utilizationForecast = {
                budget: {
                    amount: budgetAmount,
                    period,
                    currency: 'USD'
                },
                utilization: {
                    current: currentUtilization,
                    projected: projectedUtilization,
                    trend: utilizationTrend > 10 ? 'increasing' : utilizationTrend < -10 ? 'decreasing' : 'stable'
                },
                forecast: forecast.forecasts.map(f => ({
                    period: f.period,
                    cost: f.predictedCost,
                    utilization: (f.predictedCost / budgetAmount) * 100,
                    confidence: f.confidence
                })),
                alerts: forecast.budgetAlerts,
                peakPeriods: forecast.peakPeriods,
                recommendations: [
                    ...(projectedUtilization > 90 ? [{
                        type: 'budget_risk',
                        message: 'Budget utilization is projected to exceed 90%',
                        actions: ['Review high-cost operations', 'Implement cost controls', 'Consider budget increase']
                    }] : []),
                    ...(utilizationTrend > 20 ? [{
                        type: 'spending_acceleration',
                        message: 'Spending is accelerating beyond normal patterns',
                        actions: ['Analyze recent usage changes', 'Review optimization opportunities', 'Monitor daily usage']
                    }] : [])
                ]
            };

            res.json({
                success: true,
                data: utilizationForecast,
                metadata: {
                    accuracy: forecast.modelAccuracy,
                    dataQuality: forecast.dataQuality,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting budget utilization forecast:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get seasonal analysis
     * GET /api/forecasting/seasonal
     */
    static async getSeasonalAnalysis(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tags } = req.query;
            const tagFilter = tags ? (tags as string).split(',') : undefined;

            const patterns = await ForecastingService.analyzeSpendingPatterns(userId, tagFilter);

            const seasonalAnalysis = {
                dailyPattern: {
                    type: patterns.dailyPattern.type,
                    peakHours: patterns.dailyPattern.pattern
                        .map((value, hour) => ({ hour, value }))
                        .sort((a, b) => b.value - a.value)
                        .slice(0, 3),
                    strength: patterns.dailyPattern.strength,
                    confidence: patterns.dailyPattern.confidence
                },
                weeklyPattern: {
                    type: patterns.weeklyPattern.type,
                    peakDays: patterns.weeklyPattern.pattern
                        .map((value, day) => ({
                            day,
                            dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
                            value
                        }))
                        .sort((a, b) => b.value - a.value)
                        .slice(0, 3),
                    strength: patterns.weeklyPattern.strength,
                    confidence: patterns.weeklyPattern.confidence
                },
                monthlyPattern: {
                    type: patterns.monthlyPattern.type,
                    peakMonths: patterns.monthlyPattern.pattern
                        .map((value, month) => ({
                            month,
                            monthName: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month],
                            value
                        }))
                        .sort((a, b) => b.value - a.value)
                        .slice(0, 3),
                    strength: patterns.monthlyPattern.strength,
                    confidence: patterns.monthlyPattern.confidence
                },
                insights: [
                    ...(patterns.dailyPattern.strength > 0.3 ? [{
                        type: 'daily_pattern',
                        message: 'Strong daily usage pattern detected',
                        impact: 'Consider scheduling batch operations during low-usage hours'
                    }] : []),
                    ...(patterns.weeklyPattern.strength > 0.3 ? [{
                        type: 'weekly_pattern',
                        message: 'Strong weekly usage pattern detected',
                        impact: 'Business operations significantly impact AI usage'
                    }] : []),
                    ...(patterns.monthlyPattern.strength > 0.3 ? [{
                        type: 'monthly_pattern',
                        message: 'Strong monthly usage pattern detected',
                        impact: 'Seasonal business cycles affect AI costs'
                    }] : [])
                ]
            };

            res.json({
                success: true,
                data: seasonalAnalysis,
                metadata: {
                    analysisType: 'seasonal',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting seasonal analysis:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get forecast accuracy metrics
     * GET /api/forecasting/accuracy
     */
    static async getForecastAccuracy(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { forecastType = 'daily', days = 30 } = req.query;

            // Generate multiple forecasts to assess accuracy
            const forecasts = await Promise.all([
                ForecastingService.generateCostForecast(userId, {
                    forecastType: forecastType as 'daily' | 'weekly' | 'monthly',
                    timeHorizon: Number(days),
                    tags: undefined,
                    budgetLimit: undefined
                })
            ]);

            const accuracyMetrics = {
                modelAccuracy: forecasts[0].modelAccuracy,
                dataQuality: forecasts[0].dataQuality,
                confidenceLevel: forecasts[0].forecasts.reduce((sum, f) => sum + f.confidence, 0) / forecasts[0].forecasts.length,
                forecastReliability: this.calculateForecastReliability(forecasts[0]),
                recommendations: [
                    ...(forecasts[0].modelAccuracy < 0.7 ? [{
                        type: 'data_quality',
                        message: 'Forecast accuracy can be improved with more historical data',
                        action: 'Continue using the system to build better forecasting models'
                    }] : []),
                    ...(forecasts[0].dataQuality === 'poor' ? [{
                        type: 'data_collection',
                        message: 'Limited historical data affects forecast accuracy',
                        action: 'Forecasts will improve as more usage data is collected'
                    }] : [])
                ]
            };

            res.json({
                success: true,
                data: accuracyMetrics,
                metadata: {
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting forecast accuracy:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get cost anomaly detection
     * GET /api/forecasting/anomalies
     */
    static async getCostAnomalies(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const { tags, startDate, endDate } = req.query;
            const tagFilter = tags ? (tags as string).split(',') : undefined;

            const patterns = await ForecastingService.analyzeSpendingPatterns(userId, tagFilter);

            const anomalies = patterns.anomalies.map(anomaly => ({
                ...anomaly,
                severity: anomaly.deviation > 2 ? 'high' : anomaly.deviation > 1 ? 'medium' : 'low',
                recommendations: [
                    ...(anomaly.possibleCause === 'Usage spike' ? [
                        'Review recent API calls for unusual patterns',
                        'Check for automated processes or scripts',
                        'Verify cost optimization settings'
                    ] : []),
                    ...(anomaly.possibleCause === 'Unusual low usage' ? [
                        'Verify system availability',
                        'Check for service interruptions',
                        'Review application health'
                    ] : [])
                ]
            }));

            res.json({
                success: true,
                data: {
                    anomalies,
                    summary: {
                        totalAnomalies: anomalies.length,
                        highSeverity: anomalies.filter(a => a.severity === 'high').length,
                        mediumSeverity: anomalies.filter(a => a.severity === 'medium').length,
                        lowSeverity: anomalies.filter(a => a.severity === 'low').length,
                        timeRange: {
                            start: startDate || 'last 90 days',
                            end: endDate || 'today'
                        }
                    }
                },
                metadata: {
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting cost anomalies:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Private helper methods
     */
    private static calculateForecastReliability(forecast: any): number {
        // Calculate reliability based on various factors
        const dataQualityMap: { [key: string]: number } = {
            'excellent': 1.0,
            'good': 0.8,
            'fair': 0.6,
            'poor': 0.4
        };
        const dataQualityScore = dataQualityMap[forecast.dataQuality as string] || 0.4;

        const confidenceScore = forecast.forecasts.reduce((sum: number, f: any) => sum + f.confidence, 0) / forecast.forecasts.length;

        return (dataQualityScore + confidenceScore + forecast.modelAccuracy) / 3;
    }
} 