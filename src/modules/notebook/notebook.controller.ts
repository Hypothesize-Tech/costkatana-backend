import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotebookService } from './services/notebook.service';
import { AIInsightsService } from './services/ai-insights.service';
import { AIRateLimitGuard } from './guards/ai-rate-limit.guard';
import { CreateNotebookDto } from './dto/create-notebook.dto';
import { UpdateNotebookDto } from './dto/update-notebook.dto';
import { NotebookQueryDto } from './dto/notebook-query.dto';
import { ExecuteNotebookDto } from './dto/execute-notebook.dto';
import { InsightsQueryDto } from './dto/insights-query.dto';

@Controller('api/notebooks')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class NotebookController {
  constructor(
    private readonly notebookService: NotebookService,
    private readonly aiInsightsService: AIInsightsService,
  ) {}

  // Notebook CRUD endpoints - declare specific routes BEFORE :id to avoid CastError

  /**
   * GET /api/notebooks/notebooks
   * List notebooks (frontend-compatible path)
   */
  @Get('notebooks')
  @HttpCode(HttpStatus.OK)
  async getNotebooksList(
    @CurrentUser() user: any,
    @Query() query: NotebookQueryDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const result = await this.notebookService.listNotebooks(userId, {
      status: query.status,
      template_type: query.template_type,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
    });

    return {
      success: true,
      data: result.notebooks,
      notebooks: result.notebooks,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: result.total > (query.offset || 0) + (query.limit || 20),
      },
    };
  }

  /**
   * GET /api/notebooks/notebooks/templates
   * Get templates (frontend-compatible path)
   */
  @Get('notebooks/templates')
  @HttpCode(HttpStatus.OK)
  async getTemplatesList() {
    const templates = await this.notebookService.getTemplates();
    return {
      success: true,
      data: templates,
      templates,
    };
  }

  /**
   * GET /api/notebooks/executions/:executionId
   * Get execution by ID - must be before :id to avoid matching "executions" as id
   */
  @Get('executions/:executionId')
  @HttpCode(HttpStatus.OK)
  async getExecution(
    @CurrentUser() user: any,
    @Param('executionId') executionId: string,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const execution = await this.notebookService.getExecution(
      userId,
      executionId,
    );
    return {
      success: true,
      data: execution,
      execution,
    };
  }

  /**
   * GET /api/notebooks/templates
   * Get templates - must be before :id to avoid matching "templates" as id
   */
  @Get('templates')
  @HttpCode(HttpStatus.OK)
  async getTemplates() {
    const templates = await this.notebookService.getTemplates();
    return {
      success: true,
      data: templates,
    };
  }

  /**
   * GET /api/notebooks
   * List notebooks at root (backward compatibility)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getNotebooks(
    @CurrentUser() user: any,
    @Query() query: NotebookQueryDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const result = await this.notebookService.listNotebooks(userId, {
      status: query.status,
      template_type: query.template_type,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      sort_by: query.sort_by,
      sort_order: query.sort_order,
    });

    return {
      success: true,
      data: result.notebooks,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: result.total > (query.offset || 0) + (query.limit || 20),
      },
    };
  }

  /**
   * GET /api/notebooks/notebooks/:id
   * Get single notebook (frontend-compatible path)
   */
  @Get('notebooks/:id')
  @HttpCode(HttpStatus.OK)
  async getNotebookById(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const notebook = await this.notebookService.getNotebook(
      userId,
      notebookId,
    );
    return {
      success: true,
      data: notebook,
      notebook,
    };
  }

  /**
   * GET /api/notebooks/:id
   * Get single notebook by ID (backward compatibility)
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getNotebook(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const notebook = await this.notebookService.getNotebook(
      userId,
      notebookId,
    );

    return {
      success: true,
      data: notebook,
    };
  }

  /**
   * POST /api/notebooks/notebooks
   * Create notebook (frontend-compatible path)
   */
  @Post('notebooks')
  @HttpCode(HttpStatus.CREATED)
  async createNotebookList(
    @CurrentUser() user: any,
    @Body() createDto: CreateNotebookDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const notebook = await this.notebookService.createNotebook(
      userId,
      createDto,
    );
    return {
      success: true,
      data: notebook,
      notebook,
      message: 'Notebook created successfully',
    };
  }

  /**
   * PUT /api/notebooks/notebooks/:id
   * Update notebook (frontend-compatible path)
   */
  @Put('notebooks/:id')
  @HttpCode(HttpStatus.OK)
  async updateNotebookById(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
    @Body() updateDto: UpdateNotebookDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const notebook = await this.notebookService.updateNotebook(
      userId,
      notebookId,
      updateDto,
    );
    return {
      success: true,
      data: notebook,
      notebook,
      message: 'Notebook updated successfully',
    };
  }

  /**
   * DELETE /api/notebooks/notebooks/:id
   * Delete notebook (frontend-compatible path)
   */
  @Delete('notebooks/:id')
  @HttpCode(HttpStatus.OK)
  async deleteNotebookById(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    await this.notebookService.deleteNotebook(userId, notebookId);
    return {
      success: true,
      message: 'Notebook deleted successfully',
    };
  }

  /**
   * POST /api/notebooks/notebooks/:id/execute
   * Execute notebook (frontend-compatible path)
   */
  @Post('notebooks/:id/execute')
  @UseGuards(AIRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async executeNotebookById(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
    @Body() executeDto: ExecuteNotebookDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const result = await this.notebookService.executeNotebook(
      userId,
      notebookId,
      {
        async: executeDto?.async,
        skip_cache: executeDto?.skip_cache,
        enable_debug: executeDto?.enable_debug,
      },
    );
    return {
      success: true,
      data: result,
      execution: result,
      message: `Notebook execution ${result.status}`,
    };
  }

  /**
   * POST /api/notebooks
   * Create new notebook (backward compatibility)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNotebook(
    @CurrentUser() user: any,
    @Body() createDto: CreateNotebookDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const notebook = await this.notebookService.createNotebook(
      userId,
      createDto,
    );

    return {
      success: true,
      data: notebook,
      message: 'Notebook created successfully',
    };
  }

  /**
   * PUT /api/notebooks/:id
   * Update notebook (backward compatibility)
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateNotebook(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
    @Body() updateDto: UpdateNotebookDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const notebook = await this.notebookService.updateNotebook(
      userId,
      notebookId,
      updateDto,
    );

    return {
      success: true,
      data: notebook,
      message: 'Notebook updated successfully',
    };
  }

  /**
   * DELETE /api/notebooks/:id
   * Delete notebook (backward compatibility)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteNotebook(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    await this.notebookService.deleteNotebook(userId, notebookId);

    return {
      success: true,
      message: 'Notebook deleted successfully',
    };
  }

  /**
   * POST /api/notebooks/:id/execute
   * Execute notebook (backward compatibility)
   */
  @Post(':id/execute')
  @UseGuards(AIRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async executeNotebook(
    @CurrentUser() user: any,
    @Param('id') notebookId: string,
    @Body() executeDto: ExecuteNotebookDto,
  ) {
    const userId = user._id?.toString() || user.id?.toString();
    const result = await this.notebookService.executeNotebook(
      userId,
      notebookId,
      {
        async: executeDto.async,
        skip_cache: executeDto.skip_cache,
        enable_debug: executeDto.enable_debug,
      },
    );

    return {
      success: true,
      data: result,
      message: `Notebook execution ${result.status}`,
    };
  }

  // AI Insights endpoints (4 endpoints - all with AI rate limiting)

  /**
   * GET /api/insights
   * Get comprehensive AI insights
   */
  @Get('/insights')
  @UseGuards(AIRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async getAIInsights(@Query() query: InsightsQueryDto) {
    const insights = await this.aiInsightsService.generateInsights({
      timeframe: query.timeframe,
      focus_area: query.focus_area,
    });

    return {
      success: true,
      data: insights,
    };
  }

  /**
   * GET /api/insights/anomalies
   * Get anomaly detection results
   */
  @Get('/insights/anomalies')
  @UseGuards(AIRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async getAnomalies(@Query() query: InsightsQueryDto) {
    const insights = await this.aiInsightsService.generateInsights({
      timeframe: query.timeframe,
      focus_area: 'errors', // Focus on errors for anomalies
    });

    return {
      success: true,
      data: {
        anomalies: insights.anomalies,
        summary: {
          total_anomalies: insights.anomalies.length,
          critical_issues: insights.anomalies.filter(
            (a) => a.severity === 'critical',
          ).length,
        },
      },
    };
  }

  /**
   * GET /api/insights/optimizations
   * Get cost optimization recommendations
   */
  @Get('/insights/optimizations')
  @UseGuards(AIRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async getOptimizations(@Query() query: InsightsQueryDto) {
    const insights = await this.aiInsightsService.generateInsights({
      timeframe: query.timeframe,
      focus_area: 'cost', // Focus on cost for optimizations
    });

    return {
      success: true,
      data: {
        optimizations: insights.optimizations,
        summary: {
          total_optimizations: insights.optimizations.length,
          estimated_savings: insights.summary.estimated_savings,
        },
      },
    };
  }

  /**
   * GET /api/insights/forecasts
   * Get predictive forecasts
   */
  @Get('/insights/forecasts')
  @UseGuards(AIRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async getForecasts(@Query() query: InsightsQueryDto) {
    const insights = await this.aiInsightsService.generateInsights({
      timeframe: query.timeframe,
    });

    return {
      success: true,
      data: {
        forecasts: insights.forecasts,
        summary: {
          total_forecasts: insights.forecasts.length,
          risk_level: insights.forecasts.some((f) => f.risk_level === 'high')
            ? 'high'
            : 'low',
        },
      },
    };
  }
}
