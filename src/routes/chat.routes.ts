import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body, param } from 'express-validator';
import {
    sendMessage,
    getConversationHistory,
    getUserConversations,
    createConversation,
    deleteConversation,
    getAvailableModels,
    updateConversationGitHubContext,
    renameConversation,
    archiveConversation,
    pinConversation,
    getChatPlans,
    modifyPlan,
    askAboutPlan,
    requestCodeChanges,
    streamChatUpdates
} from '../controllers/chat.controller';
import { IntegrationChatController } from '../controllers/integrationChat.controller';
import { ChatGovernedAgentController } from '../controllers/chatGovernedAgent.controller';

const router = Router();

/**
 * Chat Routes
 * Most routes require authentication, except public informational endpoints
 */

// Get available models for chat (PUBLIC - no auth required)
router.get('/models', getAvailableModels);

// Send a message to a model
router.post(
    '/message',
    [
        body('message').optional().isString().withMessage('Message must be a string'),
        body('modelId').notEmpty().withMessage('modelId is required'),
        body('conversationId').optional().isMongoId().withMessage('Invalid conversationId'),
        body('temperature').optional().isFloat({ min: 0, max: 2 }).withMessage('Temperature must be between 0 and 2'),
        body('maxTokens').optional().isInt({ min: 1, max: 100000 }).withMessage('maxTokens must be between 1 and 100000'),
        body('documentIds').optional().isArray().withMessage('documentIds must be an array'),
        body('templateId').optional().isMongoId().withMessage('Invalid templateId'),
        body('templateVariables').optional().isObject().withMessage('templateVariables must be an object'),
        body('attachments').optional().isArray().withMessage('attachments must be an array')
    ],
    validateRequest,
    authenticate,
    sendMessage
);

// Create a new conversation
router.post('/conversations', authenticate, createConversation);

// Get all conversations for a user
router.get('/conversations', authenticate, getUserConversations);

// Get conversation history
router.get('/conversations/:conversationId/history', authenticate, getConversationHistory);

// Update conversation GitHub context
router.patch('/conversations/:conversationId/github-context', authenticate, updateConversationGitHubContext);

// Delete a conversation
router.delete('/conversations/:conversationId', authenticate, deleteConversation);

// Rename a conversation
router.put(
    '/conversations/:id/rename',
    [
        param('id').isMongoId().withMessage('Invalid conversation ID'),
        body('title').notEmpty().trim().isLength({ min: 1, max: 200 }).withMessage('Title must be between 1 and 200 characters')
    ],
    validateRequest,
    authenticate,
    renameConversation
);

// Archive/unarchive a conversation
router.put(
    '/conversations/:id/archive',
    [
        param('id').isMongoId().withMessage('Invalid conversation ID'),
        body('archived').isBoolean().withMessage('archived must be a boolean')
    ],
    validateRequest,
    authenticate,
    archiveConversation
);

// Pin/unpin a conversation
router.put(
    '/conversations/:id/pin',
    [
        param('id').isMongoId().withMessage('Invalid conversation ID'),
        body('pinned').isBoolean().withMessage('pinned must be a boolean')
    ],
    validateRequest,
    authenticate,
    pinConversation
);

/**
 * Integration Chat Routes
 * Routes for @ mention-based integration management
 */

// Execute integration command
router.post('/integrations/execute', authenticate, IntegrationChatController.executeCommand);

// Get autocomplete suggestions
router.get('/integrations/autocomplete', authenticate, IntegrationChatController.getAutocomplete);

// List entities for an integration type
router.get('/integrations/:type/entities', authenticate, IntegrationChatController.listEntities);

// Get sub-entities for a parent entity
router.get('/integrations/:type/:entityId/subentities', authenticate, IntegrationChatController.getSubEntities);

/**
 * Governed Agent Integration Routes
 */

// Classify a chat message to determine if governed agent should be used
router.post(
    '/classify',
    [
        body('message').notEmpty().isString().withMessage('Message is required')
    ],
    validateRequest,
    authenticate,
    ChatGovernedAgentController.classifyMessage
);

// Initiate governed agent task from chat
router.post(
    '/governed/initiate',
    [
        body('message').notEmpty().isString().withMessage('Message is required'),
        body('conversationId').optional().isMongoId().withMessage('Invalid conversationId')
    ],
    validateRequest,
    authenticate,
    ChatGovernedAgentController.initiateFromChat
);

// Stream governed agent task progress via SSE
router.get(
    '/governed/:taskId/stream',
    authenticate,
    ChatGovernedAgentController.streamTaskProgress
);

// Request plan generation (user manually triggers after reviewing scope)
router.post(
    '/governed/:taskId/request-plan',
    authenticate,
    ChatGovernedAgentController.requestPlan
);

// Submit clarifying answers
router.post(
    '/governed/:taskId/submit-answers',
    [
        param('taskId').isMongoId().withMessage('Invalid taskId'),
        body('answers').isObject().withMessage('Answers must be an object')
    ],
    validateRequest,
    authenticate,
    ChatGovernedAgentController.submitClarifyingAnswers
);

// Approve plan and start execution
router.post(
    '/governed/:taskId/approve',
    authenticate,
    ChatGovernedAgentController.approvePlan
);

// Request changes to the plan
router.post(
    '/governed/:taskId/request-changes',
    [
        param('taskId').isMongoId().withMessage('Invalid taskId'),
        body('feedback').notEmpty().isString().withMessage('Feedback is required')
    ],
    validateRequest,
    authenticate,
    ChatGovernedAgentController.requestPlanChanges
);

// Go back to previous mode
router.post(
    '/governed/:taskId/go-back',
    authenticate,
    ChatGovernedAgentController.goBack
);

// Navigate to a specific mode
router.post(
    '/governed/:taskId/navigate',
    [
        param('taskId').isMongoId().withMessage('Invalid taskId'),
        body('mode').notEmpty().isString().withMessage('Mode is required')
    ],
    validateRequest,
    authenticate,
    ChatGovernedAgentController.navigateToMode
);

// Plan modification endpoints
router.post(
    '/:chatId/plan/modify',
    [
        param('chatId').isMongoId().withMessage('Invalid chatId'),
        body('taskId').isMongoId().withMessage('Invalid taskId'),
        body('modifications').isObject().withMessage('Modifications object is required')
    ],
    validateRequest,
    authenticate,
    modifyPlan
);

// Ask question about plan
router.post(
    '/:chatId/plan/question',
    [
        param('chatId').isMongoId().withMessage('Invalid chatId'),
        body('taskId').isMongoId().withMessage('Invalid taskId'),
        body('question').notEmpty().isString().withMessage('Question is required')
    ],
    validateRequest,
    authenticate,
    askAboutPlan
);

// Request code changes
router.post(
    '/:chatId/plan/:taskId/redeploy',
    [
        param('chatId').isMongoId().withMessage('Invalid chatId'),
        param('taskId').isMongoId().withMessage('Invalid taskId'),
        body('changeRequest').notEmpty().isString().withMessage('Change request is required')
    ],
    validateRequest,
    authenticate,
    requestCodeChanges
);

// Get all plans in a chat
router.get(
    '/:chatId/plans',
    [
        param('chatId').isMongoId().withMessage('Invalid chatId')
    ],
    validateRequest,
    authenticate,
    getChatPlans
);

// Stream chat-wide updates
router.get(
    '/:chatId/stream',
    [
        param('chatId').isMongoId().withMessage('Invalid chatId')
    ],
    validateRequest,
    authenticate,
    streamChatUpdates
);

export default router; 