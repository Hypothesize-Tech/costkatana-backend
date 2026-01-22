/**
 * Cortex Training Data Controller
 * 
 * Provides endpoints for managing and accessing Cortex training data
 * for future model training and analytics.
 */

import { Response, NextFunction } from 'express';
import { CortexTrainingDataCollectorService } from '../services/cortexTrainingDataCollector.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class CortexTrainingDataController {
    
    /**
     * Get training data statistics
     */
    static async getTrainingStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTrainingStats', req);

            const collector = CortexTrainingDataCollectorService.getInstance();
            const stats = collector.getStats();
            
            ControllerHelper.logRequestSuccess('getTrainingStats', req, startTime);
            
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            ControllerHelper.handleError('getTrainingStats', error, req, res, startTime);
        }
    }
    
    /**
     * Export training data for model training
     */
    static async exportTrainingData(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('exportTrainingData', req);

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
                filters.userId = userId;
            }
            
            const collector = CortexTrainingDataCollectorService.getInstance();
            const trainingData = await collector.exportTrainingData(filters);
            
            ControllerHelper.logRequestSuccess('exportTrainingData', req, startTime, {
                count: trainingData.length
            });
            
            res.json({
                success: true,
                data: trainingData,
                count: trainingData.length,
                filters
            });
        } catch (error) {
            ControllerHelper.handleError('exportTrainingData', error, req, res, startTime);
        }
    }
    
    /**
     * Add user feedback to training data
     */
    static async addUserFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('addUserFeedback', req);

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
            
            ServiceHelper.validateObjectId(sessionId, 'sessionId');
            
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
            
            ControllerHelper.logRequestSuccess('addUserFeedback', req, startTime, {
                sessionId
            });
            
            res.json({
                success: true,
                message: 'Feedback added successfully'
            });
        } catch (error) {
            ControllerHelper.handleError('addUserFeedback', error, req, res, startTime);
        }
    }
    
    /**
     * Get training data insights and analytics - Optimized with async background processing
     */
    static async getTrainingInsights(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTrainingInsights', req);

            // Start background processing for detailed insights
            this.generateInsightsAsync(req.query, req.user);
            
            // Return basic stats immediately using optimized approach
            const basicInsights = await this.getBasicInsightsOptimized(req.query, req.user);
            
            ControllerHelper.logRequestSuccess('getTrainingInsights', req, startTime, {
                totalSessions: basicInsights.totalSessions
            });
            
            res.json({
                success: true,
                data: basicInsights,
                filters: req.query,
                processing: true,
                message: 'Detailed insights are being generated in the background'
            });
        } catch (error) {
            ControllerHelper.handleError('getTrainingInsights', error, req, res, startTime);
        }
    }
    
    /**
     * Get basic insights using optimized approach with limited data
     */
    private static async getBasicInsightsOptimized(query: any, user: any): Promise<any> {
        const filters = this.buildFiltersFromQuery(query, user);
        const collector = CortexTrainingDataCollectorService.getInstance();
        
        // Use smaller dataset for basic stats to improve performance
        const limitedData = await collector.exportTrainingData({
            ...filters,
            limit: 1000 // Much smaller limit for basic stats
        });
        
        // Calculate basic stats from limited data
        const totalSessions = limitedData.length;
        const avgTokenReduction = totalSessions > 0 ? 
            limitedData.reduce((sum, item) => sum + (item.performance?.tokenReductionPercentage || 0), 0) / totalSessions : 0;
        const avgProcessingTime = totalSessions > 0 ?
            limitedData.reduce((sum, item) => sum + (item.performance?.totalProcessingTime || 0), 0) / totalSessions : 0;
        const avgCostSavings = totalSessions > 0 ?
            limitedData.reduce((sum, item) => sum + (item.performance?.costSavings || 0), 0) / totalSessions : 0;
        
        const complexityBreakdown = {
            simple: limitedData.filter(item => item.context?.complexity === 'simple').length,
            medium: limitedData.filter(item => item.context?.complexity === 'medium').length,
            complex: limitedData.filter(item => item.context?.complexity === 'complex').length
        };
        
        const successfulSessions = limitedData.filter(item => item.trainingLabels?.isSuccessful !== false).length;
        const successRate = totalSessions > 0 ? successfulSessions / totalSessions : 0;
        
        const ratedItems = limitedData.filter(item => item.trainingLabels?.userFeedback);
        const averageUserRating = ratedItems.length > 0 ? 
            ratedItems.reduce((sum, item) => sum + (item.trainingLabels?.userFeedback || 0), 0) / ratedItems.length : 0;

        return {
            totalSessions,
            averageTokenReduction: Math.round(avgTokenReduction * 100) / 100,
            averageProcessingTime: Math.round(avgProcessingTime * 100) / 100,
            averageCostSavings: Math.round(avgCostSavings * 10000) / 10000,
            complexityBreakdown,
            successRate: Math.round(successRate * 10000) / 10000,
            averageUserRating: Math.round(averageUserRating * 100) / 100,
            modelUsage: {
                encoder: { usage: {}, averageProcessingTime: {} },
                coreProcessor: { usage: {}, averageProcessingTime: {} },
                decoder: { usage: {}, averageProcessingTime: {} }
            },
            isBasicStats: true
        };
    }

    /**
     * Generate detailed insights asynchronously in background
     */
    private static async generateInsightsAsync(query: any, user: any): Promise<void> {
        try {
            const filters = this.buildFiltersFromQuery(query, user);
            const collector = CortexTrainingDataCollectorService.getInstance();
            
            // Get full dataset for detailed analysis
            const trainingData = await collector.exportTrainingData({
                ...filters,
                limit: 10000 // Full dataset for detailed insights
            });
            
            // Calculate detailed insights (same as original logic to maintain compatibility)
            const insights = {
                totalSessions: trainingData.length,
                averageTokenReduction: trainingData.length > 0 ?
                    trainingData.reduce((sum, item) => sum + (item.performance?.tokenReductionPercentage || 0), 0) / trainingData.length : 0,
                averageProcessingTime: trainingData.length > 0 ?
                    trainingData.reduce((sum, item) => sum + (item.performance?.totalProcessingTime || 0), 0) / trainingData.length : 0,
                averageCostSavings: trainingData.length > 0 ?
                    trainingData.reduce((sum, item) => sum + (item.performance?.costSavings || 0), 0) / trainingData.length : 0,
                complexityBreakdown: {
                    simple: trainingData.filter(item => item.context?.complexity === 'simple').length,
                    medium: trainingData.filter(item => item.context?.complexity === 'medium').length,
                    complex: trainingData.filter(item => item.context?.complexity === 'complex').length
                },
                successRate: trainingData.length > 0 ?
                    trainingData.filter(item => item.trainingLabels?.isSuccessful !== false).length / trainingData.length : 0,
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
                },
                isBasicStats: false
            };
            
            loggingService.info('Detailed training insights generated in background', {
                userId: user?.id,
                totalSessions: insights.totalSessions
            });
        } catch (error) {
            loggingService.error('Background insights generation failed', {
                error: error instanceof Error ? error.message : String(error),
                userId: user?.id
            });
        }
    }

    /**
     * Build filters object from query parameters
     */
    private static buildFiltersFromQuery(query: any, user: any): any {
        const filters: any = {};
        
        if (query.startDate) filters.startDate = new Date(query.startDate);
        if (query.endDate) filters.endDate = new Date(query.endDate);
        if (query.complexity) filters.complexity = query.complexity;
        if (user?.role !== 'admin') filters.userId = user?.id;
        
        return filters;
    }


    /**
     * Helper method to calculate model usage statistics - Optimized
     */
    private static getModelUsageStats(trainingData: any[], stage: string): any {
        const modelCounts: { [key: string]: number } = {};
        const modelPerformance: { [key: string]: { totalTime: number, count: number } } = {};
        
        // Single pass through the data
        trainingData.forEach(item => {
            const stageData = item[stage];
            if (stageData?.model) {
                const model = stageData.model;
                
                // Update counts
                modelCounts[model] = (modelCounts[model] || 0) + 1;
                
                // Update performance tracking
                if (!modelPerformance[model]) {
                    modelPerformance[model] = { totalTime: 0, count: 0 };
                }
                modelPerformance[model].totalTime += stageData.processingTime || 0;
                modelPerformance[model].count += 1;
            }
        });
        
        // Calculate averages in single pass
        const averageProcessingTime: { [key: string]: number } = {};
        Object.keys(modelPerformance).forEach(model => {
            const perf = modelPerformance[model];
            averageProcessingTime[model] = perf.count > 0 ? 
                Math.round((perf.totalTime / perf.count) * 100) / 100 : 0;
        });
        
        return {
            usage: modelCounts,
            averageProcessingTime
        };
    }
}

