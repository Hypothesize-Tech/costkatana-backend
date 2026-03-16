/**
 * Memory Module
 * Conversation context and semantic memory management
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  MemoryConfig,
  RAGContext,
} from '../types/rag.types';
import { RagServiceLocator } from '../../services/rag-service-locator';

export interface MemoryEntry {
  content: string;
  timestamp: Date;
  importance: number;
  metadata?: Record<string, any>;
}

export class MemoryModule extends BaseRAGModule {
  protected config: MemoryConfig;
  private memoryCache: Map<string, MemoryEntry[]> = new Map();

  constructor(
    config: MemoryConfig = {
      enabled: true,
      windowSize: 5,
      retentionStrategy: 'recency',
      semanticCompression: false,
    },
  ) {
    super('MemoryModule', 'memory', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;
    const effectiveConfig = { ...this.config, ...config };

    if (!context?.conversationId) {
      return {
        ...this.createSuccessOutput({ memory: [] }, { noContext: true }),
        query,
      };
    }

    try {
      // Retrieve conversation memory
      const memory = await this.getMemory(
        context.conversationId,
        effectiveConfig,
      );

      // Add current query to memory
      await this.addToMemory(query, context, effectiveConfig);

      return {
        ...this.createSuccessOutput(
          { memory },
          {
            memoryCount: memory.length,
            strategy: effectiveConfig.retentionStrategy,
            windowSize: effectiveConfig.windowSize,
          },
        ),
        query,
      };
    } catch (error) {
      this.logger.warn('Memory retrieval failed', {
        component: 'MemoryModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput({ memory: [] }, { memoryFailed: true }),
        query,
      };
    }
  }

  /**
   * Get conversation memory
   */
  private async getMemory(
    conversationId: string,
    config: MemoryConfig,
  ): Promise<MemoryEntry[]> {
    const windowSize = config.windowSize ?? 5;

    try {
      // Try to get from cache service first
      const cacheKey = `memory:${conversationId}`;
      const cached =
        await RagServiceLocator.getCacheService().get<MemoryEntry[]>(cacheKey);

      if (cached) {
        return this.applyRetentionStrategy(cached, config).slice(-windowSize);
      }
    } catch (error) {
      this.logger.debug('Cache service unavailable for memory', {
        component: 'MemoryModule',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to in-memory cache
    const memory = this.memoryCache.get(conversationId) || [];
    return this.applyRetentionStrategy(memory, config).slice(-windowSize);
  }

  /**
   * Add query to conversation memory
   */
  private async addToMemory(
    query: string,
    context: RAGContext,
    config: MemoryConfig,
  ): Promise<void> {
    if (!context.conversationId) return;

    const entry: MemoryEntry = {
      content: query,
      timestamp: new Date(),
      importance: this.calculateImportance(query, context),
      metadata: {
        userId: context.userId,
        conversationId: context.conversationId,
      },
    };

    try {
      // Try to store in cache service
      const cacheKey = `memory:${context.conversationId}`;
      const existing = await this.getMemory(context.conversationId, config);
      const updated = [...existing, entry];

      // Apply retention before storing
      const retained = this.applyRetentionStrategy(updated, config);

      await RagServiceLocator.getCacheService().set(cacheKey, retained, 3600); // 1 hour TTL
    } catch (error) {
      this.logger.debug('Cache service unavailable for memory storage', {
        component: 'MemoryModule',
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to in-memory storage
      const existing = this.memoryCache.get(context.conversationId) || [];
      const updated = [...existing, entry];
      const retained = this.applyRetentionStrategy(updated, config);

      this.memoryCache.set(context.conversationId, retained);
    }
  }

  /**
   * Apply retention strategy to memory entries
   */
  private applyRetentionStrategy(
    memory: MemoryEntry[],
    config: MemoryConfig,
  ): MemoryEntry[] {
    const strategy = config.retentionStrategy ?? 'recency';

    switch (strategy) {
      case 'fifo':
        return memory.slice(-50); // Keep last 50 entries

      case 'importance':
        return memory.sort((a, b) => b.importance - a.importance).slice(0, 20); // Keep top 20 by importance

      case 'recency':
      default:
        return memory
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, config.windowSize ?? 5);
    }
  }

  /**
   * Calculate importance score for a query
   */
  private calculateImportance(query: string, context: RAGContext): number {
    let importance = 0.5; // Base importance

    // Boost for questions (indicates information seeking)
    if (
      query.includes('?') ||
      query.match(/\b(what|how|why|when|where|who)\b/i)
    ) {
      importance += 0.2;
    }

    // Boost for complex queries
    if (query.length > 100) {
      importance += 0.1;
    }

    // Boost for analytical terms
    if (query.match(/\b(analyze|compare|evaluate|assess)\b/i)) {
      importance += 0.3;
    }

    // Boost for repeated topics
    if (context?.previousQueries) {
      const recentQueries = context.previousQueries.slice(-3);
      const similarQueries = recentQueries.filter(
        (prev) => this.calculateTextSimilarity(query, prev) > 0.3,
      );
      importance += similarQueries.length * 0.1;
    }

    return Math.min(1.0, importance);
  }

  /**
   * Simple text similarity calculation
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Compress memory using semantic clustering (if enabled)
   */
  private compressMemory(memory: MemoryEntry[]): MemoryEntry[] {
    if (!this.config.semanticCompression) {
      return memory;
    }

    // Simple clustering: group similar queries
    const clusters: MemoryEntry[][] = [];

    for (const entry of memory) {
      let added = false;

      for (const cluster of clusters) {
        const similarity =
          cluster.reduce(
            (sum, existing) =>
              sum +
              this.calculateTextSimilarity(entry.content, existing.content),
            0,
          ) / cluster.length;

        if (similarity > 0.5) {
          cluster.push(entry);
          added = true;
          break;
        }
      }

      if (!added) {
        clusters.push([entry]);
      }
    }

    // Keep only the most important entry from each cluster
    return clusters.map(
      (cluster) => cluster.sort((a, b) => b.importance - a.importance)[0],
    );
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      windowSize: 5,
      retentionStrategy: 'recency',
      semanticCompression: false,
    };
  }

  protected getDescription(): string {
    return 'Conversation memory and context management module';
  }

  protected getCapabilities(): string[] {
    return [
      'Conversation memory',
      'Query importance scoring',
      'Memory retention strategies',
      'Semantic compression',
      'Context retrieval',
      'Memory persistence',
    ];
  }
}
