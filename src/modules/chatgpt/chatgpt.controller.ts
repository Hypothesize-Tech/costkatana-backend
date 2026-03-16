import {
  Controller,
  Get,
  Post,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ChatGPTService } from './chatgpt.service';
import { LoggerService } from '../../common/logger/logger.service';

interface ChatGPTRequestBody {
  user_id?: string;
  api_key?: string;
  email?: string;
  name?: string;
  source?: string;
  onboarding?: {
    email: string;
    name?: string;
    source?: string;
    preferences?: {
      use_case?: string;
      ai_coaching?: boolean;
      email_insights?: boolean;
    };
  };
  conversation_data?: {
    prompt: string;
    response: string;
    model: string;
    tokens_used?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    conversation_id?: string;
    timestamp?: string;
  };
  project?: {
    name?: string;
    description?: string;
    budget_amount?: number;
    budget_period?: 'monthly' | 'quarterly' | 'yearly';
  };
  action: 'track_usage' | 'create_project' | 'get_projects' | 'get_analytics' | 'generate_magic_link' | 'check_connection';
}

@ApiTags('ChatGPT Integration')
@Controller('api/chatgpt')
export class ChatGPTController {
  constructor(
    private readonly logger: LoggerService,
    private readonly chatGPTService: ChatGPTService,
  ) {}

  /**
   * Health check endpoint
   */
  @Get('health')
  @ApiOperation({
    summary: 'ChatGPT integration health check',
    description: 'Check if the ChatGPT integration with AI-powered insights is running',
  })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async healthCheck() {
    return {
      success: true,
      message: 'ChatGPT integration with AI-powered insights is running',
      version: '2.0.0',
      ai_features: ['bedrock_optimization', 'smart_tips', 'usage_analysis', 'automatic_connection_checking'],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Main endpoint for ChatGPT Custom GPT actions with automatic connection checking
   */
  @Post('action')
  @ApiOperation({
    summary: 'Handle ChatGPT Custom GPT actions',
    description: 'Main endpoint for ChatGPT Custom GPT actions with automatic connection checking',
  })
  @ApiResponse({ status: 200, description: 'Action executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid action or parameters' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async handleAction(@Body() body: ChatGPTRequestBody) {
    const startTime = Date.now();
    const { action } = body;

    try {
      this.logger.log('ChatGPT action request', { action });

      // Handle magic link generation first (no auth required)
      if (action === 'generate_magic_link') {
        const result = await this.chatGPTService.generateMagicLink(
          body.email || body.onboarding?.email || '',
          body.name || body.onboarding?.name,
          body.source || body.onboarding?.source || 'chatgpt'
        );
        return result;
      }

      // Handle connection check action
      if (action === 'check_connection') {
        const connectionStatus = await this.chatGPTService.checkConnectionStatus(body);
        return {
          success: true,
          data: connectionStatus
        };
      }

      // For all other actions, automatically check connection status first
      const connectionStatus = await this.chatGPTService.checkConnectionStatus(body);

      // If not connected, guide user through onboarding
      if (!connectionStatus.connected) {
        return {
          success: false,
          error: 'authentication_required',
          onboarding: true,
          connection_status: connectionStatus,
          message: connectionStatus.message,
          instructions: {
            step1: 'I need your email to create a magic link',
            step2: 'Click the magic link to instantly connect your account',
            step3: 'Come back here and start tracking your AI costs!',
            example: 'Just say: "My email is john@example.com" and I\'ll create your magic link!'
          }
        };
      }

      // User is connected - proceed with the requested action
      const userId = connectionStatus.userId!;

      // Route to appropriate handler
      switch (action) {
        case 'track_usage':
          const usageResult = await this.chatGPTService.trackUsage(userId, body.conversation_data);
          return {
            success: true,
            message: 'Usage tracked successfully',
            data: usageResult
          };

        case 'create_project':
          const projectResult = await this.chatGPTService.createProject(userId, body.project);
          return {
            success: true,
            message: 'Project created successfully',
            data: projectResult
          };

        case 'get_projects':
          const projectsResult = await this.chatGPTService.getProjects(userId);
          return {
            success: true,
            data: projectsResult
          };

        case 'get_analytics':
          const analyticsResult = await this.chatGPTService.getAnalytics(userId);
          return {
            success: true,
            data: analyticsResult
          };

        default:
          this.logger.warn('ChatGPT action failed - invalid action', { action, userId });

          throw new HttpException(
            {
              success: false,
              error: 'Invalid action. Supported actions: track_usage, create_project, get_projects, get_analytics, generate_magic_link, check_connection'
            },
            HttpStatus.BAD_REQUEST
          );
      }
    } catch (error) {
      this.logger.error('ChatGPT action failed', {
        error: error instanceof Error ? error.message : String(error),
        action,
        duration: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          error: 'Failed to execute ChatGPT action',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}