import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validateRequest } from '@middleware/validation.middleware';
import { body } from 'express-validator';
import { chatValidators, governedValidators } from '@middleware/validators/chat.validators';
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
    [chatValidators.conversationId, chatValidators.titleBody],
    validateRequest,
    authenticate,
    renameConversation
);

// Archive/unarchive a conversation
router.put(
    '/conversations/:id/archive',
    [chatValidators.conversationId, chatValidators.archivedBody],
    validateRequest,
    authenticate,
    archiveConversation
);

// Pin/unpin a conversation
router.put(
    '/conversations/:id/pin',
    [chatValidators.conversationId, chatValidators.pinnedBody],
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
    [chatValidators.messageBody],
    validateRequest,
    authenticate,
    ChatGovernedAgentController.classifyMessage
);

// Initiate governed agent task from chat
router.post(
    '/governed/initiate',
    governedValidators.initiateChat,
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
    governedValidators.submitAnswers,
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
    governedValidators.requestChanges,
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
    governedValidators.navigateMode,
    validateRequest,
    authenticate,
    ChatGovernedAgentController.navigateToMode
);

// Plan modification endpoints
router.post(
    '/:chatId/plan/modify',
    governedValidators.modifyPlan,
    validateRequest,
    authenticate,
    modifyPlan
);

// Ask question about plan
router.post(
    '/:chatId/plan/question',
    governedValidators.questionPlan,
    validateRequest,
    authenticate,
    askAboutPlan
);

// Request code changes
router.post(
    '/:chatId/plan/:taskId/redeploy',
    governedValidators.redeployTask,
    validateRequest,
    authenticate,
    requestCodeChanges
);

// Get all plans in a chat
router.get(
    '/:chatId/plans',
    [chatValidators.chatIdParam],
    validateRequest,
    authenticate,
    getChatPlans
);

// Stream chat-wide updates
router.get(
    '/:chatId/stream',
    [chatValidators.chatIdParam],
    validateRequest,
    authenticate,
    streamChatUpdates
);

export default router; 