import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
  UsePipes,
  Logger,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AgentService } from './services/agent.service';
import type { AgentStatusResponse } from './services/agent.service';
import type { ChatService } from '../chat/services/chat.service';

// DTOs
import {
  AgentQueryDto,
  AgentStreamDto,
  AgentFeedbackDto,
  ConversationHistoryQueryDto,
  StartWizardDto,
  ContinueWizardDto,
} from './dto';

// Types
import { AgentQuery } from '../../types/agent.types';

@Controller('api/agent')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    @Inject(forwardRef(() => require('../chat/services/chat.service').ChatService))
    private readonly chatService: ChatService,
  ) {}

  /**
   * POST /api/agent/query
   * Send a query to the AI agent
   */
  @Post('query')
  async query(
    @CurrentUser() user: { id: string },
    @Body() body: AgentQueryDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log(`Processing agent query for user ${user.id}`, {
        queryLength: body.query.length,
      });

      const agentQuery: AgentQuery = {
        userId: user.id,
        query: body.query,
        context: body.context,
      };

      const result = await this.agentService.query(agentQuery);

      this.logger.log(`Agent query completed for user ${user.id}`, {
        success: result.success,
        executionTime: Date.now() - startTime,
        responseLength: result.response?.length || 0,
      });

      return result.success
        ? { success: true, data: result }
        : { success: false, error: result.error, data: result };
    } catch (error: any) {
      this.logger.error(
        `Agent query failed for user ${user.id}`,
        error.message,
      );
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * POST /api/agent/stream
   * Stream agent response for real-time interaction
   */
  @Post('stream')
  async streamQuery(
    @CurrentUser() user: { id: string },
    @Body() body: AgentStreamDto,
    @Res() res: Response,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting agent stream for user ${user.id}`);

      // Set up Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      res.write(
        `data: ${JSON.stringify({ type: 'connected', message: 'Agent query started' })}\n\n`,
      );

      const agentQuery: AgentQuery = {
        userId: user.id,
        query: body.query,
        context: body.context,
      };

      try {
        res.write(
          `data: ${JSON.stringify({ type: 'thinking', message: 'Analyzing your query...' })}\n\n`,
        );

        const result = await this.agentService.query(agentQuery);

        res.write(
          `data: ${JSON.stringify({
            type: 'result',
            data: result,
          })}\n\n`,
        );

        this.logger.log(`Agent stream completed for user ${user.id}`, {
          success: result.success,
          executionTime: Date.now() - startTime,
        });
      } catch (error: any) {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: error.message,
          })}\n\n`,
        );
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (error: any) {
      this.logger.error(
        `Agent stream failed for user ${user.id}`,
        error.message,
      );
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message,
          executionTime: Date.now() - startTime,
        });
      }
    }
  }

  /**
   * GET /api/agent/status
   * Get agent status and statistics
   */
  @Get('status')
  async getStatus(): Promise<
    | { success: true; data: AgentStatusResponse }
    | { success: false; error: string }
  > {
    try {
      const status = await this.agentService.getStatus();
      return { success: true, data: status };
    } catch (error: any) {
      this.logger.error('Failed to get agent status', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * POST /api/agent/initialize
   * Initialize the agent (admin only)
   */
  @Post('initialize')
  @HttpCode(HttpStatus.OK)
  async initialize(@CurrentUser() user: { id: string; role?: string }) {
    const startTime = Date.now();

    try {
      this.logger.log(`Initializing agent for user ${user.id}`);

      // Could add admin check here
      // if (user.role !== 'admin') {
      //   throw new ForbiddenException('Admin access required');
      // }

      await this.agentService.initialize();

      this.logger.log('Agent initialized successfully', {
        executionTime: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Agent initialized successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Agent initialization failed', error.message);
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * POST /api/agent/feedback
   * Add feedback/learning to the agent
   */
  @Post('feedback')
  async addFeedback(
    @CurrentUser() user: { id: string },
    @Body() body: AgentFeedbackDto,
  ) {
    const startTime = Date.now();

    try {
      if (!body.insight) {
        throw new BadRequestException('Insight content is required');
      }

      await this.agentService.addLearning(body.insight, {
        ...body.metadata,
        userId: user.id,
        rating: body.rating,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`Feedback added for user ${user.id}`, {
        rating: body.rating,
        insightLength: body.insight.length,
        executionTime: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Feedback added successfully',
      };
    } catch (error: any) {
      this.logger.error(
        `Feedback addition failed for user ${user.id}`,
        error.message,
      );
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * GET /api/agent/conversations
   * Get conversation history with the agent
   */
  @Get('conversations')
  async getConversationHistory(
    @CurrentUser() user: { id: string },
    @Query() query: ConversationHistoryQueryDto,
  ) {
    try {
      if (query.conversationId === undefined || query.conversationId === '') {
        return {
          success: false,
          error: 'conversationId is required',
        };
      }
      const result = await this.chatService.getConversationHistory(
        query.conversationId,
        user.id,
        query.limit || 50,
        query.offset ?? 0,
      );

      return {
        success: true,
        data: {
          conversation: result.conversation,
          messages: result.messages,
          pagination: result.pagination,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Conversation history retrieval failed for user ${user.id}`,
        error.message,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /api/agent/suggestions
   * Get suggested queries for the user
   */
  @Get('suggestions')
  getSuggestedQueries(@CurrentUser() user: { id: string }) {
    try {
      const suggestions = [
        'Create a new AI project for my chatbot',
        'Help me choose the best model for content generation',
        'Analyze my cost trends for the past month',
        'What are the most expensive API calls in my project?',
        'Compare Claude vs GPT models for my use case',
        'Show me my current projects and their settings',
        'Suggest ways to optimize my prompt costs',
        'Test model integration for my API',
        "What's the most cost-effective model for summarization?",
        'Configure model settings for my content generation project',
      ];

      // Shuffle and take 4 suggestions
      const shuffled = suggestions.sort(() => 0.5 - Math.random());

      this.logger.log(
        `Generated ${shuffled.slice(0, 4).length} suggestions for user ${user.id}`,
      );

      return {
        success: true,
        data: {
          suggestions: shuffled.slice(0, 4),
          categories: {
            projectManagement: [
              'Create a new AI project',
              'Show me my current projects',
              'Update my project settings',
            ],
            modelSelection: [
              'Recommend models for my use case',
              'Compare different AI models',
              'Test model integration',
            ],
            costOptimization: [
              'Analyze my spending patterns',
              'Find cost-saving opportunities',
              'Optimize my prompt costs',
            ],
          },
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Suggestion generation failed for user ${user.id}`,
        error.message,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * POST /api/agent/wizard/start
   * Start conversational project creation wizard
   */
  @Post('wizard/start')
  async startProjectWizard(
    @CurrentUser() user: { id: string },
    @Body() body: StartWizardDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting project wizard for user ${user.id}`, {
        projectType: body.projectType,
        quickStart: body.quickStart,
      });

      let wizardPrompt = "I'd like to help you create a new AI project! ";

      if (body.quickStart && body.projectType) {
        wizardPrompt += `I see you want to create a ${body.projectType} project. `;
      }

      wizardPrompt +=
        'To recommend the best setup for you, I need to understand your requirements better. What type of AI project are you planning to build?';

      const agentQuery: AgentQuery = {
        userId: user.id,
        query: wizardPrompt,
        context: {
          isProjectWizard: true,
          projectType: body.projectType ?? undefined,
        },
      };

      const result = await this.agentService.query(agentQuery);

      this.logger.log(`Project wizard started for user ${user.id}`, {
        success: result.success,
        executionTime: Date.now() - startTime,
      });

      return {
        success: true,
        wizard: {
          step: 1,
          totalSteps: 4,
          stepName: 'Project Type',
          response: result.response,
          nextQuestions: [
            'API Integration - Connect AI to your existing systems',
            'Chatbot - Conversational AI for customer service',
            'Content Generation - Create articles, marketing copy, etc.',
            'Data Analysis - Process and analyze data with AI',
            'Custom - Something specific to your needs',
          ],
        },
        metadata: result.metadata,
      };
    } catch (error: any) {
      this.logger.error(
        `Project wizard start failed for user ${user.id}`,
        error.message,
      );
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * POST /api/agent/wizard/continue
   * Continue project creation wizard conversation
   */
  @Post('wizard/continue')
  async continueProjectWizard(
    @CurrentUser() user: { id: string },
    @Body() body: ContinueWizardDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log(`Continuing project wizard for user ${user.id}`, {
        currentStep: body.wizardState.step,
        responseLength: body.response.length,
      });

      let wizardPrompt = `User response: "${body.response}". `;

      if (body.wizardState.step === 1) {
        wizardPrompt +=
          "Great! Now, what's your expected usage volume - will this be handling a few requests per day (low), hundreds per day (medium), or thousands per day (high)?";
      } else if (body.wizardState.step === 2) {
        wizardPrompt +=
          "Perfect! What's most important for your project - keeping costs low, maintaining high quality responses, or getting fast response times?";
      } else if (body.wizardState.step === 3) {
        wizardPrompt +=
          'Excellent! Do you have any specific requirements, constraints, or preferences I should know about? For example, certain AI providers you prefer, budget limits, or specific features you need?';
      } else if (body.wizardState.step === 4) {
        wizardPrompt +=
          'Thanks for all that information! Now I have everything I need to create your project with optimal settings. Let me set this up for you.';
      }

      const agentQuery: AgentQuery = {
        userId: user.id,
        query: wizardPrompt,
        context: {
          isProjectWizard: true,
          wizardState: body.wizardState,
          previousResponses: body.wizardState.responses || [],
        },
      };

      const result = await this.agentService.query(agentQuery);

      const nextStep = (body.wizardState.step || 1) + 1;
      const isComplete = (body.wizardState.step || 1) >= 4;

      this.logger.log(`Project wizard step completed for user ${user.id}`, {
        currentStep: body.wizardState.step,
        nextStep,
        isComplete,
        success: result.success,
        executionTime: Date.now() - startTime,
      });

      return {
        success: true,
        wizard: {
          step: nextStep,
          totalSteps: 4,
          stepName: this.getWizardStepName(nextStep),
          response: result.response,
          isComplete,
        },
        metadata: result.metadata,
      };
    } catch (error: any) {
      this.logger.error(
        `Project wizard continuation failed for user ${user.id}`,
        error.message,
      );
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  private getWizardStepName(step: number): string {
    const stepNames = {
      1: 'Project Type',
      2: 'Usage Volume',
      3: 'Priority',
      4: 'Requirements',
      5: 'Complete',
    };
    return stepNames[step as keyof typeof stepNames] || 'Complete';
  }
}
