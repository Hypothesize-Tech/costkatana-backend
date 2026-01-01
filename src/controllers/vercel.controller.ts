import { Request, Response } from 'express';
import { VercelService } from '../services/vercel.service';
import { loggingService } from '../services/logging.service';

export class VercelController {
    /**
     * Initialize OAuth flow
     * GET /api/vercel/auth
     */
    static async initiateOAuth(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const authUrl = await VercelService.initiateOAuth(userId);

            loggingService.info('Vercel OAuth flow initiated', { userId });

            res.json({
                success: true,
                data: { authUrl }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate Vercel OAuth', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to initiate OAuth flow',
                error: error.message
            });
        }
    }

    /**
     * OAuth callback handler
     * GET /api/vercel/callback
     */
    static async handleOAuthCallback(req: any, res: Response): Promise<void> {
        try {
            const { code, state } = req.query;

            if (!code || !state) {
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent('Missing code or state parameter')}`);
                return;
            }

            const connection = await VercelService.handleCallback(code as string, state as string);

            // Log audit event
            loggingService.info('Vercel connection established', {
                userId: connection.userId,
                action: 'vercel.connect',
                resourceType: 'vercel_connection',
                resourceId: connection._id.toString(),
                vercelUsername: connection.vercelUsername,
                teamId: connection.teamId
            });

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations?vercelConnected=true&message=${encodeURIComponent('Vercel account connected successfully!')}`);
        } catch (error: any) {
            loggingService.error('Vercel OAuth callback failed', {
                error: error.message,
                stack: error.stack
            });

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(error.message || 'OAuth callback failed')}`);
        }
    }

    /**
     * List user's Vercel connections
     * GET /api/vercel/connections
     */
    static async listConnections(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const connections = await VercelService.listConnections(userId);

            res.json({
                success: true,
                data: connections
            });
        } catch (error: any) {
            loggingService.error('Failed to list Vercel connections', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to list connections',
                error: error.message
            });
        }
    }

    /**
     * Disconnect Vercel account
     * DELETE /api/vercel/connections/:id
     */
    static async disconnectConnection(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            await VercelService.disconnectConnection(id, userId);

            // Log audit event
            loggingService.info('Vercel connection disconnected', {
                userId,
                action: 'vercel.disconnect',
                resourceType: 'vercel_connection',
                resourceId: id
            });

            res.json({
                success: true,
                message: 'Vercel connection disconnected successfully'
            });
        } catch (error: any) {
            loggingService.error('Failed to disconnect Vercel connection', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to disconnect connection',
                error: error.message
            });
        }
    }

    /**
     * Get projects for a connection
     * GET /api/vercel/connections/:id/projects
     */
    static async getProjects(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const refresh = req.query.refresh === 'true';

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const projects = await VercelService.getProjects(id, refresh);

            res.json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            loggingService.error('Failed to get Vercel projects', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get projects',
                error: error.message
            });
        }
    }

    /**
     * Get project details
     * GET /api/vercel/connections/:id/projects/:projectId
     */
    static async getProject(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const project = await VercelService.getProject(id, projectId);

            res.json({
                success: true,
                data: project
            });
        } catch (error: any) {
            loggingService.error('Failed to get Vercel project', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get project',
                error: error.message
            });
        }
    }

    /**
     * Get deployments for a project
     * GET /api/vercel/connections/:id/projects/:projectId/deployments
     */
    static async getDeployments(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const deployments = await VercelService.getDeployments(id, projectId, limit);

            res.json({
                success: true,
                data: deployments
            });
        } catch (error: any) {
            loggingService.error('Failed to get Vercel deployments', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get deployments',
                error: error.message
            });
        }
    }

    /**
     * Trigger a new deployment
     * POST /api/vercel/connections/:id/projects/:projectId/deploy
     */
    static async triggerDeployment(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;
            const options = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const deployment = await VercelService.triggerDeployment(id, projectId, options);

            // Log audit event
            loggingService.info('Vercel deployment triggered', {
                userId,
                action: 'vercel.deploy',
                resourceType: 'vercel_deployment',
                resourceId: deployment.uid,
                projectId,
                target: options?.target || 'preview'
            });

            res.json({
                success: true,
                data: deployment
            });
        } catch (error: any) {
            loggingService.error('Failed to trigger Vercel deployment', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to trigger deployment',
                error: error.message
            });
        }
    }

    /**
     * Get deployment logs
     * GET /api/vercel/connections/:id/deployments/:deploymentId/logs
     */
    static async getDeploymentLogs(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, deploymentId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const logs = await VercelService.getDeploymentLogs(id, deploymentId);

            res.json({
                success: true,
                data: logs
            });
        } catch (error: any) {
            loggingService.error('Failed to get deployment logs', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get deployment logs',
                error: error.message
            });
        }
    }

    /**
     * Rollback to a previous deployment
     * POST /api/vercel/connections/:id/deployments/:deploymentId/rollback
     */
    static async rollbackDeployment(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, deploymentId } = req.params;
            const { projectId } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!projectId) {
                res.status(400).json({
                    success: false,
                    message: 'Project ID is required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const deployment = await VercelService.rollbackDeployment(id, projectId, deploymentId);

            // Log audit event
            loggingService.info('Vercel deployment rolled back', {
                userId,
                action: 'vercel.rollback',
                resourceType: 'vercel_deployment',
                resourceId: deploymentId,
                projectId
            });

            res.json({
                success: true,
                data: deployment
            });
        } catch (error: any) {
            loggingService.error('Failed to rollback deployment', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to rollback deployment',
                error: error.message
            });
        }
    }

    /**
     * Promote deployment to production
     * POST /api/vercel/connections/:id/deployments/:deploymentId/promote
     */
    static async promoteDeployment(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, deploymentId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const deployment = await VercelService.promoteDeployment(id, deploymentId);

            // Log audit event
            loggingService.info('Vercel deployment promoted', {
                userId,
                action: 'vercel.promote',
                resourceType: 'vercel_deployment',
                resourceId: deploymentId
            });

            res.json({
                success: true,
                data: deployment
            });
        } catch (error: any) {
            loggingService.error('Failed to promote deployment', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to promote deployment',
                error: error.message
            });
        }
    }

    /**
     * Get domains for a project
     * GET /api/vercel/connections/:id/projects/:projectId/domains
     */
    static async getDomains(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const domains = await VercelService.getDomains(id, projectId);

            res.json({
                success: true,
                data: domains
            });
        } catch (error: any) {
            loggingService.error('Failed to get domains', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get domains',
                error: error.message
            });
        }
    }

    /**
     * Add domain to a project
     * POST /api/vercel/connections/:id/projects/:projectId/domains
     */
    static async addDomain(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;
            const { domain } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!domain) {
                res.status(400).json({
                    success: false,
                    message: 'Domain is required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const result = await VercelService.addDomain(id, projectId, domain);

            // Log audit event
            loggingService.info('Vercel domain added', {
                userId,
                action: 'vercel.domain.add',
                resourceType: 'vercel_domain',
                resourceId: domain,
                projectId
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to add domain', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to add domain',
                error: error.message
            });
        }
    }

    /**
     * Remove domain from a project
     * DELETE /api/vercel/connections/:id/projects/:projectId/domains/:domain
     */
    static async removeDomain(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId, domain } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            await VercelService.removeDomain(id, projectId, domain);

            // Log audit event
            loggingService.info('Vercel domain removed', {
                userId,
                action: 'vercel.domain.remove',
                resourceType: 'vercel_domain',
                resourceId: domain,
                projectId
            });

            res.json({
                success: true,
                message: 'Domain removed successfully'
            });
        } catch (error: any) {
            loggingService.error('Failed to remove domain', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to remove domain',
                error: error.message
            });
        }
    }

    /**
     * Get environment variables for a project
     * GET /api/vercel/connections/:id/projects/:projectId/env
     */
    static async getEnvVars(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const envVars = await VercelService.getEnvVars(id, projectId);

            res.json({
                success: true,
                data: envVars
            });
        } catch (error: any) {
            loggingService.error('Failed to get environment variables', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get environment variables',
                error: error.message
            });
        }
    }

    /**
     * Set environment variable
     * POST /api/vercel/connections/:id/projects/:projectId/env
     */
    static async setEnvVar(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;
            const { key, value, target, type } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!key || !value) {
                res.status(400).json({
                    success: false,
                    message: 'Key and value are required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const envVar = await VercelService.setEnvVar(id, projectId, key, value, target, type);

            // Log audit event (don't log the value for security)
            loggingService.info('Vercel environment variable set', {
                userId,
                action: 'vercel.env.set',
                resourceType: 'vercel_env',
                resourceId: key,
                projectId,
                target
            });

            res.json({
                success: true,
                data: { ...envVar, value: undefined } // Don't return value
            });
        } catch (error: any) {
            loggingService.error('Failed to set environment variable', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to set environment variable',
                error: error.message
            });
        }
    }

    /**
     * Delete environment variable
     * DELETE /api/vercel/connections/:id/projects/:projectId/env/:envVarId
     */
    static async deleteEnvVar(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId, envVarId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            await VercelService.deleteEnvVar(id, projectId, envVarId);

            // Log audit event
            loggingService.info('Vercel environment variable deleted', {
                userId,
                action: 'vercel.env.delete',
                resourceType: 'vercel_env',
                resourceId: envVarId,
                projectId
            });

            res.json({
                success: true,
                message: 'Environment variable deleted successfully'
            });
        } catch (error: any) {
            loggingService.error('Failed to delete environment variable', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to delete environment variable',
                error: error.message
            });
        }
    }

    /**
     * Get analytics for a project
     * GET /api/vercel/connections/:id/projects/:projectId/analytics
     */
    static async getAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, projectId } = req.params;
            const { from, to } = req.query;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Verify connection belongs to user
            const connection = await VercelService.getConnection(id, userId);
            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Vercel connection not found'
                });
                return;
            }

            const analytics = await VercelService.getAnalytics(
                id,
                projectId,
                from ? new Date(from as string) : undefined,
                to ? new Date(to as string) : undefined
            );

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            loggingService.error('Failed to get analytics', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get analytics',
                error: error.message
            });
        }
    }

    /**
     * Handle Vercel webhook events
     * POST /api/vercel/webhooks
     */
    static async handleWebhook(req: Request, res: Response): Promise<void> {
        try {
            const eventType = req.headers['x-vercel-event'] as string;
            const signature = req.headers['x-vercel-signature'] as string;
            const deliveryId = req.headers['x-vercel-delivery'] as string;

            // Log webhook receipt
            loggingService.info('Vercel webhook received', {
                eventType,
                deliveryId,
                hasSignature: !!signature
            });

            // Vercel REQUIRES signature verification for all webhook requests
            const webhookSecret = process.env.VERCEL_WEBHOOK_SECRET;
            if (!webhookSecret) {
                loggingService.error('VERCEL_WEBHOOK_SECRET not configured', {
                    deliveryId,
                    eventType
                });
                res.status(500).json({ error: 'Webhook secret not configured' });
                return;
            }

            if (!signature) {
                loggingService.warn('Vercel webhook missing signature header', {
                    deliveryId,
                    eventType
                });
                res.status(401).json({ error: 'Missing signature' });
                return;
            }

            // Vercel uses HMAC SHA1 for webhook signatures (not SHA256)
            const crypto = require('crypto');
            
            // Get raw body (must be captured by middleware before JSON parsing)
            const rawBody = (req as any).rawBody || JSON.stringify(req.body);
            
            // Compute expected signature
            const expectedSignature = crypto
                .createHmac('sha1', webhookSecret)
                .update(rawBody)
                .digest('hex');
            
            // Use constant-time comparison to prevent timing attacks
            if (!crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            )) {
                loggingService.warn('Invalid Vercel webhook signature', {
                    deliveryId,
                    eventType,
                    receivedLength: signature.length,
                    expectedLength: expectedSignature.length
                });
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }

            loggingService.info('Vercel webhook signature verified', {
                deliveryId,
                eventType
            });

            // Handle different event types
            const payload = req.body;
            
            switch (eventType) {
                case 'deployment.created':
                case 'deployment.succeeded':
                case 'deployment.error':
                case 'deployment.canceled':
                case 'deployment.promoted':
                    await this.handleDeploymentEvent(eventType, payload);
                    break;
                
                case 'project.created':
                case 'project.removed':
                case 'project.renamed':
                    await this.handleProjectEvent(eventType, payload);
                    break;
                
                case 'project.domain.created':
                case 'project.domain.deleted':
                case 'project.domain.verified':
                    await this.handleDomainEvent(eventType, payload);
                    break;
                
                // Note: Configuration events are not available in webhook subscriptions
                // They are automatically subscribed and handled by Vercel internally
                
                default:
                    loggingService.info('Unhandled Vercel webhook event', {
                        eventType,
                        deliveryId
                    });
            }

            // Acknowledge webhook
            res.status(200).json({ received: true });
        } catch (error: any) {
            loggingService.error('Vercel webhook processing failed', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({
                success: false,
                message: 'Webhook processing failed',
                error: error.message
            });
        }
    }

    /**
     * Handle deployment webhook events
     */
    private static async handleDeploymentEvent(eventType: string, payload: any): Promise<void> {
        try {
            const deployment = payload.deployment;
            const project = payload.project;
            
            if (!deployment || !project) {
                loggingService.warn('Deployment event missing required data', { eventType });
                return;
            }

            // Find connection by project
            const { VercelConnection } = await import('../models/VercelConnection');
            const connections = await VercelConnection.find({
                'projects.id': project.id,
                isActive: true
            });

            if (connections.length === 0) {
                loggingService.warn('No active connection found for deployment event', {
                    projectId: project.id,
                    eventType
                });
                return;
            }

            // Update cached project data
            for (const connection of connections) {
                const projectIndex = connection.projects.findIndex(p => p.id === project.id);
                if (projectIndex !== -1) {
                    connection.projects[projectIndex].latestDeployment = {
                        id: deployment.id,
                        url: deployment.url,
                        state: deployment.state,
                        createdAt: new Date(deployment.createdAt || Date.now())
                    };
                    await connection.save();
                }
            }

            loggingService.info('Deployment event processed', {
                eventType,
                deploymentId: deployment.id,
                projectId: project.id,
                state: deployment.state
            });
        } catch (error: any) {
            loggingService.error('Failed to handle deployment event', {
                eventType,
                error: error.message
            });
        }
    }

    /**
     * Handle project webhook events
     */
    private static async handleProjectEvent(eventType: string, payload: any): Promise<void> {
        try {
            const project = payload.project;
            
            if (!project) {
                loggingService.warn('Project event missing required data', { eventType });
                return;
            }

            // Find connection by project
            const { VercelConnection } = await import('../models/VercelConnection');
            const connections = await VercelConnection.find({
                'projects.id': project.id,
                isActive: true
            });

            if (connections.length === 0) {
                loggingService.warn('No active connection found for project event', {
                    projectId: project.id,
                    eventType
                });
                return;
            }

            // Update or remove project from cache
            for (const connection of connections) {
                if (eventType === 'project.removed') {
                    connection.projects = connection.projects.filter(p => p.id !== project.id);
                } else {
                    // Update project data
                    const projectIndex = connection.projects.findIndex(p => p.id === project.id);
                    if (projectIndex !== -1) {
                        connection.projects[projectIndex].name = project.name;
                        connection.projects[projectIndex].framework = project.framework;
                        connection.projects[projectIndex].updatedAt = new Date();
                    }
                }
                await connection.save();
            }

            loggingService.info('Project event processed', {
                eventType,
                projectId: project.id
            });
        } catch (error: any) {
            loggingService.error('Failed to handle project event', {
                eventType,
                error: error.message
            });
        }
    }

    /**
     * Handle domain webhook events
     */
    private static async handleDomainEvent(eventType: string, payload: any): Promise<void> {
        try {
            const domain = payload.domain;
            const project = payload.project;
            
            loggingService.info('Domain event received', {
                eventType,
                domain: domain?.name,
                projectId: project?.id
            });

            // Domain events are informational - we can log them
            // Actual domain management is done via API calls
        } catch (error: any) {
            loggingService.error('Failed to handle domain event', {
                eventType,
                error: error.message
            });
        }
    }

}

export default VercelController;
