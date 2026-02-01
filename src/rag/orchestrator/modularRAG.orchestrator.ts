/**
 * Modular RAG Orchestrator
 * Coordinates modules and executes patterns based on query analysis
 */

import {
  RAGContext,
  RAGResult,
  RAGPatternType,
  RAGConfig,
  OrchestratorInput,
  OrchestratorConfig,
  QueryAnalysis,
} from '../types/rag.types';
import { NaiveRAGPattern } from '../patterns/naive.pattern';
import { AdaptiveRAGPattern } from '../patterns/adaptive.pattern';
import { IterativeRAGPattern } from '../patterns/iterative.pattern';
import { RecursiveRAGPattern } from '../patterns/recursive.pattern';
import {
  DEFAULT_RAG_CONFIG,
  DEFAULT_ORCHESTRATOR_CONFIG,
  getPatternConfig,
} from '../config/default.config';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';
import { redisService } from '../../services/redis.service';
import { ragEvaluator } from '../evaluation';

export class ModularRAGOrchestrator {
  private config: OrchestratorConfig;
  private patterns: Map<RAGPatternType, any> = new Map();
  private llm?: ChatBedrockConverse;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };

    // Initialize LLM for pattern selection if auto-select is enabled
    if (this.config.autoSelectPattern) {
      this.llm = new ChatBedrockConverse({
        model: this.config.patternSelectionModel || 'amazon.nova-micro-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.3,
        maxTokens: 200,
      });
    }
  }

  /**
   * Main entry point for RAG operations
   */
  async execute(input: OrchestratorInput): Promise<RAGResult> {
    const startTime = Date.now();

    try {
      loggingService.info('RAG Orchestrator: Execution started', {
        component: 'ModularRAGOrchestrator',
        query: input.query.substring(0, 100),
        preferredPattern: input.preferredPattern,
        autoSelect: this.config.autoSelectPattern,
      });

      // Step 1: Determine which pattern to use
      const selectedPattern = await this.selectPattern(input);

      loggingService.info('RAG Orchestrator: Pattern selected', {
        component: 'ModularRAGOrchestrator',
        selectedPattern,
      });

      // Step 2: Get pattern instance
      const pattern = await this.getPattern(selectedPattern, input.config);

      // Step 3: Execute pattern
      let result = await pattern.execute(input.query, input.context);

      // Step 4: Optional evaluation (RAGAS-aligned metrics)
      if (input.config?.evaluation?.enabled && result.success && result.answer) {
        result = await this.runEvaluationIfEnabled(result, input);
      }

      loggingService.info('RAG Orchestrator: Execution completed', {
        component: 'ModularRAGOrchestrator',
        pattern: selectedPattern,
        success: result.success,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      loggingService.error('RAG Orchestrator: Execution failed', {
        component: 'ModularRAGOrchestrator',
        error: error instanceof Error ? error.message : String(error),
      });

      // Try fallback pattern if configured
      if (this.config.fallbackPattern) {
        try {
          loggingService.info('RAG Orchestrator: Attempting fallback pattern', {
            component: 'ModularRAGOrchestrator',
            fallbackPattern: this.config.fallbackPattern,
          });

          const fallbackPattern = await this.getPattern(
            this.config.fallbackPattern,
            input.config
          );
          let fallbackResult = await fallbackPattern.execute(input.query, input.context);
          if (input.config?.evaluation?.enabled && fallbackResult.success && fallbackResult.answer) {
            fallbackResult = await this.runEvaluationIfEnabled(fallbackResult, input);
          }
          return fallbackResult;
        } catch (fallbackError) {
          loggingService.error('RAG Orchestrator: Fallback also failed', {
            component: 'ModularRAGOrchestrator',
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }

      // Return error result
      return {
        success: false,
        answer: 'I apologize, but I encountered an error while processing your request.',
        documents: [],
        sources: [],
        metadata: {
          pattern: this.config.defaultPattern,
          modulesUsed: [],
          retrievalCount: 0,
          totalDocuments: 0,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration: 0,
            generationDuration: 0,
            moduleDurations: {},
          },
          cacheHit: false,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run RAG evaluation when config.evaluation.enabled and attach metrics to result.metadata.evaluation.
   * On evaluator failure, leaves metadata.evaluation undefined and logs a warning; does not fail the request.
   */
  private async runEvaluationIfEnabled(
    result: RAGResult,
    input: OrchestratorInput
  ): Promise<RAGResult> {
    if (!input.config?.evaluation?.enabled || !result.success || !result.answer) {
      return result;
    }
    try {
      const evalInput = {
        query: input.query,
        answer: result.answer,
        documents: result.documents,
        groundTruth: (input.config.evaluation as { groundTruth?: string }).groundTruth,
      };
      const metrics = await ragEvaluator.evaluate(evalInput);
      const evaluation = {
        contextRelevance: metrics.contextRelevance,
        answerFaithfulness: metrics.answerFaithfulness,
        answerRelevance: metrics.answerRelevance,
        retrievalPrecision: metrics.retrievalPrecision,
        retrievalRecall: metrics.retrievalRecall,
        overall: metrics.overall,
      };
      if (input.config.evaluation.logResults) {
        loggingService.info('RAG evaluation metrics', {
          component: 'ModularRAGOrchestrator',
          evaluation,
        });
      }
      return {
        ...result,
        metadata: {
          ...result.metadata,
          evaluation,
        },
      };
    } catch (error) {
      loggingService.warn('RAG evaluation failed, continuing without metrics', {
        component: 'ModularRAGOrchestrator',
        error: error instanceof Error ? error.message : String(error),
      });
      return result;
    }
  }

  /**
   * Select the appropriate pattern for the query
   */
  private async selectPattern(
    input: OrchestratorInput
  ): Promise<RAGPatternType> {
    // If pattern explicitly specified, use it
    if (input.preferredPattern) {
      return input.preferredPattern;
    }

    // If auto-select is disabled, use default
    if (!this.config.autoSelectPattern) {
      return this.config.defaultPattern;
    }

    // Check cache first
    const cacheKey = `pattern_selection:${input.query.substring(0, 100)}`;
    try {
      const cached = await redisService.get(cacheKey);
      if (cached && typeof cached === 'string') {
        loggingService.info('RAG Orchestrator: Using cached pattern selection', {
          component: 'ModularRAGOrchestrator',
          pattern: cached,
        });
        return cached as RAGPatternType;
      }
    } catch (error) {
      // Continue with analysis if cache fails
    }

    // Analyze query to determine best pattern
    const analysis = await this.analyzeQuery(input.query);

    loggingService.info('RAG Orchestrator: Query analysis completed', {
      component: 'ModularRAGOrchestrator',
      complexity: analysis.complexity,
      type: analysis.type,
      suggestedPattern: analysis.suggestedPattern,
      confidence: analysis.confidence,
    });

    // Cache the selection
    try {
      await redisService.set(cacheKey, analysis.suggestedPattern, 3600); // 1 hour
    } catch (error) {
      // Non-critical error
    }

    return analysis.suggestedPattern;
  }

  /**
   * Analyze query to determine characteristics
   */
  private async analyzeQuery(
    query: string,
  ): Promise<QueryAnalysis> {
    if (!this.llm) {
      // Fallback to heuristic analysis
      return this.heuristicAnalysis(query);
    }

    try {
      const prompt = `Analyze this query and determine the best RAG pattern to use. Consider:
- Complexity: simple (factual lookup), moderate (some reasoning), complex (multi-part/comparative)
- Type: factual, analytical, comparative, exploratory
- Pattern: naive (simple), adaptive (smart), iterative (deep), recursive (multi-part)

Query: "${query}"

Respond in this format:
Complexity: [simple/moderate/complex]
Type: [factual/analytical/comparative/exploratory]
Pattern: [naive/adaptive/iterative/recursive]
Confidence: [0.0-1.0]
Reasoning: [brief explanation]`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';

      // Parse response
      const complexityMatch = content.match(/Complexity:\s*(\w+)/i);
      const typeMatch = content.match(/Type:\s*(\w+)/i);
      const patternMatch = content.match(/Pattern:\s*(\w+)/i);
      const confidenceMatch = content.match(/Confidence:\s*([\d.]+)/i);
      const reasoningMatch = content.match(/Reasoning:\s*(.+)/i);

      const complexity = (complexityMatch?.[1]?.toLowerCase() || 'moderate') as 'simple' | 'moderate' | 'complex';
      const type = (typeMatch?.[1]?.toLowerCase() || 'factual') as 'factual' | 'analytical' | 'comparative' | 'exploratory';
      const suggestedPattern = (patternMatch?.[1]?.toLowerCase() || 'adaptive') as RAGPatternType;
      const confidence = parseFloat(confidenceMatch?.[1] || '0.7');
      const reasoning = reasoningMatch?.[1]?.trim() || 'LLM-based analysis';

      return {
        complexity,
        type,
        requiresRetrieval: true,
        suggestedPattern,
        confidence,
        reasoning,
      };
    } catch (error) {
      loggingService.warn('LLM query analysis failed, using heuristics', {
        component: 'ModularRAGOrchestrator',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.heuristicAnalysis(query);
    }
  }

  /**
   * Heuristic-based query analysis
   */
  private heuristicAnalysis(query: string): QueryAnalysis {
    const lowerQuery = query.toLowerCase();

    // Detect complexity
    let complexity: 'simple' | 'moderate' | 'complex' = 'moderate';
    
    // Simple queries
    if (
      lowerQuery.match(/^(what is|define|who is|when was|where is)/) &&
      query.split(' ').length < 10
    ) {
      complexity = 'simple';
    }

    // Complex queries
    const matches = lowerQuery.match(/\b(and|versus|vs|between)\b/g);
    if (
      lowerQuery.includes('compare') ||
      lowerQuery.includes('analyze') ||
      lowerQuery.includes('explain') ||
      query.split(' ').length > 20 ||
      (matches && matches.length > 1)
    ) {
      complexity = 'complex';
    }

    // Detect type
    let type: 'factual' | 'analytical' | 'comparative' | 'exploratory' = 'factual';
    
    if (lowerQuery.includes('compare') || lowerQuery.includes('versus') || lowerQuery.includes('vs')) {
      type = 'comparative';
    } else if (lowerQuery.includes('analyze') || lowerQuery.includes('evaluate')) {
      type = 'analytical';
    } else if (lowerQuery.includes('explore') || lowerQuery.includes('investigate')) {
      type = 'exploratory';
    }

    // Determine pattern
    let suggestedPattern: RAGPatternType;
    
    if (complexity === 'simple') {
      suggestedPattern = 'naive';
    } else if (type === 'comparative' || lowerQuery.includes('compare')) {
      suggestedPattern = 'recursive';
    } else if (type === 'exploratory' || complexity === 'complex') {
      suggestedPattern = 'iterative';
    } else {
      suggestedPattern = 'adaptive';
    }

    return {
      complexity,
      type,
      requiresRetrieval: true,
      suggestedPattern,
      confidence: 0.7,
      reasoning: 'Heuristic-based analysis',
    };
  }

  /**
   * Get or create pattern instance
   */
  private async getPattern(
    patternType: RAGPatternType,
    customConfig?: Partial<RAGConfig>
  ): Promise<any> {
    // Get base config for pattern
    let config = getPatternConfig(patternType);

    // Merge with custom config if provided
    if (customConfig) {
      config = {
        ...config,
        ...customConfig,
        modules: {
          ...config.modules,
          ...customConfig.modules,
        },
      };
    }

    // Create new pattern instance (don't cache to avoid config conflicts)
    switch (patternType) {
      case 'naive':
        return new NaiveRAGPattern(config);
      case 'adaptive':
        return new AdaptiveRAGPattern(config);
      case 'iterative':
        return new IterativeRAGPattern(config);
      case 'recursive':
        return new RecursiveRAGPattern(config);
      default:
        loggingService.warn('Unknown pattern type, using adaptive', {
          component: 'ModularRAGOrchestrator',
          requestedPattern: patternType,
        });
        return new AdaptiveRAGPattern(config);
    }
  }

  /**
   * Update orchestrator configuration
   */
  updateConfig(newConfig: Partial<OrchestratorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    loggingService.info('RAG Orchestrator configuration updated', {
      component: 'ModularRAGOrchestrator',
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }
}

// Singleton instance
export const modularRAGOrchestrator = new ModularRAGOrchestrator();

