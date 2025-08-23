import { Request, Response } from 'express';
import { costDebuggerService } from '../services/costDebugger.service';
import { logger } from '../utils/logger';
import { AIProvider } from '../types/aiCostTracker.types';

export class CostDebuggerController {
  static async analyzePrompt(req: Request, res: Response): Promise<void> {
    try {
      logger.info('🚀 CostDebuggerController.analyzePrompt called');
      const { prompt, provider, model, systemMessage, conversationHistory, toolCalls, metadata } = req.body;

      if (!prompt || !provider || !model) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt, provider, and model are required'
        });
        return;
      }

      // Validate provider
      if (!Object.values(AIProvider).includes(provider)) {
        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      // Disable caching for cost debugger to ensure fresh AI analysis
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Cache', 'DISABLED-COST-DEBUGGER');

      logger.info(`🔍 Analyzing prompt for ${provider}/${model}`);

      const analysis = await costDebuggerService.analyzePrompt(prompt, provider, model, {
        systemMessage,
        conversationHistory,
        toolCalls,
        metadata
      });

      res.json({
        success: true,
        data: analysis
      });

    } catch (error) {
      logger.error('❌ Error in analyzePrompt:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to analyze prompt'
      });
    }
  }

  static async detectDeadWeight(req: Request, res: Response): Promise<void> {
    try {
      const { prompt, provider, model } = req.body;

      if (!prompt || !provider || !model) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt, provider, and model are required'
        });
        return;
      }

      if (!Object.values(AIProvider).includes(provider)) {
        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      logger.info(`🔍 Detecting dead weight in prompt for ${provider}/${model}`);

      const deadWeightAnalysis = await costDebuggerService.detectDeadWeight(prompt, provider, model);

      res.json({
        success: true,
        data: deadWeightAnalysis
      });

    } catch (error) {
      logger.error('❌ Error in detectDeadWeight:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to detect dead weight'
      });
    }
  }

  static async comparePromptVersions(req: Request, res: Response): Promise<void> {
    try {
      const { originalPrompt, optimizedPrompt, provider, model } = req.body;

      if (!originalPrompt || !optimizedPrompt || !provider || !model) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: originalPrompt, optimizedPrompt, provider, and model are required'
        });
        return;
      }

      if (!Object.values(AIProvider).includes(provider)) {
        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      logger.info(`🔍 Comparing prompt versions for ${provider}/${model}`);

      const comparison = await costDebuggerService.comparePromptVersions(
        originalPrompt,
        optimizedPrompt,
        provider,
        model
      );

      res.json({
        success: true,
        data: comparison
      });

    } catch (error) {
      logger.error('❌ Error in comparePromptVersions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to compare prompt versions'
      });
    }
  }

  static async getPromptInsights(req: Request, res: Response): Promise<void> {
    try {
      const { prompt, provider, model } = req.query;

      if (!prompt || !provider || !model) {
        res.status(400).json({
          success: false,
          error: 'Missing required query parameters: prompt, provider, and model are required'
        });
        return;
      }

      if (!Object.values(AIProvider).includes(provider as AIProvider)) {
        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      logger.info(`🔍 Getting prompt insights for ${provider}/${model}`);

      const analysis = await costDebuggerService.analyzePrompt(
        prompt as string,
        provider as AIProvider,
        model as string
      );

      // Extract key insights
      const insights = {
        totalTokens: analysis.totalTokens,
        totalCost: analysis.totalCost,
        costBreakdown: {
          systemPrompt: {
            percentage: ((analysis.tokenAttribution.systemPrompt.tokens / analysis.totalTokens) * 100).toFixed(1),
            cost: analysis.tokenAttribution.systemPrompt.cost
          },
          userMessage: {
            percentage: ((analysis.tokenAttribution.userMessage.tokens / analysis.totalTokens) * 100).toFixed(1),
            cost: analysis.tokenAttribution.userMessage.cost
          },
          conversationHistory: {
            percentage: ((analysis.tokenAttribution.conversationHistory.tokens / analysis.totalTokens) * 100).toFixed(1),
            cost: analysis.tokenAttribution.conversationHistory.cost
          },
          toolCalls: {
            percentage: ((analysis.tokenAttribution.toolCalls.tokens / analysis.totalTokens) * 100).toFixed(1),
            cost: analysis.tokenAttribution.toolCalls.cost
          },
          metadata: {
            percentage: ((analysis.tokenAttribution.metadata.tokens / analysis.totalTokens) * 100).toFixed(1),
            cost: analysis.tokenAttribution.metadata.cost
          }
        },
        optimizationOpportunities: analysis.optimizationOpportunities,
        qualityMetrics: analysis.qualityMetrics,
        recommendations: this.generateRecommendations(analysis)
      };

      res.json({
        success: true,
        data: insights
      });

    } catch (error) {
      logger.error('❌ Error in getPromptInsights:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get prompt insights'
      });
    }
  }

  private static generateRecommendations(analysis: any): string[] {
    const recommendations: string[] = [];

    // Token-based recommendations
    if (analysis.totalTokens > 4000) {
      recommendations.push('Consider breaking down this prompt into smaller, focused requests');
    }
    if (analysis.totalTokens > 8000) {
      recommendations.push('This prompt is very long - consider using context summarization');
    }

    // Cost-based recommendations
    if (analysis.totalCost > 0.01) {
      recommendations.push('High-cost prompt detected - review for optimization opportunities');
    }

    // Quality-based recommendations
    if (analysis.qualityMetrics.instructionClarity < 70) {
      recommendations.push('Instructions could be clearer - use more specific language');
    }
    if (analysis.qualityMetrics.contextRelevance < 70) {
      recommendations.push('Some context may be irrelevant - consider trimming');
    }

    // Optimization-based recommendations
    if (analysis.optimizationOpportunities.highImpact.length > 0) {
      recommendations.push(`High-impact optimizations available: ${analysis.optimizationOpportunities.highImpact.length} opportunities`);
    }

    return recommendations;
  }

  static async getProviderComparison(req: Request, res: Response): Promise<void> {
    try {
      const { prompt, models } = req.body;

      if (!prompt || !models || !Array.isArray(models)) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt and models array are required'
        });
        return;
      }

      logger.info(`🔍 Comparing prompt across ${models.length} models`);

      const comparisons = await Promise.all(
        models.map(async (modelConfig) => {
          try {
            const analysis = await costDebuggerService.analyzePrompt(
              prompt,
              modelConfig.provider,
              modelConfig.model
            );

            return {
              provider: modelConfig.provider,
              model: modelConfig.model,
              tokens: analysis.totalTokens,
              cost: analysis.totalCost,
              quality: analysis.qualityMetrics.overallScore
            };
          } catch (error) {
            logger.warn(`Failed to analyze for ${modelConfig.provider}/${modelConfig.model}:`, error);
            return {
              provider: modelConfig.provider,
              model: modelConfig.model,
              error: 'Analysis failed'
            };
          }
        })
      );

      // Sort by cost efficiency
      const validComparisons = comparisons.filter(c => !c.error && typeof c.cost === 'number');
      validComparisons.sort((a, b) => (a.cost || 0) - (b.cost || 0));

      res.json({
        success: true,
        data: {
          comparisons,
          recommendations: {
            mostCostEffective: validComparisons[0],
            bestQuality: validComparisons.reduce((best, current) => 
              (current.quality || 0) > (best.quality || 0) ? current : best
            ),
            tokenEfficiency: validComparisons.reduce((best, current) => {
              const currentRatio = (current.tokens || 0) / (current.cost || 1);
              const bestRatio = (best.tokens || 0) / (best.cost || 1);
              return currentRatio > bestRatio ? current : best;
            })
          }
        }
      });

    } catch (error) {
      logger.error('❌ Error in getProviderComparison:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to compare providers'
      });
    }
  }
}
