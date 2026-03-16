import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  Response,
  HttpStatus,
  HttpException,
  Logger,
  Sse,
  MessageEvent,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  Response as ExpressResponse,
  Request as ExpressRequest,
} from 'express';
import { Types } from 'mongoose';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { LiveChatService } from '../services/live-chat.service';
import { AdminNotificationService } from '../services/admin-notification.service';
import { AiChatAssistantService } from '../services/ai-chat-assistant.service';
import { UserService } from '../../user/user.service';

interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: string;
    _id?: string;
    name?: string;
    email: string;
    role?: string;
    avatar?: string;
  };
}

interface ChatUserInfo {
  userId: string;
  userName: string;
  email: string;
  userAvatar?: string;
  role?: string;
  isAdmin: boolean;
}

@Controller('api/community/chat')
export class LiveChatController implements OnModuleDestroy {
  private readonly logger = new Logger(LiveChatController.name);
  private sseSubjects = new Map<string, Subject<MessageEvent>>();

  constructor(
    private readonly liveChatService: LiveChatService,
    private readonly adminNotificationService: AdminNotificationService,
    private readonly aiChatAssistantService: AiChatAssistantService,
    private readonly userService: UserService,
  ) {}

  onModuleDestroy() {
    // Clean up SSE subjects
    this.sseSubjects.forEach((subject) => subject.complete());
    this.sseSubjects.clear();
  }

  // ==================== USER CHAT ROUTES ====================

  @Post('start')
  @UseGuards(JwtAuthGuard)
  async startSession(
    @Body()
    body: {
      subject: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      metadata?: Record<string, unknown>;
    },
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      if (!body.subject) {
        throw new HttpException('Subject is required', HttpStatus.BAD_REQUEST);
      }

      const userInfo = await this.getUserInfo(req);
      if (!userInfo.email) {
        throw new HttpException(
          'User email is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const session = await this.liveChatService.startSession({
        subject: body.subject,
        priority: body.priority,
        metadata: body.metadata,
        user: {
          userId: userInfo.userId,
          userName: userInfo.userName,
          email: userInfo.email,
        },
      });

      // Notify admins of new session
      await this.adminNotificationService.notifyAllAdmins({
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

      return { success: true, data: session };
    } catch (error) {
      this.logger.error('Error starting chat session', { error });
      throw new HttpException(
        'Failed to start chat session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async getUserSessions(@Request() req: AuthenticatedRequest) {
    try {
      const userInfo = await this.getUserInfo(req);
      const sessions = await this.liveChatService.getUserSessions(
        userInfo.userId,
      );
      return { success: true, data: sessions };
    } catch (error) {
      this.logger.error('Error getting chat sessions', { error });
      throw new HttpException(
        'Failed to get sessions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Sse('messages/:sessionId')
  @UseGuards(JwtAuthGuard)
  async streamMessages(
    @Param('sessionId') sessionId: string,
    @Query('stream') stream: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    if (stream !== 'true') {
      // Return regular JSON response for non-streaming requests
      return new Observable((subscriber) => {
        this.getMessages(
          sessionId,
          req.query as { page?: string; limit?: string },
          req,
        )
          .then((result) => {
            subscriber.next({ data: JSON.stringify(result) } as MessageEvent);
            subscriber.complete();
          })
          .catch((error) => {
            subscriber.error(error);
          });
      });
    }

    // SSE streaming
    const subject = new Subject<MessageEvent>();
    this.sseSubjects.set(sessionId, subject);

    // Send initial messages
    try {
      const { messages } = await this.liveChatService.getMessages(sessionId);
      this.logger.log('Sending initial messages via SSE', {
        sessionId,
        messageCount: messages.length,
      });
      subject.next({
        data: JSON.stringify({ type: 'initial', messages }),
      } as MessageEvent);
    } catch (error) {
      this.logger.error('Error sending initial messages', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      subject.next({
        data: JSON.stringify({
          type: 'error',
          message: 'Failed to load messages',
        }),
      } as MessageEvent);
    }

    // Subscribe to new messages
    const unsubscribe = this.liveChatService.subscribeToSession(
      sessionId,
      (data) => {
        try {
          subject.next({ data: JSON.stringify(data) } as MessageEvent);
          this.logger.debug('SSE message sent', { sessionId, type: data.type });
        } catch (error) {
          this.logger.error('Error writing SSE data', { sessionId, error });
          subject.complete();
        }
      },
    );

    // Send keepalive every 15 seconds
    const keepAliveInterval = setInterval(() => {
      try {
        subject.next({ data: ': keepalive\n\n' } as MessageEvent);
      } catch (error) {
        clearInterval(keepAliveInterval);
        subject.complete();
      }
    }, 15000);

    // Cleanup on unsubscribe
    subject.subscribe({
      complete: () => {
        clearInterval(keepAliveInterval);
        unsubscribe();
        this.sseSubjects.delete(sessionId);
      },
      error: () => {
        clearInterval(keepAliveInterval);
        unsubscribe();
        this.sseSubjects.delete(sessionId);
      },
    });

    return subject.asObservable();
  }

  @Get('messages/:sessionId')
  @UseGuards(JwtAuthGuard)
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Query() query: { page?: string; limit?: string },
    @Request() req?: AuthenticatedRequest,
  ) {
    try {
      const result = await this.liveChatService.getMessages(sessionId, {
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('Error getting chat messages', { error });
      throw new HttpException(
        'Failed to get messages',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('messages')
  @UseGuards(JwtAuthGuard)
  async sendMessage(
    @Body()
    body: {
      sessionId: string;
      content: string;
      messageType?: string;
      senderType?: string;
    },
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      if (!body.sessionId || !body.content) {
        throw new HttpException(
          'Missing required fields',
          HttpStatus.BAD_REQUEST,
        );
      }

      const userInfo = await this.getUserInfo(req);
      const isAdmin = userInfo.isAdmin || userInfo.role === 'admin';
      const finalSenderType = body.senderType || (isAdmin ? 'support' : 'user');

      // Extract IP address and user agent for security logging
      const ipAddress = this.extractIpAddress(req);
      const userAgent =
        req.get('user-agent') || req.headers['user-agent'] || 'unknown';

      const message = await this.liveChatService.sendMessage({
        sessionId: body.sessionId,
        senderId: userInfo.userId,
        senderName: userInfo.userName,
        senderType: finalSenderType as 'user' | 'support' | 'system' | 'ai',
        content: body.content,
        messageType:
          (body.messageType as 'text' | 'code' | 'link' | 'image' | 'file') ??
          'text',
        ipAddress,
        userAgent,
      });

      // Handle AI responses for user messages
      if (finalSenderType === 'user') {
        const session = await this.liveChatService.getSession(body.sessionId);
        if (
          session &&
          session.aiEnabled &&
          !this.liveChatService.isAdminActive(body.sessionId)
        ) {
          this.logger.log('Processing user message for AI response', {
            sessionId: body.sessionId,
            aiEnabled: session.aiEnabled,
            adminActive: this.liveChatService.isAdminActive(body.sessionId),
            lastAiResponseAt: session.lastAiResponseAt,
          });

          if (
            this.aiChatAssistantService.shouldRespond(session.lastAiResponseAt)
          ) {
            this.logger.log('Triggering AI response', {
              sessionId: body.sessionId,
            });
            // Trigger AI response asynchronously
            setImmediate(async () => {
              try {
                const currentSession = await this.liveChatService.getSession(
                  body.sessionId,
                );
                if (
                  !currentSession ||
                  !currentSession.aiEnabled ||
                  this.liveChatService.isAdminActive(body.sessionId)
                ) {
                  this.logger.log('Skipping AI response - conditions changed', {
                    sessionId: body.sessionId,
                    aiEnabled: currentSession?.aiEnabled,
                    adminActive: this.liveChatService.isAdminActive(
                      body.sessionId,
                    ),
                  });
                  return;
                }

                const { messages } = await this.liveChatService.getMessages(
                  body.sessionId,
                );

                const chatHistory = messages
                  .filter((msg) => msg.senderType !== 'system')
                  .map((msg) => ({
                    senderType: msg.senderType,
                    senderName: msg.senderName,
                    content: msg.content,
                    createdAt: new Date(msg.createdAt),
                  }));

                if (chatHistory.length === 0) {
                  this.logger.warn('No chat history for AI response', {
                    sessionId: body.sessionId,
                  });
                  return;
                }

                this.logger.log('Generating AI response', {
                  sessionId: body.sessionId,
                  messageCount: chatHistory.length,
                  lastMessage: chatHistory[
                    chatHistory.length - 1
                  ]?.content?.substring(0, 50),
                });

                const aiResponse =
                  await this.aiChatAssistantService.generateResponse(
                    chatHistory,
                    session.subject,
                    session.userName,
                  );

                if (!aiResponse || aiResponse.trim().length === 0) {
                  this.logger.warn('Empty AI response received', {
                    sessionId: body.sessionId,
                  });
                  return;
                }

                if (!this.liveChatService.isAdminActive(body.sessionId)) {
                  this.logger.log('Sending AI response', {
                    sessionId: body.sessionId,
                    responseLength: aiResponse.length,
                    responsePreview: aiResponse.substring(0, 100),
                  });

                  await this.liveChatService.sendMessage({
                    sessionId: body.sessionId,
                    senderId: String(session.userId),
                    senderName: 'AI Assistant',
                    senderType: 'ai',
                    content: aiResponse.trim(),
                    isAiGenerated: true,
                  });
                } else {
                  this.logger.log(
                    'Admin joined during AI generation, skipping AI response',
                    { sessionId: body.sessionId },
                  );
                }
              } catch (error) {
                this.logger.error('Error generating AI response', {
                  sessionId: body.sessionId,
                  error: error instanceof Error ? error.message : String(error),
                });

                // Send fallback message
                try {
                  if (!this.liveChatService.isAdminActive(body.sessionId)) {
                    await this.liveChatService.sendMessage({
                      sessionId: body.sessionId,
                      senderId: String(session.userId),
                      senderName: 'AI Assistant',
                      senderType: 'ai',
                      content:
                        "I apologize, but I'm having trouble processing your request right now. Please try rephrasing your question, or our support team will be with you shortly.",
                      isAiGenerated: true,
                    });
                  }
                } catch (fallbackError) {
                  this.logger.error('Error sending fallback AI message', {
                    sessionId: body.sessionId,
                    error:
                      fallbackError instanceof Error
                        ? fallbackError.message
                        : String(fallbackError),
                  });
                }
              }
            });
          } else {
            this.logger.log('AI response rate limited', {
              sessionId: body.sessionId,
              lastAiResponseAt: session.lastAiResponseAt,
            });
          }
        }

        // Notify admins of new message
        await this.adminNotificationService.notifyAllAdmins({
          type: 'new_message',
          sessionId: body.sessionId,
          session: {
            _id: session?._id,
            subject: session?.subject,
            userName: session?.userName,
          },
          messageData: {
            content: body.content,
            senderName: userInfo.userName,
          },
          timestamp: new Date().toISOString(),
        });
      }

      return { success: true, data: message };
    } catch (error: any) {
      if (error.isSecurityBlock) {
        this.logger.warn('Live chat message blocked by security', {
          sessionId: body.sessionId,
          userId: req.user.id,
          threatCategory: error.threatCategory,
          confidence: error.confidence,
        });

        throw new HttpException(
          {
            success: false,
            error: 'SECURITY_BLOCK',
            message: error.message || 'Message blocked by security system',
            threatCategory: error.threatCategory,
            confidence: error.confidence,
          },
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.error('Error sending message', { error });
      throw new HttpException(
        'Failed to send message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':sessionId/typing')
  @UseGuards(JwtAuthGuard)
  async sendTypingIndicator(
    @Param('sessionId') sessionId: string,
    @Body() body: { isTyping: boolean },
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      const userInfo = await this.getUserInfo(req);
      await this.liveChatService.sendTypingIndicator(
        sessionId,
        userInfo.userName,
        body.isTyping,
      );
      return { success: true };
    } catch (error) {
      this.logger.error('Error sending typing indicator', { error });
      throw new HttpException(
        'Failed to send typing indicator',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':sessionId/rate')
  @UseGuards(JwtAuthGuard)
  async rateSession(
    @Param('sessionId') sessionId: string,
    @Body() body: { rating: number; feedback?: string },
  ) {
    try {
      if (!body.rating || body.rating < 1 || body.rating > 5) {
        throw new HttpException('Invalid rating (1-5)', HttpStatus.BAD_REQUEST);
      }

      const session = await this.liveChatService.rateSession(
        sessionId,
        body.rating,
        body.feedback,
      );
      return { success: true, data: session };
    } catch (error) {
      this.logger.error('Error rating session', { error });
      throw new HttpException(
        'Failed to rate session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== ADMIN CHAT ROUTES ====================

  @Get('admin/sessions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminSessions(
    @Query('status') status: string,
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      const userInfo = await this.getUserInfo(req);

      let sessions;
      if (status === 'waiting') {
        sessions = await this.liveChatService.getWaitingSessions();
      } else if (status === 'assigned') {
        sessions = await this.liveChatService.getAdminSessions(userInfo.userId);
      } else {
        const [waiting, assigned] = await Promise.all([
          this.liveChatService.getWaitingSessions(),
          this.liveChatService.getAdminSessions(userInfo.userId),
        ]);
        sessions = [...waiting, ...assigned];
      }

      return { success: true, data: sessions };
    } catch (error) {
      this.logger.error('Error getting admin sessions', { error });
      throw new HttpException(
        'Failed to get sessions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('admin/sessions/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAdminSession(@Param('sessionId') sessionId: string) {
    try {
      const session = await this.liveChatService.getSession(sessionId);

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      return { success: true, data: session };
    } catch (error) {
      this.logger.error('Error getting session', { error });
      throw new HttpException(
        'Failed to get session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('admin/sessions/:sessionId/join')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async joinSession(
    @Param('sessionId') sessionId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
        throw new HttpException('Invalid session ID', HttpStatus.BAD_REQUEST);
      }

      const userInfo = await this.getUserInfo(req);
      if (!userInfo.userId || !Types.ObjectId.isValid(userInfo.userId)) {
        this.logger.error('Invalid user ID format', {
          userId: userInfo.userId,
        });
        throw new HttpException('Invalid user ID', HttpStatus.BAD_REQUEST);
      }

      const session = await this.liveChatService.assignAdmin(
        sessionId,
        userInfo.userId,
        userInfo.userName,
      );

      if (!session) {
        throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
      }

      // Notify other admins
      try {
        await this.adminNotificationService.notifyAllAdmins({
          type: 'session_assigned',
          sessionId,
          adminId: userInfo.userId,
          adminName: userInfo.userName,
          session: {
            _id: session._id,
            subject: session.subject,
            userName: session.userName,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (notifError) {
        this.logger.error('Failed to notify admins', { error: notifError });
      }

      return { success: true, data: session };
    } catch (error) {
      this.logger.error('Error joining session', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      throw new HttpException(
        'Failed to join session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('admin/sessions/:sessionId/leave')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async leaveSession(
    @Param('sessionId') sessionId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      const userInfo = await this.getUserInfo(req);
      await this.liveChatService.removeAdmin(sessionId, userInfo.userId);

      // Send system message
      await this.liveChatService.sendMessage({
        sessionId,
        senderId: userInfo.userId,
        senderName: 'System',
        senderType: 'system',
        content: `${userInfo.userName} has left the chat.`,
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error leaving session', { error });
      throw new HttpException(
        'Failed to leave session',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Sse('admin/notifications')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async streamAdminNotifications(
    @Request() req: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const userInfo = await this.getUserInfo(req);

    // Subscribe to notifications
    const unsubscribe = this.adminNotificationService.subscribe(
      userInfo.userId,
      (data) => {
        subject.next({ data: JSON.stringify(data) } as MessageEvent);
      },
    );

    // Send initial connection message
    subject.next({
      data: JSON.stringify({
        type: 'connected',
        message: 'Notification stream established',
      }),
    } as MessageEvent);

    // Cleanup on unsubscribe
    subject.subscribe({
      complete: () => unsubscribe(),
      error: () => unsubscribe(),
    });

    return subject.asObservable();
  }

  // ==================== HELPER METHODS ====================

  private async getUserInfo(req: AuthenticatedRequest): Promise<ChatUserInfo> {
    if (!req.user) {
      throw new Error('User not authenticated');
    }

    const userId = req.user.id || (req.user._id ? String(req.user._id) : null);
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    // Try to get user details from database if available
    let userName = req.user.name;
    let userAvatar = req.user.avatar;
    let userEmail = req.user.email;

    // If profile fields are missing from JWT payload, load from UserService.
    if (!userName || !userAvatar || !userEmail) {
      try {
        const userProfile = await this.userService.getProfile(userId);
        userName =
          userName ||
          userProfile.name ||
          userProfile.email?.split('@')[0] ||
          'Anonymous';
        userAvatar = userAvatar || userProfile.avatar;
        userEmail = userEmail || userProfile.email;
      } catch (error) {
        this.logger.warn('Failed to fetch user details from UserService', {
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
      }
    }

    if (!userEmail) {
      throw new Error('User email not found for authenticated user');
    }

    return {
      userId: String(userId),
      userName: userName || userEmail.split('@')[0] || 'Anonymous',
      userAvatar,
      email: userEmail,
      role: req.user.role || 'user',
      isAdmin: req.user.role === 'admin',
    };
  }

  private extractIpAddress(req: AuthenticatedRequest): string {
    return (
      req.ip ||
      (req.get('x-forwarded-for') ?? req.headers['x-forwarded-for']?.toString())
        ?.split(',')[0]
        ?.trim() ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }
}
