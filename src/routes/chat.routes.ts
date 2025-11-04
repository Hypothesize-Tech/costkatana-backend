import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
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
router.post('/message', authenticate, sendMessage);

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