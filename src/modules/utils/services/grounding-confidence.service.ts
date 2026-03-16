import { Injectable, Logger } from '@nestjs/common';

interface GroundingContext {
  query: string;
  queryType: 'factual' | 'opinion' | 'creative' | 'analysis';
  retrieval: {
    hitCount: number;
    relevantHits: number;
    sources: string[];
  };
  intent: {
    clarity: number; // 0-1
    specificity: number; // 0-1
  };
  freshness: {
    averageAgeHours: number;
    freshnessScore: number; // 0-1
  };
  conversationId?: string;
  clarificationAttempts?: number;
  searchAttempts?: number;
}

interface GroundingDecision {
  groundingScore: number;
  decision: 'GENERATE' | 'REFUSE' | 'ASK_CLARIFY' | 'SEARCH_MORE';
  reasons: string[];
  metrics: {
    retrievalScore: number;
    intentScore: number;
    freshnessScore: number;
    sourceDiversityScore: number;
    finalScore: number;
  };
  timestamp: number;
  prohibitMemoryWrite: boolean;
}

interface GroundingThresholds {
  refuse: number;
  askClarify: number;
  searchMore: number;
  intentMinimum: number;
  optimizerRetrievalMinimum: number;
  cacheMinimumFreshness: number;
  contextDriftIntentThreshold: number;
}

/**
 * Grounding Confidence Layer (GCL) Service
 *
 * Pre-generation decision gate that evaluates whether the system has sufficient,
 * fresh, and relevant grounding to safely generate a response.
 *
 * Core principle: "Generation is a privilege, not a default."
 */
@Injectable()
export class GroundingConfidenceService {
  private readonly logger = new Logger(GroundingConfidenceService.name);

  // Feature flags
  private shadowMode: boolean;
  private blockingEnabled: boolean;
  private strictRefusal: boolean;
  private loggingEnabled: boolean;
  private emergencyBypass: boolean;

  // Thresholds (tunable via config or updateThresholds)
  private thresholds: GroundingThresholds = {
    refuse: 0.45,
    askClarify: 0.7,
    searchMore: 0.6,
    intentMinimum: 0.7,
    optimizerRetrievalMinimum: 0.7,
    cacheMinimumFreshness: 0.6,
    contextDriftIntentThreshold: 0.75,
  };

  // Weights (tunable)
  private weights = {
    retrieval: 0.35,
    intent: 0.25,
    freshness: 0.2,
    diversity: 0.2,
  };

  // Loop protection limits
  private readonly MAX_CLARIFICATION_ATTEMPTS = 2;
  private readonly MAX_SEARCH_ATTEMPTS = 2;

  constructor() {
    this.shadowMode = process.env.ENABLE_GCL_SHADOW === 'true';
    this.blockingEnabled = process.env.ENABLE_GCL_BLOCKING === 'true';
    this.strictRefusal = process.env.ENABLE_GCL_STRICT_REFUSAL === 'true';
    this.loggingEnabled = process.env.ENABLE_GCL_LOGGING === 'true';
    this.emergencyBypass = process.env.ENABLE_GCL_EMERGENCY_BYPASS === 'true';

    this.logger.log('🔒 GroundingConfidenceService initialized', {
      shadowMode: this.shadowMode,
      blockingEnabled: this.blockingEnabled,
      strictRefusal: this.strictRefusal,
      thresholds: this.thresholds,
    });
  }

  /**
   * Main evaluation method - THE GATE
   * Returns decision on whether system can safely generate
   */
  async evaluate(context: GroundingContext): Promise<GroundingDecision> {
    const startTime = Date.now();

    try {
      // Emergency bypass check
      if (this.emergencyBypass) {
        this.logger.warn(
          '🚨 GCL emergency bypass active - allowing generation',
          {
            query: context.query.substring(0, 100),
          },
        );
        return this.createDecision(
          1.0,
          'GENERATE',
          ['Emergency bypass enabled'],
          context,
        );
      }

      // Loop protection checks
      if (
        context.clarificationAttempts &&
        context.clarificationAttempts >= this.MAX_CLARIFICATION_ATTEMPTS
      ) {
        return this.createDecision(
          0,
          'REFUSE',
          [
            `Maximum clarification attempts (${this.MAX_CLARIFICATION_ATTEMPTS}) reached`,
            'Unable to establish clear intent',
          ],
          context,
          true,
        );
      }

      if (
        context.searchAttempts &&
        context.searchAttempts >= this.MAX_SEARCH_ATTEMPTS
      ) {
        return this.createDecision(
          0,
          'REFUSE',
          [
            `Maximum search attempts (${this.MAX_SEARCH_ATTEMPTS}) reached`,
            'Unable to retrieve fresh data after multiple attempts',
          ],
          context,
          true,
        );
      }

      // HARD GATES (non-negotiable)
      if (
        context.retrieval.hitCount === 0 &&
        !this.isOpinionQuery(context.queryType)
      ) {
        const decision = this.createDecision(
          0,
          'REFUSE',
          [
            'No relevant information found',
            'Cannot generate without grounding on factual queries',
          ],
          context,
          true,
        );
        return decision;
      }

      // Score individual components
      const retrievalScore = this.scoreRetrieval(context);
      const intentScore = this.scoreIntent(context);
      const freshnessScore = this.scoreFreshness(context);
      const diversityScore = this.scoreSourceDiversity(context);

      // Weighted composite score
      const groundingScore =
        this.weights.retrieval * retrievalScore +
        this.weights.intent * intentScore +
        this.weights.freshness * freshnessScore +
        this.weights.diversity * diversityScore;

      const metrics = {
        retrievalScore,
        intentScore,
        freshnessScore,
        sourceDiversityScore: diversityScore,
        finalScore: groundingScore,
      };

      // Apply domain risk adjustment
      const adjustedThresholds = this.applyDomainRisk(context, {
        ...this.thresholds,
      });

      // Decision logic
      const decision = this.determineDecision(
        context,
        groundingScore,
        metrics,
        adjustedThresholds,
      );

      const result: GroundingDecision = {
        groundingScore,
        decision: decision.type,
        reasons: decision.reasons,
        metrics,
        timestamp: Date.now(),
        prohibitMemoryWrite: decision.type !== 'GENERATE',
      };

      // Logging & metrics
      this.logDecision(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      this.logger.error('❌ GCL evaluation failed - FAILING SAFE', {
        error: error instanceof Error ? error.message : String(error),
        query: context.query.substring(0, 100),
      });

      // FAIL SAFE: Ask for clarification on internal error
      return this.createDecision(
        0,
        'ASK_CLARIFY',
        ['Unable to verify sufficient grounding', 'Internal evaluation error'],
        context,
        true,
      );
    }
  }

  /**
   * Score retrieval quality (0-1)
   */
  private scoreRetrieval(context: GroundingContext): number {
    const { retrieval } = context;

    if (retrieval.hitCount === 0) return 0;

    // Base score on hit ratio
    const hitRatio = retrieval.relevantHits / retrieval.hitCount;

    // Bonus for multiple sources
    const sourceDiversity = Math.min(1, retrieval.sources.length / 3);

    // Penalize for too many irrelevant hits
    const relevancePenalty = hitRatio < 0.3 ? 0.5 : 1;

    return (
      Math.min(1, hitRatio * 0.7 + sourceDiversity * 0.3) * relevancePenalty
    );
  }

  /**
   * Score intent clarity (0-1)
   */
  private scoreIntent(context: GroundingContext): number {
    const { intent } = context;

    // Combine clarity and specificity
    const combinedScore = (intent.clarity + intent.specificity) / 2;

    // Boost for clear factual queries
    if (context.queryType === 'factual' && combinedScore > 0.8) {
      return Math.min(1, combinedScore * 1.1);
    }

    return combinedScore;
  }

  /**
   * Score data freshness (0-1)
   */
  private scoreFreshness(context: GroundingContext): number {
    const { freshness } = context;

    // Direct freshness score if available
    if (freshness.freshnessScore !== undefined) {
      return freshness.freshnessScore;
    }

    // Calculate from average age
    const ageInHours = freshness.averageAgeHours;

    // Exponential decay: fresher = higher score
    // 0 hours = 1.0, 24 hours = 0.5, 168 hours (1 week) = 0.1
    const freshnessScore = Math.exp(-ageInHours / 48); // Half-life of 48 hours

    return Math.max(0, Math.min(1, freshnessScore));
  }

  /**
   * Score source diversity (0-1)
   */
  private scoreSourceDiversity(context: GroundingContext): number {
    const uniqueSources = new Set(context.retrieval.sources).size;
    const totalSources = context.retrieval.sources.length;

    if (totalSources === 0) return 0;

    // Ratio of unique sources
    const diversityRatio = uniqueSources / totalSources;

    // Bonus for multiple source types
    const sourceTypeBonus = uniqueSources > 1 ? 0.2 : 0;

    return Math.min(1, diversityRatio + sourceTypeBonus);
  }

  /**
   * Apply domain risk adjustment to thresholds
   */
  private applyDomainRisk(
    context: GroundingContext,
    thresholds: GroundingThresholds,
  ): GroundingThresholds {
    // Higher thresholds for sensitive topics
    if (this.isHighRiskQuery(context.query)) {
      return {
        ...thresholds,
        refuse: Math.max(thresholds.refuse, 0.6),
        askClarify: Math.max(thresholds.askClarify, 0.8),
      };
    }

    return thresholds;
  }

  /**
   * Determine final decision based on score and thresholds
   */
  /**
   * Determine final decision based on score, metrics, thresholds, and context.
   *
   * The 'context' parameter is now considered when evaluating which decision to make.
   */
  private determineDecision(
    context: GroundingContext,
    score: number,
    metrics: any,
    thresholds: GroundingThresholds,
  ): {
    type: 'GENERATE' | 'REFUSE' | 'ASK_CLARIFY' | 'SEARCH_MORE';
    reasons: string[];
  } {
    // Edge case: if context or retrieval looks suspicious (e.g. missing sources)
    if (
      !context.retrieval ||
      !context.retrieval.sources ||
      context.retrieval.sources.length === 0
    ) {
      return {
        type: 'REFUSE',
        reasons: [
          'No retrieval sources available in context',
          'Unable to ground response without supporting sources',
        ],
      };
    }

    // Consider query type (from context): be more permissive for 'opinion' or 'creative' queries
    const isOpinion = this.isOpinionQuery(String(context.queryType || ''));
    const adjustedScore = isOpinion ? Math.min(1, score + 0.15) : score;

    // Be more cautious for high-risk queries
    const isHighRisk = this.isHighRiskQuery(context.query);
    const minRefuse = isHighRisk
      ? Math.max(thresholds.refuse, 0.6)
      : thresholds.refuse;
    const minAskClarify = isHighRisk
      ? Math.max(thresholds.askClarify, 0.8)
      : thresholds.askClarify;

    // Refuse if below minimum threshold (respect high-risk adjustments)
    if (adjustedScore < minRefuse) {
      return {
        type: 'REFUSE',
        reasons: [
          `Grounding score (${adjustedScore.toFixed(2)}) below refuse threshold (${minRefuse}) (queryType: ${context.queryType || 'N/A'})`,
          this.getPrimaryFailureReason(metrics),
        ],
      };
    }

    // Ask for clarification if intent is unclear (include context.queryType)
    if (
      metrics.intentScore < thresholds.intentMinimum &&
      adjustedScore < minAskClarify
    ) {
      return {
        type: 'ASK_CLARIFY',
        reasons: [
          `Intent clarity (${metrics.intentScore.toFixed(2)}) below threshold (${thresholds.intentMinimum}) (queryType: ${context.queryType || 'N/A'})`,
          'Query intent needs clarification',
        ],
      };
    }

    // Search for more information if retrieval is weak (include retrieval stats from context)
    if (
      metrics.retrievalScore < thresholds.searchMore &&
      adjustedScore < minAskClarify
    ) {
      return {
        type: 'SEARCH_MORE',
        reasons: [
          `Retrieval score (${metrics.retrievalScore.toFixed(2)}) below threshold (${thresholds.searchMore}) with ${context.retrieval.sources.length} sources`,
          'Additional information needed for reliable response',
        ],
      };
    }

    // All checks passed, consider context in reasons
    return {
      type: 'GENERATE',
      reasons: [
        `Grounding score (${adjustedScore.toFixed(2)}) meets generation threshold (queryType: ${context.queryType || 'N/A'})`,
        `All grounding criteria satisfied (${context.retrieval.sources.length} sources)`,
      ],
    };
  }

  /**
   * Create a decision object, carrying through context properties into metrics where relevant.
   */
  private createDecision(
    score: number,
    decision: 'GENERATE' | 'REFUSE' | 'ASK_CLARIFY' | 'SEARCH_MORE',
    reasons: string[],
    context: GroundingContext,
    prohibitMemoryWrite = false,
  ): GroundingDecision {
    // Optionally, try to extract metrics from context if available
    let retrievalScore = 0;
    let intentScore = 0;
    let freshnessScore = 0;
    let sourceDiversityScore = 0;

    // Calculate scores from context properties
    retrievalScore =
      context.retrieval.relevantHits / Math.max(context.retrieval.hitCount, 1);
    intentScore = (context.intent.clarity + context.intent.specificity) / 2;
    freshnessScore = context.freshness.freshnessScore;
    sourceDiversityScore = Math.min(context.retrieval.sources.length / 5, 1); // Max diversity at 5 sources

    return {
      groundingScore: score,
      decision,
      reasons,
      metrics: {
        retrievalScore,
        intentScore,
        freshnessScore,
        sourceDiversityScore,
        finalScore: score,
      },
      timestamp: Date.now(),
      prohibitMemoryWrite,
    };
  }

  /**
   * Get primary failure reason from metrics
   */
  private getPrimaryFailureReason(metrics: any): string {
    const issues = [];

    if (metrics.retrievalScore < 0.5) issues.push('weak retrieval');
    if (metrics.intentScore < 0.5) issues.push('unclear intent');
    if (metrics.freshnessScore < 0.5) issues.push('stale data');
    if (metrics.sourceDiversityScore < 0.5) issues.push('limited sources');

    return issues.length > 0
      ? `Primary issues: ${issues.join(', ')}`
      : 'Multiple grounding deficiencies';
  }

  /**
   * Check if query is opinion-based (lower grounding requirements)
   */
  private isOpinionQuery(queryType: string): boolean {
    return ['opinion', 'creative'].includes(queryType);
  }

  /**
   * Check if query involves high-risk topics
   */
  private isHighRiskQuery(query: string): boolean {
    const highRiskKeywords = [
      'medical',
      'health',
      'financial',
      'legal',
      'security',
      'confidential',
      'sensitive',
      'private',
      'personal',
    ];

    const lowerQuery = query.toLowerCase();
    return highRiskKeywords.some((keyword) => lowerQuery.includes(keyword));
  }

  /**
   * Log decision for analytics
   */
  private logDecision(
    context: GroundingContext,
    result: GroundingDecision,
    duration: number,
  ): void {
    if (!this.loggingEnabled) return;

    this.logger.log('🔒 GCL Decision', {
      conversationId: context.conversationId,
      queryType: context.queryType,
      score: result.groundingScore.toFixed(3),
      decision: result.decision,
      duration,
      reasons: result.reasons,
      metrics: {
        retrieval: result.metrics.retrievalScore.toFixed(2),
        intent: result.metrics.intentScore.toFixed(2),
        freshness: result.metrics.freshnessScore.toFixed(2),
        diversity: result.metrics.sourceDiversityScore.toFixed(2),
      },
    });
  }

  /**
   * Update thresholds dynamically
   */
  updateThresholds(newThresholds: Partial<GroundingThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.logger.log('🔧 GCL thresholds updated', {
      thresholds: this.thresholds,
    });
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      shadowMode: this.shadowMode,
      blockingEnabled: this.blockingEnabled,
      strictRefusal: this.strictRefusal,
      loggingEnabled: this.loggingEnabled,
      emergencyBypass: this.emergencyBypass,
      thresholds: this.thresholds,
      weights: this.weights,
    };
  }
}
