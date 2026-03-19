import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatSession,
  ChatSessionDocument,
} from '../../../schemas/community/chat-session.schema';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../schemas/chat-message.schema';
import { CacheService } from '../../../common/cache/cache.service';
import { LlmSecurityService } from '../../security/llm-security.service';

export interface ChatUserInfo {
  userId: string;
  userName: string;
  email: string;
}

export interface SerializedChatMessage {
  _id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  senderType: 'user' | 'support' | 'system' | 'ai';
  content: string;
  messageType: 'text' | 'code' | 'link' | 'image' | 'file';
  isAiGenerated: boolean;
  createdAt: string;
  attachments?: {
    name: string;
    url: string;
    type: string;
    size: number;
  }[];
  isRead?: boolean;
  readAt?: string;
  metadata?: Record<string, unknown>;
}

interface SSEData {
  type: string;
  [key: string]: unknown;
}

@Injectable()
export class LiveChatService {
  private readonly logger = new Logger(LiveChatService.name);
  private sseClients: Map<string, Set<(data: SSEData) => void>> = new Map();
  private adminPresence: Map<string, Set<string>> = new Map();

  constructor(
    @InjectModel(ChatSession.name)
    private chatSessionModel: Model<ChatSessionDocument>,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessageDocument>,
    private cacheService: CacheService,
    private llmSecurityService: LlmSecurityService,
  ) {}

  // ==================== SESSION MANAGEMENT ====================

  async startSession(data: {
    subject: string;
    user: ChatUserInfo;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    metadata?: Record<string, unknown>;
  }): Promise<ChatSessionDocument> {
    // Check for existing active session
    const existingSession = await this.chatSessionModel.findOne({
      userId: new Types.ObjectId(data.user.userId),
      status: { $in: ['active', 'waiting'] },
    });

    if (existingSession) {
      return existingSession;
    }

    const session = await this.chatSessionModel.create({
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
      this.logger.error('Failed to send initial messages', {
        sessionId,
        error,
      });
      // Continue even if message sending fails
    }

    this.logger.log('Chat session started', {
      sessionId,
      userId: data.user.userId,
    });
    return session;
  }

  async getSession(sessionId: string): Promise<ChatSessionDocument | null> {
    return this.chatSessionModel.findById(sessionId);
  }

  async getUserSessions(userId: string): Promise<ChatSessionDocument[]> {
    return this.chatSessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20);
  }

  async updateSessionStatus(
    sessionId: string,
    status: 'active' | 'waiting' | 'resolved' | 'closed',
  ): Promise<ChatSessionDocument | null> {
    const updateData: Record<string, unknown> = { status };

    if (status === 'resolved') {
      updateData.resolvedAt = new Date();
    } else if (status === 'closed') {
      updateData.closedAt = new Date();
    }

    const session = await this.chatSessionModel.findByIdAndUpdate(
      sessionId,
      updateData,
      { new: true },
    );

    if (session) {
      this.broadcastToSession(sessionId, {
        type: 'status_update',
        status,
        timestamp: new Date().toISOString(),
      });
    }

    return session;
  }

  async rateSession(
    sessionId: string,
    rating: number,
    feedback?: string,
  ): Promise<ChatSessionDocument | null> {
    return this.chatSessionModel.findByIdAndUpdate(
      sessionId,
      { rating, feedback },
      { new: true },
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
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ChatMessageDocument> {
    // SECURITY CHECK: Only check user messages (not admin/support/system messages)
    if (data.senderType === 'user' && data.content) {
      try {
        const requestId = `livechat_${Date.now()}_${crypto.randomUUID()}`;
        const securityCheck =
          await this.llmSecurityService.performSecurityCheck(
            data.content,
            requestId,
            data.senderId,
            {
              estimatedCost: 0.01,
              provenanceSource: 'live-chat',
              ipAddress: data.ipAddress,
              userAgent: data.userAgent,
              source: 'live-chat',
            },
          );

        if (securityCheck.result.isBlocked) {
          const error = new Error(
            securityCheck.result.reason || 'Message blocked by security system',
          ) as Error & {
            isSecurityBlock: boolean;
            threatCategory?: string;
            confidence?: number;
          };
          error.isSecurityBlock = true;
          error.threatCategory = securityCheck.result.threatCategory;
          error.confidence = securityCheck.result.confidence;
          throw error;
        }
      } catch (error: unknown) {
        if (
          error &&
          typeof error === 'object' &&
          'isSecurityBlock' in error &&
          (error as { isSecurityBlock: boolean }).isSecurityBlock
        ) {
          throw error;
        }
        // Log but allow if security check fails
        this.logger.error('Live chat security check failed, allowing message', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: data.sessionId,
          senderId: data.senderId,
        });
      }
    }

    const message = await this.chatMessageModel.create({
      sessionId: new Types.ObjectId(data.sessionId),
      senderId: new Types.ObjectId(data.senderId),
      senderName: data.senderName,
      senderType: data.senderType,
      content: data.content,
      messageType: data.messageType ?? 'text',
      attachments: data.attachments,
      isAiGenerated: data.isAiGenerated ?? data.senderType === 'ai',
    });

    // Update session
    const updateData: Record<string, unknown> = {
      $inc: { messageCount: 1 },
      lastMessageAt: new Date(),
    };

    if (data.senderType === 'ai') {
      updateData.lastAiResponseAt = new Date();
    }

    await this.chatSessionModel.findByIdAndUpdate(data.sessionId, updateData);

    // Broadcast to SSE clients - serialize message for frontend
    const serializedMessage: SerializedChatMessage = {
      _id: String(message._id),
      sessionId: String(message.sessionId),
      senderId: String(message.senderId),
      senderName: message.senderName,
      senderType: message.senderType,
      content: message.content,
      messageType: message.messageType || 'text',
      isAiGenerated: message.isAiGenerated || false,
      createdAt:
        message.createdAt instanceof Date
          ? message.createdAt.toISOString()
          : String(message.createdAt),
    };

    // Include optional fields if they exist
    if (message.attachments) {
      serializedMessage.attachments = message.attachments;
    }
    if (message.isRead !== undefined) {
      serializedMessage.isRead = message.isRead;
    }

    this.logger.log('Broadcasting new message to SSE clients', {
      sessionId: data.sessionId,
      messageId: serializedMessage._id,
      senderType: serializedMessage.senderType,
    });

    this.broadcastToSession(data.sessionId, {
      type: 'new_message',
      message: serializedMessage,
    });

    // Cache for quick retrieval
    await this.cacheService.set(
      `chat:latest:${data.sessionId}`,
      JSON.stringify(message),
      60,
    );

    return message;
  }

  async getMessages(
    sessionId: string,
    options?: {
      page?: number;
      limit?: number;
      before?: Date;
    },
  ): Promise<{ messages: SerializedChatMessage[]; hasMore: boolean }> {
    const limit = options?.limit ?? 50;
    const sessionObjectId = new Types.ObjectId(sessionId);
    const query: Record<string, unknown> = { sessionId: sessionObjectId };

    if (options?.before) {
      query.createdAt = { $lt: options.before };
    }

    this.logger.log('Querying messages from database', {
      sessionId,
      sessionObjectId: sessionObjectId.toString(),
      query,
      collection: this.chatMessageModel.collection.name,
    });

    const messages = await this.chatMessageModel
      .find(query)
      .sort({ createdAt: 1 }) // Sort ascending for chronological order
      .limit(limit + 1)
      .lean();

    this.logger.log('Database query result', {
      sessionId,
      foundCount: messages.length,
      sampleMessage:
        messages.length > 0
          ? {
              _id: String(messages[0]._id),
              sessionId: String(messages[0].sessionId),
              content: messages[0].content?.substring(0, 50),
            }
          : null,
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    // Convert to plain objects with string IDs for frontend
    const serializedMessages = messages.map((msg): SerializedChatMessage => {
      const serialized: SerializedChatMessage = {
        _id: String(msg._id),
        sessionId: String(msg.sessionId),
        senderId: String(msg.senderId),
        senderName: msg.senderName,
        senderType: msg.senderType,
        content: msg.content,
        messageType: msg.messageType || 'text',
        isAiGenerated: msg.isAiGenerated || false,
        createdAt:
          msg.createdAt instanceof Date
            ? msg.createdAt.toISOString()
            : String(msg.createdAt),
      };

      // Include optional fields if they exist
      if (msg.attachments) {
        serialized.attachments = msg.attachments;
      }
      if (msg.isRead !== undefined) {
        serialized.isRead = msg.isRead;
      }
      if (msg.readAt) {
        serialized.readAt =
          msg.readAt instanceof Date ? msg.readAt.toISOString() : msg.readAt;
      }
      if (msg.metadata) {
        serialized.metadata = msg.metadata;
      }

      return serialized;
    });

    this.logger.log('Retrieved messages for session', {
      sessionId,
      messageCount: serializedMessages.length,
      hasMore,
    });

    return {
      messages: serializedMessages,
      hasMore,
    };
  }

  async markMessagesAsRead(sessionId: string, userId: string): Promise<void> {
    await this.chatMessageModel.updateMany(
      {
        sessionId: new Types.ObjectId(sessionId),
        senderId: { $ne: new Types.ObjectId(userId) },
        isRead: false,
      },
      {
        isRead: true,
        readAt: new Date(),
      },
    );
  }

  // ==================== SSE STREAMING ====================

  subscribeToSession(
    sessionId: string,
    callback: (data: SSEData) => void,
  ): () => void {
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
      this.logger.log('Broadcasting to SSE clients', {
        sessionId,
        clientCount: clients.size,
        eventType: data.type,
      });
      clients.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          this.logger.error('SSE broadcast callback error', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    } else {
      this.logger.warn('No SSE clients connected for session', {
        sessionId,
        eventType: data.type,
      });
    }
  }

  // ==================== TYPING INDICATORS ====================

  sendTypingIndicator(
    sessionId: string,
    userName: string,
    isTyping: boolean,
  ): void {
    this.broadcastToSession(sessionId, {
      type: 'typing',
      userName,
      isTyping,
      timestamp: new Date().toISOString(),
    });
  }

  // ==================== ADMIN MANAGEMENT ====================

  async assignAdmin(
    sessionId: string,
    adminId: string,
    adminName: string,
  ): Promise<ChatSessionDocument | null> {
    try {
      const session = await this.chatSessionModel.findByIdAndUpdate(
        sessionId,
        {
          assignedAdminId: new Types.ObjectId(adminId),
          adminJoinedAt: new Date(),
          status: 'active',
        },
        { new: true },
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
        this.logger.error('Failed to send admin joined system message', {
          sessionId,
          adminId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return session;
    } catch (error) {
      this.logger.error('Error in assignAdmin', {
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
        await this.chatSessionModel.findByIdAndUpdate(sessionId, {
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

  async getAdminSessions(adminId: string): Promise<ChatSessionDocument[]> {
    return this.chatSessionModel
      .find({
        assignedAdminId: new Types.ObjectId(adminId),
        status: { $in: ['active', 'waiting'] },
      })
      .sort({ lastMessageAt: -1 })
      .limit(50);
  }

  async getWaitingSessions(): Promise<ChatSessionDocument[]> {
    return this.chatSessionModel
      .find({
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
    const [activeSessions, waitingSessions, ratingStats, responseTimeStats] =
      await Promise.all([
        this.chatSessionModel.countDocuments({ status: 'active' }),
        this.chatSessionModel.countDocuments({ status: 'waiting' }),
        this.chatSessionModel.aggregate<{ _id: null; avgRating: number }>([
          { $match: { rating: { $exists: true } } },
          { $group: { _id: null, avgRating: { $avg: '$rating' } } },
        ]),
        this.chatMessageModel.aggregate<{ _id: null; avgResponseTime: number }>(
          [
            // Match only user and support/ai messages
            {
              $match: {
                senderType: { $in: ['user', 'support', 'ai'] },
              },
            },
            // Sort by session and creation time
            {
              $sort: { sessionId: 1, createdAt: 1 },
            },
            // Group by session and collect messages in order
            {
              $group: {
                _id: '$sessionId',
                messages: {
                  $push: {
                    senderType: '$senderType',
                    createdAt: '$createdAt',
                  },
                },
              },
            },
            // Find first user message and first support/ai response for each session
            {
              $project: {
                firstUserMessage: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$messages',
                        as: 'msg',
                        cond: { $eq: ['$$msg.senderType', 'user'] },
                      },
                    },
                    0,
                  ],
                },
                firstSupportMessage: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$messages',
                        as: 'msg',
                        cond: { $in: ['$$msg.senderType', ['support', 'ai']] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
            // Filter out sessions that don't have both user and support messages
            {
              $match: {
                firstUserMessage: { $exists: true },
                firstSupportMessage: { $exists: true },
              },
            },
            // Calculate response time in milliseconds
            {
              $project: {
                responseTimeMs: {
                  $subtract: [
                    '$firstSupportMessage.createdAt',
                    '$firstUserMessage.createdAt',
                  ],
                },
              },
            },
            // Only include positive response times (support replied after user)
            {
              $match: {
                responseTimeMs: { $gt: 0 },
              },
            },
            // Calculate average response time across all sessions
            {
              $group: {
                _id: null,
                avgResponseTime: { $avg: '$responseTimeMs' },
              },
            },
          ],
        ),
      ]);

    return {
      activeSessions,
      waitingSessions,
      avgResponseTime: responseTimeStats[0]?.avgResponseTime ?? 0,
      avgRating: ratingStats[0]?.avgRating ?? 0,
    };
  }
}
