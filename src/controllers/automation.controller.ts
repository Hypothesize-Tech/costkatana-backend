import { Response } from 'express';
import { AutomationService } from '../services/automation.service';
import { AutomationConnection } from '../models/AutomationConnection';
import { loggingService } from '../services/logging.service';
import { GuardrailsService } from '../services/guardrails.service';
import { WorkflowOptimizationService } from '../services/workflowOptimization.service';
import { WorkflowAlertingService } from '../services/workflowAlerting.service';
import { WorkflowVersioningService } from '../services/workflowVersioning.service';
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

            // Check workflow quota before creating connection
            const quotaCheck = await GuardrailsService.checkWorkflowQuota(userId);
            if (quotaCheck && quotaCheck.type === 'hard') {
                return res.status(403).json({
                    success: false,
                    message: quotaCheck.message,
                    error: 'WORKFLOW_QUOTA_EXCEEDED',
                    quota: {
                        current: quotaCheck.current,
                        limit: quotaCheck.limit,
                        percentage: quotaCheck.percentage
                    },
                    suggestions: quotaCheck.suggestions
                });
            }

            // Generate connection ID and webhook URL
            const connectionId = AutomationService.generateConnectionId();
            const webhookUrl = AutomationService.generateWebhookUrl(connectionId);

            // Get workflow quota status and store in metadata
            const quotaStatus = await AutomationService.getWorkflowQuotaStatus(userId);
            
            // Create connection with explicit _id
            const connection = new AutomationConnection({
                _id: connectionId,
                userId: new mongoose.Types.ObjectId(userId),
                platform,
                name: name.trim(),
                description: description?.trim(),
                webhookUrl,
                apiKey: apiKey?.trim(),
                status: 'active',
                metadata: {
                    workflowQuota: {
                        current: quotaStatus.current,
                        limit: quotaStatus.limit,
                        percentage: quotaStatus.percentage,
                        plan: quotaStatus.plan
                    }
                }
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
     * Get orchestration overhead analytics
     * GET /api/automation/orchestration-overhead
     */
    static async getOrchestrationOverhead(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { startDate, endDate, platform } = req.query;

            const analytics = await AutomationService.getOrchestrationOverheadAnalytics(userId, {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                platform: platform && ['zapier', 'make', 'n8n'].includes(platform as string) 
                    ? platform as 'zapier' | 'make' | 'n8n' 
                    : undefined
            });

            return res.status(200).json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            loggingService.error('Error getting orchestration overhead', {
                component: 'AutomationController',
                operation: 'getOrchestrationOverhead',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get orchestration overhead'
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
     * Get workflow quota status
     * GET /api/automation/quota
     */
    static async getWorkflowQuota(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const quotaStatus = await AutomationService.getWorkflowQuotaStatus(userId);

            return res.status(200).json({
                success: true,
                data: quotaStatus
            });
        } catch (error: any) {
            loggingService.error('Error getting workflow quota', {
                component: 'AutomationController',
                operation: 'getWorkflowQuota',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get workflow quota'
            });
        }
    }

    /**
     * Get workflow optimization recommendations
     * GET /api/automation/workflows/:workflowId/recommendations
     */
    static async getWorkflowRecommendations(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { workflowId } = req.params;
            const { startDate, endDate } = req.query;

            const recommendations = await WorkflowOptimizationService.getWorkflowOptimizationRecommendations(
                userId,
                workflowId,
                startDate ? new Date(startDate as string) : undefined,
                endDate ? new Date(endDate as string) : undefined
            );

            return res.status(200).json({
                success: true,
                data: {
                    workflowId,
                    recommendations,
                    totalPotentialSavings: recommendations.reduce((sum, r) => sum + r.potentialSavings, 0)
                }
            });
        } catch (error: any) {
            loggingService.error('Error getting workflow recommendations', {
                component: 'AutomationController',
                operation: 'getWorkflowRecommendations',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get workflow recommendations'
            });
        }
    }

    /**
     * Get workflow performance metrics
     * GET /api/automation/workflows/:workflowId/metrics
     */
    static async getWorkflowMetrics(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { workflowId } = req.params;
            const { startDate, endDate } = req.query;

            const metrics = await WorkflowOptimizationService.getWorkflowPerformanceMetrics(
                userId,
                workflowId,
                startDate ? new Date(startDate as string) : undefined,
                endDate ? new Date(endDate as string) : undefined
            );

            if (!metrics) {
                return res.status(404).json({
                    success: false,
                    message: 'Workflow not found or has no usage data'
                });
            }

            return res.status(200).json({
                success: true,
                data: metrics
            });
        } catch (error: any) {
            loggingService.error('Error getting workflow metrics', {
                component: 'AutomationController',
                operation: 'getWorkflowMetrics',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get workflow metrics'
            });
        }
    }

    /**
     * Get all workflow recommendations
     * GET /api/automation/recommendations
     */
    static async getAllRecommendations(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { startDate, endDate } = req.query;

            const recommendations = await WorkflowOptimizationService.getAllWorkflowRecommendations(
                userId,
                startDate ? new Date(startDate as string) : undefined,
                endDate ? new Date(endDate as string) : undefined
            );

            return res.status(200).json({
                success: true,
                data: {
                    workflows: recommendations,
                    totalWorkflows: recommendations.length,
                    totalPotentialSavings: recommendations.reduce((sum, w) => sum + w.totalPotentialSavings, 0)
                }
            });
        } catch (error: any) {
            loggingService.error('Error getting all recommendations', {
                component: 'AutomationController',
                operation: 'getAllRecommendations',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get recommendations'
            });
        }
    }

    /**
     * Get workflow ROI metrics
     * GET /api/automation/workflows/:workflowId/roi
     */
    static async getWorkflowROI(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { workflowId } = req.params;
            const { startDate, endDate } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'startDate and endDate are required'
                });
            }

            const { ROIMetricsService } = await import('../services/roiMetrics.service');
            const roi = await ROIMetricsService.calculateWorkflowROI(
                userId,
                workflowId,
                new Date(startDate as string),
                new Date(endDate as string)
            );

            return res.status(200).json({
                success: true,
                data: roi
            });
        } catch (error: any) {
            loggingService.error('Error getting workflow ROI', {
                component: 'AutomationController',
                operation: 'getWorkflowROI',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get workflow ROI'
            });
        }
    }

    /**
     * Get workflow ROI comparison
     * GET /api/automation/workflows/roi-comparison
     */
    static async getWorkflowROIComparison(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { startDate, endDate } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'startDate and endDate are required'
                });
            }

            const { ROIMetricsService } = await import('../services/roiMetrics.service');
            const comparison = await ROIMetricsService.getWorkflowROIComparison(
                userId,
                new Date(startDate as string),
                new Date(endDate as string)
            );

            return res.status(200).json({
                success: true,
                data: {
                    workflows: comparison,
                    summary: {
                        totalWorkflows: comparison.length,
                        averageEfficiencyScore: comparison.length > 0
                            ? comparison.reduce((sum, w) => sum + w.efficiencyScore, 0) / comparison.length
                            : 0,
                        totalCost: comparison.reduce((sum, w) => sum + w.totalCost, 0),
                        totalExecutions: comparison.reduce((sum, w) => sum + w.totalExecutions, 0)
                    }
                }
            });
        } catch (error: any) {
            loggingService.error('Error getting workflow ROI comparison', {
                component: 'AutomationController',
                operation: 'getWorkflowROIComparison',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get workflow ROI comparison'
            });
        }
    }

    /**
     * Check workflow alerts
     * POST /api/automation/workflows/:workflowId/check-alerts
     */
    static async checkWorkflowAlerts(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { workflowId } = req.params;
            const config = req.body;

            const alerts = await WorkflowAlertingService.checkAllWorkflowAlerts(userId, {
                ...config,
                workflowId: workflowId || config.workflowId
            });

            return res.status(200).json({
                success: true,
                data: {
                    alerts,
                    count: alerts.length
                }
            });
        } catch (error: any) {
            loggingService.error('Error checking workflow alerts', {
                component: 'AutomationController',
                operation: 'checkWorkflowAlerts',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to check workflow alerts'
            });
        }
    }

    /**
     * Get workflow version history
     * GET /api/automation/workflows/:workflowId/versions
     */
    static async getWorkflowVersions(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { workflowId } = req.params;
            const versions = await WorkflowVersioningService.getWorkflowVersionHistory(userId, workflowId);

            return res.status(200).json({
                success: true,
                data: versions
            });
        } catch (error: any) {
            loggingService.error('Error getting workflow versions', {
                component: 'AutomationController',
                operation: 'getWorkflowVersions',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get workflow versions'
            });
        }
    }

    /**
     * Compare workflow versions
     * GET /api/automation/workflows/:workflowId/versions/compare
     */
    static async compareWorkflowVersions(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { workflowId } = req.params;
            const { version1, version2 } = req.query;

            if (!version1 || !version2) {
                return res.status(400).json({
                    success: false,
                    message: 'version1 and version2 query parameters are required'
                });
            }

            const comparison = await WorkflowVersioningService.compareWorkflowVersions(
                userId,
                workflowId,
                parseInt(version1 as string),
                parseInt(version2 as string)
            );

            if (!comparison) {
                return res.status(404).json({
                    success: false,
                    message: 'One or both versions not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: comparison
            });
        } catch (error: any) {
            loggingService.error('Error comparing workflow versions', {
                component: 'AutomationController',
                operation: 'compareWorkflowVersions',
                error: error instanceof Error ? error.message : String(error)
            });

            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to compare workflow versions'
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

