import { Response } from 'express';
import { PerformanceCostAnalysisService } from '../services/performanceCostAnalysis.service';
import { logger } from '../utils/logger';

export class PerformanceCostAnalysisController {

    /**
     * Analyze cost-performance correlation
     * POST /api/performance-cost/analyze
     */
    static async analyzeCostPerformanceCorrelation(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const {
                startDate,
                endDate,
                services,
                models,
                tags
            } = req.body;

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                services,
                models,
                tags
            };

            // Add timeout handling (15 seconds)
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 15000);
            });

            const correlationsPromise = PerformanceCostAnalysisService.analyzeCostPerformanceCorrelation(userId, options);

            const correlations = await Promise.race([correlationsPromise, timeoutPromise]);

            // Calculate summary metrics
            const summary = {
                totalServices: correlations.length,
                averageEfficiencyScore: correlations.reduce((sum, c) => sum + c.efficiency.costEfficiencyScore, 0) / correlations.length,
                bestPerforming: correlations.find(c => c.efficiency.costEfficiencyScore === Math.max(...correlations.map(c => c.efficiency.costEfficiencyScore))),
                worstPerforming: correlations.find(c => c.efficiency.costEfficiencyScore === Math.min(...correlations.map(c => c.efficiency.costEfficiencyScore))),
                averageCostPerRequest: correlations.reduce((sum, c) => sum + c.costPerRequest, 0) / correlations.length,
                averageLatency: correlations.reduce((sum, c) => sum + c.performance.latency, 0) / correlations.length,
                averageQualityScore: correlations.reduce((sum, c) => sum + c.performance.qualityScore, 0) / correlations.length
            };

            res.json({
                success: true,
                data: {
                    correlations,
                    summary
                },
                metadata: {
                    analysisType: 'cost_performance_correlation',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error analyzing cost-performance correlation:', error);
            if (error.message === 'Request timeout') {
                res.status(408).json({ 
                    success: false,
                    message: 'Request timeout - analysis took too long. Please try again with a smaller date range.' 
                });
            } else {
                res.status(500).json({ 
                    success: false,
                    message: 'Internal server error' 
                });
            }
        }
    }

    /**
     * Compare services and models
     * POST /api/performance-cost/compare
     */
    static async compareServices(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                startDate,
                endDate,
                useCase,
                tags
            } = req.body;

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                useCase,
                tags
            };

            const comparison = await PerformanceCostAnalysisService.compareServices(userId, options);

            res.json({
                success: true,
                data: comparison,
                metadata: {
                    analysisType: 'service_comparison',
                    totalServices: comparison.services.length,
                    bestValue: comparison.bestValue,
                    totalRecommendations: comparison.recommendations.length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error comparing services:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get performance trends
     * GET /api/performance-cost/trends
     */
    static async getPerformanceTrends(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                startDate,
                endDate,
                service,
                model,
                granularity = 'day'
            } = req.query;

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                service: service as string,
                model: model as string,
                granularity: granularity as 'hour' | 'day' | 'week'
            };

            const trends = await PerformanceCostAnalysisService.getPerformanceTrends(userId, options);

            // Calculate trend summary
            const trendSummary = {
                totalPeriods: trends.length,
                improvingPeriods: trends.filter(t => t.trend === 'improving').length,
                degradingPeriods: trends.filter(t => t.trend === 'degrading').length,
                stablePeriods: trends.filter(t => t.trend === 'stable').length,
                totalAlerts: trends.reduce((sum, t) => sum + t.alerts.length, 0),
                highSeverityAlerts: trends.reduce((sum, t) => sum + t.alerts.filter(a => a.severity === 'high').length, 0),
                averageCost: trends.reduce((sum, t) => sum + t.metrics.cost, 0) / trends.length,
                averageLatency: trends.reduce((sum, t) => sum + t.metrics.latency, 0) / trends.length,
                averageQualityScore: trends.reduce((sum, t) => sum + t.metrics.qualityScore, 0) / trends.length
            };

            res.json({
                success: true,
                data: {
                    trends,
                    summary: trendSummary
                },
                metadata: {
                    analysisType: 'performance_trends',
                    granularity,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting performance trends:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Identify optimization opportunities
     * POST /api/performance-cost/optimization-opportunities
     */
    static async identifyOptimizationOpportunities(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                startDate,
                endDate,
                minSavings = 50,
                tags
            } = req.body;

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                minSavings,
                tags
            };

            const opportunities = await PerformanceCostAnalysisService.identifyOptimizationOpportunities(userId, options);

            // Calculate summary metrics
            const summary = {
                totalOpportunities: opportunities.length,
                totalPotentialSavings: opportunities.reduce((sum, opp) => sum + opp.savings, 0),
                averageSavingsPerOpportunity: opportunities.reduce((sum, opp) => sum + opp.savings, 0) / opportunities.length,
                highPriorityOpportunities: opportunities.filter(opp => opp.priority > 0.8).length,
                lowRiskOpportunities: opportunities.filter(opp => opp.riskAssessment.level === 'low').length,
                quickWins: opportunities.filter(opp => opp.implementationComplexity === 'low' && opp.savings > 100).length,
                opportunityTypes: [...new Set(opportunities.map(opp => opp.type))],
                averageImplementationComplexity: this.calculateAverageComplexity(opportunities)
            };

            res.json({
                success: true,
                data: {
                    opportunities,
                    summary
                },
                metadata: {
                    analysisType: 'optimization_opportunities',
                    minSavingsThreshold: minSavings,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error identifying optimization opportunities:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get detailed performance metrics
     * GET /api/performance-cost/detailed-metrics
     */
    static async getDetailedMetrics(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                service,
                model,
                startDate,
                endDate,
                tags
            } = req.query;

            if (!service || !model) {
                res.status(400).json({
                    message: 'Service and model parameters are required'
                });
            }

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                tags: tags ? (tags as string).split(',') : undefined
            };

            const metrics = await PerformanceCostAnalysisService.getDetailedMetrics(
                userId,
                service as string,
                model as string,
                options
            );

            res.json({
                success: true,
                data: metrics,
                metadata: {
                    service,
                    model,
                    analysisType: 'detailed_metrics',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting detailed metrics:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get cost-performance efficiency score
     * GET /api/performance-cost/efficiency-score
     */
    static async getEfficiencyScore(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                service,
                model,
                startDate,
                endDate
            } = req.query;

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                services: service ? [service as string] : undefined,
                models: model ? [model as string] : undefined
            };

            const correlations = await PerformanceCostAnalysisService.analyzeCostPerformanceCorrelation(userId, options);

            if (correlations.length === 0) {
                res.status(404).json({ message: 'No data found for the specified criteria' });
            }

            const targetCorrelation = correlations[0];
            const allCorrelations = await PerformanceCostAnalysisService.analyzeCostPerformanceCorrelation(userId, {
                startDate: options.startDate,
                endDate: options.endDate
            });

            // Calculate percentile ranking
            const efficiencyScores = allCorrelations.map(c => c.efficiency.costEfficiencyScore).sort((a, b) => b - a);
            const percentileRank = (efficiencyScores.indexOf(targetCorrelation.efficiency.costEfficiencyScore) / efficiencyScores.length) * 100;

            const efficiencyAnalysis = {
                service: targetCorrelation.service,
                model: targetCorrelation.model,
                efficiencyScore: targetCorrelation.efficiency.costEfficiencyScore,
                percentileRank: Math.round(percentileRank),
                performanceRating: targetCorrelation.efficiency.performanceRating,
                recommendation: targetCorrelation.efficiency.recommendation,
                optimizationPotential: targetCorrelation.efficiency.optimizationPotential,
                benchmarks: {
                    industry: {
                        averageEfficiency: efficiencyScores.reduce((sum, score) => sum + score, 0) / efficiencyScores.length,
                        topPercentileThreshold: efficiencyScores[Math.floor(efficiencyScores.length * 0.1)],
                        bottomPercentileThreshold: efficiencyScores[Math.floor(efficiencyScores.length * 0.9)]
                    },
                    yourAccount: {
                        bestService: allCorrelations.reduce((best, current) =>
                            current.efficiency.costEfficiencyScore > best.efficiency.costEfficiencyScore ? current : best
                        ),
                        worstService: allCorrelations.reduce((worst, current) =>
                            current.efficiency.costEfficiencyScore < worst.efficiency.costEfficiencyScore ? current : worst
                        )
                    }
                },
                improvementActions: [
                    ...(targetCorrelation.performance.latency > 5000 ? [{
                        action: 'Optimize request latency',
                        impact: 'High',
                        effort: 'Medium',
                        expectedImprovement: '15-25%'
                    }] : []),
                    ...(targetCorrelation.performance.errorRate > 5 ? [{
                        action: 'Improve error handling',
                        impact: 'Medium',
                        effort: 'Low',
                        expectedImprovement: '10-20%'
                    }] : []),
                    ...(targetCorrelation.efficiency.costEfficiencyScore < 0.6 ? [{
                        action: 'Consider alternative service/model',
                        impact: 'High',
                        effort: 'High',
                        expectedImprovement: '20-40%'
                    }] : [])
                ]
            };

            res.json({
                success: true,
                data: efficiencyAnalysis,
                metadata: {
                    analysisType: 'efficiency_score',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting efficiency score:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get performance heatmap data
     * GET /api/performance-cost/heatmap
     */
    static async getPerformanceHeatmap(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                startDate,
                endDate,
                granularity = 'day',
                metric = 'cost'
            } = req.query;

            const options = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                granularity: granularity as 'hour' | 'day' | 'week'
            };

            const trends = await PerformanceCostAnalysisService.getPerformanceTrends(userId, options);

            // Generate heatmap data
            const heatmapData = trends.map(trend => ({
                period: trend.period,
                cost: trend.metrics.cost,
                latency: trend.metrics.latency,
                qualityScore: trend.metrics.qualityScore,
                errorRate: trend.metrics.errorRate,
                volume: trend.metrics.volume,
                efficiency: this.calculateEfficiency(trend.metrics),
                alerts: trend.alerts.length,
                trend: trend.trend
            }));

            // Calculate intensity ranges for visualization
            const metricValues = heatmapData.map(d => d[metric as keyof typeof d] as number);
            const intensityRanges = {
                min: Math.min(...metricValues),
                max: Math.max(...metricValues),
                median: metricValues.sort((a, b) => a - b)[Math.floor(metricValues.length / 2)],
                q1: metricValues[Math.floor(metricValues.length * 0.25)],
                q3: metricValues[Math.floor(metricValues.length * 0.75)]
            };

            res.json({
                success: true,
                data: {
                    heatmapData,
                    intensityRanges,
                    metadata: {
                        metric,
                        granularity,
                        totalPeriods: heatmapData.length,
                        dateRange: {
                            start: trends[0]?.period,
                            end: trends[trends.length - 1]?.period
                        }
                    }
                },
                metadata: {
                    analysisType: 'performance_heatmap',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting performance heatmap:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Get cost-performance trade-off analysis
     * POST /api/performance-cost/tradeoff-analysis
     */
    static async getTradeoffAnalysis(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
            }

            const {
                services,
                models,
                priorityWeights = { cost: 0.4, latency: 0.3, quality: 0.3 },
                startDate,
                endDate
            } = req.body;

            const options = {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                services,
                models
            };

            const correlations = await PerformanceCostAnalysisService.analyzeCostPerformanceCorrelation(userId, options);

            // Calculate weighted scores for trade-off analysis
            const tradeoffAnalysis = correlations.map(correlation => {
                const normalizedCost = 1 - (correlation.costPerRequest / Math.max(...correlations.map(c => c.costPerRequest)));
                const normalizedLatency = 1 - (correlation.performance.latency / Math.max(...correlations.map(c => c.performance.latency)));
                const normalizedQuality = correlation.performance.qualityScore;

                const weightedScore = (
                    normalizedCost * priorityWeights.cost +
                    normalizedLatency * priorityWeights.latency +
                    normalizedQuality * priorityWeights.quality
                );

                return {
                    service: correlation.service,
                    model: correlation.model,
                    weightedScore,
                    normalizedMetrics: {
                        cost: normalizedCost,
                        latency: normalizedLatency,
                        quality: normalizedQuality
                    },
                    rawMetrics: {
                        cost: correlation.costPerRequest,
                        latency: correlation.performance.latency,
                        quality: correlation.performance.qualityScore
                    },
                    tradeoffs: correlation.tradeoffs,
                    recommendation: this.generateTradeoffRecommendation(weightedScore, correlation)
                };
            }).sort((a, b) => b.weightedScore - a.weightedScore);

            res.json({
                success: true,
                data: {
                    tradeoffAnalysis,
                    priorityWeights,
                    bestOption: tradeoffAnalysis[0],
                    summary: {
                        totalOptions: tradeoffAnalysis.length,
                        topTier: tradeoffAnalysis.filter(t => t.weightedScore > 0.8).length,
                        averageScore: tradeoffAnalysis.reduce((sum, t) => sum + t.weightedScore, 0) / tradeoffAnalysis.length
                    }
                },
                metadata: {
                    analysisType: 'tradeoff_analysis',
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting trade-off analysis:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    /**
     * Private helper methods
     */
    private static calculateAverageComplexity(opportunities: any[]): number {
        const complexityValues: { [key: string]: number } = { low: 1, medium: 2, high: 3 };
        const totalComplexity = opportunities.reduce((sum, opp) => sum + complexityValues[opp.implementationComplexity as string], 0);
        return totalComplexity / opportunities.length;
    }

    private static calculateEfficiency(metrics: any): number {
        // Calculate efficiency score based on cost, latency, and quality
        const costScore = Math.max(0, 1 - (metrics.cost / 100));
        const latencyScore = Math.max(0, 1 - (metrics.latency / 10000));
        const qualityScore = metrics.qualityScore;

        return (costScore + latencyScore + qualityScore) / 3;
    }

    private static generateTradeoffRecommendation(score: number, correlation: any): string {
        if (score > 0.8) {
            return 'Excellent balance of cost, performance, and quality. Recommended for production use.';
        } else if (score > 0.6) {
            return 'Good option with acceptable trade-offs. Consider for most use cases.';
        } else if (correlation.performance.latency > 5000) {
            return 'High latency may impact user experience. Consider if speed is critical.';
        } else if (correlation.costPerRequest > 0.05) {
            return 'Higher cost option. Evaluate if the performance benefits justify the expense.';
        } else {
            return 'Consider optimization or alternative options for better cost-performance balance.';
        }
    }
} 