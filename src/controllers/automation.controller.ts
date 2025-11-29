import { Response } from 'express';
import { AutomationService } from '../services/automation.service';
import { AutomationConnection } from '../models/AutomationConnection';
import { loggingService } from '../services/logging.service';
import mongoose from 'mongoose';

export class AutomationController {
    /**
     * Handle incoming webhook from automation platforms
     * POST /api/automation/webhook/:connectionId?
     */
    static async handleWebhook(req: any, res: Response): Promise<Response> {
        const startTime = Date.now();
        try {
            const userId = req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'User authentication required'
                });
            }

            const { connectionId } = req.params;
            const payload = req.body;

            loggingService.info('Automation webhook received', {
                component: 'AutomationController',
                operation: 'handleWebhook',
                userId,
                connectionId,
                platform: payload?.platform,
                workflowId: payload?.workflowId
            });

            // Process webhook data (supports both single and batch)
            const usage = await AutomationService.processWebhookData(
                userId,
                connectionId || null,
                payload
            );

            const duration = Date.now() - startTime;
            
            // Handle both single and batch responses
            if (Array.isArray(usage)) {
                // Batch/multi-step response
                const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
                const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0);
                
                loggingService.info('Automation batch webhook processed successfully', {
                    component: 'AutomationController',
                    operation: 'handleWebhook',
                    userId,
                    connectionId,
                    duration,
                    stepCount: usage.length,
                    totalCost,
                    totalTokens
                });

                return res.status(200).json({
                    success: true,
                    message: 'Batch webhook processed successfully',
                    data: {
                        usageIds: usage.map(u => u._id),
                        stepCount: usage.length,
                        totalCost,
                        totalTokens,
                        steps: usage.map(u => ({
                            usageId: u._id,
                            step: u.workflowStep,
                            sequence: u.workflowSequence,
                            cost: u.cost,
                            tokens: u.totalTokens,
                            isAIStep: u.metadata?.isAIStep !== false
                        }))
                    }
                });
            } else {
                // Single step response
                loggingService.info('Automation webhook processed successfully', {
                    component: 'AutomationController',
                    operation: 'handleWebhook',
                    userId,
                    connectionId,
                    duration,
                    usageId: usage._id
                });

                return res.status(200).json({
                    success: true,
                    message: 'Webhook processed successfully',
                    data: {
                        usageId: usage._id,
                        cost: usage.cost,
                        tokens: usage.totalTokens
                    }
                });
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            loggingService.error('Error handling automation webhook', {
                component: 'AutomationController',
                operation: 'handleWebhook',
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            return res.status(400).json({
                success: false,
                error: 'Webhook processing failed',
                message: error.message || 'Failed to process webhook'
            });
        }
    }

    /**
     * Create a new automation connection
     * POST /api/automation/connections
     */
    static async createConnection(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { platform, name, description, apiKey } = req.body;

            if (!platform || !['zapier', 'make', 'n8n'].includes(platform)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid platform. Must be zapier, make, or n8n'
                });
            }

            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Name is required'
                });
            }

            // Generate connection ID and webhook URL
            const connectionId = AutomationService.generateConnectionId();
            const webhookUrl = AutomationService.generateWebhookUrl(connectionId);

            // Create connection with explicit _id
            const connection = new AutomationConnection({
                _id: connectionId,
                userId: new mongoose.Types.ObjectId(userId),
                platform,
                name: name.trim(),
                description: description?.trim(),
                webhookUrl,
                apiKey: apiKey?.trim(),
                status: 'active'
            });

            await connection.save();

            loggingService.info('Automation connection created', {
                component: 'AutomationController',
                operation: 'createConnection',
                userId,
                connectionId: connection._id,
                platform
            });

            return res.status(201).json({
                success: true,
                message: 'Connection created successfully',
                data: {
                    id: connection._id,
                    platform: connection.platform,
                    name: connection.name,
                    description: connection.description,
                    webhookUrl: connection.webhookUrl,
                    status: connection.status,
                    stats: connection.stats,
                    createdAt: connection.createdAt
                }
            });
        } catch (error: any) {
            loggingService.error('Error creating automation connection', {
                component: 'AutomationController',
                operation: 'createConnection',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to create connection'
            });
        }
    }

    /**
     * Get all automation connections for the user
     * GET /api/automation/connections
     */
    static async getConnections(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { platform, status } = req.query;

            const query: any = {
                userId: new mongoose.Types.ObjectId(userId)
            };

            if (platform && ['zapier', 'make', 'n8n'].includes(platform as string)) {
                query.platform = platform;
            }

            if (status && ['active', 'inactive', 'error'].includes(status as string)) {
                query.status = status;
            }

            const connections = await AutomationConnection.find(query).sort({ createdAt: -1 });

            const formattedConnections = connections.map(conn => ({
                id: conn._id,
                platform: conn.platform,
                name: conn.name,
                description: conn.description,
                webhookUrl: conn.webhookUrl,
                status: conn.status,
                stats: conn.stats,
                metadata: conn.metadata,
                healthCheckStatus: conn.healthCheckStatus,
                lastHealthCheck: conn.lastHealthCheck,
                errorMessage: conn.errorMessage,
                createdAt: conn.createdAt,
                updatedAt: conn.updatedAt
            }));

            return res.status(200).json({
                success: true,
                data: formattedConnections,
                count: formattedConnections.length
            });
        } catch (error: any) {
            loggingService.error('Error getting automation connections', {
                component: 'AutomationController',
                operation: 'getConnections',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get connections'
            });
        }
    }

    /**
     * Get a specific automation connection
     * GET /api/automation/connections/:id
     */
    static async getConnection(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const connection = await AutomationConnection.findOne({
                _id: id,
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!connection) {
                return res.status(404).json({
                    success: false,
                    message: 'Connection not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: {
                    id: connection._id,
                    platform: connection.platform,
                    name: connection.name,
                    description: connection.description,
                    webhookUrl: connection.webhookUrl,
                    status: connection.status,
                    stats: connection.stats,
                    metadata: connection.metadata,
                    healthCheckStatus: connection.healthCheckStatus,
                    lastHealthCheck: connection.lastHealthCheck,
                    errorMessage: connection.errorMessage,
                    createdAt: connection.createdAt,
                    updatedAt: connection.updatedAt
                }
            });
        } catch (error: any) {
            loggingService.error('Error getting automation connection', {
                component: 'AutomationController',
                operation: 'getConnection',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get connection'
            });
        }
    }

    /**
     * Update an automation connection
     * PUT /api/automation/connections/:id
     */
    static async updateConnection(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;
            const { name, description, status, apiKey } = req.body;

            const connection = await AutomationConnection.findOne({
                _id: id,
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!connection) {
                return res.status(404).json({
                    success: false,
                    message: 'Connection not found'
                });
            }

            if (name !== undefined) {
                if (typeof name !== 'string' || name.trim().length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Name must be a non-empty string'
                    });
                }
                connection.name = name.trim();
            }

            if (description !== undefined) {
                connection.description = description?.trim();
            }

            if (status !== undefined) {
                if (!['active', 'inactive', 'error'].includes(status)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid status. Must be active, inactive, or error'
                    });
                }
                connection.status = status;
            }

            if (apiKey !== undefined) {
                connection.apiKey = apiKey?.trim();
            }

            await connection.save();

            loggingService.info('Automation connection updated', {
                component: 'AutomationController',
                operation: 'updateConnection',
                userId,
                connectionId: id
            });

            return res.status(200).json({
                success: true,
                message: 'Connection updated successfully',
                data: {
                    id: connection._id,
                    platform: connection.platform,
                    name: connection.name,
                    description: connection.description,
                    webhookUrl: connection.webhookUrl,
                    status: connection.status,
                    stats: connection.stats,
                    updatedAt: connection.updatedAt
                }
            });
        } catch (error: any) {
            loggingService.error('Error updating automation connection', {
                component: 'AutomationController',
                operation: 'updateConnection',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to update connection'
            });
        }
    }

    /**
     * Delete an automation connection
     * DELETE /api/automation/connections/:id
     */
    static async deleteConnection(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const connection = await AutomationConnection.findOne({
                _id: id,
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!connection) {
                return res.status(404).json({
                    success: false,
                    message: 'Connection not found'
                });
            }

            await connection.deleteOne();

            loggingService.info('Automation connection deleted', {
                component: 'AutomationController',
                operation: 'deleteConnection',
                userId,
                connectionId: id
            });

            return res.status(200).json({
                success: true,
                message: 'Connection deleted successfully'
            });
        } catch (error: any) {
            loggingService.error('Error deleting automation connection', {
                component: 'AutomationController',
                operation: 'deleteConnection',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to delete connection'
            });
        }
    }

    /**
     * Get automation analytics
     * GET /api/automation/analytics
     */
    static async getAnalytics(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { startDate, endDate, platform, workflowId } = req.query;

            const options: any = {};
            if (startDate) options.startDate = new Date(startDate as string);
            if (endDate) options.endDate = new Date(endDate as string);
            if (platform && ['zapier', 'make', 'n8n'].includes(platform as string)) {
                options.platform = platform;
            }
            if (workflowId) options.workflowId = workflowId as string;

            const analytics = await AutomationService.getAutomationAnalytics(userId, options);

            return res.status(200).json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            loggingService.error('Error getting automation analytics', {
                component: 'AutomationController',
                operation: 'getAnalytics',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get analytics'
            });
        }
    }

    /**
     * Get automation statistics
     * GET /api/automation/stats
     */
    static async getStats(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const stats = await AutomationService.getAutomationStats(userId);

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            loggingService.error('Error getting automation stats', {
                component: 'AutomationController',
                operation: 'getStats',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get stats'
            });
        }
    }

    /**
     * Get connection statistics
     * GET /api/automation/connections/:id/stats
     */
    static async getConnectionStats(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const stats = await AutomationService.getConnectionStats(id, userId);

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            loggingService.error('Error getting connection stats', {
                component: 'AutomationController',
                operation: 'getConnectionStats',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get connection stats'
            });
        }
    }
}

