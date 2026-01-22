import { Request, Response } from 'express';
import { VercelService } from '../services/vercel.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class VercelController {
    /**
     * Initialize OAuth flow
     * GET /api/vercel/auth
     */
    static async initiateOAuth(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('initiateOAuth', req);
        try {
            const authUrl = await VercelService.initiateOAuth(userId);

            ControllerHelper.logRequestSuccess('initiateOAuth', req, startTime, { hasAuthUrl: !!authUrl });

            res.json({
                success: true,
                data: { authUrl }
            });
        } catch (error: any) {
            ControllerHelper.handleError('initiateOAuth', error, req, res, startTime);
        }
    }

    /**
     * OAuth callback handler
     * GET /api/vercel/callback
     * 
     * For Vercel Integrations, the callback receives:
     * - code: Authorization code to exchange for access token
     * - configurationId: The integration configuration ID
     * - teamId: (optional) The team ID if installed on a team
     * - next: (optional) URL to redirect after setup
     * - state: (optional) Our state token if passed through
     */
    static async handleOAuthCallback(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('handleOAuthCallback', req);
        try {
            const { code, state, configurationId, teamId, next } = req.query;

            if (!code) {
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent('Missing authorization code')}`);
                return;
            }

            if (!state) {
                // No state means direct installation from Vercel Marketplace
                // We cannot link this to a user account
                loggingService.error('Vercel OAuth callback received without state', {
                    hasConfigurationId: !!configurationId,
                    hasTeamId: !!teamId
                });
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent('Please connect Vercel from the CostKatana integrations page')}`);
                return;
            }

            const connection = await VercelService.handleCallback(code as string, state as string);

            ControllerHelper.logRequestSuccess('handleOAuthCallback', req, startTime, {
                connectionId: connection._id.toString(),
                vercelUsername: connection.vercelUsername,
                teamId: connection.teamId
            });

            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations?vercelConnected=true&message=${encodeURIComponent('Vercel account connected successfully!')}`);
        } catch (error: any) {
            // Note: OAuth callbacks redirect, so we handle redirects in the catch block
            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(error.message || 'OAuth callback failed')}`);
        }
    }

    /**
     * List user's Vercel connections
     * GET /api/vercel/connections
     */
    static async listConnections(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('listConnections', req);
        try {
            const connections = await VercelService.listConnections(userId);

            ControllerHelper.logRequestSuccess('listConnections', req, startTime, { connectionsCount: connections.length });

            res.json({
                success: true,
                data: connections
            });
        } catch (error: any) {
            ControllerHelper.handleError('listConnections', error, req, res, startTime);
        }
    }

    /**
     * Disconnect Vercel account
     * DELETE /api/vercel/connections/:id
     */
    static async disconnectConnection(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('disconnectConnection', req);
        const { id } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
            await VercelService.disconnectConnection(id, userId);

            ControllerHelper.logRequestSuccess('disconnectConnection', req, startTime, { connectionId: id });

            res.json({
                success: true,
                message: 'Vercel connection disconnected successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('disconnectConnection', error, req, res, startTime);
        }
    }

    /**
     * Get projects for a connection
     * GET /api/vercel/connections/:id/projects
     */
    static async getProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getProjects', req);
        const { id } = req.params;
        const refresh = req.query.refresh === 'true';
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('getProjects', req, startTime, { projectsCount: projects.length });

            res.json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProjects', error, req, res, startTime);
        }
    }

    /**
     * Get project details
     * GET /api/vercel/connections/:id/projects/:projectId
     */
    static async getProject(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getProject', req);
        const { id, projectId } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('getProject', req, startTime, { hasProject: !!project });

            res.json({
                success: true,
                data: project
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProject', error, req, res, startTime);
        }
    }

    /**
     * Get deployments for a project
     * GET /api/vercel/connections/:id/projects/:projectId/deployments
     */
    static async getDeployments(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getDeployments', req);
        const { id, projectId } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('getDeployments', req, startTime, { deploymentsCount: deployments.length });

            res.json({
                success: true,
                data: deployments
            });
        } catch (error: any) {
            ControllerHelper.handleError('getDeployments', error, req, res, startTime);
        }
    }

    /**
     * Trigger a new deployment
     * POST /api/vercel/connections/:id/projects/:projectId/deploy
     */
    static async triggerDeployment(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('triggerDeployment', req);
        const { id, projectId } = req.params;
        const options = req.body;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('triggerDeployment', req, startTime, {
                deploymentId: deployment.uid,
                projectId,
                target: options?.target || 'preview'
            });

            res.json({
                success: true,
                data: deployment
            });
        } catch (error: any) {
            ControllerHelper.handleError('triggerDeployment', error, req, res, startTime);
        }
    }

    /**
     * Get deployment logs
     * GET /api/vercel/connections/:id/deployments/:deploymentId/logs
     */
    static async getDeploymentLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getDeploymentLogs', req);
        const { id, deploymentId } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('getDeploymentLogs', req, startTime, { hasLogs: !!logs });

            res.json({
                success: true,
                data: logs
            });
        } catch (error: any) {
            ControllerHelper.handleError('getDeploymentLogs', error, req, res, startTime);
        }
    }

    /**
     * Rollback to a previous deployment
     * POST /api/vercel/connections/:id/deployments/:deploymentId/rollback
     */
    static async rollbackDeployment(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('rollbackDeployment', req);
        const { id, deploymentId } = req.params;
        const { projectId } = req.body;
        try {
            if (!projectId) {
                res.status(400).json({
                    success: false,
                    message: 'Project ID is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('rollbackDeployment', req, startTime, {
                deploymentId,
                projectId
            });

            res.json({
                success: true,
                data: deployment
            });
        } catch (error: any) {
            ControllerHelper.handleError('rollbackDeployment', error, req, res, startTime);
        }
    }

    /**
     * Promote deployment to production
     * POST /api/vercel/connections/:id/deployments/:deploymentId/promote
     */
    static async promoteDeployment(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('promoteDeployment', req);
        const { id, deploymentId } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('promoteDeployment', req, startTime, { deploymentId });

            res.json({
                success: true,
                data: deployment
            });
        } catch (error: any) {
            ControllerHelper.handleError('promoteDeployment', error, req, res, startTime);
        }
    }

    /**
     * Get domains for a project
     * GET /api/vercel/connections/:id/projects/:projectId/domains
     */
    static async getDomains(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getDomains', req);
        const { id, projectId } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('getDomains', req, startTime, { domainsCount: domains.length });

            res.json({
                success: true,
                data: domains
            });
        } catch (error: any) {
            ControllerHelper.handleError('getDomains', error, req, res, startTime);
        }
    }

    /**
     * Add domain to a project
     * POST /api/vercel/connections/:id/projects/:projectId/domains
     */
    static async addDomain(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('addDomain', req);
        const { id, projectId } = req.params;
        const { domain } = req.body;
        try {
            if (!domain) {
                res.status(400).json({
                    success: false,
                    message: 'Domain is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('addDomain', req, startTime, { domain, projectId });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            ControllerHelper.handleError('addDomain', error, req, res, startTime);
        }
    }

    /**
     * Remove domain from a project
     * DELETE /api/vercel/connections/:id/projects/:projectId/domains/:domain
     */
    static async removeDomain(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('removeDomain', req);
        const { id, projectId, domain } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('removeDomain', req, startTime, { domain, projectId });

            res.json({
                success: true,
                message: 'Domain removed successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('removeDomain', error, req, res, startTime);
        }
    }

    /**
     * Get environment variables for a project
     * GET /api/vercel/connections/:id/projects/:projectId/env
     */
    static async getEnvVars(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getEnvVars', req);
        const { id, projectId } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('getEnvVars', req, startTime, { envVarsCount: envVars.length });

            res.json({
                success: true,
                data: envVars
            });
        } catch (error: any) {
            ControllerHelper.handleError('getEnvVars', error, req, res, startTime);
        }
    }

    /**
     * Set environment variable
     * POST /api/vercel/connections/:id/projects/:projectId/env
     */
    static async setEnvVar(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('setEnvVar', req);
        const { id, projectId } = req.params;
        const { key, value, target, type } = req.body;
        try {
            if (!key || !value) {
                res.status(400).json({
                    success: false,
                    message: 'Key and value are required'
                });
                return;
            }

            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('setEnvVar', req, startTime, { key, projectId, target });

            res.json({
                success: true,
                data: { ...envVar, value: undefined } // Don't return value
            });
        } catch (error: any) {
            ControllerHelper.handleError('setEnvVar', error, req, res, startTime);
        }
    }

    /**
     * Delete environment variable
     * DELETE /api/vercel/connections/:id/projects/:projectId/env/:envVarId
     */
    static async deleteEnvVar(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('deleteEnvVar', req);
        const { id, projectId, envVarId } = req.params;
        try {
            ServiceHelper.validateObjectId(id, 'connectionId');
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

            ControllerHelper.logRequestSuccess('deleteEnvVar', req, startTime, { envVarId, projectId });

            res.json({
                success: true,
                message: 'Environment variable deleted successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteEnvVar', error, req, res, startTime);
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
