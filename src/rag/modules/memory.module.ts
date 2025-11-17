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
import { loggingService } from '../../services/logging.service';
import { redisService } from '../../services/redis.service';

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
    }
  ) {
    super('MemoryModule', 'memory', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;
    const effectiveConfig = { ...this.config, ...config };

    if (!context?.conversationId) {
      return {
        ...this.createSuccessOutput(
          { memory: [] },
          { noContext: true }
        ),
        query,
      };
    }

    try {
      // Retrieve conversation memory
      const memory = await this.getMemory(context.conversationId, effectiveConfig);

      // Add current query to memory
      await this.addToMemory(
        context.conversationId,
        query,
        effectiveConfig
      );

      // Format memory for context
      const formattedMemory = this.formatMemory(memory, effectiveConfig);

      loggingService.info('Memory retrieved and updated', {
        component: 'MemoryModule',
        conversationId: context.conversationId,
        memoryEntries: memory.length,
        strategy: effectiveConfig.retentionStrategy,
      });

      return {
        ...this.createSuccessOutput(
          { memory: formattedMemory },
          {
            entriesCount: memory.length,
            strategy: effectiveConfig.retentionStrategy,
          }
        ),
        query,
        metadata: { memory: formattedMemory },
      };
    } catch (error) {
      loggingService.error('Memory operation failed', {
        component: 'MemoryModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput({ memory: [] }, { fallback: true }),
        query,
      };
    }
  }

  /**
   * Get conversation memory
   */
  private async getMemory(
    conversationId: string,
    config: MemoryConfig
  ): Promise<MemoryEntry[]> {
    // Try cache first
    if (this.memoryCache.has(conversationId)) {
      return this.memoryCache.get(conversationId)!;
    }

    // Try Redis
    try {
      const cached = await redisService.get(`memory:${conversationId}`);
      if (cached && typeof cached === 'string') {
        const memory = JSON.parse(cached) as MemoryEntry[];
        this.memoryCache.set(conversationId, memory);
        return memory;
      }
    } catch (error) {
      loggingService.warn('Failed to retrieve memory from Redis', {
        component: 'MemoryModule',
        conversationId,
      });
    }

    return [];
  }

  /**
   * Add entry to memory
   */
  private async addToMemory(
    conversationId: string,
    content: string,
    config: MemoryConfig
  ): Promise<void> {
    const memory = await this.getMemory(conversationId, config);

    const entry: MemoryEntry = {
      content,
      timestamp: new Date(),
      importance: this.calculateImportance(content),
    };

    memory.push(entry);

    // Apply retention strategy
    const retained = this.applyRetention(memory, config);

    // Update cache
    this.memoryCache.set(conversationId, retained);

    // Update Redis
    try {
      await redisService.set(
        `memory:${conversationId}`,
        JSON.stringify(retained),
        3600 // 1 hour TTL
      );
    } catch (error) {
      loggingService.warn('Failed to save memory to Redis', {
        component: 'MemoryModule',
        conversationId,
      });
    }
  }

  /**
   * Apply retention strategy to memory
   */
  private applyRetention(
    memory: MemoryEntry[],
    config: MemoryConfig
  ): MemoryEntry[] {
    const windowSize = config.windowSize || 5;
    const strategy = config.retentionStrategy || 'recency';

    if (memory.length <= windowSize) {
      return memory;
    }

    switch (strategy) {
      case 'fifo':
        return memory.slice(-windowSize);

      case 'importance':
        return memory
          .sort((a, b) => b.importance - a.importance)
          .slice(0, windowSize);

      case 'recency':
      default:
        return memory
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, windowSize);
    }
  }

  /**
   * Calculate importance score for a memory entry
   */
  private calculateImportance(content: string): number {
    // Simple heuristic: longer content = more important
    // Question marks = more important
    // Keywords = more important

    let importance = 0.5;

    // Length factor
    if (content.length > 100) importance += 0.2;
    if (content.length > 200) importance += 0.1;

    // Question factor
    if (content.includes('?')) importance += 0.1;

    // Keyword factor
    const importantKeywords = [
      'how',
      'why',
      'explain',
      'cost',
      'optimize',
      'error',
      'issue',
      'problem',
    ];
    const lowerContent = content.toLowerCase();
    for (const keyword of importantKeywords) {
      if (lowerContent.includes(keyword)) {
        importance += 0.05;
      }
    }

    return Math.min(importance, 1.0);
  }

  /**
   * Format memory for context
   */
  private formatMemory(
    memory: MemoryEntry[],
    config: MemoryConfig
  ): string {
    if (memory.length === 0) {
      return '';
    }

    if (config.semanticCompression) {
      return this.compressedFormat(memory);
    }

    return this.simpleFormat(memory);
  }

  /**
   * Compressed memory formatting with semantic clustering
   */
  private compressedFormat(memory: MemoryEntry[]): string {
    // Group by importance and recency
    const highImportance = memory.filter(e => e.importance > 0.7);
    const recentEntries = memory.slice(-3);
    
    // Combine unique entries
    const uniqueEntries = new Set([...highImportance, ...recentEntries]);
    
    return Array.from(uniqueEntries)
      .map((entry, idx) => `[${idx + 1}] ${entry.content}`)
      .join('\n');
  }

  /**
   * Simple memory formatting
   */
  private simpleFormat(memory: MemoryEntry[]): string {
    return memory
      .map((entry, idx) => `[${idx + 1}] ${entry.content}`)
      .join('\n');
  }

  /**
   * Clear memory for a conversation
   */
  async clearMemory(conversationId: string): Promise<void> {
    this.memoryCache.delete(conversationId);

    try {
      await redisService.del(`memory:${conversationId}`);
    } catch (error) {
      loggingService.warn('Failed to clear memory from Redis', {
        component: 'MemoryModule',
        conversationId,
      });
    }
  }

  protected getDescription(): string {
    return 'Manages conversation context and semantic memory';
  }

  protected getCapabilities(): string[] {
    return [
      'conversation_memory',
      'recency_retention',
      'importance_retention',
      'semantic_compression',
    ];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      windowSize: 5,
      retentionStrategy: 'recency',
      semanticCompression: false,
    };
  }

  validateConfig(): boolean {
    if (this.config.windowSize && this.config.windowSize < 1) {
      return false;
    }
    return true;
  }
}

