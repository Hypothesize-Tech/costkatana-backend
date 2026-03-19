import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AIRouterService } from '../../cortex/services/ai-router.service';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface WorkflowStep {
  id: string;
  name: string;
  type:
    | 'llm_call'
    | 'data_processing'
    | 'api_call'
    | 'conditional'
    | 'parallel'
    | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: {
    model?: string;
    provider?: string;
    tokens?: {
      input: number;
      output: number;
      total: number;
    };
    cost?: number;
    retryAttempts?: number;
    cacheHit?: boolean;
    latency?: number;
    [key: string]: unknown;
  };
  dependencies?: string[];
  conditions?: {
    if: string;
    then: string;
    else?: string;
  };
}

export interface AgentTraceExecution {
  id: string;
  traceId: string;
  name: string;
  userId: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  steps: WorkflowStep[];
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: {
    totalCost?: number;
    totalTokens?: number;
    cacheHitRate?: number;
    averageLatency?: number;
    environment?: string;
    version?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  executionTraceId?: string;
  parentExecutionId?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version?: string;
  userId: string;
  steps: WorkflowStepTemplate[];
  variables?: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'object';
      required: boolean;
      default?: unknown;
      description?: string;
    };
  };
  triggers?: {
    type: 'manual' | 'webhook' | 'schedule' | 'event';
    config: unknown;
  }[];
  settings?: {
    timeout?: number;
    retryPolicy?: {
      maxRetries: number;
      factor?: number;
      minTimeout: number;
    };
    parallelism?: number;
    cacheEnabled?: boolean;
  };
}

export interface WorkflowStepTemplate {
  id: string;
  name: string;
  type:
    | 'llm_call'
    | 'data_processing'
    | 'api_call'
    | 'conditional'
    | 'parallel'
    | 'custom';
  config: {
    provider?: string;
    model?: string;
    prompt?: string;
    parameters?: Record<string, unknown>;
    conditions?: unknown;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    urls?: string[];
    branches?: Array<{ type: string; config: Record<string, unknown> }>;
    [key: string]: unknown;
  };
  dependencies?: string[];
}

const DEFAULT_LLM_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';

/**
 * Agent Trace Orchestrator Service
 * Workflow management, tracing, and observability with real LLM, API, and conditional execution.
 */
@Injectable()
export class AgentTraceOrchestratorService {
  private readonly logger = new Logger(AgentTraceOrchestratorService.name);
  private activeExecutions = new Map<string, AgentTraceExecution>();
  private workflowTemplates = new Map<string, WorkflowTemplate>();

  constructor(
    private eventEmitter: EventEmitter2,
    private readonly aiRouterService: AIRouterService,
    private readonly httpService: HttpService,
  ) {}

  async executeWorkflow(
    userId: string,
    templateId: string,
    input: Record<string, unknown> = {},
    options: {
      executionTraceId?: string;
      parentExecutionId?: string;
      variables?: Record<string, unknown>;
      timeout?: number;
    } = {},
  ): Promise<AgentTraceExecution> {
    const template = this.workflowTemplates.get(templateId);
    if (!template) {
      throw new Error(`Workflow template ${templateId} not found`);
    }

    const executionId = this.generateExecutionId();
    const executionTraceId =
      options.executionTraceId ?? this.generateExecutionId();

    const execution: AgentTraceExecution = {
      id: executionId,
      traceId: templateId,
      name: template.name,
      userId,
      status: 'running',
      startTime: new Date(),
      steps: this.initializeSteps(template.steps),
      input,
      metadata: {
        environment: process.env.NODE_ENV ?? 'development',
        version: template.version ?? '1.0.0',
        tags: [],
        ...options,
      },
      executionTraceId,
      parentExecutionId: options.parentExecutionId,
    };

    this.activeExecutions.set(executionId, execution);
    this.eventEmitter.emit('workflow.execution.started', execution);

    this.executeWorkflowSteps(
      execution,
      template,
      input,
      options.variables ?? {},
      template.settings?.timeout ?? options.timeout,
    )
      .then((completedExecution) => {
        this.eventEmitter.emit(
          'workflow.execution.completed',
          completedExecution,
        );
      })
      .catch((error) => {
        this.logger.error(`Workflow execution failed: ${executionId}`, error);
        this.eventEmitter.emit('workflow.execution.failed', {
          execution,
          error,
        });
      });

    return execution;
  }

  private initializeSteps(templates: WorkflowStepTemplate[]): WorkflowStep[] {
    return templates.map((template) => {
      const conditions = template.config?.conditions as
        | { if?: string; then?: string; else?: string }
        | undefined;
      return {
        id: template.id,
        name: template.name,
        type: template.type,
        status: 'pending',
        metadata: {},
        dependencies: template.dependencies ?? [],
        ...(conditions?.if != null && {
          conditions: {
            if: conditions.if,
            then: conditions.then ?? conditions.if,
            else: conditions.else,
          },
        }),
      };
    });
  }

  private async executeWorkflowSteps(
    execution: AgentTraceExecution,
    template: WorkflowTemplate,
    input: Record<string, unknown>,
    variables: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<AgentTraceExecution> {
    const context: Record<string, unknown> = { ...input, ...variables };
    const completedStepIds = new Set<string>();
    const startTime = execution.startTime.getTime();

    for (const step of execution.steps) {
      if (
        timeoutMs != null &&
        timeoutMs > 0 &&
        Date.now() - startTime > timeoutMs
      ) {
        execution.status = 'failed';
        execution.error = 'Workflow execution timeout';
        execution.endTime = new Date();
        execution.duration = execution.endTime.getTime() - startTime;
        this.eventEmitter.emit('workflow.execution.failed', {
          execution,
          error: new Error(execution.error),
        });
        return execution;
      }

      if (this.shouldSkipStep(step, execution, completedStepIds)) {
        step.status = 'skipped';
        continue;
      }

      step.status = 'running';
      step.startTime = new Date();

      try {
        const result = await this.executeStep(
          step,
          template,
          context,
          execution,
        );
        step.output = result.output;
        step.metadata = { ...step.metadata, ...result.metadata };
        step.status = 'completed';
        step.endTime = new Date();
        step.duration = step.endTime.getTime() - step.startTime.getTime();

        context[step.id] = result.output;
        completedStepIds.add(step.id);
        this.eventEmitter.emit('workflow.step.completed', { execution, step });
      } catch (error) {
        step.status = 'failed';
        step.error = error instanceof Error ? error.message : String(error);
        step.endTime = new Date();
        step.duration = step.endTime.getTime() - step.startTime.getTime();
        this.eventEmitter.emit('workflow.step.failed', {
          execution,
          step,
          error,
        });
        execution.status = 'failed';
        execution.error = step.error;
        execution.endTime = new Date();
        execution.duration =
          execution.endTime.getTime() - execution.startTime.getTime();
        return execution;
      }
    }

    execution.status = 'completed';
    execution.output = context;
    execution.endTime = new Date();
    execution.duration =
      execution.endTime.getTime() - execution.startTime.getTime();
    this.calculateExecutionMetadata(execution);
    return execution;
  }

  private shouldSkipStep(
    step: WorkflowStep,
    execution: AgentTraceExecution,
    completedStepIds: Set<string>,
  ): boolean {
    if (step.dependencies && step.dependencies.length > 0) {
      const allCompleted = step.dependencies.every((depId) =>
        completedStepIds.has(depId),
      );
      if (!allCompleted) return true;
    }

    if (step.conditions?.if) {
      const result = this.evaluateCondition(
        step.conditions.if,
        execution,
        completedStepIds,
      );
      if (result === false) return true;
    }

    return false;
  }

  /**
   * Safe condition evaluation: supports context.key, input.key, steps.<id>.completed, and simple comparisons (===, !==, >, <, >=, <=).
   */
  private evaluateCondition(
    expression: string,
    execution: AgentTraceExecution,
    completedStepIds: Set<string>,
  ): boolean {
    const context =
      ((execution.output ?? execution.input) as Record<string, unknown>) ?? {};
    const input = (execution.input ?? {}) as Record<string, unknown>;

    const trimmed = expression.trim();

    const stepsMatch = trimmed.match(/^steps\.([\w.-]+)\.completed$/i);
    if (stepsMatch) {
      return completedStepIds.has(stepsMatch[1]);
    }

    const pathMatch = trimmed.match(/^(context|input)\.([\w.]+)$/);
    if (pathMatch) {
      const source = pathMatch[1] === 'context' ? context : input;
      const value = this.getByPath(source, pathMatch[2]);
      return Boolean(value);
    }

    const eqMatch = trimmed.match(/^(context|input)\.([\w.]+)\s*===\s*(.+)$/);
    if (eqMatch) {
      const source = eqMatch[1] === 'context' ? context : input;
      const left = this.getByPath(source, eqMatch[2]);
      const right = this.parseLiteral(eqMatch[3].trim());
      return left === right;
    }

    const neMatch = trimmed.match(/^(context|input)\.([\w.]+)\s*!==\s*(.+)$/);
    if (neMatch) {
      const source = neMatch[1] === 'context' ? context : input;
      const left = this.getByPath(source, neMatch[2]);
      const right = this.parseLiteral(neMatch[3].trim());
      return left !== right;
    }

    const cmpMatch = trimmed.match(
      /^(context|input)\.([\w.]+)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/,
    );
    if (cmpMatch) {
      const source = cmpMatch[1] === 'context' ? context : input;
      const left = Number(this.getByPath(source, cmpMatch[2]));
      const right = Number(cmpMatch[4]);
      switch (cmpMatch[3]) {
        case '>':
          return left > right;
        case '<':
          return left < right;
        case '>=':
          return left >= right;
        case '<=':
          return left <= right;
        default:
          return false;
      }
    }

    this.logger.warn(`Unsupported condition expression: ${expression}`);
    return false;
  }

  private getByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private parseLiteral(s: string): unknown {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    const num = Number(s);
    if (!Number.isNaN(num)) return num;
    const quoted = s.match(/^['"](.*)['"]$/);
    if (quoted) return quoted[1];
    return s;
  }

  private async executeStep(
    step: WorkflowStep,
    template: WorkflowTemplate,
    context: Record<string, unknown>,
    execution: AgentTraceExecution,
  ): Promise<{ output: unknown; metadata: Record<string, unknown> }> {
    const templateStep = template.steps.find((s) => s.id === step.id);
    if (!templateStep) {
      throw new Error(`Step template not found: ${step.id}`);
    }

    switch (step.type) {
      case 'llm_call':
        return this.executeLLMStep(step, templateStep, context);
      case 'data_processing':
        return this.executeDataProcessingStep(step, templateStep, context);
      case 'api_call':
        return this.executeAPIStep(step, templateStep, context);
      case 'conditional':
        return this.executeConditionalStep(
          step,
          templateStep,
          context,
          execution,
        );
      case 'parallel':
        return this.executeParallelStep(step, templateStep, context);
      default:
        return {
          output: null,
          metadata: { customStep: true, stepType: step.type },
        };
    }
  }

  private async executeLLMStep(
    step: WorkflowStep,
    templateStep: WorkflowStepTemplate,
    context: Record<string, unknown>,
  ): Promise<{ output: unknown; metadata: Record<string, unknown> }> {
    const stepContext = {
      ...context,
      ...((step.input ?? {}) as Record<string, unknown>),
    };
    const prompt = this.interpolateVariables(
      String(templateStep.config.prompt ?? ''),
      stepContext,
    );
    const modelName = String(templateStep.config.model ?? 'gpt-3.5-turbo');
    const provider = String(templateStep.config.provider ?? 'openai');
    const bedrockModelId = this.toBedrockModelId(provider, modelName);
    const params = templateStep.config.parameters ?? {};

    const start = Date.now();
    const result = await this.aiRouterService.invokeModel({
      model: bedrockModelId,
      prompt,
      parameters: {
        temperature:
          typeof params.temperature === 'number' ? params.temperature : 0.7,
        maxTokens:
          typeof params.maxTokens === 'number' ? params.maxTokens : 2048,
      },
    });

    const latency = Date.now() - start;
    const usage = result.usage as {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    const tokens = {
      input: usage?.inputTokens ?? 0,
      output: usage?.outputTokens ?? 0,
      total:
        usage?.totalTokens ??
        (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
    };
    const output = {
      response: result.response,
      model: result.model,
      tokens,
      stepId: step.id,
      stepName: step.name,
    };

    return {
      output,
      metadata: {
        stepId: step.id,
        stepName: step.name,
        model: result.model,
        provider: templateStep.config.provider ?? 'openai',
        tokens,
        cost: result.cost,
        latency,
        cacheHit: false,
      },
    };
  }

  private async executeDataProcessingStep(
    step: WorkflowStep,
    templateStep: WorkflowStepTemplate,
    context: Record<string, unknown>,
  ): Promise<{ output: unknown; metadata: Record<string, unknown> }> {
    const input = (step.input ?? context) as Record<string, unknown>;
    const config = (templateStep.config ?? {}) as {
      pickKeys?: string[];
      rename?: Record<string, string>;
    };
    const start = Date.now();

    let outputObj: Record<string, unknown>;
    if (
      config.pickKeys &&
      Array.isArray(config.pickKeys) &&
      config.pickKeys.length > 0
    ) {
      outputObj = {};
      for (const key of config.pickKeys) {
        if (key in input) outputObj[key] = input[key];
      }
    } else {
      outputObj = { ...input };
    }

    if (
      config.rename &&
      typeof config.rename === 'object' &&
      Object.keys(config.rename).length > 0
    ) {
      const renamed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(outputObj)) {
        const newKey = config.rename[k] ?? k;
        renamed[newKey] = v;
      }
      outputObj = renamed;
    }

    const output = {
      processed: true,
      data: outputObj,
      inputSize: JSON.stringify(input).length,
      outputSize: JSON.stringify(outputObj).length,
      keys: Object.keys(outputObj),
    };
    const processingTime = Date.now() - start;
    return {
      output,
      metadata: {
        stepId: step.id,
        stepName: step.name,
        processingTime,
        inputSize: output.inputSize,
        outputSize: output.outputSize,
      },
    };
  }

  private async executeAPIStep(
    step: WorkflowStep,
    templateStep: WorkflowStepTemplate,
    context: Record<string, unknown>,
  ): Promise<{ output: unknown; metadata: Record<string, unknown> }> {
    const url = this.interpolateVariables(
      String(templateStep.config.url ?? ''),
      context,
    );
    if (!url) {
      throw new Error('API step missing config.url');
    }
    const method = String(templateStep.config.method ?? 'GET').toUpperCase();
    const headers = templateStep.config.headers ?? {};
    const start = Date.now();

    const rawBody =
      method !== 'GET' ? (templateStep.config.body ?? {}) : undefined;
    const data =
      rawBody != null && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? this.interpolateInObject(rawBody as Record<string, unknown>, context)
        : rawBody;

    const requestConfig = {
      url,
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 30000,
    };

    const response = await firstValueFrom(
      this.httpService.request({
        ...requestConfig,
        data,
      }),
    );

    const latency = Date.now() - start;
    const output = {
      status: response.status,
      data: response.data,
      headers: response.headers as Record<string, unknown>,
    };

    return {
      output,
      metadata: {
        stepId: step.id,
        stepName: step.name,
        latency,
        statusCode: response.status,
      },
    };
  }

  private async executeConditionalStep(
    step: WorkflowStep,
    templateStep: WorkflowStepTemplate,
    context: Record<string, unknown>,
    execution: AgentTraceExecution,
  ): Promise<{ output: unknown; metadata: Record<string, unknown> }> {
    const completedIds = new Set(
      execution.steps.filter((s) => s.status === 'completed').map((s) => s.id),
    );
    const conditionExpr = templateStep.config.conditions
      ? (templateStep.config.conditions as { if?: string }).if
      : (templateStep.config as { if?: string }).if;
    const result = conditionExpr
      ? this.evaluateCondition(conditionExpr, execution, completedIds)
      : false;

    const output = {
      condition: conditionExpr,
      result,
      nextStep: result ? step.conditions?.then : step.conditions?.else,
    };
    return {
      output,
      metadata: {
        stepId: step.id,
        stepName: step.name,
        conditional: true,
        result,
      },
    };
  }

  private async executeParallelStep(
    step: WorkflowStep,
    templateStep: WorkflowStepTemplate,
    context: Record<string, unknown>,
  ): Promise<{ output: unknown; metadata: Record<string, unknown> }> {
    const urls = templateStep.config.urls;
    if (urls && Array.isArray(urls)) {
      const start = Date.now();
      const results = await Promise.all(
        urls.map((u) =>
          firstValueFrom(
            this.httpService.get(this.interpolateVariables(u, context), {
              timeout: 15000,
            }),
          ).then((r) => ({ status: r.status, data: r.data })),
        ),
      );
      const latency = Date.now() - start;
      return {
        output: { parallelExecution: true, results },
        metadata: {
          stepId: step.id,
          stepName: step.name,
          parallel: true,
          branchCount: results.length,
          latency,
        },
      };
    }

    const branches = templateStep.config.branches as
      | Array<{ type: string; config: Record<string, unknown> }>
      | undefined;
    if (branches && branches.length > 0) {
      const start = Date.now();
      const outputs = await Promise.all(
        branches.map(async (branch) => {
          if (branch.type === 'api_call') {
            const url =
              typeof branch.config.url === 'string'
                ? branch.config.url
                : String(branch.config.url ?? '');
            if (!url)
              return { type: 'api_call' as const, error: 'Missing url' };
            const r = await firstValueFrom(
              this.httpService.get(this.interpolateVariables(url, context), {
                timeout: 15000,
              }),
            );
            return {
              type: 'api_call' as const,
              status: r.status,
              data: r.data,
            };
          }
          if (branch.type === 'llm_call') {
            const promptRaw =
              branch.config.prompt ?? branch.config.promptTemplate ?? '';
            const prompt =
              typeof promptRaw === 'string'
                ? promptRaw
                : String(promptRaw ?? '');
            if (prompt === '')
              return { type: 'llm_call' as const, error: 'Missing prompt' };
            const modelName =
              typeof branch.config.model === 'string'
                ? branch.config.model
                : String(branch.config.model ?? 'gpt-3.5-turbo');
            const provider =
              typeof branch.config.provider === 'string'
                ? branch.config.provider
                : String(branch.config.provider ?? 'openai');
            const bedrockModelId = this.toBedrockModelId(provider, modelName);
            const params = (branch.config.parameters ?? {}) as Record<
              string,
              unknown
            >;
            const result = await this.aiRouterService.invokeModel({
              model: bedrockModelId,
              prompt,
              parameters: {
                temperature:
                  typeof params.temperature === 'number'
                    ? params.temperature
                    : 0.7,
                maxTokens:
                  typeof params.maxTokens === 'number'
                    ? params.maxTokens
                    : 2048,
              },
            });
            const usage = result.usage as {
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
            };
            return {
              type: 'llm_call' as const,
              response: result.response,
              model: result.model,
              cost: result.cost,
              latency: result.latency,
              tokens: {
                input: usage?.inputTokens ?? 0,
                output: usage?.outputTokens ?? 0,
                total:
                  usage?.totalTokens ??
                  (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
              },
            };
          }
          return { type: branch.type, config: branch.config };
        }),
      );
      const latency = Date.now() - start;
      return {
        output: { parallelExecution: true, branches: outputs },
        metadata: {
          stepId: step.id,
          stepName: step.name,
          parallel: true,
          branchCount: outputs.length,
          latency,
        },
      };
    }

    return {
      output: { parallelExecution: true, branches: [] },
      metadata: {
        stepId: step.id,
        stepName: step.name,
        parallel: true,
        branchCount: 0,
      },
    };
  }

  private calculateExecutionMetadata(execution: AgentTraceExecution): void {
    if (!execution.metadata) execution.metadata = {};
    const completedSteps = execution.steps.filter(
      (s) => s.status === 'completed',
    );
    execution.metadata.totalCost = completedSteps.reduce(
      (sum, s) => sum + (Number(s.metadata?.cost) || 0),
      0,
    );
    execution.metadata.totalTokens = completedSteps.reduce(
      (sum, s) => sum + (Number(s.metadata?.tokens?.total) || 0),
      0,
    );
    const cacheHits = completedSteps.filter((s) => s.metadata?.cacheHit).length;
    execution.metadata.cacheHitRate =
      completedSteps.length > 0 ? (cacheHits / completedSteps.length) * 100 : 0;
    const latencies = completedSteps
      .map((s) => s.metadata?.latency)
      .filter((l) => l !== undefined);
    execution.metadata.averageLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;
  }

  private interpolateVariables(
    template: string,
    context: Record<string, unknown>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      return context[key] !== undefined ? String(context[key]) : _match;
    });
  }

  /**
   * Recursively interpolate {{key}} in string values of an object.
   */
  private interpolateInObject(
    obj: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        result[k] = this.interpolateVariables(v, context);
      } else if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        result[k] = this.interpolateInObject(
          v as Record<string, unknown>,
          context,
        );
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  private toBedrockModelId(provider: string, modelName: string): string {
    const normalized = modelName.toLowerCase().replace(/\s+/g, '-');
    if (provider.toLowerCase() === 'bedrock') return normalized;
    const mapping: Record<string, string> = {
      'gpt-3.5-turbo': DEFAULT_LLM_MODEL,
      'gpt-4': 'anthropic.claude-3-sonnet-20240229-v1:0',
      'claude-3-haiku': DEFAULT_LLM_MODEL,
      'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
    };
    return mapping[normalized] ?? DEFAULT_LLM_MODEL;
  }

  private generateExecutionId(): string {
    return generateSecureId('exec');
  }

  async createWorkflowTemplate(
    template: Omit<WorkflowTemplate, 'id'>,
  ): Promise<WorkflowTemplate> {
    if (
      !template.steps ||
      !Array.isArray(template.steps) ||
      template.steps.length === 0
    ) {
      throw new Error('Workflow template must have at least one step');
    }
    const id = generateSecureId('template');
    const workflowTemplate: WorkflowTemplate = { ...template, id };
    this.workflowTemplates.set(id, workflowTemplate);
    this.logger.log(`Workflow template created: ${id}`, {
      name: template.name,
      userId: template.userId,
      stepCount: template.steps.length,
    });
    return workflowTemplate;
  }

  getExecution(executionId: string): AgentTraceExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  async pauseExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution || execution.status !== 'running') return false;
    execution.status = 'paused';
    this.eventEmitter.emit('workflow.execution.paused', execution);
    return true;
  }

  async resumeExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution || execution.status !== 'paused') return false;
    execution.status = 'running';
    this.eventEmitter.emit('workflow.execution.resumed', execution);
    return true;
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (
      !execution ||
      ['completed', 'failed', 'cancelled'].includes(execution.status)
    ) {
      return false;
    }
    execution.status = 'cancelled';
    execution.endTime = new Date();
    execution.duration =
      execution.endTime.getTime() - execution.startTime.getTime();
    this.eventEmitter.emit('workflow.execution.cancelled', execution);
    return true;
  }

  getActiveExecutions(userId: string): AgentTraceExecution[] {
    return Array.from(this.activeExecutions.values()).filter(
      (e) => e.userId === userId && e.status === 'running',
    );
  }
}
