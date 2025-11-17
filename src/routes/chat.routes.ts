import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body } from 'express-validator';
import {
    sendMessage,
    getConversationHistory,
    getUserConversations,
    createConversation,
    deleteConversation,
    getAvailableModels,
    updateConversationGitHubContext
} from '../controllers/chat.controller';
import { IntegrationChatController } from '../controllers/integrationChat.controller';

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
        body('templateVariables').optional().isObject().withMessage('templateVariables must be an object')
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

export default router; 