/**
 * Cortex Context Manager Service
 * 
 * Manages conversational state efficiently using structured context instead of 
 * maintaining full conversation history. Provides clean, stateful conversations
 * by extracting and maintaining only essential context information.
 */

import { CortexFrame, CortexValue } from '../types/cortex.types';
import { loggingService } from './logging.service';
import * as crypto from 'crypto';

// ============================================================================
// CONTEXT MANAGEMENT TYPES
// ============================================================================

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
    relevance: number; // 0-1 score
    confidence: number; // 0-1 score
    lastMentioned: Date;
    frequency: number;
}

export interface ContextIntention {
    id: string;
    type: 'query' | 'request' | 'command' | 'clarification' | 'continuation';
    intent: string;
    parameters: Map<string, ContextValue>;
    status: 'pending' | 'active' | 'fulfilled' | 'abandoned';
    priority: number; // 0-10
    created: Date;
    fulfilled?: Date;
}

export interface ContextPreference {
    key: string;
    value: ContextValue;
    category: 'output_format' | 'communication_style' | 'domain_preference' | 'personalization';
    confidence: number; // 0-1 score
    source: 'explicit' | 'inferred' | 'default';
    created: Date;
    lastUsed: Date;
}

export interface ContextConstraint {
    id: string;
    type: 'time' | 'resource' | 'privacy' | 'format' | 'scope';
    description: string;
    parameters: Map<string, ContextValue>;
    priority: number; // 0-10
    active: boolean;
    created: Date;
    expiresAt?: Date;
}

export interface ContextMemoryFrame {
    id: string;
    type: 'working' | 'episodic' | 'semantic';
    content: CortexFrame;
    summary: string;
    importance: number; // 0-1 score
    recency: number; // 0-1 score (1 = most recent)
    frequency: number; // Access frequency
    created: Date;
    lastAccessed: Date;
}

export interface EpisodicMemoryEntry {
    id: string;
    event: string;
    timestamp: Date;
    context: string;
    outcome: string;
    entities: string[]; // Entity IDs
    emotions?: string[];
    importance: number; // 0-1 score
}

export interface SemanticMemoryEntry {
    id: string;
    concept: string;
    definition: string;
    relationships: string[];
    examples: string[];
    category: string;
    confidence: number; // 0-1 score
    created: Date;
    lastUpdated: Date;
}

export interface EntityRelationship {
    targetEntityId: string;
    type: 'is_a' | 'has_a' | 'part_of' | 'related_to' | 'opposite_of' | 'similar_to';
    strength: number; // 0-1 score
    bidirectional: boolean;
}

export interface ConversationFlowState {
    currentPhase: 'opening' | 'information_gathering' | 'processing' | 'delivering' | 'closing';
    stepsCompleted: string[];
    nextExpectedActions: string[];
    branchingPoints: BranchingPoint[];
    conversationDepth: number; // Number of topic levels deep
}

export interface TopicTransition {
    from: string | null;
    to: string;
    timestamp: Date;
    trigger: 'user_initiated' | 'system_suggested' | 'natural_flow' | 'context_shift';
    relevanceScore: number; // 0-1 score
}

export interface BranchingPoint {
    id: string;
    description: string;
    options: string[];
    recommendedOption: string;
    timestamp: Date;
}

export type ContextValue = string | number | boolean | Date | string[] | number[];

export interface ContextExtractionResult {
    entities: ContextEntity[];
    intentions: ContextIntention[];
    preferences: ContextPreference[];
    constraints: ContextConstraint[];
    topicShift: {
        detected: boolean;
        from: string | null;
        to: string | null;
        confidence: number;
    };
    memoryUpdates: {
        working: ContextMemoryFrame[];
        episodic: EpisodicMemoryEntry[];
        semantic: SemanticMemoryEntry[];
    };
}

export interface ContextCompressionResult {
    compressedContext: ConversationContext;
    compressionRatio: number;
    retainedElements: number;
    discardedElements: number;
    compressionStrategy: 'importance' | 'recency' | 'frequency' | 'hybrid';
}

export interface ContextReconstructionRequest {
    userId: string;
    sessionId: string;
    query: string;
    maxContextSize?: number;
    focusAreas?: string[];
    includeHistory?: boolean;
}

export interface ContextReconstructionResult {
    relevantContext: ConversationContext;
    contextSummary: string;
    keyEntities: ContextEntity[];
    activeIntentions: ContextIntention[];
    applicablePreferences: ContextPreference[];
    reconstructionStrategy: string;
    confidence: number;
}

// ============================================================================
// CORTEX CONTEXT MANAGER SERVICE
// ============================================================================

export class CortexContextManagerService {
    private static instance: CortexContextManagerService;
    private contextStore: Map<string, ConversationContext> = new Map();
    private contextIndex: Map<string, Set<string>> = new Map(); // User -> Context IDs
    private cleanupInterval!: NodeJS.Timeout;

    private constructor() {
        this.initializeContextManagement();
        this.startCleanupScheduler();
    }

    public static getInstance(): CortexContextManagerService {
        if (!CortexContextManagerService.instance) {
            CortexContextManagerService.instance = new CortexContextManagerService();
        }
        return CortexContextManagerService.instance;
    }

    /**
     * Extract context information from a Cortex frame
     */
    public async extractContext(
        frame: CortexFrame,
        userId: string,
        sessionId: string,
        metadata: any = {}
    ): Promise<ContextExtractionResult> {
        try {
            const entities = this.extractEntities(frame);
            const intentions = this.extractIntentions(frame, metadata);
            const preferences = this.extractPreferences(frame, metadata);
            const constraints = this.extractConstraints(frame, metadata);
            
            // Detect topic shifts
            const existingContext = this.getOrCreateContext(userId, sessionId);
            const topicShift = this.detectTopicShift(frame, existingContext);

            // Create memory entries
            const memoryUpdates = {
                working: this.createWorkingMemory(frame),
                episodic: this.createEpisodicMemory(frame, metadata),
                semantic: this.createSemanticMemory(frame)
            };

            loggingService.info('🧠 Context extraction completed', {
                userId,
                sessionId,
                entitiesFound: entities.length,
                intentionsFound: intentions.length,
                preferencesFound: preferences.length,
                constraintsFound: constraints.length,
                topicShiftDetected: topicShift.detected
            });

            return {
                entities,
                intentions,
                preferences,
                constraints,
                topicShift,
                memoryUpdates
            };

        } catch (error) {
            loggingService.error('❌ Context extraction failed', {
                userId,
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                entities: [],
                intentions: [],
                preferences: [],
                constraints: [],
                topicShift: { detected: false, from: null, to: null, confidence: 0 },
                memoryUpdates: { working: [], episodic: [], semantic: [] }
            };
        }
    }

    /**
     * Update context with extracted information
     */
    public async updateContext(
        userId: string,
        sessionId: string,
        extraction: ContextExtractionResult
    ): Promise<ConversationContext> {
        const context = this.getOrCreateContext(userId, sessionId);
        
        // Update entities
        extraction.entities.forEach(entity => {
            context.entities.set(entity.id, entity);
        });

        // Update intentions
        extraction.intentions.forEach(intention => {
            context.intentions.push(intention);
        });

        // Update preferences
        extraction.preferences.forEach(preference => {
            context.preferences.set(preference.key, preference);
        });

        // Update constraints
        context.constraints.push(...extraction.constraints);

        // Update memory
        context.workingMemory.push(...extraction.memoryUpdates.working);
        context.episodicMemory.push(...extraction.memoryUpdates.episodic);
        context.semanticMemory.push(...extraction.memoryUpdates.semantic);

        // Handle topic shift
        if (extraction.topicShift.detected) {
            this.updateTopicFlow(context, extraction.topicShift);
        }

        // Update metadata
        context.lastAccessed = new Date();
        context.totalInteractions++;
        context.contextVersion++;

        // Compress context if it's getting too large
        await this.compressContextIfNeeded(context);

        // Store updated context
        this.contextStore.set(context.id, context);

        loggingService.info('🔄 Context updated', {
            userId,
            sessionId,
            contextId: context.id,
            totalEntities: context.entities.size,
            totalIntentions: context.intentions.length,
            totalPreferences: context.preferences.size,
            workingMemorySize: context.workingMemory.length
        });

        return context;
    }

    /**
     * Reconstruct relevant context for a query
     */
    public async reconstructContext(
        request: ContextReconstructionRequest
    ): Promise<ContextReconstructionResult> {
        const fullContext = this.getContextByUserAndSession(request.userId, request.sessionId);
        
        if (!fullContext) {
            return {
                relevantContext: this.createEmptyContext(request.userId, request.sessionId),
                contextSummary: 'No previous context available',
                keyEntities: [],
                activeIntentions: [],
                applicablePreferences: [],
                reconstructionStrategy: 'empty_context',
                confidence: 0
            };
        }

        // Analyze query to determine relevance
        const queryContext = this.analyzeQuery(request.query);
        
        // Filter relevant entities
        const keyEntities = this.filterRelevantEntities(fullContext, queryContext, request.focusAreas);
        
        // Filter active intentions
        const activeIntentions = this.filterActiveIntentions(fullContext, queryContext);
        
        // Filter applicable preferences
        const applicablePreferences = this.filterApplicablePreferences(fullContext, queryContext);
        
        // Reconstruct minimal context
        const relevantContext = this.buildRelevantContext(
            fullContext,
            keyEntities,
            activeIntentions,
            applicablePreferences,
            request.maxContextSize || 1000
        );

        const contextSummary = this.generateContextSummary(relevantContext, queryContext);

        loggingService.info('🔍 Context reconstructed', {
            userId: request.userId,
            sessionId: request.sessionId,
            keyEntities: keyEntities.length,
            activeIntentions: activeIntentions.length,
            applicablePreferences: applicablePreferences.length,
            contextSize: contextSummary.length
        });

        return {
            relevantContext,
            contextSummary,
            keyEntities,
            activeIntentions,
            applicablePreferences,
            reconstructionStrategy: 'relevance_based',
            confidence: this.calculateReconstructionConfidence(fullContext, relevantContext)
        };
    }

    /**
     * Get context statistics
     */
    public getContextStats(userId?: string): {
        totalContexts: number;
        activeContexts: number;
        averageEntitiesPerContext: number;
        averageIntentionsPerContext: number;
        totalMemoryEntries: number;
        contextSizeDistribution: Record<string, number>;
    } {
        let contexts = Array.from(this.contextStore.values());
        
        if (userId) {
            const userContextIds = this.contextIndex.get(userId) || new Set();
            contexts = contexts.filter(ctx => userContextIds.has(ctx.id));
        }

        const totalContexts = contexts.length;
        const activeContexts = contexts.filter(ctx => ctx.expiresAt > new Date()).length;
        
        const totalEntities = contexts.reduce((sum, ctx) => sum + ctx.entities.size, 0);
        const totalIntentions = contexts.reduce((sum, ctx) => sum + ctx.intentions.length, 0);
        const totalMemoryEntries = contexts.reduce((sum, ctx) => 
            sum + ctx.workingMemory.length + ctx.episodicMemory.length + ctx.semanticMemory.length, 0);

        const averageEntitiesPerContext = totalContexts > 0 ? totalEntities / totalContexts : 0;
        const averageIntentionsPerContext = totalContexts > 0 ? totalIntentions / totalContexts : 0;

        // Context size distribution
        const sizeDistribution: Record<string, number> = {
            'small (0-10 elements)': 0,
            'medium (11-50 elements)': 0,
            'large (51-200 elements)': 0,
            'very_large (200+ elements)': 0
        };

        contexts.forEach(ctx => {
            const size = ctx.entities.size + ctx.intentions.length + ctx.preferences.size;
            if (size <= 10) sizeDistribution['small (0-10 elements)']++;
            else if (size <= 50) sizeDistribution['medium (11-50 elements)']++;
            else if (size <= 200) sizeDistribution['large (51-200 elements)']++;
            else sizeDistribution['very_large (200+ elements)']++;
        });

        return {
            totalContexts,
            activeContexts,
            averageEntitiesPerContext: Math.round(averageEntitiesPerContext * 10) / 10,
            averageIntentionsPerContext: Math.round(averageIntentionsPerContext * 10) / 10,
            totalMemoryEntries,
            contextSizeDistribution: sizeDistribution
        };
    }

    /**
     * Clear expired contexts and perform maintenance
     */
    public async performMaintenance(): Promise<void> {
        const now = new Date();
        let expiredCount = 0;
        let compressedCount = 0;

        for (const [contextId, context] of this.contextStore.entries()) {
            if (context.expiresAt <= now) {
                // Remove expired context
                this.contextStore.delete(contextId);
                
                // Update user index
                const userContexts = this.contextIndex.get(context.userId);
                if (userContexts) {
                    userContexts.delete(contextId);
                    if (userContexts.size === 0) {
                        this.contextIndex.delete(context.userId);
                    }
                }
                
                expiredCount++;
            } else {
                // Compress large contexts
                const compressionResult = await this.compressContextIfNeeded(context);
                if (compressionResult) {
                    this.contextStore.set(contextId, compressionResult.compressedContext);
                    compressedCount++;
                }
            }
        }

        loggingService.info('🧹 Context maintenance completed', {
            expiredContexts: expiredCount,
            compressedContexts: compressedCount,
            totalContexts: this.contextStore.size
        });
    }

    /**
     * Clear all contexts for a user
     */
    public clearUserContexts(userId: string): void {
        const userContextIds = this.contextIndex.get(userId);
        if (userContextIds) {
            userContextIds.forEach(contextId => {
                this.contextStore.delete(contextId);
            });
            this.contextIndex.delete(userId);
        }
        
        loggingService.info('🗑️ User contexts cleared', { userId });
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private getOrCreateContext(userId: string, sessionId: string): ConversationContext {
        const contextKey = `${userId}:${sessionId}`;
        let context = Array.from(this.contextStore.values())
            .find(ctx => ctx.userId === userId && ctx.sessionId === sessionId);

        if (!context) {
            context = this.createEmptyContext(userId, sessionId);
            this.contextStore.set(context.id, context);
            
            // Update user index
            if (!this.contextIndex.has(userId)) {
                this.contextIndex.set(userId, new Set());
            }
            this.contextIndex.get(userId)!.add(context.id);
        }

        return context;
    }

    private createEmptyContext(userId: string, sessionId: string): ConversationContext {
        const now = new Date();
        const contextId = this.generateContextId(userId, sessionId);

        return {
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
                nextExpectedActions: [],
                branchingPoints: [],
                conversationDepth: 0
            },
            currentTopic: null,
            previousTopics: [],
            created: now,
            lastAccessed: now,
            totalInteractions: 0,
            contextVersion: 1,
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days
        };
    }

    private getContextByUserAndSession(userId: string, sessionId: string): ConversationContext | undefined {
        return Array.from(this.contextStore.values())
            .find(ctx => ctx.userId === userId && ctx.sessionId === sessionId);
    }

    private extractEntities(frame: CortexFrame): ContextEntity[] {
        const entities: ContextEntity[] = [];
        const now = new Date();

        // Extract entities from frame content
        for (const [key, value] of Object.entries(frame)) {
            if (key === 'frameType') continue;

            const entityType = this.determineEntityType(key, value);
            if (entityType) {
                const entityId = this.generateEntityId(key, value);
                
                entities.push({
                    id: entityId,
                    type: entityType,
                    name: String(value),
                    properties: new Map([['source_key', key]]),
                    relationships: [],
                    relevance: this.calculateEntityRelevance(key, value),
                    confidence: 0.8, // Default confidence
                    lastMentioned: now,
                    frequency: 1
                });
            }
        }

        return entities;
    }

    private extractIntentions(frame: CortexFrame, metadata: any): ContextIntention[] {
        const intentions: ContextIntention[] = [];
        const now = new Date();

        // Determine intention type based on frame type
        let intentionType: ContextIntention['type'] = 'query';
        if (frame.frameType === 'query') intentionType = 'query';
        else if (frame.frameType === 'event') intentionType = 'command';

        const intentionId = this.generateIntentionId(frame);
        
        intentions.push({
            id: intentionId,
            type: intentionType,
            intent: this.extractIntent(frame),
            parameters: this.extractIntentionParameters(frame),
            status: 'active',
            priority: this.calculateIntentionPriority(frame, metadata),
            created: now
        });

        return intentions;
    }

    private extractPreferences(frame: CortexFrame, metadata: any): ContextPreference[] {
        const preferences: ContextPreference[] = [];
        const now = new Date();

        // Look for preference indicators in the frame
        for (const [key, value] of Object.entries(frame)) {
            if (this.isPreferenceIndicator(key, value)) {
                preferences.push({
                    key: key,
                    value: value as ContextValue,
                    category: this.categorizePreference(key, value),
                    confidence: 0.6,
                    source: 'inferred',
                    created: now,
                    lastUsed: now
                });
            }
        }

        return preferences;
    }

    private extractConstraints(frame: CortexFrame, metadata: any): ContextConstraint[] {
        const constraints: ContextConstraint[] = [];
        const now = new Date();

        // Look for constraint indicators
        for (const [key, value] of Object.entries(frame)) {
            if (this.isConstraintIndicator(key, value)) {
                const constraintId = this.generateConstraintId(key, value);
                
                constraints.push({
                    id: constraintId,
                    type: this.categorizeConstraint(key, value),
                    description: `Constraint from ${key}: ${value}`,
                    parameters: new Map([[key, value as ContextValue]]),
                    priority: this.calculateConstraintPriority(key, value),
                    active: true,
                    created: now
                });
            }
        }

        return constraints;
    }

    private detectTopicShift(frame: CortexFrame, context: ConversationContext): {
        detected: boolean;
        from: string | null;
        to: string | null;
        confidence: number;
    } {
        const currentTopic = this.extractTopic(frame);
        const previousTopic = context.currentTopic;

        if (!currentTopic) {
            return { detected: false, from: null, to: null, confidence: 0 };
        }

        if (!previousTopic || currentTopic === previousTopic) {
            return { detected: false, from: previousTopic, to: currentTopic, confidence: 0.5 };
        }

        // Calculate topic shift confidence
        const confidence = this.calculateTopicShiftConfidence(previousTopic, currentTopic, context);

        return {
            detected: confidence > 0.7,
            from: previousTopic,
            to: currentTopic,
            confidence
        };
    }

    private createWorkingMemory(frame: CortexFrame): ContextMemoryFrame[] {
        const memoryId = this.generateMemoryId(frame);
        const now = new Date();

        return [{
            id: memoryId,
            type: 'working',
            content: frame,
            summary: this.generateFrameSummary(frame),
            importance: this.calculateMemoryImportance(frame),
            recency: 1.0, // Most recent
            frequency: 1,
            created: now,
            lastAccessed: now
        }];
    }

    private createEpisodicMemory(frame: CortexFrame, metadata: any): EpisodicMemoryEntry[] {
        if (frame.frameType !== 'event') return [];

        const memoryId = this.generateMemoryId(frame);
        const now = new Date();

        return [{
            id: memoryId,
            event: this.extractEventDescription(frame),
            timestamp: now,
            context: this.extractEventContext(frame, metadata),
            outcome: 'pending',
            entities: this.extractEventEntities(frame),
            importance: this.calculateMemoryImportance(frame)
        }];
    }

    private createSemanticMemory(frame: CortexFrame): SemanticMemoryEntry[] {
        const concepts = this.extractConcepts(frame);
        const now = new Date();

        return concepts.map(concept => ({
            id: this.generateMemoryId({ concept }),
            concept: concept.name,
            definition: concept.definition,
            relationships: concept.relationships,
            examples: concept.examples,
            category: concept.category,
            confidence: concept.confidence,
            created: now,
            lastUpdated: now
        }));
    }

    private updateTopicFlow(context: ConversationContext, topicShift: any): void {
        if (topicShift.detected && topicShift.to) {
            // Add topic transition
            context.previousTopics.push({
                from: context.currentTopic,
                to: topicShift.to,
                timestamp: new Date(),
                trigger: 'user_initiated',
                relevanceScore: topicShift.confidence
            });

            // Update current topic
            context.currentTopic = topicShift.to;
            context.conversationFlow.conversationDepth++;
        }
    }

    private async compressContextIfNeeded(context: ConversationContext): Promise<ContextCompressionResult | null> {
        const contextSize = this.calculateContextSize(context);
        const maxSize = 5000; // Maximum context size

        if (contextSize <= maxSize) return null;

        // Perform compression using hybrid strategy
        const compressionResult = this.performContextCompression(context, 'hybrid');

        loggingService.info('🗜️ Context compressed', {
            userId: context.userId,
            sessionId: context.sessionId,
            originalSize: contextSize,
            compressedSize: this.calculateContextSize(compressionResult.compressedContext),
            compressionRatio: compressionResult.compressionRatio
        });

        return compressionResult;
    }

    private performContextCompression(
        context: ConversationContext,
        strategy: 'importance' | 'recency' | 'frequency' | 'hybrid'
    ): ContextCompressionResult {
        const originalElementCount = this.countContextElements(context);
        const compressed = { ...context };

        // Compress working memory
        compressed.workingMemory = this.compressMemory(context.workingMemory, strategy, 0.3);

        // Compress episodic memory
        compressed.episodicMemory = this.compressEpisodicMemory(context.episodicMemory, strategy, 0.5);

        // Clean up old intentions
        compressed.intentions = context.intentions.filter(intention => 
            intention.status === 'active' || intention.status === 'pending'
        );

        // Remove low-relevance entities
        const relevantEntities = new Map<string, ContextEntity>();
        for (const [id, entity] of context.entities) {
            if (entity.relevance > 0.3 || entity.frequency > 2) {
                relevantEntities.set(id, entity);
            }
        }
        compressed.entities = relevantEntities;

        const compressedElementCount = this.countContextElements(compressed);
        const compressionRatio = 1 - (compressedElementCount / originalElementCount);

        return {
            compressedContext: compressed,
            compressionRatio,
            retainedElements: compressedElementCount,
            discardedElements: originalElementCount - compressedElementCount,
            compressionStrategy: strategy
        };
    }

    // Helper methods with simplified implementations
    private generateContextId(userId: string, sessionId: string): string {
        return crypto.createHash('md5').update(`${userId}:${sessionId}:${Date.now()}`).digest('hex');
    }

    private generateEntityId(key: string, value: any): string {
        return crypto.createHash('md5').update(`entity:${key}:${String(value)}`).digest('hex');
    }

    private generateIntentionId(frame: CortexFrame): string {
        return crypto.createHash('md5').update(`intention:${JSON.stringify(frame)}`).digest('hex');
    }

    private generateConstraintId(key: string, value: any): string {
        return crypto.createHash('md5').update(`constraint:${key}:${String(value)}`).digest('hex');
    }

    private generateMemoryId(content: any): string {
        return crypto.createHash('md5').update(`memory:${JSON.stringify(content)}:${Date.now()}`).digest('hex');
    }

    private determineEntityType(key: string, value: any): ContextEntity['type'] | null {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('person') || keyLower.includes('user')) return 'person';
        if (keyLower.includes('place') || keyLower.includes('location')) return 'location';
        if (keyLower.includes('organization') || keyLower.includes('company')) return 'organization';
        if (keyLower.includes('event') || keyLower.includes('meeting')) return 'event';
        if (keyLower.includes('concept') || keyLower.includes('idea')) return 'concept';
        return 'object';
    }

    private calculateEntityRelevance(key: string, value: any): number {
        // Simple relevance calculation
        let score = 0.5;
        if (key.includes('important') || key.includes('key')) score += 0.3;
        if (String(value).length > 20) score += 0.2; // More detailed entities are more relevant
        return Math.min(1.0, score);
    }

    private extractIntent(frame: CortexFrame): string {
        return `${frame.frameType} operation`;
    }

    private extractIntentionParameters(frame: CortexFrame): Map<string, ContextValue> {
        const params = new Map<string, ContextValue>();
        for (const [key, value] of Object.entries(frame)) {
            if (key !== 'frameType') {
                params.set(key, value as ContextValue);
            }
        }
        return params;
    }

    private calculateIntentionPriority(frame: CortexFrame, metadata: any): number {
        // Default priority
        let priority = 5;
        if (frame.frameType === 'query') priority = 7;
        if (metadata?.urgent) priority = 9;
        return priority;
    }

    private isPreferenceIndicator(key: string, value: any): boolean {
        const preferenceKeywords = ['prefer', 'like', 'want', 'style', 'format'];
        return preferenceKeywords.some(keyword => key.toLowerCase().includes(keyword));
    }

    private categorizePreference(key: string, value: any): ContextPreference['category'] {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('format')) return 'output_format';
        if (keyLower.includes('style')) return 'communication_style';
        if (keyLower.includes('domain') || keyLower.includes('topic')) return 'domain_preference';
        return 'personalization';
    }

    private isConstraintIndicator(key: string, value: any): boolean {
        const constraintKeywords = ['limit', 'max', 'min', 'must', 'cannot', 'restrict'];
        return constraintKeywords.some(keyword => key.toLowerCase().includes(keyword));
    }

    private categorizeConstraint(key: string, value: any): ContextConstraint['type'] {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('time') || keyLower.includes('deadline')) return 'time';
        if (keyLower.includes('private') || keyLower.includes('confidential')) return 'privacy';
        if (keyLower.includes('format') || keyLower.includes('structure')) return 'format';
        if (keyLower.includes('scope') || keyLower.includes('limit')) return 'scope';
        return 'resource';
    }

    private calculateConstraintPriority(key: string, value: any): number {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('must') || keyLower.includes('required')) return 9;
        if (keyLower.includes('should') || keyLower.includes('prefer')) return 6;
        return 3;
    }

    private extractTopic(frame: CortexFrame): string | null {
        // Simple topic extraction
        const content = JSON.stringify(frame);
        const topics = ['user', 'data', 'system', 'analysis', 'report'];
        return topics.find(topic => content.toLowerCase().includes(topic)) || null;
    }

    private calculateTopicShiftConfidence(previous: string, current: string, context: ConversationContext): number {
        if (previous === current) return 0;
        
        // Simple confidence calculation
        const recentTopics = context.previousTopics.slice(-3).map(t => t.to);
        const isNewTopic = !recentTopics.includes(current);
        
        return isNewTopic ? 0.8 : 0.6;
    }

    private generateFrameSummary(frame: CortexFrame): string {
        return `${frame.frameType} frame with ${Object.keys(frame).length - 1} properties`;
    }

    private calculateMemoryImportance(frame: CortexFrame): number {
        // Simple importance calculation
        let importance = 0.5;
        if (frame.frameType === 'query') importance = 0.7;
        if (frame.frameType === 'event') importance = 0.8;
        return importance;
    }

    private extractEventDescription(frame: CortexFrame): string {
        return `Event frame processed`;
    }

    private extractEventContext(frame: CortexFrame, metadata: any): string {
        return `Context: ${JSON.stringify(metadata)}`;
    }

    private extractEventEntities(frame: CortexFrame): string[] {
        return Object.keys(frame).filter(k => k !== 'frameType');
    }

    private extractConcepts(frame: CortexFrame): Array<{
        name: string;
        definition: string;
        relationships: string[];
        examples: string[];
        category: string;
        confidence: number;
    }> {
        // Simple concept extraction
        return [{
            name: frame.frameType,
            definition: `A ${frame.frameType} frame in Cortex`,
            relationships: [],
            examples: [JSON.stringify(frame)],
            category: 'frame_type',
            confidence: 0.9
        }];
    }

    private calculateContextSize(context: ConversationContext): number {
        return JSON.stringify(context).length;
    }

    private countContextElements(context: ConversationContext): number {
        return context.entities.size + 
               context.intentions.length + 
               context.preferences.size + 
               context.constraints.length +
               context.workingMemory.length + 
               context.episodicMemory.length + 
               context.semanticMemory.length;
    }

    private compressMemory(
        memory: ContextMemoryFrame[], 
        strategy: string, 
        retentionRatio: number
    ): ContextMemoryFrame[] {
        const targetCount = Math.ceil(memory.length * retentionRatio);
        return memory
            .sort((a, b) => (b.importance + b.recency) - (a.importance + a.recency))
            .slice(0, targetCount);
    }

    private compressEpisodicMemory(
        memory: EpisodicMemoryEntry[], 
        strategy: string, 
        retentionRatio: number
    ): EpisodicMemoryEntry[] {
        const targetCount = Math.ceil(memory.length * retentionRatio);
        return memory
            .sort((a, b) => b.importance - a.importance)
            .slice(0, targetCount);
    }

    private analyzeQuery(query: string): any {
        return {
            keywords: query.split(' '),
            entities: [],
            intent: 'query'
        };
    }

    private filterRelevantEntities(
        context: ConversationContext, 
        queryContext: any, 
        focusAreas?: string[]
    ): ContextEntity[] {
        return Array.from(context.entities.values())
            .filter(entity => entity.relevance > 0.5)
            .slice(0, 10); // Top 10 most relevant
    }

    private filterActiveIntentions(context: ConversationContext, queryContext: any): ContextIntention[] {
        return context.intentions.filter(intention => 
            intention.status === 'active' || intention.status === 'pending'
        );
    }

    private filterApplicablePreferences(context: ConversationContext, queryContext: any): ContextPreference[] {
        return Array.from(context.preferences.values())
            .filter(pref => pref.confidence > 0.5);
    }

    private buildRelevantContext(
        fullContext: ConversationContext,
        entities: ContextEntity[],
        intentions: ContextIntention[],
        preferences: ContextPreference[],
        maxSize: number
    ): ConversationContext {
        const relevantContext = { ...fullContext };
        
        // Replace with filtered data
        relevantContext.entities = new Map(entities.map(e => [e.id, e]));
        relevantContext.intentions = intentions;
        relevantContext.preferences = new Map(preferences.map(p => [p.key, p]));
        
        // Keep only most important memory
        relevantContext.workingMemory = fullContext.workingMemory
            .sort((a, b) => (b.importance + b.recency) - (a.importance + a.recency))
            .slice(0, 5);

        return relevantContext;
    }

    private generateContextSummary(context: ConversationContext, queryContext: any): string {
        const parts = [];
        
        parts.push(`Context for user ${context.userId} in session ${context.sessionId}`);
        parts.push(`Total interactions: ${context.totalInteractions}`);
        parts.push(`Current topic: ${context.currentTopic || 'none'}`);
        parts.push(`Active entities: ${context.entities.size}`);
        parts.push(`Active intentions: ${context.intentions.filter(i => i.status === 'active').length}`);
        parts.push(`User preferences: ${context.preferences.size}`);
        
        return parts.join('. ');
    }

    private calculateReconstructionConfidence(full: ConversationContext, relevant: ConversationContext): number {
        const fullSize = this.countContextElements(full);
        const relevantSize = this.countContextElements(relevant);
        
        if (fullSize === 0) return 0;
        return Math.min(1.0, 0.5 + (relevantSize / fullSize) * 0.5);
    }

    private initializeContextManagement(): void {
        loggingService.info('🧠 Context manager initialized', {
            maxContextSize: '5KB',
            cleanupInterval: '1 hour',
            defaultExpiry: '7 days'
        });
    }

    private startCleanupScheduler(): void {
        // Run maintenance every hour
        this.cleanupInterval = setInterval(async () => {
            await this.performMaintenance();
        }, 60 * 60 * 1000);
    }

    /**
     * Shutdown and cleanup
     */
    public shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        loggingService.info('🛑 Context manager shutdown');
    }
}
