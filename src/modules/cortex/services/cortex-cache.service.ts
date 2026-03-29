/**
 * Cortex Cache Service
 *
 * Provides intelligent caching for Cortex processing results, semantic frames,
 * and optimization outcomes. Implements semantic-aware caching with TTL
 * and dependency tracking.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CortexValue } from '../types/cortex.types';

export interface CacheEntry {
  key: string;
  value: CortexValue;
  metadata: {
    createdAt: Date;
    lastAccessed: Date;
    accessCount: number;
    size: number;
    ttl: number;
    type: 'encoding' | 'processing' | 'decoding' | 'fragment';
  };
  semanticHash: string;
  dependencies: string[];
  tags: string[];
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  averageAccessTime: number;
  evictionCount: number;
  semanticMatches: number;
}

export interface CacheQuery {
  type?: 'encoding' | 'processing' | 'decoding' | 'fragment';
  tags?: string[];
  semanticSimilarity?: number;
  maxAge?: number;
  limit?: number;
}

@Injectable()
export class CortexCacheService {
  private readonly logger = new Logger(CortexCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly semanticIndex = new Map<string, string[]>();
  private readonly tagIndex = new Map<string, string[]>();
  private readonly accessStats = new Map<
    string,
    { hits: number; misses: number; totalTime: number }
  >();

  private stats: CacheStats = {
    totalEntries: 0,
    totalSize: 0,
    hitRate: 0,
    missRate: 0,
    averageAccessTime: 0,
    evictionCount: 0,
    semanticMatches: 0,
  };

  private readonly MAX_CACHE_SIZE = 10000;
  private readonly DEFAULT_TTL = 3600000; // 1 hour

  /**
   * Store a value in the cache
   */
  set(
    key: string,
    value: CortexValue,
    options: {
      ttl?: number;
      type?: 'encoding' | 'processing' | 'decoding' | 'fragment';
      dependencies?: string[];
      tags?: string[];
      semanticHash?: string;
    } = {},
  ): void {
    const entry: CacheEntry = {
      key,
      value,
      metadata: {
        createdAt: new Date(),
        lastAccessed: new Date(),
        accessCount: 0,
        size: this.calculateSize(value),
        ttl: options.ttl || this.DEFAULT_TTL,
        type: options.type || 'fragment',
      },
      semanticHash: options.semanticHash || this.generateSemanticHash(value),
      dependencies: options.dependencies || [],
      tags: options.tags || [],
    };

    // Check cache size limits
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictEntries();
    }

    // Remove existing entry if it exists
    this.delete(key);

    // Store new entry
    this.cache.set(key, entry);

    // Update indexes
    this.updateSemanticIndex(entry);
    this.updateTagIndex(entry);

    // Update stats
    this.stats.totalEntries = this.cache.size;
    this.stats.totalSize += entry.metadata.size;

    this.logger.debug(`Cached entry: ${key} (${entry.metadata.size} bytes)`);
  }

  /**
   * Retrieve a value from the cache
   */
  get(key: string): CortexValue | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.recordAccess(key, false);
      return null;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.delete(key);
      this.recordAccess(key, false);
      return null;
    }

    // Update access metadata
    entry.metadata.lastAccessed = new Date();
    entry.metadata.accessCount++;

    this.recordAccess(key, true);
    return entry.value;
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    return entry != null && !this.isExpired(entry);
  }

  /**
   * Delete an entry from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Update stats
    this.stats.totalSize -= entry.metadata.size;

    // Remove from indexes
    this.removeFromSemanticIndex(entry);
    this.removeFromTagIndex(entry);

    // Remove from cache
    this.cache.delete(key);

    this.stats.totalEntries = this.cache.size;
    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.semanticIndex.clear();
    this.tagIndex.clear();
    this.accessStats.clear();

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hitRate: 0,
      missRate: 0,
      averageAccessTime: 0,
      evictionCount: 0,
      semanticMatches: 0,
    };

    this.logger.log('Cache cleared');
  }

  /**
   * Semantic hash for a natural-language prompt (used for cache keys and similarity).
   * Prefer passing this as `semanticHash` when `set()` stores optimization results so
   * lookups align with the original user text, not the cached object blob.
   */
  getSemanticHashForText(text: string): string {
    return this.generateSemanticHash(text);
  }

  /**
   * Find entries by semantic similarity (same index bucket as targetHash)
   */
  findBySemanticSimilarity(
    targetHash: string,
    threshold: number = 0.8,
    limit: number = 10,
  ): CacheEntry[] {
    const candidates = this.semanticIndex.get(targetHash) || [];
    const similar: Array<{ entry: CacheEntry; similarity: number }> = [];

    for (const key of candidates) {
      const entry = this.cache.get(key);
      if (!entry || this.isExpired(entry)) continue;

      const similarity = this.calculateSemanticSimilarity(
        targetHash,
        entry.semanticHash,
      );
      if (similarity >= threshold) {
        similar.push({ entry, similarity });
      }
    }

    // Sort by similarity and return top matches
    similar.sort((a, b) => b.similarity - a.similarity);

    const results = similar.slice(0, limit).map((item) => item.entry);
    this.stats.semanticMatches += results.length;

    return results;
  }

  /**
   * Scan all non-expired entries and rank by semantic hash similarity.
   * Used after an exact key miss for near-duplicate prompts (paraphrases).
   */
  findAcrossSemanticSimilarity(
    targetHash: string,
    threshold: number = 0.82,
    limit: number = 5,
  ): CacheEntry[] {
    const similar: Array<{ entry: CacheEntry; similarity: number }> = [];
    for (const entry of this.cache.values()) {
      if (this.isExpired(entry)) continue;
      const similarity = this.calculateSemanticSimilarity(
        targetHash,
        entry.semanticHash,
      );
      if (similarity >= threshold) {
        similar.push({ entry, similarity });
      }
    }
    similar.sort((a, b) => b.similarity - a.similarity);
    const results = similar.slice(0, limit).map((s) => s.entry);
    if (results.length > 0) {
      this.stats.semanticMatches += results.length;
    }
    return results;
  }

  /**
   * Query cache entries
   */
  query(query: CacheQuery): CacheEntry[] {
    let candidates = Array.from(this.cache.values());

    // Filter by type
    if (query.type) {
      candidates = candidates.filter(
        (entry) => entry.metadata.type === query.type,
      );
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      candidates = candidates.filter((entry) =>
        query.tags!.every((tag) => entry.tags.includes(tag)),
      );
    }

    // Filter by age
    if (query.maxAge) {
      const cutoff = new Date(Date.now() - query.maxAge);
      candidates = candidates.filter(
        (entry) => entry.metadata.createdAt >= cutoff,
      );
    }

    // Filter out expired entries
    candidates = candidates.filter((entry) => !this.isExpired(entry));

    // Sort by relevance (most recently accessed first)
    candidates.sort(
      (a, b) =>
        b.metadata.lastAccessed.getTime() - a.metadata.lastAccessed.getTime(),
    );

    return query.limit ? candidates.slice(0, query.limit) : candidates;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Preload frequently used entries
   */
  async preload(
    entries: Array<{ key: string; value: CortexValue; options?: any }>,
  ): Promise<void> {
    for (const entry of entries) {
      this.set(entry.key, entry.value, entry.options);
    }

    this.logger.log(`Preloaded ${entries.length} cache entries`);
  }

  /**
   * Invalidate entries based on dependencies
   */
  invalidateByDependency(dependencyKey: string): number {
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (entry.dependencies.includes(dependencyKey)) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.delete(key);
    }

    if (toDelete.length > 0) {
      this.logger.log(
        `Invalidated ${toDelete.length} entries due to dependency: ${dependencyKey}`,
      );
    }

    return toDelete.length;
  }

  /**
   * Get cache size in bytes
   */
  getSize(): number {
    return this.stats.totalSize;
  }

  /**
   * Get number of entries
   */
  getEntryCount(): number {
    return this.stats.totalEntries;
  }

  // Private methods

  private calculateSize(value: CortexValue): number {
    // Rough size estimation
    const str = JSON.stringify(value);
    return str.length * 2; // UTF-16 encoding
  }

  private generateSemanticHash(value: CortexValue): string {
    // Enhanced semantic hashing with content normalization and semantic clustering
    const normalized = this.normalizeForSemanticHash(value);
    const semanticFingerprint = this.generateSemanticFingerprint(normalized);

    // Use djb2 hash with semantic fingerprint
    let hash = 5381;
    for (let i = 0; i < semanticFingerprint.length; i++) {
      const char = semanticFingerprint.charCodeAt(i);
      hash = (hash * 33) ^ char; // djb2 algorithm
    }

    // Return positive hash as base36 string
    return Math.abs(hash).toString(36);
  }

  private normalizeForSemanticHash(value: CortexValue): string {
    // Normalize content for semantic comparison
    if (typeof value === 'string') {
      return value
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[^\w\s]/g, ''); // Remove punctuation
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.normalizeForSemanticHash(item))
        .sort()
        .join('|');
    }

    if (typeof value === 'object' && value !== null) {
      // Sort object keys for consistent hashing
      const sortedEntries = Object.entries(value)
        .filter(([key]) => key !== 'timestamp' && key !== 'id') // Exclude volatile fields
        .sort(([a], [b]) => a.localeCompare(b));

      return sortedEntries
        .map(([key, val]) => `${key}:${this.normalizeForSemanticHash(val)}`)
        .join(';');
    }

    return String(value).toLowerCase();
  }

  private generateSemanticFingerprint(content: string): string {
    // Generate semantic fingerprint by extracting key terms and patterns
    const words = content.split(/\s+/).filter((word) => word.length > 2);

    // Extract key semantic elements
    const keyTerms = words
      .filter((word) => !this.isStopWord(word) && word.length > 3)
      .slice(0, 10); // Take top 10 key terms

    // Add structural patterns
    const hasNumbers = /\d/.test(content);
    const hasQuestions = /\?/.test(content);
    const hasLists = /(\d+\.|[-*•])/.test(content);
    const wordCount = words.length;
    const avgWordLength =
      words.reduce((sum, word) => sum + word.length, 0) /
      Math.max(1, words.length);

    // Create fingerprint combining key terms and structural features
    const fingerprint = [
      ...keyTerms,
      hasNumbers ? 'has_numbers' : '',
      hasQuestions ? 'has_questions' : '',
      hasLists ? 'has_lists' : '',
      `wc_${Math.floor(wordCount / 10) * 10}`, // Word count bucket
      `awl_${Math.floor(avgWordLength)}`, // Average word length
    ]
      .filter(Boolean)
      .join('|');

    return fingerprint;
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'this',
      'that',
      'these',
      'those',
      'a',
      'an',
      'as',
      'if',
      'it',
      'its',
      'they',
      'them',
    ]);

    return stopWords.has(word.toLowerCase());
  }

  private isExpired(entry: CacheEntry): boolean {
    const now = Date.now();
    const expiresAt = entry.metadata.createdAt.getTime() + entry.metadata.ttl;
    return now > expiresAt;
  }

  private evictEntries(): void {
    // Simple LRU eviction
    const entries = Array.from(this.cache.entries());

    // Sort by last accessed (oldest first)
    entries.sort(
      (a, b) =>
        a[1].metadata.lastAccessed.getTime() -
        b[1].metadata.lastAccessed.getTime(),
    );

    // Remove oldest entries until we're under the limit
    const toRemove = Math.max(0, entries.length - this.MAX_CACHE_SIZE + 100); // Remove 100 extra to avoid frequent evictions

    for (let i = 0; i < toRemove && i < entries.length; i++) {
      const [key] = entries[i];
      this.delete(key);
      this.stats.evictionCount++;
    }

    this.logger.debug(`Evicted ${toRemove} cache entries`);
  }

  private updateSemanticIndex(entry: CacheEntry): void {
    const keys = this.semanticIndex.get(entry.semanticHash) || [];
    if (!keys.includes(entry.key)) {
      keys.push(entry.key);
      this.semanticIndex.set(entry.semanticHash, keys);
    }
  }

  private updateTagIndex(entry: CacheEntry): void {
    for (const tag of entry.tags) {
      const keys = this.tagIndex.get(tag) || [];
      if (!keys.includes(entry.key)) {
        keys.push(entry.key);
        this.tagIndex.set(tag, keys);
      }
    }
  }

  private removeFromSemanticIndex(entry: CacheEntry): void {
    const keys = this.semanticIndex.get(entry.semanticHash) || [];
    const index = keys.indexOf(entry.key);
    if (index > -1) {
      keys.splice(index, 1);
      if (keys.length === 0) {
        this.semanticIndex.delete(entry.semanticHash);
      } else {
        this.semanticIndex.set(entry.semanticHash, keys);
      }
    }
  }

  private removeFromTagIndex(entry: CacheEntry): void {
    for (const tag of entry.tags) {
      const keys = this.tagIndex.get(tag) || [];
      const index = keys.indexOf(entry.key);
      if (index > -1) {
        keys.splice(index, 1);
        if (keys.length === 0) {
          this.tagIndex.delete(tag);
        } else {
          this.tagIndex.set(tag, keys);
        }
      }
    }
  }

  private calculateSemanticSimilarity(hash1: string, hash2: string): number {
    // Enhanced semantic similarity using multiple algorithms
    if (hash1 === hash2) return 1.0;

    // Convert hashes to character sets for Jaccard similarity
    const set1 = new Set(hash1.split(''));
    const set2 = new Set(hash2.split(''));

    // Jaccard similarity (intersection over union)
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    const jaccardSimilarity = intersection.size / union.size;

    // Cosine similarity based on character frequency vectors
    const vector1 = this.createFrequencyVector(hash1);
    const vector2 = this.createFrequencyVector(hash2);
    const cosineSimilarity = this.cosineSimilarity(vector1, vector2);

    // Edit distance similarity (normalized)
    const editSimilarity = this.calculateEditSimilarity(hash1, hash2);

    // Weighted combination of similarities
    const weightedSimilarity =
      jaccardSimilarity * 0.4 + // Structural similarity
      cosineSimilarity * 0.4 + // Frequency-based similarity
      editSimilarity * 0.2; // Character-level similarity

    return Math.min(weightedSimilarity, 1.0);
  }

  /**
   * Create frequency vector for cosine similarity
   */
  private createFrequencyVector(text: string): Map<string, number> {
    const vector = new Map<string, number>();
    for (const char of text) {
      vector.set(char, (vector.get(char) || 0) + 1);
    }
    return vector;
  }

  /**
   * Calculate cosine similarity between frequency vectors
   */
  private cosineSimilarity(
    vector1: Map<string, number>,
    vector2: Map<string, number>,
  ): number {
    const allKeys = new Set([...vector1.keys(), ...vector2.keys()]);
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const key of allKeys) {
      const val1 = vector1.get(key) || 0;
      const val2 = vector2.get(key) || 0;
      dotProduct += val1 * val2;
      norm1 += val1 * val1;
      norm2 += val2 * val2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Calculate normalized edit distance similarity
   */
  private calculateEditSimilarity(s1: string, s2: string): number {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;

    const distance = this.levenshteinDistance(s1, s2);
    return 1.0 - distance / maxLen;
  }

  /**
   * Levenshtein distance calculation
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const matrix = Array(s2.length + 1)
      .fill(null)
      .map(() => Array(s1.length + 1).fill(null));

    for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= s2.length; j++) {
      for (let i = 1; i <= s1.length; i++) {
        const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }

    return matrix[s2.length][s1.length];
  }

  private recordAccess(key: string, hit: boolean): void {
    const stats = this.accessStats.get(key) || {
      hits: 0,
      misses: 0,
      totalTime: 0,
    };
    if (hit) {
      stats.hits++;
    } else {
      stats.misses++;
    }
    this.accessStats.set(key, stats);
  }

  private updateStats(): void {
    const allStats = Array.from(this.accessStats.values());
    const totalHits = allStats.reduce((sum, stat) => sum + stat.hits, 0);
    const totalMisses = allStats.reduce((sum, stat) => sum + stat.misses, 0);
    const totalAccesses = totalHits + totalMisses;

    this.stats.hitRate = totalAccesses > 0 ? totalHits / totalAccesses : 0;
    this.stats.missRate = totalAccesses > 0 ? totalMisses / totalAccesses : 0;

    const totalTime = allStats.reduce((sum, stat) => sum + stat.totalTime, 0);
    this.stats.averageAccessTime =
      totalAccesses > 0 ? totalTime / totalAccesses : 0;
  }
}
