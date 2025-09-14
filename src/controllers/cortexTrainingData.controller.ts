/**
 * Cortex Training Data Controller
 * 
 * Provides endpoints for managing and accessing Cortex training data
 * for future model training and analytics.
 */

import { Response, NextFunction } from 'express';
import { CortexTrainingDataCollectorService } from '../services/cortexTrainingDataCollector.service';
import { loggingService } from '../services/logging.service';

export class CortexTrainingDataController {
    
    /**
     * Get training data statistics
     */
    static async getTrainingStats(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const collector = CortexTrainingDataCollectorService.getInstance();
            const stats = collector.getStats();
            
            loggingService.info('Training data stats retrieved', {
                userId: req.user?.id,
                stats
            });
            
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            loggingService.error('Error getting training stats', {
                error: error instanceof Error ? error.message : String(error)
            });
            next(error);
        }
    }
    
    /**
     * Export training data for model training
     */
    static async exportTrainingData(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                startDate,
                endDate,
                complexity,
                minTokenReduction,
                limit = 1000
            } = req.query;
            
            const filters: any = {};
            
            if (startDate) filters.startDate = new Date(startDate as string);
            if (endDate) filters.endDate = new Date(endDate as string);
            if (complexity) filters.complexity = complexity;
            if (minTokenReduction) filters.minTokenReduction = Number(minTokenReduction);
            if (limit) filters.limit = Number(limit);
            
            // Only allow users to export their own data unless they're admin
            if (req.user?.role !== 'admin') {
                filters.userId = req.user?.id;
            }
            
            const collector = CortexTrainingDataCollectorService.getInstance();
            const trainingData = await collector.exportTrainingData(filters);
            
            loggingService.info('Training data exported', {
                userId: req.user?.id,
                count: trainingData.length,
                filters
            });
            
            res.json({
                success: true,
                data: trainingData,
                count: trainingData.length,
                filters
            });
        } catch (error) {
            loggingService.error('Error exporting training data', {
                error: error instanceof Error ? error.message : String(error),
                userId: req.user?.id
            });
            next(error);
        }
    }
    
    /**
     * Add user feedback to training data
     */
    static async addUserFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { sessionId } = req.params;
            const { rating, isSuccessful, improvementSuggestions } = req.body;
            
            // Validate input
            if (!sessionId) {
                res.status(400).json({
                    success: false,
                    error: 'Session ID is required'
                });
                return;
            }
            
            if (rating !== undefined && (rating < 1 || rating > 5)) {
                res.status(400).json({
                    success: false,
                    error: 'Rating must be between 1 and 5'
                });
                return;
            }
            
            const collector = CortexTrainingDataCollectorService.getInstance();
            const feedbackData: any = {
                isSuccessful: isSuccessful !== undefined ? Boolean(isSuccessful) : true,
                improvementSuggestions: improvementSuggestions || []
            };
            
            if (rating !== undefined) {
                feedbackData.rating = Number(rating);
            }
            
            collector.addUserFeedback(sessionId, feedbackData);
            
            loggingService.info('User feedback added to training data', {
                userId: req.user?.id,
                sessionId,
                rating,
                isSuccessful
            });
            
            res.json({
                success: true,
                message: 'Feedback added successfully'
            });
        } catch (error) {
            loggingService.error('Error adding user feedback', {
                error: error instanceof Error ? error.message : String(error),
                userId: req.user?.id,
                sessionId: req.params.sessionId
            });
            next(error);
        }
    }
    
    /**
     * Get training data insights and analytics
     */
    static async getTrainingInsights(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                startDate,
                endDate,
                complexity
            } = req.query;
            
            const filters: any = {};
            if (startDate) filters.startDate = new Date(startDate as string);
            if (endDate) filters.endDate = new Date(endDate as string);
            if (complexity) filters.complexity = complexity;
            
            // Only allow users to see their own data unless they're admin
            if (req.user?.role !== 'admin') {
                filters.userId = req.user?.id;
            }
            
            const collector = CortexTrainingDataCollectorService.getInstance();
            const trainingData = await collector.exportTrainingData({
                ...filters,
                limit: 10000 // Get more data for analytics
            });
            
            // Calculate insights
            const insights = {
                totalSessions: trainingData.length,
                averageTokenReduction: trainingData.reduce((sum, item) => 
                    sum + (item.performance?.tokenReductionPercentage || 0), 0) / trainingData.length,
                averageProcessingTime: trainingData.reduce((sum, item) => 
                    sum + (item.performance?.totalProcessingTime || 0), 0) / trainingData.length,
                averageCostSavings: trainingData.reduce((sum, item) => 
                    sum + (item.performance?.costSavings || 0), 0) / trainingData.length,
                complexityBreakdown: {
                    simple: trainingData.filter(item => item.context?.complexity === 'simple').length,
                    medium: trainingData.filter(item => item.context?.complexity === 'medium').length,
                    complex: trainingData.filter(item => item.context?.complexity === 'complex').length
                },
                successRate: trainingData.filter(item => 
                    item.trainingLabels?.isSuccessful !== false).length / trainingData.length,
                averageUserRating: (() => {
                    const ratedItems = trainingData.filter(item => item.trainingLabels?.userFeedback);
                    return ratedItems.length > 0 
                        ? ratedItems.reduce((sum, item) => sum + (item.trainingLabels?.userFeedback || 0), 0) / ratedItems.length
                        : 0;
                })(),
                modelUsage: {
                    encoder: this.getModelUsageStats(trainingData, 'encoderStage'),
                    coreProcessor: this.getModelUsageStats(trainingData, 'coreProcessorStage'),
                    decoder: this.getModelUsageStats(trainingData, 'decoderStage')
                }
            };
            
            loggingService.info('Training insights generated', {
                userId: req.user?.id,
                totalSessions: insights.totalSessions,
                averageTokenReduction: insights.averageTokenReduction
            });
            
            res.json({
                success: true,
                data: insights,
                filters
            });
        } catch (error) {
            loggingService.error('Error getting training insights', {
                error: error instanceof Error ? error.message : String(error),
                userId: req.user?.id
            });
            next(error);
        }
    }
    
    /**
     * Helper method to calculate model usage statistics
     */
    private static getModelUsageStats(trainingData: any[], stage: string): any {
        const modelCounts: { [key: string]: number } = {};
        const modelPerformance: { [key: string]: { totalTime: number, count: number } } = {};
        
        trainingData.forEach(item => {
            const stageData = item[stage];
            if (stageData?.model) {
                modelCounts[stageData.model] = (modelCounts[stageData.model] || 0) + 1;
                
                if (!modelPerformance[stageData.model]) {
                    modelPerformance[stageData.model] = { totalTime: 0, count: 0 };
                }
                modelPerformance[stageData.model].totalTime += stageData.processingTime || 0;
                modelPerformance[stageData.model].count += 1;
            }
        });
        
        return {
            usage: modelCounts,
            averageProcessingTime: Object.keys(modelPerformance).reduce((acc, model) => {
                acc[model] = modelPerformance[model].totalTime / modelPerformance[model].count;
                return acc;
            }, {} as { [key: string]: number })
        };
    }
}
