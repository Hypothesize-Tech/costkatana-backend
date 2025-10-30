import { Router } from 'express';
import { GitHubController } from '../controllers/github.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

/**
 * GitHub OAuth Routes
 */

// Initialize OAuth flow
router.get('/auth', authenticate, GitHubController.initiateOAuth);

// Initialize GitHub App installation
router.get('/install', authenticate, GitHubController.initiateAppInstallation);

// OAuth callback (handles both OAuth and App installation)
router.get('/callback', GitHubController.handleOAuthCallback);

/**
 * GitHub Connection Routes
 */

// List user's GitHub connections
router.get('/connections', authenticate, GitHubController.listConnections);

// Get repositories for a connection
router.get('/connections/:connectionId/repositories', authenticate, GitHubController.getRepositories);

// Disconnect a GitHub connection
router.delete('/connections/:connectionId', authenticate, GitHubController.disconnectConnection);

/**
 * GitHub Integration Routes
 */

// Start new integration
router.post('/integrations', authenticate, GitHubController.startIntegration);

// List user's integrations
router.get('/integrations', authenticate, GitHubController.listIntegrations);

// Get integration status
router.get('/integrations/:integrationId', authenticate, GitHubController.getIntegrationStatus);

// Update integration from chat
router.post('/integrations/:integrationId/update', authenticate, GitHubController.updateIntegration);

/**
 * GitHub Webhook Route
 */

// GitHub webhook endpoint (no auth - verified by signature)
router.post('/webhook', GitHubController.handleWebhook);

export default router;



