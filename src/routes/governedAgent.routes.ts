import { Router } from 'express';
import { GovernedAgentController } from '../controllers/governedAgent.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * Initiate a new governed task
 * POST /api/governed-agent/initiate
 * Body: { userRequest: string }
 */
router.post('/initiate', (req, res) => GovernedAgentController.initiateTask(req, res));

/**
 * Generate execution plan for a task
 * POST /api/governed-agent/:taskId/generate-plan
 * Body: { clarifyingAnswers?: Record<string, any> }
 */
router.post('/:taskId/generate-plan', (req, res) => GovernedAgentController.generatePlan(req, res));

/**
 * Get clarifying questions for a task
 * GET /api/governed-agent/:taskId/clarify
 */
router.get('/:taskId/clarify', (req, res) => GovernedAgentController.getClarifyingQuestions(req, res));

/**
 * Execute task with progress streaming (SSE)
 * POST /api/governed-agent/:taskId/execute
 * Body: { approvalToken?: string }
 */
router.post('/:taskId/execute', (req, res) => GovernedAgentController.executeWithProgress(req, res));

/**
 * Get task status
 * GET /api/governed-agent/:taskId
 */
router.get('/:taskId', (req, res) => GovernedAgentController.getTaskStatus(req, res));

/**
 * Get user's recent tasks
 * GET /api/governed-agent/tasks
 * Query: limit?: number, status?: string
 */
router.get('/tasks', (req, res) => GovernedAgentController.getUserTasks(req, res));

export default router;
