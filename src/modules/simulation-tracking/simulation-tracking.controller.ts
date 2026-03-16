import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { SimulationTrackingService } from './simulation-tracking.service';
import {
  TrackSimulationDto,
  TrackOptimizationApplicationDto,
  UpdateViewingMetricsDto,
  SimulationStatsQueryDto,
  LeaderboardQueryDto,
  HistoryQueryDto,
} from './dto';

@Controller('api/simulation-tracking')
@UseGuards(JwtAuthGuard)
export class SimulationTrackingController {
  private readonly logger = new Logger(SimulationTrackingController.name);

  constructor(
    private readonly simulationTrackingService: SimulationTrackingService,
  ) {}

  @Post('track')
  async trackSimulation(
    @Body() dto: TrackSimulationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const userId = user.id;
    if (this.simulationTrackingService.isCircuitBreakerOpen()) {
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again later.',
      );
    }

    const trackingId = await this.simulationTrackingService.trackSimulation({
      userId,
      sessionId: dto.sessionId,
      originalUsageId: dto.originalUsageId,
      simulationType: dto.simulationType,
      originalModel: dto.originalModel,
      originalPrompt: dto.originalPrompt,
      originalCost: dto.originalCost,
      originalTokens: dto.originalTokens,
      parameters: dto.parameters,
      optimizationOptions: dto.optimizationOptions ?? [],
      recommendations: dto.recommendations ?? [],
      potentialSavings: dto.potentialSavings,
      confidence: dto.confidence,
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip,
      projectId: dto.projectId,
    });

    this.logger.log(`Simulation tracked for user ${userId}`, {
      trackingId,
      simulationType: dto.simulationType,
    });

    return {
      success: true,
      message: 'Simulation tracked successfully',
      data: { trackingId },
    };
  }

  @Post(':trackingId/apply')
  async trackOptimizationApplication(
    @Param('trackingId') trackingId: string,
    @Body() dto: TrackOptimizationApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Types.ObjectId.isValid(trackingId)) {
      throw new BadRequestException('Invalid trackingId format');
    }
    await this.simulationTrackingService.trackOptimizationApplication(
      trackingId,
      {
        optionIndex: dto.optionIndex,
        type: dto.type,
        estimatedSavings: dto.estimatedSavings,
        userFeedback: dto.userFeedback,
      },
    );
    this.logger.log(`Optimization application tracked: ${trackingId}`);
    return {
      success: true,
      message: 'Optimization application tracked successfully',
    };
  }

  @Put(':trackingId/metrics')
  async updateViewingMetrics(
    @Param('trackingId') trackingId: string,
    @Body() dto: UpdateViewingMetricsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Types.ObjectId.isValid(trackingId)) {
      throw new BadRequestException('Invalid trackingId format');
    }
    await this.simulationTrackingService.updateViewingMetrics(
      trackingId,
      dto.timeSpent,
      dto.optionsViewed ?? [],
    );
    return {
      success: true,
      message: 'Viewing metrics updated successfully',
    };
  }

  @Get('stats')
  async getSimulationStats(
    @Query() query: SimulationStatsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = query.global === true ? undefined : user.id;
    const timeRange =
      query.startDate && query.endDate
        ? {
            startDate: new Date(query.startDate),
            endDate: new Date(query.endDate),
          }
        : undefined;

    const stats = await this.simulationTrackingService.getSimulationStats(
      userId,
      timeRange,
    );
    return { success: true, data: stats };
  }

  @Get('leaderboard')
  async getTopOptimizationWins(
    @Query() query: LeaderboardQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const timeRange =
      query.startDate && query.endDate
        ? {
            startDate: new Date(query.startDate),
            endDate: new Date(query.endDate),
          }
        : undefined;
    const limit = query.limit ?? 10;
    const wins = await this.simulationTrackingService.getTopOptimizationWins(
      timeRange,
      limit,
    );
    return { success: true, data: wins };
  }

  @Get('history')
  async getUserSimulationHistory(
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const history =
      await this.simulationTrackingService.getUserSimulationHistory(
        userId,
        limit,
        offset,
      );
    return { success: true, data: history };
  }
}
