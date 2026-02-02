import { Router } from 'express';
import { AgentTraceController } from '../controllers/agentTrace.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// List agent traces - returns trace executions in list format
router.get('/', asyncHandler(AgentTraceController.getTracesList));

// List trace executions (alias for the root route)
router.get('/executions', asyncHandler(AgentTraceController.getTracesList));

// Analytics - returns dashboard format with analytics
router.get('/analytics', asyncHandler(AgentTraceController.getTraceAnalytics));

// Observability Dashboard - comprehensive dashboard data
router.get('/dashboard', asyncHandler(AgentTraceController.getObservabilityDashboard));

// Trace Templates
router.get('/templates', asyncHandler(AgentTraceController.listTemplates));
router.post('/templates', asyncHandler(AgentTraceController.createTemplate));
router.get('/templates/:templateId', asyncHandler(AgentTraceController.getTemplate));

// Trace Execution
router.post('/templates/:templateId/execute', asyncHandler(AgentTraceController.executeTrace));
router.get('/executions/:executionId', asyncHandler(AgentTraceController.getExecution));
router.get('/executions/:executionId/trace', asyncHandler(AgentTraceController.getTraceDetail));

// Trace Control
router.post('/executions/:executionId/pause', asyncHandler(AgentTraceController.pauseTrace));
router.post('/executions/:executionId/resume', asyncHandler(AgentTraceController.resumeTrace));
router.post('/executions/:executionId/cancel', asyncHandler(AgentTraceController.cancelTrace));

// Trace Metrics
router.get('/:traceId/metrics', asyncHandler(AgentTraceController.getTraceMetrics));

export default router;
