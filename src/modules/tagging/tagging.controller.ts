import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { TaggingService } from './tagging.service';
import {
  TagAnalyticsQueryDto,
  BatchTagAnalyticsDto,
  CompareTagsDto,
  CreateTagHierarchyDto,
  CreateCostAllocationRuleDto,
  TagSuggestionsQueryDto,
  RealtimeQueryDto,
  TagBreakdownQueryDto,
} from './dto';

const ANALYTICS_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 10_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
}

@Controller('api/tags')
@UseGuards(JwtAuthGuard)
export class TaggingController {
  private readonly logger = new Logger(TaggingController.name);

  constructor(private readonly taggingService: TaggingService) {}

  @Get('analytics')
  async getTagAnalytics(
    @Query() query: TagAnalyticsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    if (this.taggingService.isCircuitBreakerOpen()) {
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again later.',
      );
    }

    const options = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      tagFilter: query.tagFilter
        ? query.tagFilter
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      includeHierarchy: query.includeHierarchy ?? true,
      includeRealTime: query.includeRealTime ?? true,
    };

    try {
      const analytics = await withTimeout(
        this.taggingService.getTagAnalytics(userId, options),
        ANALYTICS_TIMEOUT_MS,
        'Request timeout',
      );
      const totalCost = analytics.reduce((sum, t) => sum + t.totalCost, 0);
      const totalCalls = analytics.reduce((sum, t) => sum + t.totalCalls, 0);
      this.logger.log(`Tag analytics retrieved for user ${userId}`, {
        totalTags: analytics.length,
        totalCost,
        totalCalls,
      });
      return {
        success: true,
        data: analytics,
        metadata: {
          totalTags: analytics.length,
          totalCost,
          totalCalls,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Request timeout') {
        throw new HttpException(
          'Request timeout - analysis took too long. Please try with fewer tags or a smaller date range.',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }
      throw error;
    }
  }

  @Post('analytics/batch')
  async getBatchTagAnalytics(
    @Body() dto: BatchTagAnalyticsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const options = {
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      tagFilter: dto.tags,
      includeHierarchy: true,
      includeRealTime: true,
    };
    const analytics = await this.taggingService.getTagAnalytics(
      userId,
      options,
    );
    const totalCost = analytics.reduce((sum, t) => sum + t.totalCost, 0);
    const totalCalls = analytics.reduce((sum, t) => sum + t.totalCalls, 0);
    this.logger.log(`Batch tag analytics for user ${userId}`, {
      requestedTags: dto.tags.length,
      foundTags: analytics.length,
    });
    return {
      success: true,
      data: analytics,
      metadata: {
        requestedTags: dto.tags,
        foundTags: analytics.length,
        totalCost,
        totalCalls,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Get(':tag/breakdown')
  async getTagCostBreakdown(
    @Param('tag') tag: string,
    @Query() query: TagBreakdownQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const options = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      tagFilter: [tag],
    };
    const analytics = await this.taggingService.getTagAnalytics(
      userId,
      options,
    );
    if (analytics.length === 0) {
      throw new NotFoundException('Tag not found or no data available');
    }
    const tagData = analytics[0];
    return {
      success: true,
      data: {
        tag: tagData.tag,
        totalCost: tagData.totalCost,
        totalCalls: tagData.totalCalls,
        totalTokens: tagData.totalTokens,
        averageCost: tagData.averageCost,
        trend: tagData.trend,
        trendPercentage: tagData.trendPercentage,
        serviceBreakdown: tagData.topServices,
        modelBreakdown: tagData.topModels,
        timeSeriesData: tagData.timeSeriesData,
        lastUsed: tagData.lastUsed,
      },
      metadata: { generatedAt: new Date().toISOString() },
    };
  }

  @Post('compare')
  async compareTags(
    @Body() dto: CompareTagsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const options = {
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      tagFilter: dto.tags,
    };
    const analytics = await this.taggingService.getTagAnalytics(
      userId,
      options,
    );
    const totalCost = analytics.reduce((sum, t) => sum + t.totalCost, 0);
    const totalCalls = analytics.reduce((sum, t) => sum + t.totalCalls, 0);
    const averageCostPerTag = analytics.length
      ? totalCost / analytics.length
      : 0;
    const mostExpensive = analytics.reduce(
      (max, t) => (t.totalCost > max.totalCost ? t : max),
      analytics[0],
    );
    const mostUsed = analytics.reduce(
      (max, t) => (t.totalCalls > max.totalCalls ? t : max),
      analytics[0],
    );
    const bestTrend = analytics.reduce((best, t) => {
      if (t.trend === 'down' && t.trendPercentage < best.trendPercentage)
        return t;
      if (t.trend === 'up' && best.trend !== 'down') return t;
      return best;
    }, analytics[0]);
    return {
      success: true,
      data: {
        tags: analytics,
        summary: {
          totalCost,
          totalCalls,
          averageCostPerTag,
          mostExpensive,
          mostUsed,
          bestTrend,
        },
      },
      metadata: {
        comparedTags: dto.tags,
        foundTags: analytics.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Get('realtime')
  async getRealTimeMetrics(
    @Query() query: RealtimeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    if (this.taggingService.isCircuitBreakerOpen()) {
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again later.',
      );
    }
    const tagFilter = query.tags
      ? query.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const metrics = await withTimeout(
      this.taggingService.getRealTimeTagMetrics(userId, tagFilter),
      DEFAULT_TIMEOUT_MS,
      'Request timeout',
    );
    const totalCurrentCost = metrics.reduce((sum, m) => sum + m.currentCost, 0);
    const totalProjectedDailyCost = metrics.reduce(
      (sum, m) => sum + m.projectedDailyCost,
      0,
    );
    this.logger.log(`Real-time tag metrics for user ${userId}`, {
      totalTags: metrics.length,
      totalCurrentCost,
      totalProjectedDailyCost,
    });
    return {
      success: true,
      data: metrics,
      metadata: {
        totalTags: metrics.length,
        totalCurrentCost,
        totalProjectedDailyCost,
        lastUpdate: new Date().toISOString(),
      },
    };
  }

  @Post('hierarchy')
  async createTagHierarchy(
    @Body() dto: CreateTagHierarchyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const hierarchy = await this.taggingService.createTagHierarchy(userId, {
      name: dto.name,
      parent: dto.parent,
      color: dto.color,
      description: dto.description,
    });
    this.logger.log(`Tag hierarchy created for user ${userId}`, {
      name: dto.name,
      hierarchyId: hierarchy.id,
    });
    return {
      success: true,
      data: hierarchy,
      message: 'Tag hierarchy created successfully',
    };
  }

  @Get('suggestions')
  async getTagSuggestions(
    @Query() query: TagSuggestionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const suggestions = await this.taggingService.getTagSuggestions(userId, {
      service: query.service,
      model: query.model,
      prompt: query.prompt,
      projectId: query.projectId,
    });
    return {
      success: true,
      data: suggestions,
      metadata: {
        totalSuggestions: suggestions.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Post('allocation-rules')
  async createCostAllocationRule(
    @Body() dto: CreateCostAllocationRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const rule = await this.taggingService.createCostAllocationRule(userId, {
      name: dto.name,
      tagFilters: dto.tagFilters,
      allocationPercentage: dto.allocationPercentage,
      department: dto.department,
      team: dto.team,
      costCenter: dto.costCenter,
    });
    this.logger.log(`Cost allocation rule created for user ${userId}`, {
      name: dto.name,
      ruleId: rule.id,
    });
    return {
      success: true,
      data: rule,
      message: 'Cost allocation rule created successfully',
    };
  }
}
