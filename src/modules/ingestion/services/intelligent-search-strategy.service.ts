/**
 * Intelligent Search Strategy Service for NestJS
 * Uses AI (AWS Bedrock) to autonomously decide between MMR and Cosine Similarity
 *
 * Strategy Decision Logic:
 * - MMR: For general, exploratory, broad queries (high diversity needed)
 * - Cosine: For specific, focused, technical queries (high precision needed)
 * - Hybrid: For complex queries requiring both diversity and precision
 */

import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import { StructuredQueryDetectorService } from './structured-query-detector.service';
import { StructuredQueryHandlerService } from './structured-query-handler.service';
import type { RAGDocument } from '../../rag/types/rag.types';

/**
 * Search Strategy Types
 */
export enum SearchStrategy {
  MMR = 'mmr', // Maximal Marginal Relevance - for general, broad queries
  COSINE = 'cosine', // Cosine Similarity - for focused, complex, specific queries
  HYBRID = 'hybrid', // Combination of both
}

/**
 * Query Complexity Analysis Result
 */
export interface QueryAnalysis {
  complexity: 'simple' | 'moderate' | 'complex';
  specificity: 'general' | 'focused' | 'specific';
  recommendedStrategy: SearchStrategy;
  confidence: number; // 0-1 score
  reasoning: string[];
  queryFeatures: {
    length: number;
    technicalTerms: number;
    entities: number;
    questionType: string;
    hasComparison: boolean;
    hasConstraints: boolean;
    hasSpatialTemporal: boolean;
  };
}

/**
 * Search Configuration based on strategy
 */
export interface SearchConfig {
  strategy: SearchStrategy;
  k: number;
  fetchK?: number;
  lambda?: number;
  threshold?: number;
}

/**
 * Result of routeQuery — either structured (direct DB) or semantic (needs vector search)
 */
export type RouteQueryResult =
  | { source: 'structured_db'; documents: RAGDocument[]; metadata: { totalDocuments: number; retrievalTimeMs: number } }
  | { source: 'semantic'; analysis: QueryAnalysis };

export interface RouteQueryOptions {
  userId?: string;
  projectId?: string;
  limit?: number;
  /** Min confidence (0-1) to treat as structured. Default 0.6 */
  structuredConfidenceThreshold?: number;
}

@Injectable()
export class IntelligentSearchStrategyService {
  private readonly logger = new Logger(IntelligentSearchStrategyService.name);
  private static readonly FAST_MODEL_ID =
    'anthropic.claude-3-5-sonnet-20241022-v2:0';
  private static readonly DEFAULT_STRUCTURED_CONFIDENCE = 0.6;

  constructor(
    private readonly bedrockService: BedrockService,
    private readonly structuredQueryDetector: StructuredQueryDetectorService,
    private readonly structuredQueryHandler: StructuredQueryHandlerService,
  ) {}

  /**
   * Route query to structured (direct MongoDB) or semantic (vector) path.
   * Structured path: precision-first cost/usage queries — no embedding, sub-10ms.
   * Semantic path: runs existing analyzeQuery() for MMR/Cosine/Hybrid strategy.
   */
  async routeQuery(
    query: string,
    options: RouteQueryOptions = {},
  ): Promise<RouteQueryResult> {
    const threshold =
      options.structuredConfidenceThreshold ??
      IntelligentSearchStrategyService.DEFAULT_STRUCTURED_CONFIDENCE;

    const detection = this.structuredQueryDetector.detect(query);

    if (detection.isStructured && detection.confidence >= threshold) {
      this.logger.log('Routing to structured retrieval', {
        queryType: detection.queryType,
        confidence: detection.confidence.toFixed(2),
      });

      const result = await this.structuredQueryHandler.handle(
        query,
        detection,
        {
          userId: options.userId,
          projectId: options.projectId,
          limit: options.limit,
        },
      );

      return {
        source: 'structured_db',
        documents: result.documents,
        metadata: {
          totalDocuments: result.metadata.totalDocuments,
          retrievalTimeMs: result.metadata.retrievalTimeMs,
        },
      };
    }

    this.logger.debug('Routing to semantic retrieval (AI analysis)');
    const analysis = await this.analyzeQuery(query);
    return { source: 'semantic', analysis };
  }

  /**
   * Analyze query using AI (AWS Bedrock) to determine optimal search strategy
   * The AI model makes autonomous decisions based on semantic understanding
   */
  async analyzeQuery(query: string): Promise<QueryAnalysis> {
    const startTime = Date.now();

    try {
      this.logger.log(
        '🤖 Using AI to analyze query for intelligent search strategy',
        {
          queryLength: query.length,
          model: IntelligentSearchStrategyService.FAST_MODEL_ID,
        },
      );

      // Construct the AI prompt for strategy decision
      const systemPrompt = `You are an expert search strategy analyzer for a RAG (Retrieval Augmented Generation) system. Your job is to analyze user queries and recommend the optimal vector search strategy.

**Available Strategies:**

1. **MMR (Maximal Marginal Relevance)**
   - Best for: General, exploratory, broad queries
   - Purpose: Provides diverse results with different perspectives
   - Example queries: "Tell me about AI costs", "What are the options for...", "Overview of..."

2. **COSINE (Cosine Similarity)**
   - Best for: Specific, focused, technical queries with clear intent
   - Purpose: Provides precise, highly relevant results
   - Example queries: "How to configure API endpoint X", "Find documentation for function Y", "Exact pricing for model Z"

3. **HYBRID (Combination)**
   - Best for: Complex queries needing both precision and diversity
   - Purpose: Balances between relevance and coverage
   - Example queries: "Compare X vs Y", "Analyze the trade-offs of...", "Which is better for..."

**Your Task:**
Analyze the user's query semantically and recommend the best strategy. Consider:
- Query intent and goal
- Level of specificity vs generality
- Need for diverse perspectives vs precise answers
- Complexity of the question
- Domain and context

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "complexity": "simple|moderate|complex",
  "specificity": "general|focused|specific",
  "recommendedStrategy": "mmr|cosine|hybrid",
  "confidence": 0.85,
  "reasoning": ["reason 1", "reason 2", "reason 3"],
  "queryFeatures": {
    "length": 50,
    "technicalTerms": 2,
    "entities": 1,
    "questionType": "exploratory|specific|what|how|why|when|where|who|statement",
    "hasComparison": false,
    "hasConstraints": false,
    "hasSpatialTemporal": false
  }
}`;

      const userPrompt = `Analyze this user query and recommend the optimal search strategy:

Query: "${query}"

Think carefully about:
1. Is this a broad, exploratory question (→ MMR for diversity)?
2. Is this a specific, targeted question (→ COSINE for precision)?
3. Is this complex and needs both perspectives (→ HYBRID)?

Provide your analysis in JSON format.`;

      const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
      // Call Bedrock AI model
      const response = await BedrockService.invokeModel(
        fullPrompt,
        IntelligentSearchStrategyService.FAST_MODEL_ID,
        { useSystemPrompt: false },
      );

      const aiResponseText =
        typeof response === 'string' ? response.trim() : '';
      if (!aiResponseText) {
        throw new Error('Invalid response format from Bedrock');
      }

      this.logger.log('🧠 AI response received', {
        responseLength: aiResponseText.length,
      });

      // Parse AI response (handle potential markdown code blocks)
      let analysis: QueryAnalysis;
      try {
        // Remove markdown code blocks if present
        const jsonMatch = aiResponseText.match(
          /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
        );
        const jsonText = jsonMatch ? jsonMatch[1] : aiResponseText;

        const parsed = JSON.parse(jsonText);

        // Validate and construct analysis
        analysis = {
          complexity: parsed.complexity || 'moderate',
          specificity: parsed.specificity || 'focused',
          recommendedStrategy:
            (parsed.recommendedStrategy as SearchStrategy) ||
            SearchStrategy.COSINE,
          confidence: parsed.confidence || 0.7,
          reasoning: Array.isArray(parsed.reasoning)
            ? parsed.reasoning
            : ['AI analysis completed'],
          queryFeatures: {
            length: query.length,
            technicalTerms: parsed.queryFeatures?.technicalTerms || 0,
            entities: parsed.queryFeatures?.entities || 0,
            questionType: parsed.queryFeatures?.questionType || 'unknown',
            hasComparison: parsed.queryFeatures?.hasComparison || false,
            hasConstraints: parsed.queryFeatures?.hasConstraints || false,
            hasSpatialTemporal:
              parsed.queryFeatures?.hasSpatialTemporal || false,
          },
        };

        // Add AI attribution to reasoning
        analysis.reasoning.unshift(
          '🤖 Analysis performed by AI (Claude 3 Sonnet)',
        );
      } catch (parseError) {
        this.logger.error('Failed to parse AI response, using fallback', {
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          rawResponse: aiResponseText.substring(0, 200),
        });

        // Fallback: Extract strategy from text if JSON parsing fails
        const strategyMatch = aiResponseText.toLowerCase();
        let strategy = SearchStrategy.COSINE; // Safe default

        if (
          strategyMatch.includes('mmr') ||
          strategyMatch.includes('marginal relevance')
        ) {
          strategy = SearchStrategy.MMR;
        } else if (
          strategyMatch.includes('hybrid') ||
          strategyMatch.includes('combination')
        ) {
          strategy = SearchStrategy.HYBRID;
        }

        analysis = {
          complexity: 'moderate',
          specificity: 'focused',
          recommendedStrategy: strategy,
          confidence: 0.6,
          reasoning: [
            '🤖 AI analysis completed (fallback parsing)',
            aiResponseText.substring(0, 150),
          ],
          queryFeatures: {
            length: query.length,
            technicalTerms: 0,
            entities: 0,
            questionType: 'unknown',
            hasComparison: false,
            hasConstraints: false,
            hasSpatialTemporal: false,
          },
        };
      }

      const duration = Date.now() - startTime;

      this.logger.log('✅ AI-powered query analysis completed', {
        duration,
        complexity: analysis.complexity,
        specificity: analysis.specificity,
        strategy: analysis.recommendedStrategy,
        confidence: analysis.confidence.toFixed(3),
        aiModel: IntelligentSearchStrategyService.FAST_MODEL_ID,
      });

      return analysis;
    } catch (error) {
      this.logger.error('❌ AI query analysis failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to cosine similarity (safer default)
      return {
        complexity: 'moderate',
        specificity: 'focused',
        recommendedStrategy: SearchStrategy.COSINE,
        confidence: 0.5,
        reasoning: [
          'AI analysis failed - using safe default (Cosine Similarity)',
          error instanceof Error ? error.message : String(error),
        ],
        queryFeatures: {
          length: query.length,
          technicalTerms: 0,
          entities: 0,
          questionType: 'unknown',
          hasComparison: false,
          hasConstraints: false,
          hasSpatialTemporal: false,
        },
      };
    }
  }

  /**
   * Get search configuration based on strategy
   */
  getSearchConfig(
    strategy: SearchStrategy,
    complexity: 'simple' | 'moderate' | 'complex',
  ): SearchConfig {
    const baseK =
      complexity === 'complex' ? 10 : complexity === 'moderate' ? 6 : 4;

    switch (strategy) {
      case SearchStrategy.MMR:
        return {
          strategy: SearchStrategy.MMR,
          k: baseK,
          fetchK: baseK * 5, // Fetch 5x more candidates for diversity
          lambda: 0.5, // Balance between relevance and diversity
        };

      case SearchStrategy.COSINE:
        return {
          strategy: SearchStrategy.COSINE,
          k: baseK,
          threshold: 0.7, // Minimum similarity threshold
        };

      case SearchStrategy.HYBRID:
        return {
          strategy: SearchStrategy.HYBRID,
          k: baseK,
          fetchK: baseK * 3,
          lambda: 0.7, // Favor relevance over diversity
          threshold: 0.6,
        };

      default:
        return {
          strategy: SearchStrategy.COSINE,
          k: baseK,
          threshold: 0.7,
        };
    }
  }

  /**
   * Explain strategy selection to users (for debugging/transparency)
   */
  explainStrategy(analysis: QueryAnalysis): string {
    return `
🤖 **Intelligent Search Strategy Analysis**

**Query Characteristics:**
- Complexity: ${analysis.complexity.toUpperCase()}
- Specificity: ${analysis.specificity.toUpperCase()}
- Length: ${analysis.queryFeatures.length} characters
- Technical Terms: ${analysis.queryFeatures.technicalTerms}
- Entities: ${analysis.queryFeatures.entities}
- Question Type: ${analysis.queryFeatures.questionType}

**Selected Strategy: ${analysis.recommendedStrategy.toUpperCase()}**
- Confidence: ${(analysis.confidence * 100).toFixed(1)}%

**Reasoning:**
${analysis.reasoning.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**Strategy Explanation:**
${this.getStrategyExplanation(analysis.recommendedStrategy)}
    `.trim();
  }

  /**
   * Get strategy explanation
   */
  private getStrategyExplanation(strategy: SearchStrategy): string {
    switch (strategy) {
      case SearchStrategy.MMR:
        return '📊 MMR (Maximal Marginal Relevance) provides diverse results by balancing relevance with novelty. Best for exploratory queries where you want to see different perspectives.';

      case SearchStrategy.COSINE:
        return "🎯 Cosine Similarity provides precise, highly relevant results. Best for specific queries where you know exactly what you're looking for.";

      case SearchStrategy.HYBRID:
        return '⚡ Hybrid approach combines both precision and diversity. Best for complex queries that need comprehensive coverage.';

      default:
        return 'Standard similarity search.';
    }
  }
}
