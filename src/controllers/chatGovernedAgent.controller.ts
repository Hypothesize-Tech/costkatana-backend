import { Response } from 'express';
import { loggingService } from '@services/logging.service';
import { TaskClassifierService } from '@services/taskClassifier.service';
import { GovernedAgentService } from '@services/governedAgent.service';
import { SSEService } from '@services/sse.service';
import { GovernedPlanMessageCreator } from '@services/chat/autonomous';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

/**
 * Controller for integrating governed agent with chat system
 */
export class ChatGovernedAgentController {
    /**
     * Classify a chat message to determine if governed agent should be used
     */
    static async classifyMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('classifyMessage', req);
        
        const { message } = req.body;

        try {

            if (!message || typeof message !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'Message is required'
                });
                return;
            }

            loggingService.info('Classifying message for governed agent', {
                userId,
                messageLength: message.length,
                component: 'ChatGovernedAgentController',
                operation: 'classifyMessage'
            });

            const classification = await TaskClassifierService.classifyTask(message, userId);

            const shouldUseGovernedAgent = classification.requiresPlanning || 
                                          classification.complexity === 'high' ||
                                          classification.riskLevel === 'high' ||
                                          classification.type === 'coding';

            const duration = Date.now() - startTime;

            ControllerHelper.logRequestSuccess('classifyMessage', req, startTime, {
                shouldUseGovernedAgent,
                classificationType: classification.type,
                complexity: classification.complexity,
                riskLevel: classification.riskLevel
            });

            res.json({
                success: true,
                data: {
                    shouldUseGovernedAgent,
                    classification,
                    reason: shouldUseGovernedAgent 
                        ? 'This task would benefit from structured planning and verification'
                        : 'This task can be handled directly'
                }
            });

        } catch (error: any) {
            ControllerHelper.handleError('classifyMessage', error, req, res, startTime);
        }
    }

    /**
     * Initiate a governed agent task from chat
     */
    static async initiateFromChat(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('initiateFromChat', req);
        
        const { message, conversationId } = req.body;

        try {

            if (!message || typeof message !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'Message is required'
                });
                return;
            }

            loggingService.info('Initiating governed task from chat', {
                userId,
                messageLength: message.length,
                conversationId,
                component: 'ChatGovernedAgentController',
                operation: 'initiateFromChat'
            });

            // Create or get conversation
            let chatId = conversationId;
            
            if (!chatId) {
                // Create a new conversation if not provided
                const { Conversation } = await import('../models/Conversation');
                const newConversation = await Conversation.create({
                    userId,
                    title: message.substring(0, 100),
                    modelId: 'governed-agent',
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                chatId = newConversation._id.toString();
                
                loggingService.info('Created new conversation for governed task', {
                    userId,
                    conversationId: chatId,
                    component: 'ChatGovernedAgentController'
                });
            }

            // Create the user message in the conversation
            const { ChatMessage } = await import('../models/ChatMessage');
            const userMessage = await ChatMessage.create({
                conversationId: new mongoose.Types.ObjectId(chatId),
                userId: new mongoose.Types.ObjectId(userId),
                role: 'user',
                content: message,
                timestamp: new Date()
            });
            const parentMessageId = userMessage._id.toString();

            // Initiate the governed task with chat context
            const task = await GovernedAgentService.initiateTask(
                message, 
                userId,
                chatId,
                parentMessageId
            );
            const taskId = (task as any)._id?.toString() || task.id;

            // Create a governed plan message in the chat
            const planMessage = await GovernedPlanMessageCreator.createPlanMessage(
                chatId,
                taskId,
                userId
            );

            ControllerHelper.logRequestSuccess('initiateFromChat', req, startTime, {
                taskId,
                chatId,
                parentMessageId,
                planMessageId: planMessage._id,
                mode: task.mode,
                status: task.status
            });

            res.json({
                success: true,
                data: {
                    taskId,
                    conversationId: chatId,
                    mode: task.mode,
                    classification: task.classification,
                    status: task.status,
                    message: 'Governed agent task initiated successfully'
                }
            });

        } catch (error: any) {
            ControllerHelper.handleError('initiateFromChat', error, req, res, startTime);
        }
    }

    /**
     * Stream governed agent workflow progress via SSE
     * GET /api/chat/governed/:taskId/stream
     */
    static async streamTaskProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('streamTaskProgress', req, { taskId });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            loggingService.info('Started SSE stream for governed task', { taskId, userId, component: 'ChatGovernedAgentController', operation: 'streamTaskProgress' });

            // Register this client with SSEService for file_generation events
            const clientId = `sse_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            SSEService.addClient(`task_${taskId}`, clientId, res);

            // Send initial connection event
            res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', taskId, timestamp: new Date().toISOString() })}\n\n`);

            let lastSentTaskState: any = null;
            let pollInterval: NodeJS.Timeout | null = null;
            let heartbeatInterval: NodeJS.Timeout | null = null;
            const maxDuration = 30 * 60 * 1000; // 30 minutes max (for file-by-file code generation)
            const startTime = Date.now();

            const cleanupIntervals = () => {
                if (pollInterval) clearInterval(pollInterval);
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                SSEService.removeClient(`task_${taskId}`, clientId); // Remove from SSEService
            };

            const sendUpdate = async () => {
                try {
                    // Check if connection is still open
                    if (res.writableEnded || res.destroyed) {
                        cleanupIntervals();
                        return;
                    }

                    // Check if we've exceeded max duration
                    if (Date.now() - startTime > maxDuration) {
                        res.write(`event: timeout\ndata: ${JSON.stringify({ type: 'timeout', message: 'Stream timeout exceeded (30 min)' })}\n\n`);
                        cleanupIntervals();
                        res.end();
                        loggingService.warn('SSE stream exceeded max duration', { taskId, userId, component: 'ChatGovernedAgentController' });
                        return;
                    }

                    const task = await GovernedAgentService.getTask(taskId, userId);

                    if (!task) {
                        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: 'Task not found' })}\n\n`);
                        cleanupIntervals();
                        res.end();
                        return;
                    }

                    const currentTaskState = {
                        mode: task.mode,
                        status: task.status,
                        classification: task.classification,
                        scopeAnalysis: task.scopeAnalysis,
                        plan: task.plan,
                        executionProgress: task.executionProgress,
                        verification: task.verification,
                        error: task.error
                    };

                    // Always send state if it changed
                    const stateChanged = JSON.stringify(currentTaskState) !== JSON.stringify(lastSentTaskState);
                    if (stateChanged) {
                        loggingService.debug('SSE sending update', { taskId, mode: task.mode, status: task.status, component: 'ChatGovernedAgentController' });
                        res.write(`event: update\ndata: ${JSON.stringify({ type: 'update', ...currentTaskState, timestamp: new Date().toISOString() })}\n\n`);
                        lastSentTaskState = currentTaskState;
                    }

                    // Check for terminal states
                    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                        loggingService.info('SSE task reached terminal state', { taskId, status: task.status, component: 'ChatGovernedAgentController' });
                        res.write(`event: complete\ndata: ${JSON.stringify({ type: 'complete', status: task.status, timestamp: new Date().toISOString() })}\n\n`);
                        cleanupIntervals();
                        res.end();
                    }
                } catch (pollError: any) {
                    loggingService.error('Error polling task for SSE', { 
                        error: pollError.message || 'Unknown error', 
                        stack: pollError.stack, 
                        taskId, 
                        userId, 
                        component: 'ChatGovernedAgentController' 
                    });
                    if (!res.writableEnded && !res.destroyed) {
                        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: 'Error polling task progress' })}\n\n`);
                        cleanupIntervals();
                        res.end();
                    }
                }
            };

            // Start polling immediately, then every 500ms
            sendUpdate();
            pollInterval = setInterval(sendUpdate, 500);
            
            // Send heartbeat every 5 seconds
            heartbeatInterval = setInterval(() => {
                if (!res.writableEnded && !res.destroyed) {
                    res.write(`event: heartbeat\ndata: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
                } else {
                    cleanupIntervals();
                }
            }, 5000);

            // Handle client disconnect
            (req as any).on('close', () => {
                cleanupIntervals();
                loggingService.info('SSE stream closed by client', { taskId, userId, component: 'ChatGovernedAgentController' });
            });

            // Handle response finish
            res.on('finish', () => {
                cleanupIntervals();
                loggingService.debug('SSE response finished', { taskId, userId, component: 'ChatGovernedAgentController' });
            });

        } catch (error: any) {
            if (!res.headersSent) {
                ControllerHelper.handleError('streamTaskProgress', error, req, res, startTime, { taskId });
            }
        }
    }

    /**
     * Request plan generation (user manually triggers this after reviewing scope)
     */
    static async requestPlan(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('requestPlan', req, { taskId });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            // Trigger plan generation
            GovernedAgentService.generatePlan(taskId, userId).catch(error => {
                loggingService.error('Plan generation failed', {
                    component: 'ChatGovernedAgentController',
                    operation: 'requestPlan',
                    taskId,
                    error: error instanceof Error ? error.message : String(error)
                });
            });

            ControllerHelper.logRequestSuccess('requestPlan', req, startTime, { taskId });

            res.json({
                success: true,
                message: 'Plan generation started'
            });

        } catch (error: any) {
            ControllerHelper.handleError('requestPlan', error, req, res, startTime, { taskId });
        }
    }

    /**
     * Submit clarifying answers and trigger plan generation
     */
    static async submitClarifyingAnswers(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        const { answers } = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('submitClarifyingAnswers', req, { taskId });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            if (!answers || typeof answers !== 'object') {
                res.status(400).json({ success: false, message: 'Answers object is required' });
                return;
            }

            // Submit answers and trigger plan generation
            await GovernedAgentService.submitClarifyingAnswers(taskId, userId, answers);

            ControllerHelper.logRequestSuccess('submitClarifyingAnswers', req, startTime, {
                taskId,
                answersCount: Object.keys(answers).length
            });

            res.json({
                success: true,
                message: 'Answers submitted, generating plan...'
            });

        } catch (error: any) {
            ControllerHelper.handleError('submitClarifyingAnswers', error, req, res, startTime, { taskId });
        }
    }

    /**
     * Approve plan and start execution
     */
    static async approvePlan(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('approvePlan', req, { taskId });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            // Trigger execution
            GovernedAgentService.executePlan(taskId, userId).catch(error => {
                loggingService.error('Execution failed', {
                    component: 'ChatGovernedAgentController',
                    operation: 'approvePlan',
                    taskId,
                    error: error instanceof Error ? error.message : String(error)
                });
            });

            ControllerHelper.logRequestSuccess('approvePlan', req, startTime, { taskId });

            res.json({
                success: true,
                message: 'Execution started'
            });

        } catch (error: any) {
            ControllerHelper.handleError('approvePlan', error, req, res, startTime, { taskId });
        }
    }

    /**
     * Request changes to the plan
     */
    static async requestPlanChanges(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        const { feedback } = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('requestPlanChanges', req, { taskId });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            if (!feedback || typeof feedback !== 'string') {
                res.status(400).json({ success: false, message: 'Feedback is required' });
                return;
            }

            // Save the feedback to the task (appends to userRequest)
            await GovernedAgentService.saveTaskFeedback(taskId, userId, feedback);

            // Regenerate the plan with the updated user request (which now includes feedback)
            GovernedAgentService.generatePlan(taskId, userId).catch(error => {
                loggingService.error('Plan regeneration failed', {
                    component: 'ChatGovernedAgentController',
                    operation: 'requestPlanChanges',
                    taskId,
                    error: error instanceof Error ? error.message : String(error)
                });
            });

            ControllerHelper.logRequestSuccess('requestPlanChanges', req, startTime, { taskId });

            res.json({
                success: true,
                message: 'Plan regeneration started with your feedback'
            });

        } catch (error: any) {
            ControllerHelper.handleError('requestPlanChanges', error, req, res, startTime, { taskId });
        }
    }

    /**
     * Go back to previous mode
     */
    static async goBack(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('goBack', req, { taskId });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            await GovernedAgentService.goBackToPreviousMode(taskId, userId);

            ControllerHelper.logRequestSuccess('goBack', req, startTime, { taskId });

            res.json({
                success: true,
                message: 'Navigated back successfully'
            });

        } catch (error: any) {
            ControllerHelper.handleError('goBack', error, req, res, startTime, { taskId });
        }
    }

    /**
     * Navigate to a specific mode
     */
    static async navigateToMode(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { taskId } = req.params;
        const { mode } = req.body;
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('navigateToMode', req, { taskId, mode });

        try {
            ServiceHelper.validateObjectId(taskId, 'taskId');

            if (!mode || typeof mode !== 'string') {
                res.status(400).json({ success: false, message: 'Mode is required' });
                return;
            }

            await GovernedAgentService.navigateToMode(taskId, userId, mode as any);

            ControllerHelper.logRequestSuccess('navigateToMode', req, startTime, { taskId, mode });

            res.json({
                success: true,
                message: `Navigated to ${mode} successfully`
            });

        } catch (error: any) {
            ControllerHelper.handleError('navigateToMode', error, req, res, startTime, { taskId, mode });
        }
    }
}
