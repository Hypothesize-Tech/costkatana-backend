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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service';
import { WorkflowService } from './workflow.service';
import type {
  CreateWorkflowTemplateDto,
  ExecuteWorkflowDto,
} from './dto/workflow.dto';
import type {
  WorkflowExecution,
  WorkflowTemplate,
} from './workflow.interfaces';

@Controller('api/workflow')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  constructor(
    private readonly orchestrator: WorkflowOrchestratorService,
    private readonly workflowService: WorkflowService,
  ) {}

  @Get()
  async getWorkflowsList(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.workflowService.getWorkflowsList(user.id, page, limit);
  }

  @Get('executions')
  async getWorkflowsListExecutions(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.workflowService.getWorkflowsList(user.id, page, limit);
  }

  @Get('analytics')
  async getWorkflowAnalytics(@CurrentUser() user: { id: string }) {
    return this.workflowService.getWorkflowAnalytics(user.id);
  }

  @Get('dashboard')
  async getObservabilityDashboard(
    @CurrentUser() user: { id: string },
    @Query('timeRange') timeRange?: string,
  ) {
    return this.workflowService.getObservabilityDashboard(
      user.id,
      timeRange ?? '24h',
    );
  }

  @Get('templates')
  async listTemplates(@CurrentUser() user: { id: string }) {
    const templates = await this.orchestrator.listTemplates(user.id);
    return { success: true, data: templates };
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(
    @CurrentUser() user: { id: string },
    @Body() body: CreateWorkflowTemplateDto,
  ) {
    const template = await this.orchestrator.createWorkflowTemplate({
      name: body.name,
      description: body.description ?? '',
      version: body.version,
      steps:
        body.steps as import('./workflow.interfaces').WorkflowStepTemplate[],
      variables: body.variables as WorkflowTemplate['variables'],
      triggers: body.triggers as WorkflowTemplate['triggers'],
      settings: body.settings as WorkflowTemplate['settings'],
      tags: body.tags,
      userId: user.id,
      createdBy: user.id,
    });
    return {
      success: true,
      message: 'Workflow template created successfully',
      data: template,
    };
  }

  @Get('templates/:templateId')
  async getTemplate(@Param('templateId') templateId: string) {
    const template = await this.orchestrator.getWorkflowTemplate(templateId);
    if (!template) {
      throw new NotFoundException('Workflow template not found');
    }
    return { success: true, data: template };
  }

  @Post('templates/:templateId/execute')
  @HttpCode(HttpStatus.CREATED)
  async executeWorkflow(
    @CurrentUser() user: { id: string },
    @Param('templateId') templateId: string,
    @Body() body: ExecuteWorkflowDto,
  ) {
    const execution = await this.orchestrator.executeWorkflow(
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
      message: 'Workflow execution started',
      data: execution,
    };
  }

  @Get('executions/:executionId')
  async getExecution(@Param('executionId') executionId: string) {
    const execution = await this.orchestrator.getWorkflowExecution(executionId);
    if (!execution) {
      throw new NotFoundException('Workflow execution not found');
    }
    return { success: true, data: execution };
  }

  @Get('executions/:executionId/trace')
  async getWorkflowTrace(@Param('executionId') executionId: string) {
    const execution = await this.orchestrator.getWorkflowExecution(executionId);
    if (!execution) {
      throw new NotFoundException('Workflow execution not found');
    }
    const trace = {
      execution: {
        id: execution.id,
        workflowId: execution.workflowId,
        name: execution.name,
        status: execution.status,
        startTime: execution.startTime,
        endTime: execution.endTime,
        duration: execution.duration,
        traceId: execution.traceId,
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
      timeline: execution.steps
        .map((s) => ({
          stepId: s.id,
          stepName: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          duration: s.duration,
          status: s.status,
        }))
        .sort(
          (a, b) =>
            (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0),
        ),
      costBreakdown: buildCostBreakdown(execution),
      performanceInsights: buildPerformanceInsights(execution),
    };
    return { success: true, data: trace };
  }

  @Post('executions/:executionId/pause')
  async pauseWorkflow(@Param('executionId') executionId: string) {
    await this.orchestrator.pauseWorkflow(executionId);
    return { success: true, message: 'Workflow paused successfully' };
  }

  @Post('executions/:executionId/resume')
  async resumeWorkflow(@Param('executionId') executionId: string) {
    await this.orchestrator.resumeWorkflow(executionId);
    return { success: true, message: 'Workflow resumed successfully' };
  }

  @Post('executions/:executionId/cancel')
  async cancelWorkflow(@Param('executionId') executionId: string) {
    await this.orchestrator.cancelWorkflow(executionId);
    return { success: true, message: 'Workflow cancelled successfully' };
  }

  @Get(':workflowId/metrics')
  async getWorkflowMetrics(
    @Param('workflowId') workflowId: string,
    @Query('timeRange') timeRange?: string,
  ) {
    const metrics = await this.orchestrator.getWorkflowMetrics(
      workflowId,
      timeRange,
    );
    return { success: true, data: metrics };
  }
}

function buildCostBreakdown(execution: WorkflowExecution): unknown {
  const stepCosts = (execution.steps ?? [])
    .filter((s) => (s.metadata as { cost?: number })?.cost != null)
    .map((s) => ({
      stepName: s.name,
      cost: (s.metadata as { cost?: number }).cost,
      tokens:
        (s.metadata as { tokens?: { total?: number } })?.tokens?.total ?? 0,
      model: (s.metadata as { model?: string })?.model,
    }));
  const totalCost = execution.metadata?.totalCost ?? 0;
  const totalTokens = execution.metadata?.totalTokens ?? 1;
  return {
    totalCost,
    stepBreakdown: stepCosts,
    costPerToken: stepCosts.length ? totalCost / totalTokens : 0,
  };
}

function buildPerformanceInsights(execution: WorkflowExecution): unknown[] {
  const completed = (execution.steps ?? []).filter(
    (s) => s.status === 'completed',
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
