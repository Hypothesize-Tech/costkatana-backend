import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Res,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { LlmSecurityService, SecurityAnalytics } from './llm-security.service';
import { PromptFirewallService } from './prompt-firewall.service';
import { PreTransmissionFilterService } from './services/pre-transmission-filter.service';
import {
  SecurityAnalyticsQueryDto,
  UpdateFirewallConfigDto,
  TestSecurityCheckDto,
  ReviewDecisionDto,
  TopRiskyPromptsQueryDto,
  ExportReportQueryDto,
} from './dto';
import {
  UserFirewallConfig,
  UserFirewallConfigDocument,
} from '../../schemas/security/user-firewall-config.schema';

@Controller('api/security')
@UseGuards(JwtAuthGuard)
export class SecurityController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecurityController.name);

  // Background processing queue
  private backgroundQueue: Array<() => Promise<void>> = [];
  private backgroundProcessor?: NodeJS.Timeout;

  // Circuit breaker for external services
  private serviceFailureCount: number = 0;
  private readonly MAX_SERVICE_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
  private lastServiceFailureTime: number = 0;

  // Firewall configuration cache
  private configCache = new Map<string, { config: any; timestamp: number }>();
  private readonly CONFIG_CACHE_TTL = 300000; // 5 minutes

  constructor(
    private readonly llmSecurityService: LlmSecurityService,
    private readonly promptFirewallService: PromptFirewallService,
    private readonly preTransmissionFilterService: PreTransmissionFilterService,
    @InjectModel(UserFirewallConfig.name)
    private readonly userFirewallConfigModel: Model<UserFirewallConfigDocument>,
  ) {}

  onModuleInit() {
    this.startBackgroundProcessor();
  }

  onModuleDestroy() {
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = undefined;
    }

    // Process remaining queue items
    while (this.backgroundQueue.length > 0) {
      const operation = this.backgroundQueue.shift();
      if (operation) {
        operation().catch((error) => {
          this.logger.error('Cleanup operation failed:', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    // Clear caches
    this.configCache.clear();
  }

  /**
   * Get security analytics dashboard
   */
  @Get('analytics')
  async getSecurityAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SecurityAnalyticsQueryDto,
  ): Promise<{ success: boolean; data: SecurityAnalytics }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`getSecurityAnalytics started for user ${userId}`);

    let timeRange: { start: Date; end: Date } | undefined;
    if (query.startDate && query.endDate) {
      timeRange = {
        start: new Date(query.startDate),
        end: new Date(query.endDate),
      };
    }

    const analytics = await this.llmSecurityService.getSecurityAnalytics(
      userId,
      timeRange,
    );

    this.logger.log(`getSecurityAnalytics completed for user ${userId}`, {
      hasTimeRange: !!timeRange,
      duration: Date.now() - startTime,
    });

    // Queue background business event logging
    const duration = Date.now() - startTime;
    this.queueBackgroundOperation(async () => {
      this.logger.log('Security analytics retrieved', {
        event: 'security_analytics_retrieved',
        category: 'security',
        value: duration,
        userId,
        hasTimeRange: !!timeRange,
      });
    });

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Get security metrics summary
   */
  @Get('metrics')
  async getSecurityMetrics(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; data: any }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`getSecurityMetrics started for user ${userId}`);

    const metrics =
      await this.llmSecurityService.getSecurityMetricsSummary(userId);

    this.logger.log(`getSecurityMetrics completed for user ${userId}`, {
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: metrics,
    };
  }

  /**
   * Test security check manually
   */
  @Post('test')
  async testSecurityCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestSecurityCheckDto,
  ): Promise<{ success: boolean; data: any }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`testSecurityCheck started for user ${userId}`);

    // Check circuit breaker
    if (this.isServiceCircuitBreakerOpen()) {
      throw new ServiceUnavailableException({
        success: false,
        message:
          'Security service temporarily unavailable. Please try again later.',
      });
    }

    if (!dto.prompt) {
      throw new BadRequestException({
        success: false,
        message: 'Prompt is required for security testing',
      });
    }

    const testRequestId = `test-${Date.now()}`;

    // Add timeout handling for security check
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Security check timeout')), 30000);
    });

    const securityCheckPromise = this.llmSecurityService.performSecurityCheck(
      dto.prompt,
      testRequestId,
      userId,
      {
        retrievedChunks: dto.retrievedChunks,
        toolCalls: dto.toolCalls,
        provenanceSource: dto.provenanceSource,
        estimatedCost: 0.01,
      },
    );

    const securityCheck = await Promise.race([
      securityCheckPromise,
      timeoutPromise,
    ]);

    this.logger.log(`testSecurityCheck completed for user ${userId}`, {
      testRequestId,
      securityResult: securityCheck.result,
      hasHumanReview: !!securityCheck.humanReviewId,
      duration: Date.now() - startTime,
    });

    // Queue background business event logging
    const duration = Date.now() - startTime;
    this.queueBackgroundOperation(async () => {
      this.logger.log('Security check tested', {
        event: 'security_check_tested',
        category: 'security',
        value: duration,
        userId,
        testRequestId,
        securityResult: securityCheck.result,
        hasHumanReview: !!securityCheck.humanReviewId,
      });
    });

    return {
      success: true,
      data: {
        requestId: testRequestId,
        securityResult: securityCheck.result,
        humanReviewId: securityCheck.humanReviewId,
        traceCreated: !!securityCheck.traceEvent,
      },
    };
  }

  /**
   * Get pending human reviews
   */
  @Get('reviews/pending')
  async getPendingReviews(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; data: any[] }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`getPendingReviews started for user ${userId}`);

    const pendingReviews = this.llmSecurityService.getPendingReviews(userId);

    this.logger.log(`getPendingReviews completed for user ${userId}`, {
      pendingReviewsCount: Array.isArray(pendingReviews)
        ? pendingReviews.length
        : 0,
      hasPendingReviews:
        !!pendingReviews &&
        (Array.isArray(pendingReviews) ? pendingReviews.length > 0 : true),
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: pendingReviews,
    };
  }

  /**
   * Review a security request (approve/deny)
   */
  @Post('reviews/:reviewId/decision')
  async reviewSecurityRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reviewId') reviewId: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`reviewSecurityRequest started for user ${userId}`, {
      reviewId,
      decision: dto.decision,
    });

    if (!reviewId) {
      throw new BadRequestException({
        success: false,
        message: 'Review ID is required',
      });
    }

    if (!dto.decision || !['approved', 'denied'].includes(dto.decision)) {
      throw new BadRequestException({
        success: false,
        message: 'Valid decision (approved/denied) is required',
      });
    }

    if (!Types.ObjectId.isValid(reviewId)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid review ID format',
      });
    }

    const success = await this.llmSecurityService.reviewRequest(
      reviewId,
      userId,
      dto.decision,
      dto.comments,
    );

    if (!success) {
      throw new NotFoundException({
        success: false,
        message: 'Review request not found or already processed',
      });
    }

    const duration = Date.now() - startTime;
    this.logger.log(`reviewSecurityRequest completed for user ${userId}`, {
      reviewId,
      decision: dto.decision,
      hasComments: !!dto.comments,
      duration,
    });

    // Log business event
    this.logger.log('Security request reviewed', {
      event: 'security_request_reviewed',
      category: 'security',
      value: duration,
      userId,
      reviewId,
      decision: dto.decision,
      hasComments: !!dto.comments,
    });

    return {
      success: true,
      message: `Security request ${dto.decision} successfully`,
    };
  }

  /**
   * Get firewall analytics (from the original service)
   */
  @Get('firewall/analytics')
  async getFirewallAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SecurityAnalyticsQueryDto,
  ): Promise<{ success: boolean; data: any }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`getFirewallAnalytics started for user ${userId}`);

    let dateRange: { start: Date; end: Date } | undefined;
    if (query.startDate && query.endDate) {
      dateRange = {
        start: new Date(query.startDate),
        end: new Date(query.endDate),
      };
    }

    const analytics = await this.promptFirewallService.getFirewallAnalytics(
      userId,
      dateRange,
    );

    this.logger.log(`getFirewallAnalytics completed for user ${userId}`, {
      hasDateRange: !!dateRange,
      hasAnalytics: !!analytics,
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Update firewall configuration
   */
  @Put('firewall/config')
  async updateFirewallConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFirewallConfigDto,
  ): Promise<{ success: boolean; data: any }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`updateFirewallConfig started for user ${userId}`);

    const defaultConfig = this.promptFirewallService.getDefaultConfig();
    const validConfig = {
      ...defaultConfig,
      ...(dto as Partial<typeof defaultConfig>),
    };

    await this.userFirewallConfigModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          ...validConfig,
          userId: new Types.ObjectId(userId),
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    this.setCachedFirewallConfig(userId, validConfig);

    const duration = Date.now() - startTime;
    this.logger.log(`updateFirewallConfig completed for user ${userId}`, {
      hasValidConfig: !!validConfig,
      configKeys: Object.keys(validConfig || {}),
      duration,
    });

    this.logger.log('Firewall config updated', {
      event: 'firewall_config_updated',
      category: 'security',
      value: duration,
      userId,
      configKeys: Object.keys(validConfig || {}),
    });

    return {
      success: true,
      data: {
        config: validConfig,
        message: 'Firewall configuration updated successfully',
      },
    };
  }

  /**
   * Get current firewall configuration
   */
  @Get('firewall/config')
  async getFirewallConfig(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean; data: any }> {
    const startTime = Date.now();
    const userId = user.id;
    this.logger.log(`getFirewallConfig started for user ${userId}`);

    const cached = this.getCachedFirewallConfig(userId);
    if (cached) {
      return { success: true, data: cached };
    }

    const stored = await this.userFirewallConfigModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();

    const defaultConfig = this.promptFirewallService.getDefaultConfig();
    const config = stored
      ? {
          enableBasicFirewall: stored.enableBasicFirewall,
          enableAdvancedFirewall: stored.enableAdvancedFirewall,
          enableRAGSecurity: stored.enableRAGSecurity,
          enableToolSecurity: stored.enableToolSecurity,
          promptGuardThreshold: stored.promptGuardThreshold,
          openaiSafeguardThreshold: stored.openaiSafeguardThreshold,
          ragSecurityThreshold: stored.ragSecurityThreshold,
          toolSecurityThreshold: stored.toolSecurityThreshold,
          sandboxHighRisk: stored.sandboxHighRisk,
          requireHumanApproval: stored.requireHumanApproval,
        }
      : defaultConfig;

    this.setCachedFirewallConfig(userId, config);

    this.logger.log(`getFirewallConfig completed for user ${userId}`, {
      hasConfig: !!config,
      fromDb: !!stored,
      configKeys: Object.keys(config || {}),
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Get pre-transmission filter statistics
   */
  @Get('pre-transmission-filter/stats')
  async getPreTransmissionFilterStats(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    success: boolean;
    data: ReturnType<PreTransmissionFilterService['getStatistics']>;
  }> {
    const stats = this.preTransmissionFilterService.getStatistics();
    return { success: true, data: stats };
  }

  /**
   * Get recent pre-transmission filter alerts
   */
  @Get('pre-transmission-filter/alerts')
  async getPreTransmissionFilterAlerts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<{
    success: boolean;
    data: Awaited<ReturnType<PreTransmissionFilterService['getRecentAlerts']>>;
  }> {
    const limitNum = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    const alerts =
      await this.preTransmissionFilterService.getRecentAlerts(limitNum);
    return { success: true, data: alerts };
  }

  /**
   * Get top risky prompts (for security analysis)
   */
  @Get('risks/top-patterns')
  async getTopRiskyPrompts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TopRiskyPromptsQueryDto,
  ): Promise<{ success: boolean; data: any }> {
    const startTime = Date.now();
    const userId = user.id;
    const limit = query.limit || 20;
    this.logger.log(`getTopRiskyPrompts started for user ${userId}`, { limit });

    const analytics =
      await this.llmSecurityService.getSecurityAnalytics(userId);

    this.logger.log(`getTopRiskyPrompts completed for user ${userId}`, {
      limit,
      hasAnalytics: !!analytics,
      topRiskyPatternsCount: analytics?.topRiskyPatterns?.length || 0,
      topRiskySourcesCount: analytics?.topRiskySources?.length || 0,
      hasThreatDistribution: !!analytics?.threatDistribution,
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: {
        topRiskyPatterns: analytics.topRiskyPatterns.slice(0, limit),
        topRiskySources: analytics.topRiskySources.slice(0, limit),
        threatDistribution: analytics.threatDistribution,
      },
    };
  }

  /**
   * Export security report
   */
  @Get('reports/export')
  async exportSecurityReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const startTime = Date.now();
    const userId = user.id;
    const { format = 'json', startDate, endDate } = query;
    this.logger.log(`exportSecurityReport started for user ${userId}`, {
      format,
    });

    let timeRange: { start: Date; end: Date } | undefined;
    if (startDate && endDate) {
      timeRange = {
        start: new Date(startDate),
        end: new Date(endDate),
      };
    }

    // Get analytics and metrics with parallel processing and error handling
    const [analytics, metrics] = await Promise.allSettled([
      this.llmSecurityService.getSecurityAnalytics(userId, timeRange),
      this.llmSecurityService.getSecurityMetricsSummary(userId),
    ]);

    const finalAnalytics =
      analytics.status === 'fulfilled'
        ? analytics.value
        : {
            detectionRate: 0,
            topRiskyPatterns: [],
            topRiskySources: [],
            threatDistribution: {},
            containmentActions: {},
            costSaved: 0,
            timeRange: timeRange || { start: new Date(), end: new Date() },
          };

    const finalMetrics =
      metrics.status === 'fulfilled'
        ? metrics.value
        : {
            totalThreatsDetected: 0,
            totalCostSaved: 0,
            averageRiskScore: 0,
            mostCommonThreat: 'None',
            detectionTrend: 'stable' as const,
          };

    if (analytics.status === 'rejected') {
      this.logger.warn('Failed to get security analytics, using defaults', {
        userId,
        error: analytics.reason?.message || 'Unknown error',
      });
    }

    if (metrics.status === 'rejected') {
      this.logger.warn('Failed to get security metrics, using defaults', {
        userId,
        error: metrics.reason?.message || 'Unknown error',
      });
    }

    const report = {
      generatedAt: new Date(),
      timeRange: finalAnalytics.timeRange ||
        timeRange || { start: new Date(), end: new Date() },
      summary: finalMetrics,
      analytics: finalAnalytics,
      metadata: {
        userId,
        reportType: 'security_comprehensive',
        version: '1.0',
      },
    };

    if (format === 'csv') {
      // Stream CSV generation for better memory efficiency
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=security_report.csv',
      );

      // Generate CSV in chunks to avoid memory issues
      const csvContent = this.generateStreamedCSV(report);
      res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=security_report.json',
      );
      res.json(report);
    }

    const duration = Date.now() - startTime;
    this.logger.log(`exportSecurityReport completed for user ${userId}`, {
      format,
      hasTimeRange: !!timeRange,
      duration,
    });

    // Queue background business event logging
    this.queueBackgroundOperation(async () => {
      this.logger.log('Security report exported', {
        event: 'security_report_exported',
        category: 'security',
        value: duration,
        userId,
        format,
        hasTimeRange: !!timeRange,
      });
    });
  }

  /**
   * Generate streamed CSV for better memory efficiency
   */
  private generateStreamedCSV(report: any): string {
    try {
      const timestamp = new Date().toISOString();
      const summary = report?.summary || {};
      const analytics = report?.analytics || {};

      // Use array for better performance than string concatenation
      const csvRows: string[] = [
        'Metric,Value,Category,Timestamp',
        `"Total Threats Detected","${summary.totalThreatsDetected || 0}",Summary,"${timestamp}"`,
        `"Total Cost Saved","${summary.totalCostSaved || 0}",Summary,"${timestamp}"`,
        `"Average Risk Score","${summary.averageRiskScore || 0}",Summary,"${timestamp}"`,
        `"Most Common Threat","${summary.mostCommonThreat || 'None'}",Summary,"${timestamp}"`,
        `"Detection Trend","${summary.detectionTrend || 'Unknown'}",Summary,"${timestamp}"`,
        `"Detection Rate","${analytics.detectionRate || 0}",Analytics,"${timestamp}"`,
      ];

      // Process threat distribution in chunks
      if (
        analytics.threatDistribution &&
        typeof analytics.threatDistribution === 'object'
      ) {
        const entries = Object.entries(analytics.threatDistribution);
        for (let i = 0; i < entries.length; i += 100) {
          // Process in chunks of 100
          const chunk = entries.slice(i, i + 100);
          for (const [threat, count] of chunk) {
            const safeThreat = String(threat || 'unknown').replace(/"/g, '""');
            const safeCount = Number(count) || 0;
            csvRows.push(
              `"${safeThreat} Threats","${safeCount}",Threat Distribution,"${timestamp}"`,
            );
          }
        }
      }

      return csvRows.join('\n');
    } catch (error: any) {
      return 'Error,Message\n"CSV Generation Error","Failed to generate CSV report"';
    }
  }

  /**
   * Circuit breaker utilities for external services
   */
  private isServiceCircuitBreakerOpen(): boolean {
    if (this.serviceFailureCount >= this.MAX_SERVICE_FAILURES) {
      const timeSinceLastFailure = Date.now() - this.lastServiceFailureTime;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      } else {
        // Reset circuit breaker
        this.serviceFailureCount = 0;
        return false;
      }
    }
    return false;
  }

  private recordServiceFailure(): void {
    this.serviceFailureCount++;
    this.lastServiceFailureTime = Date.now();
  }

  /**
   * Background processing utilities
   */
  private queueBackgroundOperation(operation: () => Promise<void>): void {
    this.backgroundQueue.push(operation);
  }

  private startBackgroundProcessor(): void {
    this.backgroundProcessor = setInterval(async () => {
      if (this.backgroundQueue.length > 0) {
        const operation = this.backgroundQueue.shift();
        if (operation) {
          try {
            await operation();
          } catch (error) {
            this.logger.error('Background operation failed:', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }, 1000);
  }

  /**
   * Get cached firewall configuration
   */
  private getCachedFirewallConfig(userId: string): any | null {
    const cached = this.configCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.CONFIG_CACHE_TTL) {
      return cached.config;
    }
    return null;
  }

  private setCachedFirewallConfig(userId: string, config: any): void {
    this.configCache.set(userId, {
      config,
      timestamp: Date.now(),
    });
  }
}
