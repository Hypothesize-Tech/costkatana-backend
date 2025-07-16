import { Response } from 'express';
import { DemandPredictorService } from '../services/demandPredictor.service';
import { CostPerformanceProfilerService } from '../services/costPerformanceProfiler.service';
import { RecommendationEngineService } from '../services/recommendationEngine.service';
import { logger } from '../utils/logger';

export class InferenceScalingController {
    /**
     * Get demand predictions for all models
     */
    static async getDemandPredictions(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { hoursAhead = 4 } = req.query;
            const predictions = await DemandPredictorService.getAllModelDemandPredictions(
                userId,
                parseInt(hoursAhead as string, 10)
            );

            res.json({
                success: true,
                data: predictions,
                metadata: {
                    totalModels: predictions.length,
                    hoursAhead: parseInt(hoursAhead as string, 10),
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting demand predictions:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get demand predictions'
            });
        }
    }

    /**
     * Get demand prediction for a specific model
     */
    static async getModelDemandPrediction(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { modelId } = req.params;
            const { hoursAhead = 4 } = req.query;

            const prediction = await DemandPredictorService.predictModelDemand(
                modelId,
                userId,
                parseInt(hoursAhead as string, 10)
            );

            res.json({
                success: true,
                data: prediction
            });
        } catch (error) {
            logger.error('Error getting model demand prediction:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get model demand prediction'
            });
        }
    }

    /**
     * Get historical demand data for a model
     */
    static async getModelDemandHistory(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { modelId } = req.params;
            const { startDate, endDate } = req.query;

            if (!startDate || !endDate) {
                res.status(400).json({
                    success: false,
                    error: 'startDate and endDate are required'
                });
                return;
            }

            const history = await DemandPredictorService.getModelDemandHistory(
                modelId,
                userId,
                {
                    startDate: new Date(startDate as string),
                    endDate: new Date(endDate as string)
                }
            );

            res.json({
                success: true,
                data: history
            });
        } catch (error) {
            logger.error('Error getting model demand history:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get model demand history'
            });
        }
    }

    /**
     * Get serving configurations for a model type
     */
    static async getServingConfigurations(req: any, res: Response): Promise<void> {
        try {
            const { modelType } = req.params;
            const configurations = CostPerformanceProfilerService.getServingConfigurations(modelType);

            res.json({
                success: true,
                data: configurations,
                metadata: {
                    modelType,
                    totalConfigurations: configurations.length
                }
            });
        } catch (error) {
            logger.error('Error getting serving configurations:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get serving configurations'
            });
        }
    }

    /**
     * Get model configuration with recommendations
     */
    static async getModelConfiguration(req: any, res: Response): Promise<void> {
        try {
            const { modelId } = req.params;
            const { modelType } = req.query;

            if (!modelType) {
                res.status(400).json({
                    success: false,
                    error: 'modelType is required'
                });
                return;
            }

            const configuration = CostPerformanceProfilerService.getModelConfiguration(
                modelId,
                modelType as string
            );

            res.json({
                success: true,
                data: configuration
            });
        } catch (error) {
            logger.error('Error getting model configuration:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get model configuration'
            });
        }
    }

    /**
     * Analyze cost-performance for a model
     */
    static async analyzeCostPerformance(req: any, res: Response): Promise<void> {
        try {
            const { modelId } = req.params;
            const { modelType, currentLoad, predictedLoad } = req.body;

            if (!modelType || currentLoad === undefined || predictedLoad === undefined) {
                res.status(400).json({
                    success: false,
                    error: 'modelType, currentLoad, and predictedLoad are required'
                });
                return;
            }

            const analysis = await CostPerformanceProfilerService.analyzeCostPerformance(
                modelId,
                modelType,
                currentLoad,
                predictedLoad
            );

            res.json({
                success: true,
                data: analysis
            });
        } catch (error) {
            logger.error('Error analyzing cost performance:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to analyze cost performance'
            });
        }
    }

    /**
     * Get scaling recommendations for all models
     */
    static async getScalingRecommendations(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { hoursAhead = 4 } = req.query;
            const recommendations = await RecommendationEngineService.generateRecommendations(
                userId,
                parseInt(hoursAhead as string, 10)
            );

            const summary = RecommendationEngineService.getRecommendationSummary(recommendations);

            res.json({
                success: true,
                data: {
                    recommendations,
                    summary
                },
                metadata: {
                    totalRecommendations: recommendations.length,
                    hoursAhead: parseInt(hoursAhead as string, 10),
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting scaling recommendations:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get scaling recommendations'
            });
        }
    }

    /**
     * Get alerts based on recommendations
     */
    static async getAlerts(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { hoursAhead = 4 } = req.query;
            const recommendations = await RecommendationEngineService.generateRecommendations(
                userId,
                parseInt(hoursAhead as string, 10)
            );

            const alerts = RecommendationEngineService.generateAlerts(recommendations);

            res.json({
                success: true,
                data: alerts,
                metadata: {
                    totalAlerts: alerts.length,
                    criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
                    highPriorityAlerts: alerts.filter(a => a.severity === 'error').length,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting alerts:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get alerts'
            });
        }
    }

    /**
     * Execute a scaling recommendation
     */
    static async executeRecommendation(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { recommendationId } = req.params;
            const { dryRun = true } = req.body;

            const result = await RecommendationEngineService.executeRecommendation(
                recommendationId,
                userId,
                dryRun
            );

            res.json({
                success: result.success,
                data: result,
                metadata: {
                    recommendationId,
                    dryRun,
                    executedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error executing recommendation:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to execute recommendation'
            });
        }
    }

    /**
     * Get cost calculation for a configuration
     */
    static async calculateCost(req: any, res: Response): Promise<void> {
        try {
            const { configurationId, requestsPerHour } = req.body;

            if (!configurationId || requestsPerHour === undefined) {
                res.status(400).json({
                    success: false,
                    error: 'configurationId and requestsPerHour are required'
                });
                return;
            }

            // Get all configurations to find the specified one
            const allConfigurations = CostPerformanceProfilerService.getServingConfigurations('custom');
            const configuration = allConfigurations.find(c => c.id === configurationId);

            if (!configuration) {
                res.status(404).json({
                    success: false,
                    error: 'Configuration not found'
                });
                return;
            }

            const cost = CostPerformanceProfilerService.calculateCostForConfiguration(
                configuration,
                requestsPerHour
            );

            res.json({
                success: true,
                data: {
                    configuration,
                    requestsPerHour,
                    hourlyCost: cost,
                    dailyCost: cost * 24,
                    monthlyCost: cost * 24 * 30
                }
            });
        } catch (error) {
            logger.error('Error calculating cost:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to calculate cost'
            });
        }
    }

    /**
     * Get dashboard overview
     */
    static async getDashboardOverview(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { hoursAhead = 4 } = req.query;

            // Get all data in parallel
            const [predictions, recommendations] = await Promise.all([
                DemandPredictorService.getAllModelDemandPredictions(userId, parseInt(hoursAhead as string, 10)),
                RecommendationEngineService.generateRecommendations(userId, parseInt(hoursAhead as string, 10))
            ]);

            const summary = RecommendationEngineService.getRecommendationSummary(recommendations);
            const alerts = RecommendationEngineService.generateAlerts(recommendations);

            // Calculate overall metrics
            const totalCurrentLoad = predictions.reduce((sum, p) => sum + p.currentLoad, 0);
            const totalPredictedLoad = predictions.reduce((sum, p) => sum + p.predictedLoad, 0);
            const averageConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

            res.json({
                success: true,
                data: {
                    overview: {
                        totalModels: predictions.length,
                        totalCurrentLoad,
                        totalPredictedLoad,
                        averageConfidence,
                        loadTrend: totalPredictedLoad > totalCurrentLoad ? 'increasing' :
                            totalPredictedLoad < totalCurrentLoad ? 'decreasing' : 'stable'
                    },
                    predictions,
                    recommendations,
                    summary,
                    alerts
                },
                metadata: {
                    hoursAhead: parseInt(hoursAhead as string, 10),
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error) {
            logger.error('Error getting dashboard overview:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get dashboard overview'
            });
        }
    }
} 