import { Router } from 'express';
import { IntegrationController } from '../controllers/integration.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Linear OAuth callback (no auth - called by Linear)
router.get('/linear/callback', IntegrationController.handleLinearOAuthCallback);

// All other routes require authentication
router.use(authenticate);

// Integration CRUD
router.post('/', IntegrationController.createIntegration);
router.get('/', IntegrationController.getIntegrations);
router.get('/:id', IntegrationController.getIntegration);
router.put('/:id', IntegrationController.updateIntegration);
router.delete('/:id', IntegrationController.deleteIntegration);

// Integration operations
router.post('/:id/test', IntegrationController.testIntegration);
router.get('/:id/stats', IntegrationController.getIntegrationStats);
router.get('/:id/logs', IntegrationController.getDeliveryLogs);

// Linear OAuth routes (must come before parameterized routes)
router.post('/linear/validate-token', IntegrationController.validateLinearToken);
router.get('/linear/auth', IntegrationController.initiateLinearOAuth);

// Slack-specific
router.get('/:id/slack/channels', IntegrationController.getSlackChannels);

// Discord-specific
router.get('/:id/discord/guilds', IntegrationController.getDiscordGuilds);
router.get('/:id/discord/guilds/:guildId/channels', IntegrationController.getDiscordChannels);

// Linear-specific
router.get('/:id/linear/teams', IntegrationController.getLinearTeams);
router.get('/:id/linear/teams/:teamId/projects', IntegrationController.getLinearProjects);
router.post('/:id/linear/issues', IntegrationController.createLinearIssue);
router.put('/:id/linear/issues/:issueId', IntegrationController.updateLinearIssue);

// Delivery logs and retries
router.get('/logs/all', IntegrationController.getAllDeliveryLogs);
router.post('/alerts/:alertId/retry', IntegrationController.retryFailedDeliveries);

export default router;

