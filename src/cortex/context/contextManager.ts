/**
 * Structured Context Management for Cortex
 * Manages conversational state with clean, structured context frames
 */

import { CortexFrame, CortexQuery, CortexResponse } from '../types';
import { loggingService } from '../../services/logging.service';
import { cacheService } from '../../services/cache.service';
import * as crypto from 'crypto';

/**
 * Context frame for managing conversation state
 */
export interface ContextFrame extends CortexFrame {
  type: 'context';
  sessionId: string;
  turnNumber: number;
  timestamp: Date;
  entities: Map<string, EntityContext>;
  topics: Set<string>;
  goals: GoalContext[];
  history: HistoryEntry[];
  metadata: ContextMetadata;
}

/**
 * Entity context tracking
 */
export interface EntityContext {
  id: string;
  type: string;
  name: string;
  properties: Map<string, any>;
  mentions: number;
  lastMentioned: Date;
  relationships: Map<string, string>;
}

/**
 * Goal tracking
 */
export interface GoalContext {
  id: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  progress: number;
  steps: string[];
  dependencies: string[];
}

/**
 * History entry
 */
export interface HistoryEntry {
  turnNumber: number;
  timestamp: Date;
  query: CortexQuery;
  response: CortexResponse;
  tokens: number;
  cost: number;
}

/**
 * Context metadata
 */
export interface ContextMetadata {
  language: string;
  domain?: string;
  user?: string;
  preferences: Map<string, any>;
  constraints: Map<string, any>;
}

/**
 * Context update result
 */
export interface ContextUpdateResult {
  added: {
    entities: string[];
    topics: string[];
    goals: string[];
  };
  modified: {
    entities: string[];
    goals: string[];
  };
  removed: {
    entities: string[];
    topics: string[];
    goals: string[];
  };
}

/**
 * Context Manager
 */
export class ContextManager {
  private contexts = new Map<string, ContextFrame>();
  private readonly maxHistorySize = 10;
  private readonly contextCachePrefix = 'cortex:context:';
  
  /**
   * Create or get context for a session
   */
  public async getOrCreateContext(sessionId: string): Promise<ContextFrame> {
    // Check memory first
    if (this.contexts.has(sessionId)) {
      return this.contexts.get(sessionId)!;
    }
    
    // Check cache
    const cached = await this.loadContextFromCache(sessionId);
    if (cached) {
      this.contexts.set(sessionId, cached);
      return cached;
    }
    
    // Create new context
    const context = this.createNewContext(sessionId);
    this.contexts.set(sessionId, context);
    await this.saveContextToCache(context);
    
    return context;
  }
  
  /**
   * Create new context frame
   */
  private createNewContext(sessionId: string): ContextFrame {
    return {
      type: 'context',
      sessionId,
      turnNumber: 0,
      timestamp: new Date(),
      entities: new Map(),
      topics: new Set(),
      goals: [],
      history: [],
      metadata: {
        language: 'en',
        preferences: new Map(),
        constraints: new Map()
      }
    };
  }
  
  /**
   * Update context with new query and response
   */
  public async updateContext(
    sessionId: string,
    query: CortexQuery,
    response: CortexResponse
  ): Promise<ContextUpdateResult> {
    const context = await this.getOrCreateContext(sessionId);
    const result: ContextUpdateResult = {
      added: { entities: [], topics: [], goals: [] },
      modified: { entities: [], goals: [] },
      removed: { entities: [], topics: [], goals: [] }
    };
    
    // Increment turn number
    context.turnNumber++;
    context.timestamp = new Date();
    
    // Extract entities from query and response
    const newEntities = this.extractEntities(query, response);
    newEntities.forEach(entity => {
      if (context.entities.has(entity.id)) {
        context.entities.get(entity.id)!.mentions++;
        context.entities.get(entity.id)!.lastMentioned = new Date();
        result.modified.entities.push(entity.id);
      } else {
        context.entities.set(entity.id, entity);
        result.added.entities.push(entity.id);
      }
    });
    
    // Extract topics
    const newTopics = this.extractTopics(query, response);
    newTopics.forEach(topic => {
      if (!context.topics.has(topic)) {
        context.topics.add(topic);
        result.added.topics.push(topic);
      }
    });
    
    // Update goals
    const goalUpdates = this.updateGoals(context.goals, query, response);
    result.added.goals = goalUpdates.added;
    result.modified.goals = goalUpdates.modified;
    
    // Add to history (with size limit)
    context.history.push({
      turnNumber: context.turnNumber,
      timestamp: new Date(),
      query,
      response,
      tokens: this.estimateTokens(query, response),
      cost: this.estimateCost(query, response)
    });
    
    // Trim history if needed
    if (context.history.length > this.maxHistorySize) {
      context.history = this.compressHistory(context.history);
    }
    
    // Clean up stale entities
    const staleEntities = this.findStaleEntities(context.entities);
    staleEntities.forEach(id => {
      context.entities.delete(id);
      result.removed.entities.push(id);
    });
    
    // Save updated context
    await this.saveContextToCache(context);
    
    loggingService.debug('Context updated', {
      sessionId,
      turnNumber: context.turnNumber,
      entitiesCount: context.entities.size,
      topicsCount: context.topics.size
    });
    
    return result;
  }
  
  /**
   * Extract entities from query and response
   */
  private extractEntities(query: CortexQuery, response: CortexResponse): EntityContext[] {
    const entities: EntityContext[] = [];
    
    // Extract from query - use query itself if no nested expression
    const queryExpression = query.expression || query;
    if (queryExpression.frames) {
      queryExpression.frames.forEach(frame => {
        if (frame.type === 'entity') {
          const entity: EntityContext = {
            id: this.generateEntityId(frame),
            type: frame['entity_type'] || 'unknown',
            name: frame['name'] || 'unnamed',
            properties: new Map(Object.entries(frame['properties'] || {})),
            mentions: 1,
            lastMentioned: new Date(),
            relationships: new Map()
          };
          entities.push(entity);
        }
      });
    }
    
    // Extract from response
    if (response.frames) {
      response.frames.forEach(frame => {
        if (frame.type === 'entity') {
          const entity: EntityContext = {
            id: this.generateEntityId(frame),
            type: frame['entity_type'] || 'unknown',
            name: frame['name'] || 'unnamed',
            properties: new Map(Object.entries(frame['properties'] || {})),
            mentions: 1,
            lastMentioned: new Date(),
            relationships: new Map()
          };
          entities.push(entity);
        }
      });
    }
    
    return entities;
  }
  
  /**
   * Generate unique entity ID
   */
  private generateEntityId(frame: CortexFrame): string {
    const content = JSON.stringify({
      type: frame['entity_type'],
      name: frame['name']
    });
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
  }
  
  /**
   * Extract topics from query and response
   */
  private extractTopics(query: CortexQuery, response: CortexResponse): Set<string> {
    const topics = new Set<string>();
    
    // Extract from query metadata
    if (query.metadata?.topics) {
      (query.metadata.topics as string[]).forEach(topic => topics.add(topic));
    }
    
    // Extract from response metadata
    if (response.metadata?.topics) {
      (response.metadata.topics as string[]).forEach(topic => topics.add(topic));
    }
    
    // Extract from frame types
    const queryExpression = query.expression || query;
    const allFrames = [
      ...(queryExpression.frames || []),
      ...(response.frames || [])
    ];
    
    allFrames.forEach(frame => {
      if (frame['topic']) {
        topics.add(frame['topic'] as string);
      }
    });
    
    return topics;
  }
  
  /**
   * Update goals based on query and response
   */
  private updateGoals(
    currentGoals: GoalContext[],
    query: CortexQuery,
    _response: CortexResponse
  ): { added: string[]; modified: string[] } {
    const added: string[] = [];
    const modified: string[] = [];
    
    // Check for goal-related frames
    const queryExpression = query.expression || query;
    if (queryExpression.frames) {
      queryExpression.frames.forEach(frame => {
        if (frame.type === 'goal' || frame.type === 'objective') {
          const goalId = frame['id'] as string || crypto.randomUUID();
          const existingGoal = currentGoals.find(g => g.id === goalId);
          
          if (existingGoal) {
            // Update existing goal
            if (frame['status']) {
              existingGoal.status = frame['status'] as any;
            }
            if (frame['progress']) {
              existingGoal.progress = frame['progress'] as number;
            }
            modified.push(goalId);
          } else {
            // Add new goal
            currentGoals.push({
              id: goalId,
              description: frame['description'] as string || 'Unknown goal',
              status: 'active',
              progress: 0,
              steps: frame['steps'] as string[] || [],
              dependencies: frame['dependencies'] as string[] || []
            });
            added.push(goalId);
          }
        }
      });
    }
    
    return { added, modified };
  }
  
  /**
   * Find stale entities that haven't been mentioned recently
   */
  private findStaleEntities(entities: Map<string, EntityContext>): string[] {
    const staleIds: string[] = [];
    const staleThreshold = 10; // turns
    const now = new Date();
    
    entities.forEach((entity, id) => {
      const turnsSinceLastMention = Math.floor(
        (now.getTime() - entity.lastMentioned.getTime()) / (1000 * 60)
      );
      
      if (turnsSinceLastMention > staleThreshold && entity.mentions < 3) {
        staleIds.push(id);
      }
    });
    
    return staleIds;
  }
  
  /**
   * Compress history to stay within size limits
   */
  private compressHistory(history: HistoryEntry[]): HistoryEntry[] {
    // Keep first turn, last 5 turns, and important turns
    const compressed: HistoryEntry[] = [];
    
    // Always keep first turn
    if (history.length > 0) {
      compressed.push(history[0]);
    }
    
    // Keep important turns (high cost or many tokens)
    const important = history
      .slice(1, -5)
      .filter(entry => entry.cost > 0.01 || entry.tokens > 1000)
      .slice(-3); // Keep up to 3 important turns
    
    compressed.push(...important);
    
    // Keep last 5 turns
    compressed.push(...history.slice(-5));
    
    return compressed;
  }
  
  /**
   * Build compact context for inclusion in queries
   */
  public async buildCompactContext(sessionId: string): Promise<CortexFrame> {
    const context = await this.getOrCreateContext(sessionId);
    
    // Build compact representation
    const compactContext: CortexFrame = {
      type: 'context_summary',
      sessionId,
      turnNumber: context.turnNumber,
      
      // Include only active entities
      activeEntities: Array.from(context.entities.values())
        .filter(e => e.mentions > 1)
        .map(e => ({
          id: e.id,
          type: e.type,
          name: e.name
        })),
      
      // Include current topics
      currentTopics: Array.from(context.topics).slice(-5),
      
      // Include active goals
      activeGoals: context.goals
        .filter(g => g.status === 'active')
        .map(g => ({
          id: g.id,
          description: g.description,
          progress: g.progress
        })),
      
      // Include recent history summary
      recentContext: this.summarizeRecentHistory(context.history.slice(-3))
    };
    
    return compactContext;
  }
  
  /**
   * Summarize recent history
   */
  private summarizeRecentHistory(history: HistoryEntry[]): any {
    if (history.length === 0) return null;
    
    return {
      turns: history.map(h => h.turnNumber),
      totalTokens: history.reduce((sum, h) => sum + h.tokens, 0),
      totalCost: history.reduce((sum, h) => sum + h.cost, 0)
    };
  }
  
  /**
   * Estimate tokens for query and response
   */
  private estimateTokens(query: CortexQuery, response: CortexResponse): number {
    const queryStr = JSON.stringify(query);
    const responseStr = JSON.stringify(response);
    return Math.ceil((queryStr.length + responseStr.length) / 4);
  }
  
  /**
   * Estimate cost for query and response
   */
  private estimateCost(query: CortexQuery, response: CortexResponse): number {
    const tokens = this.estimateTokens(query, response);
    const costPerToken = 0.000001; // $0.001 per 1K tokens
    return tokens * costPerToken;
  }
  
  /**
   * Load context from cache
   */
  private async loadContextFromCache(sessionId: string): Promise<ContextFrame | null> {
    try {
      const key = `${this.contextCachePrefix}${sessionId}`;
      const cached = await cacheService.get(key);
      
      if (cached) {
        // Reconstruct Maps and Sets from cached data
        const context = cached as any;
        context.entities = new Map(context.entities);
        context.topics = new Set(context.topics);
        context.metadata.preferences = new Map(context.metadata.preferences);
        context.metadata.constraints = new Map(context.metadata.constraints);
        
        return context as ContextFrame;
      }
      
      return null;
    } catch (error) {
      loggingService.error('Failed to load context from cache', { sessionId, error });
      return null;
    }
  }
  
  /**
   * Save context to cache
   */
  private async saveContextToCache(context: ContextFrame): Promise<void> {
    try {
      const key = `${this.contextCachePrefix}${context.sessionId}`;
      
      // Convert Maps and Sets to arrays for serialization
      const cacheable = {
        ...context,
        entities: Array.from(context.entities.entries()),
        topics: Array.from(context.topics),
        metadata: {
          ...context.metadata,
          preferences: Array.from(context.metadata.preferences.entries()),
          constraints: Array.from(context.metadata.constraints.entries())
        }
      };
      
      await cacheService.set(key, cacheable, 3600); // Cache for 1 hour
    } catch (error) {
      loggingService.error('Failed to save context to cache', { 
        sessionId: context.sessionId, 
        error 
      });
    }
  }
  
  /**
   * Clear context for a session
   */
  public async clearContext(sessionId: string): Promise<void> {
    this.contexts.delete(sessionId);
    
    const key = `${this.contextCachePrefix}${sessionId}`;
    await cacheService.delete(key);
    
    loggingService.info('Context cleared', { sessionId });
  }
  
  /**
   * Get context statistics
   */
  public getStatistics(): Record<string, any> {
    const stats: Record<string, any> = {
      activeSessions: this.contexts.size,
      totalEntities: 0,
      totalTopics: 0,
      totalGoals: 0,
      averageHistorySize: 0
    };
    
    let totalHistory = 0;
    
    this.contexts.forEach(context => {
      stats.totalEntities += context.entities.size;
      stats.totalTopics += context.topics.size;
      stats.totalGoals += context.goals.length;
      totalHistory += context.history.length;
    });
    
    if (this.contexts.size > 0) {
      stats.averageHistorySize = (totalHistory / this.contexts.size).toFixed(2);
    }
    
    return stats;
  }
}
