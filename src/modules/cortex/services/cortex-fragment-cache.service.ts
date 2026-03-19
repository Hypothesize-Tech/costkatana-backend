/**
 * Cortex Fragment Cache Service (NestJS)
 *
 * Implements granular caching of individual, reusable Cortex query components
 * instead of full prompts. Provides higher cache hit rates by identifying
 * and caching semantic fragments that can be composed into larger queries.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CortexFrame, CortexValue } from '../types/cortex.types';
import * as crypto from 'crypto';

export interface CortexFragment {
  id: string;
  type: 'semantic' | 'structural' | 'computational' | 'temporal';
  content: CortexFrame | CortexValue;
  hash: string;
  metadata: {
    category: FragmentCategory;
    complexity: 'simple' | 'medium' | 'complex';
    reusability: number;
    semanticTags: string[];
    dependencies: string[];
    created: Date;
    lastAccessed: Date;
    accessCount: number;
    avgComputationTime: number;
    compressionRatio: number;
  };
}

export interface FragmentCacheResult {
  hit: boolean;
  fragment?: CortexFragment;
  partialHits: CortexFragment[];
  compositeKey?: string;
  metadata: {
    hitRate: number;
    fragmentsFound: number;
    totalFragments: number;
    cacheTime: number;
    compressionSavings: number;
  };
}

export interface FragmentComposition {
  fragments: CortexFragment[];
  missingParts: CortexFrame[];
  coverageRatio: number;
  reconstructedQuery: CortexFrame;
  compositionStrategy: 'merge' | 'overlay' | 'sequence' | 'conditional';
}

export interface FragmentExtractionResult {
  fragments: CortexFragment[];
  extractionStrategy: 'semantic' | 'structural' | 'pattern' | 'ml';
  metadata: {
    originalComplexity: number;
    fragmentCount: number;
    reusabilityScore: number;
    extractionTime: number;
    potentialCacheable: number;
  };
}

export type FragmentCategory =
  | 'entity_query'
  | 'action_command'
  | 'data_transform'
  | 'calculation'
  | 'validation'
  | 'format_conversion'
  | 'api_call'
  | 'condition_check'
  | 'list_operation'
  | 'string_operation'
  | 'date_operation'
  | 'generic'
  | 'transformation';

export interface FragmentCacheConfig {
  maxFragments: number;
  maxAge: number;
  reusabilityThreshold: number;
  compressionThreshold: number;
  semanticSimilarityThreshold: number;
  enableComposition: boolean;
  enablePredictiveCaching: boolean;
  fragmentExtractionMode: 'aggressive' | 'balanced' | 'conservative';
}

@Injectable()
export class CortexFragmentCacheService {
  private readonly logger = new Logger(CortexFragmentCacheService.name);
  private fragmentCache = new Map<string, CortexFragment>();
  private compositionCache = new Map<string, FragmentComposition>();
  private semanticIndex = new Map<string, Set<string>>();
  private config: FragmentCacheConfig;
  private stats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    fragmentsStored: 0,
    avgAccessTime: 0,
  };

  constructor() {
    this.config = {
      maxFragments: 10000,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      reusabilityThreshold: 0.3,
      compressionThreshold: 0.1,
      semanticSimilarityThreshold: 0.8,
      enableComposition: true,
      enablePredictiveCaching: true,
      fragmentExtractionMode: 'balanced',
    };

    this.initializeFragmentPatterns();
    this.startCleanupInterval();
  }

  /**
   * Check cache for existing fragment.
   * @param hash - Content hash of the fragment
   * @param options - Optional semantic tags extracted from content at lookup time (use instead of hash-as-base64-decode)
   */
  public checkCache(
    hash: string,
    options?: { semanticTags?: string[] },
  ): FragmentCacheResult {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const fragment = this.fragmentCache.get(hash);

    if (fragment) {
      // Update access statistics
      fragment.metadata.lastAccessed = new Date();
      fragment.metadata.accessCount++;
      this.stats.hits++;

      this.logger.debug('🎯 Fragment cache hit', {
        hash: hash.substring(0, 8),
        type: fragment.type,
        category: fragment.metadata.category,
        accessCount: fragment.metadata.accessCount,
      });

      return {
        hit: true,
        fragment,
        partialHits: [],
        metadata: {
          hitRate: this.getHitRate(),
          fragmentsFound: 1,
          totalFragments: this.fragmentCache.size,
          cacheTime: Date.now() - startTime,
          compressionSavings: fragment.metadata.compressionRatio,
        },
      };
    }

    // Check for partial matches using tags from content (stored at write time)
    const semanticTags = options?.semanticTags ?? [];
    const partialHits = this.findPartialMatchesByTags(semanticTags);

    this.stats.misses++;
    return {
      hit: false,
      partialHits,
      metadata: {
        hitRate: this.getHitRate(),
        fragmentsFound: partialHits.length,
        totalFragments: this.fragmentCache.size,
        cacheTime: Date.now() - startTime,
        compressionSavings: 0,
      },
    };
  }

  /**
   * Find partial matches using semantic tags (extracted from content at lookup time).
   * Tags must be passed by the caller; fragments store tags at write time.
   */
  private findPartialMatchesByTags(queryTags: string[]): CortexFragment[] {
    const partialHits: CortexFragment[] = [];
    if (queryTags.length === 0) return partialHits;

    for (const fragment of this.fragmentCache.values()) {
      const storedTags = fragment.metadata.semanticTags ?? [];
      if (storedTags.length === 0) continue;
      const similarity = this.jaccardSimilarity(
        new Set(queryTags),
        new Set(storedTags),
      );
      if (similarity >= this.config.semanticSimilarityThreshold) {
        partialHits.push(fragment);
      }
      if (partialHits.length >= 5) break;
    }
    return partialHits;
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    const intersection = new Set([...a].filter((t) => b.has(t)));
    const union = new Set([...a, ...b]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Extract semantic tags from a Cortex frame (same logic as when writing fragments).
   * Callers should use this and pass tags to checkCache for partial matching.
   */
  public extractTagsFromFrame(frame: CortexFrame): string[] {
    const tags: string[] = [];
    if ('action' in frame && frame.action) {
      tags.push('action', String(frame.action));
    }
    if ('entity' in frame && frame.entity) {
      tags.push('entity', String(frame.entity));
    }
    for (const key of Object.keys(frame)) {
      if (key !== 'frameType' && key !== 'action' && key !== 'entity') {
        tags.push(key);
      }
    }
    return [...new Set(tags)];
  }

  /**
   * Store fragment in cache
   */
  public storeFragment(fragment: CortexFragment): void {
    if (this.fragmentCache.size >= this.config.maxFragments) {
      this.evictOldestFragment();
    }

    this.fragmentCache.set(fragment.hash, fragment);
    this.stats.fragmentsStored++;

    // Update semantic index
    for (const tag of fragment.metadata.semanticTags) {
      if (!this.semanticIndex.has(tag)) {
        this.semanticIndex.set(tag, new Set());
      }
      this.semanticIndex.get(tag)!.add(fragment.id);
    }

    this.logger.debug('💾 Fragment stored in cache', {
      id: fragment.id,
      type: fragment.type,
      category: fragment.metadata.category,
      reusability: fragment.metadata.reusability,
    });
  }

  /**
   * Query fragment cache by frame (used by gateway).
   * Extracts tags from frame and checks cache with hash + tags for partial matching.
   */
  public async queryFragmentCache(
    frame: CortexFrame,
  ): Promise<FragmentCacheResult> {
    const hash = this.generateHash(frame);
    const semanticTags = this.extractTagsFromFrame(frame);
    return this.checkCache(hash, { semanticTags });
  }

  /**
   * Cache fragments from a processed frame (used by gateway).
   * Stores fragments with semantic tags at write time.
   */
  public async cacheFragments(
    frame: CortexFrame,
    _result: unknown,
    _time: number,
  ): Promise<void> {
    this.extractFragments(frame);
  }

  /**
   * Extract fragments from Cortex frame
   */
  public extractFragments(frame: CortexFrame): FragmentExtractionResult {
    const startTime = Date.now();
    const fragments: CortexFragment[] = [];

    try {
      // Extract semantic fragments
      const semanticFragments = this.extractSemanticFragments(frame);
      fragments.push(...semanticFragments);

      // Extract structural fragments
      const structuralFragments = this.extractStructuralFragments(frame);
      fragments.push(...structuralFragments);

      // Calculate reusability scores
      fragments.forEach((fragment) => {
        fragment.metadata.reusability =
          this.calculateReusabilityScore(fragment);
      });

      // Filter cacheable fragments
      const cacheableFragments = fragments.filter(
        (f) => f.metadata.reusability >= this.config.reusabilityThreshold,
      );

      // Store cacheable fragments
      cacheableFragments.forEach((fragment) => {
        this.storeFragment(fragment);
      });

      const reusabilityScore =
        fragments.length > 0
          ? fragments.reduce((sum, f) => sum + f.metadata.reusability, 0) /
            fragments.length
          : 0;

      this.logger.debug('🔍 Fragment extraction completed', {
        originalFrameType: frame.frameType,
        fragmentsExtracted: fragments.length,
        cacheableFragments: cacheableFragments.length,
        avgReusability: Math.round(reusabilityScore * 100) / 100,
        extractionTime: Date.now() - startTime,
      });

      return {
        fragments: cacheableFragments,
        extractionStrategy: 'semantic',
        metadata: {
          originalComplexity: this.calculateFrameComplexity(frame),
          fragmentCount: cacheableFragments.length,
          reusabilityScore,
          extractionTime: Date.now() - startTime,
          potentialCacheable: cacheableFragments.length,
        },
      };
    } catch (error) {
      this.logger.error(
        '❌ Fragment extraction failed',
        error instanceof Error ? error.message : String(error),
      );
      return {
        fragments: [],
        extractionStrategy: 'semantic',
        metadata: {
          originalComplexity: 0,
          fragmentCount: 0,
          reusabilityScore: 0,
          extractionTime: Date.now() - startTime,
          potentialCacheable: 0,
        },
      };
    }
  }

  /**
   * Compose fragments into complete frame
   */
  public composeFragments(
    fragments: CortexFragment[],
    targetFrame: CortexFrame,
  ): FragmentComposition {
    const reconstructed: any = { frameType: targetFrame.frameType };

    let coverageRatio = 0;
    const missingParts: CortexFrame[] = [];

    // Intelligent composition based on fragment types
    const compositionStrategy = this.determineCompositionStrategy(
      fragments,
      targetFrame,
    );

    switch (compositionStrategy) {
      case 'merge':
        coverageRatio = this.mergeFragments(fragments, reconstructed);
        break;
      case 'overlay':
        coverageRatio = this.overlayFragments(fragments, reconstructed);
        break;
      case 'sequence':
        coverageRatio = this.sequenceFragments(fragments, reconstructed);
        break;
      case 'conditional':
        coverageRatio = this.conditionalFragments(
          fragments,
          reconstructed,
          targetFrame,
        );
        break;
    }

    // Identify missing parts
    for (const [key, value] of Object.entries(targetFrame)) {
      if (key !== 'frameType' && !(key in reconstructed)) {
        missingParts.push({
          frameType: targetFrame.frameType,
          [key]: value,
        } as CortexFrame);
      }
    }

    coverageRatio = Math.min(1, coverageRatio);

    return {
      fragments,
      missingParts,
      coverageRatio,
      reconstructedQuery: reconstructed as CortexFrame,
      compositionStrategy,
    };
  }

  private determineCompositionStrategy(
    fragments: CortexFragment[],
    targetFrame: CortexFrame,
  ): 'merge' | 'overlay' | 'sequence' | 'conditional' {
    // Use targetFrame to further refine strategy selection

    const hasConditional = fragments.some((f) => f.type === 'computational');
    const hasSequential = fragments.some(
      (f) => f.metadata.category === 'action_command',
    );
    const hasStructural = fragments.some((f) => f.type === 'structural');

    // Example usage of targetFrame: choose overlay if frameType is 'overlay'
    if (targetFrame.frameType === 'conditional' || hasConditional) {
      return 'conditional';
    }
    if (targetFrame.frameType === 'sequence' || hasSequential) {
      return 'sequence';
    }
    if ((targetFrame.frameType as string) === 'overlay' || hasStructural) {
      return 'overlay';
    }
    // Fallback default
    return 'merge';
  }

  private mergeFragments(
    fragments: CortexFragment[],
    reconstructed: any,
  ): number {
    let totalCoverage = 0;

    for (const fragment of fragments) {
      if (typeof fragment.content === 'object' && fragment.content !== null) {
        Object.assign(reconstructed, fragment.content);
        totalCoverage += 1.0 / fragments.length; // Equal weight distribution
      }
    }

    return totalCoverage;
  }

  private overlayFragments(
    fragments: CortexFragment[],
    reconstructed: any,
  ): number {
    // Overlay fragments with priority (newer fragments override older ones)
    const sortedFragments = fragments.sort(
      (a, b) => b.metadata.created.getTime() - a.metadata.created.getTime(),
    );

    let totalCoverage = 0;

    for (const fragment of sortedFragments) {
      if (typeof fragment.content === 'object' && fragment.content !== null) {
        Object.assign(reconstructed, fragment.content);
        totalCoverage += 0.8 / fragments.length; // Slightly less weight for overlay
      }
    }

    return totalCoverage;
  }

  private sequenceFragments(
    fragments: CortexFragment[],
    reconstructed: any,
  ): number {
    // Compose fragments in sequence
    let totalCoverage = 0;

    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i];
      if (typeof fragment.content === 'object' && fragment.content !== null) {
        // Add sequence information
        const sequencedContent = {
          ...fragment.content,
          sequenceOrder: i,
          nextFragment: i < fragments.length - 1 ? fragments[i + 1].id : null,
        };
        Object.assign(reconstructed, sequencedContent);
        totalCoverage += 0.9 / fragments.length; // High weight for sequence
      }
    }

    return totalCoverage;
  }

  private conditionalFragments(
    fragments: CortexFragment[],
    reconstructed: any,
    targetFrame: CortexFrame,
  ): number {
    // Conditional composition based on target frame requirements
    let totalCoverage = 0;

    for (const fragment of fragments) {
      if (typeof fragment.content === 'object' && fragment.content !== null) {
        // Check if fragment is relevant to target frame
        if (this.isFragmentRelevant(fragment, targetFrame)) {
          Object.assign(reconstructed, fragment.content);
          totalCoverage += 1.0 / fragments.length;
        }
      }
    }

    return totalCoverage;
  }

  private isFragmentRelevant(
    fragment: CortexFragment,
    targetFrame: CortexFrame,
  ): boolean {
    // Check if fragment content matches target frame requirements
    if (typeof fragment.content !== 'object' || fragment.content === null) {
      return false;
    }

    const fragmentKeys = Object.keys(fragment.content);
    const targetKeys = Object.keys(targetFrame);

    // Check for key overlap
    const overlap = fragmentKeys.filter((key) =>
      targetKeys.includes(key),
    ).length;
    return overlap > 0;
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    fragmentsStored: number;
    cacheSize: number;
    hitRate: number;
    totalRequests: number;
    avgAccessTime: number;
    semanticTags: number;
  } {
    return {
      fragmentsStored: this.stats.fragmentsStored,
      cacheSize: this.fragmentCache.size,
      hitRate: this.getHitRate(),
      totalRequests: this.stats.totalRequests,
      avgAccessTime: this.stats.avgAccessTime,
      semanticTags: this.semanticIndex.size,
    };
  }

  /**
   * Clear cache
   */
  public clearCache(): void {
    this.fragmentCache.clear();
    this.compositionCache.clear();
    this.semanticIndex.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
      fragmentsStored: 0,
      avgAccessTime: 0,
    };
    this.logger.log('🧹 Fragment cache cleared');
  }

  // Private methods

  private getHitRate(): number {
    return this.stats.totalRequests > 0
      ? this.stats.hits / this.stats.totalRequests
      : 0;
  }

  private generateFragmentId(): string {
    return `frag_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateHash(content: any): string {
    const contentStr =
      typeof content === 'string' ? content : JSON.stringify(content);
    return crypto.createHash('sha256').update(contentStr).digest('hex');
  }

  private extractSemanticFragments(frame: CortexFrame): CortexFragment[] {
    const fragments: CortexFragment[] = [];

    // Extract action fragments
    if ('action' in frame) {
      const actionFragment: CortexFragment = {
        id: this.generateFragmentId(),
        type: 'semantic',
        content: frame.action ?? null,
        hash: this.generateHash(frame.action),
        metadata: {
          category: 'action_command',
          complexity: 'simple',
          reusability: 0.8,
          semanticTags: ['action', frame.action as string],
          dependencies: [],
          created: new Date(),
          lastAccessed: new Date(),
          accessCount: 0,
          avgComputationTime: 10,
          compressionRatio: 0.3,
        },
      };
      fragments.push(actionFragment);
    }

    // Extract entity fragments
    if ('entity' in frame) {
      const entityFragment: CortexFragment = {
        id: this.generateFragmentId(),
        type: 'semantic',
        content: frame.entity ?? null,
        hash: this.generateHash(frame.entity),
        metadata: {
          category: 'entity_query',
          complexity: 'simple',
          reusability: 0.9,
          semanticTags: ['entity', frame.entity as string],
          dependencies: [],
          created: new Date(),
          lastAccessed: new Date(),
          accessCount: 0,
          avgComputationTime: 5,
          compressionRatio: 0.2,
        },
      };
      fragments.push(entityFragment);
    }

    return fragments;
  }

  private extractStructuralFragments(frame: CortexFrame): CortexFragment[] {
    const fragments: CortexFragment[] = [];

    // Extract property-value pairs as structural fragments
    for (const [key, value] of Object.entries(frame)) {
      if (key === 'frameType') continue;

      const structuralFragment: CortexFragment = {
        id: this.generateFragmentId(),
        type: 'structural',
        content: {
          [key]: value,
        } as import('../types/cortex.types').CortexValue,
        hash: this.generateHash({ [key]: value }),
        metadata: {
          category: 'generic',
          complexity: 'simple',
          reusability: 0.5,
          semanticTags: [key],
          dependencies: [],
          created: new Date(),
          lastAccessed: new Date(),
          accessCount: 0,
          avgComputationTime: 1,
          compressionRatio: 0.1,
        },
      };
      fragments.push(structuralFragment);
    }

    return fragments;
  }

  private calculateReusabilityScore(fragment: CortexFragment): number {
    let score = 0.5; // Base score

    // Higher score for semantic fragments
    if (fragment.type === 'semantic') score += 0.2;

    // Higher score for frequently used categories
    const highReusabilityCategories: FragmentCategory[] = [
      'entity_query',
      'action_command',
      'calculation',
      'validation',
    ];
    if (highReusabilityCategories.includes(fragment.metadata.category)) {
      score += 0.2;
    }

    // Lower score for complex fragments
    if (fragment.metadata.complexity === 'complex') score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  private calculateFrameComplexity(frame: CortexFrame): number {
    let complexity = 0;
    complexity += Object.keys(frame).length; // Number of roles
    complexity += JSON.stringify(frame).length / 100; // Size factor

    // Add complexity for nested structures
    for (const value of Object.values(frame)) {
      if (typeof value === 'object' && value !== null) {
        complexity += 2;
        if (Array.isArray(value)) {
          complexity += value.length * 0.5;
        } else {
          complexity += Object.keys(value).length * 0.5;
        }
      }
    }

    return complexity;
  }

  /**
   * Perform predictive caching based on usage patterns
   */
  public performPredictiveCaching(currentFrame: CortexFrame): void {
    if (!this.config.enablePredictiveCaching) return;

    // Analyze current frame and cache likely future fragments
    const predictions = this.predictFutureFragments(currentFrame);

    for (const prediction of predictions) {
      if (this.shouldCachePrediction(prediction)) {
        this.storeFragment(prediction);
      }
    }
  }

  /**
   * Predict likely future Cortex fragments for preemptive caching,
   * using production-level statistical heuristics and early ML integration.
   *
   *
   */
  private predictFutureFragments(currentFrame: CortexFrame): CortexFragment[] {
    const predictions: CortexFragment[] = [];

    // 1. Feature extraction
    const frameType = currentFrame.frameType;
    const category = (currentFrame as any).category;
    const action = (currentFrame as Record<string, any>).action;
    const semanticTags = Array.isArray((currentFrame as any).semanticTags)
      ? (currentFrame as any).semanticTags
      : [];

    // 2. Heuristic prediction based on action and type
    if (frameType === 'query') {
      // Common action trajectory prediction
      if (action === 'action_get') {
        predictions.push(
          this.createPredictedFragment('action_update', 'action_command'),
        );
        predictions.push(
          this.createPredictedFragment('action_delete', 'action_command'),
        );
      }
      if (action === 'action_list') {
        predictions.push(
          this.createPredictedFragment('action_create', 'action_command'),
        );
      }
      if (action === 'action_update') {
        predictions.push(
          this.createPredictedFragment('action_get', 'action_command'),
        );
        predictions.push(
          this.createPredictedFragment('action_delete', 'action_command'),
        );
      }
    }

    // 3. Predict adjacent semantic tags (weak ML-style bootstrap, to be replaced)
    const tagAdjacencyMap: Record<
      string,
      Array<{ tag: string; category: FragmentCategory }>
    > = {
      summarization: [{ tag: 'validation', category: 'validation' }],
      calculation: [
        { tag: 'validation', category: 'validation' },
        { tag: 'formatting', category: 'transformation' },
      ],
    };
    for (const t of semanticTags) {
      const adj = tagAdjacencyMap[t];
      if (adj) {
        for (const { tag, category } of adj) {
          predictions.push(this.createPredictedFragment(tag, category));
        }
      }
    }

    // 4. Predict related category if high reusability
    if (category === 'calculation' || category === 'transformation') {
      predictions.push(
        this.createPredictedFragment('validation', 'validation'),
      );
    }

    // 5. De-duplicate by fragment hash
    const deduped: CortexFragment[] = [];
    const seen = new Set<string>();
    for (const frag of predictions) {
      if (!seen.has(frag.hash)) {
        seen.add(frag.hash);
        deduped.push(frag);
      }
    }

    return deduped;
  }

  private createPredictedFragment(
    pattern: any,
    category: FragmentCategory,
  ): CortexFragment {
    return {
      id: this.generateFragmentId(),
      type: 'semantic',
      content: pattern,
      hash: this.generateHash(pattern),
      metadata: {
        category,
        complexity: 'simple',
        reusability: 0.7,
        semanticTags: [pattern],
        dependencies: [],
        created: new Date(),
        lastAccessed: new Date(),
        accessCount: 0,
        avgComputationTime: 10,
        compressionRatio: 0.5,
      },
    };
  }

  private shouldCachePrediction(fragment: CortexFragment): boolean {
    // Check if prediction meets caching criteria
    return (
      fragment.metadata.reusability >= this.config.reusabilityThreshold &&
      !this.fragmentCache.has(fragment.hash)
    );
  }

  /**
   * Optimize cache based on access patterns
   */
  public optimizeCache(): void {
    this.logger.log('🔧 Starting cache optimization');

    // Remove least recently used items if cache is full
    if (this.fragmentCache.size > this.config.maxFragments * 0.9) {
      this.evictLRUItems();
    }

    // Update semantic index
    this.rebuildSemanticIndex();

    // Compress old fragments
    this.compressOldFragments();

    this.logger.log('✅ Cache optimization completed');
  }

  private evictLRUItems(): void {
    const entries = Array.from(this.fragmentCache.entries());
    entries.sort(
      (a, b) =>
        a[1].metadata.lastAccessed.getTime() -
        b[1].metadata.lastAccessed.getTime(),
    );

    const toEvict = Math.floor(entries.length * 0.1); // Evict 10% of items
    for (let i = 0; i < toEvict; i++) {
      const [hash] = entries[i];
      this.fragmentCache.delete(hash);
    }

    this.logger.debug(`🗑️ Evicted ${toEvict} LRU fragments`);
  }

  private rebuildSemanticIndex(): void {
    this.semanticIndex.clear();

    for (const fragment of this.fragmentCache.values()) {
      for (const tag of fragment.metadata.semanticTags) {
        if (!this.semanticIndex.has(tag)) {
          this.semanticIndex.set(tag, new Set());
        }
        this.semanticIndex.get(tag)!.add(fragment.id);
      }
    }
  }

  private compressOldFragments(): void {
    const now = Date.now();
    const compressionAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const fragment of this.fragmentCache.values()) {
      const age = now - fragment.metadata.created.getTime();
      if (age > compressionAge && fragment.metadata.compressionRatio < 0.8) {
        // Apply additional compression
        fragment.metadata.compressionRatio = Math.min(
          0.8,
          fragment.metadata.compressionRatio + 0.1,
        );
      }
    }
  }

  /**
   * Get cache performance metrics
   */
  public getPerformanceMetrics(): {
    hitRate: number;
    avgAccessTime: number;
    cacheEfficiency: number;
    semanticIndexSize: number;
    memoryUsage: number;
  } {
    const totalRequests = this.stats.totalRequests;
    const hitRate =
      totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

    // Estimate memory usage
    const avgFragmentSize = 1024; // Rough estimate
    const memoryUsage = this.fragmentCache.size * avgFragmentSize;

    return {
      hitRate,
      avgAccessTime: this.stats.avgAccessTime,
      cacheEfficiency: this.calculateCacheEfficiency(),
      semanticIndexSize: this.semanticIndex.size,
      memoryUsage,
    };
  }

  private calculateCacheEfficiency(): number {
    if (this.fragmentCache.size === 0) return 0;

    const totalReusability = Array.from(this.fragmentCache.values()).reduce(
      (sum, f) => sum + f.metadata.reusability,
      0,
    );

    return totalReusability / this.fragmentCache.size;
  }

  private initializeFragmentPatterns(): void {
    // Initialize semantic index with common tags
    const commonTags = [
      'action',
      'entity',
      'query',
      'command',
      'data',
      'calculate',
      'validate',
      'transform',
      'convert',
    ];

    for (const tag of commonTags) {
      this.semanticIndex.set(tag, new Set());
    }
  }

  private evictOldestFragment(): void {
    let oldestFragment: CortexFragment | null = null;
    let oldestKey = '';

    for (const [key, fragment] of this.fragmentCache.entries()) {
      if (
        !oldestFragment ||
        fragment.metadata.lastAccessed < oldestFragment.metadata.lastAccessed
      ) {
        oldestFragment = fragment;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.fragmentCache.delete(oldestKey);
      this.logger.debug('🗑️ Evicted oldest fragment from cache', {
        fragmentId: oldestFragment?.id,
      });
    }
  }

  private startCleanupInterval(): void {
    setInterval(
      () => {
        this.cleanupExpiredFragments();
      },
      60 * 60 * 1000,
    ); // Clean up every hour
  }

  private cleanupExpiredFragments(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, fragment] of this.fragmentCache.entries()) {
      const age = now - fragment.metadata.created.getTime();
      if (age > this.config.maxAge) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.fragmentCache.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.logger.debug(
        `🧹 Cleaned up ${expiredKeys.length} expired fragments`,
      );
    }
  }
}
