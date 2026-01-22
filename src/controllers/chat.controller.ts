import {  Response } from 'express';
import { loggingService } from '@services/logging.service';
import { ChatService } from '@services/chat.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ChatSecurityHandler, LinkMetadataEnricher } from '@services/chat/security';

// Keep this for backward compatibility with existing code
export type { AuthenticatedRequest };

/**
 * Send a message to a specific AWS Bedrock model
 */
export const sendMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { 
        message, 
        modelId, 
        conversationId, 
        temperature = 0.7, 
        maxTokens = 8000, 
        documentIds, 
        githubContext,
        vercelContext,
        mongodbContext,
        templateId,
        templateVariables,
        useWebSearch,
        chatMode,
        useMultiAgent,
        attachments,
        selectionResponse
    } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Chat message', req, {
            modelId,
            conversationId: conversationId || 'new',
            messageLength: message?.length || 0,
            hasTemplate: !!templateId,
            hasVariables: !!templateVariables,
            temperature,
            maxTokens
        });

        // Validate that either message or templateId is provided (or attachments for file-only messages)
        if (!message && !templateId && !attachments?.length) {
            ControllerHelper.sendError(res, 400, 'Either message, templateId, or attachments must be provided');
            return;
        }

        if (!modelId) {
            ControllerHelper.sendError(res, 400, 'modelId is required');
            return;
        }

        // SECURITY CHECK: Comprehensive threat detection before processing message
        if (message) {
            const securityResult = await ChatSecurityHandler.checkMessageSecurity(
                message,
                userId,
                req,
                maxTokens
            );

            // If threat detected, block the request
            if (securityResult.isBlocked) {
                res.status(403).json({
                    success: false,
                    message: securityResult.reason || 'Message blocked by security system',
                    error: 'SECURITY_BLOCK',
                    threatCategory: securityResult.threatCategory,
                    confidence: securityResult.confidence,
                    stage: securityResult.stage
                });
                return;
            }
        }

        // AUTO-DETECT AND EXTRACT METADATA FOR LINKS IN MESSAGE (non-blocking)
        let enrichedMessage = message;
        if (message) {
            const enrichmentResult = await LinkMetadataEnricher.enrichMessage(message, userId);
            enrichedMessage = enrichmentResult.enrichedMessage;
        }

        const result = await ChatService.sendMessage({
            userId,
            message: enrichedMessage, // Enriched message with instructions for AI
            originalMessage: message, // Original user message for storage/display
            modelId,
            conversationId,
            temperature,
            maxTokens,
            documentIds,
            githubContext,
            vercelContext,
            mongodbContext,
            templateId,
            templateVariables,
            useWebSearch,
            chatMode,
            useMultiAgent,
            attachments,
            selectionResponse,
            req
        });

        // Log success
        ControllerHelper.logRequestSuccess('Chat message', req, startTime, {
            modelId,
            conversationId: conversationId || 'new',
            messageLength: message?.length || 0,
            responseLength: result.response?.length || 0,
            temperature,
            maxTokens
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            'chat_message_sent',
            'chat_management',
            userId,
            Date.now() - startTime,
            {
                modelId,
                conversationId: conversationId || 'new',
                messageLength: message?.length || 0,
                responseLength: result.response?.length || 0,
                temperature,
                maxTokens
            }
        );

        // Debug: Log what we received from service
        loggingService.info('📥 [FLOW-9] CONTROLLER RECEIVED from ChatService.sendMessage', {
            hasMongodbIntegrationData: !!result.mongodbIntegrationData && Object.keys(result.mongodbIntegrationData || {}).length > 0,
            hasFormattedResult: !!result.formattedResult && Object.keys(result.formattedResult || {}).length > 0,
            mongodbIntegrationDataKeys: result.mongodbIntegrationData ? Object.keys(result.mongodbIntegrationData) : [],
            formattedResultKeys: result.formattedResult ? Object.keys(result.formattedResult) : [],
            allResultKeys: Object.keys(result)
        });

        // Ensure fields are included
        const responseData = {
            ...result,
            mongodbIntegrationData: result.mongodbIntegrationData,
            formattedResult: result.formattedResult
        };

        loggingService.info('📤 [FLOW-10] CONTROLLER FINAL RESPONSE to frontend', {
            hasMongodbIntegrationData: !!responseData.mongodbIntegrationData && Object.keys(responseData.mongodbIntegrationData || {}).length > 0,
            hasFormattedResult: !!responseData.formattedResult && Object.keys(responseData.formattedResult || {}).length > 0,
            allResponseDataKeys: Object.keys(responseData)
        });

        res.json({
            success: true,
            data: responseData
        });

    } catch (error: any) {
        ControllerHelper.handleError('Chat message', error, req, res, startTime, {
            modelId,
            conversationId: conversationId || 'new'
        });
    }
};

/**
 * Update the selected view type for a MongoDB result message
 */
export const updateMessageViewType = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { messageId } = req.params;
    const { viewType } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('MongoDB message view type update', req, {
            messageId,
            viewType
        });

        // Defensive checks
        if (!messageId) {
            ControllerHelper.sendError(res, 400, 'Message ID is required');
            return;
        }

        const validViewTypes = ['table', 'json', 'schema', 'stats', 'chart', 'text', 'error', 'empty', 'explain'];
        if (!viewType || !validViewTypes.includes(viewType)) {
            ControllerHelper.sendError(res, 400, 'Invalid viewType provided');
            return;
        }

        const success = await ChatService.updateChatMessageViewType(messageId, userId, viewType);

        if (success) {
            // Log success
            ControllerHelper.logRequestSuccess('MongoDB message view type update', req, startTime, {
                messageId,
                viewType
            });

            ControllerHelper.sendSuccess(res, null, 'View type updated successfully');
        } else {
            loggingService.warn('MongoDB message view type update failed - message not found or not a MongoDB result', {
                userId,
                messageId,
                viewType,
                duration: Date.now() - startTime,
                requestId: req.headers['x-request-id'] as string
            });
            ControllerHelper.sendError(res, 404, 'MongoDB result message not found or not accessible');
        }

    } catch (error: any) {
        ControllerHelper.handleError('MongoDB message view type update', error, req, res, startTime, {
            messageId,
            viewType
        });
    }
};

/**
 * Get conversation history
 */
export const getConversationHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Conversation history', req, {
            conversationId,
            limit,
            offset
        });

        // Defensive check (route validation should catch this)
        if (!conversationId) {
            ControllerHelper.sendError(res, 400, 'Conversation ID is required');
            return;
        }

        const history = await ChatService.getConversationHistory(
            conversationId, 
            userId, 
            limit, 
            offset
        );

        // Log success
        ControllerHelper.logRequestSuccess('Conversation history', req, startTime, {
            conversationId,
            limit,
            offset,
            historyLength: history.messages?.length || 0,
            totalMessages: history.total || 0
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            'conversation_history_retrieved',
            'chat_management',
            userId,
            Date.now() - startTime,
            {
                conversationId,
                limit,
                offset,
                historyLength: history.messages?.length || 0,
                totalMessages: history.total || 0
            }
        );

        ControllerHelper.sendSuccess(res, history);

    } catch (error: any) {
        ControllerHelper.handleError('Conversation history retrieval', error, req, res, startTime, {
            conversationId,
            limit,
            offset
        });
    }
};

/**
 * Get all conversations for a user
 */
export const getUserConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const includeArchived = req.query.includeArchived === 'true';

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('User conversations', req, {
            limit,
            offset,
            includeArchived
        });

        const conversations = await ChatService.getUserConversations(
            userId, 
            limit, 
            offset,
            includeArchived
        );

        // Log success
        ControllerHelper.logRequestSuccess('User conversations', req, startTime, {
            limit,
            offset,
            includeArchived,
            conversationsCount: conversations.conversations?.length || 0,
            totalConversations: conversations.total || 0
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            'user_conversations_retrieved',
            'chat_management',
            userId,
            Date.now() - startTime,
            {
                limit,
                offset,
                includeArchived,
                conversationsCount: conversations.conversations?.length || 0,
                totalConversations: conversations.total || 0
            }
        );

        ControllerHelper.sendSuccess(res, conversations);

    } catch (error: any) {
        ControllerHelper.handleError('User conversations retrieval', error, req, res, startTime, {
            limit,
            offset,
            includeArchived
        });
    }
};

/**
 * Create a new conversation
 */
export const createConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { title, modelId } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        const conversationTitle = title || `Chat with ${modelId}`;

        // Log request start
        ControllerHelper.logRequestStart('Conversation creation', req, {
            title: conversationTitle,
            modelId
        });

        // Defensive check (route/service validation should catch this)
        if (!modelId) {
            ControllerHelper.sendError(res, 400, 'Model ID is required');
            return;
        }

        const conversation: any = await ChatService.createConversation({
            userId,
            title: conversationTitle,
            modelId
        });

        // Log success
        ControllerHelper.logRequestSuccess('Conversation creation', req, startTime, {
            conversationId: conversation.id,
            title: conversationTitle,
            modelId
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            'conversation_created',
            'chat_management',
            userId,
            Date.now() - startTime,
            {
                conversationId: conversation.id,
                title: conversationTitle,
                modelId
            }
        );

        ControllerHelper.sendSuccess(res, conversation);

    } catch (error: any) {
        ControllerHelper.handleError('Conversation creation', error, req, res, startTime, { modelId });
    }
};

/**
 * Update conversation GitHub context
 */
export const updateConversationGitHubContext = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { conversationId } = req.params;
    const { githubContext } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Update GitHub context', req, { conversationId });

        // Defensive checks
        if (!conversationId) {
            ControllerHelper.sendError(res, 400, 'Conversation ID is required');
            return;
        }

        if (!githubContext || !(githubContext as { connectionId?: string; repositoryId?: number }).connectionId || !(githubContext as { connectionId?: string; repositoryId?: number }).repositoryId) {
            ControllerHelper.sendError(res, 400, 'Valid GitHub context is required');
            return;
        }

        const { Conversation } = await import('../models');
        const { GitHubConnection } = await import('../models');

        // Verify conversation ownership
        const conversation = await Conversation.findOne({
            _id: conversationId,
            userId: userId
        });

        if (!conversation) {
            ControllerHelper.sendError(res, 404, 'Conversation not found or access denied');
            return;
        }

        const githubCtx = githubContext as { connectionId: string; repositoryId: number; repositoryName?: string; repositoryFullName?: string };
        
        // Verify GitHub connection exists and belongs to user
        const connection = await GitHubConnection.findOne({
            _id: githubCtx.connectionId,
            userId: userId,
            isActive: true
        });

        if (!connection) {
            ControllerHelper.sendError(res, 404, 'GitHub connection not found or inactive');
            return;
        }

        // Update conversation with GitHub context
        await Conversation.findByIdAndUpdate(conversationId, {
            githubContext: {
                connectionId: connection._id,
                repositoryId: githubCtx.repositoryId,
                repositoryName: githubCtx.repositoryName,
                repositoryFullName: githubCtx.repositoryFullName
            }
        });

        // Log success
        ControllerHelper.logRequestSuccess('Update GitHub context', req, startTime, {
            conversationId,
            repository: githubCtx.repositoryFullName
        });

        ControllerHelper.sendSuccess(res, null, 'GitHub context updated successfully');

    } catch (error: any) {
        ControllerHelper.handleError('Update GitHub context', error, req, res, startTime, { conversationId });
    }
};

/**
 * Delete a conversation
 */
export const deleteConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { conversationId } = req.params;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Conversation deletion', req, { conversationId });

        // Defensive check (route validation should catch this)
        if (!conversationId) {
            ControllerHelper.sendError(res, 400, 'Conversation ID is required');
            return;
        }

        await ChatService.deleteConversation(conversationId, userId);

        // Log success
        ControllerHelper.logRequestSuccess('Conversation deletion', req, startTime, { conversationId });

        // Log business event
        ControllerHelper.logBusinessEvent(
            'conversation_deleted',
            'chat_management',
            userId,
            Date.now() - startTime,
            { conversationId }
        );

        ControllerHelper.sendSuccess(res, null, 'Conversation deleted successfully');

    } catch (error: any) {
        ControllerHelper.handleError('Conversation deletion', error, req, res, startTime, { conversationId });
    }
};

/**
 * Rename a conversation
 */
export const renameConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { id } = req.params;
    const { title } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Conversation rename', req, {
            conversationId: id,
            newTitle: title
        });

        // Validation already handled by express-validator in routes
        // But we keep this defensive check since title could be whitespace
        if (!title || title.trim().length === 0) {
            ControllerHelper.sendError(res, 400, 'Title is required and cannot be empty');
            return;
        }

        const updatedConversation = await ChatService.renameConversation(userId, id, title);

        // Log success
        ControllerHelper.logRequestSuccess('Conversation rename', req, startTime, {
            conversationId: id,
            newTitle: title
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            'conversation_renamed',
            'chat_management',
            userId,
            Date.now() - startTime,
            { conversationId: id }
        );

        ControllerHelper.sendSuccess(res, updatedConversation);

    } catch (error: any) {
        ControllerHelper.handleError('Conversation rename', error, req, res, startTime, {
            conversationId: id
        });
    }
};

/**
 * Archive or unarchive a conversation
 */
export const archiveConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { id } = req.params;
    const { archived } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Conversation archive', req, {
            conversationId: id,
            archived
        });

        // Validation already handled by express-validator in routes
        const updatedConversation = await ChatService.archiveConversation(userId, id, archived);

        // Log success
        ControllerHelper.logRequestSuccess('Conversation archive', req, startTime, {
            conversationId: id,
            archived
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            archived ? 'conversation_archived' : 'conversation_unarchived',
            'chat_management',
            userId,
            Date.now() - startTime,
            { conversationId: id }
        );

        ControllerHelper.sendSuccess(res, updatedConversation);

    } catch (error: any) {
        ControllerHelper.handleError('Conversation archive', error, req, res, startTime, {
            conversationId: id,
            archived
        });
    }
};

/**
 * Pin or unpin a conversation
 */
export const pinConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { id } = req.params;
    const { pinned } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Conversation pin', req, {
            conversationId: id,
            pinned
        });

        // Validation already handled by express-validator in routes
        const updatedConversation = await ChatService.pinConversation(userId, id, pinned);

        // Log success
        ControllerHelper.logRequestSuccess('Conversation pin', req, startTime, {
            conversationId: id,
            pinned
        });

        // Log business event
        ControllerHelper.logBusinessEvent(
            pinned ? 'conversation_pinned' : 'conversation_unpinned',
            'chat_management',
            userId,
            Date.now() - startTime,
            { conversationId: id }
        );

        ControllerHelper.sendSuccess(res, updatedConversation);

    } catch (error: any) {
        ControllerHelper.handleError('Conversation pin', error, req, res, startTime, {
            conversationId: id,
            pinned
        });
    }
};

/**
 * Get available models for chat
 */
export const getAvailableModels = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
        // Log request start (no auth required for this public endpoint)
        loggingService.info('Available models request initiated', {
            requestId: req.headers['x-request-id'] as string
        });

        const models = await ChatService.getAvailableModels();

        // Log success
        loggingService.info('Available models retrieved successfully', {
            duration: Date.now() - startTime,
            modelsCount: models.length,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event (no userId for public endpoint)
        loggingService.logBusiness({
            event: 'available_models_retrieved',
            category: 'chat_management',
            value: Date.now() - startTime,
            metadata: {
                modelsCount: models.length
            }
        });

        ControllerHelper.sendSuccess(res, models);

    } catch (error: any) {
        loggingService.error('Available models retrieval failed', {
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration: Date.now() - startTime,
            requestId: req.headers['x-request-id'] as string
        });

        ControllerHelper.sendError(res, 500, 'Failed to get available models', error);
    }
};

/**
 * Modify a governed plan within a chat
 */
export const modifyPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { chatId } = req.params;
    const { taskId, modifications } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Plan modification', req, {
            chatId,
            taskId,
            modifications
        });

        const { GovernedAgentService } = await import('../services/governedAgent.service');
        
        const updatedTask = await GovernedAgentService.modifyPlan(
            taskId,
            userId,
            modifications
        );

        // Log success
        ControllerHelper.logRequestSuccess('Plan modification', req, startTime, {
            chatId,
            taskId
        });
        
        // Log business event
        ControllerHelper.logBusinessEvent(
            'plan_modified',
            'governed_agent',
            userId,
            Date.now() - startTime,
            {
                chatId,
                taskId,
                modificationType: Object.keys(modifications)
            }
        );

        ControllerHelper.sendSuccess(res, updatedTask);

    } catch (error: any) {
        ControllerHelper.handleError('Plan modification', error, req, res, startTime, {
            chatId,
            taskId
        });
    }
};

/**
 * Ask a question about a governed plan
 */
export const askAboutPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { chatId } = req.params;
    const { taskId, question } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Plan question', req, {
            chatId,
            taskId,
            question
        });

        const { GovernedAgentService } = await import('../services/governedAgent.service');
        
        const answer = await GovernedAgentService.askAboutPlan(
            taskId,
            userId,
            question
        );

        // Log success
        ControllerHelper.logRequestSuccess('Plan question', req, startTime, {
            chatId,
            taskId,
            questionLength: question.length
        });
        
        // Log business event
        ControllerHelper.logBusinessEvent(
            'plan_question_answered',
            'governed_agent',
            userId,
            Date.now() - startTime,
            {
                chatId,
                taskId,
                questionLength: question.length
            }
        );

        ControllerHelper.sendSuccess(res, {
            question,
            answer
        });

    } catch (error: any) {
        ControllerHelper.handleError('Plan question', error, req, res, startTime, {
            chatId,
            taskId
        });
    }
};

/**
 * Request code changes for a completed task
 */
export const requestCodeChanges = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { chatId, taskId } = req.params;
    const { changeRequest } = req.body;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Code change request', req, {
            chatId,
            taskId,
            changeRequest
        });

        const { GovernedAgentService } = await import('../services/governedAgent.service');
        
        const newTask = await GovernedAgentService.requestCodeChanges(
            taskId,
            userId,
            changeRequest
        );

        // Log success
        ControllerHelper.logRequestSuccess('Code change request', req, startTime, {
            chatId,
            originalTaskId: taskId,
            newTaskId: newTask.id
        });
        
        // Log business event
        ControllerHelper.logBusinessEvent(
            'code_changes_requested',
            'governed_agent',
            userId,
            Date.now() - startTime,
            {
                chatId,
                originalTaskId: taskId,
                newTaskId: newTask.id
            }
        );

        ControllerHelper.sendSuccess(res, newTask);

    } catch (error: any) {
        ControllerHelper.handleError('Code change request', error, req, res, startTime, {
            chatId,
            taskId
        });
    }
};

/**
 * Get all plans in a chat
 */
export const getChatPlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { chatId } = req.params;

    try {
        // Auth check using helper
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Get chat plans', req, { chatId });

        const { ChatTaskLink } = await import('../models/ChatTaskLink');
        const { GovernedTaskModel } = await import('../services/governedAgent.service');
        
        // Get task links for this chat
        const taskLink = await ChatTaskLink.findOne({ chatId });
        
        if (!taskLink || taskLink.taskIds.length === 0) {
            ControllerHelper.sendSuccess(res, []);
            return;
        }

        // Get all tasks
        const tasks = await GovernedTaskModel.find({
            _id: { $in: taskLink.taskIds },
            userId
        }).sort({ createdAt: -1 });

        // Log success
        ControllerHelper.logRequestSuccess('Get chat plans', req, startTime, {
            chatId,
            plansCount: tasks.length
        });
        
        // Log business event
        ControllerHelper.logBusinessEvent(
            'chat_plans_retrieved',
            'governed_agent',
            userId,
            Date.now() - startTime,
            {
                chatId,
                plansCount: tasks.length
            }
        );

        ControllerHelper.sendSuccess(res, tasks);

    } catch (error: any) {
        ControllerHelper.handleError('Get chat plans', error, req, res, startTime, { chatId });
    }
};

/**
 * Stream chat-wide updates including governed tasks
 */
export const streamChatUpdates = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { chatId } = req.params;

    try {
        // Auth check using helper (but don't return, SSE needs special handling)
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;

        // Log request start
        ControllerHelper.logRequestStart('Chat SSE stream', req, { chatId });

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Send initial connection event
        res.write(`event: connected\ndata: ${JSON.stringify({ 
            type: 'connected', 
            chatId, 
            timestamp: new Date().toISOString() 
        })}\n\n`);

        let pollInterval: NodeJS.Timeout | null = null;
        let heartbeatInterval: NodeJS.Timeout | null = null;
        const maxDuration = 30 * 60 * 1000; // 30 minutes max

        const cleanupIntervals = () => {
            if (pollInterval) clearInterval(pollInterval);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
        };

        // Poll for updates to tasks in this chat
        const sendUpdate = async () => {
            try {
                // Check if connection is still open
                if (res.writableEnded || res.destroyed) {
                    cleanupIntervals();
                    return;
                }

                // Check max duration
                if (Date.now() - startTime > maxDuration) {
                    res.write(`event: timeout\ndata: ${JSON.stringify({ 
                        message: 'Stream timeout after 30 minutes' 
                    })}\n\n`);
                    res.end();
                    cleanupIntervals();
                    return;
                }

                // Get all tasks for this chat
                const { ChatTaskLink } = await import('../models/ChatTaskLink');
                const { GovernedTaskModel } = await import('../services/governedAgent.service');
                
                const taskLink = await ChatTaskLink.findOne({ chatId });
                if (taskLink && taskLink.taskIds.length > 0) {
                    // Get all tasks
                    const tasks = await GovernedTaskModel.find({
                        _id: { $in: taskLink.taskIds },
                        userId
                    });

                    // Send updates for each task
                    for (const task of tasks) {
                        res.write(`event: governed_task_update\ndata: ${JSON.stringify({
                            taskId: task.id,
                            mode: task.mode,
                            status: task.status,
                            classification: task.classification,
                            scopeAnalysis: task.scopeAnalysis,
                            plan: task.plan,
                            executionProgress: task.executionProgress,
                            verification: task.verification,
                            error: task.error,
                            timestamp: new Date().toISOString()
                        })}\n\n`);
                    }
                }

            } catch (error) {
                loggingService.error('Error sending chat SSE update', {
                    error: error instanceof Error ? error.message : String(error),
                    chatId,
                    userId
                });
            }
        };

        // Set up polling interval
        pollInterval = setInterval(sendUpdate, 2000); // Poll every 2 seconds

        // Set up heartbeat
        heartbeatInterval = setInterval(() => {
            if (!res.writableEnded && !res.destroyed) {
                res.write(`event: heartbeat\ndata: ${JSON.stringify({ 
                    timestamp: new Date().toISOString() 
                })}\n\n`);
            }
        }, 30000); // Every 30 seconds

        // Handle client disconnect
        req.on('close', () => {
            loggingService.info('SSE client disconnected for chat', { chatId, userId });
            cleanupIntervals();
        });

        // Send initial update
        await sendUpdate();

    } catch (error: any) {
        loggingService.error('Failed to start chat SSE stream', {
            error: error.message || 'Unknown error',
            stack: error.stack,
            userId: req.userId,
            chatId
        });

        // Only send JSON error if headers haven't been sent yet
        if (!res.headersSent) {
            ControllerHelper.sendError(res, 500, 'Failed to start chat stream', error);
        }
    }
}; 