import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  Notebook,
  NotebookDocument,
} from '../../../schemas/notebook/notebook.schema';
import {
  NotebookExecution,
  NotebookExecutionDocument,
} from '../../../schemas/notebook/notebook-execution.schema';
import { CKQLService } from './ckql.service';
import { AIInsightsService } from './ai-insights.service';
import { TelemetryService } from '../../../modules/utils/services/telemetry.service';

export interface NotebookCell {
  id: string;
  type: 'markdown' | 'query' | 'visualization' | 'insight';
  content: string;
  output?: any;
  metadata?: Record<string, any>;
  dependencies?: string[];
}

export interface NotebookTemplate {
  type: 'cost_spike' | 'model_performance' | 'usage_patterns' | 'custom';
  title: string;
  description: string;
  cells: NotebookCell[];
}

export interface ExecutionResult {
  cellId: string;
  success: boolean;
  output: any;
  executionTime: number;
  error?: string;
  cell_id: string;
  execution_time_ms: number;
}

export interface NotebookExecutionResult {
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  results: ExecutionResult[];
  totalExecutionTime: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * NotebookService
 *
 * Core service for notebook management including CRUD operations,
 * template management, intelligent cell execution, and visualization data generation.
 */
@Injectable()
export class NotebookService {
  private readonly logger = new Logger(NotebookService.name);
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly circuitBreaker: {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
    resetTimeout: number;
  };

  constructor(
    @InjectModel(Notebook.name)
    private readonly notebookModel: Model<NotebookDocument>,
    @InjectModel(NotebookExecution.name)
    private readonly executionModel: Model<NotebookExecutionDocument>,
    private readonly ckqlService: CKQLService,
    private readonly aiInsightsService: AIInsightsService,
    private readonly telemetryService: TelemetryService,
  ) {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });

    // Initialize circuit breaker for AI operations
    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
      resetTimeout: 60000, // 60 seconds
    };
  }

  /**
   * Create a new notebook
   */
  async createNotebook(
    userId: string,
    data: { title: string; description?: string; template_type?: string },
  ): Promise<NotebookDocument> {
    try {
      let cells: NotebookCell[] = [];

      // Generate cells based on template type
      if (data.template_type && data.template_type !== 'custom') {
        cells = await this.generateTemplateCells(data.template_type as any);
      }

      const notebook = new this.notebookModel({
        title: data.title,
        description: data.description,
        template_type: data.template_type || 'custom',
        cells,
        userId,
        status: 'active',
      });

      return await notebook.save();
    } catch (error) {
      this.logger.error('Failed to create notebook:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException('Failed to create notebook');
    }
  }

  /**
   * Get notebook by ID
   */
  async getNotebook(
    userId: string,
    notebookId: string,
  ): Promise<NotebookDocument> {
    const notebook = await this.notebookModel.findOne({
      _id: notebookId,
      userId,
      status: { $ne: 'deleted' },
    });

    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }

    return notebook;
  }

  /**
   * List notebooks with filtering and pagination
   */
  async listNotebooks(
    userId: string,
    options: {
      status?: string;
      template_type?: string;
      search?: string;
      limit?: number;
      offset?: number;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    },
  ): Promise<{ notebooks: NotebookDocument[]; total: number }> {
    const query: any = { userId };

    // Add status filter
    if (options.status && options.status !== 'all') {
      query.status = options.status;
    } else {
      query.status = { $ne: 'deleted' };
    }

    // Add template type filter
    if (options.template_type && options.template_type !== 'all') {
      query.template_type = options.template_type;
    }

    // Add search filter
    if (options.search) {
      query.$or = [
        { title: { $regex: options.search, $options: 'i' } },
        { description: { $regex: options.search, $options: 'i' } },
        { tags: { $in: [new RegExp(options.search, 'i')] } },
      ];
    }

    const limit = Math.min(options.limit || 20, 100);
    const offset = options.offset || 0;
    const sortBy = options.sort_by || 'created_at';
    const sortOrder = options.sort_order === 'asc' ? 1 : -1;

    const sortOptions: any = {};
    sortOptions[sortBy] = sortOrder;

    const [notebooks, total] = await Promise.all([
      this.notebookModel
        .find(query)
        .sort(sortOptions)
        .limit(limit)
        .skip(offset)
        .lean(),
      this.notebookModel.countDocuments(query),
    ]);

    return { notebooks: notebooks as NotebookDocument[], total };
  }

  /**
   * Update notebook
   */
  async updateNotebook(
    userId: string,
    notebookId: string,
    updates: {
      title?: string;
      description?: string;
      template_type?: string;
      cells?: NotebookCell[];
      tags?: string[];
    },
  ): Promise<NotebookDocument> {
    const notebook = await this.getNotebook(userId, notebookId);

    // Validate cells structure if provided
    if (updates.cells) {
      this.validateCells(updates.cells);
    }

    Object.assign(notebook, updates);
    return await notebook.save();
  }

  /**
   * Delete notebook (soft delete)
   */
  async deleteNotebook(userId: string, notebookId: string): Promise<void> {
    const notebook = await this.getNotebook(userId, notebookId);
    notebook.status = 'deleted';
    await notebook.save();
  }

  /**
   * Execute notebook
   */
  async executeNotebook(
    userId: string,
    notebookId: string,
    options?: { async?: boolean; skip_cache?: boolean; enable_debug?: boolean },
  ): Promise<NotebookExecutionResult> {
    const notebook = await this.getNotebook(userId, notebookId);

    if (!notebook.cells || notebook.cells.length === 0) {
      throw new BadRequestException('Notebook has no cells to execute');
    }

    // Create execution record
    const execution = new this.executionModel({
      notebook_id: notebookId,
      execution_id: this.generateExecutionId(),
      status: 'running',
      userId,
      results: [],
      started_at: new Date(),
    });

    await execution.save();

    try {
      // Execute cells based on dependencies
      const sortedCells = this.sortCellsByDependencies(notebook.cells);
      const results: ExecutionResult[] = [];
      let totalExecutionTime = 0;

      for (const cell of sortedCells) {
        const startTime = Date.now();
        let cellResult: ExecutionResult;

        try {
          const output = await this.executeCell(cell, {
            notebook,
            previousResults: results,
            skipCache: options?.skip_cache,
            enableDebug: options?.enable_debug,
          });

          cellResult = {
            cellId: cell.id,
            cell_id: cell.id,
            success: true,
            output,
            executionTime: Date.now() - startTime,
            execution_time_ms: Date.now() - startTime,
          };
        } catch (error) {
          cellResult = {
            cellId: cell.id,
            cell_id: cell.id,
            success: false,
            output: null,
            executionTime: Date.now() - startTime,
            execution_time_ms: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        results.push(cellResult);
        totalExecutionTime += cellResult.executionTime;

        // Update execution record with partial results
        execution.results = results;
        await execution.save();
      }

      // Mark execution as completed
      execution.status = 'completed';
      execution.completed_at = new Date();
      await execution.save();

      return {
        executionId: execution.execution_id,
        status: 'completed',
        results,
        totalExecutionTime,
        startedAt: execution.started_at,
        completedAt: execution.completed_at,
      };
    } catch (error) {
      // Mark execution as failed
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completed_at = new Date();
      await execution.save();

      throw error;
    }
  }

  /**
   * Get execution result
   */
  async getExecution(
    userId: string,
    executionId: string,
  ): Promise<NotebookExecutionDocument> {
    const execution = await this.executionModel.findOne({
      execution_id: executionId,
      userId,
    });

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    return execution;
  }

  /**
   * Get available templates
   */
  async getTemplates(): Promise<NotebookTemplate[]> {
    return [
      {
        type: 'cost_spike',
        title: 'Cost Spike Analysis',
        description:
          'Analyze sudden increases in AI costs and identify root causes',
        cells: await this.generateTemplateCells('cost_spike'),
      },
      {
        type: 'model_performance',
        title: 'Model Performance Analysis',
        description: 'Compare performance metrics across different AI models',
        cells: await this.generateTemplateCells('model_performance'),
      },
      {
        type: 'usage_patterns',
        title: 'Usage Pattern Analysis',
        description: 'Analyze usage patterns and trends over time',
        cells: await this.generateTemplateCells('usage_patterns'),
      },
    ];
  }

  /**
   * Generate template cells based on type
   */
  private async generateTemplateCells(
    type: 'cost_spike' | 'model_performance' | 'usage_patterns',
  ): Promise<NotebookCell[]> {
    switch (type) {
      case 'cost_spike':
        return [
          {
            id: 'intro',
            type: 'markdown',
            content:
              '# Cost Spike Analysis\n\nThis notebook analyzes sudden increases in AI costs and identifies potential root causes.',
            metadata: { title: 'Introduction' },
          },
          {
            id: 'cost-query',
            type: 'query',
            content:
              'Show me cost spikes in the last 24 hours where cost increased by more than 50%',
            metadata: { title: 'Cost Spike Query' },
          },
          {
            id: 'cost-chart',
            type: 'visualization',
            content: 'cost_timeline',
            metadata: {
              title: 'Cost Timeline Chart',
              depends_on: ['cost-query'],
            },
          },
          {
            id: 'insights',
            type: 'insight',
            content: 'Analyze the cost spikes and provide recommendations',
            metadata: { title: 'AI Insights', depends_on: ['cost-query'] },
          },
        ];

      case 'model_performance':
        return [
          {
            id: 'intro',
            type: 'markdown',
            content:
              '# Model Performance Analysis\n\nCompare performance metrics across different AI models to optimize your usage.',
            metadata: { title: 'Introduction' },
          },
          {
            id: 'model-query',
            type: 'query',
            content:
              'Show me performance metrics for all AI models in the last 7 days',
            metadata: { title: 'Model Performance Query' },
          },
          {
            id: 'model-comparison',
            type: 'visualization',
            content: 'model_comparison',
            metadata: {
              title: 'Model Comparison Chart',
              depends_on: ['model-query'],
            },
          },
          {
            id: 'recommendations',
            type: 'insight',
            content:
              'Recommend optimal models based on cost-performance tradeoffs',
            metadata: {
              title: 'Model Recommendations',
              depends_on: ['model-query'],
            },
          },
        ];

      case 'usage_patterns':
        return [
          {
            id: 'intro',
            type: 'markdown',
            content:
              '# Usage Pattern Analysis\n\nAnalyze usage patterns and trends to understand your AI consumption.',
            metadata: { title: 'Introduction' },
          },
          {
            id: 'usage-query',
            type: 'query',
            content:
              'Show me usage patterns by operation type over the last 30 days',
            metadata: { title: 'Usage Pattern Query' },
          },
          {
            id: 'usage-heatmap',
            type: 'visualization',
            content: 'usage_heatmap',
            metadata: { title: 'Usage Heatmap', depends_on: ['usage-query'] },
          },
          {
            id: 'trends',
            type: 'insight',
            content: 'Identify usage trends and predict future consumption',
            metadata: {
              title: 'Usage Trends & Predictions',
              depends_on: ['usage-query'],
            },
          },
        ];

      default:
        return [];
    }
  }

  /**
   * Execute individual cell
   */
  private async executeCell(
    cell: NotebookCell,
    context: {
      notebook: NotebookDocument;
      previousResults: ExecutionResult[];
      skipCache?: boolean;
      enableDebug?: boolean;
    },
  ): Promise<any> {
    switch (cell.type) {
      case 'markdown':
        return this.executeMarkdownCell(cell);

      case 'query':
        return this.executeQueryCell(cell, context);

      case 'visualization':
        return this.executeVisualizationCell(cell, context);

      case 'insight':
        return this.executeInsightCell(cell, context);

      default:
        throw new BadRequestException(`Unsupported cell type: ${cell.type}`);
    }
  }

  /**
   * Execute markdown cell
   */
  private async executeMarkdownCell(cell: NotebookCell): Promise<any> {
    // Markdown cells don't need execution, just return rendered content
    return {
      type: 'markdown',
      content: cell.content,
      rendered: this.renderMarkdown(cell.content),
    };
  }

  /**
   * Execute query cell
   */
  private async executeQueryCell(
    cell: NotebookCell,
    context: any,
  ): Promise<any> {
    try {
      // Execute CKQL query
      const result = await this.ckqlService.executeQuery(
        await this.ckqlService.parseQuery(cell.content),
        { limit: 1000 }, // Reasonable limit for notebook queries
      );

      return {
        type: 'query',
        query: cell.content,
        results: result.results,
        totalCount: result.totalCount,
        executionTime: result.executionTime,
        insights: result.insights,
      };
    } catch (error) {
      this.logger.error('Failed to execute query cell:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(`Query execution failed: ${error}`);
    }
  }

  /**
   * Execute visualization cell
   */
  private async executeVisualizationCell(
    cell: NotebookCell,
    context: any,
  ): Promise<any> {
    try {
      const visualizationType = cell.content;
      let data: any = null;

      // Get data from dependent cells
      if (cell.metadata?.depends_on && cell.metadata.depends_on.length > 0) {
        const dependentResult = context.previousResults.find(
          (r: ExecutionResult) => cell.metadata!.depends_on!.includes(r.cellId),
        );

        if (dependentResult && dependentResult.success) {
          data = dependentResult.output.results || dependentResult.output;
        }
      }

      if (!data) {
        throw new BadRequestException(
          'Visualization cell requires data from dependent cells',
        );
      }

      // Generate visualization data
      const visualizationData = await this.generateVisualizationData(
        visualizationType,
        data,
      );

      return {
        type: 'visualization',
        visualizationType,
        data: visualizationData,
        metadata: cell.metadata,
      };
    } catch (error) {
      this.logger.error('Failed to execute visualization cell:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestException(
        `Visualization generation failed: ${error}`,
      );
    }
  }

  /**
   * Execute insight cell
   */
  private async executeInsightCell(
    cell: NotebookCell,
    context: any,
  ): Promise<any> {
    try {
      // Check circuit breaker
      if (!this.canExecuteAI()) {
        return {
          type: 'insight',
          content: cell.content,
          insights: [
            'AI service temporarily unavailable. Please try again later.',
          ],
          generated_at: new Date(),
        };
      }

      let data: any = null;

      // Get data from dependent cells
      if (cell.metadata?.depends_on && cell.metadata.depends_on.length > 0) {
        const dependentResult = context.previousResults.find(
          (r: ExecutionResult) => cell.metadata!.depends_on!.includes(r.cellId),
        );

        if (dependentResult && dependentResult.success) {
          data = dependentResult.output.results || dependentResult.output;
        }
      }

      // Generate AI insights
      const insights = await this.generateCellInsights(cell.content, data);

      // Success - reset circuit breaker
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.state = 'closed';

      return {
        type: 'insight',
        content: cell.content,
        insights,
        data_summary: data
          ? {
              count: Array.isArray(data) ? data.length : 1,
              type: Array.isArray(data) ? 'array' : typeof data,
            }
          : null,
        generated_at: new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to execute insight cell:', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Record failure for circuit breaker
      this.recordAIFailure();

      // Return basic insights even on failure
      return {
        type: 'insight',
        content: cell.content,
        insights: [
          'Unable to generate AI insights at this time. Please check your data and try again.',
        ],
        error: error instanceof Error ? error.message : String(error),
        generated_at: new Date(),
      };
    }
  }

  /**
   * Generate visualization data
   */
  private async generateVisualizationData(
    type: string,
    data: any,
  ): Promise<any> {
    switch (type) {
      case 'cost_timeline':
        return this.generateCostTimelineChart(data);

      case 'model_comparison':
        return this.generateModelComparisonChart(data);

      case 'usage_heatmap':
        return this.generateUsageHeatmap(data);

      default:
        return {
          type: 'unknown',
          data: data.slice(0, 100), // Limit data for visualization
        };
    }
  }

  /**
   * Generate cost timeline chart data
   */
  private generateCostTimelineChart(data: any[]): any {
    // Group data by hour and calculate cost metrics
    const hourlyData = data.reduce(
      (acc, item) => {
        const hour = new Date(item.timestamp).getHours();
        if (!acc[hour]) {
          acc[hour] = { hour, totalCost: 0, count: 0, avgCost: 0 };
        }
        acc[hour].totalCost += item.cost_usd || 0;
        acc[hour].count += 1;
        return acc;
      },
      {} as Record<number, any>,
    );

    // Convert to chart format
    const chartData = Object.values(hourlyData).map((item: any) => ({
      hour: item.hour,
      cost: item.totalCost,
      transactions: item.count,
      avgCost: item.totalCost / item.count,
    }));

    return {
      type: 'line',
      title: 'Cost Timeline',
      xAxis: 'Hour',
      yAxis: 'Cost ($)',
      series: [
        {
          name: 'Total Cost',
          data: chartData.map((d) => [d.hour, d.cost]),
        },
      ],
      rawData: chartData,
    };
  }

  /**
   * Generate model comparison chart data
   */
  private generateModelComparisonChart(data: any[]): any {
    // Group by model
    const modelData = data.reduce(
      (acc, item) => {
        const model = item.gen_ai_model || 'unknown';
        if (!acc[model]) {
          acc[model] = {
            model,
            totalCost: 0,
            totalTokens: 0,
            avgLatency: 0,
            count: 0,
          };
        }
        acc[model].totalCost += item.cost_usd || 0;
        acc[model].totalTokens +=
          (item.gen_ai_input_tokens || 0) + (item.gen_ai_output_tokens || 0);
        acc[model].avgLatency =
          (acc[model].avgLatency * acc[model].count + (item.duration_ms || 0)) /
          (acc[model].count + 1);
        acc[model].count += 1;
        return acc;
      },
      {} as Record<string, any>,
    );

    const chartData = Object.values(modelData);

    return {
      type: 'bar',
      title: 'Model Performance Comparison',
      categories: chartData.map((d: any) => d.model),
      series: [
        {
          name: 'Total Cost ($)',
          data: chartData.map((d: any) => d.totalCost),
        },
        {
          name: 'Average Latency (ms)',
          data: chartData.map((d: any) => d.avgLatency),
        },
      ],
      rawData: chartData,
    };
  }

  /**
   * Generate usage heatmap data
   */
  private generateUsageHeatmap(data: any[]): any {
    // Group by operation and hour
    const heatmapData = data.reduce(
      (acc, item) => {
        const operation = item.operation_name || 'unknown';
        const hour = new Date(item.timestamp).getHours();

        const key = `${operation}-${hour}`;
        if (!acc[key]) {
          acc[key] = { operation, hour, count: 0, totalCost: 0 };
        }
        acc[key].count += 1;
        acc[key].totalCost += item.cost_usd || 0;
        return acc;
      },
      {} as Record<string, any>,
    );

    return {
      type: 'heatmap',
      title: 'Usage Heatmap',
      xAxis: 'Hour of Day',
      yAxis: 'Operation',
      data: Object.values(heatmapData).map((item: any) => [
        item.hour,
        item.operation,
        item.count,
      ]),
      rawData: Object.values(heatmapData),
    };
  }

  /**
   * Generate AI insights for cell
   */
  private async generateCellInsights(
    content: string,
    data?: any,
  ): Promise<string[]> {
    try {
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return [
          'No data available for analysis. Please ensure dependent cells have executed successfully.',
        ];
      }

      // Generate basic insights first
      const basicInsights = this.generateBasicCellInsights(data);

      // Try to enhance with AI if circuit breaker allows
      try {
        const aiEnhancement = await this.generateAIEnhancement(content, data);
        if (aiEnhancement) {
          basicInsights.push(aiEnhancement);
        }
      } catch (aiError) {
        this.logger.debug('AI enhancement failed, using basic insights only:', {
          error: aiError instanceof Error ? aiError.message : String(aiError),
        });
      }

      return basicInsights;
    } catch (error) {
      this.logger.error('Failed to generate cell insights:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return ['Unable to generate insights at this time.'];
    }
  }

  /**
   * Generate basic insights without AI
   */
  private generateBasicCellInsights(data: any): string[] {
    const insights: string[] = [];

    if (Array.isArray(data)) {
      insights.push(`Analyzed ${data.length} records`);

      // Cost analysis
      const costs = data
        .map((d: any) => d.cost_usd)
        .filter((c: number) => c > 0);
      if (costs.length > 0) {
        const totalCost = costs.reduce((sum: number, c: number) => sum + c, 0);
        const avgCost = totalCost / costs.length;
        insights.push(
          `Total cost: $${totalCost.toFixed(4)}, Average: $${avgCost.toFixed(4)}`,
        );
      }

      // Performance analysis
      const durations = data
        .map((d: any) => d.duration_ms)
        .filter((d: number) => d > 0);
      if (durations.length > 0) {
        const avgDuration =
          durations.reduce((sum, d) => sum + d, 0) / durations.length;
        insights.push(`Average response time: ${avgDuration.toFixed(0)}ms`);
      }

      // Error analysis
      const errors = data.filter((d) => d.status >= 400);
      if (errors.length > 0) {
        const errorRate = ((errors.length / data.length) * 100).toFixed(1);
        insights.push(
          `${errors.length} errors found (${errorRate}% error rate)`,
        );
      }
    }

    return insights;
  }

  /**
   * Generate AI enhancement for insights
   */
  private async generateAIEnhancement(
    content: string,
    data: any,
  ): Promise<string | null> {
    try {
      const summary = {
        recordCount: Array.isArray(data) ? data.length : 1,
        totalCost: Array.isArray(data)
          ? data.reduce((sum, d) => sum + (d.cost_usd || 0), 0)
          : data.cost_usd || 0,
        avgDuration: Array.isArray(data)
          ? data.reduce((sum, d) => sum + (d.duration_ms || 0), 0) / data.length
          : data.duration_ms || 0,
        operations: Array.isArray(data)
          ? [
              ...new Set(data.map((d) => d.operation_name).filter(Boolean)),
            ].slice(0, 3)
          : [data.operation_name].filter(Boolean),
      };

      const prompt = `Based on this data analysis request and summary, provide one specific, actionable insight:

Request: "${content}"
Data Summary: ${JSON.stringify(summary)}

Provide a single, valuable recommendation or observation. Keep it concise and actionable.`;

      const modelId =
        process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';

      let requestBody;
      if (modelId.includes('nova')) {
        requestBody = JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
          inferenceConfig: {
            max_new_tokens: 100,
            temperature: 0.7,
          },
        });
      } else {
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 100,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.executeWithRetry(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      let responseText;
      if (modelId.includes('nova')) {
        responseText =
          responseBody.output?.message?.content?.[0]?.text ||
          responseBody.output?.text ||
          '';
      } else {
        responseText = responseBody.content?.[0]?.text || '';
      }

      const insight = responseText.trim();
      return insight && insight.length > 10 ? insight : null;
    } catch (error) {
      return null;
    }
  }

  // Helper methods

  private validateCells(cells: NotebookCell[]): void {
    const cellIds = new Set<string>();

    for (const cell of cells) {
      if (!cell.id || !cell.type || !cell.content) {
        throw new BadRequestException(
          'Each cell must have id, type, and content',
        );
      }

      if (cellIds.has(cell.id)) {
        throw new BadRequestException(`Duplicate cell ID: ${cell.id}`);
      }

      cellIds.add(cell.id);

      if (
        !['markdown', 'query', 'visualization', 'insight'].includes(cell.type)
      ) {
        throw new BadRequestException(`Invalid cell type: ${cell.type}`);
      }
    }
  }

  private sortCellsByDependencies(cells: NotebookCell[]): NotebookCell[] {
    // Simple topological sort for cell dependencies
    const sorted: NotebookCell[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (cell: NotebookCell) => {
      if (visited.has(cell.id)) return;
      if (visiting.has(cell.id)) {
        throw new BadRequestException(
          `Circular dependency detected involving cell: ${cell.id}`,
        );
      }

      visiting.add(cell.id);

      // Visit dependencies first
      if (cell.metadata?.depends_on) {
        for (const depId of cell.metadata.depends_on) {
          const depCell = cells.find((c) => c.id === depId);
          if (depCell) {
            visit(depCell);
          }
        }
      }

      visiting.delete(cell.id);
      visited.add(cell.id);
      sorted.push(cell);
    };

    for (const cell of cells) {
      if (!visited.has(cell.id)) {
        visit(cell);
      }
    }

    return sorted;
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private renderMarkdown(content: string): string {
    // Simple markdown rendering - in a real implementation, you'd use a proper markdown library
    return content
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/\n/gim, '<br>');
  }

  private async executeWithRetry(
    command: any,
    maxRetries: number = 3,
  ): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.bedrockClient.send(command);
      } catch (error: any) {
        if (error.name === 'ThrottlingException' && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          this.logger.warn(
            `Bedrock throttling, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  // Circuit breaker methods for AI operations

  private canExecuteAI(): boolean {
    const now = Date.now();

    if (this.circuitBreaker.state === 'open') {
      if (
        now - this.circuitBreaker.lastFailure >
        this.circuitBreaker.resetTimeout
      ) {
        this.circuitBreaker.state = 'half-open';
        this.logger.log('AI circuit breaker transitioning to half-open state');
        return true;
      }
      return false;
    }

    return true;
  }

  private recordAIFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= 3) {
      this.circuitBreaker.state = 'open';
      this.logger.warn('AI circuit breaker opened due to repeated failures');
    }
  }
}
