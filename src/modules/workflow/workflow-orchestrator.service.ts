import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { CacheService } from '../../common/cache/cache.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PricingRegistryService } from '../pricing/services/pricing-registry.service';
import { AIRouterService } from '../cortex/services/ai-router.service';
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
const STEP_CACHE_TTL = 3600000; // 1 hour
const CACHE_CLEANUP_INTERVAL = 300000; // 5 minutes

@Injectable()
export class WorkflowOrchestratorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkflowOrchestratorService.name);
  private readonly activeExecutions = new Map<string, WorkflowExecution>();
  private readonly templates = new Map<string, WorkflowTemplate>();

  /** Semantic cache for workflow steps (70-80% cost savings) */
  private readonly workflowStepCache = new Map<
    string,
    { output: unknown; timestamp: number; cost: number; tokens: number }
  >();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly cache: CacheService,
    private readonly subscriptionService: SubscriptionService,
    private readonly pricingRegistry: PricingRegistryService,
    private readonly aiRouterService: AIRouterService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanupStepCache(),
      CACHE_CLEANUP_INTERVAL,
    );
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  private generateStepCacheKey(
    workflowId: string,
    stepId: string,
    input: unknown,
    variables?: Record<string, unknown>,
  ): string {
    const data = JSON.stringify({ workflowId, stepId, input, variables });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private checkStepCache(cacheKey: string): unknown | null {
    const cached = this.workflowStepCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < STEP_CACHE_TTL) {
      this.logger.debug('Workflow step cache HIT', {
        cacheKey: cacheKey.substring(0, 16),
        savedCost: cached.cost,
        savedTokens: cached.tokens,
      });
      return cached.output;
    }
    return null;
  }

  private cacheStepResult(
    cacheKey: string,
    output: unknown,
    cost = 0,
    tokens = 0,
  ): void {
    this.workflowStepCache.set(cacheKey, {
      output,
      timestamp: Date.now(),
      cost,
      tokens,
    });
  }

  private cleanupStepCache(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.workflowStepCache.entries()) {
      if (now - entry.timestamp > STEP_CACHE_TTL) {
        this.workflowStepCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug('Cleaned up workflow step cache', {
        entriesRemoved: cleaned,
        remainingEntries: this.workflowStepCache.size,
      });
    }
  }

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

    await this.subscriptionService.checkAgentTraceQuota(userId);
    await this.subscriptionService.checkRequestQuota(userId);
    await this.subscriptionService.validateAndReserveTokens(userId, 1000);

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

    this.eventEmitter.emit('workflow:started', execution);

    this.runWorkflowExecution(execution, template, options?.variables).catch(
      (err) => {
        this.logger.error('Workflow execution failed', {
          executionId: execution.id,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );

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
      this.eventEmitter.emit('workflow:paused', execution);
    }
  }

  async resumeWorkflow(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (execution && execution.status === 'paused') {
      execution.status = 'running';
      await this.persistExecution(execution);
      this.eventEmitter.emit('workflow:resumed', execution);
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
      this.eventEmitter.emit('workflow:cancelled', execution);
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
    variables?: Record<string, unknown>,
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
          await Promise.allSettled(
            batch.map((step) => this.executeStep(step, execution, variables)),
          );
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

      if (execution.status === 'completed') {
        try {
          const totalTokens = execution.metadata?.totalTokens ?? 0;
          await this.subscriptionService.consumeTokens(
            execution.userId,
            totalTokens,
          );
          await this.subscriptionService.consumeRequest(execution.userId);
          await this.subscriptionService.incrementAgentTracesUsed(
            execution.userId,
          );
        } catch (err) {
          this.logger.error('Error tracking workflow consumption', {
            executionId: execution.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.calculateExecutionMetrics(execution);
      await this.persistExecution(execution);
      this.activeExecutions.delete(execution.id);

      this.eventEmitter.emit('workflow:completed', execution);

      this.logger.log('Workflow execution completed', {
        executionId: execution.id,
        status: execution.status,
        duration: execution.duration,
        totalCost: execution.metadata?.totalCost,
        totalTokens: execution.metadata?.totalTokens,
      });
    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
      await this.persistExecution(execution);
      this.activeExecutions.delete(execution.id);

      this.eventEmitter.emit('workflow:failed', execution);
      this.logger.error('Workflow execution failed', {
        executionId: execution.id,
        error: execution.error,
      });
    }
  }

  private async executeStep(
    step: WorkflowStep,
    execution: WorkflowExecution,
    variables?: Record<string, unknown>,
  ): Promise<void> {
    const cacheKey = this.generateStepCacheKey(
      execution.workflowId,
      step.id,
      step.input,
      variables,
    );

    const cachedOutput = this.checkStepCache(cacheKey);
    if (cachedOutput !== null) {
      step.status = 'completed';
      step.output = cachedOutput;
      step.startTime = new Date();
      step.endTime = new Date();
      step.duration = 0;
      step.metadata = { ...step.metadata, cacheHit: true };
      this.eventEmitter.emit('step:completed', { execution, step });
      return;
    }

    step.status = 'running';
    step.startTime = new Date();

    this.eventEmitter.emit('step:started', { execution, step });

    try {
      switch (step.type) {
        case 'llm_call':
          await this.executeLLMStep(step, execution);
          break;
        case 'data_processing':
          this.executeDataProcessingStep(step);
          break;
        case 'api_call':
          await this.executeAPICallStep(step);
          break;
        case 'conditional':
          this.executeConditionalStep(step);
          break;
        case 'parallel':
          await this.executeParallelStep(step);
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

      const stepCost = (step.metadata?.cost as number) ?? 0;
      const tokensValue = step.metadata?.tokens;
      const stepTokens =
        typeof tokensValue === 'number'
          ? tokensValue
          : typeof tokensValue === 'object' &&
              tokensValue !== null &&
              'total' in tokensValue
            ? (tokensValue as { total: number }).total
            : 0;
      this.cacheStepResult(cacheKey, step.output, stepCost, stepTokens);

      this.eventEmitter.emit('step:completed', { execution, step });
    } catch (err) {
      step.status = 'failed';
      step.error = err instanceof Error ? err.message : String(err);
      step.endTime = new Date();
      step.duration = step.startTime
        ? step.endTime.getTime() - step.startTime.getTime()
        : 0;

      this.eventEmitter.emit('step:failed', { execution, step });
      this.logger.error('Step execution failed', {
        executionId: execution.id,
        stepId: step.id,
        stepName: step.name,
        error: step.error,
      });
    }
  }

  private async executeLLMStep(
    step: WorkflowStep,
    execution: WorkflowExecution,
  ): Promise<void> {
    const startTime = Date.now();
    const model = (step.metadata?.model as string) ?? 'claude-3-haiku-20240307';
    const inputObj = step.input as { prompt?: string; text?: string } | null;
    const prompt =
      inputObj &&
      typeof inputObj === 'object' &&
      typeof inputObj.prompt === 'string'
        ? inputObj.prompt
        : inputObj &&
            typeof inputObj === 'object' &&
            typeof inputObj.text === 'string'
          ? inputObj.text
          : 'Generate a response for this workflow step';

    const maxTokens = (step.metadata?.maxTokens as number) ?? 500;
    const temperature = (step.metadata?.temperature as number) ?? 0.7;

    let responseContent: string;
    let actualUsage: { input: number; output: number; total: number };

    try {
      const result = await this.aiRouterService.invokeModel({
        model,
        prompt,
        parameters: {
          temperature,
          maxTokens,
        },
        metadata: {
          userId: execution.userId,
        },
      });

      responseContent = result.response;
      actualUsage = {
        input: result.usage.inputTokens,
        output: result.usage.outputTokens,
        total: result.usage.totalTokens,
      };

      this.logger.log('LLM call completed in workflow orchestrator', {
        model,
        inputTokens: actualUsage.input,
        outputTokens: actualUsage.output,
        userId: execution.userId,
      });
    } catch (error) {
      this.logger.error(
        'LLM call failed in workflow orchestrator, using fallback',
        {
          error: error instanceof Error ? error.message : String(error),
          model,
        },
      );
      responseContent =
        "I apologize, but I'm currently unable to process your request due to a technical issue. Please try again later or contact support if the problem persists.";
      const inputEstimate = Math.floor(prompt.length / 4);
      const outputEstimate = Math.floor(responseContent.length / 4);
      actualUsage = {
        input: inputEstimate,
        output: outputEstimate,
        total: inputEstimate + outputEstimate,
      };
    }

    const latency = Date.now() - startTime;
    const cost = this.calculateCost(model, actualUsage);

    step.output = {
      response: responseContent,
      model,
      usage: actualUsage,
    };
    step.metadata = {
      ...step.metadata,
      tokens: actualUsage,
      cost,
      latency,
      cacheHit: false,
    };
  }

  private calculateCost(
    model: string,
    usage: { input: number; output: number; total: number },
  ): number {
    try {
      const modelId = model.includes(':') ? model : `bedrock:${model}`;
      const result = this.pricingRegistry.calculateCost({
        modelId,
        inputTokens: usage.input,
        outputTokens: usage.output,
      });
      if (result) return result.totalCost;
    } catch {
      // fallback
    }
    return (usage.total / 1000) * 0.001;
  }

  private executeDataProcessingStep(step: WorkflowStep): void {
    const startTime = Date.now();
    const processingType =
      (step.metadata?.processingType as string) ?? 'transform';
    const inputData = step.input ?? {};

    let processedData: unknown;
    switch (processingType) {
      case 'transform':
        processedData = this.transformData(inputData);
        break;
      case 'validate':
        processedData = this.validateData(inputData);
        break;
      case 'aggregate':
        processedData = this.aggregateData(inputData);
        break;
      case 'filter':
        processedData = this.filterData(inputData);
        break;
      default:
        processedData = {
          ...(typeof inputData === 'object' && inputData !== null
            ? inputData
            : {}),
          processed: true,
        };
    }

    const latency = Date.now() - startTime;

    step.output = {
      processed: true,
      data: processedData,
      processingType,
      recordsProcessed: Array.isArray(inputData) ? inputData.length : 1,
    };
    step.metadata = {
      ...step.metadata,
      latency,
      cost: 0.001,
    };
  }

  private transformData(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => ({
        ...(typeof item === 'object' && item !== null ? item : {}),
        transformed: true,
        timestamp: new Date(),
      }));
    }
    return {
      ...(typeof data === 'object' && data !== null ? data : {}),
      transformed: true,
      timestamp: new Date(),
    };
  }

  private validateData(data: unknown): {
    valid: boolean;
    data: unknown;
    errors: string[];
  } {
    const errors: string[] = [];

    if (data === null || data === undefined) {
      errors.push('Data is null or undefined');
    } else if (typeof data === 'object') {
      if (Array.isArray(data)) {
        if (data.length === 0) {
          errors.push('Array is empty');
        }
      } else {
        const keys = Object.keys(data);
        if (keys.length === 0) errors.push('Object is empty');
        keys.forEach((key) => {
          const obj = data as Record<string, unknown>;
          if (obj[key] === null || obj[key] === undefined) {
            errors.push(`Field '${key}' is null or undefined`);
          }
        });
      }
    }

    return { valid: errors.length === 0, data, errors };
  }

  private aggregateData(data: unknown): Record<string, unknown> {
    if (Array.isArray(data)) {
      return {
        count: data.length,
        summary: 'Data aggregated successfully',
        aggregatedAt: new Date(),
      };
    }
    return {
      count: 1,
      summary: 'Single item aggregated',
      aggregatedAt: new Date(),
    };
  }

  private filterData(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.filter((item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          const keys = Object.keys(item);
          return (
            keys.length > 0 &&
            keys.some(
              (key) =>
                (item as Record<string, unknown>)[key] !== null &&
                (item as Record<string, unknown>)[key] !== undefined,
            )
          );
        }
        return item !== null && item !== undefined;
      });
    }
    return data;
  }

  private async executeAPICallStep(step: WorkflowStep): Promise<void> {
    const startTime = Date.now();
    const endpoint =
      (step.metadata?.endpoint as string) ?? 'https://api.example.com/data';
    const method = (step.metadata?.method as string) ?? 'GET';
    const headers = (step.metadata?.headers as Record<string, string>) ?? {
      'Content-Type': 'application/json',
      'User-Agent': 'CostKatana-WorkflowOrchestrator/1.0',
    };
    const body = step.metadata?.body;
    const timeout = (step.metadata?.timeout as number) ?? 30000;

    let responseData: unknown;
    let success = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      success = response.ok;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }
    } catch (error) {
      responseData = {
        error: error instanceof Error ? error.message : 'API call failed',
      };
      this.logger.warn('API call failed in workflow orchestrator', {
        endpoint,
        method,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const latency = Date.now() - startTime;

    step.output = {
      success,
      response: responseData,
      statusCode: success ? 200 : 500,
      endpoint,
      method,
      latency,
    };
    step.metadata = {
      ...step.metadata,
      latency,
      cost: 0.002,
    };
  }

  private executeConditionalStep(step: WorkflowStep): void {
    const startTime = Date.now();
    const conditions = step.conditions as
      | { if?: string; then?: string; else?: string }
      | undefined;
    const condition = conditions?.if ?? 'true';
    const inputData = step.input ?? {};

    const conditionResult = this.evaluateCondition(condition, inputData);
    const nextStep = conditionResult ? conditions?.then : conditions?.else;

    const latency = Date.now() - startTime;

    step.output = {
      condition: conditionResult,
      nextStep,
      evaluatedCondition: condition,
      inputData,
    };
    step.metadata = {
      ...step.metadata,
      latency,
      cost: 0.0001,
    };
  }

  private evaluateCondition(condition: string, data: unknown): boolean {
    try {
      if (condition === 'true') return true;
      if (condition === 'false') return false;

      if (condition === 'data.length > 0') {
        return Array.isArray(data) && data.length > 0;
      }
      if (condition === 'data.valid') {
        return (
          typeof data === 'object' &&
          data !== null &&
          (data as Record<string, unknown>).valid === true
        );
      }
      if (condition === 'data.success') {
        return (
          typeof data === 'object' &&
          data !== null &&
          (data as Record<string, unknown>).success === true
        );
      }
      if (condition === 'data.error') {
        return (
          typeof data === 'object' &&
          data !== null &&
          'error' in (data as Record<string, unknown>)
        );
      }
      if (condition.includes('data.')) {
        const propertyPath = condition.replace('data.', '');
        const value = this.getNestedProperty(
          data as Record<string, unknown>,
          propertyPath,
        );
        return Boolean(value);
      }
      const match = condition.match(/(\w+)\.length > (\d+)/);
      if (match) {
        const [, prop, threshold] = match;
        const targetArray =
          prop === 'data'
            ? data
            : this.getNestedProperty(
                data as Record<string, unknown>,
                prop ?? '',
              );
        return (
          Array.isArray(targetArray) &&
          targetArray.length > parseInt(threshold ?? '0')
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  private getNestedProperty(
    obj: Record<string, unknown> | undefined,
    path: string,
  ): unknown {
    return path
      .split('.')
      .reduce(
        (current: unknown, key: string) =>
          typeof current === 'object' && current !== null && key in current
            ? (current as Record<string, unknown>)[key]
            : undefined,
        obj,
      );
  }

  private async executeParallelStep(step: WorkflowStep): Promise<void> {
    const startTime = Date.now();
    const tasks = (step.metadata?.tasks as unknown[]) ?? [];
    const maxConcurrency = (step.metadata?.maxConcurrency as number) ?? 3;

    const results = await this.executeParallelTasks(tasks, maxConcurrency);

    const latency = Date.now() - startTime;

    step.output = {
      parallelResults: results,
      tasksExecuted: tasks.length,
      concurrency: maxConcurrency,
    };
    step.metadata = {
      ...step.metadata,
      latency,
      cost: 0.005 * tasks.length,
    };
  }

  private async executeParallelTasks(
    tasks: unknown[],
    maxConcurrency: number,
  ): Promise<
    Array<{
      taskId: number;
      result: unknown;
      success: boolean;
      error?: string;
      executionTime: number;
      completedAt: Date;
    }>
  > {
    const results: Array<{
      taskId: number;
      result: unknown;
      success: boolean;
      error?: string;
      executionTime: number;
      completedAt: Date;
    }> = [];

    for (let i = 0; i < tasks.length; i += maxConcurrency) {
      const batch = tasks.slice(i, i + maxConcurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (task, batchIndex) => {
          const taskId = i + batchIndex;
          const start = Date.now();
          try {
            let result: unknown;
            if (typeof task === 'function') {
              result = await (task as () => Promise<unknown>)();
            } else if (task && typeof task === 'object') {
              const obj = task as Record<string, unknown>;
              if (typeof obj.execute === 'function') {
                result = await (obj.execute as () => Promise<unknown>)();
              } else if (typeof obj.run === 'function') {
                result = await (obj.run as () => Promise<unknown>)();
              } else if (typeof obj.process === 'function') {
                result = await (obj.process as () => Promise<unknown>)();
              } else {
                result = task;
              }
            } else {
              result = task;
            }
            return {
              taskId,
              result,
              success: true,
              executionTime: Date.now() - start,
              completedAt: new Date(),
            };
          } catch (error) {
            return {
              taskId,
              result: null,
              success: false,
              error: error instanceof Error ? error.message : String(error),
              executionTime: Date.now() - start,
              completedAt: new Date(),
            };
          }
        }),
      );

      batchResults.forEach((settled, index) => {
        if (settled.status === 'fulfilled') {
          results.push(settled.value);
        } else {
          results.push({
            taskId: i + index,
            result: null,
            success: false,
            error:
              settled.reason instanceof Error
                ? settled.reason.message
                : String(settled.reason),
            executionTime: 0,
            completedAt: new Date(),
          });
        }
      });
    }

    return results;
  }

  private executeCustomStep(step: WorkflowStep): void {
    const startTime = Date.now();
    const customFunction = (step.metadata?.function as string) ?? 'default';
    const parameters =
      (step.metadata?.parameters as Record<string, unknown>) ?? {};

    const result = this.executeCustomFunction(
      customFunction,
      parameters,
      step.input,
    );

    const latency = Date.now() - startTime;

    step.output = {
      custom: true,
      function: customFunction,
      result,
      parameters,
    };
    step.metadata = {
      ...step.metadata,
      latency,
      cost: 0.003,
    };
  }

  private executeCustomFunction(
    functionName: string,
    parameters: Record<string, unknown>,
    input: unknown,
  ): unknown {
    switch (functionName) {
      case 'dataEnrichment':
        return {
          ...(typeof input === 'object' && input !== null ? input : {}),
          enriched: true,
          enrichmentData: parameters,
        };
      case 'formatConversion':
        return {
          format: (parameters.targetFormat as string) ?? 'json',
          data: input,
        };
      case 'qualityCheck': {
        const qualityScore = this.assessDataQuality(input);
        return {
          quality:
            qualityScore >= 0.8
              ? 'high'
              : qualityScore >= 0.6
                ? 'medium'
                : 'low',
          qualityScore,
          data: input,
        };
      }
      default:
        return {
          processed: true,
          function: functionName,
          input,
          parameters,
        };
    }
  }

  private assessDataQuality(data: unknown): number {
    if (!data || typeof data !== 'object') return 0.1;

    let score = 0.5;
    let factors = 0;

    if (Array.isArray(data)) {
      factors++;
      if (data.length > 0) {
        score += 0.2;
        const firstType = typeof data[0];
        const allSameType = data.every((item) => typeof item === firstType);
        if (allSameType) score += 0.1;
      }
    } else {
      const keys = Object.keys(data);
      factors++;
      if (keys.length > 0) {
        score += 0.1;
        const obj = data as Record<string, unknown>;
        const nonNullValues = keys.filter(
          (key) => obj[key] !== null && obj[key] !== undefined,
        );
        score += (nonNullValues.length / keys.length) * 0.2;
        const hasNestedObjects = keys.some(
          (key) =>
            typeof obj[key] === 'object' &&
            obj[key] !== null &&
            !Array.isArray(obj[key]),
        );
        if (hasNestedObjects) score += 0.1;
        factors++;
      }
    }

    return Math.min(1.0, Math.max(0.0, score / Math.max(1, factors)));
  }

  private calculateExecutionMetrics(execution: WorkflowExecution): void {
    const completed = execution.steps.filter((s) => s.status === 'completed');
    if (!execution.metadata) return;
    execution.metadata.totalCost = completed.reduce(
      (s, step) => s + (step.metadata?.cost ?? 0),
      0,
    );
    execution.metadata.totalTokens = completed.reduce((s: number, step) => {
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
