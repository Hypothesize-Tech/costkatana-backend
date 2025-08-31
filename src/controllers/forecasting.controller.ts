import { Response } from 'express';
import { ForecastingService } from '../services/forecasting.service';
import { loggingService } from '../services/logging.service';

export class ForecastingController {

    /**
     * Generate cost forecast
     * POST /api/forecasting/generate
     */
    static async generateCostForecast(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const {
            forecastType = 'daily',
            timeHorizon = 30,
            tags,
            budgetLimit
        } = req.body;

        try {
            loggingService.info('Cost forecast generation initiated', {
                userId,
                hasUserId: !!userId,
                forecastType,
                timeHorizon,
                hasTags: !!tags,
                hasBudgetLimit: !!budgetLimit,
                tagsCount: tags ? tags.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Cost forecast generation failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            // Validate inputs
            if (!['daily', 'weekly', 'monthly'].includes(forecastType)) {
                loggingService.warn('Cost forecast generation failed - invalid forecast type', {
                    userId,
                    forecastType,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    message: 'Forecast type must be one of: daily, weekly, monthly'
                });
                return;
            }

            if (timeHorizon < 1 || timeHorizon > 365) {
                loggingService.warn('Cost forecast generation failed - invalid time horizon', {
                    userId,
                    timeHorizon,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    message: 'Time horizon must be between 1 and 365 days'
                });
                return;
            }

            loggingService.info('Cost forecast generation processing started', {
                userId,
                forecastType,
                timeHorizon,
                hasTags: !!tags,
                hasBudgetLimit: !!budgetLimit,
                requestId: req.headers['x-request-id'] as string
            });

            // Add timeout handling (20 seconds)
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 20000);
            });

            const forecastPromise = ForecastingService.generateCostForecast(userId, {
                forecastType,
                timeHorizon,
                tags,
                budgetLimit
            });

            const forecast = await Promise.race([forecastPromise, timeoutPromise]);

            const duration = Date.now() - startTime;

            loggingService.info('Cost forecast generated successfully', {
                userId,
                forecastType,
                timeHorizon,
                duration,
                hasForecast: !!forecast,
                modelAccuracy: forecast.modelAccuracy,
                dataQuality: forecast.dataQuality,
                forecastsCount: forecast.forecasts?.length || 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cost_forecast_generated',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    forecastType,
                    timeHorizon,
                    hasTags: !!tags,
                    hasBudgetLimit: !!budgetLimit,
                    modelAccuracy: forecast.modelAccuracy,
                    dataQuality: forecast.dataQuality,
                    forecastsCount: forecast.forecasts?.length || 0
                }
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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            if (error.message === 'Request timeout') {
                loggingService.warn('Cost forecast generation failed - request timeout', {
                    userId,
                    forecastType,
                    timeHorizon,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(408).json({ 
                    success: false,
                    message: 'Request timeout - operation took too long. Please try again with a smaller time range.' 
                });
            } else {
                loggingService.error('Cost forecast generation failed', {
                    userId,
                    forecastType,
                    timeHorizon,
                    hasTags: !!tags,
                    hasBudgetLimit: !!budgetLimit,
                    error: error.message || 'Unknown error',
                    stack: error.stack,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(500).json({ 
                    success: false,
                    message: 'Internal server error' 
                });
            }
        }
    }

    /**
     * Get predictive alerts
     * POST /api/forecasting/alerts
     */
    static async getPredictiveAlerts(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { budgetLimits } = req.body;

        try {
            loggingService.info('Predictive alerts retrieval initiated', {
                userId,
                hasUserId: !!userId,
                hasBudgetLimits: !!budgetLimits,
                budgetLimitsKeys: budgetLimits ? Object.keys(budgetLimits) : [],
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Predictive alerts retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!budgetLimits || typeof budgetLimits !== 'object') {
                loggingService.warn('Predictive alerts retrieval failed - invalid budget limits', {
                    userId,
                    hasBudgetLimits: !!budgetLimits,
                    budgetLimitsType: typeof budgetLimits,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    message: 'Budget limits object is required with daily, weekly, or monthly properties'
                });
                return;
            }

            loggingService.info('Predictive alerts retrieval processing started', {
                userId,
                budgetLimitsKeys: Object.keys(budgetLimits),
                requestId: req.headers['x-request-id'] as string
            });

            const alerts = await ForecastingService.getPredictiveAlerts(userId, budgetLimits);

            const duration = Date.now() - startTime;

            loggingService.info('Predictive alerts retrieved successfully', {
                userId,
                duration,
                totalAlerts: alerts.length,
                highSeverityAlerts: alerts.filter(a => a.severity === 'high').length,
                mediumSeverityAlerts: alerts.filter(a => a.severity === 'medium').length,
                lowSeverityAlerts: alerts.filter(a => a.severity === 'low').length,
                hasAlerts: !!alerts && alerts.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'predictive_alerts_retrieved',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    totalAlerts: alerts.length,
                    highSeverityAlerts: alerts.filter(a => a.severity === 'high').length,
                    mediumSeverityAlerts: alerts.filter(a => a.severity === 'medium').length,
                    lowSeverityAlerts: alerts.filter(a => a.severity === 'low').length,
                    hasAlerts: !!alerts && alerts.length > 0
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Predictive alerts retrieval failed', {
                userId,
                hasBudgetLimits: !!budgetLimits,
                budgetLimitsKeys: budgetLimits ? Object.keys(budgetLimits) : [],
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Analyze spending patterns
     * GET /api/forecasting/patterns
     */
    static async analyzeSpendingPatterns(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { tags } = req.query;
        const tagFilter = tags ? (tags as string).split(',') : undefined;

        try {
            loggingService.info('Spending patterns analysis initiated', {
                userId,
                hasUserId: !!userId,
                hasTags: !!tags,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Spending patterns analysis failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Spending patterns analysis processing started', {
                userId,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

            const patterns = await ForecastingService.analyzeSpendingPatterns(userId, tagFilter);

            const duration = Date.now() - startTime;

            loggingService.info('Spending patterns analysis completed successfully', {
                userId,
                duration,
                overallTrend: patterns.trendAnalysis?.overallTrend,
                growthRate: patterns.trendAnalysis?.growthRate,
                volatility: patterns.trendAnalysis?.volatility,
                confidence: patterns.trendAnalysis?.confidence,
                anomaliesDetected: patterns.anomalies?.length || 0,
                hasPatterns: !!patterns,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'spending_patterns_analyzed',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    overallTrend: patterns.trendAnalysis?.overallTrend,
                    growthRate: patterns.trendAnalysis?.growthRate,
                    volatility: patterns.trendAnalysis?.volatility,
                    confidence: patterns.trendAnalysis?.confidence,
                    anomaliesDetected: patterns.anomalies?.length || 0,
                    hasPatterns: !!patterns
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Spending patterns analysis failed', {
                userId,
                hasTags: !!tags,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get budget utilization forecast
     * POST /api/forecasting/budget-utilization
     */
    static async getBudgetUtilizationForecast(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const {
            budgetAmount,
            period = 'monthly',
            tags
        } = req.body;

        try {
            loggingService.info('Budget utilization forecast initiated', {
                userId,
                hasUserId: !!userId,
                budgetAmount,
                period,
                hasTags: !!tags,
                tagsCount: tags ? tags.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Budget utilization forecast failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!budgetAmount || budgetAmount <= 0) {
                loggingService.warn('Budget utilization forecast failed - invalid budget amount', {
                    userId,
                    budgetAmount,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    message: 'Budget amount is required and must be positive'
                });
                return;
            }

            loggingService.info('Budget utilization forecast processing started', {
                userId,
                budgetAmount,
                period,
                hasTags: !!tags,
                tagsCount: tags ? tags.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Budget utilization forecast completed successfully', {
                userId,
                budgetAmount,
                period,
                duration,
                currentUtilization,
                projectedUtilization,
                utilizationTrend,
                hasForecast: !!forecast,
                forecastsCount: forecast.forecasts?.length || 0,
                hasAlerts: !!forecast.budgetAlerts && forecast.budgetAlerts.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'budget_utilization_forecast_generated',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    budgetAmount,
                    period,
                    currentUtilization,
                    projectedUtilization,
                    utilizationTrend,
                    hasForecast: !!forecast,
                    forecastsCount: forecast.forecasts?.length || 0,
                    hasAlerts: !!forecast.budgetAlerts && forecast.budgetAlerts.length > 0
                }
            });

            res.json({
                success: true,
                data: utilizationForecast,
                metadata: {
                    accuracy: forecast.modelAccuracy,
                    dataQuality: forecast.dataQuality,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Budget utilization forecast failed', {
                userId,
                budgetAmount,
                period,
                hasTags: !!tags,
                tagsCount: tags ? tags.length : 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get seasonal analysis
     * GET /api/forecasting/seasonal
     */
    static async getSeasonalAnalysis(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { tags } = req.query;
        const tagFilter = tags ? (tags as string).split(',') : undefined;

        try {
            loggingService.info('Seasonal analysis initiated', {
                userId,
                hasUserId: !!userId,
                hasTags: !!tags,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Seasonal analysis failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Seasonal analysis processing started', {
                userId,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Seasonal analysis completed successfully', {
                userId,
                duration,
                dailyPatternStrength: patterns.dailyPattern.strength,
                weeklyPatternStrength: patterns.weeklyPattern.strength,
                monthlyPatternStrength: patterns.monthlyPattern.strength,
                hasDailyPattern: patterns.dailyPattern.strength > 0.3,
                hasWeeklyPattern: patterns.weeklyPattern.strength > 0.3,
                hasMonthlyPattern: patterns.monthlyPattern.strength > 0.3,
                insightsCount: seasonalAnalysis.insights.length,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'seasonal_analysis_completed',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    dailyPatternStrength: patterns.dailyPattern.strength,
                    weeklyPatternStrength: patterns.weeklyPattern.strength,
                    monthlyPatternStrength: patterns.monthlyPattern.strength,
                    hasDailyPattern: patterns.dailyPattern.strength > 0.3,
                    hasWeeklyPattern: patterns.weeklyPattern.strength > 0.3,
                    hasMonthlyPattern: patterns.monthlyPattern.strength > 0.3,
                    insightsCount: seasonalAnalysis.insights.length
                }
            });

            res.json({
                success: true,
                data: seasonalAnalysis,
                metadata: {
                    analysisType: 'seasonal',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Seasonal analysis failed', {
                userId,
                hasTags: !!tags,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get forecast accuracy metrics
     * GET /api/forecasting/accuracy
     */
    static async getForecastAccuracy(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { forecastType = 'daily', days = 30 } = req.query;

        try {
            loggingService.info('Forecast accuracy metrics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                forecastType,
                days,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Forecast accuracy metrics retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Forecast accuracy metrics retrieval processing started', {
                userId,
                forecastType,
                days,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Forecast accuracy metrics retrieved successfully', {
                userId,
                forecastType,
                days,
                duration,
                modelAccuracy: accuracyMetrics.modelAccuracy,
                dataQuality: accuracyMetrics.dataQuality,
                confidenceLevel: accuracyMetrics.confidenceLevel,
                forecastReliability: accuracyMetrics.forecastReliability,
                recommendationsCount: accuracyMetrics.recommendations.length,
                hasForecasts: !!forecasts && forecasts.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'forecast_accuracy_metrics_retrieved',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    forecastType,
                    days,
                    modelAccuracy: accuracyMetrics.modelAccuracy,
                    dataQuality: accuracyMetrics.dataQuality,
                    confidenceLevel: accuracyMetrics.confidenceLevel,
                    forecastReliability: accuracyMetrics.forecastReliability,
                    recommendationsCount: accuracyMetrics.recommendations.length
                }
            });

            res.json({
                success: true,
                data: accuracyMetrics,
                metadata: {
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Forecast accuracy metrics retrieval failed', {
                userId,
                forecastType,
                days,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get cost anomaly detection
     * GET /api/forecasting/anomalies
     */
    static async getCostAnomalies(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { tags, startDate, endDate } = req.query;
        const tagFilter = tags ? (tags as string).split(',') : undefined;

        try {
            loggingService.info('Cost anomaly detection initiated', {
                userId,
                hasUserId: !!userId,
                hasTags: !!tags,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                startDate,
                endDate,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Cost anomaly detection failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Cost anomaly detection processing started', {
                userId,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                startDate,
                endDate,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Cost anomaly detection completed successfully', {
                userId,
                duration,
                totalAnomalies: anomalies.length,
                highSeverity: anomalies.filter(a => a.severity === 'high').length,
                mediumSeverity: anomalies.filter(a => a.severity === 'medium').length,
                lowSeverity: anomalies.filter(a => a.severity === 'low').length,
                hasAnomalies: !!anomalies && anomalies.length > 0,
                startDate,
                endDate,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'cost_anomalies_detected',
                category: 'forecasting_operations',
                value: duration,
                metadata: {
                    userId,
                    totalAnomalies: anomalies.length,
                    highSeverity: anomalies.filter(a => a.severity === 'high').length,
                    mediumSeverity: anomalies.filter(a => a.severity === 'low').length,
                    lowSeverity: anomalies.filter(a => a.severity === 'low').length,
                    hasAnomalies: !!anomalies && anomalies.length > 0,
                    startDate,
                    endDate
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Cost anomaly detection failed', {
                userId,
                hasTags: !!tags,
                tagFilter,
                tagsCount: tagFilter ? tagFilter.length : 0,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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