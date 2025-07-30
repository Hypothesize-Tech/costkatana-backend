import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateParams } from '../middleware/validation.middleware';

const router = Router();

// All workflow routes require authentication
router.use(authenticate);

/**
 * @route GET /api/workflows
 * @desc Get user workflows with pagination
 * @access Private
 */
router.get('/', WorkflowController.getUserWorkflows);

/**
 * @route GET /api/workflows/analytics
 * @desc Get workflow analytics for user
 * @access Private
 */
router.get('/analytics', WorkflowController.getWorkflowAnalytics);

/**
 * @route GET /api/workflows/:workflowId
 * @desc Get specific workflow details
 * @access Private
 */
router.get('/:workflowId', validateParams, WorkflowController.getWorkflowDetails);

/**
 * @route GET /api/workflows/:workflowId/steps
 * @desc Get workflow steps
 * @access Private
 */
router.get('/:workflowId/steps', validateParams, WorkflowController.getWorkflowSteps);

/**
 * @route POST /api/workflows/compare
 * @desc Compare multiple workflows
 * @access Private
 */
router.post('/compare', WorkflowController.compareWorkflows);

export default router;