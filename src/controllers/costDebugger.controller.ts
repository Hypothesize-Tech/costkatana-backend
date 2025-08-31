import { Request, Response } from 'express';
import { costDebuggerService } from '../services/costDebugger.service';
import { loggingService } from '../services/logging.service';
import { AIProvider } from '../types/aiCostTracker.types';

export class CostDebuggerController {
  static async analyzePrompt(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const { prompt, provider, model, systemMessage, conversationHistory, toolCalls, metadata } = req.body;

    try {
      loggingService.info('Cost debugger prompt analysis initiated', {
        promptLength: prompt?.length || 0,
        provider,
        model,
        hasSystemMessage: !!systemMessage,
        hasConversationHistory: !!conversationHistory,
        hasToolCalls: !!toolCalls,
        hasMetadata: !!metadata,
        requestId: req.headers['x-request-id'] as string
      });

      if (!prompt || !provider || !model) {
        loggingService.warn('Prompt analysis failed - missing required fields', {
          hasPrompt: !!prompt,
          hasProvider: !!provider,
          hasModel: !!model,
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt, provider, and model are required'
        });
        return;
      }

      // Validate provider
      if (!Object.values(AIProvider).includes(provider)) {
        loggingService.warn('Prompt analysis failed - invalid provider', {
          provider,
          validProviders: Object.values(AIProvider),
          requestId: req.headers['x-request-id'] as string
        });

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

      loggingService.info('Prompt analysis processing started', {
        provider,
        model,
        promptLength: prompt.length,
        requestId: req.headers['x-request-id'] as string
      });

      const analysis = await costDebuggerService.analyzePrompt(prompt, provider, model, {
        systemMessage,
        conversationHistory,
        toolCalls,
        metadata
      });

      const duration = Date.now() - startTime;

      loggingService.info('Prompt analysis completed successfully', {
        provider,
        model,
        promptLength: prompt.length,
        totalTokens: analysis.totalTokens,
        totalCost: analysis.totalCost,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_debugger_prompt_analyzed',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          provider,
          model,
          promptLength: prompt.length,
          totalTokens: analysis.totalTokens,
          totalCost: analysis.totalCost,
          hasSystemMessage: !!systemMessage,
          hasConversationHistory: !!conversationHistory,
          hasToolCalls: !!toolCalls
        }
      });

      res.json({
        success: true,
        data: analysis
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Prompt analysis failed', {
        provider,
        model,
        promptLength: prompt?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      res.status(500).json({
        success: false,
        error: 'Failed to analyze prompt'
      });
    }
  }

  static async detectDeadWeight(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const { prompt, provider, model } = req.body;

    try {
      loggingService.info('Dead weight detection initiated', {
        promptLength: prompt?.length || 0,
        provider,
        model,
        requestId: req.headers['x-request-id'] as string
      });

      if (!prompt || !provider || !model) {
        loggingService.warn('Dead weight detection failed - missing required fields', {
          hasPrompt: !!prompt,
          hasProvider: !!provider,
          hasModel: !!model,
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt, provider, and model are required'
        });
        return;
      }

      if (!Object.values(AIProvider).includes(provider)) {
        loggingService.warn('Dead weight detection failed - invalid provider', {
          provider,
          validProviders: Object.values(AIProvider),
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      loggingService.info('Dead weight detection processing started', {
        provider,
        model,
        promptLength: prompt.length,
        requestId: req.headers['x-request-id'] as string
      });

      const deadWeightAnalysis = await costDebuggerService.detectDeadWeight(prompt, provider, model);

      const duration = Date.now() - startTime;

      loggingService.info('Dead weight detection completed successfully', {
        provider,
        model,
        promptLength: prompt.length,
        duration,
        analysisKeys: Object.keys(deadWeightAnalysis),
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_debugger_dead_weight_detected',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          provider,
          model,
          promptLength: prompt.length,
          analysisKeys: Object.keys(deadWeightAnalysis)
        }
      });

      res.json({
        success: true,
        data: deadWeightAnalysis
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Dead weight detection failed', {
        provider,
        model,
        promptLength: prompt?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      res.status(500).json({
        success: false,
        error: 'Failed to detect dead weight'
      });
    }
  }

  static async comparePromptVersions(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const { originalPrompt, optimizedPrompt, provider, model } = req.body;

    try {
      loggingService.info('Prompt version comparison initiated', {
        originalPromptLength: originalPrompt?.length || 0,
        optimizedPromptLength: optimizedPrompt?.length || 0,
        provider,
        model,
        requestId: req.headers['x-request-id'] as string
      });

      if (!originalPrompt || !optimizedPrompt || !provider || !model) {
        loggingService.warn('Prompt comparison failed - missing required fields', {
          hasOriginalPrompt: !!originalPrompt,
          hasOptimizedPrompt: !!optimizedPrompt,
          hasProvider: !!provider,
          hasModel: !!model,
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Missing required fields: originalPrompt, optimizedPrompt, provider, and model are required'
        });
        return;
      }

      if (!Object.values(AIProvider).includes(provider)) {
        loggingService.warn('Prompt comparison failed - invalid provider', {
          provider,
          validProviders: Object.values(AIProvider),
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      loggingService.info('Prompt comparison processing started', {
        provider,
        model,
        originalPromptLength: originalPrompt.length,
        optimizedPromptLength: optimizedPrompt.length,
        requestId: req.headers['x-request-id'] as string
      });

      const comparison: any = await costDebuggerService.comparePromptVersions(
        originalPrompt,
        optimizedPrompt,
        provider,
        model
      );

      const duration = Date.now() - startTime;

      loggingService.info('Prompt comparison completed successfully', {
        provider,
        model,
        originalPromptLength: originalPrompt.length,
        optimizedPromptLength: optimizedPrompt.length,
        duration,
        tokensSaved: comparison.improvements?.tokensSaved || 0,
        costSaved: comparison.improvements?.costSaved || 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_debugger_prompt_versions_compared',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          provider,
          model,
          originalPromptLength: originalPrompt.length,
          optimizedPromptLength: optimizedPrompt.length,
          tokensSaved: comparison.improvements?.tokensSaved || 0,
          costSaved: comparison.improvements?.costSaved || 0
        }
      });

      res.json({
        success: true,
        data: comparison
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Prompt comparison failed', {
        provider,
        model,
        originalPromptLength: originalPrompt?.length || 0,
        optimizedPromptLength: optimizedPrompt?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      res.status(500).json({
        success: false,
        error: 'Failed to compare prompt versions'
      });
    }
  }

  static async getPromptInsights(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const { prompt, provider, model } = req.query;

    try {
      loggingService.info('Prompt insights request initiated', {
        promptLength: prompt?.length || 0,
        provider,
        model,
        requestId: req.headers['x-request-id'] as string
      });

      if (!prompt || !provider || !model) {
        loggingService.warn('Prompt insights failed - missing required query parameters', {
          hasPrompt: !!prompt,
          hasProvider: !!provider,
          hasModel: !!model,
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Missing required query parameters: prompt, provider, and model are required'
        });
        return;
      }

      if (!Object.values(AIProvider).includes(provider as AIProvider)) {
        loggingService.warn('Prompt insights failed - invalid provider', {
          provider,
          validProviders: Object.values(AIProvider),
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: `Invalid provider. Must be one of: ${Object.values(AIProvider).join(', ')}`
        });
        return;
      }

      loggingService.info('Prompt insights processing started', {
        provider,
        model,
        promptLength: (prompt as string).length,
        requestId: req.headers['x-request-id'] as string
      });

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

      const duration = Date.now() - startTime;

      loggingService.info('Prompt insights generated successfully', {
        provider,
        model,
        promptLength: (prompt as string).length,
        totalTokens: analysis.totalTokens,
        totalCost: analysis.totalCost,
        duration,
        recommendationsCount: insights.recommendations.length,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_debugger_prompt_insights_generated',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          provider,
          model,
          promptLength: (prompt as string).length,
          totalTokens: analysis.totalTokens,
          totalCost: analysis.totalCost,
          recommendationsCount: insights.recommendations.length
        }
      });

      res.json({
        success: true,
        data: insights
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Prompt insights generation failed', {
        provider,
        model,
        promptLength: prompt?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();
    const { prompt, models } = req.body;

    try {
      loggingService.info('Provider comparison initiated', {
        promptLength: prompt?.length || 0,
        modelsCount: models?.length || 0,
        models: models?.map((m: any) => `${m.provider}/${m.model}`) || [],
        requestId: req.headers['x-request-id'] as string
      });

      if (!prompt || !models || !Array.isArray(models)) {
        loggingService.warn('Provider comparison failed - missing required fields', {
          hasPrompt: !!prompt,
          hasModels: !!models,
          modelsIsArray: Array.isArray(models),
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt and models array are required'
        });
        return;
      }

      loggingService.info('Provider comparison processing started', {
        promptLength: prompt.length,
        modelsCount: models.length,
        requestId: req.headers['x-request-id'] as string
      });

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
            loggingService.warn('Provider comparison analysis failed for specific model', {
              provider: modelConfig.provider,
              model: modelConfig.model,
              error: error instanceof Error ? error.message : 'Unknown error',
              requestId: req.headers['x-request-id'] as string
            });
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

      const duration = Date.now() - startTime;

      loggingService.info('Provider comparison completed successfully', {
        promptLength: prompt.length,
        modelsCount: models.length,
        duration,
        successfulComparisons: validComparisons.length,
        failedComparisons: comparisons.length - validComparisons.length,
        mostCostEffective: validComparisons[0]?.provider + '/' + validComparisons[0]?.model,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_debugger_provider_comparison_completed',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          promptLength: prompt.length,
          modelsCount: models.length,
          successfulComparisons: validComparisons.length,
          failedComparisons: comparisons.length - validComparisons.length,
          mostCostEffective: validComparisons[0]?.provider + '/' + validComparisons[0]?.model
        }
      });

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

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Provider comparison failed', {
        promptLength: prompt?.length || 0,
        modelsCount: models?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      res.status(500).json({
        success: false,
        error: 'Failed to compare providers'
      });
    }
  }
}
