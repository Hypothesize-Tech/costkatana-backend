/**
 * Cortex Streaming Controller (NestJS)
 *
 * Advanced streaming API for complex LLM workflows with real-time token streaming,
 * phase tracking, and adaptive processing. Full parity with Express cortexStreaming.controller.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  UsePipes,
  ValidationPipe,
  Sse,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CortexStreamingOrchestratorService,
  CortexStreamingPhase,
  CortexStreamingConfig,
} from './services/cortex-streaming-orchestrator.service';
import { CortexStreamingLoggerService } from './services/cortex-streaming-logger.service';

interface StartStreamingDto {
  prompt: string;
  modelId?: string;
  streamingConfig?: {
    enableVocabularyOptimization?: boolean;
    enableEncodingCompression?: boolean;
    maxConcurrentTokens?: number;
    enableAdaptiveBatching?: boolean;
  };
}

interface StreamingSessionQuery {
  sessionId: string;
}

@Controller('api/cortex-streaming')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CortexStreamingController {
  constructor(
    private readonly streamingOrchestrator: CortexStreamingOrchestratorService,
    private readonly streamingLogger: CortexStreamingLoggerService,
  ) {}

  /**
   * Start a new streaming session
   * POST /api/cortex-streaming/start
   */
  @Post('start')
  async startStreaming(
    @CurrentUser() user: { id: string },
    @Body() dto: StartStreamingDto,
  ) {
    try {
      const sessionId = await this.streamingOrchestrator.startStreamingSession(
        user.id,
        dto.prompt,
        {
          modelId: dto.modelId,
          streamingConfig: dto.streamingConfig as
            | Partial<CortexStreamingConfig>
            | undefined,
        },
      );

      return {
        success: true,
        data: {
          sessionId,
          status: 'started',
          message: 'Streaming session initiated',
        },
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to start streaming session',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get streaming session status
   * GET /api/cortex-streaming/status/:sessionId
   */
  @Get('status/:sessionId')
  async getStreamingStatus(
    @CurrentUser() user: { id: string },
    @Param('sessionId') sessionId: string,
  ) {
    try {
      const status = await this.streamingOrchestrator.getStreamingStatus(
        sessionId,
        user.id,
      );

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to get streaming status',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Pause streaming session
   * POST /api/cortex-streaming/pause
   */
  @Post('pause')
  async pauseStreaming(
    @CurrentUser() user: { id: string },
    @Body() dto: StreamingSessionQuery,
  ) {
    try {
      await this.streamingOrchestrator.pauseStreaming(dto.sessionId, user.id);

      return {
        success: true,
        message: 'Streaming session paused',
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to pause streaming',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Resume streaming session
   * POST /api/cortex-streaming/resume
   */
  @Post('resume')
  async resumeStreaming(
    @CurrentUser() user: { id: string },
    @Body() dto: StreamingSessionQuery,
  ) {
    try {
      await this.streamingOrchestrator.resumeStreaming(dto.sessionId, user.id);

      return {
        success: true,
        message: 'Streaming session resumed',
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to resume streaming',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Stop streaming session
   * POST /api/cortex-streaming/stop
   */
  @Post('stop')
  async stopStreaming(
    @CurrentUser() user: { id: string },
    @Body() dto: StreamingSessionQuery,
  ) {
    try {
      const result = await this.streamingOrchestrator.stopStreaming(
        dto.sessionId,
        user.id,
      );

      return {
        success: true,
        data: result,
        message: 'Streaming session stopped',
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to stop streaming',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Stream real-time updates via SSE
   * GET /api/cortex-streaming/stream/:sessionId
   */
  @Sse('stream/:sessionId')
  async streamUpdates(
    @CurrentUser() user: { id: string },
    @Param('sessionId') sessionId: string,
  ) {
    return this.streamingOrchestrator.streamUpdates(sessionId, user.id);
  }

  /**
   * Get streaming analytics
   * GET /api/cortex-streaming/analytics
   */
  @Get('analytics')
  async getStreamingAnalytics(
    @CurrentUser() user: { id: string },
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? new Date(endDate) : undefined;
      const executionIds =
        this.streamingOrchestrator.getExecutionIdsByUserAndDate(
          user.id,
          start,
          end,
        );
      const analytics = await this.streamingLogger.getStreamingAnalytics(
        user.id,
        start,
        end,
        executionIds.length > 0 ? executionIds : undefined,
      );

      return {
        success: true,
        data: analytics,
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to get streaming analytics',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get streaming session history
   * GET /api/cortex-streaming/history
   */
  @Get('history')
  async getStreamingHistory(
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    try {
      const executionIds =
        this.streamingOrchestrator.getExecutionIdsByUserAndDate(user.id);
      const history = await this.streamingLogger.getStreamingHistory(
        user.id,
        limit || 50,
        offset || 0,
        executionIds.length > 0 ? executionIds : undefined,
      );

      return {
        success: true,
        data: history,
      };
    } catch (error) {
      throw new BadRequestException({
        success: false,
        message: 'Failed to get streaming history',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
