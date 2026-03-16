import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CacheService } from '../../common/cache/cache.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PricingRegistryService } from '../pricing/services/pricing-registry.service';
import type {
  WorkflowExecution,
  WorkflowStep,
  WorkflowTemplate,
  WorkflowMetrics,
} from './workflow.interfaces';

const TEMPLATE_TTL = 86400 * 30; // 30 days
const EXECUTION_TTL = 86400 * 7; // 7 days
const TEMPLATE_PREFIX = 'workflow:template:';
const EXECUTION_PREFIX = 'workflow:execution:';

@Injectable()
export class WorkflowOrchestratorService {
  private readonly logger = new Logger(WorkflowOrchestratorService.name);
  private readonly activeExecutions = new Map<string, WorkflowExecution>();
  private readonly templates = new Map<string, WorkflowTemplate>();

  constructor(
    private readonly cache: CacheService,
    private readonly subscriptionService: SubscriptionService,
    private readonly pricingRegistry: PricingRegistryService,
  ) {}

  async createWorkflowTemplate(
    data: Omit<
      WorkflowTemplate,
      'id' | 'createdAt' | 'updatedAt' | 'createdBy'
    > & {
      userId: string;
      createdBy: string;
    },
  ): Promise<WorkflowTemplate> {
    const template: WorkflowTemplate = {
      ...data,
      id: uuidv4(),
      createdBy: data.createdBy,
      userId: data.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.templates.set(template.id, template);
    try {
      await this.cache.set(
        `${TEMPLATE_PREFIX}${template.id}`,
        template,
        TEMPLATE_TTL,
      );
    } catch (e) {
      this.logger.warn('Failed to store workflow template in cache', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    this.logger.log('Workflow template created', {
      templateId: template.id,
      name: template.name,
      stepCount: template.steps.length,
    });
    return template;
  }

  async getWorkflowTemplate(
    templateId: string,
  ): Promise<WorkflowTemplate | null> {
    const fromMemory = this.templates.get(templateId);
    if (fromMemory) return fromMemory;
    const fromCache = await this.cache.get<WorkflowTemplate>(
      `${TEMPLATE_PREFIX}${templateId}`,
    );
    if (fromCache) {
      this.templates.set(templateId, fromCache);
      return fromCache;
    }
    return null;
  }

  async listTemplates(userId: string): Promise<WorkflowTemplate[]> {
    const keys = await this.cache.keys(`${TEMPLATE_PREFIX}*`);
    const templates: WorkflowTemplate[] = [];
    for (const key of keys) {
      try {
        const t = await this.cache.get<WorkflowTemplate>(key);
        if (t && t.userId === userId) templates.push(t);
      } catch {
        continue;
      }
    }
    return templates.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async executeWorkflow(
    templateId: string,
    userId: string,
    input?: unknown,
    options?: {
      variables?: Record<string, unknown>;
      environment?: string;
      tags?: string[];
    },
  ): Promise<WorkflowExecution> {
    const subscription =
      await this.subscriptionService.getSubscriptionByUserId(userId);
    if (!subscription) throw new Error('Subscription not found');
    const status = (subscription as { status?: string }).status;
    if (status !== 'active' && status !== 'trialing') {
      throw new Error(
        `Subscription is ${status}. Please activate your subscription.`,
      );
    }

    const template = await this.getWorkflowTemplate(templateId);
    if (!template) throw new Error(`Workflow template ${templateId} not found`);

    const execution: WorkflowExecution = {
      id: uuidv4(),
      workflowId: templateId,
      name: template.name,
      userId,
      status: 'running',
      startTime: new Date(),
      steps: template.steps.map((s) => ({
        ...s,
        status: 'pending' as const,
        metadata: s.metadata as WorkflowStep['metadata'],
      })),
      input,
      traceId: uuidv4(),
      metadata: {
        environment: options?.environment ?? 'production',
        version: template.version,
        tags: options?.tags ?? [],
        totalCost: 0,
        totalTokens: 0,
        cacheHitRate: 0,
        averageLatency: 0,
      },
    };

    this.activeExecutions.set(execution.id, execution);
    await this.persistExecution(execution);

    this.runWorkflowExecution(execution, template).catch((err) => {
      this.logger.error('Workflow execution failed', {
        executionId: execution.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return execution;
  }

  async getWorkflowExecution(
    executionId: string,
  ): Promise<WorkflowExecution | null> {
    const fromMemory = this.activeExecutions.get(executionId);
    if (fromMemory) return fromMemory;
    const fromCache = await this.cache.get<WorkflowExecution>(
      `${EXECUTION_PREFIX}${executionId}`,
    );
    return fromCache ?? null;
  }

  async pauseWorkflow(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.status = 'paused';
      await this.persistExecution(execution);
    }
  }

  async resumeWorkflow(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (execution && execution.status === 'paused') {
      execution.status = 'running';
      await this.persistExecution(execution);
    }
  }

  async cancelWorkflow(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.status = 'cancelled';
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      await this.persistExecution(execution);
      this.activeExecutions.delete(executionId);
    }
  }

  async getWorkflowMetrics(
    workflowId: string,
    timeRange?: string,
  ): Promise<WorkflowMetrics> {
    const executions = await this.getExecutionsForWorkflow(
      workflowId,
      timeRange,
    );
    if (executions.length === 0) {
      return {
        executionCount: 0,
        successRate: 0,
        averageDuration: 0,
        averageCost: 0,
        averageTokens: 0,
        cacheHitRate: 0,
        errorRate: 0,
        topErrors: [],
        performanceByStep: [],
        trends: [],
      };
    }
    const completed = executions.filter((e) => e.status === 'completed');
    const failed = executions.filter((e) => e.status === 'failed');
    const successRate = (completed.length / executions.length) * 100;
    const errorRate = (failed.length / executions.length) * 100;
    const avgDuration =
      completed.reduce((s, e) => s + (e.duration ?? 0), 0) / completed.length ||
      0;
    const avgCost =
      completed.reduce((s, e) => s + (e.metadata?.totalCost ?? 0), 0) /
        completed.length || 0;
    const avgTokens =
      completed.reduce((s, e) => s + (e.metadata?.totalTokens ?? 0), 0) /
        completed.length || 0;
    const stepsWithCache = completed
      .flatMap((e) => e.steps)
      .filter((s) => s.metadata?.cacheHit !== undefined);
    const cacheHits = stepsWithCache.filter((s) => s.metadata?.cacheHit).length;
    const cacheHitRate =
      stepsWithCache.length > 0 ? (cacheHits / stepsWithCache.length) * 100 : 0;
    const errorCounts = new Map<string, number>();
    failed.forEach((e) => {
      if (e.error)
        errorCounts.set(e.error, (errorCounts.get(e.error) ?? 0) + 1);
    });
    const topErrors = Array.from(errorCounts.entries())
      .map(([error, count]) => ({
        error,
        count,
        percentage: (count / failed.length) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const stepStats = new Map<
      string,
      { durations: number[]; costs: number[]; successes: number; total: number }
    >();
    completed.forEach((exec) => {
      exec.steps.forEach((step) => {
        if (!stepStats.has(step.name)) {
          stepStats.set(step.name, {
            durations: [],
            costs: [],
            successes: 0,
            total: 0,
          });
        }
        const st = stepStats.get(step.name)!;
        st.total++;
        if (step.status === 'completed') {
          st.successes++;
          if (step.duration) st.durations.push(step.duration);
          if (step.metadata?.cost) st.costs.push(step.metadata.cost);
        }
      });
    });
    const performanceByStep = Array.from(stepStats.entries()).map(
      ([stepName, st]) => ({
        stepName,
        averageDuration:
          st.durations.length > 0
            ? st.durations.reduce((a, b) => a + b, 0) / st.durations.length
            : 0,
        successRate: (st.successes / st.total) * 100,
        averageCost:
          st.costs.length > 0
            ? st.costs.reduce((a, b) => a + b, 0) / st.costs.length
            : 0,
      }),
    );
    const dailyStats = new Map<
      string,
      {
        executions: number;
        totalDuration: number;
        totalCost: number;
        successes: number;
      }
    >();
    executions.forEach((e) => {
      const day = e.startTime.toISOString().split('T')[0];
      if (!dailyStats.has(day)) {
        dailyStats.set(day, {
          executions: 0,
          totalDuration: 0,
          totalCost: 0,
          successes: 0,
        });
      }
      const d = dailyStats.get(day)!;
      d.executions++;
      if (e.duration) d.totalDuration += e.duration;
      if (e.metadata?.totalCost) d.totalCost += e.metadata.totalCost;
      if (e.status === 'completed') d.successes++;
    });
    const trends = Array.from(dailyStats.entries()).map(([period, st]) => ({
      period,
      executions: st.executions,
      avgDuration: st.executions ? st.totalDuration / st.executions : 0,
      avgCost: st.executions ? st.totalCost / st.executions : 0,
      successRate: st.executions ? (st.successes / st.executions) * 100 : 0,
    }));
    return {
      executionCount: executions.length,
      successRate,
      averageDuration: avgDuration,
      averageCost: avgCost,
      averageTokens: avgTokens,
      cacheHitRate,
      errorRate,
      topErrors,
      performanceByStep,
      trends,
    };
  }

  private async getExecutionsForWorkflow(
    workflowId: string,
    timeRange?: string,
  ): Promise<WorkflowExecution[]> {
    const keys = await this.cache.keys(`${EXECUTION_PREFIX}*`);
    const executions: WorkflowExecution[] = [];
    for (const key of keys) {
      try {
        const e = await this.cache.get<WorkflowExecution>(key);
        if (!e || e.workflowId !== workflowId) continue;
        if (timeRange) {
          const now = Date.now();
          const start = new Date(e.startTime).getTime();
          let maxAge = 24 * 60 * 60 * 1000;
          if (timeRange === '1h') maxAge = 60 * 60 * 1000;
          else if (timeRange === '6h') maxAge = 6 * 60 * 60 * 1000;
          else if (timeRange === '12h') maxAge = 12 * 60 * 60 * 1000;
          else if (timeRange === '7d') maxAge = 7 * 24 * 60 * 60 * 1000;
          else if (timeRange === '30d') maxAge = 30 * 24 * 60 * 60 * 1000;
          if (now - start <= maxAge) executions.push(e);
        } else {
          executions.push(e);
        }
      } catch {
        continue;
      }
    }
    return executions.sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }

  private async persistExecution(execution: WorkflowExecution): Promise<void> {
    try {
      await this.cache.set(
        `${EXECUTION_PREFIX}${execution.id}`,
        execution,
        EXECUTION_TTL,
      );
    } catch (e) {
      this.logger.warn('Failed to persist workflow execution', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async runWorkflowExecution(
    execution: WorkflowExecution,
    template: WorkflowTemplate,
  ): Promise<void> {
    const completedSteps = new Set<string>();
    const failedSteps = new Set<string>();

    try {
      while (completedSteps.size + failedSteps.size < execution.steps.length) {
        const ready = execution.steps.filter(
          (step) =>
            step.status === 'pending' &&
            !failedSteps.has(step.id) &&
            (step.dependencies ?? []).every((id) => completedSteps.has(id)),
        );
        if (ready.length === 0) {
          const pending = execution.steps.filter((s) => s.status === 'pending');
          if (pending.length > 0) {
            throw new Error(
              'Workflow stuck: no steps can be executed due to failed dependencies',
            );
          }
          break;
        }
        const parallelism =
          (template.settings as { parallelism?: number })?.parallelism ?? 1;
        for (let i = 0; i < ready.length; i += parallelism) {
          const batch = ready.slice(i, i + parallelism);
          await Promise.allSettled(batch.map((step) => this.executeStep(step)));
          batch.forEach((step) => {
            if (step.status === 'completed') completedSteps.add(step.id);
            else if (step.status === 'failed') failedSteps.add(step.id);
          });
        }
        await this.persistExecution(execution);
      }

      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      execution.status = failedSteps.size > 0 ? 'failed' : 'completed';
      this.calculateExecutionMetrics(execution);
      await this.persistExecution(execution);
      this.activeExecutions.delete(execution.id);
      this.logger.log('Workflow execution completed', {
        executionId: execution.id,
        status: execution.status,
        duration: execution.duration,
      });
    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      await this.persistExecution(execution);
      this.activeExecutions.delete(execution.id);
      this.logger.error('Workflow execution failed', {
        executionId: execution.id,
        error: execution.error,
      });
    }
  }

  private async executeStep(step: WorkflowStep): Promise<void> {
    step.status = 'running';
    step.startTime = new Date();
    try {
      switch (step.type) {
        case 'llm_call':
          this.executeLLMStep(step);
          break;
        case 'data_processing':
          this.executeDataProcessingStep(step);
          break;
        case 'api_call':
          this.executeAPICallStep(step);
          break;
        case 'conditional':
          this.executeConditionalStep(step);
          break;
        case 'parallel':
          this.executeParallelStep(step);
          break;
        case 'custom':
          this.executeCustomStep(step);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
      step.status = 'completed';
      step.endTime = new Date();
      step.duration = step.endTime.getTime() - (step.startTime?.getTime() ?? 0);
    } catch (err) {
      step.status = 'failed';
      step.error = err instanceof Error ? err.message : String(err);
      step.endTime = new Date();
      step.duration = step.startTime
        ? step.endTime.getTime() - step.startTime.getTime()
        : 0;
    }
  }

  private executeLLMStep(step: WorkflowStep): void {
    const usage = { input: 100, output: 150, total: 250 };

    // Calculate real cost using PricingRegistryService
    const model = step.metadata?.model ?? 'gpt-4o-mini';
    const costResult = this.pricingRegistry.calculateCost({
      modelId: `openai:${model}`,
      inputTokens: usage.input,
      outputTokens: usage.output,
    });
    const cost = costResult?.totalCost ?? (usage.total / 1000) * 0.001;

    step.output = {
      response: 'Workflow step response.',
      model: step.metadata?.model ?? 'gpt-4o-mini',
      usage,
    };
    step.metadata = {
      ...step.metadata,
      tokens: usage,
      cost,
      latency: 400,
    };
  }

  private executeDataProcessingStep(step: WorkflowStep): void {
    step.output = {
      processed: true,
      data: step.input ?? {},
    };
    step.metadata = { ...step.metadata, cost: 0.001, latency: 150 };
  }

  private executeAPICallStep(step: WorkflowStep): void {
    step.output = { success: true, statusCode: 200 };
    step.metadata = { ...step.metadata, cost: 0.002, latency: 250 };
  }

  private executeConditionalStep(step: WorkflowStep): void {
    step.output = {
      condition: true,
      nextStep: (step.conditions as { then?: string })?.then,
    };
    step.metadata = { ...step.metadata, cost: 0.0001, latency: 50 };
  }

  private executeParallelStep(step: WorkflowStep): void {
    const tasks = (step.metadata?.tasks as unknown[]) ?? [];
    step.output = {
      parallelResults: tasks.map((_, i) => ({ taskId: i, done: true })),
    };
    step.metadata = {
      ...step.metadata,
      cost: 0.005 * tasks.length,
      latency: 200,
    };
  }

  private executeCustomStep(step: WorkflowStep): void {
    step.output = {
      processed: true,
      function: step.metadata?.function ?? 'default',
    };
    step.metadata = { ...step.metadata, cost: 0.003, latency: 100 };
  }

  private calculateExecutionMetrics(execution: WorkflowExecution): void {
    const completed = execution.steps.filter((s) => s.status === 'completed');
    if (!execution.metadata) return;
    execution.metadata.totalCost = completed.reduce(
      (s, step) => s + (step.metadata?.cost ?? 0),
      0,
    );
    execution.metadata.totalTokens = completed.reduce((s, step) => {
      const t = step.metadata?.tokens;
      if (typeof t === 'number') return s + t;
      if (t && typeof t === 'object' && 'total' in t) {
        return s + (t as { total: number }).total;
      }
      return s;
    }, 0);
    const withCache = completed.filter((s) => s.metadata?.cacheHit).length;
    execution.metadata.cacheHitRate =
      completed.length > 0 ? (withCache / completed.length) * 100 : 0;
    execution.metadata.averageLatency =
      completed.length > 0
        ? completed.reduce((s, st) => s + (st.metadata?.latency ?? 0), 0) /
          completed.length
        : 0;
  }
}
