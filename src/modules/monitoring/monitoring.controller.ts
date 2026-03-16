import {
  Controller,
  Post,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MonitoringService } from './monitoring.service';

@Controller('api/monitoring')
@UseGuards(JwtAuthGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  /**
   * POST /api/monitoring/analyze
   * Trigger intelligent monitoring for the current user (read permission).
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async triggerUserMonitoring(
    @CurrentUser() user: { id?: string; _id?: string },
  ) {
    const userId = user._id ?? user.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }
    return this.monitoringService.triggerUserMonitoring(String(userId));
  }

  /**
   * GET /api/monitoring/status
   * Get current usage status and predictions (read permission).
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getUserUsageStatus(@CurrentUser() user: { id?: string; _id?: string }) {
    const userId = user._id ?? user.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }
    return this.monitoringService.getUserUsageStatus(String(userId));
  }

  /**
   * GET /api/monitoring/recommendations
   * Get smart recommendations (read permission).
   */
  @Get('recommendations')
  @HttpCode(HttpStatus.OK)
  async getSmartRecommendations(
    @CurrentUser() user: { id?: string; _id?: string },
  ) {
    const userId = user._id ?? user.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }
    return this.monitoringService.getSmartRecommendations(String(userId));
  }

  /**
   * POST /api/monitoring/daily-monitoring
   * Admin-only: trigger daily monitoring for all users.
   */
  @Post('daily-monitoring')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async triggerDailyMonitoring(
    @CurrentUser() user: { id?: string; _id?: string; role?: string },
  ) {
    const userId = user._id ?? user.id ?? '';
    const userRole = user.role ?? 'user';
    if (userRole !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return this.monitoringService.triggerDailyMonitoring(
      String(userId),
      userRole,
    );
  }
}
