/**
 * Cost Streaming Controller (NestJS)
 *
 * Provides SSE endpoints for real-time cost telemetry streaming.
 * Path prefix is set at controller level: api/cost-streaming (no global prefix).
 * Production-ready implementation migrated from Express costStreaming.routes.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Req,
  HttpException,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { OptionalJwtAuthGuard } from '@/common/guards/optional-jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CostStreamingService } from './services/cost-streaming.service';
import type { CostTelemetryEvent } from './services/cost-streaming.service';
import { CostStreamingStreamQueryDto } from './dto/cost-streaming-stream-query.dto';
import { EmitTestEventDto } from './dto/emit-test-event.dto';

@Controller('api/cost-streaming')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CostStreamingController {
  private readonly logger = new Logger(CostStreamingController.name);

  constructor(private readonly costStreamingService: CostStreamingService) {}

  /**
   * SSE endpoint for cost telemetry streaming
   * GET /api/cost-streaming/stream
   * Optional auth: uses JWT user when present, else query.userId/workspaceId (Express parity).
   */
  @Get('stream')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  stream(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser | null,
    @Query() query: CostStreamingStreamQueryDto,
  ): void {
    try {
      const clientId = uuidv4();
      const userId = user?.id ?? query.userId;
      const workspaceId = user?.workspaceId ?? query.workspaceId;

      const filters: {
        eventTypes?: string[];
        minCost?: number;
        operations?: string[];
      } = {};

      if (query.eventTypes?.trim()) {
        filters.eventTypes = query.eventTypes.split(',').map((s) => s.trim());
      }
      if (query.minCost != null && !Number.isNaN(query.minCost)) {
        filters.minCost = Number(query.minCost);
      }
      if (query.operations?.trim()) {
        filters.operations = query.operations.split(',').map((s) => s.trim());
      }

      this.costStreamingService.registerClient(
        clientId,
        res,
        userId,
        workspaceId,
        Object.keys(filters).length > 0 ? filters : undefined,
      );

      this.logger.log('Cost streaming client connected', {
        clientId,
        userId,
        workspaceId,
        filters,
      });
    } catch (error) {
      this.logger.error('Failed to initiate cost streaming', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        'Failed to initiate streaming connection',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get streaming statistics
   * GET /api/cost-streaming/stats
   */
  @Get('stats')
  @Public()
  getStats(): {
    success: boolean;
    data: {
      activeClients: number;
      clientsByUser: Record<string, number>;
      clientsByWorkspace: Record<string, number>;
      bufferedEvents: number;
      oldestConnection?: string;
    };
  } {
    try {
      const stats = this.costStreamingService.getStats();

      return {
        success: true,
        data: {
          activeClients: stats.activeClients,
          clientsByUser: Object.fromEntries(stats.clientsByUser),
          clientsByWorkspace: Object.fromEntries(stats.clientsByWorkspace),
          bufferedEvents: stats.bufferedEvents,
          oldestConnection: stats.oldestConnection?.toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get streaming stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        'Failed to retrieve streaming statistics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test endpoint to emit a sample cost event
   * POST /api/cost-streaming/test-event
   */
  @Post('test-event')
  @Public()
  emitTestEvent(@Body() body: EmitTestEventDto): {
    success: boolean;
    message: string;
    event: CostTelemetryEvent;
  } {
    try {
      const eventType =
        (body.eventType as CostTelemetryEvent['eventType']) ?? 'cost_tracked';

      const event: CostTelemetryEvent = {
        eventType,
        timestamp: new Date(),
        userId: body.userId,
        workspaceId: body.workspaceId,
        data: body.data ?? {
          model: 'gpt-4',
          cost: 0.03,
          tokens: 1500,
          latency: 1200,
          operation: 'chat.completion',
        },
      };

      this.costStreamingService.emitCostEvent(event);

      return {
        success: true,
        message: 'Test event emitted',
        event,
      };
    } catch (error) {
      this.logger.error('Failed to emit test event', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        'Failed to emit test event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
