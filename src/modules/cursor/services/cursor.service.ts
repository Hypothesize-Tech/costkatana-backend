import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AICostTrackingService } from '../../admin-ai-cost-monitoring/ai-cost-tracking.service';
import { UsageService } from '../../usage/services/usage.service';
import { RealtimeUpdateService } from '../../usage/services/realtime-update.service';
import { Workspace as WorkspaceSchema } from '../../../schemas/user/workspace.schema';
import { Project } from '../../../schemas/team-project/project.schema';

interface AiRequest {
  prompt: string;
  response: string;
  model: string;
  tokens_used?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  request_type: string;
  context_files?: string[];
  generated_files?: string[];
  execution_time?: number;
  success?: boolean;
  error_message?: string;
}

interface OptimizationRequest {
  prompt: string;
  current_tokens: number;
  target_reduction?: number;
  preserve_quality?: boolean;
  context?: string;
}

interface CodeContext {
  file_path?: string;
  language?: string;
  code_snippet?: string;
  function_name?: string;
  class_name?: string;
  imports?: string[];
  dependencies?: string[];
}

interface Workspace {
  name?: string;
  path?: string;
  projectId?: string;
  language?: string;
  framework?: string;
  ownerId?: string;
}

@Injectable()
export class CursorService {
  private readonly logger = new Logger(CursorService.name);

  constructor(
    @Inject(forwardRef(() => AICostTrackingService))
    private readonly aiCostTrackerService: AICostTrackingService,
    @Inject(forwardRef(() => UsageService))
    private readonly usageService: UsageService,
    @Inject(forwardRef(() => RealtimeUpdateService))
    private readonly realtimeUpdateService: RealtimeUpdateService,
    @InjectModel(WorkspaceSchema.name)
    private readonly workspaceModel: Model<WorkspaceSchema>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
  ) {}

  async trackUsage(params: {
    userId: string;
    aiRequest: AiRequest;
    workspace?: Workspace;
    codeContext?: CodeContext;
  }) {
    const { userId, aiRequest, workspace, codeContext } = params;

    try {
      // Validate input
      if (
        !userId ||
        !aiRequest ||
        !aiRequest.prompt ||
        !aiRequest.response ||
        !aiRequest.model
      ) {
        throw new Error('Invalid tracking parameters: missing required fields');
      }

      // Calculate token usage with fallback estimation
      const promptTokens =
        aiRequest.tokens_used?.prompt_tokens ||
        Math.ceil(aiRequest.prompt.length / 4); // Rough estimation: 4 chars per token

      const completionTokens =
        aiRequest.tokens_used?.completion_tokens ||
        Math.ceil(aiRequest.response.length / 4);

      const totalTokens =
        aiRequest.tokens_used?.total_tokens || promptTokens + completionTokens;

      // Track the usage with comprehensive metadata
      await this.aiCostTrackerService.trackRequest(
        {
          prompt: aiRequest.prompt,
          model: aiRequest.model,
          promptTokens: promptTokens,
        },
        {
          content: aiRequest.response,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens,
          },
        },
        userId,
        {
          service: 'cursor',
          endpoint: 'extension',
          projectId: workspace?.projectId,
          tags: ['extension', 'cursor', 'ide-integration'],
          metadata: {
            workspace: workspace
              ? {
                  name: workspace.name,
                  path: workspace.path,
                  projectId: workspace.projectId,
                  language: workspace.language,
                  framework: workspace.framework,
                }
              : undefined,
            codeContext: codeContext
              ? {
                  file_path: codeContext.file_path,
                  language: codeContext.language,
                  code_snippet: codeContext.code_snippet?.substring(0, 1000), // Limit snippet size
                  function_name: codeContext.function_name,
                  class_name: codeContext.class_name,
                  imports: codeContext.imports?.slice(0, 10), // Limit imports
                  dependencies: codeContext.dependencies?.slice(0, 10),
                }
              : undefined,
            requestType: aiRequest.request_type,
            executionTime: aiRequest.execution_time,
            success: aiRequest.success,
            errorMessage: aiRequest.error_message,
            contextFilesCount: aiRequest.context_files?.length || 0,
            generatedFilesCount: aiRequest.generated_files?.length || 0,
            contextFiles: aiRequest.context_files?.slice(0, 5), // Limit file list
            generatedFiles: aiRequest.generated_files?.slice(0, 5),
            timestamp: new Date().toISOString(),
          },
        },
      );

      // Get the latest usage stats with retry logic
      let usageStats;
      let retryCount = 0;
      const maxRetries = 3;

      do {
        usageStats = await this.usageService.getRecentUsageForUser(userId, 1);
        if (usageStats.length > 0) break;
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * (retryCount + 1)),
        );
        retryCount++;
      } while (retryCount < maxRetries);

      if (!usageStats || usageStats.length === 0) {
        throw new Error('Failed to retrieve tracked usage after retries');
      }

      const latestUsage = usageStats[0];

      // Emit real-time update for live dashboard
      try {
        await this.realtimeUpdateService.emitUsageUpdate(userId, {
          ...latestUsage,
          cursorSpecific: {
            workspace: workspace?.name,
            file: codeContext?.file_path,
            language: codeContext?.language,
            requestType: aiRequest.request_type,
          },
        });
      } catch (realtimeError) {
        this.logger.warn('Failed to emit real-time update', realtimeError);
        // Don't fail the whole operation for real-time issues
      }

      this.logger.log('✅ Cursor usage tracked successfully', {
        userId,
        model: aiRequest.model,
        totalTokens,
        cost: latestUsage.cost,
        executionTime: aiRequest.execution_time,
      });

      return {
        usageId: latestUsage._id,
        cost: latestUsage.cost,
        tokens: latestUsage.totalTokens,
        promptTokens: latestUsage.promptTokens,
        completionTokens: latestUsage.completionTokens,
        model: latestUsage.model,
        estimated: !aiRequest.tokens_used, // Flag if we estimated tokens
        timestamp: latestUsage.createdAt || new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to track cursor usage', {
        userId,
        model: aiRequest?.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async optimizePrompt(optimizationRequest: OptimizationRequest) {
    const {
      prompt,
      current_tokens,
      target_reduction,
      preserve_quality,
      context,
    } = optimizationRequest;

    try {
      if (!prompt || prompt.trim().length === 0) {
        throw new Error('Invalid prompt: cannot optimize empty prompt');
      }

      const originalPrompt = prompt;
      let optimizedPrompt = originalPrompt;
      const optimizations = [];

      // 1. Basic cleanup
      optimizedPrompt = this.cleanPrompt(optimizedPrompt);
      if (optimizedPrompt !== originalPrompt) {
        optimizations.push('Removed unnecessary whitespace and formatting');
      }

      // 2. Remove redundant phrases
      const redundantPatterns = [
        /\b(please|kindly|can you|could you|would you mind)\s+/gi,
        /\b(i want you to|i need you to|i would like you to)\s+/gi,
        /\b(make sure to|remember to|be sure to)\s+/gi,
        /\b(also|and|plus|additionally),\s+/gi,
        /\b(very|really|extremely|quite)\s+/gi,
      ];

      redundantPatterns.forEach((pattern) => {
        if (pattern.test(optimizedPrompt)) {
          optimizedPrompt = optimizedPrompt.replace(pattern, '');
          optimizations.push(`Removed redundant phrases: ${pattern.source}`);
        }
      });

      // 3. Condense repetitive instructions
      optimizedPrompt = this.condenseRepetitiveInstructions(
        optimizedPrompt,
        optimizations,
      );

      // 4. Optimize based on context
      if (context) {
        optimizedPrompt = this.optimizeForContext(
          optimizedPrompt,
          context,
          optimizations,
        );
      }

      // 5. Final cleanup
      optimizedPrompt = optimizedPrompt.trim();
      if (optimizedPrompt.endsWith('.')) {
        optimizedPrompt = optimizedPrompt.slice(0, -1);
      }

      // Calculate metrics
      const originalTokens =
        current_tokens || Math.ceil(originalPrompt.length / 4);
      const optimizedTokens = Math.ceil(optimizedPrompt.length / 4);
      const tokenReduction = Math.round(
        ((originalTokens - optimizedTokens) / originalTokens) * 100,
      );
      const targetReduction = target_reduction || 20; // Default 20% reduction

      // Apply more aggressive optimization if target not met
      if (tokenReduction < targetReduction && preserve_quality !== false) {
        const aggressiveOptimizations = this.applyAggressiveOptimization(
          optimizedPrompt,
          optimizations,
        );
        optimizedPrompt = aggressiveOptimizations.prompt;
        optimizations.push(...aggressiveOptimizations.applied);
      }

      // Recalculate after aggressive optimization
      const finalTokens = Math.ceil(optimizedPrompt.length / 4);
      const finalTokenReduction = Math.round(
        ((originalTokens - finalTokens) / originalTokens) * 100,
      );

      // Estimate cost savings (using GPT-4 pricing as baseline)
      const costPer1K = 0.03; // GPT-4 input token cost
      const costSavings = ((originalTokens - finalTokens) / 1000) * costPer1K;

      // Generate context-aware suggestions
      const suggestions = this.generateOptimizationSuggestions(
        finalTokenReduction,
        context,
        optimizedPrompt.length,
      );

      const result = {
        original_prompt: originalPrompt,
        optimized_prompt: optimizedPrompt,
        token_reduction: finalTokenReduction,
        original_tokens: originalTokens,
        optimized_tokens: finalTokens,
        cost_savings: costSavings.toFixed(8),
        quality_preserved: preserve_quality !== false,
        optimizations_applied: optimizations,
        suggestions,
        metadata: {
          original_length: originalPrompt.length,
          optimized_length: optimizedPrompt.length,
          context_provided: !!context,
          target_reduction_achieved:
            finalTokenReduction >= (target_reduction || 20),
        },
      };

      this.logger.log('✅ Prompt optimized successfully', {
        originalTokens,
        optimizedTokens: finalTokens,
        reduction: finalTokenReduction,
        costSavings: costSavings.toFixed(8),
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to optimize prompt', {
        error: error instanceof Error ? error.message : String(error),
        promptLength: prompt?.length,
      });
      throw error;
    }
  }

  /**
   * Clean and normalize prompt text
   */
  private cleanPrompt(prompt: string): string {
    return prompt
      .trim()
      .replace(/\s+/g, ' ') // Multiple spaces to single
      .replace(/\n+/g, ' ') // Newlines to spaces
      .replace(/\t+/g, ' '); // Tabs to spaces
  }

  /**
   * Condense repetitive or verbose instructions
   */
  private condenseRepetitiveInstructions(
    prompt: string,
    optimizations: string[],
  ): string {
    // Common repetitive patterns
    const patterns = [
      {
        regex: /(\w+)\s+and\s+\1\s+and\s+\1/g,
        replacement: '$1',
        description: 'Condensed repetitive words',
      },
      {
        regex: /step by step/gi,
        replacement: 'step-by-step',
        description: 'Condensed "step by step"',
      },
      {
        regex: /as much as possible/gi,
        replacement: 'maximally',
        description: 'Condensed verbose phrase',
      },
    ];

    let optimized = prompt;
    patterns.forEach(({ regex, replacement, description }) => {
      if (regex.test(optimized)) {
        optimized = optimized.replace(regex, replacement);
        optimizations.push(description);
      }
    });

    return optimized;
  }

  /**
   * Optimize prompt based on provided context
   */
  private optimizeForContext(
    prompt: string,
    context: string,
    optimizations: string[],
  ): string {
    // Context-specific optimizations
    if (context.toLowerCase().includes('code')) {
      // Code-related context
      if (prompt.includes('function') || prompt.includes('class')) {
        optimizations.push('Optimized for code generation context');
        return prompt.replace(
          /\b(write|create|implement)\s+(a|an)\s+/gi,
          '$1 ',
        );
      }
    } else if (context.toLowerCase().includes('analysis')) {
      // Analysis context
      optimizations.push('Optimized for analysis context');
      return prompt.replace(
        /\b(analyze|examine|review)\s+(the|this)\s+/gi,
        '$1 ',
      );
    }

    return prompt;
  }

  /**
   * Apply more aggressive optimizations when needed
   */
  private applyAggressiveOptimization(
    prompt: string,
    optimizations: string[],
  ): { prompt: string; applied: string[] } {
    const applied = [];
    let optimized = prompt;

    // Remove common filler words
    const fillerWords = /\b(just|simply|basically|actually|really)\s+/gi;
    if (fillerWords.test(optimized)) {
      optimized = optimized.replace(fillerWords, '');
      applied.push('Removed filler words');
    }

    // Shorten common phrases
    const phraseShortcuts = [
      { from: 'do not', to: "don't" },
      { from: 'cannot', to: "can't" },
      { from: 'will not', to: "won't" },
      { from: 'should not', to: "shouldn't" },
      { from: 'for example', to: 'e.g.' },
      { from: 'that is', to: 'i.e.' },
    ];

    phraseShortcuts.forEach(({ from, to }) => {
      const regex = new RegExp(`\\b${from}\\b`, 'gi');
      if (regex.test(optimized)) {
        optimized = optimized.replace(regex, to);
        applied.push(`Shortened "${from}" to "${to}"`);
      }
    });

    return { prompt: optimized, applied };
  }

  /**
   * Generate context-aware suggestions
   */
  private generateOptimizationSuggestions(
    tokenReduction: number,
    context?: string,
    optimizedLength?: number,
  ): string[] {
    const suggestions = [
      'Use the optimized prompt for similar requests',
      'Consider using a cheaper model for simple tasks',
      'Batch similar requests to reduce API overhead',
    ];

    if (tokenReduction > 30) {
      suggestions.push(
        'Great reduction! Consider saving this as a prompt template',
      );
    }

    if (context?.toLowerCase().includes('code')) {
      suggestions.push(
        'For code tasks, consider using GPT-3.5-turbo for faster responses',
      );
      suggestions.push(
        'Use code-specific prompts with language and framework context',
      );
    }

    if (optimizedLength && optimizedLength > 1000) {
      suggestions.push(
        'Consider breaking very long prompts into smaller, focused requests',
      );
    }

    return suggestions.slice(0, 5); // Limit to 5 suggestions
  }

  async getSuggestions(codeContext: CodeContext) {
    try {
      const suggestions = [];
      const language = codeContext.language?.toLowerCase() || 'unknown';
      const hasCodeSnippet = !!codeContext.code_snippet;
      const hasFilePath = !!codeContext.file_path;

      // Model optimization suggestions based on context
      if (language === 'typescript' || language === 'javascript') {
        suggestions.push({
          title: 'Use GPT-4 for Complex TypeScript',
          description:
            'GPT-4 excels at type inference and complex JavaScript patterns',
          priority: 'high',
          action: 'optimize_model_selection',
          metadata: { model: 'gpt-4', reason: 'typescript_complexity' },
        });
      } else if (language === 'python') {
        suggestions.push({
          title: 'Use GPT-3.5-turbo for Python Scripts',
          description: 'Cost-effective for most Python development tasks',
          priority: 'medium',
          action: 'optimize_model_selection',
          metadata: { model: 'gpt-3.5-turbo', reason: 'python_efficiency' },
        });
      } else if (language === 'java' || language === 'csharp') {
        suggestions.push({
          title: 'Use Claude for Enterprise Languages',
          description:
            'Excellent at Java/C# enterprise patterns and best practices',
          priority: 'high',
          action: 'optimize_model_selection',
          metadata: { model: 'claude-3', reason: 'enterprise_patterns' },
        });
      }

      // Code analysis suggestions
      if (hasCodeSnippet && codeContext.code_snippet!.length > 100) {
        suggestions.push({
          title: 'Analyze Code for Optimization',
          description:
            'Run code analysis to identify potential improvements and cost savings',
          priority: 'medium',
          action: 'analyze_code',
          metadata: {
            analysis_type: 'optimization',
            code_length: codeContext.code_snippet!.length,
          },
        });
      }

      // File-specific suggestions
      if (hasFilePath) {
        const fileName = codeContext.file_path!.split('/').pop() || '';
        if (fileName.endsWith('.test.ts') || fileName.endsWith('.spec.ts')) {
          suggestions.push({
            title: 'Use Focused Model for Tests',
            description:
              'GPT-3.5-turbo is often sufficient for test file generation',
            priority: 'low',
            action: 'optimize_model_selection',
            metadata: { model: 'gpt-3.5-turbo', reason: 'test_generation' },
          });
        } else if (fileName.includes('config') || fileName.includes('env')) {
          suggestions.push({
            title: 'Careful with Config Files',
            description:
              'Avoid exposing sensitive configuration in AI requests',
            priority: 'high',
            action: 'security_check',
            metadata: { security_level: 'high', file_type: 'config' },
          });
        }
      }

      // Function/class context suggestions
      if (codeContext.function_name) {
        suggestions.push({
          title: `Optimize ${codeContext.function_name}`,
          description: 'Focus prompts on specific function improvements',
          priority: 'medium',
          action: 'optimize_function',
          metadata: {
            function_name: codeContext.function_name,
            optimization_type: 'function',
          },
        });
      }

      // Import-based suggestions
      if (codeContext.imports && codeContext.imports.length > 0) {
        const hasReact = codeContext.imports.some((imp) =>
          imp.toLowerCase().includes('react'),
        );
        const hasDatabase = codeContext.imports.some(
          (imp) =>
            imp.toLowerCase().includes('mongoose') ||
            imp.toLowerCase().includes('prisma'),
        );

        if (hasReact) {
          suggestions.push({
            title: 'React-Specific Optimization',
            description:
              'Use React-optimized prompts for component development',
            priority: 'medium',
            action: 'framework_optimization',
            metadata: { framework: 'react', optimization_type: 'component' },
          });
        }

        if (hasDatabase) {
          suggestions.push({
            title: 'Database Query Optimization',
            description: 'Optimize database queries in your AI requests',
            priority: 'high',
            action: 'optimize_queries',
            metadata: { has_database: true, optimization_type: 'query' },
          });
        }
      }

      // General cost-saving suggestions
      suggestions.push({
        title: 'Batch Similar Requests',
        description: 'Combine multiple similar requests to reduce API overhead',
        priority: 'medium',
        action: 'batch_requests',
        metadata: { savings_type: 'batching', estimated_savings: '20-30%' },
      });

      suggestions.push({
        title: 'Create Prompt Templates',
        description:
          'Save common prompts as templates for consistent, cost-effective usage',
        priority: 'medium',
        action: 'create_template',
        metadata: { template_type: 'reusable', benefit: 'consistency' },
      });

      suggestions.push({
        title: 'Use Model Selection Wisely',
        description:
          'Choose appropriate models based on task complexity vs cost',
        priority: 'high',
        action: 'model_guidance',
        metadata: {
          guidance_type: 'cost_performance',
          models: ['gpt-4', 'gpt-3.5-turbo', 'claude-3'],
        },
      });

      // Limit to top 5 most relevant suggestions
      return suggestions
        .sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          return (
            priorityOrder[b.priority as keyof typeof priorityOrder] -
            priorityOrder[a.priority as keyof typeof priorityOrder]
          );
        })
        .slice(0, 5);
    } catch (error) {
      this.logger.error('Failed to generate suggestions', error);
      // Return basic fallback suggestions
      return [
        {
          title: 'Basic Cost Optimization',
          description: 'Use GPT-3.5-turbo for general development tasks',
          priority: 'medium',
          action: 'optimize_model_selection',
        },
        {
          title: 'Batch Requests',
          description: 'Combine similar requests to reduce overhead',
          priority: 'medium',
          action: 'batch_requests',
        },
      ];
    }
  }

  async analyzeCode(codeContext: CodeContext) {
    try {
      const codeSnippet = codeContext.code_snippet || '';
      const language = codeContext.language?.toLowerCase() || 'unknown';

      // Basic metrics
      const lines = codeSnippet
        .split('\n')
        .filter((line) => line.trim().length > 0).length;
      const totalCharacters = codeSnippet.length;
      const avgLineLength = lines > 0 ? totalCharacters / lines : 0;

      // Language-specific analysis
      const analysis = this.performLanguageSpecificAnalysis(
        codeSnippet,
        language,
      );

      // Complexity calculation
      const complexityMetrics = this.calculateComplexityMetrics(
        analysis,
        lines,
        avgLineLength,
      );
      const complexityScore = this.computeComplexityScore(complexityMetrics);

      // Cost optimization analysis
      const costAnalysis = this.analyzeCostOptimizationPotential(
        analysis,
        complexityMetrics,
      );

      // Generate recommendations
      const recommendations = this.generateCodeRecommendations(
        analysis,
        complexityMetrics,
        costAnalysis,
        language,
      );

      // Calculate estimated token usage for AI processing
      const estimatedTokens = this.estimateTokenUsage(codeSnippet, language);

      const result = {
        complexityScore,
        complexityMetrics,
        lines,
        totalCharacters,
        avgLineLength: Math.round(avgLineLength),
        language,
        analysis,
        optimizationPotential: this.getOptimizationPotential(complexityScore),
        costAnalysis,
        recommendations: recommendations.slice(0, 8), // Limit recommendations
        estimatedTokens,
        metadata: {
          hasFunctions: analysis.functions > 0,
          hasClasses: analysis.classes > 0,
          hasImports: analysis.imports > 0,
          hasComments: analysis.comments > 0,
          hasErrorHandling: analysis.errorHandling > 0,
          analyzedAt: new Date().toISOString(),
        },
      };

      this.logger.log('✅ Code analysis completed', {
        language,
        complexityScore,
        lines,
        functions: analysis.functions,
        optimizationPotential: result.optimizationPotential,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to analyze code', {
        language: codeContext.language,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return basic analysis on error
      return {
        complexityScore: 50,
        lines: (codeContext.code_snippet || '').split('\n').length,
        optimizationPotential: 'medium',
        recommendations: [
          'Unable to perform detailed analysis',
          'Check code manually for improvements',
        ],
        error: 'Analysis failed',
      };
    }
  }

  /**
   * Perform language-specific code analysis
   */
  private performLanguageSpecificAnalysis(
    codeSnippet: string,
    language: string,
  ) {
    const analysis = {
      functions: 0,
      classes: 0,
      imports: 0,
      comments: 0,
      errorHandling: 0,
      asyncFunctions: 0,
      arrowFunctions: 0,
      nestedDepth: 0,
      variables: 0,
      constants: 0,
    };

    switch (language) {
      case 'typescript':
      case 'javascript':
        analysis.functions = (
          codeSnippet.match(/function\s+\w+/g) || []
        ).length;
        analysis.classes = (codeSnippet.match(/class\s+\w+/g) || []).length;
        analysis.imports = (
          codeSnippet.match(/import\s+|from\s+['"]/g) || []
        ).length;
        analysis.comments = (
          codeSnippet.match(/(\/\/|\/\*|\*\/)/g) || []
        ).length;
        analysis.errorHandling = (
          codeSnippet.match(/try\s*\{|catch\s*\(|throw\s+/g) || []
        ).length;
        analysis.asyncFunctions = (
          codeSnippet.match(/async\s+function|async\s*\(/g) || []
        ).length;
        analysis.arrowFunctions = (
          codeSnippet.match(/\w+\s*=>\s*\{|\w+\s*=>\s*\w+/g) || []
        ).length;
        analysis.variables = (
          codeSnippet.match(/(const|let|var)\s+\w+/g) || []
        ).length;
        break;

      case 'python':
        analysis.functions = (codeSnippet.match(/def\s+\w+/g) || []).length;
        analysis.classes = (codeSnippet.match(/class\s+\w+/g) || []).length;
        analysis.imports = (
          codeSnippet.match(/import\s+|from\s+\w+/g) || []
        ).length;
        analysis.comments = (codeSnippet.match(/#/g) || []).length;
        analysis.errorHandling = (
          codeSnippet.match(/try:|except\s+|raise\s+/g) || []
        ).length;
        analysis.variables = (
          codeSnippet.match(/\w+\s*=\s*[^=]/g) || []
        ).length;
        break;

      case 'java':
      case 'csharp':
        analysis.functions = (
          codeSnippet.match(/(public|private|protected)?\s+\w+\s+\w+\s*\(/g) ||
          []
        ).length;
        analysis.classes = (codeSnippet.match(/class\s+\w+/g) || []).length;
        analysis.imports = (
          codeSnippet.match(/import\s+|using\s+/g) || []
        ).length;
        analysis.comments = (
          codeSnippet.match(/(\/\/|\/\*|\*\/)/g) || []
        ).length;
        analysis.errorHandling = (
          codeSnippet.match(/try\s*\{|catch\s*\(|throw\s+/g) || []
        ).length;
        analysis.variables = (
          codeSnippet.match(/(int|float|string|bool|var)\s+\w+/g) || []
        ).length;
        break;

      default:
        // Generic analysis
        analysis.functions = (
          codeSnippet.match(/(function|def|func)\s+\w+/g) || []
        ).length;
        analysis.classes = (codeSnippet.match(/class\s+\w+/g) || []).length;
        analysis.comments = (codeSnippet.match(/(\/\/|#|\/\*)/g) || []).length;
    }

    // Calculate nesting depth
    analysis.nestedDepth = this.calculateNestingDepth(codeSnippet);

    return analysis;
  }

  /**
   * Calculate code complexity metrics
   */
  private calculateComplexityMetrics(
    analysis: any,
    lines: number,
    avgLineLength: number,
  ) {
    return {
      cyclomaticComplexity:
        analysis.functions + analysis.classes + analysis.errorHandling,
      nestingComplexity: analysis.nestedDepth,
      sizeComplexity: Math.log10(lines + 1) * 10,
      lengthComplexity: Math.log10(avgLineLength + 1) * 5,
      dependencyComplexity: analysis.imports * 2,
      asyncComplexity: analysis.asyncFunctions * 3,
    };
  }

  /**
   * Compute overall complexity score
   */
  private computeComplexityScore(metrics: any): number {
    const weights = {
      cyclomaticComplexity: 1.0,
      nestingComplexity: 1.5,
      sizeComplexity: 0.8,
      lengthComplexity: 0.5,
      dependencyComplexity: 0.3,
      asyncComplexity: 0.7,
    };

    let score = 0;
    Object.entries(metrics).forEach(([key, value]) => {
      score += (value as number) * (weights[key as keyof typeof weights] || 1);
    });

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Analyze cost optimization potential
   */
  private analyzeCostOptimizationPotential(
    analysis: any,
    complexityMetrics: any,
  ) {
    const potential = {
      refactoringSavings: 0,
      promptOptimizationSavings: 0,
      modelSelectionSavings: 0,
      totalEstimatedSavings: 0,
    };

    // Refactoring potential
    if (complexityMetrics.cyclomaticComplexity > 5) {
      potential.refactoringSavings = 15; // 15% potential savings
    }

    // Prompt optimization potential
    if (analysis.functions > 3 || analysis.classes > 1) {
      potential.promptOptimizationSavings = 10; // 10% potential savings
    }

    // Model selection potential
    if (analysis.comments < analysis.functions) {
      potential.modelSelectionSavings = 20; // 20% potential savings from better model choice
    }

    potential.totalEstimatedSavings =
      potential.refactoringSavings +
      potential.promptOptimizationSavings +
      potential.modelSelectionSavings;

    return potential;
  }

  /**
   * Generate targeted code recommendations
   */
  private generateCodeRecommendations(
    analysis: any,
    complexityMetrics: any,
    costAnalysis: any,
    language: string,
  ): string[] {
    const recommendations = [];

    // Complexity-based recommendations
    if (complexityMetrics.cyclomaticComplexity > 5) {
      recommendations.push(
        'Consider breaking down complex functions into smaller, focused methods',
      );
    }

    if (complexityMetrics.nestingComplexity > 3) {
      recommendations.push(
        'Reduce nesting depth by extracting nested logic into separate functions',
      );
    }

    if (analysis.functions > 0 && analysis.comments === 0) {
      recommendations.push(
        'Add JSDoc/TypeScript comments to document function purposes and parameters',
      );
    }

    // Error handling recommendations
    if (analysis.errorHandling === 0 && analysis.functions > 0) {
      recommendations.push('Add proper error handling and try-catch blocks');
    }

    // Language-specific recommendations
    if (language === 'typescript' && analysis.functions > 0) {
      recommendations.push(
        'Use TypeScript interfaces for complex parameter objects',
      );
      if (analysis.asyncFunctions > 0) {
        recommendations.push(
          'Ensure all async functions have proper Promise type annotations',
        );
      }
    }

    if (language === 'python' && analysis.functions > 0) {
      recommendations.push(
        'Add type hints for better code clarity and IDE support',
      );
    }

    // Cost optimization recommendations
    if (costAnalysis.totalEstimatedSavings > 20) {
      recommendations.push(
        `Potential ${costAnalysis.totalEstimatedSavings}% cost savings through optimization`,
      );
    }

    // General best practices
    if (analysis.variables > 10) {
      recommendations.push(
        'Consider grouping related variables or using configuration objects',
      );
    }

    if (analysis.imports > 5) {
      recommendations.push(
        'Review imports - remove unused dependencies to reduce bundle size',
      );
    }

    recommendations.push('Use descriptive variable and function names');
    recommendations.push('Consider adding unit tests for complex functions');

    return recommendations;
  }

  /**
   * Calculate code nesting depth
   */
  private calculateNestingDepth(code: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    const lines = code.split('\n');
    for (const line of lines) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;

      currentDepth += openBraces - closeBraces;
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    return maxDepth;
  }

  /**
   * Get optimization potential level
   */
  private getOptimizationPotential(score: number): 'low' | 'medium' | 'high' {
    if (score > 70) return 'high';
    if (score > 40) return 'medium';
    return 'low';
  }

  /**
   * Estimate token usage for AI processing
   */
  private estimateTokenUsage(code: string, language: string): number {
    // Rough estimation: ~4 characters per token for code
    const baseTokens = Math.ceil(code.length / 4);

    // Language-specific adjustments
    const languageMultipliers: Record<string, number> = {
      typescript: 1.2, // More verbose with types
      javascript: 1.1,
      python: 1.0,
      java: 1.3, // Verbose syntax
      csharp: 1.25,
    };

    const multiplier = languageMultipliers[language] || 1.0;
    return Math.ceil(baseTokens * multiplier);
  }

  async setupWorkspace(workspace: Workspace) {
    try {
      // Check if workspace exists, create if not
      let existingWorkspace = await this.workspaceModel.findOne({
        name: workspace.name,
        ownerId: workspace.ownerId,
      });

      if (!existingWorkspace) {
        // Create new workspace
        existingWorkspace = new this.workspaceModel({
          name: workspace.name || 'Cursor Workspace',
          slug: this.generateWorkspaceSlug(
            workspace.name || 'cursor-workspace',
          ),
          ownerId: workspace.ownerId,
          settings: {
            allowMemberInvites: false,
            defaultProjectAccess: 'assigned',
            requireEmailVerification: false,
          },
          billing: {
            seatsIncluded: 1,
            additionalSeats: 0,
            pricePerSeat: 0, // Free for cursor integration
            billingCycle: 'monthly',
          },
          isActive: true,
        });

        await existingWorkspace.save();
        this.logger.log('Created new workspace for cursor integration', {
          workspaceId: existingWorkspace._id.toString(),
          name: existingWorkspace.name,
        });
      }

      // Create or get default project for this workspace
      let project = await this.projectModel.findOne({
        workspaceId: existingWorkspace._id,
        name: 'Default Project',
      });

      if (!project) {
        project = new this.projectModel({
          name: 'Default Project',
          description: 'Default project for Cursor IDE integration',
          ownerId: existingWorkspace.ownerId,
          workspaceId: existingWorkspace._id,
          budget: {
            amount: 100, // $100 monthly budget
            period: 'monthly',
            startDate: new Date(),
            currency: 'USD',
            alerts: [],
          },
          spending: {
            totalSpent: 0,
            monthlySpent: 0,
            lastReset: new Date(),
            history: [],
          },
          settings: {
            allowedModels: ['gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet'],
            maxTokensPerRequest: 4000,
            enablePromptLibrary: true,
            enableCostAllocation: true,
          },
          tags: ['cursor', 'ide-integration'],
          isActive: true,
        });

        await project.save();
        this.logger.log('Created default project for cursor workspace', {
          projectId: project._id.toString(),
          workspaceId: existingWorkspace._id.toString(),
        });
      }

      return {
        project_id: project._id.toString(),
        project_name: project.name,
        workspace_id: existingWorkspace._id.toString(),
        workspace_name: existingWorkspace.name,
        message: `Workspace "${existingWorkspace.name}" connected successfully with project "${project.name}"!`,
      };
    } catch (error) {
      this.logger.error('Failed to setup workspace', {
        error: error instanceof Error ? error.message : String(error),
        workspaceName: workspace.name,
      });
      throw error;
    }
  }

  private generateWorkspaceSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  async createProject(name: string, workspaceId?: string, ownerId?: string) {
    try {
      // If no workspace provided, try to find user's default workspace
      let targetWorkspaceId = workspaceId;
      if (!targetWorkspaceId && ownerId) {
        const defaultWorkspace = await this.workspaceModel
          .findOne({
            ownerId: ownerId,
            isActive: true,
          })
          .sort({ createdAt: -1 });

        if (defaultWorkspace) {
          targetWorkspaceId = defaultWorkspace._id.toString();
        }
      }

      if (!targetWorkspaceId) {
        throw new Error('No workspace found for project creation');
      }

      // Check if project with this name already exists in the workspace
      const existingProject = await this.projectModel.findOne({
        name: name,
        workspaceId: targetWorkspaceId,
        isActive: true,
      });

      if (existingProject) {
        return {
          project_id: existingProject._id.toString(),
          project_name: existingProject.name,
          message: `Project "${name}" already exists!`,
        };
      }

      // Create new project
      const project = new this.projectModel({
        name: name,
        description: `Project created via Cursor IDE integration`,
        ownerId: ownerId,
        workspaceId: targetWorkspaceId,
        budget: {
          amount: 50, // $50 monthly budget for new projects
          period: 'monthly',
          startDate: new Date(),
          currency: 'USD',
          alerts: [],
        },
        spending: {
          totalSpent: 0,
          monthlySpent: 0,
          lastReset: new Date(),
          history: [],
        },
        settings: {
          allowedModels: ['gpt-4o-mini', 'gpt-3.5-turbo', 'claude-3-haiku'],
          maxTokensPerRequest: 2000,
          enablePromptLibrary: true,
          enableCostAllocation: true,
        },
        tags: ['cursor', 'ide-integration'],
        isActive: true,
      });

      await project.save();

      this.logger.log('Created new project via cursor integration', {
        projectId: project._id.toString(),
        name: project.name,
        workspaceId: targetWorkspaceId,
      });

      return {
        project_id: project._id.toString(),
        project_name: project.name,
        workspace_id: targetWorkspaceId,
        message: `Project "${name}" created successfully!`,
      };
    } catch (error) {
      this.logger.error('Failed to create project', {
        error: error instanceof Error ? error.message : String(error),
        projectName: name,
      });
      throw error;
    }
  }

  async getProjects(userId?: string, workspaceId?: string) {
    try {
      const query: any = { isActive: true };

      if (userId) {
        query.ownerId = userId;
      }

      if (workspaceId) {
        query.workspaceId = workspaceId;
      }

      const projects = await this.projectModel
        .find(query)
        .populate('workspaceId', 'name slug')
        .sort({ updatedAt: -1 })
        .limit(50) // Limit results to prevent excessive data
        .lean();

      const formattedProjects = projects.map((project) => ({
        id: project._id.toString(),
        name: project.name,
        description: project.description,
        workspace: project.workspaceId
          ? {
              id: (project.workspaceId as any)._id?.toString(),
              name: (project.workspaceId as any).name,
              slug: (project.workspaceId as any).slug,
            }
          : undefined,
        budget: {
          amount: project.budget?.amount,
          currency: project.budget?.currency,
          period: project.budget?.period,
        },
        spending: {
          totalSpent:
            (
              project.spending as {
                current?: number;
                totalSpent?: number;
                monthlySpent?: number;
              }
            )?.totalSpent ??
            project.spending?.current ??
            0,
          monthlySpent:
            (project.spending as { monthlySpent?: number })?.monthlySpent ?? 0,
        },
        settings: {
          allowedModels: project.settings?.allowedModels,
          maxTokensPerRequest: project.settings?.maxTokensPerRequest,
        },
        tags: project.tags || [],
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      }));

      this.logger.log('Retrieved projects for cursor integration', {
        count: formattedProjects.length,
        userId,
        workspaceId,
      });

      return formattedProjects;
    } catch (error) {
      this.logger.error('Failed to retrieve projects', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        workspaceId,
      });
      // Return empty array on error to avoid breaking the integration
      return [];
    }
  }

  async getAnalytics() {
    return {
      summary: {
        total_spending_this_month: '0.00',
        budget_used: '0%',
        active_projects: 1,
      },
      cursor_specific: {
        total_requests: 1,
        average_tokens_per_request: 20,
        recent_activity: [
          {
            model: 'gpt-4o',
            tokens: 20,
            cost: '0.001000',
            timestamp: new Date().toISOString(),
          },
        ],
      },
    };
  }

  async generateSmartSuggestions(userId: string, latestUsage: any) {
    try {
      // Get comprehensive usage history for analysis
      const recentUsage = await this.usageService.getRecentUsageForUser(
        userId,
        30,
      ); // Last 30 requests

      // Analyze usage patterns
      const patternAnalysis = this.analyzeUsagePatterns(
        recentUsage,
        latestUsage,
      );

      // Generate personalized tip based on patterns
      const tip = this.generatePersonalizedTip(patternAnalysis, latestUsage);

      // Generate contextual suggestions
      const suggestions = this.generateContextualSuggestions(
        patternAnalysis,
        latestUsage,
      );

      // Add time-based suggestions
      const timeBasedSuggestions =
        this.generateTimeBasedSuggestions(recentUsage);

      // Add model diversity suggestions
      const modelSuggestions =
        this.generateModelDiversitySuggestions(patternAnalysis);

      // Combine and prioritize suggestions
      const allSuggestions = [
        ...suggestions,
        ...timeBasedSuggestions,
        ...modelSuggestions,
      ].filter((suggestion, index, arr) => arr.indexOf(suggestion) === index); // Remove duplicates

      // Limit to most relevant suggestions
      const prioritizedSuggestions = this.prioritizeSuggestions(
        allSuggestions,
        patternAnalysis,
      );

      this.logger.log('✅ Generated smart suggestions', {
        userId,
        tipCategory: tip.category,
        suggestionCount: prioritizedSuggestions.length,
        patternAnalysis: patternAnalysis.summary,
      });

      return {
        tip: tip.message,
        list: prioritizedSuggestions,
        metadata: {
          patternAnalysis: patternAnalysis.summary,
          tipCategory: tip.category,
          confidence: tip.confidence,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Smart suggestions generation failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return fallback suggestions
      return {
        tip: '💡 Use "Cost Katana: Optimize Prompt" to reduce costs for similar requests.',
        list: [
          'Use the optimized prompt for similar requests',
          'Consider using a cheaper model for simple tasks',
          'Batch similar requests to reduce API overhead',
        ],
        metadata: {
          error: 'Generation failed',
          fallback: true,
        },
      };
    }
  }

  /**
   * Analyze usage patterns for insights
   */
  private analyzeUsagePatterns(recentUsage: any[], latestUsage: any) {
    if (recentUsage.length === 0) {
      return {
        summary: 'insufficient_data',
        avgCost: 0,
        costVariance: 0,
        modelDiversity: 0,
        peakHours: [],
        costTrend: 'unknown',
        highCostRequests: 0,
      };
    }

    const costs = recentUsage.map((u) => u.cost);
    const avgCost = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    const costVariance = this.calculateVariance(costs, avgCost);

    const models = [...new Set(recentUsage.map((u) => u.model))];
    const modelDiversity = models.length;

    const highCostRequests = recentUsage.filter(
      (u) => u.cost > avgCost * 1.5,
    ).length;

    // Analyze time patterns
    const peakHours = this.analyzePeakHours(recentUsage);

    // Cost trend analysis
    const costTrend = this.analyzeCostTrend(recentUsage);

    return {
      summary: this.generatePatternSummary(
        avgCost,
        costVariance,
        modelDiversity,
        highCostRequests,
      ),
      avgCost,
      costVariance,
      modelDiversity,
      peakHours,
      costTrend,
      highCostRequests,
      totalRequests: recentUsage.length,
      latestCost: latestUsage.cost,
    };
  }

  /**
   * Generate personalized tip based on usage patterns
   */
  private generatePersonalizedTip(patternAnalysis: any, latestUsage: any) {
    const { avgCost, modelDiversity, highCostRequests, costTrend } =
      patternAnalysis;

    // High cost warning
    if (latestUsage.cost > avgCost * 1.5) {
      return {
        message: `⚠️ This request cost ${(latestUsage.cost / avgCost).toFixed(1)}x your average. Consider prompt optimization.`,
        category: 'cost_alert',
        confidence: 0.9,
      };
    }

    // Consistent high costs
    if (highCostRequests > patternAnalysis.totalRequests * 0.3) {
      return {
        message:
          '💰 Your costs are consistently high. Try using cheaper models for routine tasks.',
        category: 'cost_optimization',
        confidence: 0.8,
      };
    }

    // Low model diversity
    if (modelDiversity === 1) {
      const model = [
        ...new Set(patternAnalysis.recentUsage?.map((u: any) => u.model)),
      ][0];
      if (model && typeof model === 'string' && model.includes('gpt-4')) {
        return {
          message:
            "🎯 You're using GPT-4 exclusively. Consider GPT-3.5-turbo for simpler tasks.",
          category: 'model_diversity',
          confidence: 0.7,
        };
      }
    }

    // Increasing cost trend
    if (costTrend === 'increasing') {
      return {
        message:
          '📈 Your costs are trending upward. Review your usage patterns.',
        category: 'trend_alert',
        confidence: 0.6,
      };
    }

    // Default helpful tip
    return {
      message:
        '💡 Use "Cost Katana: Optimize Prompt" to reduce costs for similar requests.',
      category: 'general_advice',
      confidence: 0.5,
    };
  }

  /**
   * Generate contextual suggestions based on patterns
   */
  private generateContextualSuggestions(
    patternAnalysis: any,
    latestUsage: any,
  ): string[] {
    const suggestions = [];

    if (patternAnalysis.costVariance > 0.5) {
      suggestions.push(
        'Your request costs vary significantly - consider standardizing your prompts',
      );
    }

    if (patternAnalysis.modelDiversity < 2) {
      suggestions.push(
        'Try different models for different types of tasks to optimize costs',
      );
    }

    if (
      latestUsage.model?.includes('gpt-4') &&
      latestUsage.totalTokens < 1000
    ) {
      suggestions.push(
        'For short requests, GPT-3.5-turbo might be more cost-effective',
      );
    }

    if (patternAnalysis.peakHours?.length > 0) {
      suggestions.push(
        'Consider batching requests during peak hours to reduce per-request overhead',
      );
    }

    return suggestions;
  }

  /**
   * Generate time-based suggestions
   */
  private generateTimeBasedSuggestions(recentUsage: any[]): string[] {
    const suggestions = [];
    const now = new Date();
    const hour = now.getHours();

    // Time-of-day suggestions
    if (hour >= 9 && hour <= 17) {
      // Business hours
      suggestions.push(
        'During business hours, consider using cached responses for common queries',
      );
    } else {
      suggestions.push(
        'Off-peak hours are great for running complex, costlier operations',
      );
    }

    // Recent activity analysis
    const lastHour = recentUsage.filter(
      (u) => new Date(u.timestamp) > new Date(now.getTime() - 60 * 60 * 1000),
    );

    if (lastHour.length > 5) {
      suggestions.push(
        'High activity detected - consider implementing request throttling',
      );
    }

    return suggestions;
  }

  /**
   * Generate model diversity suggestions
   */
  private generateModelDiversitySuggestions(patternAnalysis: any): string[] {
    const suggestions = [];

    if (patternAnalysis.modelDiversity === 1) {
      suggestions.push(
        'Experiment with different models to find the best cost-performance balance',
      );
      suggestions.push(
        'Use GPT-3.5-turbo for code reviews and GPT-4 for complex reasoning',
      );
    } else if (patternAnalysis.modelDiversity >= 3) {
      suggestions.push(
        'You have good model diversity - continue optimizing model selection per task',
      );
    }

    return suggestions;
  }

  /**
   * Prioritize suggestions based on relevance and impact
   */
  private prioritizeSuggestions(
    suggestions: string[],
    patternAnalysis: any,
  ): string[] {
    // Score suggestions by potential impact
    const scored = suggestions.map((suggestion) => ({
      text: suggestion,
      score: this.scoreSuggestion(suggestion, patternAnalysis),
    }));

    // Sort by score and return top suggestions
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.text);
  }

  /**
   * Score a suggestion based on potential impact
   */
  private scoreSuggestion(suggestion: string, patternAnalysis: any): number {
    let score = 1; // Base score

    // High-impact keywords
    if (suggestion.includes('cost') || suggestion.includes('optimize')) {
      score += 3;
    }

    if (suggestion.includes('model') || suggestion.includes('GPT')) {
      score += 2;
    }

    if (suggestion.includes('batch') || suggestion.includes('throttl')) {
      score += 2;
    }

    // Context-based scoring
    if (
      patternAnalysis.costVariance > 0.7 &&
      suggestion.includes('standardiz')
    ) {
      score += 2;
    }

    if (
      patternAnalysis.modelDiversity < 2 &&
      suggestion.includes('different models')
    ) {
      score += 2;
    }

    return score;
  }

  /**
   * Calculate variance of an array
   */
  private calculateVariance(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance =
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
      values.length;
    return Math.sqrt(variance) / mean; // Coefficient of variation
  }

  /**
   * Analyze peak usage hours
   */
  private analyzePeakHours(usage: any[]): number[] {
    const hourCounts: Record<number, number> = {};

    usage.forEach((u) => {
      const hour = new Date(u.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    const maxCount = Math.max(...Object.values(hourCounts));
    return Object.entries(hourCounts)
      .filter(([, count]) => count === maxCount)
      .map(([hour]) => parseInt(hour));
  }

  /**
   * Analyze cost trend
   */
  private analyzeCostTrend(
    usage: any[],
  ): 'increasing' | 'decreasing' | 'stable' {
    if (usage.length < 5) return 'stable';

    const sorted = usage.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const recent = sorted.slice(-5);
    const earlier = sorted.slice(-10, -5);

    const recentAvg =
      recent.reduce((sum, u) => sum + u.cost, 0) / recent.length;
    const earlierAvg =
      earlier.reduce((sum, u) => sum + u.cost, 0) / earlier.length;

    const changePercent = (recentAvg - earlierAvg) / earlierAvg;

    if (changePercent > 0.1) return 'increasing';
    if (changePercent < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Generate a pattern summary
   */
  private generatePatternSummary(
    avgCost: number,
    costVariance: number,
    modelDiversity: number,
    highCostRequests: number,
  ): string {
    const patterns = [];

    if (costVariance > 0.5) patterns.push('high_cost_variance');
    if (modelDiversity === 1) patterns.push('single_model');
    if (highCostRequests > 3) patterns.push('frequent_high_cost');
    if (avgCost > 0.01) patterns.push('high_avg_cost');

    return patterns.length > 0 ? patterns.join(',') : 'normal_usage';
  }
}
