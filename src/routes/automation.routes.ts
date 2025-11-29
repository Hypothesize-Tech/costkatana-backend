import { Router } from 'express';
import { AutomationController } from '../controllers/automation.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authenticateAutomationWebhook } from '../middleware/automation.middleware';

const router = Router();

// Webhook endpoint - uses automation-specific authentication
router.post('/webhook/:connectionId?', authenticateAutomationWebhook, AutomationController.handleWebhook);

// All other routes require standard authentication
router.use(authenticate);

// Connection CRUD
router.post('/connections', AutomationController.createConnection);
router.get('/connections', AutomationController.getConnections);
router.get('/connections/:id', AutomationController.getConnection);
router.put('/connections/:id', AutomationController.updateConnection);
router.delete('/connections/:id', AutomationController.deleteConnection);

// Connection statistics
router.get('/connections/:id/stats', AutomationController.getConnectionStats);

// Analytics and statistics
router.get('/analytics', AutomationController.getAnalytics);
router.get('/stats', AutomationController.getStats);
router.get('/orchestration-overhead', AutomationController.getOrchestrationOverhead);

// Workflow quota
router.get('/quota', AutomationController.getWorkflowQuota);

// Workflow optimization
router.get('/recommendations', AutomationController.getAllRecommendations);
router.get('/workflows/:workflowId/recommendations', AutomationController.getWorkflowRecommendations);
router.get('/workflows/:workflowId/metrics', AutomationController.getWorkflowMetrics);
router.get('/workflows/:workflowId/roi', AutomationController.getWorkflowROI);
router.get('/workflows/roi-comparison', AutomationController.getWorkflowROIComparison);

// Workflow alerting
router.post('/workflows/:workflowId/check-alerts', AutomationController.checkWorkflowAlerts);

// Workflow versioning
router.get('/workflows/:workflowId/versions', AutomationController.getWorkflowVersions);
router.get('/workflows/:workflowId/versions/compare', AutomationController.compareWorkflowVersions);

export default router;

