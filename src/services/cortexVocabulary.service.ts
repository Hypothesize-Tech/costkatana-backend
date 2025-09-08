/**
 * Cortex Vocabulary Service
 * 
 * This service manages the Core Primitives Vocabulary (CPV) for the Cortex meta-language.
 * It provides semantic primitives, frame definitions, and mapping functions that form
 * the foundation of Cortex's structured representation system.
 */

import { CortexPrimitive, CortexFrameType, CortexRole, CortexFrame } from '../types/cortex.types';
import { loggingService } from './logging.service';

// ============================================================================
// CORE PRIMITIVES VOCABULARY (CPV v1.0)
// ============================================================================

/**
 * Action primitives - verbs and operations that can be performed
 */
export const ACTION_PRIMITIVES: Record<string, { id: CortexPrimitive; definition: string; aliases: string[] }> = {
    'get': {
        id: 'action_get',
        definition: 'Retrieve or find information',
        aliases: ['fetch', 'obtain', 'acquire', 'retrieve', 'find']
    },
    'create': {
        id: 'action_create',
        definition: 'Generate new content or objects',
        aliases: ['generate', 'make', 'build', 'produce', 'construct']
    },
    'summarize': {
        id: 'action_summarize',
        definition: 'Create a concise summary of content',
        aliases: ['summarise', 'condense', 'abstract', 'brief', 'outline']
    },
    'analyze': {
        id: 'action_analyze',
        definition: 'Examine in detail to identify patterns or causes',
        aliases: ['analyse', 'examine', 'study', 'investigate', 'evaluate']
    },
    'compare': {
        id: 'action_compare',
        definition: 'Find similarities and differences between items',
        aliases: ['contrast', 'evaluate', 'assess', 'match', 'differentiate']
    },
    'translate': {
        id: 'action_translate',
        definition: 'Convert from one form or language to another',
        aliases: ['convert', 'transform', 'render', 'adapt', 'interpret']
    },
    'list': {
        id: 'action_list',
        definition: 'Enumerate items belonging to a category',
        aliases: ['enumerate', 'catalog', 'itemize', 'index', 'inventory']
    },
    'explain': {
        id: 'action_explain',
        definition: 'Describe how or why something works',
        aliases: ['describe', 'clarify', 'elucidate', 'interpret', 'detail']
    },
    'optimize': {
        id: 'action_optimize',
        definition: 'Improve efficiency or performance',
        aliases: ['improve', 'enhance', 'streamline', 'refine', 'perfect']
    },
    'search': {
        id: 'action_search',
        definition: 'Look for specific information or items',
        aliases: ['find', 'seek', 'hunt', 'locate', 'discover']
    }
};

/**
 * Concept primitives - nouns and entities in the domain
 */
export const CONCEPT_PRIMITIVES: Record<string, { id: CortexPrimitive; definition: string; aliases: string[] }> = {
    'document': {
        id: 'concept_document',
        definition: 'A text-based document or file',
        aliases: ['file', 'text', 'paper', 'article', 'content']
    },
    'report': {
        id: 'concept_report',
        definition: 'A formal document with structured data and analysis',
        aliases: ['analysis', 'study', 'assessment', 'evaluation', 'findings']
    },
    'person': {
        id: 'concept_person',
        definition: 'A human being or individual',
        aliases: ['user', 'individual', 'human', 'people', 'someone']
    },
    'organization': {
        id: 'concept_organization',
        definition: 'A company, institution, or structured group',
        aliases: ['company', 'business', 'institution', 'corporation', 'entity']
    },
    'data': {
        id: 'concept_data',
        definition: 'Raw, structured, or processed information',
        aliases: ['information', 'dataset', 'records', 'content', 'facts']
    },
    'system': {
        id: 'concept_system',
        definition: 'A organized collection of components working together',
        aliases: ['platform', 'application', 'software', 'service', 'infrastructure']
    },
    'meeting': {
        id: 'concept_meeting',
        definition: 'A scheduled gathering of people for discussion',
        aliases: ['conference', 'session', 'gathering', 'discussion', 'call']
    },
    'project': {
        id: 'concept_project',
        definition: 'A temporary endeavor with specific goals',
        aliases: ['initiative', 'task', 'assignment', 'work', 'effort']
    },
    'model': {
        id: 'concept_model',
        definition: 'An AI model or machine learning system',
        aliases: ['ai', 'algorithm', 'neural_network', 'llm', 'ml_model']
    },
    'cost': {
        id: 'concept_cost',
        definition: 'Financial expense or resource consumption',
        aliases: ['expense', 'price', 'fee', 'charge', 'budget']
    }
};

/**
 * Property primitives - adjectives and descriptive attributes
 */
export const PROPERTY_PRIMITIVES: Record<string, { id: CortexPrimitive; definition: string; aliases: string[] }> = {
    'name': {
        id: 'prop_name',
        definition: 'The identifying name or title of an entity',
        aliases: ['title', 'label', 'identifier', 'designation']
    },
    'sentiment': {
        id: 'prop_sentiment',
        definition: 'The emotional tone or feeling (positive, negative, neutral)',
        aliases: ['emotion', 'feeling', 'mood', 'attitude', 'tone']
    },
    'topic': {
        id: 'prop_topic',
        definition: 'The subject matter or theme',
        aliases: ['subject', 'theme', 'matter', 'focus', 'area']
    },
    'status': {
        id: 'prop_status',
        definition: 'The current state or condition',
        aliases: ['state', 'condition', 'situation', 'stage', 'phase']
    },
    'priority': {
        id: 'prop_priority',
        definition: 'The level of importance or urgency',
        aliases: ['importance', 'urgency', 'criticality', 'ranking']
    },
    'quality': {
        id: 'prop_quality',
        definition: 'The standard or grade of excellence',
        aliases: ['grade', 'standard', 'level', 'caliber', 'excellence']
    },
    'performance': {
        id: 'prop_performance',
        definition: 'How well something functions or operates',
        aliases: ['efficiency', 'effectiveness', 'results', 'output']
    },
    'complexity': {
        id: 'prop_complexity',
        definition: 'The degree of difficulty or intricacy',
        aliases: ['difficulty', 'sophistication', 'intricacy', 'complication']
    },
    'accuracy': {
        id: 'prop_accuracy',
        definition: 'The correctness or precision of information',
        aliases: ['precision', 'correctness', 'exactness', 'fidelity']
    },
    'size': {
        id: 'prop_size',
        definition: 'The dimensions, magnitude, or scale',
        aliases: ['scale', 'magnitude', 'dimensions', 'volume', 'extent']
    }
};

/**
 * Modifier primitives - logical operators and special values
 */
export const MODIFIER_PRIMITIVES: Record<string, { id: CortexPrimitive; definition: string; aliases: string[] }> = {
    'latest': {
        id: 'mod_latest',
        definition: 'The most recent item in a sequence',
        aliases: ['newest', 'most_recent', 'current', 'last']
    },
    'previous': {
        id: 'mod_previous',
        definition: 'The item immediately preceding the current one',
        aliases: ['former', 'earlier', 'prior', 'preceding']
    },
    'all': {
        id: 'mod_all',
        definition: 'Every item in a set or collection',
        aliases: ['every', 'each', 'entire', 'complete', 'whole']
    },
    'and': {
        id: 'mod_and',
        definition: 'A logical AND operator for combining conditions',
        aliases: ['plus', 'combined_with', 'along_with', 'together_with']
    },
    'or': {
        id: 'mod_or',
        definition: 'A logical OR operator for alternative conditions',
        aliases: ['alternatively', 'either', 'otherwise', 'instead']
    },
    'not': {
        id: 'mod_not',
        definition: 'A logical NOT operator for negation',
        aliases: ['exclude', 'without', 'except', 'minus']
    },
    'high': {
        id: 'mod_high',
        definition: 'Above average or elevated level',
        aliases: ['elevated', 'increased', 'significant', 'major']
    },
    'low': {
        id: 'mod_low',
        definition: 'Below average or reduced level',
        aliases: ['reduced', 'minimal', 'minor', 'slight']
    },
    'best': {
        id: 'mod_best',
        definition: 'The highest quality or most optimal option',
        aliases: ['optimal', 'top', 'finest', 'superior', 'excellent']
    },
    'fast': {
        id: 'mod_fast',
        definition: 'Quick or high-speed processing',
        aliases: ['quick', 'rapid', 'speedy', 'swift', 'efficient']
    }
};

// ============================================================================
// FRAME TEMPLATES AND PATTERNS
// ============================================================================

/**
 * Common frame templates for different types of queries and operations
 */
export const FRAME_TEMPLATES: Record<string, Partial<CortexFrame>> = {
    'information_request': {
        frameType: 'query',
        action: 'action_get',
    },
    'analysis_request': {
        frameType: 'query',
        action: 'action_analyze',
    },
    'comparison_request': {
        frameType: 'query',
        action: 'action_compare',
    },
    'optimization_request': {
        frameType: 'query',
        action: 'action_optimize',
    },
    'list_request': {
        frameType: 'query',
        action: 'action_list',
    },
    'summary_request': {
        frameType: 'query',
        action: 'action_summarize',
    },
    'simple_answer': {
        frameType: 'answer',
        status: 'success',
    },
    'list_answer': {
        frameType: 'list',
    },
    'error_response': {
        frameType: 'error',
        code: 'PROCESSING_ERROR',
    }
};

/**
 * Role mapping for common linguistic patterns
 */
export const ROLE_MAPPINGS: Record<string, CortexRole> = {
    'what': 'target',
    'who': 'agent',
    'when': 'time',
    'where': 'location',
    'why': 'reason',
    'how': 'instrument',
    'which': 'target',
    'whom': 'object',
    'whose': 'agent'
};

// ============================================================================
// VOCABULARY SERVICE CLASS
// ============================================================================

export class CortexVocabularyService {
    private static instance: CortexVocabularyService;
    private initialized = false;
    private vocabularyCache = new Map<string, CortexPrimitive>();
    private reverseVocabularyCache = new Map<CortexPrimitive, string[]>();

    private constructor() {}

    /**
     * Get singleton instance of the vocabulary service
     */
    public static getInstance(): CortexVocabularyService {
        if (!CortexVocabularyService.instance) {
            CortexVocabularyService.instance = new CortexVocabularyService();
        }
        return CortexVocabularyService.instance;
    }

    /**
     * Initialize the vocabulary service and build caches
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('🧠 Initializing Cortex Vocabulary Service...');

            // Build vocabulary caches
            this.buildVocabularyCaches();

            this.initialized = true;
            loggingService.info('✅ Cortex Vocabulary Service initialized successfully', {
                actionPrimitives: Object.keys(ACTION_PRIMITIVES).length,
                conceptPrimitives: Object.keys(CONCEPT_PRIMITIVES).length,
                propertyPrimitives: Object.keys(PROPERTY_PRIMITIVES).length,
                modifierPrimitives: Object.keys(MODIFIER_PRIMITIVES).length,
                totalCacheEntries: this.vocabularyCache.size
            });

        } catch (error) {
            loggingService.error('❌ Failed to initialize Cortex Vocabulary Service', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Build internal caches for fast vocabulary lookup
     */
    private buildVocabularyCaches(): void {
        const allPrimitives = [
            ...Object.entries(ACTION_PRIMITIVES),
            ...Object.entries(CONCEPT_PRIMITIVES),
            ...Object.entries(PROPERTY_PRIMITIVES),
            ...Object.entries(MODIFIER_PRIMITIVES)
        ];

        for (const [key, primitive] of allPrimitives) {
            // Add primary key
            this.vocabularyCache.set(key.toLowerCase(), primitive.id);
            
            // Add aliases
            for (const alias of primitive.aliases) {
                this.vocabularyCache.set(alias.toLowerCase(), primitive.id);
            }

            // Build reverse cache for lookups
            const existingAliases = this.reverseVocabularyCache.get(primitive.id) || [];
            this.reverseVocabularyCache.set(primitive.id, [...existingAliases, key, ...primitive.aliases]);
        }
    }

    /**
     * Find the best Cortex primitive for a given word or phrase
     */
    public findPrimitive(word: string): CortexPrimitive | null {
        if (!this.initialized) {
            throw new Error('Cortex Vocabulary Service not initialized. Call initialize() first.');
        }

        const normalized = word.toLowerCase().trim();
        return this.vocabularyCache.get(normalized) || null;
    }

    /**
     * Find multiple primitives for a list of words
     */
    public findPrimitives(words: string[]): Array<{ word: string; primitive: CortexPrimitive | null }> {
        return words.map(word => ({
            word,
            primitive: this.findPrimitive(word)
        }));
    }

    /**
     * Get human-readable aliases for a Cortex primitive
     */
    public getAliases(primitive: CortexPrimitive): string[] {
        return this.reverseVocabularyCache.get(primitive) || [];
    }

    /**
     * Get definition for a primitive
     */
    public getDefinition(primitive: CortexPrimitive): string {
        const allPrimitives = [
            ...Object.values(ACTION_PRIMITIVES),
            ...Object.values(CONCEPT_PRIMITIVES),
            ...Object.values(PROPERTY_PRIMITIVES),
            ...Object.values(MODIFIER_PRIMITIVES)
        ];

        const found = allPrimitives.find(p => p.id === primitive);
        return found?.definition || 'Unknown primitive';
    }

    /**
     * Detect the most likely frame type based on input text
     */
    public detectFrameType(text: string): CortexFrameType {
        const normalized = text.toLowerCase().trim();
        
        // Question patterns
        if (normalized.match(/^(what|who|when|where|why|how|which)/)) {
            return 'query';
        }
        
        // Action patterns (past tense verbs)
        if (normalized.match(/\b(created|analyzed|processed|completed|finished)\b/)) {
            return 'event';
        }
        
        // State/description patterns
        if (normalized.match(/\b(is|are|was|were|has|have)\b.*\b(status|state|condition)\b/)) {
            return 'state';
        }
        
        // List patterns
        if (normalized.match(/^(list|show|display|enumerate)/) || normalized.includes('are:')) {
            return 'list';
        }
        
        // Error patterns
        if (normalized.match(/\b(error|failed|exception|invalid)\b/)) {
            return 'error';
        }
        
        // Default to query for most cases
        return 'query';
    }

    /**
     * Extract semantic roles from text using linguistic patterns
     */
    public extractRoles(text: string): Array<{ role: CortexRole; value: string; confidence: number }> {
        const roles: Array<{ role: CortexRole; value: string; confidence: number }> = [];
        const normalized = text.toLowerCase();

        // Extract question words and map to roles
        for (const [pattern, role] of Object.entries(ROLE_MAPPINGS)) {
            const regex = new RegExp(`\\b${pattern}\\b`, 'i');
            const match = normalized.match(regex);
            if (match) {
                roles.push({
                    role,
                    value: pattern,
                    confidence: 0.8
                });
            }
        }

        // Extract entities (capitalized words as potential agents)
        const entityMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
        if (entityMatches) {
            for (const entity of entityMatches.slice(0, 3)) { // Limit to first 3
                roles.push({
                    role: 'agent',
                    value: entity,
                    confidence: 0.6
                });
            }
        }

        // Extract quoted strings as potential content
        const quotedMatches = text.match(/"([^"]*)"/g);
        if (quotedMatches) {
            for (const quoted of quotedMatches.slice(0, 2)) { // Limit to first 2
                roles.push({
                    role: 'content',
                    value: quoted.slice(1, -1), // Remove quotes
                    confidence: 0.7
                });
            }
        }

        return roles;
    }

    /**
     * Get frame template based on detected intent
     */
    public getFrameTemplate(intent: string): Partial<CortexFrame> | null {
        const template = FRAME_TEMPLATES[intent];
        return template ? { ...template } : null;
    }

    /**
     * Validate if a Cortex primitive is known in the vocabulary
     */
    public isValidPrimitive(primitive: string): primitive is CortexPrimitive {
        return this.reverseVocabularyCache.has(primitive as CortexPrimitive);
    }

    /**
     * Search primitives by category
     */
    public searchPrimitives(category: 'action' | 'concept' | 'property' | 'modifier', query: string): CortexPrimitive[] {
        const sourceMap = {
            action: ACTION_PRIMITIVES,
            concept: CONCEPT_PRIMITIVES,
            property: PROPERTY_PRIMITIVES,
            modifier: MODIFIER_PRIMITIVES
        };

        const primitives = Object.entries(sourceMap[category]);
        const queryLower = query.toLowerCase();

        return primitives
            .filter(([key, primitive]) => 
                key.includes(queryLower) || 
                primitive.definition.toLowerCase().includes(queryLower) ||
                primitive.aliases.some(alias => alias.includes(queryLower))
            )
            .map(([, primitive]) => primitive.id)
            .slice(0, 10); // Limit results
    }

    /**
     * Get vocabulary statistics
     */
    public getVocabularyStats(): {
        actions: number;
        concepts: number;
        properties: number;
        modifiers: number;
        total: number;
        cacheSize: number;
    } {
        return {
            actions: Object.keys(ACTION_PRIMITIVES).length,
            concepts: Object.keys(CONCEPT_PRIMITIVES).length,
            properties: Object.keys(PROPERTY_PRIMITIVES).length,
            modifiers: Object.keys(MODIFIER_PRIMITIVES).length,
            total: Object.keys(ACTION_PRIMITIVES).length + 
                   Object.keys(CONCEPT_PRIMITIVES).length + 
                   Object.keys(PROPERTY_PRIMITIVES).length + 
                   Object.keys(MODIFIER_PRIMITIVES).length,
            cacheSize: this.vocabularyCache.size
        };
    }

    /**
     * Suggest similar primitives for unknown words
     */
    public suggestPrimitives(word: string, limit: number = 5): Array<{ primitive: CortexPrimitive; score: number }> {
        const suggestions: Array<{ primitive: CortexPrimitive; score: number }> = [];
        const queryLower = word.toLowerCase();

        for (const [cacheKey, primitive] of this.vocabularyCache.entries()) {
            // Simple similarity scoring based on string inclusion
            let score = 0;
            
            if (cacheKey === queryLower) {
                score = 1.0;
            } else if (cacheKey.includes(queryLower) || queryLower.includes(cacheKey)) {
                score = 0.8;
            } else if (this.calculateLevenshteinDistance(queryLower, cacheKey) <= 2) {
                score = 0.6;
            }

            if (score > 0) {
                // Avoid duplicates
                const existing = suggestions.find(s => s.primitive === primitive);
                if (!existing || existing.score < score) {
                    if (existing) {
                        existing.score = score;
                    } else {
                        suggestions.push({ primitive, score });
                    }
                }
            }
        }

        return suggestions
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Simple Levenshtein distance calculation for string similarity
     */
    private calculateLevenshteinDistance(str1: string, str2: string): number {
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

    /**
     * Export vocabulary for external use or debugging
     */
    public exportVocabulary(): {
        actions: typeof ACTION_PRIMITIVES;
        concepts: typeof CONCEPT_PRIMITIVES;
        properties: typeof PROPERTY_PRIMITIVES;
        modifiers: typeof MODIFIER_PRIMITIVES;
        frameTemplates: typeof FRAME_TEMPLATES;
        roleMappings: typeof ROLE_MAPPINGS;
    } {
        return {
            actions: ACTION_PRIMITIVES,
            concepts: CONCEPT_PRIMITIVES,
            properties: PROPERTY_PRIMITIVES,
            modifiers: MODIFIER_PRIMITIVES,
            frameTemplates: FRAME_TEMPLATES,
            roleMappings: ROLE_MAPPINGS
        };
    }
}
