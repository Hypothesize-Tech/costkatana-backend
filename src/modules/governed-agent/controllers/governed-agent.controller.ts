import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  Query,
  HttpStatus,
  HttpException,
  ParseIntPipe,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { GovernedAgentService } from '../services/governed-agent.service';
import { GovernedAgentSseService } from '../services/governed-agent-sse.service';
import { InitiateTaskDto } from '../dto/initiate-task.dto';
import { GeneratePlanDto } from '../dto/generate-plan.dto';
import { ExecuteTaskDto } from '../dto/execute-task.dto';
import { LoggerService } from '../../../common/logger/logger.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    _id?: string;
  };
  userId?: string;
}

@Controller('api/governed-agent')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class GovernedAgentController {
  constructor(
    private readonly governedAgentService: GovernedAgentService,
    private readonly sseService: GovernedAgentSseService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Initiate a new governed task
   * POST /governed-agent/initiate
   */
  @Post('initiate')
  async initiateTask(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitiateTaskDto,
    @Query('chatId') chatId?: string,
    @Query('parentMessageId') parentMessageId?: string,
  ) {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('Initiate task request', {
      component: 'GovernedAgentController',
      operation: 'initiateTask',
      userId,
      userRequest: dto.userRequest.substring(0, 100),
      chatId,
      parentMessageId,
    });

    try {
      const task = await this.governedAgentService.initiateTask(
        dto.userRequest,
        userId,
        chatId,
        parentMessageId,
      );

      this.logger.log('Task initiated successfully', {
        component: 'GovernedAgentController',
        operation: 'initiateTask',
        taskId: task.id,
        userId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: {
          taskId: task.id,
          mode: task.mode,
          classification: task.classification,
          status: task.status,
        },
      };
    } catch (error) {
      this.logger.error('Failed to initiate task', {
        component: 'GovernedAgentController',
        operation: 'initiateTask',
        userId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to initiate task',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Generate execution plan for a task
   * POST /governed-agent/:taskId/generate-plan
   */
  @Post(':taskId/generate-plan')
  async generatePlan(
    @Req() req: AuthenticatedRequest,
    @Param('taskId') taskId: string,
    @Body() dto: GeneratePlanDto,
  ) {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('Generate plan request', {
      component: 'GovernedAgentController',
      operation: 'generatePlan',
      taskId,
      userId,
    });

    try {
      // Check if we need clarifying answers
      const task = await this.governedAgentService.getTask(taskId, userId);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }

      if (
        task.scopeAnalysis?.clarificationNeeded &&
        task.scopeAnalysis.clarificationNeeded.length > 0 &&
        !dto.clarifyingAnswers
      ) {
        return {
          success: true,
          requiresClarification: true,
          data: {
            taskId,
            clarificationNeeded: task.scopeAnalysis.clarificationNeeded,
            ambiguities: task.scopeAnalysis.ambiguities,
            message:
              'Please provide answers to clarifying questions before planning',
          },
        };
      }

      // Submit clarifying answers if provided
      if (dto.clarifyingAnswers) {
        await this.governedAgentService.submitClarifyingAnswers(
          taskId,
          userId,
          dto.clarifyingAnswers,
        );
      }

      // Generate the plan
      const plan = await this.governedAgentService.generatePlan(taskId, userId);

      this.logger.log('Plan generated successfully', {
        component: 'GovernedAgentController',
        operation: 'generatePlan',
        taskId,
        userId,
        phasesCount: plan.phases.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: {
          taskId,
          plan,
          approvalToken: plan.riskAssessment.requiresApproval
            ? 'token-would-be-generated'
            : undefined,
          requiresApproval: plan.riskAssessment.requiresApproval,
        },
      };
    } catch (error) {
      this.logger.error('Failed to generate plan', {
        component: 'GovernedAgentController',
        operation: 'generatePlan',
        taskId,
        userId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to generate plan',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get clarifying questions for a task
   * GET /governed-agent/:taskId/clarify
   */
  @Get(':taskId/clarify')
  async getClarifyingQuestions(
    @Req() req: AuthenticatedRequest,
    @Param('taskId') taskId: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('Get clarifying questions request', {
      component: 'GovernedAgentController',
      operation: 'getClarifyingQuestions',
      taskId,
      userId,
    });

    try {
      const task = await this.governedAgentService.getTask(taskId, userId);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }

      return {
        success: true,
        data: {
          taskId,
          clarificationNeeded: task.scopeAnalysis?.clarificationNeeded || [],
          ambiguities: task.scopeAnalysis?.ambiguities || [],
          hasClarifications:
            (task.scopeAnalysis?.clarificationNeeded?.length || 0) > 0,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get clarifying questions', {
        component: 'GovernedAgentController',
        operation: 'getClarifyingQuestions',
        taskId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get clarifying questions',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Execute task with progress streaming (SSE)
   * POST /governed-agent/:taskId/execute
   */
  @Post(':taskId/execute')
  async executeWithProgress(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('taskId') taskId: string,
    @Body() dto: ExecuteTaskDto,
  ) {
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('Execute task request', {
      component: 'GovernedAgentController',
      operation: 'executeWithProgress',
      taskId,
      userId,
      approvalToken: dto.approvalToken ? 'provided' : 'not provided',
    });

    try {
      const task = await this.governedAgentService.getTask(taskId, userId);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }

      // Check if approval is required
      if (task.plan?.riskAssessment.requiresApproval && !dto.approvalToken) {
        throw new HttpException(
          {
            success: false,
            message: 'Approval token required for this operation',
            upgradeUrl: 'https://www.costkatana.com/#pricing',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Add client to SSE channel
      const channelId = this.sseService.addClient(taskId, userId, res);

      // Handle client disconnect
      req.on('close', () => {
        this.sseService.removeClient(taskId, res);
      });

      // Start execution asynchronously
      this.governedAgentService.executePlan(taskId, userId).catch((error) => {
        this.logger.error('Task execution failed', {
          component: 'GovernedAgentController',
          operation: 'executeWithProgress',
          taskId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        // Send error event
        this.sseService.sendEvent(taskId, 'execution_failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        });
      });
    } catch (error) {
      this.logger.error('Failed to start task execution', {
        component: 'GovernedAgentController',
        operation: 'executeWithProgress',
        taskId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to start task execution',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get user's recent tasks
   * GET /governed-agent/tasks
   */
  @Get('tasks')
  async getUserTasks(
    @Req() req: AuthenticatedRequest,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('status')
    status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
  ) {
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('Get user tasks request', {
      component: 'GovernedAgentController',
      operation: 'getUserTasks',
      userId,
      limit: limit || 10,
      status,
    });

    try {
      const tasks = await this.governedAgentService.getUserTasks(
        userId,
        limit || 10,
        status,
      );

      return {
        success: true,
        data: tasks,
      };
    } catch (error) {
      this.logger.error('Failed to get user tasks', {
        component: 'GovernedAgentController',
        operation: 'getUserTasks',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get user tasks',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get task status
   * GET /governed-agent/:taskId
   */
  @Get(':taskId')
  async getTaskStatus(
    @Req() req: AuthenticatedRequest,
    @Param('taskId') taskId: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('Get task status request', {
      component: 'GovernedAgentController',
      operation: 'getTaskStatus',
      taskId,
      userId,
    });

    try {
      const task = await this.governedAgentService.getTask(taskId, userId);
      if (!task) {
        throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
      }

      return {
        success: true,
        data: task,
      };
    } catch (error) {
      this.logger.error('Failed to get task status', {
        component: 'GovernedAgentController',
        operation: 'getTaskStatus',
        taskId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get task status',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Set up SSE stream for task progress
   * GET /governed-agent/:taskId/stream
   */
  @Get(':taskId/stream')
  async streamTaskProgress(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('taskId') taskId: string,
  ) {
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.logger.log('SSE stream request', {
      component: 'GovernedAgentController',
      operation: 'streamTaskProgress',
      taskId,
      userId,
    });

    try {
      // Add client to SSE channel
      this.sseService.addClient(taskId, userId, res);

      // Handle client disconnect
      req.on('close', () => {
        this.sseService.removeClient(taskId, res);
      });
    } catch (error) {
      this.logger.error('Failed to set up SSE stream', {
        component: 'GovernedAgentController',
        operation: 'streamTaskProgress',
        taskId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to set up progress stream',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
