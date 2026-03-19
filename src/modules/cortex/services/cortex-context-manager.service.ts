/**
 * Cortex Context Manager Service (NestJS)
 *
 * Manages conversational state efficiently using structured context instead of
 * maintaining full conversation history. Provides clean, stateful conversations
 * by extracting and maintaining only essential context information.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CortexFrame } from '../types/cortex.types';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface ConversationContext {
  id: string;
  userId: string;
  sessionId: string;

  // Structured context data
  entities: Map<string, ContextEntity>;
  intentions: ContextIntention[];
  preferences: Map<string, ContextPreference>;
  constraints: ContextConstraint[];

  // Memory management
  workingMemory: ContextMemoryFrame[];
  episodicMemory: EpisodicMemoryEntry[];
  semanticMemory: SemanticMemoryEntry[];

  // Conversation flow
  conversationFlow: ConversationFlowState;
  currentTopic: string | null;
  previousTopics: TopicTransition[];

  // Metadata
  created: Date;
  lastAccessed: Date;
  totalInteractions: number;
  contextVersion: number;
  expiresAt: Date;
}

export interface ContextEntity {
  id: string;
  type: 'person' | 'object' | 'concept' | 'location' | 'organization' | 'event';
  name: string;
  properties: Map<string, ContextValue>;
  relationships: EntityRelationship[];
  relevance: number;
  confidence: number;
  lastMentioned: Date;
  frequency: number;
}

export interface ContextIntention {
  id: string;
  type: 'query' | 'request' | 'command' | 'clarification' | 'continuation';
  intent: string;
  parameters: Map<string, ContextValue>;
  status: 'pending' | 'active' | 'fulfilled' | 'abandoned';
  priority: number;
  created: Date;
  fulfilled?: Date;
}

export interface ContextPreference {
  key: string;
  value: ContextValue;
  category:
    | 'output_format'
    | 'communication_style'
    | 'domain_preference'
    | 'personalization';
  confidence: number;
  source: 'explicit' | 'inferred' | 'default';
  created: Date;
  lastUsed: Date;
}

export interface ContextConstraint {
  id: string;
  type: 'time' | 'resource' | 'privacy' | 'format' | 'scope';
  description: string;
  parameters: Map<string, ContextValue>;
  priority: number;
  active: boolean;
  created: Date;
  expiresAt?: Date;
}

export interface ContextMemoryFrame {
  id: string;
  type: 'working' | 'episodic' | 'semantic';
  content: CortexFrame;
  summary: string;
  importance: number;
  recency: number;
  frequency: number;
  created: Date;
  lastAccessed: Date;
}

export interface EpisodicMemoryEntry {
  id: string;
  event: string;
  timestamp: Date;
  context: string;
  outcome: string;
  entities: string[];
  emotions?: string[];
  importance: number;
}

export interface SemanticMemoryEntry {
  id: string;
  concept: string;
  definition: string;
  relationships: string[];
  examples: string[];
  category: string;
  confidence: number;
  created: Date;
  lastUpdated: Date;
}

export interface EntityRelationship {
  targetEntityId: string;
  type:
    | 'is_a'
    | 'has_a'
    | 'part_of'
    | 'related_to'
    | 'opposite_of'
    | 'similar_to';
  strength: number;
  bidirectional: boolean;
}

export interface ConversationFlowState {
  currentPhase:
    | 'opening'
    | 'information_gathering'
    | 'processing'
    | 'delivering'
    | 'closing';
  stepsCompleted: string[];
  nextExpectedActions: string[];
  branchingPoints: BranchingPoint[];
  conversationDepth: number;
}

export interface TopicTransition {
  from: string | null;
  to: string;
  timestamp: Date;
  trigger:
    | 'user_initiated'
    | 'system_suggested'
    | 'natural_flow'
    | 'context_shift';
  relevanceScore: number;
}

export interface BranchingPoint {
  id: string;
  description: string;
  options: BranchingOption[];
  selectedOption?: string;
  timestamp: Date;
}

export interface BranchingOption {
  id: string;
  description: string;
  likelihood: number;
  consequences: string[];
}

export type ContextValue =
  | string
  | number
  | boolean
  | null
  | ContextValue[]
  | { [key: string]: ContextValue };

@Injectable()
export class CortexContextManagerService {
  private readonly logger = new Logger(CortexContextManagerService.name);
  private readonly contexts = new Map<string, ConversationContext>();
  private readonly contextExpirationMs = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Create a new conversation context
   */
  public createContext(userId: string, sessionId: string): ConversationContext {
    const contextId = this.generateContextId(userId, sessionId);

    const context: ConversationContext = {
      id: contextId,
      userId,
      sessionId,
      entities: new Map(),
      intentions: [],
      preferences: new Map(),
      constraints: [],
      workingMemory: [],
      episodicMemory: [],
      semanticMemory: [],
      conversationFlow: {
        currentPhase: 'opening',
        stepsCompleted: [],
        nextExpectedActions: ['greet_user', 'establish_context'],
        branchingPoints: [],
        conversationDepth: 0,
      },
      currentTopic: null,
      previousTopics: [],
      created: new Date(),
      lastAccessed: new Date(),
      totalInteractions: 0,
      contextVersion: 1,
      expiresAt: new Date(Date.now() + this.contextExpirationMs),
    };

    this.contexts.set(contextId, context);
    this.logger.log(`Created new conversation context: ${contextId}`);

    return context;
  }

  /**
   * Get existing context or create new one
   */
  public getOrCreateContext(
    userId: string,
    sessionId: string,
  ): ConversationContext {
    const contextId = this.generateContextId(userId, sessionId);
    let context = this.contexts.get(contextId);

    if (!context) {
      context = this.createContext(userId, sessionId);
    } else {
      context.lastAccessed = new Date();
    }

    return context;
  }

  /**
   * Update context with new frame
   */
  public updateContext(
    contextId: string,
    frame: CortexFrame,
    metadata?: {
      importance?: number;
      topic?: string;
      entities?: string[];
    },
  ): ConversationContext {
    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error(`Context not found: ${contextId}`);
    }

    context.totalInteractions++;
    context.lastAccessed = new Date();

    // Extract entities from frame
    this.extractEntitiesFromFrame(context, frame);

    // Update intentions
    this.updateIntentions(context, frame);

    // Update working memory
    this.updateWorkingMemory(context, frame, metadata);

    // Update conversation flow
    this.updateConversationFlow(context, frame, metadata);

    // Update topic if provided
    if (metadata?.topic) {
      this.updateTopic(context, metadata.topic);
    }

    // Clean up expired contexts periodically
    if (context.totalInteractions % 10 === 0) {
      this.cleanupExpiredContexts();
    }

    return context;
  }

  /**
   * Get context summary for AI processing
   */
  public getContextSummary(
    contextId: string,
    maxItems = 5,
  ): {
    entities: ContextEntity[];
    activeIntentions: ContextIntention[];
    currentTopic: string | null;
    recentMemory: ContextMemoryFrame[];
    preferences: ContextPreference[];
    constraints: ContextConstraint[];
    conversationState: string;
  } {
    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error(`Context not found: ${contextId}`);
    }

    return {
      entities: Array.from(context.entities.values()).slice(0, maxItems),
      activeIntentions: context.intentions
        .filter((i) => i.status === 'active' || i.status === 'pending')
        .slice(0, maxItems),
      currentTopic: context.currentTopic,
      recentMemory: context.workingMemory
        .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())
        .slice(0, maxItems),
      preferences: Array.from(context.preferences.values()).slice(0, maxItems),
      constraints: context.constraints
        .filter((c) => c.active)
        .slice(0, maxItems),
      conversationState: `${context.conversationFlow.currentPhase} (${context.conversationFlow.conversationDepth} depth)`,
    };
  }

  /**
   * Add explicit preference
   */
  public addPreference(
    contextId: string,
    key: string,
    value: ContextValue,
    category: ContextPreference['category'],
    confidence = 1.0,
  ): void {
    const context = this.contexts.get(contextId);
    if (!context) return;

    const preference: ContextPreference = {
      key,
      value,
      category,
      confidence,
      source: 'explicit',
      created: new Date(),
      lastUsed: new Date(),
    };

    context.preferences.set(key, preference);
  }

  /**
   * Add constraint
   */
  public addConstraint(
    contextId: string,
    type: ContextConstraint['type'],
    description: string,
    parameters: Map<string, ContextValue>,
    priority = 5,
    expiresAt?: Date,
  ): void {
    const context = this.contexts.get(contextId);
    if (!context) return;

    const constraint: ContextConstraint = {
      id: this.generateId(),
      type,
      description,
      parameters,
      priority,
      active: true,
      created: new Date(),
      expiresAt,
    };

    context.constraints.push(constraint);
  }

  /**
   * Fulfill intention
   */
  public fulfillIntention(contextId: string, intentionId: string): void {
    const context = this.contexts.get(contextId);
    if (!context) return;

    const intention = context.intentions.find((i) => i.id === intentionId);
    if (intention) {
      intention.status = 'fulfilled';
      intention.fulfilled = new Date();
    }
  }

  /**
   * Archive context (mark for cleanup)
   */
  public archiveContext(contextId: string): void {
    const context = this.contexts.get(contextId);
    if (context) {
      context.expiresAt = new Date(); // Expire immediately
      this.logger.log(`Archived context: ${contextId}`);
    }
  }

  /**
   * Get context statistics
   */
  public getContextStats(): {
    totalContexts: number;
    activeContexts: number;
    averageInteractions: number;
    totalMemoryFrames: number;
  } {
    const now = Date.now();
    const activeContexts = Array.from(this.contexts.values()).filter(
      (ctx) => ctx.expiresAt.getTime() > now,
    );

    const totalInteractions = activeContexts.reduce(
      (sum, ctx) => sum + ctx.totalInteractions,
      0,
    );
    const totalMemoryFrames = activeContexts.reduce(
      (sum, ctx) => sum + ctx.workingMemory.length,
      0,
    );

    return {
      totalContexts: this.contexts.size,
      activeContexts: activeContexts.length,
      averageInteractions:
        activeContexts.length > 0
          ? totalInteractions / activeContexts.length
          : 0,
      totalMemoryFrames,
    };
  }

  // Private helper methods

  private generateContextId(userId: string, sessionId: string): string {
    return `ctx_${userId}_${sessionId}_${Date.now()}`;
  }

  private generateId(): string {
    return generateSecureId('id');
  }

  private extractEntitiesFromFrame(
    context: ConversationContext,
    frame: CortexFrame,
  ): void {
    const structuredRegexPipeline: Array<{
      pattern: RegExp;
      type: string;
      extractId: (match: RegExpMatchArray) => string | null;
    }> = [
      // UUIDs and IDs
      {
        pattern:
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        type: 'uuid',
        extractId: (m) => `uuid_${m[0].toLowerCase()}`,
      },
      // Project/file/entity IDs (entity_xxx, project_xxx, etc.)
      {
        pattern: /\b(entity|project|file|chunk|repo)_([a-zA-Z0-9_-]+)/g,
        type: 'identifier',
        extractId: (m) => `${m[1]}_${m[2]}`,
      },
      // PascalCase identifiers (likely classes/names)
      {
        pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]*)+)\b/g,
        type: 'object',
        extractId: (m) => `name_${m[1]}`,
      },
      // camelCase identifiers (functions, variables) - skip very short
      {
        pattern: /\b([a-z][a-zA-Z0-9]{3,})\b/g,
        type: 'object',
        extractId: (m) => `identifier_${m[1]}`,
      },
      // Numeric IDs
      {
        pattern: /\b(?:id|ID|#)\s*[=:]\s*([a-zA-Z0-9_-]+)/g,
        type: 'identifier',
        extractId: (m) => `id_${m[1]}`,
      },
      // Email addresses
      {
        pattern: /\b[\w.-]+@[\w.-]+\.\w+\b/g,
        type: 'email',
        extractId: (m) => `email_${m[0].toLowerCase()}`,
      },
      // URL-like paths
      {
        pattern: /(?:^|\s)([\w.-]+\/[\w./-]+)(?:\s|$)/g,
        type: 'path',
        extractId: (m) => (m[1].length > 5 ? `path_${m[1]}` : null),
      },
    ];

    for (const [role, value] of Object.entries(frame)) {
      if (role === 'frameType' || typeof value !== 'string') continue;

      for (const { pattern, type, extractId } of structuredRegexPipeline) {
        const matches = value.matchAll(pattern);
        for (const match of matches) {
          const entityId = extractId(match as RegExpMatchArray);
          if (!entityId) continue;

          if (!context.entities.has(entityId)) {
            const entity: ContextEntity = {
              id: entityId,
              type: type as 'object' | 'string' | 'number' | 'boolean',
              name: entityId,
              properties: new Map(),
              relationships: [],
              relevance: 0.5,
              confidence: 0.8,
              lastMentioned: new Date(),
              frequency: 1,
            };
            context.entities.set(entityId, entity);
          } else {
            const entity = context.entities.get(entityId)!;
            entity.frequency++;
            entity.lastMentioned = new Date();
            entity.relevance = Math.min(1.0, entity.relevance + 0.1);
          }
        }
      }
    }
  }

  private updateIntentions(
    context: ConversationContext,
    frame: CortexFrame,
  ): void {
    // Extract intentions from frame
    if (frame.frameType === 'query' && 'action' in frame) {
      const parameters = new Map<string, ContextValue>();
      for (const [k, v] of Object.entries(frame)) {
        if (v !== undefined) parameters.set(k, v as ContextValue);
      }
      const intention: ContextIntention = {
        id: this.generateId(),
        type: 'query',
        intent: String(frame.action),
        parameters,
        status: 'active',
        priority: 5,
        created: new Date(),
      };
      context.intentions.push(intention);

      // Keep only recent intentions
      if (context.intentions.length > 10) {
        context.intentions = context.intentions.slice(-10);
      }
    }
  }

  private updateWorkingMemory(
    context: ConversationContext,
    frame: CortexFrame,
    metadata?: { importance?: number },
  ): void {
    const memoryFrame: ContextMemoryFrame = {
      id: this.generateId(),
      type: 'working',
      content: frame,
      summary: this.generateFrameSummary(frame),
      importance: metadata?.importance ?? 0.5,
      recency: 1.0,
      frequency: 1,
      created: new Date(),
      lastAccessed: new Date(),
    };

    context.workingMemory.push(memoryFrame);

    // Decay recency of older frames
    context.workingMemory.forEach((frame, index) => {
      frame.recency = Math.max(0.1, frame.recency * 0.95);
    });

    // Keep memory bounded
    if (context.workingMemory.length > 20) {
      context.workingMemory = context.workingMemory
        .sort(
          (a, b) =>
            b.importance * b.recency * b.frequency -
            a.importance * a.recency * a.frequency,
        )
        .slice(0, 20);
    }
  }

  private updateConversationFlow(
    context: ConversationContext,
    frame: CortexFrame,
    metadata?: { entities?: string[] },
  ): void {
    const flow = context.conversationFlow;

    // Update phase based on frame type
    if (frame.frameType === 'query') {
      if (flow.currentPhase === 'opening') {
        flow.currentPhase = 'information_gathering';
      }
    } else if (frame.frameType === 'answer' || frame.frameType === 'state') {
      flow.currentPhase = 'delivering';
    }

    // Update conversation depth
    if (metadata?.entities && metadata.entities.length > 0) {
      flow.conversationDepth = Math.min(10, flow.conversationDepth + 1);
    }

    // Track completed steps
    const stepKey = `${frame.frameType}_${Date.now()}`;
    flow.stepsCompleted.push(stepKey);

    if (flow.stepsCompleted.length > 50) {
      flow.stepsCompleted = flow.stepsCompleted.slice(-50);
    }
  }

  private updateTopic(context: ConversationContext, newTopic: string): void {
    const transition: TopicTransition = {
      from: context.currentTopic,
      to: newTopic,
      timestamp: new Date(),
      trigger: 'system_suggested',
      relevanceScore: 0.8,
    };

    context.previousTopics.push(transition);
    context.currentTopic = newTopic;

    if (context.previousTopics.length > 20) {
      context.previousTopics = context.previousTopics.slice(-20);
    }
  }

  private generateFrameSummary(frame: CortexFrame): string {
    const roles = Object.keys(frame).filter((k) => k !== 'frameType');
    return `${frame.frameType} frame with roles: ${roles.join(', ')}`;
  }

  private cleanupExpiredContexts(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, context] of this.contexts.entries()) {
      if (context.expiresAt.getTime() < now) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.contexts.delete(id);
    }

    if (expiredIds.length > 0) {
      this.logger.log(`Cleaned up ${expiredIds.length} expired contexts`);
    }
  }
}
