import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// List workflows - returns workflow executions in list format
router.get('/', asyncHandler(WorkflowController.getWorkflowsList));

// List workflow executions (alias for the root route)
router.get('/executions', asyncHandler(WorkflowController.getWorkflowsList));

// Analytics - returns dashboard format with analytics
router.get('/analytics', asyncHandler(WorkflowController.getWorkflowAnalytics));

// Observability Dashboard - comprehensive dashboard data
router.get('/dashboard', asyncHandler(WorkflowController.getObservabilityDashboard));

// Workflow Templates
router.get('/templates', asyncHandler(WorkflowController.listTemplates));
router.post('/templates', asyncHandler(WorkflowController.createTemplate));
router.get('/templates/:templateId', asyncHandler(WorkflowController.getTemplate));

// Workflow Execution
router.post('/templates/:templateId/execute', asyncHandler(WorkflowController.executeWorkflow));
router.get('/executions/:executionId', asyncHandler(WorkflowController.getExecution));
router.get('/executions/:executionId/trace', asyncHandler(WorkflowController.getWorkflowTrace));

// Workflow Control
router.post('/executions/:executionId/pause', asyncHandler(WorkflowController.pauseWorkflow));
router.post('/executions/:executionId/resume', asyncHandler(WorkflowController.resumeWorkflow));
router.post('/executions/:executionId/cancel', asyncHandler(WorkflowController.cancelWorkflow));

// Workflow Metrics
router.get('/:workflowId/metrics', asyncHandler(WorkflowController.getWorkflowMetrics));

export default router;