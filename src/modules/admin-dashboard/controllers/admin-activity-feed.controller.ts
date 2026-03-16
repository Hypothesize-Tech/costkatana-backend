import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
  Sse,
  MessageEvent,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminActivityFeedService } from '../services/admin-activity-feed.service';
import {
  ActivityFeedQueryDto,
  ActivityFeedFiltersDto,
} from '../dto/activity-feed-query.dto';
import { Observable, map } from 'rxjs';

@Controller('api/admin/analytics/activity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminActivityFeedController {
  private readonly logger = new Logger(AdminActivityFeedController.name);

  constructor(
    private readonly adminActivityFeedService: AdminActivityFeedService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get recent activity events
   * GET /api/admin/analytics/activity/recent
   */
  @Get('recent')
  async getRecentActivity(
    @Query() query: ActivityFeedQueryDto,
    @Req() req: any,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getRecentActivity', req);

      const limit = query.limit ?? 50;
      const filters = {
        userId: query.userId,
        projectId: query.projectId,
        service: query.service,
        model: query.model,
        errorType: query.errorType,
        types: query.types as
          | (
              | 'request'
              | 'error'
              | 'high_cost'
              | 'budget_warning'
              | 'anomaly'
              | 'user_action'
            )[]
          | undefined,
        severities: query.severity
          ? [query.severity as 'low' | 'medium' | 'high' | 'critical']
          : undefined,
      };

      const events = await this.adminActivityFeedService.getRecentEvents(
        limit,
        filters,
      );

      this.controllerHelper.logRequestSuccess(
        'getRecentActivity',
        req,
        startTime,
        {
          count: events.length,
        },
      );

      return {
        success: true,
        data: events,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getRecentActivity',
        error,
        req,
        startTime,
      );
    }
  }

  /**
   * Initialize SSE connection for admin activity feed
   * GET /api/admin/analytics/activity/feed
   */
  @Sse('feed')
  initializeActivityFeed(
    @Query() query: ActivityFeedFiltersDto,
    @CurrentUser() currentUser: any,
  ): Observable<MessageEvent> {
    const startTime = Date.now();
    const reqContext = { user: currentUser };

    try {
      this.controllerHelper.logRequestStart(
        'initializeActivityFeed',
        reqContext,
      );

      const adminId =
        currentUser?.id ?? currentUser?._id?.toString() ?? 'unknown';
      const filters = {
        userId: query.userId,
        service: query.service,
        model: query.model,
        errorType: query.errorType,
        types: query.types,
        severities: query.severities,
      };

      const feedObservable = this.adminActivityFeedService.initializeAdminFeed(
        adminId,
        filters,
      );

      this.controllerHelper.logRequestSuccess(
        'initializeActivityFeed',
        reqContext,
        startTime,
        { adminUserId: adminId },
      );

      return feedObservable.pipe(
        map((data) => ({
          type: 'message',
          data: JSON.stringify(data),
        })),
      );
    } catch (error: any) {
      this.controllerHelper.handleError(
        'initializeActivityFeed',
        error,
        reqContext,
        startTime,
      );
      return new Observable<MessageEvent>((sub) => {
        sub.next({
          type: 'message',
          data: JSON.stringify({
            type: 'error',
            message: error?.message ?? 'Failed to initialize feed',
          }),
        });
        sub.complete();
      });
    }
  }
}
