import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Workflow Templates
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

// Analytics and Observability
router.get('/workflows/:workflowId/metrics', asyncHandler(WorkflowController.getWorkflowMetrics));
router.get('/observability/dashboard', asyncHandler(WorkflowController.getObservabilityDashboard));

export default router;