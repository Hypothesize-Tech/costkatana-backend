import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CacheService } from '../../common/cache/cache.service';
import { AgentTraceService } from './agent-trace.service';
import { WorkflowOrchestratorService } from '../workflow/workflow-orchestrator.service';
import {
  CreateAgentTraceTemplateDto,
  ExecuteAgentTraceDto,
} from './dto/agent-trace.dto';
import {
  WorkflowExecution,
  WorkflowTemplate,
} from '../workflow/workflow.interfaces';

@Controller('api/agent-trace')
@UseGuards(JwtAuthGuard)
export class AgentTraceController {
  private readonly logger = new Logger(AgentTraceController.name);

  constructor(
    private readonly agentTraceService: AgentTraceService,
    private readonly workflowOrchestrator: WorkflowOrchestratorService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  async getTracesList(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.agentTraceService.getTracesList(user.id, page, limit);
  }

  @Get('executions')
  async getTracesListExecutions(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.agentTraceService.getTracesList(user.id, page, limit);
  }

  @Get('analytics')
  async getTraceAnalytics(@CurrentUser() user: { id: string }) {
    return this.agentTraceService.getTraceAnalytics(user.id);
  }

  @Get('dashboard')
  async getObservabilityDashboard(
    @CurrentUser() user: { id: string },
    @Query('timeRange') timeRange?: string,
  ) {
    const result = await this.agentTraceService.getObservabilityDashboard(
      user.id,
      timeRange ?? '24h',
    );
    const overview = result.overview ?? {};
    const ov = overview as {
      activeTraces?: number;
      activeWorkflows?: number;
    } & typeof overview;
    return {
      success: true,
      data: {
        ...result,
        overview: {
          ...overview,
          activeTraces: ov.activeTraces ?? ov.activeWorkflows ?? 0,
        },
      },
    };
  }

  @Get('templates')
  async listTemplates(@CurrentUser() user: { id: string }) {
    const templates = await this.workflowOrchestrator.listTemplates(user.id);
    return { success: true, data: templates };
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(
    @CurrentUser() user: { id: string },
    @Body() body: CreateAgentTraceTemplateDto,
  ) {
    const template = await this.workflowOrchestrator.createWorkflowTemplate({
      name: body.name,
      description: body.description ?? '',
      version: body.version,
      steps:
        body.steps as import('../workflow/workflow.interfaces').WorkflowStepTemplate[],
      variables: body.variables as WorkflowTemplate['variables'],
      triggers: body.triggers as WorkflowTemplate['triggers'],
      settings: body.settings as WorkflowTemplate['settings'],
      tags: body.tags,
      userId: user.id,
      createdBy: user.id,
    });
    return {
      success: true,
      message: 'Agent trace template created successfully',
      data: template,
    };
  }

  @Get('templates/:templateId')
  async getTemplate(@Param('templateId') templateId: string) {
    const template =
      await this.workflowOrchestrator.getWorkflowTemplate(templateId);
    if (!template) {
      throw new NotFoundException('Agent trace template not found');
    }
    return { success: true, data: template };
  }

  @Post('templates/:templateId/execute')
  @HttpCode(HttpStatus.CREATED)
  async executeTrace(
    @CurrentUser() user: { id: string },
    @Param('templateId') templateId: string,
    @Body() body: ExecuteAgentTraceDto,
  ) {
    const execution = await this.workflowOrchestrator.executeWorkflow(
      templateId,
      user.id,
      body.input,
      {
        variables: body.variables,
        environment: body.environment,
        tags: body.tags,
      },
    );
    return {
      success: true,
      message: 'Agent trace execution started',
      data: execution,
    };
  }

  @Get('executions/:executionId')
  async getExecution(@Param('executionId') executionId: string) {
    const execution =
      await this.workflowOrchestrator.getWorkflowExecution(executionId);
    if (!execution) {
      throw new NotFoundException('Agent trace execution not found');
    }
    return { success: true, data: execution };
  }

  @Get('executions/:executionId/trace')
  async getTraceDetail(@Param('executionId') executionId: string) {
    const execution =
      await this.workflowOrchestrator.getWorkflowExecution(executionId);
    if (!execution) {
      throw new NotFoundException('Agent trace execution not found');
    }

    const trace = {
      execution: {
        id: execution.id,
        traceId: execution.traceId,
        name: execution.name,
        status: execution.status,
        startTime: execution.startTime,
        endTime: execution.endTime,
        duration: execution.duration,
      },
      steps: execution.steps.map((step) => ({
        id: step.id,
        name: step.name,
        type: step.type,
        status: step.status,
        startTime: step.startTime,
        endTime: step.endTime,
        duration: step.duration,
        input: step.input,
        output: step.output,
        error: step.error,
        metadata: step.metadata,
        dependencies: step.dependencies,
      })),
      metrics: execution.metadata,
      timeline: this.generateTimeline(execution),
      costBreakdown: this.generateCostBreakdown(execution),
      performanceInsights: this.generatePerformanceInsights(execution),
    };

    return { success: true, data: trace };
  }

  @Post('executions/:executionId/pause')
  async pauseTrace(@Param('executionId') executionId: string) {
    await this.workflowOrchestrator.pauseWorkflow(executionId);
    return { success: true, message: 'Agent trace paused successfully' };
  }

  @Post('executions/:executionId/resume')
  async resumeTrace(@Param('executionId') executionId: string) {
    await this.workflowOrchestrator.resumeWorkflow(executionId);
    return { success: true, message: 'Agent trace resumed successfully' };
  }

  @Post('executions/:executionId/cancel')
  async cancelTrace(@Param('executionId') executionId: string) {
    await this.workflowOrchestrator.cancelWorkflow(executionId);
    return { success: true, message: 'Agent trace cancelled successfully' };
  }

  @Get(':traceId/metrics')
  async getTraceMetrics(
    @Param('traceId') traceId: string,
    @Query('timeRange') timeRange?: string,
  ) {
    const metrics = await this.workflowOrchestrator.getWorkflowMetrics(
      traceId,
      timeRange,
    );
    return { success: true, data: metrics };
  }

  // Helper methods (implemented inline as per plan)
  private generateTimeline(execution: WorkflowExecution) {
    return execution.steps
      .map((step) => ({
        stepId: step.id,
        stepName: step.name,
        startTime: step.startTime,
        endTime: step.endTime,
        duration: step.duration,
        status: step.status,
      }))
      .sort(
        (a, b) => (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0),
      );
  }

  private generateCostBreakdown(execution: WorkflowExecution): unknown {
    const stepCosts = (execution.steps ?? [])
      .filter((step) => (step.metadata as { cost?: number })?.cost != null)
      .map((step) => ({
        stepName: step.name,
        cost: (step.metadata as { cost?: number }).cost,
        tokens:
          (step.metadata as { tokens?: { total?: number } })?.tokens?.total ??
          0,
        model: (step.metadata as { model?: string })?.model,
      }));

    return {
      totalCost: execution.metadata?.totalCost ?? 0,
      stepBreakdown: stepCosts,
      costPerToken:
        stepCosts.length > 0
          ? (execution.metadata?.totalCost ?? 0) /
            (execution.metadata?.totalTokens ?? 1)
          : 0,
    };
  }

  private generatePerformanceInsights(execution: WorkflowExecution): unknown[] {
    const completed = (execution.steps ?? []).filter(
      (step) => step.status === 'completed',
    );
    const slowest = completed.reduce(
      (a, b) => ((a.duration ?? 0) > (b.duration ?? 0) ? a : b),
      completed[0],
    );

    const insights: unknown[] = [];

    if (slowest && execution.duration) {
      insights.push({
        type: 'performance',
        message: `Step "${slowest.name}" took ${slowest.duration}ms (${Math.round(((slowest.duration ?? 0) / execution.duration) * 100)}% of total time)`,
        suggestion:
          'Consider optimizing this step or running it in parallel with other steps',
      });
    }

    const cacheHitRate = execution.metadata?.cacheHitRate ?? 0;
    if (cacheHitRate < 50) {
      insights.push({
        type: 'optimization',
        message: `Low cache hit rate (${cacheHitRate.toFixed(1)}%)`,
        suggestion:
          'Enable caching for repeated operations to reduce costs and latency',
      });
    }

    return insights;
  }
}
