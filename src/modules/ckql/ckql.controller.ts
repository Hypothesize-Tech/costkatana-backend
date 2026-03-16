import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CKQLService } from '../notebook/services/ckql.service';
import { TelemetryVectorizationService } from './services/telemetry-vectorization.service';
import { CostNarrativesService } from './services/cost-narratives.service';
import { CkqlAiRateLimitGuard } from './guards/ckql-ai-rate-limit.guard';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { GetSuggestionsQueryDto } from './dto/get-suggestions-query.dto';
import { StartVectorizationDto } from './dto/start-vectorization.dto';
import { GetVectorizationStatusQueryDto } from './dto/get-vectorization-status-query.dto';
import { GetCostNarrativesDto } from './dto/get-cost-narratives.dto';
import { BusinessEventLoggingService } from '@/common/services/business-event-logging.service';

/**
 * CKQL API controller. Path prefix is applied here (ckql); no global API prefix.
 * All endpoints require JWT auth. AI-heavy endpoints use CkqlAiRateLimitGuard (30/min).
 */
@Controller('api/ckql')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CkqlController {
  private readonly logger = new Logger(CkqlController.name);

  constructor(
    private readonly ckqlService: CKQLService,
    private readonly telemetryVectorizationService: TelemetryVectorizationService,
    private readonly costNarrativesService: CostNarrativesService,
    private readonly businessEventLogging: BusinessEventLoggingService,
  ) {}

  /**
   * POST /ckql/query - Execute natural language query (AI rate limited).
   */
  @Post('query')
  @UseGuards(CkqlAiRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async executeQuery(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ExecuteQueryDto,
  ) {
    const startTime = Date.now();
    this.logger.log('CKQL query execution initiated', {
      queryLength: dto.query?.length ?? 0,
      tenantId: dto.tenant_id,
      workspaceId: dto.workspace_id,
      userId: user.id,
    });

    const ckqlQuery = await this.ckqlService.parseQuery(dto.query, {
      tenant_id: dto.tenant_id,
      workspace_id: dto.workspace_id,
      timeframe: dto.timeframe,
    });

    const result = await this.ckqlService.executeQuery(ckqlQuery, {
      limit: dto.limit ?? 50,
      offset: dto.offset ?? 0,
    });

    const executionTime = Date.now() - startTime;
    this.businessEventLogging.logBusiness({
      event: 'ckql_query_executed',
      category: 'ckql_operations',
      value: executionTime,
      metadata: {
        queryLength: dto.query.length,
        tenantId: dto.tenant_id,
        workspaceId: dto.workspace_id,
        executionTime: result.executionTime,
        totalCount: result.totalCount,
        resultsCount: result.results?.length ?? 0,
        hasInsights: !!result.insights,
        userId: user.id,
      },
    });

    return {
      success: true,
      query: result.query.naturalLanguage,
      explanation: result.query.explanation,
      results: result.results,
      total_count: result.totalCount,
      execution_time_ms: result.executionTime,
      insights: result.insights,
      suggested_filters: result.query.suggestedFilters,
    };
  }

  /**
   * GET /ckql/suggestions - Query suggestions based on partial input.
   */
  @Get('suggestions')
  async getSuggestions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetSuggestionsQueryDto,
  ) {
    const startTime = Date.now();
    const suggestions = this.generateSuggestions(query.partial_query);

    this.businessEventLogging.logBusiness({
      event: 'ckql_suggestions_generated',
      category: 'ckql_operations',
      value: Date.now() - startTime,
      metadata: {
        partialQuery: query.partial_query,
        partialQueryLength: query.partial_query.length,
        suggestionsCount: suggestions.length,
        userId: user.id,
      },
    });

    return { success: true, suggestions };
  }

  /**
   * GET /ckql/examples - Example queries by category.
   */
  @Get('examples')
  async getExampleQueries(@CurrentUser() user: AuthenticatedUser) {
    const startTime = Date.now();
    const examples = [
      {
        category: 'Cost Analysis',
        queries: [
          'What are my most expensive AI operations today?',
          'Show me operations that cost more than $0.01',
          'Which models are driving up my costs?',
          'Find expensive operations in the last hour',
        ],
      },
      {
        category: 'Performance Analysis',
        queries: [
          'What operations are taking longer than 5 seconds?',
          'Show me the slowest requests today',
          'Find performance bottlenecks in my API',
          'Which operations have high latency?',
        ],
      },
      {
        category: 'Error Investigation',
        queries: [
          'What errors occurred in the last hour?',
          'Show me failed AI model calls',
          'Find operations with high error rates',
          "What's causing authentication failures?",
        ],
      },
      {
        category: 'Usage Patterns',
        queries: [
          'How many requests per minute am I getting?',
          'What are my peak usage hours?',
          'Show me usage by service',
          'Find unusual traffic patterns',
        ],
      },
      {
        category: 'Semantic Search',
        queries: [
          'Find operations similar to high-cost AI calls',
          "Show me patterns like yesterday's spike",
          'What operations behave like this trace?',
          'Find anomalies in my cost patterns',
        ],
      },
    ];

    const totalQueriesCount = examples.reduce(
      (s, c) => s + c.queries.length,
      0,
    );
    this.businessEventLogging.logBusiness({
      event: 'example_queries_retrieved',
      category: 'ckql_operations',
      value: Date.now() - startTime,
      metadata: {
        categoriesCount: examples.length,
        totalQueriesCount,
        userId: user.id,
      },
    });

    return { success: true, examples };
  }

  /**
   * POST /ckql/vectorization/start - Start telemetry vectorization job.
   */
  @Post('vectorization/start')
  @HttpCode(HttpStatus.OK)
  async startVectorization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartVectorizationDto,
  ) {
    const startTime = Date.now();
    this.logger.log('Telemetry vectorization initiated', {
      timeframe: dto.timeframe,
      tenantId: dto.tenant_id,
      workspaceId: dto.workspace_id,
      userId: user.id,
    });

    const job = await this.telemetryVectorizationService.startVectorization({
      timeframe: dto.timeframe,
      tenant_id: dto.tenant_id,
      workspace_id: dto.workspace_id,
      forceReprocess: dto.force_reprocess,
    });

    this.businessEventLogging.logBusiness({
      event: 'telemetry_vectorization_started',
      category: 'ckql_operations',
      value: Date.now() - startTime,
      metadata: {
        timeframe: dto.timeframe,
        tenantId: dto.tenant_id,
        workspaceId: dto.workspace_id,
        forceReprocess: dto.force_reprocess,
        jobId: job.id,
        jobStatus: job.status,
        userId: user.id,
      },
    });

    return { success: true, job };
  }

  /**
   * GET /ckql/vectorization/status - Current job and vectorization stats.
   */
  @Get('vectorization/status')
  async getVectorizationStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetVectorizationStatusQueryDto,
  ) {
    const startTime = Date.now();
    const job = await this.telemetryVectorizationService.getJobStatus();
    const stats =
      await this.telemetryVectorizationService.getVectorizationStats({
        tenant_id: query.tenant_id,
        workspace_id: query.workspace_id,
      });

    this.businessEventLogging.logBusiness({
      event: 'vectorization_status_retrieved',
      category: 'ckql_operations',
      value: Date.now() - startTime,
      metadata: {
        tenantId: query.tenant_id,
        workspaceId: query.workspace_id,
        jobStatus: job?.status,
        jobId: job?.id,
        hasStats: true,
        userId: user.id,
      },
    });

    return {
      success: true,
      current_job: job,
      statistics: stats,
    };
  }

  /**
   * POST /ckql/vectorization/cancel - Cancel running vectorization job.
   */
  @Post('vectorization/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelVectorization(@CurrentUser() user: AuthenticatedUser) {
    const startTime = Date.now();
    this.logger.log('Vectorization cancellation initiated', {
      userId: user.id,
    });

    const cancelled =
      await this.telemetryVectorizationService.cancelVectorization();

    this.businessEventLogging.logBusiness({
      event: 'vectorization_cancelled',
      category: 'ckql_operations',
      value: Date.now() - startTime,
      metadata: { cancelled, userId: user.id },
    });

    return { success: true, cancelled };
  }

  /**
   * POST /ckql/narratives - Get or generate cost narratives for records (AI rate limited).
   */
  @Post('narratives')
  @UseGuards(CkqlAiRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async getCostNarratives(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GetCostNarrativesDto,
  ) {
    const startTime = Date.now();
    this.logger.log('Cost narratives request initiated', {
      recordIdsCount: dto.record_ids?.length ?? 0,
      userId: user.id,
    });

    const narratives = await this.costNarrativesService.getCostNarratives(
      dto.record_ids,
    );

    this.businessEventLogging.logBusiness({
      event: 'cost_narratives_generated',
      category: 'ckql_operations',
      value: Date.now() - startTime,
      metadata: {
        recordIdsCount: dto.record_ids.length,
        narrativesCount: narratives.length,
        userId: user.id,
      },
    });

    return {
      success: true,
      narratives: narratives.map(({ record_id, narrative, generated_at }) => ({
        record_id,
        narrative,
        generated_at,
      })),
    };
  }

  /**
   * Generate query suggestions from partial input (mirrors Express generateSuggestions).
   */
  private generateSuggestions(partialQuery: string): string[] {
    const suggestions: string[] = [];
    const lower = partialQuery.toLowerCase();

    if (
      lower.includes('cost') ||
      lower.includes('expensive') ||
      lower.includes('$')
    ) {
      suggestions.push(
        'What are my most expensive operations today?',
        'Show me operations that cost more than $0.01',
        'Find high-cost AI model calls',
        'Which operations are driving up costs?',
      );
    }
    if (
      lower.includes('slow') ||
      lower.includes('latency') ||
      lower.includes('performance')
    ) {
      suggestions.push(
        'What operations are taking longer than 5 seconds?',
        'Show me the slowest requests today',
        'Find performance bottlenecks',
        'Which operations have high latency?',
      );
    }
    if (
      lower.includes('error') ||
      lower.includes('fail') ||
      lower.includes('problem')
    ) {
      suggestions.push(
        'What errors occurred in the last hour?',
        'Show me failed operations',
        'Find operations with high error rates',
        "What's causing failures?",
      );
    }
    if (
      lower.includes('ai') ||
      lower.includes('model') ||
      lower.includes('claude') ||
      lower.includes('gpt')
    ) {
      suggestions.push(
        'Show me AI model usage today',
        'What are my most expensive AI calls?',
        'Find failed AI operations',
        'Which models am I using most?',
      );
    }
    if (
      lower.includes('today') ||
      lower.includes('hour') ||
      lower.includes('yesterday')
    ) {
      suggestions.push(
        "Show me today's operations",
        'What happened in the last hour?',
        "Find yesterday's peak usage",
        "Show me this week's trends",
      );
    }
    if (suggestions.length === 0) {
      suggestions.push(
        'What are my most expensive operations?',
        'Show me recent errors',
        'Find slow operations',
        "What's my current usage?",
      );
    }

    return suggestions.slice(0, 6);
  }
}
