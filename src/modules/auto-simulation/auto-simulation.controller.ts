/**
 * Auto-Simulation Controller
 *
 * Handles all auto-simulation endpoints including settings management,
 * queue operations, and optimization approval.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AutoSimulationService } from './auto-simulation.service';

// DTOs
import {
  UpdateAutoSimulationSettingsDto,
  GetUserQueueQueryDto,
  HandleOptimizationApprovalDto,
  TriggerSimulationParamsDto,
  QueueItemParamsDto,
} from './dto';

// Interfaces
import {
  AutoSimulationSettingsData,
  AutoSimulationQueueItemData,
} from './interfaces/auto-simulation.interfaces';

@Controller('api/auto-simulation')
@UseGuards(JwtAuthGuard)
export class AutoSimulationController {
  private readonly logger = new Logger(AutoSimulationController.name);

  constructor(private readonly autoSimulationService: AutoSimulationService) {}

  /**
   * Get user's auto-simulation settings
   */
  @Get('settings')
  async getUserSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; data: AutoSimulationSettingsData }> {
    const userId = user.id;

    const settings = await this.autoSimulationService.getUserSettings(userId);

    // Return default settings if none exist
    const defaultSettings: AutoSimulationSettingsData = {
      userId,
      enabled: false,
      triggers: {
        costThreshold: 0.01,
        tokenThreshold: 1000,
        expensiveModels: ['gpt-4', 'claude-3-opus'],
        allCalls: false,
      },
      autoOptimize: {
        enabled: false,
        approvalRequired: true,
        maxSavingsThreshold: 0.5,
        riskTolerance: 'medium',
      },
      notifications: {
        email: true,
        dashboard: true,
        slack: false,
      },
    };

    return {
      success: true,
      data: settings || defaultSettings,
    };
  }

  /**
   * Update user's auto-simulation settings
   */
  @Put('settings')
  async updateUserSettings(
    @Body() dto: UpdateAutoSimulationSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; message: string }> {
    const userId = user.id;

    // Validate settings
    if (
      dto.triggers?.costThreshold !== undefined &&
      dto.triggers.costThreshold < 0
    ) {
      throw new BadRequestException('Cost threshold must be non-negative');
    }

    if (
      dto.triggers?.tokenThreshold !== undefined &&
      dto.triggers.tokenThreshold < 0
    ) {
      throw new BadRequestException('Token threshold must be non-negative');
    }

    if (
      dto.autoOptimize?.maxSavingsThreshold !== undefined &&
      (dto.autoOptimize.maxSavingsThreshold < 0 ||
        dto.autoOptimize.maxSavingsThreshold > 1)
    ) {
      throw new BadRequestException(
        'Max savings threshold must be between 0 and 1',
      );
    }

    await this.autoSimulationService.updateUserSettings(userId, dto);

    this.logger.log(`Updated auto-simulation settings for user: ${userId}`);

    return {
      success: true,
      message: 'Settings updated successfully',
    };
  }

  /**
   * Get user's simulation queue
   */
  @Get('queue')
  async getUserQueue(
    @Query() query: GetUserQueueQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; data: AutoSimulationQueueItemData[] }> {
    const userId = user.id;

    const queue = await this.autoSimulationService.getUserQueue(
      userId,
      query.status,
      query.limit,
    );

    return {
      success: true,
      data: queue,
    };
  }

  /**
   * Handle optimization approval/rejection
   */
  @Post('queue/:queueItemId/approve')
  async handleOptimizationApproval(
    @Param() params: QueueItemParamsDto,
    @Body() dto: HandleOptimizationApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; message: string }> {
    const { queueItemId } = params;
    const { approved, selectedOptimizations } = dto;

    if (!Types.ObjectId.isValid(queueItemId)) {
      throw new BadRequestException('Invalid queue item ID format');
    }

    await this.autoSimulationService.handleOptimizationApproval(
      queueItemId,
      approved,
      selectedOptimizations,
    );

    this.logger.log(
      `${approved ? 'Approved' : 'Rejected'} optimization for queue item: ${queueItemId}`,
    );

    return {
      success: true,
      message: approved ? 'Optimization approved' : 'Optimization rejected',
    };
  }

  /**
   * Manually trigger simulation for a usage
   */
  @Post('trigger/:usageId')
  async triggerSimulation(
    @Param() params: TriggerSimulationParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    success: boolean;
    message: string;
    data: { queueItemId: string };
  }> {
    const { usageId } = params;

    if (!Types.ObjectId.isValid(usageId)) {
      throw new BadRequestException('Invalid usage ID format');
    }

    const queueItemId =
      await this.autoSimulationService.queueForSimulation(usageId);

    if (!queueItemId) {
      throw new BadRequestException(
        'Failed to queue simulation - usage not found',
      );
    }

    this.logger.log(
      `Manually triggered simulation for usage: ${usageId}, queue item: ${queueItemId}`,
    );

    return {
      success: true,
      message: 'Simulation queued successfully',
      data: { queueItemId },
    };
  }

  /**
   * Process queue manually (admin endpoint)
   */
  @Post('process-queue')
  async processQueue(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; message: string }> {
    // Note: Could be restricted to admin users in the future
    await this.autoSimulationService.processQueue();

    this.logger.log(`Manual queue processing initiated by user: ${user.id}`);

    return {
      success: true,
      message: 'Queue processing initiated',
    };
  }
}
