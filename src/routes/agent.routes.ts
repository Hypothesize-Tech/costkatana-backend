import express from 'express';
import { body, query } from 'express-validator';
import { AgentController } from '../controllers/agent.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * POST /api/agent/query
 * Send a query to the AI agent
 */
router.post('/query', [
    body('query')
        .isString()
        .trim()
        .isLength({ min: 1, max: 5000 })
        .withMessage('Query must be between 1 and 5000 characters'),
    body('context')
        .optional()
        .isObject()
        .withMessage('Context must be an object'),
    body('context.projectId')
        .optional()
        .isString()
        .withMessage('Project ID must be a string'),
    body('context.conversationId')
        .optional()
        .isString()
        .withMessage('Conversation ID must be a string'),
    body('context.previousMessages')
        .optional()
        .isArray({ max: 10 })
        .withMessage('Previous messages must be an array with max 10 items')
], AgentController.query);

/**
 * POST /api/agent/stream
 * Stream agent response for real-time interaction
 */
router.post('/stream', [
    body('query')
        .isString()
        .trim()
        .isLength({ min: 1, max: 5000 })
        .withMessage('Query must be between 1 and 5000 characters'),
    body('context')
        .optional()
        .isObject()
        .withMessage('Context must be an object')
], AgentController.streamQuery);

/**
 * GET /api/agent/status
 * Get agent status and statistics
 */
router.get('/status', AgentController.getStatus);

/**
 * POST /api/agent/initialize
 * Initialize the agent (admin only)
 */
router.post('/initialize', AgentController.initialize);

/**
 * POST /api/agent/feedback
 * Add feedback/learning to the agent
 */
router.post('/feedback', [
    body('insight')
        .isString()
        .trim()
        .isLength({ min: 10, max: 2000 })
        .withMessage('Insight must be between 10 and 2000 characters'),
    body('rating')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('Rating must be between 1 and 5'),
    body('metadata')
        .optional()
        .isObject()
        .withMessage('Metadata must be an object')
], AgentController.addFeedback);

/**
 * GET /api/agent/conversations/:conversationId?
 * Get conversation history with the agent
 */
router.get('/conversations', [
    query('conversationId')
        .optional()
        .isString()
        .withMessage('Conversation ID must be a string'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100')
], AgentController.getConversationHistory);

/**
 * GET /api/agent/suggestions
 * Get suggested queries for the user
 */
router.get('/suggestions', AgentController.getSuggestedQueries);

/**
 * POST /api/agent/wizard/start
 * Start conversational project creation wizard
 */
router.post('/wizard/start', [
    body('projectType')
        .optional()
        .isString()
        .withMessage('Project type must be a string'),
    body('quickStart')
        .optional()
        .isBoolean()
        .withMessage('Quick start must be a boolean')
], AgentController.startProjectWizard);

/**
 * POST /api/agent/wizard/continue
 * Continue project creation wizard conversation
 */
router.post('/wizard/continue', [
    body('response')
        .isString()
        .trim()
        .isLength({ min: 1, max: 1000 })
        .withMessage('Response must be between 1 and 1000 characters'),
    body('wizardState')
        .isObject()
        .withMessage('Wizard state must be an object'),
    body('wizardState.step')
        .isInt({ min: 1, max: 5 })
        .withMessage('Wizard step must be between 1 and 5')
], AgentController.continueProjectWizard);

export default router; 