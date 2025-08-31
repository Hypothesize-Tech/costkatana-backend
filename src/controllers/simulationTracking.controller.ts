import { Request, Response } from 'express';
import { SimulationTrackingService, SimulationTrackingData, OptimizationApplication } from '../services/simulationTracking.service';
import { loggingService } from '../services/logging.service';

export class SimulationTrackingController {
    
    /**
     * Track a new simulation
     */
    static async trackSimulation(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const {
            sessionId,
            originalUsageId,
            simulationType,
            originalModel,
            originalPrompt,
            originalCost,
            originalTokens,
            parameters,
            optimizationOptions,
            recommendations,
            potentialSavings,
            confidence,
            projectId
        } = req.body;

        try {
            loggingService.info('Simulation tracking initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                sessionId,
                hasSessionId: !!sessionId,
                simulationType,
                hasSimulationType: !!simulationType,
                originalModel,
                hasOriginalModel: !!originalModel,
                hasOriginalPrompt: !!originalPrompt,
                originalCost,
                originalTokens,
                hasParameters: !!parameters,
                hasOptimizationOptions: !!optimizationOptions,
                hasRecommendations: !!recommendations,
                potentialSavings,
                confidence,
                hasProjectId: !!projectId
            });

            if (!userId) {
                loggingService.warn('Simulation tracking failed - user not authenticated', {
                    requestId,
                    sessionId,
                    simulationType
                });
                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

            // Validate required fields
            if (!sessionId || !simulationType || !originalModel || !originalPrompt || 
                originalCost === undefined || originalTokens === undefined ||
                potentialSavings === undefined || confidence === undefined) {
                loggingService.warn('Simulation tracking failed - missing required fields', {
                    userId,
                    requestId,
                    sessionId,
                    simulationType,
                    originalModel,
                    hasOriginalPrompt: !!originalPrompt,
                    originalCost,
                    originalTokens,
                    potentialSavings,
                    confidence
                });
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            const trackingData: SimulationTrackingData = {
                userId,
                sessionId,
                originalUsageId,
                simulationType,
                originalModel,
                originalPrompt,
                originalCost,
                originalTokens,
                parameters,
                optimizationOptions: optimizationOptions || [],
                recommendations: recommendations || [],
                potentialSavings,
                confidence,
                userAgent: req.get('User-Agent'),
                ipAddress: req.ip,
                projectId
            };

            const trackingId = await SimulationTrackingService.trackSimulation(trackingData);
            const duration = Date.now() - startTime;

            loggingService.info('Simulation tracked successfully', {
                userId,
                duration,
                trackingId,
                sessionId,
                simulationType,
                originalModel,
                originalCost,
                originalTokens,
                potentialSavings,
                confidence,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'simulation_tracked',
                category: 'simulation',
                value: duration,
                metadata: {
                    userId,
                    trackingId,
                    simulationType,
                    originalModel,
                    potentialSavings,
                    confidence
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Simulation tracked successfully',
                data: { trackingId }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Simulation tracking failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                sessionId,
                simulationType,
                originalModel,
                originalCost,
                originalTokens,
                potentialSavings,
                confidence,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Track optimization application
     */
    static async trackOptimizationApplication(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { trackingId } = req.params;
        const {
            optionIndex,
            type,
            estimatedSavings,
            userFeedback
        } = req.body;

        try {
            loggingService.info('Optimization application tracking initiated', {
                requestId,
                trackingId,
                hasTrackingId: !!trackingId,
                optionIndex,
                hasOptionIndex: optionIndex !== undefined,
                type,
                hasType: !!type,
                estimatedSavings,
                hasEstimatedSavings: estimatedSavings !== undefined,
                hasUserFeedback: !!userFeedback
            });

            if (!trackingId || optionIndex === undefined || !type || estimatedSavings === undefined) {
                loggingService.warn('Optimization application tracking failed - missing required fields', {
                    requestId,
                    trackingId,
                    optionIndex,
                    type,
                    estimatedSavings
                });
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            const application: OptimizationApplication = {
                optionIndex,
                type,
                estimatedSavings,
                userFeedback
            };

            await SimulationTrackingService.trackOptimizationApplication(trackingId, application);
            const duration = Date.now() - startTime;

            loggingService.info('Optimization application tracked successfully', {
                requestId,
                duration,
                trackingId,
                optionIndex,
                type,
                estimatedSavings,
                hasUserFeedback: !!userFeedback
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_application_tracked',
                category: 'simulation',
                value: duration,
                metadata: {
                    trackingId,
                    optionIndex,
                    type,
                    estimatedSavings,
                    hasUserFeedback: !!userFeedback
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Optimization application tracked successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization application tracking failed', {
                requestId,
                trackingId,
                optionIndex,
                type,
                estimatedSavings,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update viewing metrics
     */
    static async updateViewingMetrics(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { trackingId } = req.params;
        const { timeSpent, optionsViewed } = req.body;

        try {
            loggingService.info('Viewing metrics update initiated', {
                requestId,
                trackingId,
                hasTrackingId: !!trackingId,
                timeSpent,
                hasTimeSpent: timeSpent !== undefined,
                hasOptionsViewed: !!optionsViewed,
                optionsViewedCount: Array.isArray(optionsViewed) ? optionsViewed.length : 0
            });

            if (!trackingId || timeSpent === undefined) {
                loggingService.warn('Viewing metrics update failed - missing required fields', {
                    requestId,
                    trackingId,
                    timeSpent
                });
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            await SimulationTrackingService.updateViewingMetrics(
                trackingId, 
                timeSpent, 
                optionsViewed || []
            );
            const duration = Date.now() - startTime;

            loggingService.info('Viewing metrics updated successfully', {
                requestId,
                duration,
                trackingId,
                timeSpent,
                hasOptionsViewed: !!optionsViewed,
                optionsViewedCount: Array.isArray(optionsViewed) ? optionsViewed.length : 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'viewing_metrics_updated',
                category: 'simulation',
                value: duration,
                metadata: {
                    trackingId,
                    timeSpent,
                    hasOptionsViewed: !!optionsViewed,
                    optionsViewedCount: Array.isArray(optionsViewed) ? optionsViewed.length : 0
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Viewing metrics updated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Viewing metrics update failed', {
                requestId,
                trackingId,
                timeSpent,
                hasOptionsViewed: !!optionsViewed,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get simulation statistics
     */
    static async getSimulationStats(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { global, startDate, endDate } = req.query;

        try {
            loggingService.info('Simulation statistics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                global,
                hasGlobal: !!global,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            let timeRange;
            if (startDate && endDate) {
                timeRange = {
                    startDate: new Date(startDate as string),
                    endDate: new Date(endDate as string)
                };
            }

            const stats = await SimulationTrackingService.getSimulationStats(
                global === 'true' ? undefined : userId,
                timeRange
            );
            const duration = Date.now() - startTime;

            loggingService.info('Simulation statistics retrieved successfully', {
                userId,
                duration,
                global,
                startDate,
                endDate,
                hasTimeRange: !!timeRange,
                hasStats: !!stats,
                requestId
            });

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Simulation statistics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                global,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get top optimization wins leaderboard
     */
    static async getTopOptimizationWins(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { startDate, endDate, limit = 10 } = req.query;

        try {
            loggingService.info('Top optimization wins retrieval initiated', {
                requestId,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate,
                limit,
                hasLimit: !!limit
            });

            let timeRange;
            if (startDate && endDate) {
                timeRange = {
                    startDate: new Date(startDate as string),
                    endDate: new Date(endDate as string)
                };
            }

            const wins = await SimulationTrackingService.getTopOptimizationWins(
                timeRange,
                parseInt(limit as string)
            );
            const duration = Date.now() - startTime;

            loggingService.info('Top optimization wins retrieved successfully', {
                requestId,
                duration,
                startDate,
                endDate,
                limit,
                hasTimeRange: !!timeRange,
                hasWins: !!wins,
                winsCount: Array.isArray(wins) ? wins.length : 0
            });

            return res.status(200).json({
                success: true,
                data: wins
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Top optimization wins retrieval failed', {
                requestId,
                startDate,
                endDate,
                limit,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get user simulation history
     */
    static async getUserSimulationHistory(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { limit = 20, offset = 0 } = req.query;

        try {
            loggingService.info('User simulation history retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                limit,
                hasLimit: !!limit,
                offset,
                hasOffset: !!offset
            });

            if (!userId) {
                loggingService.warn('User simulation history retrieval failed - user not authenticated', {
                    requestId
                });
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required'
                });
            }

            const history = await SimulationTrackingService.getUserSimulationHistory(
                userId,
                parseInt(limit as string),
                parseInt(offset as string)
            );
            const duration = Date.now() - startTime;

            loggingService.info('User simulation history retrieved successfully', {
                userId,
                duration,
                limit,
                offset,
                hasHistory: !!history,
                historyCount: Array.isArray(history) ? history.length : 0,
                requestId
            });

            return res.status(200).json({
                success: true,
                data: history
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User simulation history retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                limit,
                offset,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

export default SimulationTrackingController;