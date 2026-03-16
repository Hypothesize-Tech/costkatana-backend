import { Injectable, Inject } from '@nestjs/common';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
} from '../types/rag.types';
import { Redis } from 'ioredis';

export interface MemoryEntry {
  content: string;
  timestamp: Date;
  importance: number;
  metadata?: Record<string, any>;
}

export interface MemoryModuleConfig extends ModuleConfig {
  windowSize?: number;
  retentionStrategy?: 'recency' | 'importance' | 'fifo';
  semanticCompression?: boolean;
}

/**
 * Memory Module
 * Conversation context and semantic memory management
 */
@Injectable()
export class MemoryModule extends BaseRAGModule {
  private readonly config: MemoryModuleConfig;
  private readonly memoryCache: Map<string, MemoryEntry[]> = new Map();

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    super('MemoryModule');
    this.config = {
      enabled: true,
      priority: 3,
      timeout: 3000,
      windowSize: 5,
      retentionStrategy: 'recency',
      semanticCompression: false,
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    const { query, context } = input;

    if (!context?.conversationId) {
      return {
        documents: [],
        reasoning: 'No conversation context available',
        confidence: 0.0,
        metadata: { noContext: true },
      };
    }

    try {
      // Retrieve conversation memory
      const memory = await this.getMemory(context.conversationId);

      // Add current query to memory
      await this.addToMemory(context.conversationId, query);

      // Format memory for context
      const formattedMemory = this.formatMemory(memory);

      this.logger.log(
        `Memory retrieved and updated for conversation ${context.conversationId}`,
        {
          memoryEntries: memory.length,
          strategy: this.config.retentionStrategy,
        },
      );

      return {
        documents: [], // Memory module doesn't return documents
        reasoning: 'Conversation memory retrieved and updated',
        confidence: 0.9,
        metadata: {
          memory: formattedMemory,
          entriesCount: memory.length,
          strategy: this.config.retentionStrategy,
        },
      };
    } catch (error) {
      this.logger.error('Memory operation failed', {
        conversationId: context.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        documents: [],
        reasoning: 'Memory operation failed, proceeding without context',
        confidence: 0.0,
        metadata: { fallback: true },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return this.config.enabled && !!input.context?.conversationId;
  }

  getConfig(): ModuleConfig {
    return this.config;
  }

  /**
   * Get conversation memory
   */
  private async getMemory(conversationId: string): Promise<MemoryEntry[]> {
    // Try cache first
    if (this.memoryCache.has(conversationId)) {
      return this.memoryCache.get(conversationId)!;
    }

    // Try Redis
    try {
      const cached = await this.redis.get(`memory:${conversationId}`);
      if (cached) {
        const memory = JSON.parse(cached) as MemoryEntry[];
        // Convert timestamp strings back to Date objects
        const parsedMemory = memory.map((entry) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
        this.memoryCache.set(conversationId, parsedMemory);
        return parsedMemory;
      }
    } catch (error) {
      this.logger.warn('Failed to retrieve memory from Redis', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
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
  ): Promise<void> {
    const memory = await this.getMemory(conversationId);

    const entry: MemoryEntry = {
      content,
      timestamp: new Date(),
      importance: this.calculateImportance(content),
    };

    memory.push(entry);

    // Apply retention strategy
    const retained = this.applyRetention(memory);

    // Update cache
    this.memoryCache.set(conversationId, retained);

    // Update Redis
    try {
      await this.redis.set(
        `memory:${conversationId}`,
        JSON.stringify(retained),
        'EX',
        3600, // 1 hour TTL
      );
    } catch (error) {
      this.logger.warn('Failed to save memory to Redis', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Apply retention strategy to memory
   */
  private applyRetention(memory: MemoryEntry[]): MemoryEntry[] {
    const windowSize = this.config.windowSize || 5;
    const strategy = this.config.retentionStrategy || 'recency';

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
  private formatMemory(memory: MemoryEntry[]): string {
    if (memory.length === 0) {
      return '';
    }

    if (this.config.semanticCompression) {
      return this.compressedFormat(memory);
    }

    return this.simpleFormat(memory);
  }

  /**
   * Compressed memory formatting with semantic clustering
   */
  private compressedFormat(memory: MemoryEntry[]): string {
    // Group by importance and recency
    const highImportance = memory.filter((e) => e.importance > 0.7);
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
      await this.redis.del(`memory:${conversationId}`);
    } catch (error) {
      this.logger.warn('Failed to clear memory from Redis', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
