import { Request, Response } from 'express';
import { AutoSimulationService, AutoSimulationSettings } from '../services/autoSimulation.service';
import { loggingService } from '../services/logging.service';

export class AutoSimulationController {
    
    /**
     * Get user's auto-simulation settings
     */
    static async getUserSettings(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Auto-simulation settings request initiated', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Auto-simulation settings request failed - no user authentication', {
                    requestId: req.headers['x-request-id'] as string
                });

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

            const duration = Date.now() - startTime;
            const hasCustomSettings = !!settings;

            loggingService.info('Auto-simulation settings retrieved successfully', {
                userId,
                duration,
                hasCustomSettings,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'auto_simulation_settings_retrieved',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    userId,
                    hasCustomSettings
                }
            });

            return res.status(200).json({
                success: true,
                data: settings || defaultSettings
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Auto-simulation settings retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const settings = req.body as Partial<AutoSimulationSettings>;

        try {
            loggingService.info('Auto-simulation settings update initiated', {
                userId,
                hasTriggers: !!settings.triggers,
                hasAutoOptimize: !!settings.autoOptimize,
                hasNotifications: !!settings.notifications,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Auto-simulation settings update failed - no user authentication', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }
            
            // Validate settings
            if (settings.triggers?.costThreshold !== undefined && settings.triggers.costThreshold < 0) {
                loggingService.warn('Auto-simulation settings update failed - invalid cost threshold', {
                    userId,
                    costThreshold: settings.triggers.costThreshold,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Cost threshold must be non-negative'
                });
            }

            if (settings.triggers?.tokenThreshold !== undefined && settings.triggers.tokenThreshold < 0) {
                loggingService.warn('Auto-simulation settings update failed - invalid token threshold', {
                    userId,
                    tokenThreshold: settings.triggers.tokenThreshold,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Token threshold must be non-negative'
                });
            }

            if (settings.autoOptimize?.maxSavingsThreshold !== undefined && 
                (settings.autoOptimize.maxSavingsThreshold < 0 || settings.autoOptimize.maxSavingsThreshold > 1)) {
                loggingService.warn('Auto-simulation settings update failed - invalid savings threshold', {
                    userId,
                    maxSavingsThreshold: settings.autoOptimize.maxSavingsThreshold,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Max savings threshold must be between 0 and 1'
                });
            }

            await AutoSimulationService.updateUserSettings(userId, settings);

            const duration = Date.now() - startTime;

            loggingService.info('Auto-simulation settings updated successfully', {
                userId,
                duration,
                hasTriggers: !!settings.triggers,
                hasAutoOptimize: !!settings.autoOptimize,
                hasNotifications: !!settings.notifications,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'auto_simulation_settings_updated',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    userId,
                    hasTriggers: !!settings.triggers,
                    hasAutoOptimize: !!settings.autoOptimize,
                    hasNotifications: !!settings.notifications
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Settings updated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Auto-simulation settings update failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { status, limit = 20 } = req.query;

        try {
            loggingService.info('Auto-simulation queue request initiated', {
                userId,
                status: status as string,
                limit: parseInt(limit as string),
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Auto-simulation queue request failed - no user authentication', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

            const queue = await AutoSimulationService.getUserQueue(
                userId,
                status as string,
                parseInt(limit as string)
            );

            const duration = Date.now() - startTime;

            loggingService.info('Auto-simulation queue retrieved successfully', {
                userId,
                duration,
                status: status as string,
                limit: parseInt(limit as string),
                queueLength: queue.length,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'auto_simulation_queue_retrieved',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    userId,
                    status: status as string,
                    limit: parseInt(limit as string),
                    queueLength: queue.length
                }
            });

            return res.status(200).json({
                success: true,
                data: queue
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Auto-simulation queue retrieval failed', {
                userId,
                status: status as string,
                limit: parseInt(limit as string),
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const { queueItemId } = req.params;
        const { approved, selectedOptimizations } = req.body;

        try {
            loggingService.info('Optimization approval handling initiated', {
                queueItemId,
                approved,
                hasSelectedOptimizations: !!selectedOptimizations,
                selectedOptimizationsCount: selectedOptimizations?.length || 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!queueItemId) {
                loggingService.warn('Optimization approval failed - missing queue item ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Queue item ID is required'
                });
            }

            if (typeof approved !== 'boolean') {
                loggingService.warn('Optimization approval failed - invalid approved field', {
                    queueItemId,
                    approved,
                    requestId: req.headers['x-request-id'] as string
                });

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

            const duration = Date.now() - startTime;

            loggingService.info('Optimization approval handled successfully', {
                queueItemId,
                approved,
                duration,
                hasSelectedOptimizations: !!selectedOptimizations,
                selectedOptimizationsCount: selectedOptimizations?.length || 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'optimization_approval_handled',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    queueItemId,
                    approved,
                    hasSelectedOptimizations: !!selectedOptimizations,
                    selectedOptimizationsCount: selectedOptimizations?.length || 0
                }
            });

            return res.status(200).json({
                success: true,
                message: approved ? 'Optimization approved' : 'Optimization rejected'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization approval handling failed', {
                queueItemId,
                approved,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const { usageId } = req.params;

        try {
            loggingService.info('Manual simulation trigger initiated', {
                usageId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!usageId) {
                loggingService.warn('Manual simulation trigger failed - missing usage ID', {
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Usage ID is required'
                });
            }

            const queueItemId = await AutoSimulationService.queueForSimulation(usageId);

            if (!queueItemId) {
                loggingService.warn('Manual simulation trigger failed - failed to queue simulation', {
                    usageId,
                    requestId: req.headers['x-request-id'] as string
                });

                return res.status(400).json({
                    success: false,
                    message: 'Failed to queue simulation'
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('Manual simulation triggered successfully', {
                usageId,
                queueItemId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'manual_simulation_triggered',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    usageId,
                    queueItemId
                }
            });

            return res.status(201).json({
                success: true,
                message: 'Simulation queued successfully',
                data: { queueItemId }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Manual simulation trigger failed', {
                usageId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();

        try {
            loggingService.info('Queue processing initiated manually', {
                requestId: _req.headers['x-request-id'] as string
            });

            // This could be restricted to admin users
            await AutoSimulationService.processQueue();

            const duration = Date.now() - startTime;

            loggingService.info('Queue processing completed successfully', {
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'queue_processing_manual',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    manualTrigger: true
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Queue processing initiated'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Queue processing failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

export default AutoSimulationController;