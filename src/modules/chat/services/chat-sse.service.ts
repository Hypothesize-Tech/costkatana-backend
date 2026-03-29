import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatEventsService } from './chat-events.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import { SendMessageDto } from '../dto/send-message.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChatTaskLink,
  ChatTaskLinkDocument,
} from '../../../schemas/chat/chat-task-link.schema';
import {
  GovernedTask,
  GovernedTaskDocument,
} from '../../../schemas/agent/governed-task.schema';

export interface SSEConnectionOptions {
  maxDuration?: number; // milliseconds
  pollInterval?: number; // milliseconds
  heartbeatInterval?: number; // milliseconds
}

export interface SSEChunkCallback {
  (chunk: string, done: boolean): Promise<void>;
}

@Injectable()
export class ChatSSEService {
  private readonly logger = new Logger(ChatSSEService.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatEventsService: ChatEventsService,
    private readonly bedrockService: BedrockService,
    @InjectModel(ChatTaskLink.name)
    private readonly chatTaskLinkModel: Model<ChatTaskLinkDocument>,
    @InjectModel(GovernedTask.name)
    private readonly governedTaskModel: Model<GovernedTaskDocument>,
  ) {}

  /**
   * Sets up SSE headers for the response
   */
  private setupSSEHeaders(response: Response): void {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  /**
   * Streams AI model response chunks via SSE using full sendMessage pipeline
   */
  async streamAIResponse(
    userId: string,
    dto: SendMessageDto,
    parsedMentions: any,
    request: any,
    response: Response,
  ): Promise<void> {
    let accumulatedContent = '';
    let hasStartedStreaming = false;

    try {
      this.setupSSEHeaders(response);

      // Send initial connection event
      response.write(
        `event: connected\ndata: ${JSON.stringify({
          type: 'connected',
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );

      let result: any;

      if (dto.stream && dto.stream === true) {
        // True token-level streaming: bypass complex routing and go direct to Bedrock
        this.logger.log('Using true token-level streaming for request', {
          userId,
        });

        // Import FallbackHandler
        const { FallbackHandler } =
          await import('../handlers/fallback.handler');

        // Create handler instance with Bedrock service
        const handler = new FallbackHandler(this.bedrockService);

        // Build minimal context for streaming
        const context = {
          recentMessages: [], // Could be enhanced to include conversation history
          conversationId: dto.conversationId,
          userId,
        };

        // Use streaming callback for real-time token delivery
        result = await handler.directBedrock(
          {
            userId,
            message: dto.message || '',
            modelId: dto.modelId,
            maxTokens: dto.maxTokens,
            temperature: dto.temperature,
            conversationId: dto.conversationId,
          },
          context,
          // Streaming callback - receives actual tokens from model
          async (chunk: string, done: boolean) => {
            if (!hasStartedStreaming) {
              hasStartedStreaming = true;
            }

            if (done) {
              // Send completion event
              response.write(
                `event: done\ndata: ${JSON.stringify({
                  timestamp: new Date().toISOString(),
                })}\n\n`,
              );
              response.end();
            } else {
              // Accumulate content for potential error recovery
              accumulatedContent += chunk;

              // Send actual token chunk from model
              response.write(
                `event: chunk\ndata: ${JSON.stringify({
                  content: chunk,
                  timestamp: new Date().toISOString(),
                  isTokenLevel: true,
                })}\n\n`,
              );
            }
          },
        );
      } else {
        // Legacy streaming: use full sendMessage pipeline with chunked callback
        // This ensures all routing logic (integrations, RAG, web search, multi-agent, etc.) is applied
        result = await this.chatService.sendMessage(
          userId,
          dto,
          parsedMentions,
          request,
          // Streaming callback - receives processed chunks
          async (chunk: string, done: boolean) => {
            if (!hasStartedStreaming) {
              hasStartedStreaming = true;
            }

            if (done) {
              // Send completion event
              response.write(
                `event: done\ndata: ${JSON.stringify({
                  timestamp: new Date().toISOString(),
                })}\n\n`,
              );
              response.end();
            } else {
              // Accumulate content for potential error recovery
              accumulatedContent += chunk;

              // Send processed chunk
              response.write(
                `event: chunk\ndata: ${JSON.stringify({
                  content: chunk,
                  timestamp: new Date().toISOString(),
                  isTokenLevel: false,
                })}\n\n`,
              );
            }
          },
        );
      }

      this.logger.log('Streaming completed successfully', {
        userId,
        conversationId: result.conversationId,
        messageId: result.id,
        totalContentLength: result.content.length,
      });
    } catch (error) {
      this.logger.error('Streaming error', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        hasStartedStreaming,
        accumulatedContentLength: accumulatedContent.length,
        parsedMentions,
        requestIp: request?.ip,
        requestUserAgent: request?.headers?.['user-agent'],
      });

      // Send error event - sendMessage already handles error cases and message persistence
      response.write(
        `event: error\ndata: ${JSON.stringify({
          error:
            error instanceof Error ? error.message : 'Unknown streaming error',
          timestamp: new Date().toISOString(),
          parsedMentions,
          requestIp: request?.ip,
          requestUserAgent: request?.headers?.['user-agent'],
        })}\n\n`,
      );

      response.end();
    }
  }

  /**
   * Streams chat updates (governed task progress) via SSE using event-driven architecture
   */
  async streamChatUpdates(
    chatId: string,
    userId: string,
    response: Response,
    options: SSEConnectionOptions = {},
  ): Promise<void> {
    const {
      maxDuration = 30 * 60 * 1000, // 30 minutes
      pollInterval = 2000, // 2 seconds (matches Express parity)
      heartbeatInterval = 30000, // 30 seconds
    } = options;

    this.setupSSEHeaders(response);

    // Send initial connection event
    response.write(
      `event: connected\ndata: ${JSON.stringify({
        type: 'connected',
        chatId,
        timestamp: new Date().toISOString(),
      })}\n\n`,
    );

    let heartbeatIntervalId: NodeJS.Timeout | null = null;
    let pollingIntervalId: NodeJS.Timeout | null = null;
    const startTime = Date.now();
    const lastSentStates = new Map<string, any>();
    let isConnected = true;

    // Event listener for chat events
    const eventListener = async (event: any) => {
      if (!isConnected || response.writableEnded || response.destroyed) {
        return;
      }

      try {
        // Check if this event relates to governed tasks for this chat
        if (event.type === 'status' && event.data?.taskId) {
          // This is a governed task update event
          const taskId = event.data.taskId;

          // Get the current task state
          const task = await this.governedTaskModel
            .findOne({
              id: taskId,
              userId,
            })
            .select(
              'id mode status classification scopeAnalysis plan executionProgress verification error updatedAt',
            );

          if (task) {
            const currentState = {
              taskId: task.id,
              mode: task.mode,
              status: task.status,
              classification: task.classification,
              scopeAnalysis: task.scopeAnalysis,
              plan: task.plan,
              executionProgress: task.executionProgress,
              verification: task.verification,
              error: task.error,
            };

            const lastSentState = lastSentStates.get(task.id);
            const hasChanged =
              !lastSentState ||
              JSON.stringify(currentState) !== JSON.stringify(lastSentState);

            if (hasChanged) {
              response.write(
                `event: governed_task_update\ndata: ${JSON.stringify({
                  ...currentState,
                  timestamp: new Date().toISOString(),
                })}\n\n`,
              );

              // Update cache
              lastSentStates.set(task.id, currentState);
            }
          }
        }
      } catch (error) {
        this.logger.error('Error processing chat event for SSE', {
          error: error instanceof Error ? error.message : String(error),
          chatId,
          userId,
          eventType: event.type,
        });
      }
    };

    const cleanup = () => {
      isConnected = false;
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
      if (pollingIntervalId) clearInterval(pollingIntervalId);
      // Remove event listener
      this.chatEventsService.off(`chat.${chatId}.*`, eventListener);
      this.chatEventsService.off('chat.*', eventListener);
    };

    // Send initial state for all tasks in this chat
    const sendInitialState = async () => {
      try {
        const taskLink = await this.chatTaskLinkModel.findOne({ chatId });
        if (taskLink && taskLink.taskIds.length > 0) {
          const tasks = await this.governedTaskModel
            .find({
              _id: { $in: taskLink.taskIds },
              userId,
            })
            .select(
              'id mode status classification scopeAnalysis plan executionProgress verification error updatedAt',
            );

          for (const task of tasks) {
            const currentState = {
              taskId: task.id,
              mode: task.mode,
              status: task.status,
              classification: task.classification,
              scopeAnalysis: task.scopeAnalysis,
              plan: task.plan,
              executionProgress: task.executionProgress,
              verification: task.verification,
              error: task.error,
            };

            response.write(
              `event: governed_task_update\ndata: ${JSON.stringify({
                ...currentState,
                timestamp: new Date().toISOString(),
                isInitial: true,
              })}\n\n`,
            );

            lastSentStates.set(task.id, currentState);
          }
        }
      } catch (error) {
        this.logger.error('Error sending initial chat SSE state', {
          error: error instanceof Error ? error.message : String(error),
          chatId,
          userId,
        });
      }
    };

    // Send initial state
    await sendInitialState();

    // Set up event listeners for real-time updates
    this.chatEventsService.on(`chat.${chatId}.*`, eventListener);
    this.chatEventsService.on('chat.*', eventListener);

    // Set up heartbeat
    heartbeatIntervalId = setInterval(() => {
      if (!isConnected || response.writableEnded || response.destroyed) {
        return;
      }

      // Check max duration
      if (Date.now() - startTime > maxDuration) {
        response.write(
          `event: timeout\ndata: ${JSON.stringify({
            type: 'timeout',
            message: 'Stream timeout after 30 minutes',
          })}\n\n`,
        );
        response.end();
        cleanup();
        return;
      }

      response.write(
        `event: heartbeat\ndata: ${JSON.stringify({
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );
    }, heartbeatInterval);

    // Set up DB polling fallback for governed tasks (Express parity)
    pollingIntervalId = setInterval(async () => {
      if (!isConnected || response.writableEnded || response.destroyed) {
        return;
      }

      try {
        await sendInitialState(); // Re-run initial state to catch DB changes
      } catch (error) {
        this.logger.error('Error in SSE polling fallback', {
          error: error instanceof Error ? error.message : String(error),
          chatId,
          userId,
        });
      }
    }, pollInterval); // Poll every 2 seconds (matching Express)

    // Handle client disconnect
    response.on('close', () => {
      this.logger.log('SSE client disconnected for chat', {
        chatId,
        userId,
      });
      cleanup();
    });
  }
}
