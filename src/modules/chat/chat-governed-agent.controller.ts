import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ValidationPipe,
  HttpStatus,
  HttpException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoggerService } from '../../common/logger/logger.service';
import { GovernedAgentService } from '../governed-agent/services/governed-agent.service';
import { GovernedAgentSseService } from '../governed-agent/services/governed-agent-sse.service';
import { ChatService } from './services/chat.service';
import { ChatEventsService } from './services/chat-events.service';
import { GovernedPlanMessageCreator } from './utils/governed-plan-message-creator';
import {
  ClassifyMessageDto,
  InitiateGovernedDto,
  NavigateModeDto,
  RequestChangesDto,
  SubmitAnswersDto,
} from './dto';
import {
  GovernedTask,
  GovernedTaskDocument,
} from '../../schemas/governed-agent/governed-task.schema';
import { Observable, Subject } from 'rxjs';

interface AuthenticatedUser {
  id: string;
  _id?: string;
  email?: string;
}

@ApiTags('Chat - Governed Agent')
@Controller('api/chat')
@UseGuards(JwtAuthGuard)
export class ChatGovernedAgentController {
  constructor(
    private readonly governedAgentService: GovernedAgentService,
    private readonly sseService: GovernedAgentSseService,
    private readonly chatService: ChatService,
    private readonly chatEventsService: ChatEventsService,
    private readonly governedPlanMessageCreator: GovernedPlanMessageCreator,
    private readonly logger: LoggerService,
    @InjectModel(GovernedTask.name)
    private readonly governedTaskModel: Model<GovernedTaskDocument>,
  ) {}

  /**
   * Classify a chat message to determine if governed agent should be used
   * POST /chat/classify
   */
  @ApiOperation({
    summary: 'Classify message for governed agent',
    description:
      'Analyze a chat message to determine if it requires a governed agent workflow',
  })
  @ApiResponse({ status: 200, description: 'Message classified successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post('classify')
  async classifyMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: ClassifyMessageDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Classifying message for governed agent', {
        userId: user.id,
        messageLength: dto.message.length,
      });

      const classification = await this.governedAgentService.classifyTask(
        dto.message,
        user.id,
      );

      const shouldUseGovernedAgent =
        classification.requiresPlanning ||
        classification.complexity === 'high' ||
        classification.riskLevel === 'high' ||
        classification.type === 'coding';

      const duration = Date.now() - startTime;

      this.logger.log('Message classification completed', {
        userId: user.id,
        shouldUseGovernedAgent,
        classificationType: classification.type,
        complexity: classification.complexity,
        riskLevel: classification.riskLevel,
        duration,
      });

      return {
        success: true,
        data: {
          shouldUseGovernedAgent,
          classification,
          reason: shouldUseGovernedAgent
            ? 'This task would benefit from structured planning and verification'
            : 'This task can be handled directly',
        },
      };
    } catch (error) {
      this.logger.error('Message classification failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to classify message',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Initiate governed agent task from chat
   * POST /chat/governed/initiate
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute for governed agent initiation
  @Post('governed/initiate')
  async initiateFromChat(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: InitiateGovernedDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Initiating governed task from chat', {
        userId: user.id,
        messageLength: dto.message.length,
        conversationId: dto.conversationId,
      });

      // Create or get conversation
      let chatId: string | undefined = dto.conversationId;

      if (!chatId) {
        const conversation = await this.chatService.createConversation(
          user.id,
          {
            title: dto.message?.substring(0, 80) || 'Governed task',
          },
        );
        chatId = conversation._id.toString();
        this.logger.log('Created new conversation for governed task', {
          userId: user.id,
          conversationId: chatId,
        });
      }

      if (!chatId) {
        throw new HttpException(
          { success: false, message: 'Conversation ID is required' },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Create the user message in the conversation
      await this.chatService.createUserMessage(chatId, user.id, dto.message);

      // Initiate the governed task with chat context (parentMessageId set when plan message is created)
      const task = await this.governedAgentService.initiateTask(
        dto.message,
        user.id,
        chatId,
        undefined,
      );

      const taskId = task.id;

      // Create governed plan message and link task to chat (sets task.chatId and task.parentMessageId)
      await this.governedPlanMessageCreator.createPlanMessage(
        chatId,
        taskId,
        user.id,
      );

      this.logger.log('Governed task initiated successfully', {
        userId: user.id,
        taskId,
        chatId,
        mode: task.mode,
        status: task.status,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: {
          taskId,
          conversationId: chatId,
          mode: task.mode,
          classification: task.classification,
          status: task.status,
          message: 'Governed agent task initiated successfully',
        },
      };
    } catch (error) {
      this.logger.error('Failed to initiate governed task from chat', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        conversationId: dto.conversationId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to initiate governed task',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Stream governed agent workflow progress via SSE
   * GET /chat/governed/:taskId/stream
   */
  @Sse('governed/:taskId/stream')
  async streamTaskProgress(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Observable<MessageEvent>> {
    const userId = user.id;

    this.logger.log('Starting event-driven SSE stream for governed task', {
      taskId,
      userId,
    });

    const subject = new Subject<MessageEvent>();
    const maxDuration = 30 * 60 * 1000; // 30 minutes max
    const startTime = Date.now();
    let isConnected = true;
    let pollingInterval: NodeJS.Timeout | null = null;
    let lastEmittedProgressKey = '';

    const cleanup = () => {
      isConnected = false;
      if (pollingInterval) clearInterval(pollingInterval);
      subject.complete();
    };

    // Send initial connection event
    subject.next({
      type: 'connected',
      data: JSON.stringify({
        type: 'connected',
        taskId,
        timestamp: new Date().toISOString(),
      }),
    } as MessageEvent);

    // Emit initial task snapshot immediately so frontend shows plan skeleton before first poll
    const initialTask = await this.governedTaskModel.findOne({
      id: taskId,
      userId,
    });
    if (initialTask) {
      const ep = initialTask.executionProgress;
      lastEmittedProgressKey = [
        initialTask.status,
        initialTask.mode,
        ep?.completedSteps?.length ?? 0,
        ep?.currentStep ?? '',
        ep?.currentPhase ?? 0,
        initialTask.updatedAt?.getTime?.() ?? initialTask.updatedAt,
      ].join('|');
      subject.next({
        type: 'update',
        data: JSON.stringify({
          type: 'task_state',
          taskId,
          mode: initialTask.mode,
          status: initialTask.status,
          classification: initialTask.classification,
          scopeAnalysis: initialTask.scopeAnalysis,
          plan: initialTask.plan,
          executionProgress: initialTask.executionProgress,
          executionResults: initialTask.executionResults,
          verification: initialTask.verification,
          error: initialTask.error,
          updatedAt: initialTask.updatedAt,
          timestamp: new Date().toISOString(),
        }),
      } as MessageEvent);
    } else {
      lastEmittedProgressKey = 'INITIAL_SENT';
    }

    // Event listener for governed task updates
    // ChatEventData from emitStatus: type='status', data={status, metadata}
    // taskId lives in event.data.metadata.taskId
    const eventListener = async (event: any) => {
      if (!isConnected) {
        return;
      }

      try {
        const eventTaskId = event.data?.metadata?.taskId ?? event.data?.taskId;
        const eventStatus = event.data?.status ?? event.type;

        // Check if this event relates to our task (userId + taskId match)
        if (eventTaskId === taskId && event.userId === userId) {
          // Send the event via SSE (type:'update' so frontend addEventListener('update') fires)
          subject.next({
            type: 'update',
            data: JSON.stringify({
              type: eventStatus,
              ...event.data,
              timestamp: new Date().toISOString(),
            }),
          } as MessageEvent);

          // Check for terminal events (event.data.status for emitStatus events)
          if (
            eventStatus === 'governed_task_completed' ||
            eventStatus === 'governed_task_failed' ||
            eventStatus === 'governed_task_cancelled'
          ) {
            this.logger.log('SSE task reached terminal state via event', {
              taskId,
              eventType: event.type,
            });
            subject.next({
              type: 'complete',
              data: JSON.stringify({
                type: 'complete',
                status:
                  eventStatus === 'governed_task_completed'
                    ? 'completed'
                    : eventStatus === 'governed_task_cancelled'
                      ? 'cancelled'
                      : 'failed',
                timestamp: new Date().toISOString(),
              }),
            } as MessageEvent);
            cleanup();
          }
        }
      } catch (error: any) {
        this.logger.error('Error processing governed task event for SSE', {
          error: error instanceof Error ? error.message : String(error),
          taskId,
          userId,
          eventType: event.type,
        });
      }
    };

    // Subscribe to chat events for this user
    this.chatEventsService.on(`chat.*.*`, eventListener);

    // Send heartbeat every 5 seconds
    const heartbeatInterval = setInterval(() => {
      if (!isConnected) {
        clearInterval(heartbeatInterval);
        return;
      }

      // Check if we've exceeded max duration
      if (Date.now() - startTime > maxDuration) {
        subject.next({
          type: 'timeout',
          data: JSON.stringify({
            type: 'timeout',
            message: 'Stream timeout exceeded (30 min)',
          }),
        } as MessageEvent);
        cleanup();
        this.logger.warn('SSE stream exceeded max duration', {
          taskId,
          userId,
        });
        return;
      }

      try {
        subject.next({
          type: 'heartbeat',
          data: JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          }),
        } as MessageEvent);
      } catch (error) {
        this.logger.warn('Failed to send heartbeat', {
          taskId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        cleanup();
      }
    }, 5000);

    // Set up DB polling fallback (Express parity - 500ms polling)
    pollingInterval = setInterval(async () => {
      if (!isConnected) {
        if (pollingInterval) clearInterval(pollingInterval);
        return;
      }

      try {
        // Poll task state from DB to catch missed events
        const task = await this.governedTaskModel.findOne({
          id: taskId,
          userId,
        });

        if (task) {
          // Build progress key for deduplication - only emit when something changed
          const ep = task.executionProgress;
          const progressKey = [
            task.status,
            task.mode,
            ep?.completedSteps?.length ?? 0,
            ep?.currentStep ?? '',
            ep?.currentPhase ?? 0,
            task.updatedAt?.getTime?.() ?? task.updatedAt,
          ].join('|');

          const hasChanged = progressKey !== lastEmittedProgressKey;
          if (hasChanged) {
            lastEmittedProgressKey = progressKey;

            // Resolve current step description from plan
            let currentStepDescription: string | undefined;
            if (ep?.currentStep && task.plan?.phases) {
              for (const phase of task.plan.phases) {
                const step = phase.steps.find((s) => s.id === ep.currentStep);
                if (step) {
                  currentStepDescription = step.description;
                  break;
                }
              }
            }

            subject.next({
              type: 'update',
              data: JSON.stringify({
                type: 'task_state',
                taskId,
                mode: task.mode,
                status: task.status,
                classification: task.classification,
                scopeAnalysis: task.scopeAnalysis,
                plan: task.plan,
                executionProgress: task.executionProgress,
                executionResults: task.executionResults,
                verification: task.verification,
                error: task.error,
                updatedAt: task.updatedAt,
                message: ep?.currentStep
                  ? `Executing: ${currentStepDescription ?? ep.currentStep}`
                  : undefined,
                timestamp: new Date().toISOString(),
              }),
            } as MessageEvent);
          }

          // Check for terminal states
          if (
            task.status === 'completed' ||
            (task.status === 'failed' && task.error)
          ) {
            subject.next({
              type: 'complete',
              data: JSON.stringify({
                type: 'complete',
                status: task.status,
                taskId,
                timestamp: new Date().toISOString(),
              }),
            } as MessageEvent);
            cleanup();
          }
        }
      } catch (error) {
        this.logger.error('Error in SSE polling fallback', {
          error: error instanceof Error ? error.message : String(error),
          taskId,
          userId,
        });
      }
    }, 500); // Poll every 500ms (matches Express behavior)

    // Cleanup on unsubscribe
    subject.subscribe({
      complete: () => {
        clearInterval(heartbeatInterval);
        if (pollingInterval) clearInterval(pollingInterval);
        this.logger.log('SSE stream closed by client', { taskId, userId });
      },
      error: () => {
        clearInterval(heartbeatInterval);
        if (pollingInterval) clearInterval(pollingInterval);
        this.logger.error('SSE stream error', { taskId, userId });
      },
    });

    return subject.asObservable();
  }

  /**
   * Request plan generation (user manually triggers this after reviewing scope)
   * POST /chat/governed/:taskId/request-plan
   */
  @Post('governed/:taskId/request-plan')
  async requestPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Requesting plan generation', {
        userId: user.id,
        taskId,
      });

      // Trigger plan generation asynchronously
      this.governedAgentService.generatePlan(taskId, user.id).catch((error) => {
        this.logger.error('Plan generation failed', {
          taskId,
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      this.logger.log('Plan generation started', {
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Plan generation started',
      };
    } catch (error) {
      this.logger.error('Failed to request plan generation', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to start plan generation',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Submit clarifying answers and trigger plan generation
   * POST /chat/governed/:taskId/submit-answers
   */
  @Post('governed/:taskId/submit-answers')
  async submitClarifyingAnswers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: SubmitAnswersDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Submitting clarifying answers', {
        userId: user.id,
        taskId,
        answersCount: Object.keys(dto.answers).length,
      });

      // Submit answers and trigger plan generation
      await this.governedAgentService.submitClarifyingAnswers(
        taskId,
        user.id,
        dto.answers,
      );

      this.logger.log('Clarifying answers submitted successfully', {
        userId: user.id,
        taskId,
        answersCount: Object.keys(dto.answers).length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Answers submitted, generating plan...',
      };
    } catch (error) {
      this.logger.error('Failed to submit clarifying answers', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to submit answers',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Approve plan and start execution
   * POST /chat/governed/:taskId/approve
   */
  @Post('governed/:taskId/approve')
  async approvePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Approving plan and starting execution', {
        userId: user.id,
        taskId,
      });

      // Trigger execution asynchronously
      this.governedAgentService.executePlan(taskId, user.id).catch((error) => {
        this.logger.error('Plan execution failed', {
          taskId,
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      this.logger.log('Plan execution started', {
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Execution started',
      };
    } catch (error) {
      this.logger.error('Failed to approve plan', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to start execution',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cancel a running governed task (e.g. during BUILD)
   * POST /chat/governed/:taskId/cancel
   */
  @Post('governed/:taskId/cancel')
  async cancelTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Cancelling governed task', {
        userId: user.id,
        taskId,
      });

      await this.governedAgentService.cancelTask(taskId, user.id);

      this.logger.log('Task cancelled successfully', {
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Task cancelled',
      };
    } catch (error) {
      this.logger.error('Failed to cancel task', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to cancel task',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Request changes to the plan
   * POST /chat/governed/:taskId/request-changes
   */
  @Post('governed/:taskId/request-changes')
  async requestPlanChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: RequestChangesDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Requesting plan changes', {
        userId: user.id,
        taskId,
        feedbackLength: dto.feedback.length,
      });

      // Save the feedback to the task
      await this.governedAgentService.saveTaskFeedback(
        taskId,
        user.id,
        dto.feedback,
      );

      // Regenerate the plan with the updated feedback
      this.governedAgentService.generatePlan(taskId, user.id).catch((error) => {
        this.logger.error('Plan regeneration failed', {
          taskId,
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      this.logger.log('Plan regeneration started with feedback', {
        userId: user.id,
        taskId,
        feedbackLength: dto.feedback.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Plan regeneration started with your feedback',
      };
    } catch (error) {
      this.logger.error('Failed to request plan changes', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to request plan changes',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Go back to previous mode
   * POST /chat/governed/:taskId/go-back
   */
  @Post('governed/:taskId/go-back')
  async goBack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Going back to previous mode', {
        userId: user.id,
        taskId,
      });

      await this.governedAgentService.goBackToPreviousMode(taskId, user.id);

      this.logger.log('Successfully navigated back', {
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Navigated back successfully',
      };
    } catch (error) {
      this.logger.error('Failed to go back', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to navigate back',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Navigate to a specific mode
   * POST /chat/governed/:taskId/navigate
   */
  @Post('governed/:taskId/navigate')
  async navigateToMode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: NavigateModeDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Navigating to specific mode', {
        userId: user.id,
        taskId,
        targetMode: dto.mode,
      });

      await this.governedAgentService.navigateToMode(
        taskId,
        user.id,
        dto.mode as any,
      );

      this.logger.log('Successfully navigated to mode', {
        userId: user.id,
        taskId,
        mode: dto.mode,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: `Navigated to ${dto.mode} successfully`,
      };
    } catch (error) {
      this.logger.error('Failed to navigate to mode', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        targetMode: dto.mode,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to navigate to mode',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get governed task status from chat context
   * GET /api/chat/governed/:taskId
   */
  @Get('governed/:taskId')
  async getGovernedTaskStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Getting governed task status from chat context', {
        userId: user.id,
        taskId,
      });

      const task = await this.governedAgentService.getTask(taskId, user.id);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }

      this.logger.log('Successfully retrieved governed task status', {
        userId: user.id,
        taskId,
        taskMode: task.mode,
        taskStatus: task.status,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: task,
      };
    } catch (error) {
      this.logger.error('Failed to get governed task status', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        taskId,
        duration: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get governed task status',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
