import { Request, Response } from 'express';
import { AutoSimulationService, AutoSimulationSettings } from '../services/autoSimulation.service';
import { logger } from '../utils/logger';

export class AutoSimulationController {
    
    /**
     * Get user's auto-simulation settings
     */
    static async getUserSettings(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

            const settings = await AutoSimulationService.getUserSettings(userId);
            
            // Return default settings if none exist
            const defaultSettings: AutoSimulationSettings = {
                userId,
                enabled: false,
                triggers: {
                    costThreshold: 0.01,
                    tokenThreshold: 1000,
                    expensiveModels: ['gpt-4', 'claude-3-opus'],
                    allCalls: false
                },
                autoOptimize: {
                    enabled: false,
                    approvalRequired: true,
                    maxSavingsThreshold: 0.50,
                    riskTolerance: 'medium'
                },
                notifications: {
                    email: true,
                    dashboard: true,
                    slack: false
                }
            };

            return res.status(200).json({
                success: true,
                data: settings || defaultSettings
            });
        } catch (error) {
            logger.error('Error in getUserSettings controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update user's auto-simulation settings
     */
    static async updateUserSettings(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

            const settings = req.body as Partial<AutoSimulationSettings>;
            
            // Validate settings
            if (settings.triggers?.costThreshold !== undefined && settings.triggers.costThreshold < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cost threshold must be non-negative'
                });
            }

            if (settings.triggers?.tokenThreshold !== undefined && settings.triggers.tokenThreshold < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Token threshold must be non-negative'
                });
            }

            if (settings.autoOptimize?.maxSavingsThreshold !== undefined && 
                (settings.autoOptimize.maxSavingsThreshold < 0 || settings.autoOptimize.maxSavingsThreshold > 1)) {
                return res.status(400).json({
                    success: false,
                    message: 'Max savings threshold must be between 0 and 1'
                });
            }

            await AutoSimulationService.updateUserSettings(userId, settings);

            return res.status(200).json({
                success: true,
                message: 'Settings updated successfully'
            });
        } catch (error) {
            logger.error('Error in updateUserSettings controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get user's simulation queue
     */
    static async getUserQueue(req: Request, res: Response): Promise<Response> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

            const { status, limit = 20 } = req.query;

            const queue = await AutoSimulationService.getUserQueue(
                userId,
                status as string,
                parseInt(limit as string)
            );

            return res.status(200).json({
                success: true,
                data: queue
            });
        } catch (error) {
            logger.error('Error in getUserQueue controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Handle optimization approval/rejection
     */
    static async handleOptimizationApproval(req: Request, res: Response): Promise<Response> {
        try {
            const { queueItemId } = req.params;
            const { approved, selectedOptimizations } = req.body;

            if (!queueItemId) {
                return res.status(400).json({
                    success: false,
                    message: 'Queue item ID is required'
                });
            }

            if (typeof approved !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: 'Approved field must be a boolean'
                });
            }

            await AutoSimulationService.handleOptimizationApproval(
                queueItemId,
                approved,
                selectedOptimizations
            );

            return res.status(200).json({
                success: true,
                message: approved ? 'Optimization approved' : 'Optimization rejected'
            });
        } catch (error) {
            logger.error('Error in handleOptimizationApproval controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Manually trigger simulation for a usage
     */
    static async triggerSimulation(req: Request, res: Response): Promise<Response> {
        try {
            const { usageId } = req.params;

            if (!usageId) {
                return res.status(400).json({
                    success: false,
                    message: 'Usage ID is required'
                });
            }

            const queueItemId = await AutoSimulationService.queueForSimulation(usageId);

            if (!queueItemId) {
                return res.status(400).json({
                    success: false,
                    message: 'Failed to queue simulation'
                });
            }

            return res.status(201).json({
                success: true,
                message: 'Simulation queued successfully',
                data: { queueItemId }
            });
        } catch (error) {
            logger.error('Error in triggerSimulation controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Process queue manually (admin endpoint)
     */
    static async processQueue(_req: Request, res: Response): Promise<Response> {
        try {
            // This could be restricted to admin users
            await AutoSimulationService.processQueue();

            return res.status(200).json({
                success: true,
                message: 'Queue processing initiated'
            });
        } catch (error) {
            logger.error('Error in processQueue controller:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

export default AutoSimulationController;