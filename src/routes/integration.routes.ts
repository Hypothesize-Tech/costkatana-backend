import { Router } from 'express';
import { IntegrationController } from '../controllers/integration.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Linear OAuth callback (no auth - called by Linear)
router.get('/linear/callback', IntegrationController.handleLinearOAuthCallback);

// JIRA OAuth callback (no auth - called by JIRA)
router.get('/jira/callback', IntegrationController.handleJiraOAuthCallback);

// Discord OAuth callback (no auth - called by Discord)
router.get('/discord/callback', IntegrationController.handleDiscordOAuthCallback);

// Slack OAuth callback (no auth - called by Slack)
router.get('/slack/callback', IntegrationController.handleSlackOAuthCallback);

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

// JIRA OAuth routes (must come before parameterized routes)
router.post('/jira/validate-token', IntegrationController.validateJiraToken);
router.get('/jira/auth', IntegrationController.initiateJiraOAuth);

// Discord OAuth routes (must come before parameterized routes)
router.get('/discord/auth', IntegrationController.initiateDiscordOAuth);

// Slack OAuth routes (must come before parameterized routes)
router.get('/slack/auth', IntegrationController.initiateSlackOAuth);

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

// JIRA-specific
router.get('/:id/jira/projects', IntegrationController.getJiraProjects);
router.get('/:id/jira/projects/:projectKey/issue-types', IntegrationController.getJiraIssueTypes);
router.get('/:id/jira/priorities', IntegrationController.getJiraPriorities);
router.post('/:id/jira/issues', IntegrationController.createJiraIssue);
router.put('/:id/jira/issues/:issueKey', IntegrationController.updateJiraIssue);

// Delivery logs and retries
router.get('/logs/all', IntegrationController.getAllDeliveryLogs);
router.post('/alerts/:alertId/retry', IntegrationController.retryFailedDeliveries);

export default router;

