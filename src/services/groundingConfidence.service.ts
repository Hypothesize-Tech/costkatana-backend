/**
 * Grounding Confidence Layer (GCL) Service
 * 
 * Pre-generation decision gate that evaluates whether the system has sufficient,
 * fresh, and relevant grounding to safely generate a response.
 * 
 * Core principle: "Generation is a privilege, not a default."
 */

import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import {
  QueryType,
  DecisionType,
  GroundingContext,
  GroundingDecision,
  GroundingThresholds,
  GroundingWeights,
  GroundingConfig,
  GroundingMetrics,
  DomainRisk,
  GroundingSource
} from '../types/grounding.types';

export class GroundingConfidenceService extends EventEmitter {
  private static instance: GroundingConfidenceService;
  
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
    contextDriftIntentThreshold: 0.75
  };
  
  // Weights (tunable)
  private weights: GroundingWeights = {
    retrieval: 0.35,
    intent: 0.25,
    freshness: 0.20,
    diversity: 0.20
  };

  // Loop protection limits
  private readonly MAX_CLARIFICATION_ATTEMPTS = 2;
  private readonly MAX_SEARCH_ATTEMPTS = 2;
  
  // Decision cache TTL (2 minutes)
  private readonly DECISION_CACHE_TTL = 120;

  private constructor() {
    super();
    this.shadowMode = process.env.ENABLE_GCL_SHADOW === 'true';
    this.blockingEnabled = process.env.ENABLE_GCL_BLOCKING === 'true';
    this.strictRefusal = process.env.ENABLE_GCL_STRICT_REFUSAL === 'true';
    this.loggingEnabled = process.env.ENABLE_GCL_LOGGING === 'true';
    this.emergencyBypass = process.env.ENABLE_GCL_EMERGENCY_BYPASS === 'true';
    
    loggingService.info('🔒 GroundingConfidenceService initialized', {
      shadowMode: this.shadowMode,
      blockingEnabled: this.blockingEnabled,
      strictRefusal: this.strictRefusal,
      thresholds: this.thresholds
    });
  }

  public static getInstance(): GroundingConfidenceService {
    if (!GroundingConfidenceService.instance) {
      GroundingConfidenceService.instance = new GroundingConfidenceService();
    }
    return GroundingConfidenceService.instance;
  }

  /**
   * Main evaluation method - THE GATE
   * Returns decision on whether system can safely generate
   */
  public async evaluate(context: GroundingContext): Promise<GroundingDecision> {
    const startTime = Date.now();
    
    try {
      // Emergency bypass check
      if (this.emergencyBypass) {
        loggingService.warn('🚨 GCL emergency bypass active - allowing generation', {
          query: context.query.substring(0, 100)
        });
        return this.createDecision(1.0, 'GENERATE', ['Emergency bypass enabled'], context);
      }

      // Check decision cache for stickiness (anti-retry abuse)
      const cachedDecision = await this.getCachedDecision(context);
      if (cachedDecision) {
        loggingService.info('🔄 Returning cached GCL decision', {
          decision: cachedDecision.decision,
          conversationId: context.conversationId
        });
        return cachedDecision;
      }

      // Loop protection checks
      if (context.clarificationAttempts && context.clarificationAttempts >= this.MAX_CLARIFICATION_ATTEMPTS) {
        return this.createDecision(0, 'REFUSE', [
          `Maximum clarification attempts (${this.MAX_CLARIFICATION_ATTEMPTS}) reached`,
          'Unable to establish clear intent'
        ], context, true);
      }

      if (context.searchAttempts && context.searchAttempts >= this.MAX_SEARCH_ATTEMPTS) {
        return this.createDecision(0, 'REFUSE', [
          `Maximum search attempts (${this.MAX_SEARCH_ATTEMPTS}) reached`,
          'Unable to retrieve fresh data after multiple attempts'
        ], context, true);
      }

      // HARD GATES (non-negotiable)
      if (context.retrieval.hitCount === 0 && !this.isOpinionQuery(context.queryType)) {
        const decision = this.createDecision(0, 'REFUSE', [
          'No relevant information found',
          'Cannot generate without grounding on factual queries'
        ], context, true);
        await this.cacheDecision(context, decision);
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
      
      const metrics: GroundingMetrics = {
        retrievalScore,
        intentScore,
        freshnessScore,
        sourceDiversityScore: diversityScore,
        finalScore: groundingScore
      };
      
      // Apply domain risk adjustment
      const adjustedThresholds = this.applyDomainRisk(context, { ...this.thresholds });
      
      // Decision logic
      const decision = this.determineDecision(context, groundingScore, metrics, adjustedThresholds);
      
      const result: GroundingDecision = {
        groundingScore,
        decision: decision.type,
        reasons: decision.reasons,
        metrics,
        timestamp: Date.now(),
        prohibitMemoryWrite: decision.type !== 'GENERATE'
      };
      
      // Cache decision for stickiness
      await this.cacheDecision(context, result);
      
      // Logging & metrics
      this.logDecision(context, result, Date.now() - startTime);
      
      // Emit event for analytics
      this.emit('grounding_evaluated', { context, result });
      
      return result;
      
    } catch (error) {
      loggingService.error('❌ GCL evaluation failed - FAILING SAFE', {
        error: error instanceof Error ? error.message : String(error),
        query: context.query.substring(0, 100)
      });
      
      // FAIL SAFE: Ask for clarification on internal error
      return this.createDecision(0, 'ASK_CLARIFY', [
        'Unable to verify sufficient grounding',
        'Internal evaluation error'
      ], context, true);
    }
  }

  /**
   * Score retrieval quality (0-1)
   */
  private scoreRetrieval(context: GroundingContext): number {
    const { hitCount, maxSimilarity, meanSimilarity } = context.retrieval;
    
    // Hard gates
    if (hitCount === 0) return 0;
    if (maxSimilarity < 0.6) return 0.2;
    
    // Quality scoring
    let score = meanSimilarity;
    
    // Boost for multiple high-quality hits
    if (hitCount >= 3 && maxSimilarity > 0.8) {
      score = Math.min(1.0, score + 0.1);
    }
    
    // Penalty for single-source dependency
    if (hitCount === 1) {
      score *= 0.8;
    }
    
    // Boost for user-uploaded documents if present
    if (context.documentIds && context.documentIds.length > 0) {
      const docHits = context.retrieval.sources.filter(s => 
        context.documentIds?.includes(s.sourceId)
      );
      if (docHits.length > 0) {
        score = Math.min(1.0, score + 0.05);
      }
    }
    
    return this.clamp(score, 0, 1);
  }

  /**
   * Score intent clarity (0-1)
   */
  private scoreIntent(context: GroundingContext): number {
    let score = context.intent.confidence;
    
    // Penalty for ambiguity
    if (context.intent.ambiguous) {
      score *= 0.7;
    }
    
    return this.clamp(score, 0, 1);
  }

  /**
   * Score freshness (0-1)
   */
  private scoreFreshness(context: GroundingContext): number {
    // Non-time-sensitive queries always pass
    if (!context.timeSensitive) return 1.0;
    
    // No cache used = fresh retrieval = perfect score
    if (!context.cache?.used) return 1.0;
    
    // Check explicit freshness score
    if (context.cache.freshnessScore !== undefined) {
      return context.cache.freshnessScore;
    }
    
    // Check validUntil timestamp
    if (context.cache.validUntil) {
      const now = Date.now();
      if (now < context.cache.validUntil) return 1.0;
      // Expired cache on time-sensitive query
      return 0.2;
    }
    
    // Check source timestamps for staleness
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    const sources = context.retrieval.sources.filter(s => s.timestamp);
    
    if (sources.length > 0) {
      const staleSourceCount = sources.filter(s => 
        s.timestamp && s.timestamp < fiveMinutesAgo
      ).length;
      
      if (staleSourceCount > sources.length / 2) {
        return 0.4; // Majority stale
      }
    }
    
    // Default conservative score for cached time-sensitive
    return 0.3;
  }

  /**
   * Score source diversity (0-1)
   */
  private scoreSourceDiversity(context: GroundingContext): number {
    const uniqueTypes = new Set(
      context.retrieval.sources.map(s => s.sourceType)
    );
    
    const typeCount = uniqueTypes.size;
    
    if (typeCount >= 3) return 1.0;
    if (typeCount === 2) return 0.8;
    if (typeCount === 1) return 0.6;
    return 0.2;
  }

  /**
   * Determine final decision based on score and context
   */
  private determineDecision(
    context: GroundingContext,
    groundingScore: number,
    metrics: GroundingMetrics,
    thresholds: GroundingThresholds
  ): { type: DecisionType; reasons: string[] } {
    const reasons: string[] = [];
    
    // Context drift check (critical safeguard)
    if (context.contextDriftHigh && context.intent.confidence < thresholds.contextDriftIntentThreshold) {
      reasons.push('Detected topic shift with uncertain intent');
      reasons.push(`Intent confidence ${context.intent.confidence.toFixed(2)} below drift threshold ${thresholds.contextDriftIntentThreshold}`);
      return { type: 'ASK_CLARIFY', reasons };
    }
    
    // REFUSE conditions
    if (groundingScore < thresholds.refuse) {
      reasons.push(`Grounding score ${groundingScore.toFixed(2)} below minimum ${thresholds.refuse}`);
      reasons.push(`Found ${context.retrieval.hitCount} sources with max similarity ${context.retrieval.maxSimilarity.toFixed(2)}`);
      return { type: 'REFUSE', reasons };
    }
    
    // ASK_CLARIFY conditions
    if (context.intent.confidence < thresholds.intentMinimum) {
      reasons.push(`Intent confidence ${context.intent.confidence.toFixed(2)} below threshold ${thresholds.intentMinimum}`);
      reasons.push('Query may be ambiguous or unclear');
      return { type: 'ASK_CLARIFY', reasons };
    }
    
    // Agent-specific gates
    if (context.agentType === 'OPTIMIZER' && metrics.retrievalScore < thresholds.optimizerRetrievalMinimum) {
      reasons.push('Cost optimizer requires higher retrieval confidence');
      reasons.push(`Retrieval score ${metrics.retrievalScore.toFixed(2)} below optimizer minimum ${thresholds.optimizerRetrievalMinimum}`);
      return { type: 'ASK_CLARIFY', reasons };
    }
    
    // SEARCH_MORE conditions (time-sensitive + stale cache)
    if (context.timeSensitive && 
        context.cache?.used && 
        metrics.freshnessScore < thresholds.cacheMinimumFreshness) {
      reasons.push('Time-sensitive query with stale cached data');
      reasons.push(`Freshness score ${metrics.freshnessScore.toFixed(2)} below threshold ${thresholds.cacheMinimumFreshness}`);
      return { type: 'SEARCH_MORE', reasons };
    }
    
    // User-uploaded document queries need at least one doc hit
    if (context.documentIds && context.documentIds.length > 0) {
      const docHits = context.retrieval.sources.filter(s => 
        context.documentIds?.includes(s.sourceId)
      );
      if (docHits.length === 0) {
        reasons.push('User uploaded documents but none were retrieved');
        reasons.push('Unable to ground response in provided documents');
        return { type: 'REFUSE', reasons };
      }
    }
    
    // GENERATE - all checks passed
    reasons.push(`Grounding score ${groundingScore.toFixed(2)} passes threshold`);
    reasons.push(`Retrieval: ${context.retrieval.hitCount} sources, max similarity ${context.retrieval.maxSimilarity.toFixed(2)}`);
    if (context.retrieval.sources.length > 0) {
      const sourceTypes = [...new Set(context.retrieval.sources.map(s => s.sourceType))];
      reasons.push(`Source diversity: ${sourceTypes.join(', ')}`);
    }
    return { type: 'GENERATE', reasons };
  }

  /**
   * Apply domain-specific risk adjustments
   */
  private applyDomainRisk(context: GroundingContext, thresholds: GroundingThresholds): GroundingThresholds {
    const domain = this.detectDomain(context.query);
    
    if (domain === 'FINANCE' || domain === 'SECURITY' || domain === 'LEGAL' || domain === 'HEALTHCARE') {
      loggingService.info('🔐 Applying strict domain risk multiplier', {
        domain,
        originalRefuseThreshold: thresholds.refuse
      });
      
      // Stricter thresholds for high-risk domains
      return {
        ...thresholds,
        refuse: thresholds.refuse + 0.1,
        intentMinimum: Math.min(thresholds.intentMinimum + 0.05, 0.85)
      };
    }
    
    return thresholds;
  }

  /**
   * Detect domain risk from query
   */
  private detectDomain(query: string): DomainRisk {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.match(/\b(payment|billing|invoice|cost|price|charge|budget|financial|money|dollar)\b/i)) {
      return 'FINANCE';
    }
    
    if (lowerQuery.match(/\b(security|credential|password|token|auth|permission|access|iam|policy)\b/i)) {
      return 'SECURITY';
    }
    
    if (lowerQuery.match(/\b(legal|compliance|gdpr|hipaa|regulation|policy|contract|terms)\b/i)) {
      return 'LEGAL';
    }
    
    if (lowerQuery.match(/\b(health|medical|patient|diagnosis|treatment|medication)\b/i)) {
      return 'HEALTHCARE';
    }
    
    return 'GENERAL';
  }

  /**
   * Check if query is opinion-based (doesn't require hard facts)
   */
  private isOpinionQuery(queryType: QueryType): boolean {
    return queryType === 'OPINION';
  }

  /**
   * Create decision object
   */
  private createDecision(
    score: number,
    type: DecisionType,
    reasons: string[],
    context: GroundingContext,
    prohibitMemoryWrite: boolean = false
  ): GroundingDecision {
    // Helper to safely calculate source diversity
    const calculateDiversity = (sources: GroundingSource[]): number => {
      const uniqueTypes = new Set(sources.map(s => s.sourceType));
      const typeCount = uniqueTypes.size;
      if (typeCount >= 3) return 1.0;
      if (typeCount === 2) return 0.8;
      if (typeCount === 1) return 0.6;
      return 0.2;
    };

    return {
      groundingScore: score,
      decision: type,
      reasons,
      metrics: {
        retrievalScore: context.retrieval?.maxSimilarity ?? 0,
        intentScore: context.intent?.confidence ?? 0,
        freshnessScore: context.cache?.freshnessScore ?? 0,
        sourceDiversityScore: calculateDiversity(context.retrieval?.sources ?? []),
        finalScore: score
      },
      timestamp: Date.now(),
      prohibitMemoryWrite: prohibitMemoryWrite || type !== 'GENERATE'
    };
  }

  /**
   * Generate cache key for decision stickiness
   */
  private generateCacheKey(context: GroundingContext): string {
    const normalizedQuery = context.query.toLowerCase().trim().replace(/\s+/g, ' ');
    const keyContent = `${context.conversationId || 'no-conv'}:${normalizedQuery}`;
    return `gcl:decision:${crypto.createHash('md5').update(keyContent).digest('hex')}`;
  }

  /**
   * Get cached decision (anti-retry abuse)
   */
  private async getCachedDecision(context: GroundingContext): Promise<GroundingDecision | null> {
    try {
      const cacheKey = this.generateCacheKey(context);
      const cached = await redisService.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached) as GroundingDecision;
      }
    } catch (error) {
      loggingService.warn('Failed to get cached GCL decision', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    return null;
  }

  /**
   * Cache decision for stickiness (2 minutes)
   */
  private async cacheDecision(context: GroundingContext, decision: GroundingDecision): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(context);
      await redisService.set(cacheKey, JSON.stringify(decision), this.DECISION_CACHE_TTL);
    } catch (error) {
      loggingService.warn('Failed to cache GCL decision', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Log decision for metrics & debugging
   */
  private logDecision(
    context: GroundingContext,
    result: GroundingDecision,
    evaluationTimeMs: number
  ): void {
    if (!this.loggingEnabled) return;
    
    const logData = {
      component: 'GroundingConfidenceService',
      operation: 'evaluate',
      
      // Decision
      decision: result.decision,
      groundingScore: result.groundingScore,
      reasons: result.reasons,
      prohibitMemoryWrite: result.prohibitMemoryWrite,
      
      // Context
      queryType: context.queryType,
      agentType: context.agentType,
      timeSensitive: context.timeSensitive,
      contextDriftHigh: context.contextDriftHigh || false,
      
      // Retrieval signals
      hitCount: context.retrieval.hitCount,
      maxSimilarity: context.retrieval.maxSimilarity,
      meanSimilarity: context.retrieval.meanSimilarity,
      sourceTypes: [...new Set(context.retrieval.sources.map(s => s.sourceType))],
      
      // Intent signals
      intentConfidence: context.intent.confidence,
      intentAmbiguous: context.intent.ambiguous,
      
      // Cache signals
      cacheUsed: context.cache?.used || false,
      cacheFreshness: context.cache?.freshnessScore,
      
      // Loop protection
      clarificationAttempts: context.clarificationAttempts || 0,
      searchAttempts: context.searchAttempts || 0,
      
      // Metrics
      ...result.metrics,
      evaluationTimeMs,
      
      // Mode
      shadowMode: this.shadowMode,
      blockingEnabled: this.blockingEnabled,
      strictRefusal: this.strictRefusal,
      
      // User context (for analytics)
      userId: context.userId,
      conversationId: context.conversationId
    };
    
    // Log based on decision
    if (result.decision === 'REFUSE') {
      loggingService.warn(`🚫 GCL Decision: REFUSE`, logData);
    } else if (result.decision === 'ASK_CLARIFY') {
      loggingService.info(`❓ GCL Decision: ASK_CLARIFY`, logData);
    } else if (result.decision === 'SEARCH_MORE') {
      loggingService.info(`🔍 GCL Decision: SEARCH_MORE`, logData);
    } else {
      loggingService.info(`✅ GCL Decision: GENERATE`, logData);
    }
    
    // TODO: Send to metrics system (Mixpanel, DataDog, etc.)
    // await metricsService.track('grounding_decision', logData);
  }

  /**
   * Utility: clamp value between min and max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Update thresholds (for A/B testing)
   */
  public updateThresholds(thresholds: Partial<GroundingThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    loggingService.info('🔧 GCL thresholds updated', { thresholds: this.thresholds });
  }

  /**
   * Update weights (for A/B testing)
   */
  public updateWeights(weights: Partial<GroundingWeights>): void {
    this.weights = { ...this.weights, ...weights };
    loggingService.info('🔧 GCL weights updated', { weights: this.weights });
  }

  /**
   * Get current configuration (for debugging)
   */
  public getConfig(): { thresholds: GroundingThresholds; weights: GroundingWeights; flags: GroundingConfig } {
    return {
      thresholds: this.thresholds,
      weights: this.weights,
      flags: {
        shadowMode: this.shadowMode,
        blockingEnabled: this.blockingEnabled,
        strictRefusal: this.strictRefusal,
        loggingEnabled: this.loggingEnabled,
        emergencyBypass: this.emergencyBypass
      }
    };
  }
}

export const groundingConfidenceService = GroundingConfidenceService.getInstance();
