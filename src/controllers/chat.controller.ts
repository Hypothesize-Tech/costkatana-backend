import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { ChatService } from '../services/chat.service';

export interface AuthenticatedRequest extends Request {
    userId?: string;
}

/**
 * Send a message to a specific AWS Bedrock model
 */
export const sendMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { message, modelId, conversationId, temperature = 0.7, maxTokens = 2000 } = req.body;

    try {
        loggingService.info('Chat message request initiated', {
            userId,
            modelId,
            conversationId: conversationId || 'new',
            messageLength: message?.length || 0,
            temperature,
            maxTokens,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Chat message request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!message || !modelId) {
            loggingService.warn('Chat message request failed - missing required fields', {
                userId,
                hasMessage: !!message,
                hasModelId: !!modelId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Message and modelId are required'
            });
            return;
        }

        const result = await ChatService.sendMessage({
            userId,
            message,
            modelId,
            conversationId,
            temperature,
            maxTokens,
            req
        });

        const duration = Date.now() - startTime;

        loggingService.info('Chat message sent successfully', {
            userId,
            modelId,
            conversationId: conversationId || 'new',
            duration,
            messageLength: message.length,
            responseLength: result.response?.length || 0,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'chat_message_sent',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                modelId,
                conversationId: conversationId || 'new',
                messageLength: message.length,
                responseLength: result.response?.length || 0,
                temperature,
                maxTokens
            }
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Chat message failed', {
            userId,
            modelId,
            conversationId: conversationId || 'new',
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

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
    const startTime = Date.now();
    const userId = req.userId;
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        loggingService.info('Conversation history request initiated', {
            userId,
            conversationId,
            limit,
            offset,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation history request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!conversationId) {
            loggingService.warn('Conversation history request failed - missing conversation ID', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        const history = await ChatService.getConversationHistory(
            conversationId, 
            userId, 
            limit, 
            offset
        );

        const duration = Date.now() - startTime;

        loggingService.info('Conversation history retrieved successfully', {
            userId,
            conversationId,
            duration,
            limit,
            offset,
            historyLength: history.messages?.length || 0,
            totalMessages: history.total || 0,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'conversation_history_retrieved',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId,
                limit,
                offset,
                historyLength: history.messages?.length || 0,
                totalMessages: history.total || 0
            }
        });

        res.json({
            success: true,
            data: history
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation history retrieval failed', {
            userId,
            conversationId,
            limit,
            offset,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

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
    const startTime = Date.now();
    const userId = req.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        loggingService.info('User conversations request initiated', {
            userId,
            limit,
            offset,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('User conversations request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const conversations = await ChatService.getUserConversations(
            userId, 
            limit, 
            offset
        );

        const duration = Date.now() - startTime;

        loggingService.info('User conversations retrieved successfully', {
            userId,
            duration,
            limit,
            offset,
            conversationsCount: conversations.conversations?.length || 0,
            totalConversations: conversations.total || 0,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'user_conversations_retrieved',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                limit,
                offset,
                conversationsCount: conversations.conversations?.length || 0,
                totalConversations: conversations.total || 0
            }
        });

        res.json({
            success: true,
            data: conversations
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('User conversations retrieval failed', {
            userId,
            limit,
            offset,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

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
    const startTime = Date.now();
    const userId = req.userId;
    const { title, modelId } = req.body;

    try {
        loggingService.info('Conversation creation request initiated', {
            userId,
            title: title || `Chat with ${modelId}`,
            modelId,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation creation request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!modelId) {
            loggingService.warn('Conversation creation request failed - missing model ID', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Model ID is required'
            });
            return;
        }

        const conversation: any = await ChatService.createConversation({
            userId,
            title: title || `Chat with ${modelId}`,
            modelId
        });

        const duration = Date.now() - startTime;

        loggingService.info('Conversation created successfully', {
            userId,
            conversationId: conversation.id,
            title: title || `Chat with ${modelId}`,
            modelId,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'conversation_created',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId: conversation.id,
                title: title || `Chat with ${modelId}`,
                modelId
            }
        });

        res.json({
            success: true,
            data: conversation
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation creation failed', {
            userId,
            title: title || `Chat with ${modelId}`,
            modelId,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

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
    const startTime = Date.now();
    const userId = req.userId;
    const { conversationId } = req.params;

    try {
        loggingService.info('Conversation deletion request initiated', {
            userId,
            conversationId,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation deletion request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!conversationId) {
            loggingService.warn('Conversation deletion request failed - missing conversation ID', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        await ChatService.deleteConversation(conversationId, userId);

        const duration = Date.now() - startTime;

        loggingService.info('Conversation deleted successfully', {
            userId,
            conversationId,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'conversation_deleted',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId
            }
        });

        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation deletion failed', {
            userId,
            conversationId,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

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
    const startTime = Date.now();

    try {
        loggingService.info('Available models request initiated', {
            requestId: _req.headers['x-request-id'] as string
        });

        const models = await ChatService.getAvailableModels();

        const duration = Date.now() - startTime;

        loggingService.info('Available models retrieved successfully', {
            duration,
            modelsCount: models.length,
            requestId: _req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'available_models_retrieved',
            category: 'chat_management',
            value: duration,
            metadata: {
                modelsCount: models.length
            }
        });

        res.json({
            success: true,
            data: models
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Available models retrieval failed', {
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: _req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get available models',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}; 