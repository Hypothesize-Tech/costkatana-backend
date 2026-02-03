import { IUsage } from '../models/Usage';
import { IProject } from '../models/Project';
import { loggingService } from './logging.service';
import { mixpanelService } from './mixpanel.service';
import { TelemetryService } from './telemetry.service';
import { NotificationService } from './notification.service';
import { Usage } from '../models/Usage';
import { Project } from '../models/Project';

interface OptimizationRule {
  id: string;
  name: string;
  description: string;
  category: 'cost' | 'performance' | 'efficiency' | 'model_selection' | 'prompt_optimization';
  priority: 'low' | 'medium' | 'high' | 'critical';
  condition: (usage: IUsage[], context: AnalysisContext) => boolean;
  generateSuggestion: (usage: IUsage[], context: AnalysisContext) => OptimizationSuggestion;
  estimateSavings: (usage: IUsage[], context: AnalysisContext) => number;
}

interface AnalysisContext {
  userId: string;
  projectId?: string;
  timeframe: {
    startDate: Date;
    endDate: Date;
  };
  userProjects: IProject[];
  totalUsage: {
    cost: number;
    tokens: number;
    requests: number;
  };
  patterns: UsagePattern[];
}

interface UsagePattern {
  type: 'high_cost_model' | 'inefficient_prompts' | 'repeated_content' | 'poor_caching' | 'suboptimal_timing';
  frequency: number;
  impact: number;
  examples: IUsage[];
}

interface OptimizationSuggestion {
  id: string;
  type: 'cost_reduction' | 'performance_improvement' | 'efficiency_gain' | 'model_switch' | 'prompt_optimization';
  title: string;
  description: string;
  impact: {
    estimatedSavings: number;
    estimatedSavingsPercentage: number;
    affectedRequests: number;
    timeframe: 'immediate' | 'short_term' | 'long_term';
  };
  implementation: {
    effort: 'low' | 'medium' | 'high';
    steps: string[];
    technicalDetails: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  validUntil?: Date;
  metadata?: Record<string, any>;
}

interface OptimizationReport {
  userId: string;
  projectId?: string;
  analysisDate: Date;
  timeframe: {
    startDate: Date;
    endDate: Date;
  };
  summary: {
    totalPotentialSavings: number;
    totalPotentialSavingsPercentage: number;
    totalSuggestions: number;
    highPrioritySuggestions: number;
    quickWins: number; // Low effort, high impact suggestions
  };
  suggestions: OptimizationSuggestion[];
  patterns: UsagePattern[];
  benchmarks: {
    industryAverage: {
      costPerToken: number;
      responseTime: number;
      errorRate: number;
    };
    userPerformance: {
      costPerToken: number;
      responseTime: number;
      errorRate: number;
    };
  };
}

export class CostOptimizationEngine {
  private static instance: CostOptimizationEngine;
  private optimizationRules: OptimizationRule[];

  private constructor() {
    this.optimizationRules = this.initializeOptimizationRules();
  }

  public static getInstance(): CostOptimizationEngine {
    if (!CostOptimizationEngine.instance) {
      CostOptimizationEngine.instance = new CostOptimizationEngine();
    }
    return CostOptimizationEngine.instance;
  }

  /**
   * Generate optimization suggestions for a user or project
   */
  public async analyzeAndOptimize(
    userId: string,
    projectId?: string,
    timeframe?: { startDate: Date; endDate: Date }
  ): Promise<OptimizationReport> {
    try {
      loggingService.info('Starting cost optimization analysis', { userId, projectId });

      // Set default timeframe (last 30 days)
      const defaultTimeframe = timeframe || {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      };

      // Gather context data
      const context = await this.gatherAnalysisContext(userId, projectId, defaultTimeframe);
      
      // Detect usage patterns
      const patterns = await this.detectUsagePatterns(context);
      context.patterns = patterns;

      // Apply optimization rules
      const suggestions = await this.applyOptimizationRules(context);

      // Calculate benchmarks
      const benchmarks = await this.calculateBenchmarks(context);

      // Generate report
      const report: OptimizationReport = {
        userId,
        projectId,
        analysisDate: new Date(),
        timeframe: defaultTimeframe,
        summary: this.generateSummary(suggestions),
        suggestions,
        patterns,
        benchmarks
      };

      // Track analytics
      await this.trackOptimizationAnalytics(report);

      // Store report (optional - could be cached or stored for historical tracking)
      await this.storeOptimizationReport(report);

      loggingService.info('Cost optimization analysis completed', { 
        userId, 
        projectId,
        suggestionsCount: suggestions.length,
        potentialSavings: report.summary.totalPotentialSavings
      });

      return report;
    } catch (error) {
      loggingService.error('Error in cost optimization analysis', error as Error);
      throw error;
    }
  }

  /**
   * Get optimization suggestions for a specific usage record
   */
  public async getUsageOptimizations(usageId: string): Promise<OptimizationSuggestion[]> {
    try {
      const usage = await Usage.findById(usageId).populate('projectId');
      if (!usage) {
        throw new Error(`Usage record ${usageId} not found`);
      }

      const context = await this.gatherAnalysisContext(
        usage.userId.toString(),
        usage.projectId?.toString(),
        {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          endDate: new Date()
        }
      );

      // Generate specific suggestions for this usage
      const suggestions = this.optimizationRules
        .filter(rule => rule.condition([usage], context))
        .map(rule => rule.generateSuggestion([usage], context))
        .sort((a, b) => this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority));

      return suggestions;
    } catch (error) {
      loggingService.error('Error getting usage optimizations', error as Error);
      throw error;
    }
  }

  /**
   * Monitor for optimization opportunities and send proactive alerts
   */
  public async monitorOptimizationOpportunities(): Promise<void> {
    try {
      loggingService.info('Starting optimization opportunities monitoring');

      // Get users with significant recent usage
      const recentUsage = await Usage.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
          }
        },
        {
          $group: {
            _id: '$userId',
            totalCost: { $sum: '$cost' },
            requestCount: { $sum: 1 }
          }
        },
        {
          $match: {
            $or: [
              { totalCost: { $gte: 10.0 } }, // High cost users
              { requestCount: { $gte: 100 } } // High volume users
            ]
          }
        }
      ]);

      // Analyze each high-usage user
      for (const user of recentUsage) {
        const report = await this.analyzeAndOptimize(user._id);
        
        // Send alerts for critical optimization opportunities
        const criticalSuggestions = report.suggestions.filter(s => s.priority === 'critical');
        if (criticalSuggestions.length > 0) {
          await NotificationService.sendOptimizationAlert(user._id, criticalSuggestions);
        }
      }

      loggingService.info('Optimization opportunities monitoring completed', {
        analyzedUsers: recentUsage.length
      });
    } catch (error) {
      loggingService.error('Error in optimization monitoring', error as Error);
    }
  }

  private async gatherAnalysisContext(
    userId: string,
    projectId: string | undefined,
    timeframe: { startDate: Date; endDate: Date }
  ): Promise<AnalysisContext> {
    // Fetch usage data
    const query: any = {
      userId,
      createdAt: { $gte: timeframe.startDate, $lte: timeframe.endDate }
    };
    
    if (projectId) {
      query.projectId = projectId;
    }

    const usage = await Usage.find(query).sort({ createdAt: -1 }).limit(1000);
    
    // Fetch user projects
    const userProjects = await Project.find({ userId }).limit(50);

    // Calculate totals
    const totalUsage = usage.reduce(
      (acc, u) => ({
        cost: acc.cost + u.cost,
        tokens: acc.tokens + u.totalTokens,
        requests: acc.requests + 1
      }),
      { cost: 0, tokens: 0, requests: 0 }
    );

    return {
      userId,
      projectId,
      timeframe,
      userProjects,
      totalUsage,
      patterns: [] // Will be populated by detectUsagePatterns
    };
  }

  private async detectUsagePatterns(context: AnalysisContext): Promise<UsagePattern[]> {
    const usage = await Usage.find({
      userId: context.userId,
      createdAt: { $gte: context.timeframe.startDate, $lte: context.timeframe.endDate }
    });

    const patterns: UsagePattern[] = [];

    // Detect high-cost model usage
    const highCostModels = usage.filter(u => u.cost > 0.1);
    if (highCostModels.length > 0) {
      patterns.push({
        type: 'high_cost_model',
        frequency: highCostModels.length,
        impact: highCostModels.reduce((sum, u) => sum + u.cost, 0),
        examples: highCostModels.slice(0, 5)
      });
    }

    // Detect inefficient prompts (high token usage)
    const inefficientPrompts = usage.filter(u => u.promptTokens > 2000);
    if (inefficientPrompts.length > 5) {
      patterns.push({
        type: 'inefficient_prompts',
        frequency: inefficientPrompts.length,
        impact: inefficientPrompts.reduce((sum, u) => sum + u.cost, 0),
        examples: inefficientPrompts.slice(0, 5)
      });
    }

    // Detect repeated content (similar prompts)
    const repeatedContent = this.detectRepeatedContent(usage);
    if (repeatedContent.length > 0) {
      patterns.push({
        type: 'repeated_content',
        frequency: repeatedContent.length,
        impact: repeatedContent.reduce((sum, u) => sum + u.cost, 0),
        examples: repeatedContent.slice(0, 5)
      });
    }

    // Detect poor caching opportunities
    const cachingOpportunities = usage.filter(u => 
      u.requestTracking?.payload?.responseSize && 
      u.requestTracking.payload.responseSize > 1000 &&
      !u.requestTracking.payload.compressionRatio
    );
    if (cachingOpportunities.length > 10) {
      patterns.push({
        type: 'poor_caching',
        frequency: cachingOpportunities.length,
        impact: cachingOpportunities.reduce((sum, u) => sum + u.cost, 0),
        examples: cachingOpportunities.slice(0, 5)
      });
    }

    return patterns;
  }

  private detectRepeatedContent(usage: IUsage[]): IUsage[] {
    const promptGroups = new Map<string, IUsage[]>();
    
    // Group similar prompts
    usage.forEach(u => {
      const normalizedPrompt = u.prompt?.toLowerCase().slice(0, 200) || '';
      const key = normalizedPrompt.replace(/\s+/g, ' ').trim();
      
      if (!promptGroups.has(key)) {
        promptGroups.set(key, []);
      }
      promptGroups.get(key)!.push(u);
    });

    // Find groups with multiple occurrences
    const repeatedContent: IUsage[] = [];
    promptGroups.forEach(group => {
      if (group.length > 3) { // Same prompt used more than 3 times
        repeatedContent.push(...group);
      }
    });

    return repeatedContent;
  }

  private async applyOptimizationRules(context: AnalysisContext): Promise<OptimizationSuggestion[]> {
    const usage = await Usage.find({
      userId: context.userId,
      createdAt: { $gte: context.timeframe.startDate, $lte: context.timeframe.endDate }
    });

    const suggestions: OptimizationSuggestion[] = [];

    for (const rule of this.optimizationRules) {
      try {
        if (rule.condition(usage, context)) {
          const suggestion = rule.generateSuggestion(usage, context);
          suggestion.impact.estimatedSavings = rule.estimateSavings(usage, context);
          suggestions.push(suggestion);
        }
      } catch (error) {
        loggingService.error(`Error applying optimization rule ${rule.id}`, error as Error);
      }
    }

    // Sort by priority and impact
    return suggestions.sort((a, b) => {
      const priorityDiff = this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return b.impact.estimatedSavings - a.impact.estimatedSavings;
    });
  }

  private async calculateBenchmarks(context: AnalysisContext): Promise<OptimizationReport['benchmarks']> {
    // Calculate user performance
    const usage = await Usage.find({
      userId: context.userId,
      createdAt: { $gte: context.timeframe.startDate, $lte: context.timeframe.endDate }
    });

    const userStats = usage.reduce(
      (acc, u) => ({
        totalCost: acc.totalCost + u.cost,
        totalTokens: acc.totalTokens + u.totalTokens,
        totalResponseTime: acc.totalResponseTime + (u.responseTime || 0),
        errorCount: acc.errorCount + (u.errorOccurred ? 1 : 0),
        requestCount: acc.requestCount + 1
      }),
      { totalCost: 0, totalTokens: 0, totalResponseTime: 0, errorCount: 0, requestCount: 0 }
    );

    const userPerformance = {
      costPerToken: userStats.totalTokens > 0 ? userStats.totalCost / userStats.totalTokens : 0,
      responseTime: userStats.requestCount > 0 ? userStats.totalResponseTime / userStats.requestCount : 0,
      errorRate: userStats.requestCount > 0 ? (userStats.errorCount / userStats.requestCount) * 100 : 0
    };

    // Industry averages (these would typically come from a benchmarking service)
    const industryAverage = {
      costPerToken: 0.0001, // $0.0001 per token average
      responseTime: 2500, // 2.5 seconds average
      errorRate: 2.5 // 2.5% error rate
    };

    return {
      industryAverage,
      userPerformance
    };
  }

  private generateSummary(suggestions: OptimizationSuggestion[]): OptimizationReport['summary'] {
    const totalPotentialSavings = suggestions.reduce((sum, s) => sum + s.impact.estimatedSavings, 0);
    const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high' || s.priority === 'critical').length;
    const quickWins = suggestions.filter(s => 
      s.implementation.effort === 'low' && 
      (s.priority === 'high' || s.impact.estimatedSavings > 5)
    ).length;

    return {
      totalPotentialSavings,
      totalPotentialSavingsPercentage: 0, // Would calculate based on current spending
      totalSuggestions: suggestions.length,
      highPrioritySuggestions,
      quickWins
    };
  }

  private async trackOptimizationAnalytics(report: OptimizationReport): Promise<void> {
    try {
      await mixpanelService.track('Cost Optimization Analysis', {
        userId: report.userId,
        projectId: report.projectId,
        totalSuggestions: report.suggestions.length,
        potentialSavings: report.summary.totalPotentialSavings,
        highPrioritySuggestions: report.summary.highPrioritySuggestions,
        quickWins: report.summary.quickWins,
        patternsDetected: report.patterns.length,
        analysisTimeframe: `${report.timeframe.startDate.toISOString()}_to_${report.timeframe.endDate.toISOString()}`
      }, report.userId);

      // Track telemetry for system monitoring
      // NOTE: TelemetryService.track method is not available in this version
      loggingService.info('Cost optimization analytics tracked', {
        suggestions_count: report.suggestions.length,
        potential_savings: report.summary.totalPotentialSavings,
        patterns_count: report.patterns.length
      });
    } catch (error) {
      loggingService.error('Error tracking optimization analytics', error as Error);
    }
  }

  private async storeOptimizationReport(report: OptimizationReport): Promise<void> {
    // This could store the report in a dedicated collection for historical tracking
    // For now, we'll just log it
    loggingService.info('Optimization report generated', {
      userId: report.userId,
      projectId: report.projectId,
      suggestionsCount: report.suggestions.length,
      potentialSavings: report.summary.totalPotentialSavings
    });
  }

  private getPriorityWeight(priority: string): number {
    switch (priority) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  private initializeOptimizationRules(): OptimizationRule[] {
    return [
      {
        id: 'high_cost_model_alternative',
        name: 'High-Cost Model Alternative',
        description: 'Detect usage of expensive models where cheaper alternatives might be suitable',
        category: 'model_selection',
        priority: 'high',
        condition: (usage) => {
          const expensiveModels = usage.filter(u => u.cost > 0.05);
          return expensiveModels.length > 5;
        },
        generateSuggestion: (usage) => ({
          id: 'high_cost_model_alt_' + Date.now(),
          type: 'cost_reduction',
          title: 'Consider Cheaper Model Alternatives',
          description: 'You\'re frequently using expensive models. Consider trying cheaper alternatives for simpler tasks.',
          impact: {
            estimatedSavings: 0, // Will be calculated by estimateSavings
            estimatedSavingsPercentage: 40,
            affectedRequests: usage.filter(u => u.cost > 0.05).length,
            timeframe: 'immediate'
          },
          implementation: {
            effort: 'low',
            steps: [
              'Identify tasks that don\'t require premium models',
              'Test cheaper models (e.g., GPT-3.5 instead of GPT-4)',
              'Monitor quality to ensure acceptable results',
              'Implement model routing based on task complexity'
            ],
            technicalDetails: 'Use Cost Katana\'s model recommendations or A/B testing features',
            riskLevel: 'low'
          },
          priority: 'high',
          category: 'Model Selection'
        }),
        estimateSavings: (usage) => {
          const expensiveUsage = usage.filter(u => u.cost > 0.05);
          return expensiveUsage.reduce((sum, u) => sum + (u.cost * 0.4), 0); // 40% savings
        }
      },
      {
        id: 'prompt_length_optimization',
        name: 'Prompt Length Optimization',
        description: 'Detect overly long prompts that could be optimized',
        category: 'prompt_optimization',
        priority: 'medium',
        condition: (usage) => {
          const longPrompts = usage.filter(u => u.promptTokens > 1000);
          return longPrompts.length > 10;
        },
        generateSuggestion: (usage) => ({
          id: 'prompt_length_opt_' + Date.now(),
          type: 'efficiency_gain',
          title: 'Optimize Prompt Length',
          description: 'Your prompts are often quite long. Shortening them could reduce token usage and costs.',
          impact: {
            estimatedSavings: 0,
            estimatedSavingsPercentage: 25,
            affectedRequests: usage.filter(u => u.promptTokens > 1000).length,
            timeframe: 'short_term'
          },
          implementation: {
            effort: 'medium',
            steps: [
              'Review your longest prompts for unnecessary content',
              'Use prompt templates with variables',
              'Remove redundant examples or instructions',
              'Use system messages instead of repeating context'
            ],
            technicalDetails: 'Use Cost Katana\'s Cortex language for efficient prompt compression',
            riskLevel: 'medium'
          },
          priority: 'medium',
          category: 'Prompt Engineering'
        }),
        estimateSavings: (usage) => {
          const longPrompts = usage.filter(u => u.promptTokens > 1000);
          return longPrompts.reduce((sum, u) => sum + (u.cost * 0.25), 0); // 25% savings
        }
      },
      {
        id: 'repeated_content_caching',
        name: 'Repeated Content Caching',
        description: 'Detect repeated prompts/content that could benefit from caching',
        category: 'efficiency',
        priority: 'high',
        condition: (usage) => {
          const promptCounts = new Map();
          usage.forEach(u => {
            const key = u.prompt?.slice(0, 100) || '';
            promptCounts.set(key, (promptCounts.get(key) || 0) + 1);
          });
          return Array.from(promptCounts.values()).some(count => count > 3);
        },
        generateSuggestion: (usage) => ({
          id: 'repeated_content_cache_' + Date.now(),
          type: 'cost_reduction',
          title: 'Enable Response Caching',
          description: 'You have repeated similar requests. Enabling caching could significantly reduce costs.',
          impact: {
            estimatedSavings: 0,
            estimatedSavingsPercentage: 70,
            affectedRequests: usage.length,
            timeframe: 'immediate'
          },
          implementation: {
            effort: 'low',
            steps: [
              'Enable semantic caching in Cost Katana',
              'Set appropriate cache TTL based on content freshness needs',
              'Monitor cache hit rates',
              'Adjust caching strategy based on patterns'
            ],
            technicalDetails: 'Use Cost Katana\'s built-in semantic caching with Redis backend',
            riskLevel: 'low'
          },
          priority: 'high',
          category: 'Caching'
        }),
        estimateSavings: (usage, context) => {
          // Calculate potential savings from caching repeated content
          const promptCounts = new Map();
          usage.forEach(u => {
            const key = u.prompt?.slice(0, 100) || '';
            promptCounts.set(key, (promptCounts.get(key) || 0) + 1);
          });
          
          let potentialSavings = 0;
          promptCounts.forEach((count, prompt) => {
            if (count > 1) {
              const relatedUsage = usage.filter(u => u.prompt?.slice(0, 100) === prompt);
              const totalCost = relatedUsage.reduce((sum, u) => sum + u.cost, 0);
              potentialSavings += totalCost * 0.7 * ((count - 1) / count); // 70% savings on repeated requests
            }
          });
          
          return potentialSavings;
        }
      },
      {
        id: 'error_rate_optimization',
        name: 'Error Rate Optimization',
        description: 'Detect high error rates that lead to wasted API calls',
        category: 'efficiency',
        priority: 'high',
        condition: (usage) => {
          const errorRate = usage.filter(u => u.errorOccurred).length / usage.length;
          return errorRate > 0.05; // More than 5% error rate
        },
        generateSuggestion: (usage) => ({
          id: 'error_rate_opt_' + Date.now(),
          type: 'cost_reduction',
          title: 'Reduce API Error Rate',
          description: 'Your error rate is higher than optimal. Reducing errors will save costs and improve reliability.',
          impact: {
            estimatedSavings: 0,
            estimatedSavingsPercentage: 15,
            affectedRequests: usage.filter(u => u.errorOccurred).length,
            timeframe: 'short_term'
          },
          implementation: {
            effort: 'medium',
            steps: [
              'Implement proper input validation before API calls',
              'Add retry logic with exponential backoff',
              'Monitor error patterns and fix common issues',
              'Use Cost Katana\'s error analytics to identify root causes'
            ],
            technicalDetails: 'Implement circuit breaker patterns and comprehensive error handling',
            riskLevel: 'low'
          },
          priority: 'high',
          category: 'Reliability'
        }),
        estimateSavings: (usage) => {
          const failedRequests = usage.filter(u => u.errorOccurred);
          return failedRequests.reduce((sum, u) => sum + u.cost, 0); // Save the entire cost of failed requests
        }
      },
      {
        id: 'batch_processing_opportunity',
        name: 'Batch Processing Opportunity',
        description: 'Detect opportunities for batch processing to reduce costs',
        category: 'efficiency',
        priority: 'medium',
        condition: (usage) => {
          // Check if there are many small, similar requests that could be batched
          const smallRequests = usage.filter(u => u.promptTokens < 100 && u.completionTokens < 200);
          return smallRequests.length > 50;
        },
        generateSuggestion: (usage) => ({
          id: 'batch_processing_' + Date.now(),
          type: 'efficiency_gain',
          title: 'Implement Batch Processing',
          description: 'You have many small requests that could be batched together for better efficiency.',
          impact: {
            estimatedSavings: 0,
            estimatedSavingsPercentage: 20,
            affectedRequests: usage.filter(u => u.promptTokens < 100).length,
            timeframe: 'long_term'
          },
          implementation: {
            effort: 'high',
            steps: [
              'Identify requests that can be grouped together',
              'Implement request queuing and batching logic',
              'Adjust application flow to handle batch responses',
              'Monitor batch efficiency and adjust batch sizes'
            ],
            technicalDetails: 'Use Cost Katana\'s batch processing features or implement custom batching',
            riskLevel: 'medium'
          },
          priority: 'medium',
          category: 'Architecture'
        }),
        estimateSavings: (usage) => {
          const batchableRequests = usage.filter(u => u.promptTokens < 100 && u.completionTokens < 200);
          return batchableRequests.reduce((sum, u) => sum + (u.cost * 0.2), 0); // 20% savings from batching
        }
      }
    ];
  }
}

export const costOptimizationEngine = CostOptimizationEngine.getInstance();