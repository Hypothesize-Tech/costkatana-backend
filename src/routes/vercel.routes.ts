import { Router } from 'express';
import { VercelController } from '../controllers/vercel.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// OAuth routes
router.get('/auth', authenticate, VercelController.initiateOAuth);
router.get('/callback', VercelController.handleOAuthCallback);

// Connection routes
router.get('/connections', authenticate, VercelController.listConnections);
router.delete('/connections/:id', authenticate, VercelController.disconnectConnection);

// Project routes
router.get('/connections/:id/projects', authenticate, VercelController.getProjects);
router.get('/connections/:id/projects/:projectId', authenticate, VercelController.getProject);

// Deployment routes
router.get('/connections/:id/projects/:projectId/deployments', authenticate, VercelController.getDeployments);
router.post('/connections/:id/projects/:projectId/deploy', authenticate, VercelController.triggerDeployment);
router.get('/connections/:id/deployments/:deploymentId/logs', authenticate, VercelController.getDeploymentLogs);
router.post('/connections/:id/deployments/:deploymentId/rollback', authenticate, VercelController.rollbackDeployment);
router.post('/connections/:id/deployments/:deploymentId/promote', authenticate, VercelController.promoteDeployment);

// Domain routes
router.get('/connections/:id/projects/:projectId/domains', authenticate, VercelController.getDomains);
router.post('/connections/:id/projects/:projectId/domains', authenticate, VercelController.addDomain);
router.delete('/connections/:id/projects/:projectId/domains/:domain', authenticate, VercelController.removeDomain);

// Environment variable routes
router.get('/connections/:id/projects/:projectId/env', authenticate, VercelController.getEnvVars);
router.post('/connections/:id/projects/:projectId/env', authenticate, VercelController.setEnvVar);
router.delete('/connections/:id/projects/:projectId/env/:envVarId', authenticate, VercelController.deleteEnvVar);

// Analytics routes
router.get('/connections/:id/projects/:projectId/analytics', authenticate, VercelController.getAnalytics);

// Webhook route (no auth middleware - uses signature verification)
router.post('/webhooks', VercelController.handleWebhook);

export default router;
