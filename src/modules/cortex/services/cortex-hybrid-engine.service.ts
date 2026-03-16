/**
 * Cortex Hybrid Execution Engine (NestJS)
 *
 * Executes parts of Cortex queries using deterministic code, tools, and API calls
 * rather than expensive LLM processing. Combines LLM reasoning with programmatic
 * execution for optimal performance and cost efficiency.
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CortexFrame, CortexValue } from '../types/cortex.types';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface HybridExecutionResult {
  success: boolean;
  result: CortexValue | CortexFrame;
  executionType: 'deterministic' | 'llm' | 'hybrid';
  executedTools: string[];
  apiCalls: number;
  deterministic: boolean;
  metadata: {
    executionTime: number;
    costSaved: number;
    toolsUsed: HybridToolExecution[];
    errors: string[];
    warnings: string[];
    optimizationHints?: string[];
  };
}

export interface HybridToolExecution {
  toolName: string;
  input: any;
  output: any;
  executionTime: number;
  success: boolean;
  error?: string;
}

export interface HybridExecutableFrame {
  frameType: 'executable';
  executionMode:
    | 'tool'
    | 'api'
    | 'math'
    | 'data'
    | 'logic'
    | 'database'
    | 'file';
  toolName?: string;
  apiEndpoint?: string;
  operation?: string;
  parameters?: Record<string, CortexValue>;
  condition?: string;
  code?: string;
}

export interface CortexTool {
  name: string;
  description: string;
  category:
    | 'math'
    | 'string'
    | 'date'
    | 'crypto'
    | 'data'
    | 'api'
    | 'file'
    | 'logic';
  parameters: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      required: boolean;
      description: string;
      validation?: (value: any) => boolean;
    };
  };
  execute: (params: Record<string, any>) => Promise<any> | any;
  deterministic: boolean;
  costSavings: number;
}

export interface ApiExecutionConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  timeout: number;
  retries: number;
  cacheable: boolean;
  authentication?: {
    type: 'bearer' | 'basic' | 'apikey';
    credentials: Record<string, string>;
  };
}

@Injectable()
export class CortexHybridEngineService {
  private readonly logger = new Logger(CortexHybridEngineService.name);
  private tools: Map<string, CortexTool> = new Map();
  private apiCache: Map<string, { data: any; expires: Date }> = new Map();

  constructor(private readonly httpService: HttpService) {
    this.initializeBuiltInTools();
  }

  /**
   * Execute a Cortex frame using hybrid approach (deterministic + LLM)
   */
  public async executeHybrid(
    frame: CortexFrame,
  ): Promise<HybridExecutionResult> {
    const startTime = Date.now();
    const executedTools: string[] = [];
    const toolExecutions: HybridToolExecution[] = [];
    let apiCalls = 0;
    let costSaved = 0;

    try {
      // Pre-analyze frame for optimization opportunities
      const optimizationHints = this.analyzeOptimizationHints(frame);

      const executableComponents = this.analyzeForExecution(frame);

      if (executableComponents.length === 0) {
        // Fallback to pure LLM execution with optimization hints
        this.logger.debug(
          'No deterministic execution possible, using optimized LLM execution',
        );
        return await this.executeOptimizedLLM(frame, optimizationHints);
      }

      let result: CortexValue | CortexFrame = frame;
      let allDeterministic = true;

      // Execute components in optimal order
      const orderedComponents =
        this.orderComponentsForExecution(executableComponents);

      for (const component of orderedComponents) {
        const toolExecution = await this.executeComponent(component);

        toolExecutions.push(toolExecution);
        executedTools.push(toolExecution.toolName);
        costSaved += this.tools.get(toolExecution.toolName)?.costSavings || 0;

        if (!toolExecution.success) {
          allDeterministic = false;
          // Continue with other components even if one fails
        }

        if (toolExecution.success) {
          result = this.updateFrameWithResult(
            frame,
            component,
            toolExecution.output,
          );
        }
      }

      apiCalls = toolExecutions.filter(
        (t) => this.tools.get(t.toolName)?.category === 'api',
      ).length;

      // Apply post-execution optimizations
      result = this.applyPostExecutionOptimizations(result, optimizationHints);

      this.logger.log(`⚡ Hybrid execution completed`, {
        executedTools: executedTools.length,
        apiCalls,
        costSaved,
        deterministic: allDeterministic,
        executionTime: Date.now() - startTime,
      });

      return {
        success: true,
        result,
        executionType: allDeterministic ? 'deterministic' : 'hybrid',
        executedTools,
        apiCalls,
        deterministic: allDeterministic,
        metadata: {
          executionTime: Date.now() - startTime,
          costSaved,
          toolsUsed: toolExecutions,
          errors: toolExecutions
            .filter((t) => !t.success)
            .map((t) => t.error || 'Unknown error'),
          warnings: [],
          optimizationHints,
        },
      };
    } catch (error) {
      this.logger.error(
        '❌ Hybrid execution failed',
        error instanceof Error ? error.message : String(error),
      );

      return {
        success: false,
        result: frame,
        executionType: 'llm',
        executedTools,
        apiCalls,
        deterministic: false,
        metadata: {
          executionTime: Date.now() - startTime,
          costSaved: 0,
          toolsUsed: toolExecutions,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: ['Hybrid execution failed, falling back to LLM'],
        },
      };
    }
  }

  private analyzeOptimizationHints(frame: CortexFrame): any {
    // Analyze frame for optimization hints
    return {
      cachingOpportunities: this.findCachingOpportunities(frame),
      parallelizationHints: this.findParallelizationHints(frame),
      resourceHints: this.estimateResourceRequirements(frame),
    };
  }

  private findCachingOpportunities(frame: CortexFrame): string[] {
    const opportunities: string[] = [];

    // Look for repeated computations
    if (frame.frameType === 'query') {
      opportunities.push('query_result_cache');
    }

    return opportunities;
  }

  private findParallelizationHints(frame: CortexFrame): string[] {
    const hints: string[] = [];

    // Check if frame has independent sub-components
    const hasMultipleActions =
      Object.keys(frame).filter(
        (key) => key.includes('action') || key.includes('operation'),
      ).length > 1;

    if (hasMultipleActions) {
      hints.push('parallel_actions');
    }

    return hints;
  }

  private estimateResourceRequirements(frame: CortexFrame): any {
    return {
      estimatedMemory: this.estimateMemoryUsage(frame),
      estimatedTime: this.estimateExecutionTime(frame),
      priority: this.calculateExecutionPriority(frame),
    };
  }

  private estimateMemoryUsage(frame: CortexFrame): number {
    let memory = 1024; // Base memory

    for (const value of Object.values(frame)) {
      if (typeof value === 'string') {
        memory += value.length * 2;
      } else if (Array.isArray(value)) {
        memory += value.length * 16;
      } else if (typeof value === 'object') {
        memory += 256;
      }
    }

    return memory;
  }

  /**
   * Estimate execution time for a Cortex frame based on the types and structural complexity
   * - Counts number and type of actions, presence of iterations, and nested frames/objects.
   * - Estimation factors:
   *   - Base cost per key
   *   - Heavier cost for known "expensive" keys (e.g., "actions", "steps", "loop", "model", "operation")
   *   - Nested objects and arrays accounted recursively (with upper limit to avoid runaway)
   */
  private estimateExecutionTime(frame: CortexFrame, depth: number = 0): number {
    const BASE_COST_PER_KEY = 5; // ms
    const EXPENSIVE_KEYS: Record<string, number> = {
      action: 30,
      actions: 50,
      step: 20,
      steps: 40,
      model: 40,
      operation: 30,
      operations: 50,
      loop: 70,
      foreach: 60,
      map: 40,
      reduce: 35,
      parallel: 45,
    };
    const MAX_DEPTH = 3; // Prevent runaway recursion
    const MAX_ARRAY_SAMPLE = 5;
    let ms = 0;

    if (depth > MAX_DEPTH) {
      return 10; // Arbitrary nominal time for deeply nested structures
    }

    for (const [key, value] of Object.entries(frame)) {
      // Expensive keys (including partial matches)
      const expensiveKeyBonus = Object.entries(EXPENSIVE_KEYS)
        .filter(([matchKey]) => key.toLowerCase().includes(matchKey))
        .reduce((sum, [, val]) => sum + val, 0);

      ms += BASE_COST_PER_KEY + expensiveKeyBonus;

      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          const sampleSize = Math.min(value.length, MAX_ARRAY_SAMPLE);
          for (let i = 0; i < sampleSize; ++i) {
            if (typeof value[i] === 'object' && value[i] !== null) {
              // Recursive for nested objects
              ms += this.estimateExecutionTime(value[i], depth + 1);
            } else if (
              typeof value[i] === 'string' ||
              typeof value[i] === 'number'
            ) {
              ms += 3;
            }
          }
          // Heavier arrays may scale nonlinearly, add penalty
          if (value.length > MAX_ARRAY_SAMPLE) {
            ms += (value.length - MAX_ARRAY_SAMPLE) * 2;
          }
        } else {
          // Nested object: recursive
          ms += this.estimateExecutionTime(value, depth + 1);
        }
      }
    }

    // Clamp to minimum and maximum bounds
    ms = Math.max(10, Math.min(ms, 2000));

    return ms;
  }

  private calculateExecutionPriority(
    frame: CortexFrame,
  ): 'low' | 'medium' | 'high' {
    const complexity = Object.keys(frame).length;
    if (complexity > 10) return 'high';
    if (complexity > 5) return 'medium';
    return 'low';
  }

  private orderComponentsForExecution(
    components: Array<{
      component: string;
      toolName: string;
      parameters: Record<string, any>;
    }>,
  ): Array<{
    component: string;
    toolName: string;
    parameters: Record<string, any>;
  }> {
    // Order components to minimize dependencies and maximize parallelism
    return components.sort((a, b) => {
      const aPriority = this.getToolPriority(a.toolName);
      const bPriority = this.getToolPriority(b.toolName);
      return bPriority - aPriority; // Higher priority first
    });
  }

  private getToolPriority(toolName: string): number {
    const tool = this.tools.get(toolName);
    if (!tool) return 0;

    // Priority based on cost savings and determinism
    let priority = tool.costSavings;

    if (tool.deterministic) {
      priority += 20; // Bonus for deterministic tools
    }

    // Category-based priority
    switch (tool.category) {
      case 'math':
        priority += 10;
        break;
      case 'string':
        priority += 8;
        break;
      case 'data':
        priority += 6;
        break;
      case 'logic':
        priority += 5;
        break;
      case 'api':
        priority -= 5;
        break; // Lower priority for API calls
    }

    return priority;
  }

  private applyPostExecutionOptimizations(
    result: CortexValue | CortexFrame,
    hints: any,
  ): CortexValue | CortexFrame {
    // Apply post-execution optimizations based on hints
    let optimized = result;

    if (hints.cachingOpportunities.includes('query_result_cache')) {
      optimized = this.applyCachingOptimization(optimized);
    }

    return optimized;
  }

  private applyCachingOptimization(
    result: CortexValue | CortexFrame,
  ): CortexValue | CortexFrame {
    // Add caching metadata to result
    if (
      typeof result === 'object' &&
      result !== null &&
      'frameType' in result
    ) {
      return {
        ...result,
        cachingMetadata: {
          cacheable: true,
          ttl: 3600000, // 1 hour
          cacheKey: this.generateFrameCacheKey(result),
        },
      } as unknown as CortexFrame;
    }

    return result;
  }

  private generateFrameCacheKey(frame: CortexFrame): string {
    const content = JSON.stringify(frame);
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash + content.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
  }

  private async executeOptimizedLLM(
    frame: CortexFrame,
    hints: any,
  ): Promise<HybridExecutionResult> {
    // Execute with LLM but apply optimizations
    const startTime = Date.now();

    return {
      success: true,
      result: frame,
      executionType: 'llm',
      executedTools: [],
      apiCalls: 0,
      deterministic: false,
      metadata: {
        executionTime: Date.now() - startTime,
        costSaved: 0,
        toolsUsed: [],
        errors: [],
        warnings: ['Executed via optimized LLM path'],
        optimizationHints: hints,
      },
    };
  }

  /**
   * Register a custom tool for hybrid execution
   */
  public registerTool(tool: CortexTool): void {
    this.tools.set(tool.name, tool);
    this.logger.log('🔧 Registered hybrid execution tool', {
      toolName: tool.name,
      category: tool.category,
      deterministic: tool.deterministic,
    });
  }

  /**
   * Get available tools
   */
  public getAvailableTools(): CortexTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute API call with caching and error handling
   */
  public async executeApiCall(
    endpoint: string,
    config: ApiExecutionConfig,
    parameters: Record<string, any> = {},
  ): Promise<any> {
    const cacheKey = this.generateApiCacheKey(endpoint, config, parameters);

    if (config.cacheable && this.apiCache.has(cacheKey)) {
      const cached = this.apiCache.get(cacheKey)!;
      if (cached.expires > new Date()) {
        this.logger.debug('📊 API cache hit', { endpoint });
        return cached.data;
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        const axiosConfig: any = {
          method: config.method,
          url: endpoint,
          timeout: config.timeout,
          headers: config.headers || {},
        };

        if (config.authentication) {
          switch (config.authentication.type) {
            case 'bearer':
              axiosConfig.headers.Authorization = `Bearer ${config.authentication.credentials.token}`;
              break;
            case 'basic':
              const auth = Buffer.from(
                `${config.authentication.credentials.username}:${config.authentication.credentials.password}`,
              ).toString('base64');
              axiosConfig.headers.Authorization = `Basic ${auth}`;
              break;
            case 'apikey':
              axiosConfig.headers[
                config.authentication.credentials.header || 'X-API-Key'
              ] = config.authentication.credentials.key;
              break;
          }
        }

        if (config.method === 'GET') {
          axiosConfig.params = parameters;
        } else {
          axiosConfig.data = parameters;
        }

        const response = await firstValueFrom(
          this.httpService.request(axiosConfig),
        );

        if (config.cacheable) {
          this.apiCache.set(cacheKey, {
            data: response.data,
            expires: new Date(Date.now() + 5 * 60 * 1000),
          });
        }

        this.logger.log('🌐 API call successful', {
          endpoint,
          method: config.method,
          status: response.status,
          cached: false,
        });

        return response.data;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `⚠️ API call failed (attempt ${attempt + 1}/${config.retries + 1})`,
          {
            endpoint,
            error: error instanceof Error ? error.message : String(error),
          },
        );

        if (attempt < config.retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }

    throw lastError || new Error('API call failed after all retries');
  }

  // Private methods

  private analyzeForExecution(frame: CortexFrame): Array<{
    component: string;
    toolName: string;
    parameters: Record<string, any>;
  }> {
    const executableComponents = [];

    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      if (this.isMathOperation(key, value)) {
        executableComponents.push({
          component: key,
          toolName: 'math_calculator',
          parameters: { expression: value },
        });
      }

      if (this.isStringOperation(key, value)) {
        executableComponents.push({
          component: key,
          toolName: 'string_processor',
          parameters: { operation: key, input: value },
        });
      }

      if (this.isDateOperation(key, value)) {
        executableComponents.push({
          component: key,
          toolName: 'date_processor',
          parameters: { operation: key, input: value },
        });
      }

      if (this.isValidationOperation(key, value)) {
        executableComponents.push({
          component: key,
          toolName: 'data_validator',
          parameters: { type: key, data: value },
        });
      }
    }

    return executableComponents;
  }

  private async executeComponent(component: {
    component: string;
    toolName: string;
    parameters: Record<string, any>;
  }): Promise<HybridToolExecution> {
    const startTime = Date.now();

    try {
      const tool = this.tools.get(component.toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${component.toolName}`);
      }

      this.validateToolParameters(tool, component.parameters);
      const result = await tool.execute(component.parameters);

      return {
        toolName: component.toolName,
        input: component.parameters,
        output: result,
        executionTime: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        toolName: component.toolName,
        input: component.parameters,
        output: null,
        executionTime: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private updateFrameWithResult(
    frame: CortexFrame,
    component: any,
    result: any,
  ): CortexFrame {
    return {
      ...frame,
      [component.component]: result,
    } as CortexFrame;
  }

  private isMathOperation(key: string, value: any): boolean {
    if (typeof value !== 'string') return false;

    const mathKeywords = [
      'calculate',
      'compute',
      'sum',
      'total',
      'multiply',
      'divide',
      'subtract',
    ];
    const mathPatterns = [
      /^\d+\s*[+\-*/]\s*\d+/,
      /^Math\./,
      /^\d+%$/,
      /^\$?\d+\.?\d*/,
    ];

    return (
      mathKeywords.some((keyword) => key.toLowerCase().includes(keyword)) ||
      mathPatterns.some((pattern) => pattern.test(value))
    );
  }

  private isStringOperation(key: string, value: any): boolean {
    if (typeof value !== 'string') return false;

    const stringOperations = [
      'format',
      'transform',
      'clean',
      'parse',
      'extract',
    ];
    return stringOperations.some((op) => key.toLowerCase().includes(op));
  }

  private isDateOperation(key: string, value: any): boolean {
    const dateKeywords = ['date', 'time', 'timestamp', 'schedule', 'calendar'];
    return dateKeywords.some((keyword) => key.toLowerCase().includes(keyword));
  }

  private isValidationOperation(key: string, value: any): boolean {
    const validationKeywords = ['validate', 'check', 'verify', 'confirm'];
    return validationKeywords.some((keyword) =>
      key.toLowerCase().includes(keyword),
    );
  }

  private validateToolParameters(
    tool: CortexTool,
    parameters: Record<string, any>,
  ): void {
    for (const [paramName, paramConfig] of Object.entries(tool.parameters)) {
      const value = parameters[paramName];

      if (paramConfig.required && (value === undefined || value === null)) {
        throw new Error(`Required parameter missing: ${paramName}`);
      }

      if (
        value !== undefined &&
        paramConfig.validation &&
        !paramConfig.validation(value)
      ) {
        throw new Error(`Parameter validation failed: ${paramName}`);
      }
    }
  }

  private generateApiCacheKey(
    endpoint: string,
    config: ApiExecutionConfig,
    parameters: Record<string, any>,
  ): string {
    const keyData = {
      endpoint,
      method: config.method,
      parameters: JSON.stringify(parameters, Object.keys(parameters).sort()),
    };
    return crypto
      .createHash('md5')
      .update(JSON.stringify(keyData))
      .digest('hex');
  }

  private initializeBuiltInTools(): void {
    // Mathematical Calculator
    this.registerTool({
      name: 'math_calculator',
      description: 'Execute mathematical calculations deterministically',
      category: 'math',
      parameters: {
        expression: {
          type: 'string',
          required: true,
          description: 'Mathematical expression to evaluate',
          validation: (value) => typeof value === 'string' && value.length > 0,
        },
      },
      execute: (params) => {
        try {
          const sanitized = params.expression
            .replace(/[^0-9+\-*/().\s]/g, '')
            .replace(/\s+/g, '');

          if (!/^[\d+\-*/().\s]+$/.test(sanitized)) {
            throw new Error('Invalid mathematical expression');
          }

          const result = Function(`"use strict"; return (${sanitized})`)();
          return typeof result === 'number' && !isNaN(result) ? result : null;
        } catch {
          throw new Error('Mathematical evaluation failed');
        }
      },
      deterministic: true,
      costSavings: 50,
    });

    // String Processor
    this.registerTool({
      name: 'string_processor',
      description: 'Process strings deterministically',
      category: 'string',
      parameters: {
        operation: {
          type: 'string',
          required: true,
          description: 'String operation type',
        },
        input: {
          type: 'string',
          required: true,
          description: 'Input string to process',
        },
      },
      execute: (params) => {
        const { operation, input } = params;

        switch (operation.toLowerCase()) {
          case 'uppercase':
          case 'upper':
            return input.toUpperCase();
          case 'lowercase':
          case 'lower':
            return input.toLowerCase();
          case 'trim':
            return input.trim();
          case 'length':
            return input.length;
          case 'reverse':
            return input.split('').reverse().join('');
          case 'slugify':
            return input
              .toLowerCase()
              .replace(/[^\w\s-]/g, '')
              .replace(/[\s_-]+/g, '-')
              .replace(/^-+|-+$/g, '');
          default:
            throw new Error(`Unknown string operation: ${operation}`);
        }
      },
      deterministic: true,
      costSavings: 30,
    });

    // Date Processor
    this.registerTool({
      name: 'date_processor',
      description: 'Process dates and times deterministically',
      category: 'date',
      parameters: {
        operation: {
          type: 'string',
          required: true,
          description: 'Date operation type',
        },
        input: {
          type: 'string',
          required: false,
          description: 'Input date/time',
        },
      },
      execute: (params) => {
        const { operation, input } = params;
        const date = input ? new Date(input) : new Date();

        if (isNaN(date.getTime())) {
          throw new Error('Invalid date input');
        }

        switch (operation.toLowerCase()) {
          case 'now':
          case 'current':
            return new Date().toISOString();
          case 'timestamp':
            return date.getTime();
          case 'year':
            return date.getFullYear();
          case 'month':
            return date.getMonth() + 1;
          case 'day':
            return date.getDate();
          case 'hour':
            return date.getHours();
          case 'minute':
            return date.getMinutes();
          case 'second':
            return date.getSeconds();
          case 'iso':
            return date.toISOString();
          case 'format':
            return date.toLocaleDateString('en-US');
          default:
            throw new Error(`Unknown date operation: ${operation}`);
        }
      },
      deterministic: true,
      costSavings: 40,
    });

    // Data Validator
    this.registerTool({
      name: 'data_validator',
      description: 'Validate data types and formats deterministically',
      category: 'data',
      parameters: {
        type: {
          type: 'string',
          required: true,
          description: 'Validation type',
        },
        data: {
          type: 'string',
          required: true,
          description: 'Data to validate',
        },
      },
      execute: (params) => {
        const { type, data } = params;

        switch (type.toLowerCase()) {
          case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(data);
          case 'url':
            try {
              new URL(data);
              return true;
            } catch {
              return false;
            }
          case 'phone':
            const phoneRegex = /^\+?[\d\s\-()]+$/;
            return (
              phoneRegex.test(data) && data.replace(/\D/g, '').length >= 10
            );
          case 'number':
            return !isNaN(Number(data)) && data.trim() !== '';
          case 'integer':
            return Number.isInteger(Number(data));
          case 'uuid':
            const uuidRegex =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            return uuidRegex.test(data);
          case 'json':
            try {
              JSON.parse(data);
              return true;
            } catch {
              return false;
            }
          default:
            throw new Error(`Unknown validation type: ${type}`);
        }
      },
      deterministic: true,
      costSavings: 60,
    });

    // Crypto Utilities
    this.registerTool({
      name: 'crypto_util',
      description: 'Cryptographic operations',
      category: 'crypto',
      parameters: {
        operation: {
          type: 'string',
          required: true,
          description: 'Crypto operation type',
        },
        input: {
          type: 'string',
          required: true,
          description: 'Input data',
        },
      },
      execute: (params) => {
        const { operation, input } = params;

        switch (operation.toLowerCase()) {
          case 'hash':
          case 'sha256':
            return crypto.createHash('sha256').update(input).digest('hex');
          case 'md5':
            return crypto.createHash('md5').update(input).digest('hex');
          case 'uuid':
            return crypto.randomUUID();
          case 'base64_encode':
            return Buffer.from(input).toString('base64');
          case 'base64_decode':
            try {
              return Buffer.from(input, 'base64').toString('utf8');
            } catch {
              throw new Error('Invalid base64 input');
            }
          default:
            throw new Error(`Unknown crypto operation: ${operation}`);
        }
      },
      deterministic: true,
      costSavings: 70,
    });

    // File Operations
    this.registerTool({
      name: 'file_processor',
      description: 'File system operations',
      category: 'file',
      parameters: {
        operation: {
          type: 'string',
          required: true,
          description: 'File operation type',
        },
        filepath: {
          type: 'string',
          required: true,
          description: 'File path',
        },
        content: {
          type: 'string',
          required: false,
          description: 'File content (for write operations)',
        },
      },
      execute: async (params) => {
        const { operation, filepath, content } = params;

        const safePath = path.resolve('./tmp', path.basename(filepath));

        switch (operation.toLowerCase()) {
          case 'read':
            try {
              return await fs.readFile(safePath, 'utf8');
            } catch {
              throw new Error('File not found or not readable');
            }
          case 'write':
            if (!content)
              throw new Error('Content required for write operation');
            await fs.writeFile(safePath, content, 'utf8');
            return 'File written successfully';
          case 'exists':
            try {
              await fs.access(safePath);
              return true;
            } catch {
              return false;
            }
          case 'size':
            try {
              const stats = await fs.stat(safePath);
              return stats.size;
            } catch {
              throw new Error('Cannot get file size');
            }
          default:
            throw new Error(`Unknown file operation: ${operation}`);
        }
      },
      deterministic: true,
      costSavings: 80,
    });

    this.logger.log('⚡ Initialized built-in hybrid execution tools', {
      toolCount: this.tools.size,
      categories: ['math', 'string', 'date', 'data', 'crypto', 'file'],
    });
  }
}
