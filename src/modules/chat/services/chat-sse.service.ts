import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatEventsService } from './chat-events.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import { ContextOptimizer } from '../utils/context-optimizer';
import { SendMessageDto } from '../dto/send-message.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../schemas/chat/chat-message.schema';
import {
  ChatTaskLink,
  ChatTaskLinkDocument,
} from '../../../schemas/chat/chat-task-link.schema';
import {
  GovernedTask,
  GovernedTaskDocument,
} from '../../../schemas/agent/governed-task.schema';
import { getThinkingCapability } from '../../bedrock/thinking-capability';
import { ToolRegistryService } from '../tools/tool-registry.service';
import type { IMessageCitation } from '../../../schemas/chat/chat-message.schema';

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
    private readonly contextOptimizer: ContextOptimizer,
    private readonly toolRegistry: ToolRegistryService,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(ChatTaskLink.name)
    private readonly chatTaskLinkModel: Model<ChatTaskLinkDocument>,
    @InjectModel(GovernedTask.name)
    private readonly governedTaskModel: Model<GovernedTaskDocument>,
  ) {}

  /**
   * Writes a single citation event onto an open SSE response. Callers that
   * drive Claude streaming (handlers sitting between Bedrock and this service)
   * invoke this as each citation is finalized so the frontend can paint
   * inline markers alongside incoming text without waiting for the final
   * `done` frame.
   */
  public static emitCitation(
    response: Response,
    citation: IMessageCitation,
  ): void {
    if (response.writableEnded) return;
    response.write(
      `event: citation\ndata: ${JSON.stringify({
        ...citation,
        timestamp: new Date().toISOString(),
      })}\n\n`,
    );
  }

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
    let accumulatedReasoning = '';
    const accumulatedToolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
      output?: {
        content: string;
        sources?: Array<{ title: string; url: string; description?: string }>;
      };
      status?: 'success' | 'error';
      startedAt?: Date;
      finishedAt?: Date;
      durationMs?: number;
    }> = [];
    const accumulatedSources = new Map<
      string,
      { title: string; url: string; description?: string }
    >();
    const accumulatedCitations: IMessageCitation[] = [];
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
        const handler = new FallbackHandler(
          this.bedrockService,
          this.toolRegistry,
        );

        let recentMessages: Array<{ role: string; content: string }> = [];
        if (dto.conversationId) {
          try {
            const raw = await this.contextOptimizer.fetchOptimalContext(
              dto.conversationId,
              (dto.message || '').length,
            );
            recentMessages = raw.map(
              (m: { role?: string; content?: string }) => ({
                role:
                  m.role === 'assistant'
                    ? 'assistant'
                    : m.role === 'user'
                      ? 'user'
                      : 'user',
                content: typeof m.content === 'string' ? m.content : '',
              }),
            );
          } catch (ctxErr) {
            this.logger.warn(
              'Could not load conversation history for token streaming',
              {
                conversationId: dto.conversationId,
                error:
                  ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
              },
            );
          }
        }

        const context = {
          recentMessages,
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
            system: dto.system,
            useSystemPrompt: dto.useSystemPrompt,
            conversationId: dto.conversationId,
            thinking: dto.thinking,
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
          // Reasoning callback — streams extended-thinking deltas when enabled
          async (reasoningChunk: string, done: boolean) => {
            if (done) {
              response.write(
                `event: reasoning_done\ndata: ${JSON.stringify({
                  timestamp: new Date().toISOString(),
                })}\n\n`,
              );
            } else if (reasoningChunk) {
              accumulatedReasoning += reasoningChunk;
              response.write(
                `event: reasoning\ndata: ${JSON.stringify({
                  content: reasoningChunk,
                  timestamp: new Date().toISOString(),
                })}\n\n`,
              );
            }
          },
          // Tool callbacks — emit tool_call / tool_result SSE frames
          {
            onToolCall: async (call) => {
              accumulatedToolCalls.push({
                id: call.id,
                name: call.name,
                input: call.input,
                status: undefined,
                startedAt: call.startedAt,
              });
              response.write(
                `event: tool_call\ndata: ${JSON.stringify({
                  id: call.id,
                  name: call.name,
                  input: call.input,
                  startedAt: call.startedAt.toISOString(),
                })}\n\n`,
              );
            },
            onToolResult: async (r) => {
              const existing = accumulatedToolCalls.find((t) => t.id === r.id);
              if (existing) {
                existing.output = {
                  content: r.output.content,
                  sources: r.sources,
                };
                existing.status = r.status;
                existing.finishedAt = new Date();
                existing.durationMs = r.durationMs;
              }
              for (const s of r.sources ?? []) {
                if (s?.url && !accumulatedSources.has(s.url)) {
                  accumulatedSources.set(s.url, s);
                }
              }
              response.write(
                `event: tool_result\ndata: ${JSON.stringify({
                  id: r.id,
                  name: r.name,
                  output: {
                    content: r.output.content.slice(0, 2000),
                  },
                  sources: r.sources,
                  status: r.status,
                  durationMs: r.durationMs,
                })}\n\n`,
              );
            },
          },
        );

        // Persist the assistant message with thinking + tool calls when a
        // conversationId is set. The fast-streaming path bypasses
        // chat.service.sendMessage, so we save here.
        if (dto.conversationId && accumulatedContent) {
          try {
            const thinkingDoc = accumulatedReasoning
              ? {
                  content: accumulatedReasoning,
                  mode:
                    getThinkingCapability(dto.modelId) === 'none'
                      ? undefined
                      : getThinkingCapability(dto.modelId),
                  effort: dto.thinking?.effort,
                  budgetTokens: dto.thinking?.budgetTokens,
                }
              : undefined;
            await this.chatMessageModel.create({
              conversationId: new Types.ObjectId(dto.conversationId),
              userId,
              role: 'assistant',
              content: accumulatedContent,
              modelId: dto.modelId,
              messageType: 'assistant',
              metadata: {
                temperature: dto.temperature,
                maxTokens: dto.maxTokens,
              },
              thinking: thinkingDoc,
              ...(accumulatedToolCalls.length > 0
                ? { toolCalls: accumulatedToolCalls }
                : {}),
              ...(accumulatedSources.size > 0
                ? { sources: Array.from(accumulatedSources.values()) }
                : {}),
              ...(accumulatedCitations.length > 0
                ? { citations: accumulatedCitations }
                : {}),
            });
          } catch (saveErr) {
            this.logger.warn('Failed to persist streamed assistant message', {
              error:
                saveErr instanceof Error ? saveErr.message : String(saveErr),
              userId,
              conversationId: dto.conversationId,
            });
          }
        }
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

      const completionLen =
        typeof result?.content === 'string'
          ? result.content.length
          : typeof result?.response === 'string'
            ? result.response.length
            : accumulatedContent.length;

      this.logger.log('Streaming completed successfully', {
        userId,
        conversationId: result?.conversationId ?? dto.conversationId,
        messageId: result?.id,
        totalContentLength: completionLen,
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
