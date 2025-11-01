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

export default router; 