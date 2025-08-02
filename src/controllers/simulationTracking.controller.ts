import { Request, Response } from 'express';
import { SimulationTrackingService, SimulationTrackingData, OptimizationApplication } from '../services/simulationTracking.service';
import { logger } from '../utils/logger';

export class SimulationTrackingController {
    
    /**
     * Track a new simulation
     */
    static async trackSimulation(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

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

            // Validate required fields
            if (!sessionId || !simulationType || !originalModel || !originalPrompt || 
                originalCost === undefined || originalTokens === undefined ||
                potentialSavings === undefined || confidence === undefined) {
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

            return res.status(201).json({
                success: true,
                message: 'Simulation tracked successfully',
                data: { trackingId }
            });
        } catch (error) {
            logger.error('Error in trackSimulation controller:', error);
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
        try {
            const { trackingId } = req.params;
            const {
                optionIndex,
                type,
                estimatedSavings,
                userFeedback
            } = req.body;

            if (!trackingId || optionIndex === undefined || !type || estimatedSavings === undefined) {
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

            return res.status(200).json({
                success: true,
                message: 'Optimization application tracked successfully'
            });
        } catch (error) {
            logger.error('Error in trackOptimizationApplication controller:', error);
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
        try {
            const { trackingId } = req.params;
            const { timeSpent, optionsViewed } = req.body;

            if (!trackingId || timeSpent === undefined) {
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

            return res.status(200).json({
                success: true,
                message: 'Viewing metrics updated successfully'
            });
        } catch (error) {
            logger.error('Error in updateViewingMetrics controller:', error);
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
        try {
            const userId = (req as any).user?.id;
            const { global, startDate, endDate } = req.query;

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

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Error in getSimulationStats controller:', error);
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
        try {
            const { startDate, endDate, limit = 10 } = req.query;

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

            return res.status(200).json({
                success: true,
                data: wins
            });
        } catch (error) {
            logger.error('Error in getTopOptimizationWins controller:', error);
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
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required'
                });
            }

            const { limit = 20, offset = 0 } = req.query;

            const history = await SimulationTrackingService.getUserSimulationHistory(
                userId,
                parseInt(limit as string),
                parseInt(offset as string)
            );

            return res.status(200).json({
                success: true,
                data: history
            });
        } catch (error) {
            logger.error('Error in getUserSimulationHistory controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

export default SimulationTrackingController;