/**
 * Semantic Primitives Types
 * 
 * Core types for the Cortex Semantic Abstract Syntax Tree (SAST) system.
 * These types define the fundamental semantic building blocks that replace
 * natural language tokens with unambiguous, universal semantic primitives.
 */

// ============================================================================
// SEMANTIC PRIMITIVE IDENTIFIERS
// ============================================================================

/**
 * Base semantic primitive identifier format
 * Examples: concept_1123, action_54, property_789
 */
export type SemanticPrimitiveId = string;

/**
 * Semantic primitive categories
 */
export enum SemanticCategory {
    CONCEPT = 'concept',        // Nouns, entities, things
    ACTION = 'action',         // Verbs, activities, processes  
    PROPERTY = 'property',     // Adjectives, attributes, qualities
    RELATION = 'relation',     // Prepositions, relationships
    QUANTITY = 'quantity',     // Numbers, measurements, amounts
    TIME = 'time',            // Temporal expressions, tenses
    LOCATION = 'location',     // Spatial expressions, places
    MODALITY = 'modality',     // Modal expressions, possibility
    LOGICAL = 'logical',       // Logical operators, connectives
    DISCOURSE = 'discourse'    // Discourse markers, pragmatics
}

/**
 * Semantic primitive with metadata
 */
export interface SemanticPrimitive {
    id: SemanticPrimitiveId;
    category: SemanticCategory;
    baseForm: string;           // Canonical form (e.g., "jump")
    definition: string;         // Semantic definition
    synonyms: string[];         // Natural language synonyms
    translations: Record<string, string[]>; // Cross-lingual mappings
    frequency: number;          // Usage frequency score
    abstractness: number;       // Concrete (0) to abstract (1)
    relationships: SemanticRelationship[];
    created: Date;
    lastUpdated: Date;
}

/**
 * Relationships between semantic primitives
 */
export interface SemanticRelationship {
    type: RelationType;
    targetId: SemanticPrimitiveId;
    strength: number;          // 0-1 relationship strength
    context?: string;          // Optional context for relationship
}

export enum RelationType {
    SYNONYM = 'synonym',       // Same meaning
    ANTONYM = 'antonym',       // Opposite meaning
    HYPERNYM = 'hypernym',     // More general concept
    HYPONYM = 'hyponym',       // More specific concept
    MERONYM = 'meronym',       // Part of relationship
    HOLONYM = 'holonym',       // Whole of relationship
    ENTAILMENT = 'entailment', // Logical entailment
    CAUSATION = 'causation',   // Causal relationship
    ASSOCIATION = 'association' // General association
}

// ============================================================================
// SEMANTIC MAPPING STRUCTURES
// ============================================================================

/**
 * Mapping from natural language to semantic primitives
 */
export interface LanguageToPrimitiveMapping {
    language: string;           // ISO 639-1 language code
    sourceText: string;         // Original natural language text
    primitives: SemanticPrimitiveMatch[];
    confidence: number;         // Overall mapping confidence
    ambiguity: AmbiguityResolution[];
}

/**
 * Individual primitive match in mapping
 */
export interface SemanticPrimitiveMatch {
    primitiveId: SemanticPrimitiveId;
    sourceSpan: [number, number];  // Character positions in source
    confidence: number;
    alternatives: AlternativeMatch[]; // Other possible mappings
}

/**
 * Alternative semantic primitive matches
 */
export interface AlternativeMatch {
    primitiveId: SemanticPrimitiveId;
    confidence: number;
    reason: string;
}

/**
 * Ambiguity resolution record
 */
export interface AmbiguityResolution {
    ambiguousSpan: [number, number];
    possibleInterpretations: SemanticInterpretation[];
    chosenInterpretation: SemanticInterpretation;
    resolutionStrategy: string;
    confidence: number;
}

/**
 * Semantic interpretation of ambiguous text
 */
export interface SemanticInterpretation {
    interpretation: string;
    primitives: SemanticPrimitiveId[];
    syntacticStructure: SyntacticNode;
    likelihood: number;
}

/**
 * Syntactic parse tree node for disambiguation
 */
export interface SyntacticNode {
    type: string;              // POS tag or phrase type
    span: [number, number];    // Character positions
    children: SyntacticNode[];
    semanticRole?: string;     // Semantic role (agent, patient, etc.)
    primitive?: SemanticPrimitiveId;
}

// ============================================================================
// CORTEX SAST STRUCTURES
// ============================================================================

/**
 * Enhanced Cortex frame using semantic primitives
 */
export interface SemanticCortexFrame {
    frameType: 'event' | 'state' | 'query' | 'concept' | 'relation';
    primitives: Record<string, SemanticPrimitiveValue>;
    metadata: SemanticFrameMetadata;
}

/**
 * Semantic primitive value in Cortex frame
 */
export type SemanticPrimitiveValue = 
    | SemanticPrimitiveId 
    | SemanticCortexFrame 
    | SemanticPrimitiveId[] 
    | number 
    | boolean;

/**
 * Metadata for semantic Cortex frames
 */
export interface SemanticFrameMetadata {
    sourceLanguage: string;
    confidence: number;
    ambiguityResolved: boolean;
    parseComplexity: number;
    primitiveCount: number;
    crossLingualEquivalent: boolean;
}

// ============================================================================
// VOCABULARY MANAGEMENT
// ============================================================================

/**
 * Semantic vocabulary statistics
 */
export interface SemanticVocabularyStats {
    totalPrimitives: number;
    primitivesByCategory: Record<SemanticCategory, number>;
    averageTranslations: number;
    coverageByLanguage: Record<string, number>;
    lastUpdated: Date;
}

/**
 * Vocabulary search query
 */
export interface SemanticSearchQuery {
    term?: string;
    category?: SemanticCategory;
    language?: string;
    minFrequency?: number;
    maxAbstractness?: number;
    includeRelationships?: boolean;
    limit?: number;
}

/**
 * Vocabulary search result
 */
export interface SemanticSearchResult {
    primitive: SemanticPrimitive;
    relevanceScore: number;
    matchType: 'exact' | 'synonym' | 'translation' | 'relationship';
}

// ============================================================================
// CROSS-LINGUAL SUPPORT
// ============================================================================

/**
 * Cross-lingual semantic equivalence
 */
export interface CrossLingualEquivalence {
    primitiveId: SemanticPrimitiveId;
    languageMappings: Record<string, LanguageMapping[]>;
    universalConfidence: number; // How well this maps across languages
}

/**
 * Language-specific mapping
 */
export interface LanguageMapping {
    terms: string[];
    confidence: number;
    context: string[];          // Contexts where this mapping applies
    frequency: number;          // Usage frequency in this language
}

// All types are exported above with their declarations
