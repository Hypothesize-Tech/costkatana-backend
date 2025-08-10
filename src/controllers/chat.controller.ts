import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { ChatService } from '../services/chat.service';

export interface AuthenticatedRequest extends Request {
    userId?: string;
}

/**
 * Send a message to a specific AWS Bedrock model
 */
export const sendMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.userId) {
            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const { message, modelId, conversationId, temperature = 0.7, maxTokens = 2000 } = req.body;

        if (!message || !modelId) {
            res.status(400).json({
                success: false,
                message: 'Message and modelId are required'
            });
            return;
        }

        const result = await ChatService.sendMessage({
            userId: req.userId,
            message,
            modelId,
            conversationId,
            temperature,
            maxTokens,
            req
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        logger.error('Error sending chat message:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get conversation history
 */
export const getConversationHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.userId) {
            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const { conversationId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        if (!conversationId) {
            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        const history = await ChatService.getConversationHistory(
            conversationId, 
            req.userId, 
            limit, 
            offset
        );

        res.json({
            success: true,
            data: history
        });

    } catch (error) {
        logger.error('Error getting conversation history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversation history',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get all conversations for a user
 */
export const getUserConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.userId) {
            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const limit = parseInt(req.query.limit as string) || 20;
        const offset = parseInt(req.query.offset as string) || 0;

        const conversations = await ChatService.getUserConversations(
            req.userId, 
            limit, 
            offset
        );

        res.json({
            success: true,
            data: conversations
        });

    } catch (error) {
        logger.error('Error getting user conversations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversations',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Create a new conversation
 */
export const createConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.userId) {
            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const { title, modelId } = req.body;

        if (!modelId) {
            res.status(400).json({
                success: false,
                message: 'Model ID is required'
            });
            return;
        }

        const conversation = await ChatService.createConversation({
            userId: req.userId,
            title: title || `Chat with ${modelId}`,
            modelId
        });

        res.json({
            success: true,
            data: conversation
        });

    } catch (error) {
        logger.error('Error creating conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create conversation',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Delete a conversation
 */
export const deleteConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.userId) {
            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const { conversationId } = req.params;

        if (!conversationId) {
            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        await ChatService.deleteConversation(conversationId, req.userId);

        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });

    } catch (error) {
        logger.error('Error deleting conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete conversation',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get available models for chat
 */
export const getAvailableModels = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const models = await ChatService.getAvailableModels();

        res.json({
            success: true,
            data: models
        });

    } catch (error) {
        logger.error('Error getting available models:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get available models',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}; 