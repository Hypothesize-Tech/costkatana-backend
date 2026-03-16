import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModerationService } from './moderation.service';
import { ModerationAnalyticsQueryDto } from './dto/moderation-analytics-query.dto';
import { ModerationThreatsQueryDto } from './dto/moderation-threats-query.dto';
import { UpdateModerationConfigDto } from './dto/update-moderation-config.dto';
import { AppealModerationDto } from './dto/appeal-moderation.dto';

@Controller('api/moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  /**
   * GET /api/moderation/analytics
   * Get comprehensive moderation analytics.
   */
  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  async getModerationAnalytics(
    @CurrentUser() user: { id?: string; _id?: string },
    @Query() query: ModerationAnalyticsQueryDto,
  ): Promise<{ success: boolean; data: unknown; metadata?: unknown }> {
    const userId = user?._id ?? user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const result = await this.moderationService.getModerationAnalytics(
      String(userId),
      query,
    );
    return {
      success: true,
      data: result.data,
      metadata: result.metadata,
    };
  }

  /**
   * GET /api/moderation/threats
   * Get moderation threat samples for audit.
   */
  @Get('threats')
  @HttpCode(HttpStatus.OK)
  async getModerationThreats(
    @CurrentUser() user: { id?: string; _id?: string },
    @Query() query: ModerationThreatsQueryDto,
  ): Promise<{ success: boolean; data: unknown }> {
    const userId = user?._id ?? user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const result = await this.moderationService.getModerationThreats(
      String(userId),
      query,
    );
    return {
      success: true,
      data: result.data,
    };
  }

  /**
   * GET /api/moderation/config
   * Get moderation configuration.
   */
  @Get('config')
  @HttpCode(HttpStatus.OK)
  async getModerationConfig(
    @CurrentUser() user: { id?: string; _id?: string },
  ) {
    const userId = user?._id ?? user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const result = await this.moderationService.getModerationConfig(
      String(userId),
    );
    return {
      success: true,
      data: result.data,
    };
  }

  /**
   * PUT /api/moderation/config
   * Update moderation configuration.
   */
  @Put('config')
  @HttpCode(HttpStatus.OK)
  async updateModerationConfig(
    @CurrentUser() user: { id?: string; _id?: string },
    @Body() body: UpdateModerationConfigDto,
  ) {
    const userId = user?._id ?? user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const result = await this.moderationService.updateModerationConfig(
      String(userId),
      body,
    );
    return {
      success: true,
      message: result.message,
      data: result.data,
    };
  }

  /**
   * POST /api/moderation/appeal
   * Appeal a moderation decision.
   */
  @Post('appeal')
  @HttpCode(HttpStatus.OK)
  async appealModerationDecision(
    @CurrentUser() user: { id?: string; _id?: string },
    @Body() body: AppealModerationDto,
  ) {
    const userId = user?._id ?? user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const result = await this.moderationService.appealModerationDecision(
      String(userId),
      body,
    );
    return {
      success: true,
      message: result.message,
      data: result.data,
    };
  }
}
