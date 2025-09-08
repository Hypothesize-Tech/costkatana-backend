/**
 * Cortex Fragment Cache Service
 * 
 * Implements granular caching of individual, reusable Cortex query components
 * instead of full prompts. Provides higher cache hit rates by identifying 
 * and caching semantic fragments that can be composed into larger queries.
 */

import { CortexFrame, CortexValue, CortexFrameType } from '../types/cortex.types';
import { loggingService } from './logging.service';
import * as crypto from 'crypto';

// LRU Cache type definitions
interface LRUCacheOptions<K, V> {
    max: number;
    ttl?: number;
    updateAgeOnGet?: boolean;
    allowStale?: boolean;
}

interface LRUCacheInstance<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    clear(): void;
    size: number;
    values(): V[];
}

// Use any for LRU cache until proper types are available
const { LRUCache } = require('lru-cache');

// ============================================================================
// FRAGMENT CACHE TYPES
// ============================================================================

export interface CortexFragment {
    id: string;
    type: 'semantic' | 'structural' | 'computational' | 'temporal';
    content: CortexFrame | CortexValue;
    hash: string;
    metadata: {
        category: FragmentCategory;
        complexity: 'simple' | 'medium' | 'complex';
        reusability: number; // 0-1 score indicating how reusable this fragment is
        semanticTags: string[];
        dependencies: string[]; // IDs of other fragments this depends on
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
    coverageRatio: number; // 0-1 how much of the query is covered by fragments
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
    | 'entity_query'      // Queries about specific entities
    | 'action_command'    // Action execution commands
    | 'data_transform'    // Data transformation operations
    | 'calculation'       // Mathematical or logical calculations
    | 'validation'        // Data validation operations
    | 'format_conversion' // Format conversion operations
    | 'api_call'          // External API interactions
    | 'condition_check'   // Conditional logic checks
    | 'list_operation'    // List/array operations
    | 'string_operation'  // String manipulation operations
    | 'date_operation'    // Date/time operations
    | 'generic';          // General purpose fragments

export interface FragmentCacheConfig {
    maxFragments: number;
    maxAge: number; // milliseconds
    reusabilityThreshold: number; // minimum reusability score to cache
    compressionThreshold: number; // minimum compression ratio to cache
    semanticSimilarityThreshold: number; // for matching similar fragments
    enableComposition: boolean;
    enablePredictiveCaching: boolean;
    fragmentExtractionMode: 'aggressive' | 'balanced' | 'conservative';
}

// ============================================================================
// CORTEX FRAGMENT CACHE SERVICE
// ============================================================================

export class CortexFragmentCacheService {
    private static instance: CortexFragmentCacheService;
    private fragmentCache: LRUCacheInstance<string, CortexFragment>;
    private compositionCache: LRUCacheInstance<string, FragmentComposition>;
    private semanticIndex: Map<string, Set<string>>; // semantic tag -> fragment IDs
    private config: FragmentCacheConfig;

    private constructor() {
        this.config = {
            maxFragments: 10000,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            reusabilityThreshold: 0.3,
            compressionThreshold: 0.1,
            semanticSimilarityThreshold: 0.8,
            enableComposition: true,
            enablePredictiveCaching: true,
            fragmentExtractionMode: 'balanced'
        };

        this.fragmentCache = new LRUCache({
            max: this.config.maxFragments,
            ttl: this.config.maxAge,
            updateAgeOnGet: true,
            allowStale: false
        }) as LRUCacheInstance<string, CortexFragment>;

        this.compositionCache = new LRUCache({
            max: 1000,
            ttl: 60 * 60 * 1000, // 1 hour
            updateAgeOnGet: true
        }) as LRUCacheInstance<string, FragmentComposition>;

        this.semanticIndex = new Map();
        this.initializeFragmentPatterns();
    }

    public static getInstance(): CortexFragmentCacheService {
        if (!CortexFragmentCacheService.instance) {
            CortexFragmentCacheService.instance = new CortexFragmentCacheService();
        }
        return CortexFragmentCacheService.instance;
    }

    /**
     * Query fragment cache for a Cortex frame
     */
    public async queryFragmentCache(frame: CortexFrame): Promise<FragmentCacheResult> {
        const startTime = Date.now();
        
        try {
            // Generate composite key for the entire query
            const compositeKey = this.generateCompositeKey(frame);

            // Check for exact full query match
            const exactMatch = this.fragmentCache.get(compositeKey);
            if (exactMatch) {
                this.updateAccessMetrics(exactMatch);
                
                loggingService.info('🎯 Fragment cache exact hit', {
                    fragmentId: exactMatch.id,
                    category: exactMatch.metadata.category,
                    reusability: exactMatch.metadata.reusability
                });

                return {
                    hit: true,
                    fragment: exactMatch,
                    partialHits: [],
                    compositeKey,
                    metadata: {
                        hitRate: 1.0,
                        fragmentsFound: 1,
                        totalFragments: 1,
                        cacheTime: Date.now() - startTime,
                        compressionSavings: exactMatch.metadata.compressionRatio
                    }
                };
            }

            // Extract fragments from the query
            const extractionResult = this.extractQueryFragments(frame);
            const partialHits: CortexFragment[] = [];
            let totalFragments = extractionResult.fragments.length;
            let fragmentsFound = 0;

            // Check for partial matches
            for (const queryFragment of extractionResult.fragments) {
                const cachedFragment = this.findSimilarFragment(queryFragment);
                if (cachedFragment) {
                    partialHits.push(cachedFragment);
                    fragmentsFound++;
                    this.updateAccessMetrics(cachedFragment);
                }
            }

            const hitRate = totalFragments > 0 ? fragmentsFound / totalFragments : 0;
            const compressionSavings = partialHits.reduce((total, f) => total + f.metadata.compressionRatio, 0) / Math.max(1, partialHits.length);

            loggingService.info('🧩 Fragment cache partial hit', {
                hitRate: `${(hitRate * 100).toFixed(1)}%`,
                fragmentsFound,
                totalFragments,
                compressionSavings: `${(compressionSavings * 100).toFixed(1)}%`
            });

            return {
                hit: hitRate > 0,
                partialHits,
                compositeKey,
                metadata: {
                    hitRate,
                    fragmentsFound,
                    totalFragments,
                    cacheTime: Date.now() - startTime,
                    compressionSavings
                }
            };

        } catch (error) {
            loggingService.error('❌ Fragment cache query failed', {
                error: error instanceof Error ? error.message : String(error),
                frameType: frame.frameType
            });

            return {
                hit: false,
                partialHits: [],
                metadata: {
                    hitRate: 0,
                    fragmentsFound: 0,
                    totalFragments: 0,
                    cacheTime: Date.now() - startTime,
                    compressionSavings: 0
                }
            };
        }
    }

    /**
     * Cache fragments from a processed Cortex frame
     */
    public async cacheFragments(
        originalFrame: CortexFrame,
        processedFrame: CortexFrame,
        processingTime: number
    ): Promise<void> {
        try {
            // Extract cacheable fragments
            const extractionResult = this.extractQueryFragments(originalFrame);
            const cacheableFragments = extractionResult.fragments.filter(fragment =>
                fragment.metadata.reusability >= this.config.reusabilityThreshold
            );

            let cachedCount = 0;
            
            for (const fragment of cacheableFragments) {
                // Calculate compression ratio
                const originalSize = JSON.stringify(originalFrame).length;
                const fragmentSize = JSON.stringify(fragment.content).length;
                const compressionRatio = 1 - (fragmentSize / originalSize);

                if (compressionRatio >= this.config.compressionThreshold) {
                    // Update fragment with processing metadata
                    fragment.metadata.avgComputationTime = processingTime;
                    fragment.metadata.compressionRatio = compressionRatio;
                    fragment.metadata.created = new Date();
                    fragment.metadata.lastAccessed = new Date();
                    fragment.metadata.accessCount = 1;

                    // Cache the fragment
                    this.fragmentCache.set(fragment.id, fragment);
                    this.indexFragmentSemantics(fragment);
                    cachedCount++;

                    loggingService.debug('💾 Cached fragment', {
                        fragmentId: fragment.id,
                        category: fragment.metadata.category,
                        reusability: fragment.metadata.reusability,
                        compressionRatio
                    });
                }
            }

            // Cache the full query as a fragment if highly reusable
            const fullQueryReusability = this.calculateQueryReusability(originalFrame);
            if (fullQueryReusability >= this.config.reusabilityThreshold) {
                const fullQueryFragment = this.createFragmentFromQuery(originalFrame, processedFrame, processingTime);
                this.fragmentCache.set(fullQueryFragment.id, fullQueryFragment);
                this.indexFragmentSemantics(fullQueryFragment);
                cachedCount++;
            }

            loggingService.info('💾 Fragment caching completed', {
                totalFragments: extractionResult.fragments.length,
                cacheableFragments: cacheableFragments.length,
                actualyCached: cachedCount,
                cacheSize: this.fragmentCache.size
            });

        } catch (error) {
            loggingService.error('❌ Fragment caching failed', {
                error: error instanceof Error ? error.message : String(error),
                frameType: originalFrame.frameType
            });
        }
    }

    /**
     * Compose fragments into a complete response
     */
    public async composeFragments(cacheResult: FragmentCacheResult, originalFrame: CortexFrame): Promise<FragmentComposition | null> {
        if (!this.config.enableComposition || cacheResult.partialHits.length === 0) {
            return null;
        }

        try {
            const compositionKey = this.generateCompositionKey(cacheResult.partialHits, originalFrame);
            
            // Check composition cache
            const cachedComposition = this.compositionCache.get(compositionKey);
            if (cachedComposition) {
                loggingService.info('🔗 Fragment composition cache hit', {
                    fragmentCount: cachedComposition.fragments.length,
                    coverageRatio: cachedComposition.coverageRatio
                });
                return cachedComposition;
            }

            // Perform fragment composition
            const composition = await this.performFragmentComposition(cacheResult.partialHits, originalFrame);
            
            // Cache the composition
            this.compositionCache.set(compositionKey, composition);

            loggingService.info('🔗 Fragment composition completed', {
                fragmentCount: composition.fragments.length,
                missingParts: composition.missingParts.length,
                coverageRatio: `${(composition.coverageRatio * 100).toFixed(1)}%`,
                strategy: composition.compositionStrategy
            });

            return composition;

        } catch (error) {
            loggingService.error('❌ Fragment composition failed', {
                error: error instanceof Error ? error.message : String(error),
                fragmentCount: cacheResult.partialHits.length
            });
            return null;
        }
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(): {
        fragmentCacheSize: number;
        compositionCacheSize: number;
        hitRate: number;
        topCategories: Array<{ category: FragmentCategory; count: number }>;
        reusabilityDistribution: Record<string, number>;
    } {
        const fragments = Array.from(this.fragmentCache.values()) as CortexFragment[];
        
        // Calculate hit rate from access patterns
        const totalAccesses = fragments.reduce((sum, f) => sum + (f as CortexFragment).metadata.accessCount, 0);
        const hitRate = totalAccesses > 0 ? fragments.length / totalAccesses : 0;

        // Category distribution
        const categoryCount = new Map<FragmentCategory, number>();
        fragments.forEach(f => {
            const fragment = f as CortexFragment;
            const count = categoryCount.get(fragment.metadata.category) || 0;
            categoryCount.set(fragment.metadata.category, count + 1);
        });

        const topCategories = Array.from(categoryCount.entries())
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Reusability distribution
        const reusabilityDistribution: Record<string, number> = {};
        fragments.forEach(f => {
            const fragment = f as CortexFragment;
            const bucket = Math.floor(fragment.metadata.reusability * 10) / 10;
            const key = `${bucket}-${bucket + 0.1}`;
            reusabilityDistribution[key] = (reusabilityDistribution[key] || 0) + 1;
        });

        return {
            fragmentCacheSize: this.fragmentCache.size,
            compositionCacheSize: this.compositionCache.size,
            hitRate,
            topCategories,
            reusabilityDistribution
        };
    }

    /**
     * Clear fragment cache
     */
    public clearCache(): void {
        this.fragmentCache.clear();
        this.compositionCache.clear();
        this.semanticIndex.clear();
        loggingService.info('🧹 Fragment cache cleared');
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private extractQueryFragments(frame: CortexFrame): FragmentExtractionResult {
        const startTime = Date.now();
        const fragments: CortexFragment[] = [];

        // Strategy 1: Structural decomposition
        fragments.push(...this.extractStructuralFragments(frame));

        // Strategy 2: Semantic pattern matching
        fragments.push(...this.extractSemanticFragments(frame));

        // Strategy 3: Computational component extraction
        fragments.push(...this.extractComputationalFragments(frame));

        // Calculate reusability scores
        fragments.forEach(fragment => {
            fragment.metadata.reusability = this.calculateFragmentReusability(fragment);
            fragment.metadata.complexity = this.assessFragmentComplexity(fragment);
        });

        return {
            fragments,
            extractionStrategy: 'structural',
            metadata: {
                originalComplexity: this.calculateFrameComplexity(frame),
                fragmentCount: fragments.length,
                reusabilityScore: fragments.reduce((sum, f) => sum + f.metadata.reusability, 0) / fragments.length,
                extractionTime: Date.now() - startTime,
                potentialCacheable: fragments.filter(f => f.metadata.reusability >= this.config.reusabilityThreshold).length
            }
        };
    }

    private extractStructuralFragments(frame: CortexFrame): CortexFragment[] {
        const fragments: CortexFragment[] = [];

        // Extract role-based fragments
        for (const [roleKey, value] of Object.entries(frame)) {
            if (roleKey === 'frameType') continue;

            const fragmentId = this.generateFragmentId('structural', roleKey, value);
            const category = this.categorizeFragment(roleKey, value);
            
                    fragments.push({
            id: fragmentId,
            type: 'structural',
            content: { [roleKey]: value } as CortexFrame,
            hash: this.generateContentHash({ [roleKey]: value }),
                metadata: {
                    category,
                    complexity: 'simple',
                    reusability: 0,
                    semanticTags: this.generateSemanticTags(roleKey, value),
                    dependencies: [],
                    created: new Date(),
                    lastAccessed: new Date(),
                    accessCount: 0,
                    avgComputationTime: 0,
                    compressionRatio: 0
                }
            });
        }

        return fragments;
    }

    private extractSemanticFragments(frame: CortexFrame): CortexFragment[] {
        const fragments: CortexFragment[] = [];

        // Entity-centric fragments
        const entityFragment = this.extractEntityFragment(frame);
        if (entityFragment) fragments.push(entityFragment);

        // Action-centric fragments  
        const actionFragment = this.extractActionFragment(frame);
        if (actionFragment) fragments.push(actionFragment);

        // Condition-centric fragments
        const conditionFragment = this.extractConditionFragment(frame);
        if (conditionFragment) fragments.push(conditionFragment);

        return fragments;
    }

    private extractComputationalFragments(frame: CortexFrame): CortexFragment[] {
        const fragments: CortexFragment[] = [];

        // Look for computational patterns
        for (const [key, value] of Object.entries(frame)) {
            if (this.isComputationalFragment(key, value)) {
                const fragmentId = this.generateFragmentId('computational', key, value);
                
                fragments.push({
                    id: fragmentId,
                    type: 'computational',
                    content: { [key]: value } as CortexFrame,
                    hash: this.generateContentHash({ [key]: value }),
                    metadata: {
                        category: this.categorizeFragment(key, value),
                        complexity: 'medium',
                        reusability: 0.8, // Computational fragments are typically highly reusable
                        semanticTags: this.generateSemanticTags(key, value),
                        dependencies: [],
                        created: new Date(),
                        lastAccessed: new Date(),
                        accessCount: 0,
                        avgComputationTime: 0,
                        compressionRatio: 0
                    }
                });
            }
        }

        return fragments;
    }

    private findSimilarFragment(queryFragment: CortexFragment): CortexFragment | null {
        // First try exact hash match
        const exactMatch = this.fragmentCache.get(queryFragment.id);
        if (exactMatch) return exactMatch;

        // Then try semantic similarity matching
        const candidates = this.findSemanticCandidates(queryFragment);
        
        for (const candidateId of candidates) {
            const candidate = this.fragmentCache.get(candidateId);
            if (candidate && this.calculateSemanticSimilarity(queryFragment, candidate) >= this.config.semanticSimilarityThreshold) {
                return candidate;
            }
        }

        return null;
    }

    private findSemanticCandidates(fragment: CortexFragment): Set<string> {
        const candidates = new Set<string>();

        // Find fragments with overlapping semantic tags
        for (const tag of fragment.metadata.semanticTags) {
            const taggedFragments = this.semanticIndex.get(tag);
            if (taggedFragments) {
                taggedFragments.forEach(id => candidates.add(id));
            }
        }

        return candidates;
    }

    private calculateSemanticSimilarity(fragment1: CortexFragment, fragment2: CortexFragment): number {
        // Tag overlap similarity
        const tags1 = new Set(fragment1.metadata.semanticTags);
        const tags2 = new Set(fragment2.metadata.semanticTags);
        const intersection = new Set([...tags1].filter(tag => tags2.has(tag)));
        const union = new Set([...tags1, ...tags2]);
        
        const tagSimilarity = intersection.size / union.size;

        // Category similarity
        const categorySimilarity = fragment1.metadata.category === fragment2.metadata.category ? 1 : 0;

        // Content similarity (simplified)
        const contentSimilarity = this.calculateContentSimilarity(fragment1.content, fragment2.content);

        // Weighted average
        return (tagSimilarity * 0.4) + (categorySimilarity * 0.3) + (contentSimilarity * 0.3);
    }

    private calculateContentSimilarity(content1: any, content2: any): number {
        const str1 = JSON.stringify(content1);
        const str2 = JSON.stringify(content2);
        
        if (str1 === str2) return 1.0;
        
        // Simple string similarity (could be enhanced with more sophisticated algorithms)
        const maxLength = Math.max(str1.length, str2.length);
        if (maxLength === 0) return 1.0;
        
        const distance = this.levenshteinDistance(str1, str2);
        return 1 - (distance / maxLength);
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion  
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    private async performFragmentComposition(fragments: CortexFragment[], originalFrame: CortexFrame): Promise<FragmentComposition> {
        // Analyze coverage
        const coverageAnalysis = this.analyzeCoverage(fragments, originalFrame);
        
        // Determine composition strategy
        const strategy = this.determineCompositionStrategy(fragments, originalFrame);
        
        // Reconstruct query
        const reconstructedQuery = this.reconstructQuery(fragments, originalFrame, strategy);
        
        return {
            fragments,
            missingParts: coverageAnalysis.missingParts,
            coverageRatio: coverageAnalysis.ratio,
            reconstructedQuery,
            compositionStrategy: strategy
        };
    }

    private analyzeCoverage(fragments: CortexFragment[], originalFrame: CortexFrame): {
        ratio: number;
        missingParts: CortexFrame[];
    } {
        const originalKeys = new Set(Object.keys(originalFrame));
        const coveredKeys = new Set<string>();

        // Collect all keys covered by fragments
        fragments.forEach(fragment => {
            if (typeof fragment.content === 'object' && fragment.content !== null) {
                Object.keys(fragment.content).forEach(key => coveredKeys.add(key));
            }
        });

        const coverage = coveredKeys.size / originalKeys.size;
        const missingKeys = [...originalKeys].filter(key => !coveredKeys.has(key));
        
        const missingParts = missingKeys.length > 0 ? [{
            frameType: originalFrame.frameType,
            ...Object.fromEntries(missingKeys.map(key => [key, (originalFrame as any)[key]]))
        } as CortexFrame] : [];

        return {
            ratio: coverage,
            missingParts
        };
    }

    private determineCompositionStrategy(fragments: CortexFragment[], originalFrame: CortexFrame): 'merge' | 'overlay' | 'sequence' | 'conditional' {
        // Simple heuristic - can be enhanced with ML
        if (fragments.length === 1) return 'merge';
        if (fragments.some(f => f.metadata.category === 'condition_check')) return 'conditional';
        if (fragments.some(f => f.type === 'temporal')) return 'sequence';
        return 'overlay';
    }

    private reconstructQuery(fragments: CortexFragment[], originalFrame: CortexFrame, strategy: string): CortexFrame {
        let reconstructed: any = { frameType: originalFrame.frameType };

        switch (strategy) {
            case 'merge':
                fragments.forEach(fragment => {
                    if (typeof fragment.content === 'object') {
                        reconstructed = { ...reconstructed, ...fragment.content };
                    }
                });
                break;
            
            case 'overlay':
                // Overlay fragments with priority (later fragments override earlier ones)
                fragments.forEach(fragment => {
                    if (typeof fragment.content === 'object') {
                        reconstructed = { ...reconstructed, ...fragment.content };
                    }
                });
                break;
            
            default:
                reconstructed = originalFrame;
        }

        return reconstructed as CortexFrame;
    }

    private generateFragmentId(type: string, key: string, value: any): string {
        const content = { [key]: value };
        const hash = this.generateContentHash(content);
        return `${type}_${hash.substring(0, 8)}`;
    }

    private generateContentHash(content: any): string {
        return crypto.createHash('sha256')
            .update(JSON.stringify(content, Object.keys(content).sort()))
            .digest('hex');
    }

    private generateCompositeKey(frame: CortexFrame): string {
        return this.generateContentHash(frame);
    }

    private generateCompositionKey(fragments: CortexFragment[], originalFrame: CortexFrame): string {
        const fragmentIds = fragments.map(f => f.id).sort().join('|');
        const originalHash = this.generateContentHash(originalFrame);
        return crypto.createHash('md5').update(`${fragmentIds}:${originalHash}`).digest('hex');
    }

    private categorizeFragment(key: string, value: any): FragmentCategory {
        const keyLower = key.toLowerCase();
        
        if (keyLower.includes('entity') || keyLower.includes('name')) return 'entity_query';
        if (keyLower.includes('action') || keyLower.includes('command')) return 'action_command';
        if (keyLower.includes('calculate') || keyLower.includes('compute')) return 'calculation';
        if (keyLower.includes('validate') || keyLower.includes('check')) return 'validation';
        if (keyLower.includes('format') || keyLower.includes('convert')) return 'format_conversion';
        if (keyLower.includes('api') || keyLower.includes('call')) return 'api_call';
        if (keyLower.includes('condition') || keyLower.includes('if')) return 'condition_check';
        if (keyLower.includes('list') || keyLower.includes('array')) return 'list_operation';
        if (keyLower.includes('string') || keyLower.includes('text')) return 'string_operation';
        if (keyLower.includes('date') || keyLower.includes('time')) return 'date_operation';
        
        return 'generic';
    }

    private generateSemanticTags(key: string, value: any): string[] {
        const tags: string[] = [];
        
        // Key-based tags
        tags.push(`key:${key}`);
        
        // Value-based tags
        if (typeof value === 'string') {
            if (value.includes('@')) tags.push('email');
            if (value.startsWith('http')) tags.push('url');
            if (/^\d+$/.test(value)) tags.push('numeric');
        }
        
        // Semantic extraction (simplified)
        const valueStr = String(value).toLowerCase();
        if (valueStr.includes('user')) tags.push('user-related');
        if (valueStr.includes('data')) tags.push('data-related');
        if (valueStr.includes('calculate')) tags.push('computational');
        
        return tags;
    }

    private calculateFragmentReusability(fragment: CortexFragment): number {
        let score = 0.5; // Base reusability
        
        // Category-based scoring
        const categoryScores: Record<FragmentCategory, number> = {
            'calculation': 0.9,
            'validation': 0.8,
            'format_conversion': 0.8,
            'string_operation': 0.7,
            'date_operation': 0.7,
            'api_call': 0.6,
            'condition_check': 0.6,
            'list_operation': 0.5,
            'data_transform': 0.5,
            'entity_query': 0.4,
            'action_command': 0.3,
            'generic': 0.2
        };
        
        score = categoryScores[fragment.metadata.category] || 0.2;
        
        // Adjust based on semantic tags
        const reusableTags = ['computational', 'validation', 'format'];
        const tagBonus = fragment.metadata.semanticTags.filter(tag => 
            reusableTags.some(rt => tag.includes(rt))
        ).length * 0.1;
        
        return Math.min(1.0, score + tagBonus);
    }

    private calculateQueryReusability(frame: CortexFrame): number {
        // Simplified query-level reusability assessment
        const roles = Object.keys(frame).filter(k => k !== 'frameType');
        
        let reusability = 0.3; // Base score
        
        // Higher reusability for computational frames
        if (roles.some(r => r.includes('calculate') || r.includes('compute'))) {
            reusability += 0.3;
        }
        
        // Lower reusability for very specific queries
        if (roles.some(r => String((frame as any)[r]).includes('specific'))) {
            reusability -= 0.2;
        }
        
        return Math.max(0, Math.min(1.0, reusability));
    }

    private assessFragmentComplexity(fragment: CortexFragment): 'simple' | 'medium' | 'complex' {
        const contentSize = JSON.stringify(fragment.content).length;
        const tagCount = fragment.metadata.semanticTags.length;
        
        if (contentSize < 100 && tagCount < 3) return 'simple';
        if (contentSize < 500 && tagCount < 8) return 'medium';
        return 'complex';
    }

    private calculateFrameComplexity(frame: CortexFrame): number {
        const roles = Object.keys(frame).filter(k => k !== 'frameType');
        const contentSize = JSON.stringify(frame).length;
        
        return roles.length * 0.3 + (contentSize / 1000) * 0.7;
    }

    private isComputationalFragment(key: string, value: any): boolean {
        const computationalKeywords = ['calculate', 'compute', 'sum', 'total', 'average', 'count', 'validate', 'format', 'convert'];
        return computationalKeywords.some(keyword => key.toLowerCase().includes(keyword));
    }

    private extractEntityFragment(frame: CortexFrame): CortexFragment | null {
        const entityKeys = Object.keys(frame).filter(k => 
            k.includes('entity') || k.includes('name') || k.includes('id')
        );
        
        if (entityKeys.length === 0) return null;
        
        const content = Object.fromEntries(entityKeys.map(k => [k, (frame as any)[k]]));
        
        return {
            id: this.generateFragmentId('semantic', 'entity', content),
            type: 'semantic',
            content: content as CortexFrame,
            hash: this.generateContentHash(content),
            metadata: {
                category: 'entity_query',
                complexity: 'simple',
                reusability: 0.4,
                semanticTags: ['entity', 'identifier'],
                dependencies: [],
                created: new Date(),
                lastAccessed: new Date(),
                accessCount: 0,
                avgComputationTime: 0,
                compressionRatio: 0
            }
        };
    }

    private extractActionFragment(frame: CortexFrame): CortexFragment | null {
        const actionKeys = Object.keys(frame).filter(k => 
            k.includes('action') || k.includes('command') || k.includes('operation')
        );
        
        if (actionKeys.length === 0) return null;
        
        const content = Object.fromEntries(actionKeys.map(k => [k, (frame as any)[k]]));
        
        return {
            id: this.generateFragmentId('semantic', 'action', content),
            type: 'semantic',
            content: content as CortexFrame,
            hash: this.generateContentHash(content),
            metadata: {
                category: 'action_command',
                complexity: 'medium',
                reusability: 0.3,
                semanticTags: ['action', 'command'],
                dependencies: [],
                created: new Date(),
                lastAccessed: new Date(),
                accessCount: 0,
                avgComputationTime: 0,
                compressionRatio: 0
            }
        };
    }

    private extractConditionFragment(frame: CortexFrame): CortexFragment | null {
        const conditionKeys = Object.keys(frame).filter(k => 
            k.includes('condition') || k.includes('if') || k.includes('when')
        );
        
        if (conditionKeys.length === 0) return null;
        
        const content = Object.fromEntries(conditionKeys.map(k => [k, (frame as any)[k]]));
        
        return {
            id: this.generateFragmentId('semantic', 'condition', content),
            type: 'semantic',
            content: content as CortexFrame,
            hash: this.generateContentHash(content),
            metadata: {
                category: 'condition_check',
                complexity: 'medium',
                reusability: 0.6,
                semanticTags: ['condition', 'logic'],
                dependencies: [],
                created: new Date(),
                lastAccessed: new Date(),
                accessCount: 0,
                avgComputationTime: 0,
                compressionRatio: 0
            }
        };
    }

    private createFragmentFromQuery(originalFrame: CortexFrame, processedFrame: CortexFrame, processingTime: number): CortexFragment {
        const fragmentId = this.generateCompositeKey(originalFrame);
        
        return {
            id: fragmentId,
            type: 'semantic',
            content: processedFrame,
            hash: this.generateContentHash(originalFrame),
            metadata: {
                category: 'generic',
                complexity: this.assessFrameComplexity(originalFrame),
                reusability: this.calculateQueryReusability(originalFrame),
                semanticTags: this.generateQuerySemanticTags(originalFrame),
                dependencies: [],
                created: new Date(),
                lastAccessed: new Date(),
                accessCount: 1,
                avgComputationTime: processingTime,
                compressionRatio: this.calculateQueryCompressionRatio(originalFrame, processedFrame)
            }
        };
    }

    private assessFrameComplexity(frame: CortexFrame): 'simple' | 'medium' | 'complex' {
        const complexity = this.calculateFrameComplexity(frame);
        if (complexity < 1) return 'simple';
        if (complexity < 3) return 'medium';
        return 'complex';
    }

    private generateQuerySemanticTags(frame: CortexFrame): string[] {
        const tags = [`frame:${frame.frameType}`];
        
        Object.keys(frame).forEach(key => {
            if (key !== 'frameType') {
                tags.push(`role:${key}`);
            }
        });
        
        return tags;
    }

    private calculateQueryCompressionRatio(originalFrame: CortexFrame, processedFrame: CortexFrame): number {
        const originalSize = JSON.stringify(originalFrame).length;
        const processedSize = JSON.stringify(processedFrame).length;
        
        if (originalSize === 0) return 0;
        return Math.max(0, (originalSize - processedSize) / originalSize);
    }

    private updateAccessMetrics(fragment: CortexFragment): void {
        fragment.metadata.lastAccessed = new Date();
        fragment.metadata.accessCount++;
    }

    private indexFragmentSemantics(fragment: CortexFragment): void {
        fragment.metadata.semanticTags.forEach(tag => {
            if (!this.semanticIndex.has(tag)) {
                this.semanticIndex.set(tag, new Set());
            }
            this.semanticIndex.get(tag)!.add(fragment.id);
        });
    }

    private initializeFragmentPatterns(): void {
        loggingService.info('🧩 Fragment cache initialized', {
            maxFragments: this.config.maxFragments,
            maxAge: `${this.config.maxAge / 1000}s`,
            reusabilityThreshold: this.config.reusabilityThreshold,
            extractionMode: this.config.fragmentExtractionMode
        });
    }
}
