import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { authenticate } from '../middleware/auth.middleware';
import { communityService } from '../services/community.service';
import { liveChatService } from '../services/liveChat.service';
import { adminNotificationService } from '../services/adminNotification.service';
import { aiChatAssistantService } from '../services/aiChatAssistant.service';
import { loggingService } from '../services/logging.service';
import { User } from '../models/User';

const router = Router();

// Helper to extract user info from authenticated request
const getUserInfo = async (req: any) => {
    if (!req.user) {
        throw new Error('User not authenticated');
    }

    // Get userId - auth middleware sets req.user.id as string
    const userId = req.user.id || (req.user._id ? String(req.user._id) : null);
    if (!userId) {
        throw new Error('User ID not found in request');
    }

    // Try to get user details from database if available
    let userName = req.user.name;
    let userAvatar = req.user.avatar;
    
    // If name/avatar not in req.user, try to fetch from User model
    if (!userName || !userAvatar) {
        try {
            const user = await User.findById(userId).select('name avatar email').lean();
            if (user) {
                userName = userName || user.name || user.email?.split('@')[0] || 'Anonymous';
                userAvatar = userAvatar || user.avatar;
            }
        } catch (error) {
            // If fetch fails, use fallback values
            loggingService.warn('Failed to fetch user details', { error, userId });
        }
    }

    return {
        userId: String(userId),
        userName: userName || req.user.email?.split('@')[0] || 'Anonymous',
        userAvatar,
    email: req.user.email,
    role: req.user.role || 'user',
    isAdmin: req.user.role === 'admin',
    };
};

// ==================== COMMENTS ====================

/**
 * POST /community/comments
 * Add a comment to a documentation page
 */
router.post('/comments', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId, pagePath, content, parentId } = req.body;

        if (!pageId || !pagePath || !content) {
            res.status(400).json({ error: 'Missing required fields: pageId, pagePath, content' });
            return;
        }

        if (content.length > 5000) {
            res.status(400).json({ error: 'Comment too long (max 5000 characters)' });
            return;
        }

        const user = await getUserInfo(req);
        const comment = await communityService.createComment({
            pageId,
            pagePath,
            content,
            parentId,
            user,
        });

        res.status(201).json({ success: true, data: comment });
    } catch (error: any) {
        loggingService.error('Error creating comment', { 
            error: error.message || error,
            stack: error.stack,
            body: req.body 
        });
        res.status(500).json({ 
            error: 'Failed to create comment',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /community/comments/:pageId
 * Get comments for a page
 */
router.get('/comments/:pageId', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const { page, limit, sortBy } = req.query;

        const result = await communityService.getPageComments(pageId, {
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            sortBy: sortBy as 'newest' | 'oldest' | 'popular',
        });

        res.json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error getting comments', { error });
        res.status(500).json({ error: 'Failed to get comments' });
    }
});

/**
 * GET /community/comments/:commentId/replies
 * Get replies for a comment
 */
router.get('/comments/:commentId/replies', async (req: Request, res: Response): Promise<void> => {
    try {
        const { commentId } = req.params;
        const replies = await communityService.getCommentReplies(commentId);
        res.json({ success: true, data: replies });
    } catch (error) {
        loggingService.error('Error getting replies', { error });
        res.status(500).json({ error: 'Failed to get replies' });
    }
});

/**
 * PUT /community/comments/:id
 * Edit a comment
 */
router.put('/comments/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const user = await getUserInfo(req);

        if (!content || content.length > 5000) {
            res.status(400).json({ error: 'Invalid content' });
            return;
        }

        const comment = await communityService.updateComment(id, user.userId, content, user.isAdmin);
        
        if (!comment) {
            res.status(404).json({ error: 'Comment not found or unauthorized' });
            return;
        }

        res.json({ success: true, data: comment });
    } catch (error) {
        loggingService.error('Error updating comment', { error });
        res.status(500).json({ error: 'Failed to update comment' });
    }
});

/**
 * DELETE /community/comments/:id
 * Delete a comment
 */
router.delete('/comments/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const user = await getUserInfo(req);

        const success = await communityService.deleteComment(id, user.userId, user.isAdmin);
        
        if (!success) {
            res.status(404).json({ error: 'Comment not found or unauthorized' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        loggingService.error('Error deleting comment', { error });
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

/**
 * POST /community/comments/:id/vote
 * Vote on a comment
 */
router.post('/comments/:id/vote', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { voteType } = req.body;
        const user = await getUserInfo(req);

        if (!['up', 'down'].includes(voteType)) {
            res.status(400).json({ error: 'Invalid vote type' });
            return;
        }

        const comment = await communityService.voteComment(id, user.userId, voteType);
        
        if (!comment) {
            res.status(404).json({ error: 'Comment not found' });
            return;
        }

        res.json({ success: true, data: comment });
    } catch (error) {
        loggingService.error('Error voting on comment', { error });
        res.status(500).json({ error: 'Failed to vote' });
    }
});

// ==================== USER EXAMPLES ====================

/**
 * POST /community/examples
 * Submit a new example
 */
router.post('/examples', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { title, description, code, language, category, tags, relatedPageId, relatedPagePath } = req.body;

        if (!title || !description || !code || !language || !category) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const user = await getUserInfo(req);
        const example = await communityService.createExample({
            title,
            description,
            code,
            language,
            category,
            tags,
            relatedPageId,
            relatedPagePath,
            user,
        });

        res.status(201).json({ success: true, data: example });
    } catch (error) {
        loggingService.error('Error creating example', { error });
        res.status(500).json({ error: 'Failed to create example' });
    }
});

/**
 * GET /community/examples
 * List examples with filters
 */
router.get('/examples', async (req: Request, res: Response): Promise<void> => {
    try {
        const { page, limit, category, language, tags, sortBy } = req.query;

        const result = await communityService.getExamples({
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            category: category as string,
            language: language as string,
            tags: tags ? (tags as string).split(',') : undefined,
            sortBy: sortBy as 'newest' | 'popular' | 'views',
        });

        res.json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error getting examples', { error });
        res.status(500).json({ error: 'Failed to get examples' });
    }
});

/**
 * GET /community/examples/:id
 * Get example details
 */
router.get('/examples/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const example = await communityService.getExampleById(id);
        
        if (!example) {
            res.status(404).json({ error: 'Example not found' });
            return;
        }

        res.json({ success: true, data: example });
    } catch (error) {
        loggingService.error('Error getting example', { error });
        res.status(500).json({ error: 'Failed to get example' });
    }
});

/**
 * PUT /community/examples/:id
 * Update an example
 */
router.put('/examples/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { title, description, code, language, category, tags } = req.body;
        const user = await getUserInfo(req);

        const example = await communityService.updateExample(id, user.userId, {
            title,
            description,
            code,
            language,
            category,
            tags,
        });
        
        if (!example) {
            res.status(404).json({ error: 'Example not found or unauthorized' });
            return;
        }

        res.json({ success: true, data: example });
    } catch (error) {
        loggingService.error('Error updating example', { error });
        res.status(500).json({ error: 'Failed to update example' });
    }
});

/**
 * POST /community/examples/:id/vote
 * Vote on an example
 */
router.post('/examples/:id/vote', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { voteType } = req.body;
        const user = await getUserInfo(req);

        if (!['up', 'down'].includes(voteType)) {
            res.status(400).json({ error: 'Invalid vote type' });
            return;
        }

        const example = await communityService.voteExample(id, user.userId, voteType);
        
        if (!example) {
            res.status(404).json({ error: 'Example not found' });
            return;
        }

        res.json({ success: true, data: example });
    } catch (error) {
        loggingService.error('Error voting on example', { error });
        res.status(500).json({ error: 'Failed to vote' });
    }
});

// ==================== DISCUSSIONS ====================

/**
 * POST /community/discussions
 * Create a new discussion
 */
router.post('/discussions', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { title, content, category, tags, relatedPageId, relatedPagePath } = req.body;

        if (!title || !content || !category) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const user = await getUserInfo(req);
        const discussion = await communityService.createDiscussion({
            title,
            content,
            category,
            tags,
            relatedPageId,
            relatedPagePath,
            user,
        });

        res.status(201).json({ success: true, data: discussion });
    } catch (error) {
        loggingService.error('Error creating discussion', { error });
        res.status(500).json({ error: 'Failed to create discussion' });
    }
});

/**
 * GET /community/discussions
 * List discussions
 */
router.get('/discussions', async (req: Request, res: Response): Promise<void> => {
    try {
        const { page, limit, category, tags, sortBy } = req.query;

        const result = await communityService.getDiscussions({
            page: page ? parseInt(page as string) : undefined,
            limit: limit ? parseInt(limit as string) : undefined,
            category: category as string,
            tags: tags ? (tags as string).split(',') : undefined,
            sortBy: sortBy as 'newest' | 'active' | 'popular',
        });

        res.json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error getting discussions', { error });
        res.status(500).json({ error: 'Failed to get discussions' });
    }
});

/**
 * GET /community/discussions/:id
 * Get discussion with replies
 */
router.get('/discussions/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const discussion = await communityService.getDiscussionById(id);
        
        if (!discussion) {
            res.status(404).json({ error: 'Discussion not found' });
            return;
        }

        res.json({ success: true, data: discussion });
    } catch (error) {
        loggingService.error('Error getting discussion', { error });
        res.status(500).json({ error: 'Failed to get discussion' });
    }
});

/**
 * POST /community/discussions/:id/replies
 * Add reply to discussion
 */
router.post('/discussions/:id/replies', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { content } = req.body;

        if (!content || content.length > 10000) {
            res.status(400).json({ error: 'Invalid content' });
            return;
        }

        const user = await getUserInfo(req);
        const discussion = await communityService.addReply(id, {
            content,
            user,
        });
        
        if (!discussion) {
            res.status(404).json({ error: 'Discussion not found or locked' });
            return;
        }

        res.status(201).json({ success: true, data: discussion });
    } catch (error) {
        loggingService.error('Error adding reply', { error });
        res.status(500).json({ error: 'Failed to add reply' });
    }
});

/**
 * POST /community/discussions/:id/vote
 * Vote on a discussion
 */
router.post('/discussions/:id/vote', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { voteType } = req.body;
        const user = await getUserInfo(req);

        if (!['up', 'down'].includes(voteType)) {
            res.status(400).json({ error: 'Invalid vote type' });
            return;
        }

        const discussion = await communityService.voteDiscussion(id, user.userId, voteType);
        
        if (!discussion) {
            res.status(404).json({ error: 'Discussion not found' });
            return;
        }

        res.json({ success: true, data: discussion });
    } catch (error) {
        loggingService.error('Error voting on discussion', { error });
        res.status(500).json({ error: 'Failed to vote' });
    }
});

// ==================== LIVE CHAT ====================

/**
 * POST /community/chat/start
 * Start a new chat session
 */
router.post('/chat/start', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { subject, priority, metadata } = req.body;
        const user = await getUserInfo(req);

        if (!subject) {
            res.status(400).json({ error: 'Subject is required' });
            return;
        }

        if (!user.email) {
            res.status(400).json({ error: 'User email is required' });
            return;
        }

        const session = await liveChatService.startSession({
            subject,
            priority,
            metadata,
            user: {
                userId: user.userId,
                userName: user.userName,
                email: user.email,
            },
        });

        // Notify all admins of new session
        adminNotificationService.notifyAllAdmins({
            type: 'new_session',
            sessionId: String(session._id),
            session: {
                _id: session._id,
                subject: session.subject,
                userName: session.userName,
                userEmail: session.userEmail,
                status: session.status,
                priority: session.priority,
            },
            timestamp: new Date().toISOString(),
        });

        res.status(201).json({ success: true, data: session });
    } catch (error) {
        loggingService.error('Error starting chat session', { error });
        res.status(500).json({ error: 'Failed to start chat session' });
    }
});

/**
 * GET /community/chat/sessions
 * Get user's chat sessions
 */
router.get('/chat/sessions', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await getUserInfo(req);
        const sessions = await liveChatService.getUserSessions(user.userId);
        res.json({ success: true, data: sessions });
    } catch (error) {
        loggingService.error('Error getting chat sessions', { error });
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

/**
 * GET /community/chat/messages/:sessionId
 * Get messages for a session (SSE stream)
 */
router.get('/chat/messages/:sessionId', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { sessionId } = req.params;
        const { stream } = req.query;

        if (stream === 'true') {
            // SSE streaming
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx

            // Send initial messages
            try {
                const { messages } = await liveChatService.getMessages(sessionId);
                loggingService.info('Sending initial messages via SSE', {
                    sessionId,
                    messageCount: messages.length,
                });
                res.write(`data: ${JSON.stringify({ type: 'initial', messages })}\n\n`);
                // Flush initial messages immediately
                if (res.flush && typeof res.flush === 'function') {
                    res.flush();
                }
            } catch (error) {
                loggingService.error('Error sending initial messages', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                });
                res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to load messages' })}\n\n`);
            }

            // Subscribe to new messages
            const unsubscribe = liveChatService.subscribeToSession(sessionId, (data) => {
                try {
                    if (!res.writable || res.destroyed) {
                        loggingService.warn('SSE response closed, unsubscribing', { sessionId });
                        unsubscribe();
                        return;
                    }
                    const message = `data: ${JSON.stringify(data)}\n\n`;
                    res.write(message);
                    // Force flush to ensure data is sent immediately
                    if (res.flush && typeof res.flush === 'function') {
                        res.flush();
                    }
                    loggingService.debug('SSE message sent', { sessionId, type: data.type });
                } catch (error) {
                    loggingService.error('Error writing SSE data', { 
                        sessionId, 
                        error: error instanceof Error ? error.message : String(error),
                        writable: res.writable,
                        destroyed: res.destroyed,
                    });
                    unsubscribe();
                }
            });

            // Send keepalive every 15 seconds to prevent connection timeout (more frequent)
            const keepAliveInterval = setInterval(() => {
                try {
                    if (!res.writable || res.destroyed) {
                        clearInterval(keepAliveInterval);
                        unsubscribe();
                        return;
                    }
                    res.write(`: keepalive\n\n`);
                    if (res.flush && typeof res.flush === 'function') {
                        res.flush();
                    }
                } catch (error) {
                    loggingService.error('Error sending keepalive', { sessionId, error });
                    clearInterval(keepAliveInterval);
                    unsubscribe();
                }
            }, 15000); // Reduced from 30s to 15s

            // Cleanup on close
            req.on('close', () => {
                clearInterval(keepAliveInterval);
                unsubscribe();
            });
        } else {
            // Regular fetch
            const { page, limit } = req.query;
            const result = await liveChatService.getMessages(sessionId, {
                page: page ? parseInt(page as string) : undefined,
                limit: limit ? parseInt(limit as string) : undefined,
            });
            res.json({ success: true, data: result });
        }
    } catch (error) {
        loggingService.error('Error getting chat messages', { error });
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

/**
 * POST /community/chat/messages
 * Send a message
 */
router.post('/chat/messages', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { sessionId, content, messageType, senderType } = req.body;
        const user = await getUserInfo(req);

        if (!sessionId || !content) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Determine sender type - admin can send as 'support', users send as 'user'
        const isAdmin = user.isAdmin || user.role === 'admin';
        const finalSenderType = senderType || (isAdmin ? 'support' : 'user');

        // Extract IP address and user agent for security logging
        const ipAddress = req.ip || 
                         req.headers['x-forwarded-for']?.toString().split(',')[0] || 
                         req.socket.remoteAddress || 
                         'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        try {
            const message = await liveChatService.sendMessage({
                sessionId,
                senderId: user.userId,
                senderName: user.userName,
                senderType: finalSenderType as 'user' | 'support' | 'system' | 'ai',
                content,
                messageType,
                ipAddress,
                userAgent
            });

        // If user message and no admin active, trigger AI response (async)
        if (finalSenderType === 'user') {
            const session = await liveChatService.getSession(sessionId);
            if (session) {
                loggingService.info('Processing user message for AI response', {
                    sessionId,
                    aiEnabled: session.aiEnabled,
                    adminActive: liveChatService.isAdminActive(sessionId),
                    lastAiResponseAt: session.lastAiResponseAt,
                });

                if (session.aiEnabled && !liveChatService.isAdminActive(sessionId)) {
                    // Check rate limiting
                    if (aiChatAssistantService.shouldRespond(session.lastAiResponseAt)) {
                        loggingService.info('Triggering AI response', { sessionId });
                        // Trigger AI response asynchronously (don't block response)
                        // Trigger AI response asynchronously (don't block response)
                        setImmediate(async () => {
                            try {
                                // Double-check conditions before generating response
                                const currentSession = await liveChatService.getSession(sessionId);
                                if (!currentSession || !currentSession.aiEnabled || liveChatService.isAdminActive(sessionId)) {
                                    loggingService.info('Skipping AI response - conditions changed', {
                                        sessionId,
                                        aiEnabled: currentSession?.aiEnabled,
                                        adminActive: liveChatService.isAdminActive(sessionId),
                                    });
                                    return;
                                }

                                const { messages } = await liveChatService.getMessages(sessionId);
                                
                                // Filter out system messages and format for AI
                                const chatHistory = messages
                                    .filter(msg => msg.senderType !== 'system') // Exclude system messages
                                    .map(msg => ({
                                        senderType: msg.senderType,
                                        senderName: msg.senderName,
                                        content: msg.content,
                                        createdAt: typeof msg.createdAt === 'string' 
                                            ? new Date(msg.createdAt) 
                                            : (msg.createdAt instanceof Date ? msg.createdAt : new Date()),
                                    }));

                                if (chatHistory.length === 0) {
                                    loggingService.warn('No chat history for AI response', { sessionId });
                                    return;
                                }

                                loggingService.info('Generating AI response', {
                                    sessionId,
                                    messageCount: chatHistory.length,
                                    lastMessage: chatHistory[chatHistory.length - 1]?.content?.substring(0, 50),
                                });

                                const aiResponse = await aiChatAssistantService.generateResponse(
                                    chatHistory,
                                    session.subject,
                                    session.userName
                                );

                                if (!aiResponse || aiResponse.trim().length === 0) {
                                    loggingService.warn('Empty AI response received', { sessionId });
                                    return;
                                }

                                // Triple-check conditions before sending (admin might have joined during AI generation)
                                if (!liveChatService.isAdminActive(sessionId)) {
                                    loggingService.info('Sending AI response', {
                                        sessionId,
                                        responseLength: aiResponse.length,
                                        responsePreview: aiResponse.substring(0, 100),
                                    });
                                    // Use session userId for AI messages (they're part of the session)
                                    await liveChatService.sendMessage({
                                        sessionId,
                                        senderId: String(session.userId),
                                        senderName: 'AI Assistant',
                                        senderType: 'ai',
                                        content: aiResponse.trim(),
                                        isAiGenerated: true,
                                    });
                                } else {
                                    loggingService.info('Admin joined during AI generation, skipping AI response', { sessionId });
                                }
                            } catch (error) {
                                loggingService.error('Error generating AI response', {
                                    sessionId,
                                    error: error instanceof Error ? error.message : String(error),
                                    stack: error instanceof Error ? error.stack : undefined,
                                });
                                // Optionally send a fallback message to the user
                                try {
                                    if (!liveChatService.isAdminActive(sessionId)) {
                                        await liveChatService.sendMessage({
                                            sessionId,
                                            senderId: String(session.userId),
                                            senderName: 'AI Assistant',
                                            senderType: 'ai',
                                            content: "I apologize, but I'm having trouble processing your request right now. Please try rephrasing your question, or our support team will be with you shortly.",
                                            isAiGenerated: true,
                                        });
                                    }
                                } catch (fallbackError) {
                                    loggingService.error('Error sending fallback AI message', {
                                        sessionId,
                                        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                                    });
                                }
                            }
                        });
                    } else {
                        loggingService.info('AI response rate limited', {
                            sessionId,
                            lastAiResponseAt: session.lastAiResponseAt,
                        });
                    }
                }
            }

            // Notify admins of new message
            adminNotificationService.notifyAllAdmins({
                type: 'new_message',
                sessionId,
                session: {
                    _id: session?._id,
                    subject: session?.subject,
                    userName: session?.userName,
                },
                messageData: {
                    content,
                    senderName: user.userName,
                },
                timestamp: new Date().toISOString(),
            });
        }

            res.status(201).json({ success: true, data: message });
        } catch (error: any) {
            // Handle security blocks
            if (error.isSecurityBlock) {
                loggingService.warn('Live chat message blocked by security', {
                    sessionId,
                    userId: user.userId,
                    threatCategory: error.threatCategory,
                    confidence: error.confidence
                });

                res.status(403).json({
                    success: false,
                    error: 'SECURITY_BLOCK',
                    message: error.message || 'Message blocked by security system',
                    threatCategory: error.threatCategory,
                    confidence: error.confidence
                });
                return;
            }

            loggingService.error('Error sending message', { error });
            res.status(500).json({ error: 'Failed to send message' });
        }
    } catch (error) {
        loggingService.error('Error sending message', { error });
        res.status(500).json({ error: 'Failed to send message' });
    }
});

/**
 * POST /community/chat/:sessionId/typing
 * Send typing indicator
 */
router.post('/chat/:sessionId/typing', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { sessionId } = req.params;
        const { isTyping } = req.body;
        const user = await getUserInfo(req);

        await liveChatService.sendTypingIndicator(sessionId, user.userName, isTyping);
        res.json({ success: true });
    } catch (error) {
        loggingService.error('Error sending typing indicator', { error });
        res.status(500).json({ error: 'Failed to send typing indicator' });
    }
});

/**
 * POST /community/chat/:sessionId/rate
 * Rate a chat session
 */
router.post('/chat/:sessionId/rate', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const { sessionId } = req.params;
        const { rating, feedback } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            res.status(400).json({ error: 'Invalid rating (1-5)' });
            return;
        }

        const session = await liveChatService.rateSession(sessionId, rating, feedback);
        res.json({ success: true, data: session });
    } catch (error) {
        loggingService.error('Error rating session', { error });
        res.status(500).json({ error: 'Failed to rate session' });
    }
});

// ==================== ADMIN CHAT ROUTES ====================

/**
 * GET /community/chat/admin/sessions
 * Get all active/waiting sessions (admin only)
 */
router.get('/chat/admin/sessions', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await getUserInfo(req);
        
        if (!user.isAdmin && user.role !== 'admin') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { status } = req.query;
        let sessions;

        if (status === 'waiting') {
            sessions = await liveChatService.getWaitingSessions();
        } else if (status === 'assigned') {
            sessions = await liveChatService.getAdminSessions(user.userId);
        } else {
            // Get all active/waiting sessions
            const [waiting, assigned] = await Promise.all([
                liveChatService.getWaitingSessions(),
                liveChatService.getAdminSessions(user.userId),
            ]);
            sessions = [...waiting, ...assigned];
        }

        res.json({ success: true, data: sessions });
    } catch (error) {
        loggingService.error('Error getting admin sessions', { error });
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

/**
 * GET /community/chat/admin/sessions/:sessionId
 * Get specific session details
 */
router.get('/chat/admin/sessions/:sessionId', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await getUserInfo(req);
        
        if (!user.isAdmin && user.role !== 'admin') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { sessionId } = req.params;
        const session = await liveChatService.getSession(sessionId);

        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        res.json({ success: true, data: session });
    } catch (error) {
        loggingService.error('Error getting session', { error });
        res.status(500).json({ error: 'Failed to get session' });
    }
});

/**
 * POST /community/chat/admin/sessions/:sessionId/join
 * Admin joins a session
 */
router.post('/chat/admin/sessions/:sessionId/join', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await getUserInfo(req);
        
        if (!user.isAdmin && user.role !== 'admin') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { sessionId } = req.params;
        
        // Validate sessionId format
        if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
            res.status(400).json({ error: 'Invalid session ID' });
            return;
        }

        // Validate userId format
        if (!user.userId || !Types.ObjectId.isValid(user.userId)) {
            loggingService.error('Invalid user ID format', { userId: user.userId });
            res.status(400).json({ error: 'Invalid user ID' });
            return;
        }

        const session = await liveChatService.assignAdmin(sessionId, user.userId, user.userName);

        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        // Notify other admins
        try {
            adminNotificationService.notifyAllAdmins({
                type: 'session_assigned',
                sessionId,
                adminId: user.userId,
                adminName: user.userName,
                session: {
                    _id: session._id,
                    subject: session.subject,
                    userName: session.userName,
                },
                timestamp: new Date().toISOString(),
            });
        } catch (notifError) {
            // Log but don't fail the join if notification fails
            loggingService.error('Failed to notify admins', { error: notifError });
        }

        res.json({ success: true, data: session });
    } catch (error) {
        loggingService.error('Error joining session', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            sessionId: req.params.sessionId,
        });
        res.status(500).json({ error: 'Failed to join session' });
    }
});

/**
 * POST /community/chat/admin/sessions/:sessionId/leave
 * Admin leaves a session
 */
router.post('/chat/admin/sessions/:sessionId/leave', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await getUserInfo(req);
        
        if (!user.isAdmin && user.role !== 'admin') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { sessionId } = req.params;
        await liveChatService.removeAdmin(sessionId, user.userId);

        // Send system message
        await liveChatService.sendMessage({
            sessionId,
            senderId: user.userId,
            senderName: 'System',
            senderType: 'system',
            content: `${user.userName} has left the chat.`,
        });

        res.json({ success: true });
    } catch (error) {
        loggingService.error('Error leaving session', { error });
        res.status(500).json({ error: 'Failed to leave session' });
    }
});

/**
 * GET /community/chat/admin/notifications
 * SSE endpoint for admin notifications
 */
router.get('/chat/admin/notifications', authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await getUserInfo(req);
        
        if (!user.isAdmin && user.role !== 'admin') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Subscribe to notifications
        const unsubscribe = adminNotificationService.subscribe(user.userId, (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Notification stream established' })}\n\n`);

        // Cleanup on close
        req.on('close', () => {
            unsubscribe();
        });
    } catch (error) {
        loggingService.error('Error setting up admin notifications', { error });
        res.status(500).json({ error: 'Failed to setup notifications' });
    }
});

// ==================== STATISTICS ====================

/**
 * GET /community/stats
 * Get community statistics
 */
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
    try {
        const stats = await communityService.getCommunityStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        loggingService.error('Error getting community stats', { error });
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

export default router;

