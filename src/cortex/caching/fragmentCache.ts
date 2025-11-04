/**
 * Fragment-level Caching for Cortex
 * Caches individual reusable fragments of Cortex queries and responses
 */

import { CortexExpression, CortexFrame, CortexQuery } from '../types';
import { loggingService } from '../../services/logging.service';
import { cacheService } from '../../services/cache.service';
import * as crypto from 'crypto';

/**
 * Fragment types that can be cached
 */
export enum FragmentType {
  ENTITY_LOOKUP = 'entity_lookup',
  CALCULATION_RESULT = 'calculation_result',
  DATA_FETCH = 'data_fetch',
  TRANSFORMATION = 'transformation',
  AGGREGATION = 'aggregation',
  COMPARISON = 'comparison',
  SUMMARY = 'summary',
  CONTEXT = 'context'
}

/**
 * Cached fragment interface
 */
export interface CachedFragment {
  id: string;
  type: FragmentType;
  key: string;
  value: any;
  metadata: {
    hitCount: number;
    lastAccessed: Date;
    created: Date;
    ttl: number;
    size: number;
    dependencies?: string[];
  };
}

/**
 * Fragment identification result
 */
export interface FragmentIdentification {
  fragments: Array<{
    type: FragmentType;
    key: string;
    expression: CortexExpression;
    cacheable: boolean;
    ttl?: number;
  }>;
  dependencies: Map<string, string[]>;
}

/**
 * Fragment Cache Manager
 */
export class FragmentCacheManager {
  private readonly cachePrefix = 'cortex:fragment:';
  private readonly metadataPrefix = 'cortex:fragment:meta:';
  private fragmentStats = new Map<FragmentType, { hits: number; misses: number; savings: number }>();
  
  constructor() {
    this.initializeStats();
  }
  
  /**
   * Initialize statistics tracking
   */
  private initializeStats(): void {
    Object.values(FragmentType).forEach(type => {
      this.fragmentStats.set(type as FragmentType, { hits: 0, misses: 0, savings: 0 });
    });
  }
  
  /**
   * Identify cacheable fragments in a Cortex query
   */
  public identifyFragments(query: CortexQuery): FragmentIdentification {
    const fragments: FragmentIdentification['fragments'] = [];
    const dependencies = new Map<string, string[]>();
    
    // Use the query itself as the expression if no nested expression
    const expression = query.expression || query;
    this.traverseExpression(expression, (expr, path) => {
      const fragment = this.analyzeFragment(expr, path);
      if (fragment) {
        fragments.push(fragment);
        
        // Track dependencies
        if (fragment.expression && 'dependencies' in fragment.expression) {
          dependencies.set(fragment.key, fragment.expression.dependencies as string[]);
        }
      }
    });
    
    return { fragments, dependencies };
  }
  
  /**
   * Traverse expression tree to find fragments
   */
  private traverseExpression(
    expr: CortexExpression,
    callback: (expr: CortexExpression, path: string) => void,
    path: string = ''
  ): void {
    callback(expr, path);
    
    // Traverse nested structures
    if (expr.frames) {
      expr.frames.forEach((frame, index) => {
        this.traverseFrame(frame, callback, `${path}/frame[${index}]`);
      });
    }
    
    if (expr.metadata?.nested) {
      Object.entries(expr.metadata.nested).forEach(([key, nested]) => {
        this.traverseExpression(nested as CortexExpression, callback, `${path}/nested/${key}`);
      });
    }
  }
  
  /**
   * Traverse a frame
   */
  private traverseFrame(
    frame: CortexFrame,
    callback: (expr: CortexExpression, path: string) => void,
    path: string
  ): void {
    // Check if frame contains nested expressions
    Object.entries(frame).forEach(([key, value]) => {
      if (value && typeof value === 'object' && 'type' in value) {
        this.traverseExpression(value as CortexExpression, callback, `${path}/${key}`);
      }
    });
  }
  
  /**
   * Analyze a fragment to determine if it's cacheable
   */
  private analyzeFragment(
    expr: CortexExpression,
    _path: string
  ): FragmentIdentification['fragments'][0] | null {
    // Determine fragment type
    const type = this.determineFragmentType(expr);
    if (!type) return null;
    
    // Generate cache key
    const key = this.generateFragmentKey(expr, type);
    
    // Determine if cacheable
    const cacheable = this.isFragmentCacheable(expr, type);
    
    // Calculate TTL
    const ttl = this.calculateFragmentTTL(type, expr);
    
    return {
      type,
      key,
      expression: expr,
      cacheable,
      ttl
    };
  }
  
  /**
   * Determine fragment type from expression
   */
  private determineFragmentType(expr: CortexExpression): FragmentType | null {
    const frameType = expr.frames?.[0]?.type;
    
    if (frameType === 'entity' || frameType === 'lookup') {
      return FragmentType.ENTITY_LOOKUP;
    }
    
    if (frameType === 'calculate' || frameType === 'compute') {
      return FragmentType.CALCULATION_RESULT;
    }
    
    if (frameType === 'fetch' || frameType === 'query') {
      return FragmentType.DATA_FETCH;
    }
    
    if (frameType === 'transform' || frameType === 'convert') {
      return FragmentType.TRANSFORMATION;
    }
    
    if (frameType === 'aggregate' || frameType === 'reduce') {
      return FragmentType.AGGREGATION;
    }
    
    if (frameType === 'compare' || frameType === 'diff') {
      return FragmentType.COMPARISON;
    }
    
    if (frameType === 'summarize' || frameType === 'abstract') {
      return FragmentType.SUMMARY;
    }
    
    return null;
  }
  
  /**
   * Generate a unique key for a fragment
   */
  private generateFragmentKey(expr: CortexExpression, type: FragmentType): string {
    const content = JSON.stringify({
      type,
      frames: expr.frames,
      // Exclude volatile metadata
      staticMetadata: this.extractStaticMetadata(expr.metadata)
    });
    
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `${type}:${hash.substring(0, 16)}`;
  }
  
  /**
   * Extract only static metadata (exclude timestamps, etc.)
   */
  private extractStaticMetadata(metadata: any): any {
    if (!metadata) return {};
    
    const staticKeys = ['language', 'domain', 'version', 'schema'];
    const result: any = {};
    
    staticKeys.forEach(key => {
      if (metadata[key]) {
        result[key] = metadata[key];
      }
    });
    
    return result;
  }
  
  /**
   * Determine if a fragment is cacheable
   */
  private isFragmentCacheable(expr: CortexExpression, type: FragmentType): boolean {
    // Don't cache volatile or personal data
    if (expr.metadata?.volatile || expr.metadata?.personal) {
      return false;
    }
    
    // Don't cache if it has external dependencies
    if (expr.metadata?.externalDependencies) {
      return false;
    }
    
    // Cache based on type
    const cacheableTypes = [
      FragmentType.ENTITY_LOOKUP,
      FragmentType.CALCULATION_RESULT,
      FragmentType.TRANSFORMATION,
      FragmentType.AGGREGATION,
      FragmentType.COMPARISON
    ];
    
    return cacheableTypes.includes(type);
  }
  
  /**
   * Calculate TTL for a fragment
   */
  private calculateFragmentTTL(type: FragmentType, expr: CortexExpression): number {
    // Override TTL if specified in metadata
    if (expr.metadata?.ttl) {
      return expr.metadata.ttl;
    }
    
    // Default TTLs by type (in seconds)
    const ttlMap: Record<FragmentType, number> = {
      [FragmentType.ENTITY_LOOKUP]: 3600,      // 1 hour
      [FragmentType.CALCULATION_RESULT]: 86400, // 24 hours
      [FragmentType.DATA_FETCH]: 300,          // 5 minutes
      [FragmentType.TRANSFORMATION]: 7200,      // 2 hours
      [FragmentType.AGGREGATION]: 1800,        // 30 minutes
      [FragmentType.COMPARISON]: 3600,         // 1 hour
      [FragmentType.SUMMARY]: 1800,            // 30 minutes
      [FragmentType.CONTEXT]: 600              // 10 minutes
    };
    
    return ttlMap[type] || 1800;
  }
  
  /**
   * Get cached fragment
   */
  public async getFragment(key: string): Promise<CachedFragment | null> {
    try {
      const cacheKey = `${this.cachePrefix}${key}`;
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        // Update metadata
        await this.updateFragmentMetadata(key, 'hit');
        
        // Update stats
        const type = key.split(':')[0] as FragmentType;
        const stats = this.fragmentStats.get(type);
        if (stats) {
          stats.hits++;
        }
        
        return cached as CachedFragment;
      }
      
      // Update miss stats
      const type = key.split(':')[0] as FragmentType;
      const stats = this.fragmentStats.get(type);
      if (stats) {
        stats.misses++;
      }
      
      return null;
    } catch (error) {
      loggingService.error('Fragment cache get failed', { key, error });
      return null;
    }
  }
  
  /**
   * Set cached fragment
   */
  public async setFragment(
    key: string,
    value: any,
    type: FragmentType,
    ttl?: number
  ): Promise<void> {
    try {
      const cacheKey = `${this.cachePrefix}${key}`;
      const fragment: CachedFragment = {
        id: crypto.randomUUID(),
        type,
        key,
        value,
        metadata: {
          hitCount: 0,
          lastAccessed: new Date(),
          created: new Date(),
          ttl: ttl || this.calculateFragmentTTL(type, {} as CortexExpression),
          size: JSON.stringify(value).length
        }
      };
      
      await cacheService.set(cacheKey, fragment, fragment.metadata.ttl);
      
      // Store metadata separately for analytics
      await this.storeFragmentMetadata(key, fragment.metadata);
      
      loggingService.debug('Fragment cached', { key, type, ttl: fragment.metadata.ttl });
    } catch (error) {
      loggingService.error('Fragment cache set failed', { key, error });
    }
  }
  
  /**
   * Get multiple fragments
   */
  public async getFragments(keys: string[]): Promise<Map<string, CachedFragment>> {
    const results = new Map<string, CachedFragment>();
    
    // Batch get from cache
    const promises = keys.map(key => this.getFragment(key));
    const fragments = await Promise.all(promises);
    
    fragments.forEach((fragment, index) => {
      if (fragment) {
        results.set(keys[index], fragment);
      }
    });
    
    return results;
  }
  
  /**
   * Invalidate fragments based on dependencies
   */
  public async invalidateFragments(dependencies: string[]): Promise<void> {
    // Find all fragments that depend on these keys
    const keysToInvalidate = await this.findDependentFragments(dependencies);
    
    // Invalidate each fragment
    const promises = keysToInvalidate.map(key => 
      cacheService.delete(`${this.cachePrefix}${key}`)
    );
    
    await Promise.all(promises);
    
    loggingService.info('Fragments invalidated', { 
      dependencies, 
      invalidatedCount: keysToInvalidate.length 
    });
  }
  
  /**
   * Find fragments that depend on given keys
   */
  private async findDependentFragments(dependencies: string[]): Promise<string[]> {
    // Query metadata to find dependent fragments
    const dependentKeys: string[] = [];
    
    // Get all metadata keys from cache
    const pattern = `${this.metadataPrefix}*`;
    
    try {
      // Scan through all metadata entries to find dependencies
      // Note: In production, this should use a proper index or database
      const allKeys = await this.getAllCacheKeys(pattern);
      
      for (const metaKey of allKeys) {
        const metadata = await cacheService.get(metaKey) as any;
        
        if (metadata && metadata.dependencies) {
          // Check if this fragment depends on any of the given keys
          const hasDependency = dependencies.some(dep => 
            metadata.dependencies.includes(dep)
          );
          
          if (hasDependency) {
            // Extract the fragment key from the metadata key
            const fragmentKey = metaKey.replace(this.metadataPrefix, '');
            dependentKeys.push(fragmentKey);
          }
        }
      }
    } catch (error) {
      loggingService.warn('Failed to find dependent fragments', { error });
    }
    
    return dependentKeys;
  }
  
  /**
   * Get all cache keys matching a pattern
   */
  private async getAllCacheKeys(pattern: string): Promise<string[]> {
    // This is a simplified implementation
    // In production, use Redis SCAN or database query
    try {
      // For now, return an empty array as we don't have direct access to all cache keys
      // In a real implementation, this would use Redis SCAN command or similar
      return [];
    } catch (error) {
      loggingService.warn('Failed to get cache keys', { pattern, error });
      return [];
    }
  }
  
  /**
   * Update fragment metadata
   */
  private async updateFragmentMetadata(key: string, action: 'hit' | 'miss'): Promise<void> {
    const metaKey = `${this.metadataPrefix}${key}`;
    
    try {
      const metadata = await cacheService.get(metaKey) as any;
      if (metadata) {
        if (action === 'hit') {
          metadata.hitCount++;
          metadata.lastAccessed = new Date();
        }
        await cacheService.set(metaKey, metadata, metadata.ttl);
      }
    } catch (error) {
      // Ignore metadata update errors
    }
  }
  
  /**
   * Store fragment metadata
   */
  private async storeFragmentMetadata(key: string, metadata: any): Promise<void> {
    const metaKey = `${this.metadataPrefix}${key}`;
    await cacheService.set(metaKey, metadata, metadata.ttl);
  }
  
  /**
   * Get cache statistics
   */
  public getStatistics(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    this.fragmentStats.forEach((value, key) => {
      const hitRate = value.hits / (value.hits + value.misses) || 0;
      stats[key] = {
        ...value,
        hitRate: `${(hitRate * 100).toFixed(2)}%`
      };
    });
    
    // Calculate totals
    let totalHits = 0;
    let totalMisses = 0;
    let totalSavings = 0;
    
    this.fragmentStats.forEach(stat => {
      totalHits += stat.hits;
      totalMisses += stat.misses;
      totalSavings += stat.savings;
    });
    
    stats.total = {
      hits: totalHits,
      misses: totalMisses,
      hitRate: `${((totalHits / (totalHits + totalMisses)) * 100).toFixed(2)}%`,
      estimatedSavings: `$${totalSavings.toFixed(4)}`
    };
    
    return stats;
  }
  
  /**
   * Clear all fragment caches
   */
  public async clearAll(): Promise<void> {
    // This would clear all fragment caches
    // Implementation depends on cache service capabilities
    await cacheService.clear();
    this.initializeStats();
    loggingService.info('All fragment caches cleared');
  }
}
