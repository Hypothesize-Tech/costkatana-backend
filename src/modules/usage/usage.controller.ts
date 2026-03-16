import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpStatus,
  HttpException,
  UseGuards,
  Logger,
  Sse,
  MessageEvent,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ServiceHelper } from '../../utils/serviceHelper';
import { UsageService } from './services/usage.service';
import { SessionReplayService } from './services/session-replay.service';
import { ComprehensiveTrackingService } from './services/comprehensive-tracking.service';
import { CostOptimizationEngineService } from './services/cost-optimization-engine.service';
import { RealtimeUpdateService } from './services/realtime-update.service';
import { PerformanceMonitoringService } from './services/performance-monitoring.service';
import { UserService } from '../user/user.service';

interface AuthenticatedUser {
  id: string;
  email: string;
  role?: string;
  permissions?: string[];
}

@Controller('api/usage')
export class UsageController {
  private readonly logger = new Logger(UsageController.name);

  // Background processing queue (same pattern as Express)
  private static backgroundQueue: Array<() => Promise<void>> = [];
  private static backgroundProcessor?: NodeJS.Timeout;

  constructor(
    private readonly usageService: UsageService,
    private readonly sessionReplayService: SessionReplayService,
    private readonly comprehensiveTrackingService: ComprehensiveTrackingService,
    private readonly costOptimizationEngine: CostOptimizationEngineService,
    private readonly realtimeUpdateService: RealtimeUpdateService,
    private readonly performanceMonitoringService: PerformanceMonitoringService,
    private readonly userService: UserService,
  ) {
    // Initialize background processor
    this.startBackgroundProcessor();
  }

  /**
   * Track usage - supports optional authentication (API key access)
   * POST /usage/track
   */
  @Post('track')
  @UseGuards(OptionalJwtAuthGuard)
  async trackUsage(
    @Body() body: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Response> {
    try {
      const userId = user?.id;
      this.logger.log(`Track usage request initiated`, { userId });

      const usage = await this.usageService.trackUsage({
        userId,
        ...body,
      });

      // Handle session replay if user has preferences enabled
      if (user && userId && (await this.shouldEnableSessionReplay(user))) {
        setImmediate(async () => {
          try {
            const sessionId =
              await this.sessionReplayService.getOrCreateActiveSession(userId, {
                workspaceId: body.projectId,
                metadata: { source: 'api' },
              } as any);

            await this.sessionReplayService.addReplayData({
              sessionId,
              aiInteraction: {
                model: body.model,
                prompt: body.prompt,
                response: body.completion,
                parameters: {},
                tokens: {
                  input: body.promptTokens,
                  output: body.completionTokens,
                },
                cost: usage.cost,
              },
            });
          } catch (replayError) {
            this.logger.warn(
              'Failed to record session replay data',
              replayError,
            );
          }
        });
      }

      // Queue background business event logging
      this.queueBackgroundOperation(async () => {
        // Business event logging would go here
        this.logger.debug('Business event logged', {
          usageId: usage._id,
          userId,
        });
      });

      this.logger.log(`Usage tracked successfully`, {
        usageId: usage._id,
        cost: usage.cost,
        userId,
      });

      return res.status(HttpStatus.CREATED).json({
        success: true,
        message: 'Usage tracked successfully',
        data: {
          id: usage._id,
          cost: usage.cost,
          tokens: usage.totalTokens,
          optimizationApplied: usage.optimizationApplied,
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to track usage', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to track usage',
        error: error.message,
      });
    }
  }

  /**
   * Track usage from SDK - supports API key authentication
   * POST /usage/track-sdk
   */
  @Post('track-sdk')
  @UseGuards(OptionalJwtAuthGuard)
  async trackUsageFromSDK(
    @Body() body: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    try {
      const userId = user?.id;
      if (!userId) {
        this.logger.error('No user ID found in SDK tracking request');
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'User authentication required',
        });
        return;
      }

      this.logger.log(`SDK usage tracking initiated`, { userId });

      // Extract projectId from multiple possible sources
      let projectId = body.projectId;
      if (!projectId && body.metadata?.projectId) {
        projectId = body.metadata.projectId;
      }

      const usage = await this.usageService.trackUsage({
        userId,
        service: body.service || body.provider || 'openai',
        model: body.model,
        prompt: body.prompt || '',
        completion: body.completion,
        promptTokens: body.promptTokens,
        completionTokens: body.completionTokens,
        totalTokens:
          body.totalTokens || body.promptTokens + body.completionTokens,
        cost: body.cost || body.estimatedCost,
        responseTime: body.responseTime || 0,
        metadata: {
          ...body.metadata,
          messages: body.messages,
          system: body.system,
          input: body.input,
          output: body.output,
          requestMetadata: body.requestMetadata,
          responseMetadata: body.responseMetadata,
        },
        tags: body.tags || [],
        projectId,
        workflowId: body.workflowId,
        workflowName: body.workflowName,
        workflowStep: body.workflowStep,
        workflowSequence: body.workflowSequence,
        userEmail: body.userEmail,
        customerEmail: body.customerEmail,
        errorOccurred: !!(body.error || body.errorMessage),
        errorMessage: body.errorMessage || body.error?.message,
        httpStatusCode: body.httpStatusCode,
        errorType: body.errorType,
        optimizationApplied: false,
      });

      // Handle session replay
      if (user && (await this.shouldEnableSessionReplay(user))) {
        setImmediate(async () => {
          try {
            const sessionId =
              await this.sessionReplayService.getOrCreateActiveSession(userId, {
                workspaceId: projectId,
                metadata: { source: 'sdk' },
              } as any);

            await this.sessionReplayService.addReplayData({
              sessionId,
              aiInteraction: {
                model: body.model,
                prompt: body.prompt || '',
                response: body.completion || '',
                parameters: body.requestMetadata || {},
                tokens: {
                  input: body.promptTokens,
                  output: body.completionTokens,
                },
                cost: usage.cost,
              },
            });
          } catch (replayError) {
            this.logger.warn(
              'Failed to record session replay data from SDK',
              replayError,
            );
          }
        });
      }

      this.logger.log(`SDK usage tracked successfully`, {
        usageId: usage._id,
        userId,
      });

      res.status(HttpStatus.CREATED).json({
        success: true,
        message: 'Usage tracked successfully from SDK',
        data: {
          id: usage._id,
          cost: usage.cost,
          totalTokens: usage.totalTokens,
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to track SDK usage', error);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: 'Failed to track usage',
          message: error.message || 'Internal server error',
        });
      }
    }
  }

  /**
   * Track comprehensive usage data with client-side networking details
   * POST /usage/track-comprehensive
   */
  @Post('track-comprehensive')
  @UseGuards(OptionalJwtAuthGuard)
  async trackComprehensiveUsage(
    @Body() body: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const userId = user?.id;
      if (!userId) {
        this.logger.error('No user ID found in comprehensive tracking request');
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      this.logger.log(`Comprehensive usage tracking initiated`, { userId });

      const { clientSideData, usageMetadata } = body;

      let usage;
      if (clientSideData) {
        // Process comprehensive tracking
        usage =
          await this.comprehensiveTrackingService.processComprehensiveTracking(
            clientSideData,
            body.serverSideData || {},
            { ...usageMetadata, userId },
          );
      } else {
        // Process server-side only tracking
        usage = await this.usageService.trackUsage({
          userId,
          ...usageMetadata,
        });
      }

      if (!usage) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: 'Failed to create usage record',
        });
        return;
      }

      const duration = Date.now() - startTime;

      this.logger.log(`Comprehensive usage tracked successfully`, {
        usageId: usage._id,
        hasClientData: !!clientSideData,
        duration,
        userId,
      });

      res.status(HttpStatus.CREATED).json({
        success: true,
        message: 'Comprehensive usage tracked successfully',
        data: {
          id: usage._id,
          cost: usage.cost,
          totalTokens: usage.totalTokens,
          responseTime: usage.responseTime,
          optimizationOpportunities: usage.optimizationOpportunities,
          performanceMetrics: usage.requestTracking?.performance,
        },
        metadata: {
          duration,
          trackingType: clientSideData ? 'comprehensive' : 'server_only',
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to track comprehensive usage', error);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: 'Failed to track comprehensive usage',
          message: error.message || 'Internal server error',
        });
      }
    }
  }

  /**
   * Get usage data - supports optional authentication (API key access)
   * GET /usage
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async getUsage(
    @Query() query: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    try {
      const userId = user?.id;
      this.logger.log(`Get usage request initiated`, { userId, query });

      const filters = {
        userId,
        projectId: query.projectId,
        service: query.service,
        model: query.model,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        tags: query.tags ? query.tags.split(',') : undefined,
        minCost: query.minCost,
        maxCost: query.maxCost,
        customProperties: this.extractCustomProperties(query),
        propertyExists: query.propertyExists
          ? query.propertyExists.split(',')
          : undefined,
      };

      let result;
      if (query.q) {
        // Use search functionality
        result = await this.usageService.searchUsage(
          userId!,
          query.q,
          {
            page: query.page,
            limit: query.limit,
            sort: query.sort,
            order: query.order,
          },
          query.projectId,
          filters,
        );
      } else {
        // Use regular get usage
        result = await this.usageService.getUsage(filters as any, {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
          order: query.order,
        });
      }

      this.logger.log(`Usage retrieved successfully`, {
        userId,
        resultCount: result.data.length,
        hasSearchQuery: !!query.q,
      });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        summary: result.summary,
      });
    } catch (error: any) {
      this.logger.error('Failed to get usage', error);
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      res.status(status).json({
        success: false,
        message:
          error instanceof HttpException
            ? error.message
            : 'Failed to retrieve usage data',
        error: error.message,
      });
    }
  }

  /**
   * Get usage by project - supports optional authentication
   * GET /usage/project/:projectId
   */
  @Get('project/:projectId')
  @UseGuards(OptionalJwtAuthGuard)
  async getUsageByProject(
    @Param('projectId') projectId: string,
    @Query() query: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    try {
      const userId = user?.id;
      this.logger.log(`Get usage by project initiated`, { userId, projectId });

      ServiceHelper.validateObjectId(projectId, 'projectId');

      const filters = {
        userId,
        projectId,
        service: query.service as string,
        model: query.model as string,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        tags: query.tags ? (query.tags as string).split(',') : undefined,
        minCost: query.minCost
          ? parseFloat(query.minCost as string)
          : undefined,
        maxCost: query.maxCost
          ? parseFloat(query.maxCost as string)
          : undefined,
      };

      const result = await this.usageService.getUsage(filters as any, {
        page: query.page,
        limit: query.limit,
        sort: query.sort,
        order: query.order,
      });

      this.logger.log(`Project usage retrieved successfully`, {
        userId,
        projectId,
        resultCount: result.data.length,
      });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error: any) {
      this.logger.error('Failed to get usage by project', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve project usage',
        error: error.message,
      });
    }
  }

  /**
   * Get usage statistics - supports optional authentication
   * GET /usage/stats
   */
  @Get('stats')
  @UseGuards(OptionalJwtAuthGuard)
  async getUsageStats(
    @Query() query: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    try {
      const userId = user?.id;
      const period = query.period || 'monthly';
      const projectId = query.projectId;

      this.logger.log(`Get usage stats initiated`, {
        userId,
        period,
        projectId,
      });

      const stats = await this.usageService.getUsageStats(
        userId!,
        period,
        projectId,
      );

      this.logger.log(`Usage stats retrieved successfully`, {
        userId,
        period,
        projectId,
      });

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      this.logger.error('Failed to get usage stats', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve usage statistics',
        error: error.message,
      });
    }
  }

  /**
   * Get performance metrics
   * GET /usage/performance-metrics
   */
  @Get('performance-metrics')
  @UseGuards(OptionalJwtAuthGuard)
  async getPerformanceMetrics(
    @Query() query: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    try {
      const userId = user?.id;
      this.logger.log(`Get performance metrics initiated`, { userId });

      const currentMetrics =
        await this.performanceMonitoringService.getCurrentMetrics();
      const startDate = query.startDate
        ? new Date(query.startDate)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = query.endDate ? new Date(query.endDate) : new Date();
      const interval = query.interval || 'hour';

      const historicalMetrics =
        await this.performanceMonitoringService.getHistoricalMetrics(
          startDate,
          endDate,
          interval as 'minute' | 'hour' | 'day',
        );

      const recentAlerts =
        this.performanceMonitoringService.getRecentAlerts(10);

      this.logger.log(`Performance metrics retrieved successfully`, { userId });

      res.json({
        success: true,
        data: {
          current: currentMetrics,
          historical: historicalMetrics.metrics,
          alerts: recentAlerts,
        },
        metadata: {
          userId,
          timeRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            interval,
          },
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to get performance metrics', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to get performance metrics',
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * Get optimization opportunities
   * GET /usage/optimization-opportunities
   */
  @Get('optimization-opportunities')
  @UseGuards(OptionalJwtAuthGuard)
  async getOptimizationOpportunities(
    @Query() query: any,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    try {
      const userId = user?.id;
      this.logger.log(`Get optimization opportunities initiated`, { userId });

      const limit = parseInt(query.limit) || 50;
      const startDate = query.startDate
        ? new Date(query.startDate)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = query.endDate ? new Date(query.endDate) : new Date();

      const opportunities =
        await this.costOptimizationEngine.monitorOptimizationOpportunities(
          userId!,
          {
            minSavings: 0.1,
            timeWindowHours: 24 * 7, // Last 7 days
          },
        );

      this.logger.log(`Optimization opportunities retrieved successfully`, {
        userId,
        opportunitiesCount: opportunities.opportunities.length,
      });

      res.json({
        success: true,
        data: {
          opportunities: opportunities.opportunities.slice(0, limit),
          summary: {
            totalOpportunities: opportunities.opportunities.length,
            totalPotentialSavings: opportunities.opportunities.reduce(
              (sum, opp) => sum + opp.potentialSavings,
              0,
            ),
            alerts: opportunities.alerts,
          },
        },
        metadata: {
          timeRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
          limit,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to get optimization opportunities', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to get optimization opportunities',
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * Analyze optimization opportunities
   * POST /usage/analyze-optimization
   */
  @Post('analyze-optimization')
  @UseGuards(JwtAuthGuard)
  async analyzeOptimization(
    @Body() body: { projectId?: string; startDate?: string; endDate?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { projectId, startDate, endDate } = body;
      this.logger.log(`Analyze optimization initiated`, {
        userId: user.id,
        projectId,
      });

      const timeframe =
        startDate && endDate
          ? {
              startDate: new Date(startDate),
              endDate: new Date(endDate),
            }
          : undefined;

      const report = await this.costOptimizationEngine.analyzeAndOptimize(
        user.id,
        projectId,
        timeframe,
      );

      this.logger.log(`Optimization analysis completed`, {
        userId: user.id,
        suggestionsCount: report.suggestions.length,
        potentialSavings: report.summary.totalPotentialSavings,
      });

      res.json({
        success: true,
        data: report,
        metadata: {
          userId: user.id,
          projectId,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to analyze optimization', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to analyze optimization opportunities',
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * Get optimization report
   * GET /usage/optimization-report
   */
  @Get('optimization-report')
  @UseGuards(JwtAuthGuard)
  async getOptimizationReport(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get optimization report initiated`, {
        userId: user.id,
        projectId,
      });

      const report = await this.costOptimizationEngine.analyzeAndOptimize(
        user.id,
        projectId,
      );

      this.logger.log(`Optimization report retrieved`, {
        userId: user.id,
        suggestionsCount: report.suggestions.length,
        potentialSavings: report.summary.totalPotentialSavings,
      });

      res.json({
        success: true,
        data: report,
        metadata: {
          userId: user.id,
          projectId,
          generatedAt: new Date().toISOString(),
          cacheStatus: 'fresh',
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to get optimization report', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to get optimization report',
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * Bulk upload usage data
   * POST /usage/bulk
   */
  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  @Permissions('write', 'admin')
  async bulkUploadUsage(
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Bulk upload usage initiated`, {
        userId: user.id,
        recordCount: body.usageData.length,
      });

      const usageRecords = body.usageData.map((record: any) => ({
        userId: user.id,
        ...record,
      }));

      // Process records individually to capture errors
      const results: Array<{
        index: number;
        id?: string;
        success: boolean;
        error?: string;
      }> = [];
      const errors: Array<{ index: number; record: any; error: string }> = [];
      let successful = 0;

      for (let i = 0; i < usageRecords.length; i++) {
        try {
          const savedRecord = await this.usageService.trackUsage(
            usageRecords[i],
          );
          results.push({
            index: i,
            id: savedRecord._id.toString(),
            success: true,
          });
          successful++;
        } catch (error: any) {
          const errorMessage = error.message || 'Unknown error';
          results.push({
            index: i,
            success: false,
            error: errorMessage,
          });
          errors.push({
            index: i,
            record: usageRecords[i],
            error: errorMessage,
          });

          this.logger.warn(`Failed to process usage record ${i}`, {
            userId: user.id,
            error: errorMessage,
            record: usageRecords[i],
          });
        }
      }

      const failed = errors.length;

      this.logger.log(`Bulk upload completed`, {
        userId: user.id,
        totalRecords: body.usageData.length,
        successful,
        failed,
      });

      res.json({
        success: true,
        message: `Processed ${body.usageData.length} usage records`,
        data: {
          successful,
          failed,
          results,
          errors: errors.map((err) => ({
            index: err.index,
            error: err.error,
            recordSummary: {
              model: err.record.model,
              promptTokens: err.record.promptTokens,
              completionTokens: err.record.completionTokens,
            },
          })),
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to bulk upload usage', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to bulk upload usage data',
        error: error.message,
      });
    }
  }

  /**
   * Update usage data
   * PUT /usage/:usageId
   */
  @Put(':usageId')
  @UseGuards(JwtAuthGuard)
  @Permissions('write', 'admin')
  async updateUsage(
    @Param('usageId') usageId: string,
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Update usage initiated`, { userId: user.id, usageId });

      ServiceHelper.validateObjectId(usageId, 'usageId');

      // Verify ownership
      const existingUsage = await this.usageService.getUsageById(
        usageId,
        user.id,
      );
      if (!existingUsage) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Usage record not found',
        });
        return;
      }

      const updatedUsage = await this.usageService.updateUsage(usageId, body);

      this.logger.log(`Usage updated successfully`, {
        userId: user.id,
        usageId,
      });

      res.json({
        success: true,
        message: 'Usage updated successfully',
        data: updatedUsage,
      });
    } catch (error: any) {
      this.logger.error('Failed to update usage', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to update usage',
        error: error.message,
      });
    }
  }

  /**
   * Delete usage data
   * DELETE /usage/:usageId
   */
  @Delete(':usageId')
  @UseGuards(JwtAuthGuard)
  @Permissions('admin')
  async deleteUsage(
    @Param('usageId') usageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Delete usage initiated`, { userId: user.id, usageId });

      ServiceHelper.validateObjectId(usageId, 'usageId');

      // Verify ownership
      const existingUsage = await this.usageService.getUsageById(
        usageId,
        user.id,
      );
      if (!existingUsage) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Usage record not found',
        });
        return;
      }

      const deleted = await this.usageService.deleteUsage(usageId);

      if (!deleted) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Usage record not found',
        });
        return;
      }

      this.logger.log(`Usage deleted successfully`, {
        userId: user.id,
        usageId,
      });

      res.json({
        success: true,
        message: 'Usage deleted successfully',
      });
    } catch (error: any) {
      this.logger.error('Failed to delete usage', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to delete usage',
        error: error.message,
      });
    }
  }

  /**
   * Detect anomalies
   * GET /usage/anomalies
   */
  @Get('anomalies')
  @UseGuards(JwtAuthGuard)
  async detectAnomalies(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Detect anomalies initiated`, {
        userId: user.id,
        projectId,
      });

      const result = await this.usageService.detectAnomalies(
        user.id,
        projectId,
      );

      this.logger.log(`Anomalies detected`, {
        userId: user.id,
        anomalyCount: result.anomalies.length,
      });

      res.json({
        success: true,
        data: result.anomalies,
        summary: result.summary,
      });
    } catch (error: any) {
      this.logger.error('Failed to detect anomalies', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to detect anomalies',
        error: error.message,
      });
    }
  }

  /**
   * Search usage
   * GET /usage/search
   */
  @Get('search')
  @UseGuards(JwtAuthGuard)
  async searchUsage(
    @Query() query: any,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { q, projectId, ...pagination } = query;

      if (!q) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Search query is required',
        });
        return;
      }

      this.logger.log(`Search usage initiated`, {
        userId: user.id,
        query: q,
        projectId,
      });

      const result = await this.usageService.searchUsage(
        user.id,
        q,
        pagination,
        projectId,
      );

      this.logger.log(`Usage search completed`, {
        userId: user.id,
        resultCount: result.data.length,
      });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error: any) {
      this.logger.error('Failed to search usage', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to search usage',
        error: error.message,
      });
    }
  }

  /**
   * Export usage data
   * GET /usage/export
   */
  @Get('export')
  @UseGuards(JwtAuthGuard)
  async exportUsage(
    @Query() query: any,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const format = query.format || 'json';
      this.logger.log(`Export usage initiated`, { userId: user.id, format });

      const filters = {
        userId: user.id,
        projectId: query.projectId,
        service: query.service,
        model: query.model,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
      };

      // Get all data without pagination for export
      const result = await this.usageService.getUsage(filters, {
        page: 1,
        limit: 10000, // Max export limit
        sort: 'createdAt',
        order: 'desc',
      });

      if (format === 'csv') {
        const csv = [
          'Date,Service,Model,Prompt,Tokens,Cost,Response Time,Template Name,Template Category,Template Context',
          ...result.data.map((u: any) => {
            const templateName = u.templateUsage?.templateName || '';
            const templateCategory = u.templateUsage?.templateCategory || '';
            const templateContext = u.templateUsage?.context || '';
            return `"${u.createdAt}","${u.service}","${u.model}","${u.prompt.replace(/"/g, '""')}",${u.totalTokens},${u.cost},${u.responseTime},"${templateName}","${templateCategory}","${templateContext}"`;
          }),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename=usage-export.csv',
        );
        res.send(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename=usage-export.json',
        );
        res.json(result.data);
      }

      this.logger.log(`Usage exported successfully`, {
        userId: user.id,
        format,
        recordCount: result.data.length,
      });
    } catch (error: any) {
      this.logger.error('Failed to export usage', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to export usage data',
        error: error.message,
      });
    }
  }

  /**
   * CLI-specific analytics endpoint
   * GET /usage/analytics/cli
   */
  @Get('analytics/cli')
  @UseGuards(JwtAuthGuard)
  async getCLIAnalytics(
    @Query() query: { days?: number; project?: string; user?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get CLI analytics initiated`, { userId: user.id });

      const analytics = await this.usageService.getCLIAnalytics(user.id, query);

      this.logger.log(`CLI analytics retrieved successfully`, {
        userId: user.id,
      });

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error: any) {
      this.logger.error('Failed to get CLI analytics', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve CLI analytics',
        error: error.message,
      });
    }
  }

  /**
   * Property analytics routes
   * GET /usage/properties/analytics
   */
  @Get('properties/analytics')
  @UseGuards(JwtAuthGuard)
  async getPropertyAnalytics(
    @Query()
    query: {
      groupBy: string;
      startDate?: string;
      endDate?: string;
      projectId?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { groupBy, startDate, endDate, projectId } = query;

      if (!groupBy) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'groupBy parameter is required',
        });
        return;
      }

      this.logger.log(`Get property analytics initiated`, {
        userId: user.id,
        groupBy,
      });

      const options = {
        groupBy,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        projectId,
      };

      const analytics = await this.usageService.getPropertyAnalytics(
        user.id,
        options,
      );

      this.logger.log(`Property analytics retrieved successfully`, {
        userId: user.id,
        groupBy,
        resultCount: analytics.length,
      });

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error: any) {
      this.logger.error('Failed to get property analytics', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve property analytics',
        error: error.message,
      });
    }
  }

  /**
   * Get available properties
   * GET /usage/properties/available
   */
  @Get('properties/available')
  @UseGuards(JwtAuthGuard)
  async getAvailableProperties(
    @Query()
    query: { startDate?: string; endDate?: string; projectId?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get available properties initiated`, {
        userId: user.id,
      });

      const options = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        projectId: query.projectId,
      };

      const properties = await this.usageService.getAvailableProperties(
        user.id,
        options,
      );

      this.logger.log(`Available properties retrieved successfully`, {
        userId: user.id,
        propertyCount: properties.length,
      });

      res.json({
        success: true,
        data: properties,
      });
    } catch (error: any) {
      this.logger.error('Failed to get available properties', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve available properties',
        error: error.message,
      });
    }
  }

  /**
   * Update usage properties
   * PUT /usage/:usageId/properties
   */
  @Put(':usageId/properties')
  @UseGuards(JwtAuthGuard)
  async updateUsageProperties(
    @Param('usageId') usageId: string,
    @Body() properties: Record<string, any>,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Update usage properties initiated`, {
        userId: user.id,
        usageId,
      });

      ServiceHelper.validateObjectId(usageId, 'usageId');

      if (!properties || typeof properties !== 'object') {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          message: 'Properties object is required',
        });
        return;
      }

      const updatedUsage = await this.usageService.updateUsageProperties(
        usageId,
        user.id,
        properties,
      );

      if (!updatedUsage) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: 'Usage record not found or access denied',
        });
        return;
      }

      this.logger.log(`Usage properties updated successfully`, {
        userId: user.id,
        usageId,
        propertiesCount: Object.keys(properties).length,
      });

      res.json({
        success: true,
        message: 'Usage properties updated successfully',
        data: {
          id: updatedUsage._id,
          updatedProperties: Object.keys(properties),
          metadata: updatedUsage.metadata,
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to update usage properties', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to update usage properties',
        error: error.message,
      });
    }
  }

  /**
   * SSE endpoint for real-time usage updates
   * GET /usage/stream
   */
  @Get('stream')
  @UseGuards(JwtAuthGuard)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Headers', 'Cache-Control')
  async streamUsageUpdates(
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    this.logger.log(`SSE connection established for user ${user.id}`);

    // Initialize SSE connection with Redis pub/sub support
    await this.realtimeUpdateService.initializeSSEConnection(user.id, response);
  }

  /**
   * Get usage analytics - comprehensive analytics with records and stats
   * GET /usage/analytics
  @Get('analytics')
  @UseGuards(JwtAuthGuard)
  async getUsageAnalytics(
    @Query() query: {
      timeRange?: '1h' | '24h' | '7d' | '30d';
      status?: 'all' | 'success' | 'error';
      model?: string;
      service?: string;
      projectId?: string;
      limit?: number;
    },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get usage analytics initiated`, {
        userId: user.id,
        timeRange: query.timeRange,
        model: query.model,
        service: query.service,
      });

      const analytics = await this.usageService.getUsageAnalytics(user.id, {
        timeRange: query.timeRange,
        status: query.status,
        model: query.model,
        service: query.service,
        projectId: query.projectId,
        limit: query.limit,
      });

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error: any) {
      this.logger.error('Failed to get usage analytics', error);
      const status =
        error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      res.status(status).json({
        success: false,
        message: 'Failed to retrieve usage analytics',
        error: error.message,
      });
    }
  }

  /**
   * Get single usage record by ID - requires authentication
   * GET /usage/:usageId
   */
  @Get(':usageId')
  @UseGuards(JwtAuthGuard)
  async getUsageById(
    @Param('usageId') usageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get usage by ID initiated`, {
        userId: user.id,
        usageId,
      });

      ServiceHelper.validateObjectId(usageId, 'usageId');

      const usage = await this.usageService.getUsageById(usageId, user.id);

      if (!usage) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: `Usage record with ID ${usageId} not found`,
        });
        return;
      }

      this.logger.log(`Usage retrieved successfully`, {
        userId: user.id,
        usageId,
      });

      res.json({
        success: true,
        data: usage,
      });
    } catch (error: any) {
      this.logger.error('Failed to get usage by ID', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to retrieve usage record',
        error: error.message,
      });
    }
  }

  /**
   * Get detailed network information for a specific usage record
   * GET /usage/:usageId/network-details
   */
  @Get(':usageId/network-details')
  @UseGuards(JwtAuthGuard)
  async getNetworkDetails(
    @Param('usageId') usageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get network details initiated`, {
        userId: user.id,
        usageId,
      });

      ServiceHelper.validateObjectId(usageId, 'usageId');

      const usage = await this.usageService.getUsageById(usageId, user.id);

      if (!usage) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'Usage record not found',
        });
        return;
      }

      // Extract detailed network information
      const networkDetails = {
        requestTracking: usage.requestTracking,
        telemetry: {
          traceId: usage.traceId,
          traceName: usage.traceName,
          traceStep: usage.traceStep,
          traceSequence: usage.traceSequence,
        },
        performance: {
          responseTime: usage.responseTime,
          networkMetrics: usage.requestTracking?.performance,
        },
        geography: usage.requestTracking?.clientInfo?.geoLocation,
        clientInfo: usage.requestTracking?.clientInfo,
      };

      this.logger.log(`Network details retrieved successfully`, {
        userId: user.id,
        usageId,
      });

      res.json({
        success: true,
        data: networkDetails,
        metadata: {
          usageId,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to get network details', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to get network details',
        message: error.message || 'Internal server error',
      });
    }
  }

  /**
   * Get optimization suggestions for a specific usage record
   * GET /usage/:usageId/optimization-suggestions
   */
  @Get(':usageId/optimization-suggestions')
  @UseGuards(JwtAuthGuard)
  async getOptimizationSuggestions(
    @Param('usageId') usageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Get optimization suggestions initiated`, {
        userId: user.id,
        usageId,
      });

      ServiceHelper.validateObjectId(usageId, 'usageId');

      const usage = await this.usageService.getUsageById(usageId, user.id);

      if (!usage) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'Usage record not found',
        });
        return;
      }

      // Get optimization suggestions for this specific usage
      const optimizationResult =
        await this.costOptimizationEngine.getUsageOptimizations(
          usageId,
          user.id,
        );

      // Extract optimization data and generate additional suggestions
      const suggestions = {
        existing: usage.optimizationOpportunities,
        generated: optimizationResult.suggestions,
        context: {
          model: usage.model,
          service: usage.service,
          cost: usage.cost,
          tokens: usage.totalTokens,
          responseTime: usage.responseTime,
        },
      };

      this.logger.log(`Optimization suggestions retrieved successfully`, {
        userId: user.id,
        usageId,
        suggestionCount: optimizationResult.suggestions.length,
      });

      res.json({
        success: true,
        data: suggestions,
        metadata: {
          usageId,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      this.logger.error('Failed to get optimization suggestions', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to get optimization suggestions',
        message: error.message || 'Internal server error',
      });
    }
  }

  // Private helper methods

  private extractCustomProperties(query: any): Record<string, string> {
    const customProperties: Record<string, string> = {};

    Object.keys(query).forEach((key) => {
      if (key.startsWith('property.')) {
        const propertyName = key.substring(9); // Remove 'property.' prefix
        const value = query[key] as string;
        if (value && value !== '') {
          // Try to parse JSON if the value looks like JSON, otherwise use as-is
          try {
            if (value.startsWith('{') || value.startsWith('[')) {
              const parsed = JSON.parse(value);
              customProperties[propertyName] =
                typeof parsed === 'string' ? parsed : value;
            } else {
              customProperties[propertyName] = value;
            }
          } catch {
            customProperties[propertyName] = value;
          }
        }
      }
    });

    return customProperties;
  }

  private async shouldEnableSessionReplay(
    user: AuthenticatedUser,
  ): Promise<boolean> {
    try {
      // Fetch user preferences from the database
      const userProfile = await this.userService.getProfile(user.id);

      // Check if session replay is enabled in preferences
      // Default is false for security - session replay should be explicitly enabled
      return userProfile.preferences?.enableSessionReplay ?? false;
    } catch (error) {
      // If we can't fetch preferences, default to false for security
      this.logger.warn(
        `Failed to fetch user preferences for session replay check: ${error.message}`,
        {
          userId: user.id,
          error: error.message,
        },
      );
      return false;
    }
  }

  private queueBackgroundOperation(operation: () => Promise<void>): void {
    UsageController.backgroundQueue.push(operation);
  }

  private startBackgroundProcessor(): void {
    UsageController.backgroundProcessor = setInterval(async () => {
      if (UsageController.backgroundQueue.length > 0) {
        const operation = UsageController.backgroundQueue.shift();
        if (operation) {
          try {
            await operation();
          } catch (error) {
            this.logger.error('Background operation failed:', error);
          }
        }
      }
    }, 1000);
  }
}
