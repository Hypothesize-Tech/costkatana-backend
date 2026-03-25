/**
 * Optimization Controller (NestJS)
 *
 * REST API endpoints for prompt optimization with Cortex integration,
 * providing comprehensive optimization capabilities through HTTP endpoints.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// Services
import { OptimizationService } from './optimization.service';
import { OptimizationTemplateService } from './services/optimization-template.service';
import { CortexCacheService } from '../cortex/services/cortex-cache.service';

// DTOs
import { CreateOptimizationDto } from './dto/create-optimization.dto';
import { FeedbackDto } from './dto/optimization-query.dto';
import { GetOptimizationsDto } from './dto/get-optimizations.dto';

// Types
import { AuthenticatedRequest } from '../../common/interfaces/auth-request.interface';

@Controller('api/optimizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OptimizationController {
  private readonly logger = new Logger(OptimizationController.name);

  constructor(
    private readonly optimizationService: OptimizationService,
    private readonly optimizationTemplateService: OptimizationTemplateService,
    private readonly cortexCacheService: CortexCacheService,
  ) {}

  /**
   * Create optimization
   */
  @Post()
  async createOptimization(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOptimizationDto,
  ) {
    const startTime = Date.now();
    const requestSize = JSON.stringify(dto).length;

    try {
      dto.userId = String(req.user!.id);

      // Map frontend fields (useCortex, cortexConfig) to options for service
      if (dto.useCortex !== undefined) {
        dto.options = dto.options ?? {};
        dto.options.enableCortex = dto.useCortex;
      }
      if (dto.cortexConfig !== undefined) {
        dto.options = dto.options ?? {};
        dto.options.cortexConfig = dto.cortexConfig;
      }

      // Validate and map model ID
      if (dto.model) {
        dto.model = this.mapToFullModelId(dto.model);
      }

      // Create optimization with request context for network details
      const result = await this.optimizationService.createOptimization(
        dto,
        false,
        {
          req,
          startTime,
          frontendRequestTracking: dto.requestTracking,
        },
      );

      // Log activity and usage
      await this.logOptimizationActivity(
        req,
        dto,
        result,
        startTime,
        requestSize,
      );

      return {
        success: true,
        data: result,
        metadata: {
          processingTime: Date.now() - startTime,
          modelUsed: result.model,
          serviceUsed: result.service,
        },
      };
    } catch (error) {
      // Log failed attempt
      await this.logFailedOptimization(req, dto, error, startTime);

      throw new HttpException(
        {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : 'Optimization creation failed',
          error: process.env.NODE_ENV === 'development' ? error : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private mapToFullModelId(shortName: string): string {
    const modelMap: Record<string, string> = {
      // Claude 3.5 models (upgraded)
      'claude-3-haiku': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      'claude-3-5-haiku': 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      'claude-3-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',

      // Claude 4.6 and Claude 4 models — require cross-region inference profiles
      'claude-opus-4-6': 'us.anthropic.claude-opus-4-6-v1',
      'claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
      'anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6', // bare → profile
      'claude-4': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      'claude-opus-4': 'anthropic.claude-sonnet-4-5-20250929-v1:0',

      // Nova models
      'nova-pro': 'amazon.nova-pro-v1:0',
      'nova-lite': 'amazon.nova-lite-v1:0',
      'nova-micro': 'amazon.nova-micro-v1:0',
    };

    return modelMap[shortName] || shortName;
  }

  private async logOptimizationActivity(
    req: AuthenticatedRequest,
    dto: CreateOptimizationDto,
    result: any,
    startTime: number,
    requestSize: number,
  ): Promise<void> {
    try {
      const processingTime = Date.now() - startTime;
      const responseSize = JSON.stringify(result).length;

      // Log to activity service
      this.logger.log(`Optimization created: ${result.id}`, {
        userId: req.user.id,
        promptLength: dto.prompt.length,
        requestSize,
        responseSize,
        originalTokens: result.originalTokens,
        optimizedTokens: result.optimizedTokens,
        savings: result.percentageSavings,
        processingTime,
        model: result.model,
        service: result.service,
      });
    } catch (error) {
      this.logger.warn('Failed to log optimization activity', error);
    }
  }

  private async logFailedOptimization(
    req: AuthenticatedRequest,
    dto: CreateOptimizationDto,
    error: any,
    startTime: number,
  ): Promise<void> {
    try {
      const processingTime = Date.now() - startTime;

      this.logger.error(`Optimization failed for user ${req.user.id}`, {
        error: error instanceof Error ? error.message : String(error),
        promptLength: dto.prompt.length,
        processingTime,
        model: dto.model,
        service: dto.service,
      });
    } catch (logError) {
      this.logger.error('Failed to log failed optimization', logError);
    }
  }

  /**
   * Create batch optimization with request fusion
   */
  @Post('/batch')
  async createBatchOptimization(
    @Req() req: AuthenticatedRequest,
    @Body() batchDto: { optimizations: CreateOptimizationDto[] },
  ) {
    try {
      const results = await Promise.all(
        batchDto.optimizations.map((dto) =>
          this.optimizationService.createOptimization(req.user.id, dto),
        ),
      );

      return {
        success: true,
        data: results,
        summary: {
          total: results.length,
          successful: results.length,
          totalSavings: results.reduce(
            (sum, r) => sum + (r.costSavings ?? 0),
            0,
          ),
          averageReduction:
            results.length > 0
              ? results.reduce(
                  (sum, r) => sum + (r.percentageSavings ?? 0),
                  0,
                ) / results.length
              : 0,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Batch optimization failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create batch optimization with request fusion (Express parity).
   * Body: { requests: Array<{ id, prompt, timestamp, model, provider }>, enableFusion?: boolean }
   */
  @Post('/batch-fusion')
  async createBatchOptimizationFusion(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      requests: Array<{
        id: string;
        prompt: string;
        timestamp: number;
        model: string;
        provider: string;
      }>;
      enableFusion?: boolean;
    },
  ) {
    try {
      const optimizations =
        await this.optimizationService.createBatchOptimization({
          userId: req.user.id,
          requests: body.requests,
          enableFusion: body.enableFusion,
        });
      return {
        success: true,
        data: optimizations,
        total: optimizations.length,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : 'Batch fusion optimization failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Generate bulk optimizations by usage/prompt IDs (Express parity).
   * Body: { promptIds: string[], cortexEnabled?: boolean, cortexConfig?: object }
   */
  @Post('/bulk')
  async generateBulkOptimizations(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      promptIds: string[];
      cortexEnabled?: boolean;
      cortexConfig?: Record<string, unknown>;
    },
  ) {
    try {
      const result = await this.optimizationService.generateBulkOptimizations(
        req.user.id,
        body.promptIds,
        {
          cortexEnabled: body.cortexEnabled,
          cortexConfig: body.cortexConfig,
        },
      );
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message:
            error instanceof Error ? error.message : 'Bulk optimization failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Optimize conversation with context trimming
   */
  @Post('/conversation')
  async optimizeConversation(
    @Req() req: AuthenticatedRequest,
    @Body()
    conversationDto: CreateOptimizationDto & { conversationHistory: any[] },
  ) {
    try {
      // For conversation optimization, we can treat it as a special case
      // of regular optimization with conversation context
      const result = await this.optimizationService.createOptimization(
        req.user.id,
        conversationDto,
      );

      return {
        success: true,
        data: result,
        conversationOptimized: true,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Conversation optimization failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization preview (without saving)
   */
  @Post('/preview')
  async getOptimizationPreview(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOptimizationDto,
  ) {
    try {
      // Create optimization but don't save it
      const result = await this.optimizationService.createOptimization(
        req.user.id,
        dto,
        true, // preview mode
      );

      // Don't actually save to database for preview
      return {
        success: true,
        data: {
          ...result,
          preview: true,
          wouldSave: (result.tokenReduction ?? 0) > 0,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Preview generation failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimizations
   */
  @Get()
  async getOptimizations(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetOptimizationsDto,
  ) {
    try {
      const result = await this.optimizationService.getOptimizations(
        req.user.id,
        query,
      );

      const totalPages = Math.ceil(result.total / result.limit);
      return {
        success: true,
        data: result.optimizations,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages,
          /** Alias for clients expecting `pages` (matches service layer) */
          pages: totalPages,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve optimizations' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get prompts for bulk optimization
   */
  @Get('/bulk-prompts')
  async getPromptsForBulkOptimization(@Req() req: AuthenticatedRequest) {
    try {
      // Get recent prompts that could benefit from optimization
      const { optimizations } = await this.optimizationService.getOptimizations(
        req.user.id,
        {
          limit: 50,
          sort: 'createdAt',
          order: 'desc',
        },
      );

      const prompts = optimizations
        .filter((opt) => (opt.percentageSavings ?? 0) < 30) // Find under-optimized prompts
        .map((opt) => ({
          id: opt.id,
          prompt: opt.prompt,
          currentReduction: opt.percentageSavings ?? 0,
          potentialSavings: Math.max(0, 50 - (opt.percentageSavings ?? 0)), // Estimate
          model: opt.model,
          service: opt.service,
        }));

      return {
        success: true,
        data: prompts,
        total: prompts.length,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve bulk prompts' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization summary
   */
  @Get('/summary')
  async getOptimizationSummary(
    @Req() req: AuthenticatedRequest,
    @Query('timeframe') timeframe?: string,
  ) {
    try {
      const summary = await this.optimizationService.getOptimizationSummary(
        req.user.id,
        timeframe ?? '30d',
      );

      return {
        success: true,
        data: summary,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve optimization summary' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization configuration
   */
  @Get('/config')
  async getOptimizationConfig() {
    try {
      // Return configuration (could be made configurable later)
      const config = {
        defaultTargetReduction: 30,
        maxPromptLength: 10000,
        supportedServices: ['openai', 'anthropic', 'aws-bedrock', 'google-ai'],
        cortexEnabled: true,
        cortexModels: {
          encoder: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          core: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
          decoder: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        },
      };

      return {
        success: true,
        data: config,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve configuration' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update optimization configuration
   */
  @Put('/config')
  @Roles('admin') // Only admins can update config
  async updateOptimizationConfig(@Body() config: any) {
    try {
      await this.optimizationService.updateOptimizationConfig(config);

      return {
        success: true,
        message: 'Configuration updated successfully',
        data: config,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to update configuration' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization templates
   */
  @Get('/templates')
  async getOptimizationTemplates(@Query('category') category?: string) {
    try {
      let templates;

      if (category) {
        templates =
          await this.optimizationTemplateService.getTemplatesByCategory(
            category,
          );
      } else {
        templates = await this.optimizationTemplateService.getTemplates();
      }

      return {
        success: true,
        data: templates,
        total: templates.length,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve templates' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization template by ID
   */
  @Get('/templates/:id')
  async getOptimizationTemplate(@Param('id') id: string) {
    try {
      const template =
        await this.optimizationTemplateService.getTemplateById(id);

      if (!template) {
        throw new HttpException(
          { success: false, message: 'Template not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: template,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        { success: false, message: 'Failed to retrieve template' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization history by prompt hash
   */
  @Get('/history/:promptHash')
  async getOptimizationHistory(
    @Req() req: AuthenticatedRequest,
    @Param('promptHash') promptHash: string,
  ) {
    try {
      const historyData =
        await this.optimizationService.getOptimizationHistoryByPromptHash(
          req.user.id,
          promptHash,
        );

      return {
        success: true,
        data: {
          promptHash,
          optimizations: historyData.optimizations,
          totalSaved: historyData.totalSaved,
          averageReduction: historyData.averageReduction,
          mostUsedModel: historyData.mostUsedModel,
          totalOptimizations: historyData.totalOptimizations,
          timeRange: historyData.timeRange,
          modelDistribution: historyData.modelDistribution,
          trend: historyData.trend,
        },
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve optimization history' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Analyze optimization opportunities
   */
  @Get('/opportunities')
  async analyzeOpportunities(@Req() req: AuthenticatedRequest) {
    try {
      const summary = await this.optimizationService.getOptimizationSummary(
        req.user.id,
      );

      const opportunities = [];

      if (summary.cortexUsagePercentage < 50) {
        opportunities.push({
          type: 'enable_cortex',
          title: 'Enable Cortex Optimization',
          description:
            'Using Cortex can provide 40-70% better optimization results',
          potentialSavings: summary.totalCostSavings * 0.5,
          priority: 'high',
        });
      }

      if (summary.averageReduction < 20) {
        opportunities.push({
          type: 'optimize_settings',
          title: 'Adjust Optimization Settings',
          description: 'Your current settings may be too conservative',
          potentialSavings: summary.totalCostSavings * 0.3,
          priority: 'medium',
        });
      }

      return {
        success: true,
        data: opportunities,
        total: opportunities.length,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to analyze opportunities' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get single optimization
   */
  @Get('/:id')
  async getOptimization(
    @Req() req: AuthenticatedRequest,
    @Param('id') optimizationId: string,
  ) {
    try {
      const optimization = await this.optimizationService.getOptimization(
        req.user.id,
        optimizationId,
      );

      return {
        success: true,
        data: optimization,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Optimization not found'
      ) {
        throw new HttpException(
          { success: false, message: 'Optimization not found' },
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        { success: false, message: 'Failed to retrieve optimization' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Apply optimization
   */
  @Post('/:id/apply')
  async applyOptimization(
    @Req() req: AuthenticatedRequest,
    @Param('id') optimizationId: string,
  ) {
    try {
      const result = await this.optimizationService.applyOptimization(
        req.user.id,
        optimizationId,
      );

      return {
        success: true,
        data: result,
        message: 'Optimization applied successfully',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to apply optimization' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Revert optimization
   */
  @Post('/:id/revert')
  async revertOptimization(
    @Req() req: AuthenticatedRequest,
    @Param('id') optimizationId: string,
  ) {
    try {
      const result = await this.optimizationService.revertOptimization(
        req.user.id,
        optimizationId,
      );

      return {
        success: true,
        data: result,
        message: 'Optimization reverted successfully',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to revert optimization' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Provide feedback
   */
  @Post('/:id/feedback')
  async provideFeedback(
    @Req() req: AuthenticatedRequest,
    @Param('id') optimizationId: string,
    @Body() feedback: FeedbackDto,
  ) {
    try {
      const result = await this.optimizationService.recordOptimizationFeedback(
        req.user.id,
        optimizationId,
        feedback,
      );

      return {
        success: true,
        message: 'Feedback recorded successfully',
        data: {
          optimizationId,
          rating: feedback.rating,
          comment: feedback.comment,
          appliedResult: feedback.appliedResult,
          recordedAt: result.recordedAt,
          updatedOptimization: result.optimization,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to record feedback';
      throw new HttpException(
        { success: false, message: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Cortex cache management endpoints

  /**
   * Get Cortex cache stats
   */
  @Get('/cortex/cache/stats')
  async getCortexCacheStats() {
    try {
      const stats = await this.optimizationService.getCortexCacheStats();

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve cache stats' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear Cortex cache
   */
  @Delete('/cortex/cache')
  async clearCortexCache() {
    try {
      await this.optimizationService.clearCortexCache();

      return {
        success: true,
        message: 'Cortex cache cleared successfully',
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to clear cache' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get optimization network details (lazy load; must be before /:id)
   */
  @Get('/:id/network-details')
  async getOptimizationNetworkDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id') optimizationId: string,
  ) {
    try {
      const details =
        await this.optimizationService.getOptimizationNetworkDetails(
          req.user.id,
          optimizationId,
        );

      return {
        success: true,
        data: details,
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Failed to retrieve network details' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Legacy bulk optimize endpoint
   */
  @Post('/bulk-legacy')
  async bulkOptimize(@Req() req: AuthenticatedRequest, @Body() body: any) {
    try {
      const result = await this.optimizationService.bulkOptimize(
        req.user.id,
        body,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message:
            error instanceof Error ? error.message : 'Bulk optimization failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
