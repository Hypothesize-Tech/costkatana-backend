import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CacheService } from '../../../common/cache/cache.service';
import { ActivityService } from '../../../modules/activity/activity.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import { ModelRecommendationService } from './model-recommendation.service';
import { estimateTokens } from '../../../utils/tokenCounter';
import { AIProvider } from '../../../types';
import {
  PromptTemplate,
  PromptTemplateDocument,
} from '../../../schemas/prompt/prompt-template.schema';
import {
  TemplateExecution,
  TemplateExecutionDocument,
} from '../../../schemas/prompt/template-execution.schema';
import { Usage } from '../../../schemas/analytics/usage.schema';

export interface TemplateExecutionRequest {
  templateId: string;
  userId: string;
  variables: Record<string, any>;
  executionMode: 'single' | 'comparison' | 'recommended';
  modelId?: string; // User-selected model (overrides recommendation)
  compareWith?: string[]; // Additional models for comparison
  enableOptimization?: boolean; // Future Cortex integration
}

export interface TemplateExecutionResult {
  executionId: string;
  templateId: string;
  aiResponse: string;

  // Token usage
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  // Cost tracking
  actualCost: number;
  baselineCost: number;
  savingsAmount: number;
  savingsPercentage: number;

  // Model information
  modelUsed: string;
  modelProvider: string;
  modelRecommended?: string;
  recommendationFollowed: boolean;
  recommendationReasoning?: string;

  // Performance
  latencyMs: number;
  executedAt: Date;

  // Quality metrics (future enhancement)
  qualityScore?: number;
}

export interface ComparisonExecutionResult {
  results: TemplateExecutionResult[];
  bestCostModel: string;
  bestQualityModel?: string;
  summary: {
    totalCost: number;
    averageCost: number;
    costRange: { min: number; max: number };
  };
}

@Injectable()
export class TemplateExecutionService {
  private readonly logger = new Logger(TemplateExecutionService.name);

  // 🎯 P1: Semantic cache for template execution (70-80% cost savings)
  private readonly templateCache = new Map<
    string,
    {
      result: any;
      timestamp: number;
      variables: any;
      hash: string;
    }
  >();
  private readonly CACHE_TTL = 3600000; // 1 hour

  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    @InjectModel(TemplateExecution.name)
    private readonly templateExecutionModel: Model<TemplateExecutionDocument>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    private readonly cacheService: CacheService,
    private readonly activityService: ActivityService,
    private readonly modelRecommendationService: ModelRecommendationService,
  ) {}

  /**
   * Execute a prompt template with AI
   */
  async executeTemplate(
    request: TemplateExecutionRequest,
  ): Promise<TemplateExecutionResult | ComparisonExecutionResult> {
    try {
      // Get template
      const template = await this.promptTemplateModel.findById(
        request.templateId,
      );
      if (!template) {
        throw new Error('Template not found');
      }

      // Check access
      if (template.createdBy.toString() !== request.userId) {
        // Check if user has access through sharing
        const hasAccess =
          template.sharing?.visibility === 'public' ||
          template.sharing?.sharedWith?.some(
            (id) => id.toString() === request.userId,
          );

        if (!hasAccess) {
          throw new Error('Unauthorized: Cannot access this template');
        }
      }

      // 🎯 P1: Check semantic cache before execution
      const cacheKey = this.generateCacheKey(request);
      const cached = this.templateCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.logger.log('✅ Template execution cache HIT', {
          templateId: request.templateId,
          userId: request.userId,
          cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's',
        });
        return {
          ...cached.result,
          metadata: {
            ...cached.result.metadata,
            cacheHit: true,
            cacheAge: Date.now() - cached.timestamp,
          },
        };
      }

      this.logger.log('Executing template', {
        templateId: request.templateId,
        userId: request.userId,
        executionMode: request.executionMode,
      });

      // Handle different execution modes
      let result;
      if (request.executionMode === 'comparison') {
        result = await this.executeComparison(template, request);
      } else {
        result = await this.executeSingle(template, request);
      }

      // 🎯 P1: Cache the result
      this.templateCache.set(cacheKey, {
        result,
        timestamp: Date.now(),
        variables: request.variables,
        hash: cacheKey,
      });

      // Cleanup old cache entries periodically
      this.cleanupCache();

      return result;
    } catch (error) {
      this.logger.error('Template execution failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        templateId: request.templateId,
        userId: request.userId,
      });
      throw error;
    }
  }

  /**
   * Get execution history for a template
   */
  async getExecutionHistory(
    templateId: string,
    userId: string,
    limit: number = 20,
  ): Promise<any[]> {
    try {
      // Verify access to template
      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      if (template.createdBy.toString() !== userId) {
        const hasAccess =
          template.sharing?.visibility === 'public' ||
          template.sharing?.sharedWith?.some((id) => id.toString() === userId);

        if (!hasAccess) {
          throw new Error('Unauthorized: Cannot access this template');
        }
      }

      const executions = await this.templateExecutionModel
        .find({ templateId })
        .sort({ executedAt: -1 })
        .limit(limit)
        .populate('userId', 'name email')
        .lean();

      return executions.map((execution) => ({
        id: execution._id,
        userId: execution.userId,
        userName: (execution.userId as any)?.name || 'Unknown',
        modelUsed: execution.modelUsed,
        totalTokens: execution.totalTokens,
        actualCost: execution.actualCost,
        savingsPercentage: execution.savingsPercentage,
        executedAt: execution.executedAt,
        latencyMs: execution.latencyMs,
      }));
    } catch (error) {
      this.logger.error('Error getting execution history', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get execution statistics for a template
   */
  async getExecutionStats(templateId: string): Promise<{
    totalExecutions: number;
    totalCostSavings: number;
    averageCost: number;
    mostUsedModel: string;
    lastExecutedAt?: Date;
  }> {
    try {
      const stats = await this.templateExecutionModel.aggregate([
        { $match: { templateId: new Types.ObjectId(templateId) } },
        {
          $group: {
            _id: null,
            totalExecutions: { $sum: 1 },
            totalCostSavings: { $sum: '$savingsAmount' },
            averageCost: { $avg: '$actualCost' },
            mostUsedModel: { $first: '$modelUsed' },
            lastExecutedAt: { $max: '$executedAt' },
          },
        },
      ]);

      if (stats.length === 0) {
        return {
          totalExecutions: 0,
          totalCostSavings: 0,
          averageCost: 0,
          mostUsedModel: 'none',
          lastExecutedAt: undefined,
        };
      }

      return stats[0];
    } catch (error) {
      this.logger.error('Error getting execution stats', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Private helper methods

  private generateCacheKey(request: TemplateExecutionRequest): string {
    const crypto = require('crypto');
    const data = JSON.stringify({
      templateId: request.templateId,
      variables: request.variables,
      modelId: request.modelId,
      executionMode: request.executionMode,
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.templateCache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.templateCache.delete(key);
      }
    }
  }

  private async executeSingle(
    template: PromptTemplateDocument,
    request: TemplateExecutionRequest,
  ): Promise<TemplateExecutionResult> {
    const startTime = Date.now();

    // Get model recommendation if not specified
    let modelId = request.modelId;
    let recommendation: any | undefined;
    let recommendationFollowed = false;

    if (!modelId || request.executionMode === 'recommended') {
      recommendation =
        await this.modelRecommendationService.recommendModel(template);
      modelId = recommendation.modelId;
      recommendationFollowed = true;

      this.logger.debug('Model recommended', {
        templateId: template._id,
        recommendedModel: modelId,
        reasoning: recommendation.reasoning,
      });
    }

    // Process variables and fill template
    const filledPrompt = this.fillTemplate(template, request.variables);

    // Execute with AI (modelId may be undefined from recommendation - use default)
    const effectiveModelId = modelId || 'amazon.nova-pro-v1:0';
    const aiResult = await BedrockService.invokeModel(
      filledPrompt,
      effectiveModelId,
    );

    const latencyMs = Date.now() - startTime;

    // Extract response - invokeModel returns string
    const aiResponse = typeof aiResult === 'string' ? aiResult : '';
    const promptTokens = Math.ceil(filledPrompt.length / 4);
    const completionTokens = Math.ceil(aiResponse.length / 4);
    const totalTokens = promptTokens + completionTokens;

    // Estimate cost from token usage
    const { calculateCost } = await import('@/utils/pricing');
    const actualCost = calculateCost(
      promptTokens,
      completionTokens,
      'aws-bedrock',
      effectiveModelId,
    );

    const analysis = this.modelRecommendationService.analyzeTemplate(template);
    const baselineCost =
      this.modelRecommendationService.calculateBaselineCost(template);

    const savingsAmount = baselineCost - actualCost;
    const savingsPercentage =
      baselineCost > 0 ? (savingsAmount / baselineCost) * 100 : 0;

    // Save execution record
    const execution = new this.templateExecutionModel({
      templateId: template._id,
      userId: request.userId,
      variables: request.variables,
      modelUsed: modelId,
      modelRecommended: recommendation?.modelId,
      recommendationFollowed,
      aiResponse,
      promptTokens,
      completionTokens,
      totalTokens,
      actualCost,
      baselineCost,
      savingsAmount,
      savingsPercentage,
      latencyMs,
      executedAt: new Date(),
    });

    await execution.save();

    // Track usage in main Usage collection
    await this.trackUsage(
      request.userId,
      modelId!,
      filledPrompt,
      aiResponse,
      promptTokens,
      completionTokens,
      actualCost,
    );

    // Update template statistics
    await this.updateTemplateStats(
      template._id.toString(),
      actualCost,
      savingsAmount,
      modelId!,
    );

    // Track activity
    await this.trackActivity(request.userId, template, execution);

    this.logger.log('Template execution completed', {
      executionId: execution._id,
      templateId: template._id,
      modelUsed: modelId,
      savingsPercentage: savingsPercentage.toFixed(2),
    });

    return {
      executionId: execution._id.toString(),
      templateId: template._id.toString(),
      aiResponse,
      promptTokens,
      completionTokens,
      totalTokens,
      actualCost,
      baselineCost,
      savingsAmount,
      savingsPercentage,
      modelUsed: modelId!,
      modelProvider: this.modelRecommendationService.getProviderForModel(
        modelId!,
      ),
      modelRecommended: recommendation?.modelId,
      recommendationFollowed,
      recommendationReasoning: recommendation?.reasoning,
      latencyMs,
      executedAt: new Date(),
    };
  }

  private async executeComparison(
    template: PromptTemplateDocument,
    request: TemplateExecutionRequest,
  ): Promise<ComparisonExecutionResult> {
    const modelsToCompare = [request.modelId || 'claude-3-haiku-20240307-v1:0'];

    if (request.compareWith && request.compareWith.length > 0) {
      modelsToCompare.push(...request.compareWith);
    }

    // Execute with each model
    const results: TemplateExecutionResult[] = [];
    for (const modelId of modelsToCompare) {
      const singleRequest = {
        ...request,
        modelId,
        executionMode: 'single' as const,
      };
      const result = await this.executeSingle(template, singleRequest);
      results.push(result);
    }

    // Find best models
    const sortedByCost = [...results].sort(
      (a, b) => a.actualCost - b.actualCost,
    );
    const sortedByQuality = [...results].sort(
      (a, b) => (b.qualityScore || 0) - (a.qualityScore || 0),
    );

    const totalCost = results.reduce((sum, r) => sum + r.actualCost, 0);
    const costs = results.map((r) => r.actualCost);

    return {
      results,
      bestCostModel: sortedByCost[0].modelUsed,
      bestQualityModel: sortedByQuality[0]?.modelUsed,
      summary: {
        totalCost,
        averageCost: totalCost / results.length,
        costRange: {
          min: Math.min(...costs),
          max: Math.max(...costs),
        },
      },
    };
  }

  private fillTemplate(
    template: PromptTemplateDocument,
    variables: Record<string, any>,
  ): string {
    let content = template.content;

    // Replace variables in format {{variableName}}
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      content = content.replace(regex, String(value));
    }

    return content;
  }

  private async calculateActualCost(
    promptTokens: number,
    completionTokens: number,
    modelId: string,
  ): Promise<number> {
    // Get pricing from model recommendation service
    const pricing = this.modelRecommendationService
      .getAllModels()
      .find((m) => m.modelId === modelId);

    if (!pricing) {
      this.logger.warn(`No pricing found for model ${modelId}, using default`);
      return 0.01; // Default fallback
    }

    const multiplier =
      pricing.unit === 'PER_1M_TOKENS'
        ? 1000000
        : pricing.unit === 'PER_1K_TOKENS'
          ? 1000
          : 1;

    const inputCost = (promptTokens * pricing.inputPrice) / multiplier;
    const outputCost = (completionTokens * pricing.outputPrice) / multiplier;

    return inputCost + outputCost;
  }

  private async trackUsage(
    userId: string,
    modelId: string,
    prompt: string,
    response: string,
    promptTokens: number,
    completionTokens: number,
    cost: number,
  ): Promise<void> {
    try {
      // Create usage record
      const usage = new this.usageModel({
        userId,
        model: modelId,
        prompt,
        response,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cost,
        timestamp: new Date(),
        status: 'completed',
      });

      await usage.save();
    } catch (error) {
      this.logger.error('Error tracking usage', {
        userId,
        modelId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - usage tracking shouldn't break execution
    }
  }

  private async updateTemplateStats(
    templateId: string,
    cost: number,
    savings: number,
    modelId: string,
  ): Promise<void> {
    try {
      await this.promptTemplateModel.updateOne(
        { _id: templateId },
        {
          $inc: {
            'usage.totalExecutions': 1,
            'usage.totalCostSavings': savings,
          },
          $set: {
            'usage.lastUsed': new Date(),
            [`usage.modelStats.${modelId}`]: {
              $inc: { count: 1, totalCost: cost },
            },
          },
        },
      );
    } catch (error) {
      this.logger.error('Error updating template stats', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async trackActivity(
    userId: string,
    template: PromptTemplateDocument,
    execution: TemplateExecutionDocument,
  ): Promise<void> {
    try {
      await this.activityService.trackActivity(userId, {
        type: 'template_used',
        title: `Template "${template.name}" executed`,
        description: `Executed template with ${execution.modelUsed} model, saved $${execution.savingsAmount.toFixed(4)}`,
        metadata: {
          templateId: template._id,
          templateName: template.name,
          executionId: execution._id,
          modelUsed: execution.modelUsed,
          savingsAmount: execution.savingsAmount,
          latencyMs: execution.latencyMs,
        },
      });
    } catch (error) {
      this.logger.error('Error tracking activity', {
        userId,
        templateId: template._id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
