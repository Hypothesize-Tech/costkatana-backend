import { Request, Response } from 'express';
import { AutoSimulationService, AutoSimulationSettings } from '../services/autoSimulation.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class AutoSimulationController {
    
    /**
     * Get user's auto-simulation settings
     */
    static async getUserSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getUserSettings', req);

        try {

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

            const hasCustomSettings = !!settings;

            // Log business event
            const duration = Date.now() - startTime;
            loggingService.logBusiness({
                event: 'auto_simulation_settings_retrieved',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    userId,
                    hasCustomSettings
                }
            });

            ControllerHelper.logRequestSuccess('getUserSettings', req, startTime, {
                hasCustomSettings
            });

            return res.status(200).json({
                success: true,
                data: settings || defaultSettings
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserSettings', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Update user's auto-simulation settings
     */
    static async updateUserSettings(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const settings = req.body as Partial<AutoSimulationSettings>;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('updateUserSettings', req, {
            hasTriggers: !!settings.triggers,
            hasAutoOptimize: !!settings.autoOptimize,
            hasNotifications: !!settings.notifications
        });

        try {
            
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

            ControllerHelper.logRequestSuccess('updateUserSettings', req, startTime, {
                hasTriggers: !!settings.triggers,
                hasAutoOptimize: !!settings.autoOptimize,
                hasNotifications: !!settings.notifications
            });

            return res.status(200).json({
                success: true,
                message: 'Settings updated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateUserSettings', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get user's simulation queue
     */
    static async getUserQueue(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { status, limit = 20 } = req.query;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getUserQueue', req, {
            status: status as string,
            limit: parseInt(limit as string)
        });

        try {

            const queue = await AutoSimulationService.getUserQueue(
                userId,
                status as string,
                parseInt(limit as string)
            );

            const duration = Date.now() - startTime;

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

            ControllerHelper.logRequestSuccess('getUserQueue', req, startTime, {
                queueLength: queue.length,
                status: status as string
            });

            return res.status(200).json({
                success: true,
                data: queue
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserQueue', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Handle optimization approval/rejection
     */
    static async handleOptimizationApproval(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { queueItemId } = req.params;
        const { approved, selectedOptimizations } = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('handleOptimizationApproval', req, {
            queueItemId,
            approved
        });

        try {
            if (queueItemId) {
                ServiceHelper.validateObjectId(queueItemId, 'queueItemId');
            }

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

            ControllerHelper.logRequestSuccess('handleOptimizationApproval', req, startTime, {
                queueItemId,
                approved
            });

            return res.status(200).json({
                success: true,
                message: approved ? 'Optimization approved' : 'Optimization rejected'
            });
        } catch (error: any) {
            ControllerHelper.handleError('handleOptimizationApproval', error, req, res, startTime, { queueItemId });
            return res;
        }
    }

    /**
     * Manually trigger simulation for a usage
     */
    static async triggerSimulation(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { usageId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('triggerSimulation', req, { usageId });

        try {
            if (!usageId) {
                return res.status(400).json({
                    success: false,
                    message: 'Usage ID is required'
                });
            }

            if (usageId) {
                ServiceHelper.validateObjectId(usageId, 'usageId');
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

            ControllerHelper.logRequestSuccess('triggerSimulation', req, startTime, {
                usageId,
                queueItemId
            });

            return res.status(201).json({
                success: true,
                message: 'Simulation queued successfully',
                data: { queueItemId }
            });
        } catch (error: any) {
            ControllerHelper.handleError('triggerSimulation', error, req, res, startTime, { usageId });
            return res;
        }
    }

    /**
     * Process queue manually (admin endpoint)
     */
    static async processQueue(_req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();

        try {
            // This could be restricted to admin users
            await AutoSimulationService.processQueue();

            const duration = Date.now() - startTime;

            // Log business event
            loggingService.logBusiness({
                event: 'queue_processing_manual',
                category: 'simulation_management',
                value: duration,
                metadata: {
                    manualTrigger: true
                }
            });

            ControllerHelper.logRequestSuccess('processQueue', _req, startTime);

            return res.status(200).json({
                success: true,
                message: 'Queue processing initiated'
            });
        } catch (error: any) {
            ControllerHelper.handleError('processQueue', error, _req, res, startTime);
            return res;
        }
    }
}

export default AutoSimulationController;