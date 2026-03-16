import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { TemplateAnalyticsService } from './template-analytics.service';
import { TemplateAnalyticsQueryDto } from './dto/template-analytics-query.dto';

@Controller('api/templates/analytics')
@UseGuards(JwtAuthGuard)
export class TemplateAnalyticsController {
  private readonly logger = new Logger(TemplateAnalyticsController.name);

  constructor(
    private readonly templateAnalyticsService: TemplateAnalyticsService,
  ) {}

  /**
   * Get template usage overview statistics
   */
  @Get('overview')
  async getTemplateUsageOverview(
    @Query() query: TemplateAnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      const filters: any = {};
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.startDate) filters.startDate = new Date(query.startDate);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.endDate) filters.endDate = new Date(query.endDate);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.category) filters.category = query.category;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.context) filters.context = query.context;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.templateId) filters.templateId = query.templateId;

      const stats = await this.templateAnalyticsService.getTemplateUsageStats(
        userId,
        filters,
      );

      this.logger.log(`Template usage overview retrieved for user ${userId}`, {
        duration: Date.now() - startTime,
        totalTemplatesUsed: stats.totalTemplatesUsed,
        totalUsageCount: stats.totalUsageCount,
      });

      return { success: true, data: stats };
    } catch (error) {
      this.logger.error(
        `Error getting template usage overview for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get detailed breakdown for a specific template
   */
  @Get('template/:templateId')
  async getTemplateBreakdown(
    @Param('templateId') templateId: string,
    @Query() query: TemplateAnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      if (!templateId) {
        throw new BadRequestException('Template ID is required');
      }

      const filters: any = {};
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.startDate) filters.startDate = new Date(query.startDate);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.endDate) filters.endDate = new Date(query.endDate);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.category) filters.category = query.category;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.context) filters.context = query.context;

      const breakdown =
        await this.templateAnalyticsService.getTemplateBreakdown(
          templateId,
          userId,
          filters,
        );

      this.logger.log(
        `Template breakdown retrieved for user ${userId}, template ${templateId}`,
        {
          duration: Date.now() - startTime,
          usageCount: breakdown.usageCount,
        },
      );

      return { success: true, data: breakdown };
    } catch (error) {
      this.logger.error(
        `Error getting template breakdown for user ${userId}, template ${templateId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get top templates by usage
   */
  @Get('top')
  async getTopTemplates(
    @Query() query: TemplateAnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      const period = (query.period as '24h' | '7d' | '30d' | '90d') || '30d';
      const limit = query.limit || 10;

      const topTemplates = await this.templateAnalyticsService.getTopTemplates(
        userId,
        period,
        limit,
      );

      this.logger.log(`Top templates retrieved for user ${userId}`, {
        period,
        duration: Date.now() - startTime,
        count: topTemplates.length,
      });

      return { success: true, data: topTemplates };
    } catch (error) {
      this.logger.error(
        `Error getting top templates for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get cost savings report from template usage
   */
  @Get('cost-savings')
  async getCostSavingsReport(
    @Query() query: TemplateAnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      const period = (query.period as '24h' | '7d' | '30d' | '90d') || '30d';

      const savingsReport =
        await this.templateAnalyticsService.getTemplateCostSavings(
          userId,
          period,
        );

      this.logger.log(`Cost savings report retrieved for user ${userId}`, {
        period,
        duration: Date.now() - startTime,
        totalSavings: savingsReport.totalSavings,
      });

      return { success: true, data: savingsReport };
    } catch (error) {
      this.logger.error(
        `Error getting cost savings report for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get templates by context usage
   */
  @Get('context/:context')
  async getTemplatesByContext(
    @Param('context') context: string,
    @Query() query: TemplateAnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      if (!context) {
        throw new BadRequestException('Context is required');
      }

      const validContexts = [
        'chat',
        'optimization',
        'visual-compliance',
        'workflow',
        'api',
      ];
      if (!validContexts.includes(context)) {
        throw new BadRequestException(
          `Invalid context. Must be one of: ${validContexts.join(', ')}`,
        );
      }

      const filters: any = {};
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.startDate) filters.startDate = new Date(query.startDate);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.endDate) filters.endDate = new Date(query.endDate);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (query.category) filters.category = query.category;

      const templates =
        await this.templateAnalyticsService.getTemplatesByContext(
          userId,
          context as any,
          filters,
        );

      this.logger.log(`Templates by context retrieved for user ${userId}`, {
        context,
        duration: Date.now() - startTime,
        count: templates.length,
      });

      return { success: true, data: templates };
    } catch (error) {
      this.logger.error(
        `Error getting templates by context for user ${userId}, context ${context}:`,
        error,
      );
      throw error;
    }
  }
}
