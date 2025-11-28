import { Types } from 'mongoose';
import { ChatSession, IChatSession, ChatMessage, IChatMessage } from '../models/community';
import { loggingService } from './logging.service';
import { cacheService } from './cache.service';

export interface ChatUserInfo {
    userId: string;
    userName: string;
    email: string;
}

interface SSEData {
    type: string;
    [key: string]: unknown;
}

export class LiveChatService {
    private static instance: LiveChatService;
    private sseClients: Map<string, Set<(data: SSEData) => void>> = new Map();
    private adminPresence: Map<string, Set<string>> = new Map(); // sessionId -> Set of adminIds

    private constructor() {}

    static getInstance(): LiveChatService {
        if (!LiveChatService.instance) {
            LiveChatService.instance = new LiveChatService();
        }
        return LiveChatService.instance;
    }

    // ==================== SESSION MANAGEMENT ====================

    async startSession(data: {
        subject: string;
        user: ChatUserInfo;
        priority?: 'low' | 'normal' | 'high' | 'urgent';
        metadata?: Record<string, unknown>;
    }): Promise<IChatSession> {
        // Check for existing active session
        const existingSession = await ChatSession.findOne({
            userId: new Types.ObjectId(data.user.userId),
            status: { $in: ['active', 'waiting'] },
        });

        if (existingSession) {
            return existingSession;
        }

        const session = await ChatSession.create({
            userId: new Types.ObjectId(data.user.userId),
            userName: data.user.userName,
            userEmail: data.user.email,
            subject: data.subject,
            status: 'waiting',
            priority: data.priority ?? 'normal',
            metadata: data.metadata,
        });

        // Add messages (non-blocking - don't fail session creation if message fails)
        const sessionId = String(session._id);
        try {
            // First, create the user's first message with the subject content
            await this.sendMessage({
                sessionId,
                senderId: String(session.userId),
                senderName: data.user.userName,
                senderType: 'user',
                content: data.subject,
                messageType: 'text',
            });

            // Then add system message
            await this.sendMessage({
                sessionId,
                senderId: String(session.userId),
                senderName: 'System',
                senderType: 'system',
                content: `Chat session started. Our support team will be with you shortly.`,
            });
        } catch (error) {
            loggingService.error('Failed to send initial messages', { sessionId, error });
            // Continue even if message sending fails
        }

        loggingService.info('Chat session started', { sessionId, userId: data.user.userId });
        return session;
    }

    async getSession(sessionId: string): Promise<IChatSession | null> {
        return ChatSession.findById(sessionId);
    }

    async getUserSessions(userId: string): Promise<IChatSession[]> {
        return ChatSession.find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .limit(20);
    }

    async updateSessionStatus(
        sessionId: string,
        status: 'active' | 'waiting' | 'resolved' | 'closed'
    ): Promise<IChatSession | null> {
        const updateData: Record<string, unknown> = { status };
        
        if (status === 'resolved') {
            updateData.resolvedAt = new Date();
        } else if (status === 'closed') {
            updateData.closedAt = new Date();
        }

        const session = await ChatSession.findByIdAndUpdate(sessionId, updateData, { new: true });
        
        if (session) {
            this.broadcastToSession(sessionId, {
                type: 'status_update',
                status,
                timestamp: new Date().toISOString(),
            });
        }

        return session;
    }

    async rateSession(sessionId: string, rating: number, feedback?: string): Promise<IChatSession | null> {
        return ChatSession.findByIdAndUpdate(
            sessionId,
            { rating, feedback },
            { new: true }
        );
    }

    // ==================== MESSAGES ====================

    async sendMessage(data: {
        sessionId: string;
        senderId: string;
        senderName: string;
        senderType: 'user' | 'support' | 'system' | 'ai';
        content: string;
        messageType?: 'text' | 'code' | 'link' | 'image' | 'file';
        attachments?: { name: string; url: string; type: string; size: number }[];
        isAiGenerated?: boolean;
    }): Promise<IChatMessage> {
        const message = await ChatMessage.create({
            sessionId: new Types.ObjectId(data.sessionId),
            senderId: new Types.ObjectId(data.senderId),
            senderName: data.senderName,
            senderType: data.senderType,
            content: data.content,
            messageType: data.messageType ?? 'text',
            attachments: data.attachments,
            isAiGenerated: data.isAiGenerated ?? (data.senderType === 'ai'),
        });

        // Update session
        const updateData: Record<string, unknown> = {
            $inc: { messageCount: 1 },
            lastMessageAt: new Date(),
        };

        if (data.senderType === 'ai') {
            updateData.lastAiResponseAt = new Date();
        }

        await ChatSession.findByIdAndUpdate(data.sessionId, updateData);

        // Broadcast to SSE clients - serialize message for frontend
        const serializedMessage: any = {
            _id: String(message._id),
            sessionId: String(message.sessionId),
            senderId: String(message.senderId),
            senderName: message.senderName,
            senderType: message.senderType,
            content: message.content,
            messageType: message.messageType || 'text',
            isAiGenerated: message.isAiGenerated || false,
            createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : (message.createdAt as any),
        };

        // Include optional fields if they exist
        if (message.attachments) {
            serializedMessage.attachments = message.attachments;
        }
        if (message.isRead !== undefined) {
            serializedMessage.isRead = message.isRead;
        }

        loggingService.info('Broadcasting new message to SSE clients', {
            sessionId: data.sessionId,
            messageId: serializedMessage._id,
            senderType: serializedMessage.senderType,
        });

        this.broadcastToSession(data.sessionId, {
            type: 'new_message',
            message: serializedMessage,
        });

        // Cache for quick retrieval
        await cacheService.set(
            `chat:latest:${data.sessionId}`,
            JSON.stringify(message),
            60
        );

        return message;
    }

    async getMessages(sessionId: string, options?: {
        page?: number;
        limit?: number;
        before?: Date;
    }): Promise<{ messages: IChatMessage[]; hasMore: boolean }> {
        const limit = options?.limit ?? 50;
        const sessionObjectId = new Types.ObjectId(sessionId);
        const query: Record<string, unknown> = { sessionId: sessionObjectId };
        
        if (options?.before) {
            query.createdAt = { $lt: options.before };
        }

        loggingService.info('Querying messages from database', {
            sessionId,
            sessionObjectId: sessionObjectId.toString(),
            query,
            collection: ChatMessage.collection.name,
        });

        const messages = await ChatMessage.find(query)
            .sort({ createdAt: 1 }) // Sort ascending for chronological order
            .limit(limit + 1)
            .lean();

        loggingService.info('Database query result', {
            sessionId,
            foundCount: messages.length,
            sampleMessage: messages.length > 0 ? {
                _id: String(messages[0]._id),
                sessionId: String(messages[0].sessionId),
                content: messages[0].content?.substring(0, 50),
            } : null,
        });

        const hasMore = messages.length > limit;
        if (hasMore) messages.pop();

        // Convert to plain objects with string IDs for frontend
        const serializedMessages = messages.map(msg => {
            const serialized: any = {
                _id: String(msg._id),
                sessionId: String(msg.sessionId),
                senderId: String(msg.senderId),
                senderName: msg.senderName,
                senderType: msg.senderType,
                content: msg.content,
                messageType: msg.messageType || 'text',
                isAiGenerated: msg.isAiGenerated || false,
                createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : (msg.createdAt as any),
            };

            // Include optional fields if they exist
            if (msg.attachments) {
                serialized.attachments = msg.attachments;
            }
            if (msg.isRead !== undefined) {
                serialized.isRead = msg.isRead;
            }
            if (msg.readAt) {
                serialized.readAt = msg.readAt instanceof Date ? msg.readAt.toISOString() : msg.readAt;
            }
            if (msg.metadata) {
                serialized.metadata = msg.metadata;
            }

            return serialized;
        });

        loggingService.info('Retrieved messages for session', {
            sessionId,
            messageCount: serializedMessages.length,
            hasMore,
        });

        return {
            messages: serializedMessages as unknown as IChatMessage[],
            hasMore,
        };
    }

    async markMessagesAsRead(sessionId: string, userId: string): Promise<void> {
        await ChatMessage.updateMany(
            {
                sessionId: new Types.ObjectId(sessionId),
                senderId: { $ne: new Types.ObjectId(userId) },
                isRead: false,
            },
            {
                isRead: true,
                readAt: new Date(),
            }
        );
    }

    // ==================== SSE STREAMING ====================

    subscribeToSession(sessionId: string, callback: (data: SSEData) => void): () => void {
        if (!this.sseClients.has(sessionId)) {
            this.sseClients.set(sessionId, new Set());
        }
        
        const clients = this.sseClients.get(sessionId);
        if (clients) {
            clients.add(callback);
        }
        
        // Return unsubscribe function
        return () => {
            const clientSet = this.sseClients.get(sessionId);
            if (clientSet) {
                clientSet.delete(callback);
                if (clientSet.size === 0) {
                    this.sseClients.delete(sessionId);
                }
            }
        };
    }

    private broadcastToSession(sessionId: string, data: SSEData): void {
        const clients = this.sseClients.get(sessionId);
        if (clients) {
            loggingService.info('Broadcasting to SSE clients', {
                sessionId,
                clientCount: clients.size,
                eventType: data.type,
            });
            clients.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    loggingService.error('SSE broadcast callback error', { 
                        sessionId, 
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        } else {
            loggingService.warn('No SSE clients connected for session', { sessionId, eventType: data.type });
        }
    }

    // ==================== TYPING INDICATORS ====================

    sendTypingIndicator(sessionId: string, userName: string, isTyping: boolean): void {
        this.broadcastToSession(sessionId, {
            type: 'typing',
            userName,
            isTyping,
            timestamp: new Date().toISOString(),
        });
    }

    // ==================== ADMIN MANAGEMENT ====================

    async assignAdmin(sessionId: string, adminId: string, adminName: string): Promise<IChatSession | null> {
        try {
            const session = await ChatSession.findByIdAndUpdate(
                sessionId,
                {
                    assignedAdminId: new Types.ObjectId(adminId),
                    adminJoinedAt: new Date(),
                    status: 'active',
                },
                { new: true }
            );

            if (!session) {
                return null;
            }

            // Track admin presence
            if (!this.adminPresence.has(sessionId)) {
                this.adminPresence.set(sessionId, new Set());
            }
            this.adminPresence.get(sessionId)?.add(adminId);

            // Broadcast admin joined event
            this.broadcastToSession(sessionId, {
                type: 'admin_joined',
                adminId,
                adminName,
                timestamp: new Date().toISOString(),
            });

            // Send system message - use session userId for system messages
            try {
                await this.sendMessage({
                    sessionId,
                    senderId: String(session.userId),
                    senderName: 'System',
                    senderType: 'system',
                    content: `${adminName} has joined the chat.`,
                });
            } catch (error) {
                // Log but don't fail the assignment if message sending fails
                loggingService.error('Failed to send admin joined system message', {
                    sessionId,
                    adminId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            return session;
        } catch (error) {
            loggingService.error('Error in assignAdmin', {
                sessionId,
                adminId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw error;
        }
    }

    async removeAdmin(sessionId: string, adminId: string): Promise<void> {
        const presence = this.adminPresence.get(sessionId);
        if (presence) {
            presence.delete(adminId);
            if (presence.size === 0) {
                this.adminPresence.delete(sessionId);
                // Update session to remove admin assignment
                await ChatSession.findByIdAndUpdate(sessionId, {
                    $unset: { assignedAdminId: '', adminJoinedAt: '' },
                    status: 'waiting',
                });
            }
        }
    }

    isAdminActive(sessionId: string): boolean {
        const presence = this.adminPresence.get(sessionId);
        return presence ? presence.size > 0 : false;
    }

    async getAdminSessions(adminId: string): Promise<IChatSession[]> {
        return ChatSession.find({
            assignedAdminId: new Types.ObjectId(adminId),
            status: { $in: ['active', 'waiting'] },
        })
            .sort({ lastMessageAt: -1 })
            .limit(50);
    }

    async getWaitingSessions(): Promise<IChatSession[]> {
        return ChatSession.find({
            status: 'waiting',
            assignedAdminId: { $exists: false },
        })
            .sort({ createdAt: 1 })
            .limit(100);
    }

    // ==================== STATISTICS ====================

    async getChatStats(): Promise<{
        activeSessions: number;
        waitingSessions: number;
        avgResponseTime: number;
        avgRating: number;
    }> {
        const [activeSessions, waitingSessions, ratingStats] = await Promise.all([
            ChatSession.countDocuments({ status: 'active' }),
            ChatSession.countDocuments({ status: 'waiting' }),
            ChatSession.aggregate<{ _id: null; avgRating: number }>([
                { $match: { rating: { $exists: true } } },
                { $group: { _id: null, avgRating: { $avg: '$rating' } } },
            ]),
        ]);

        return {
            activeSessions,
            waitingSessions,
            avgResponseTime: 0, // Would need more complex calculation
            avgRating: ratingStats[0]?.avgRating ?? 0,
        };
    }
}

export const liveChatService = LiveChatService.getInstance();

