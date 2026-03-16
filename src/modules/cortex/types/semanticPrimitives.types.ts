/**
 * Semantic Primitives Types
 *
 * This file defines the semantic primitives and basic structures used by the Cortex system.
 * These primitives form the foundation for semantic understanding and processing.
 */

import { CortexFrame, CortexValue } from './cortex.types';

// ============================================================================
// SEMANTIC FRAME DEFINITIONS
// ============================================================================

/**
 * Semantic Cortex Frame - Enhanced frame with semantic processing capabilities
 */
export interface SemanticCortexFrame {
  /** Frame identifier */
  id: string;

  /** Frame type */
  frameType: string;

  /** Semantic roles mapping */
  roles: Record<string, SemanticRole>;

  /** Processing confidence */
  confidence: number;

  /** Semantic metadata */
  metadata: {
    source: string;
    timestamp: Date;
    model: string;
    processingTime: number;
    language?: string;
    sentiment?: string;
    complexity?: string;
  };

  /** Frame relationships */
  relationships?: {
    parent?: string;
    children?: string[];
    related?: string[];
    dependencies?: string[];
  };

  /** Validation results */
  validation?: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    score: number;
  };
}

/**
 * Semantic Role - A slot in a semantic frame with semantic information
 */
export interface SemanticRole {
  /** Role name */
  name: string;

  /** Role value */
  value: CortexValue;

  /** Semantic type information */
  semanticType?: string;

  /** Confidence in role assignment */
  confidence: number;

  /** Role constraints */
  constraints?: {
    required: boolean;
    type: string;
    domain?: string[];
    range?: any[];
  };

  /** Semantic features */
  features?: Record<string, any>;
}

// ============================================================================
// SEMANTIC PRIMITIVES
// ============================================================================

/**
 * Base semantic primitive
 */
export interface SemanticPrimitive {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Primitive type */
  type: 'concept' | 'action' | 'property' | 'relation';

  /** Natural language synonyms */
  synonyms: string[];

  /** Semantic relationships */
  relationships: {
    is_a?: string[];
    part_of?: string[];
    related_to?: string[];
    opposites?: string[];
    entails?: string[];
  };

  /** Usage context */
  context: {
    domain: string[];
    frequency: 'low' | 'medium' | 'high';
    confidence: number;
  };
}

/**
 * Concept primitive representing entities and ideas
 */
export interface ConceptPrimitive extends SemanticPrimitive {
  type: 'concept';

  /** Concept properties */
  properties: string[];

  /** Concept categories */
  categories: string[];

  /** Typical attributes */
  attributes: Record<string, string>;

  /** Real-world examples */
  examples: string[];
}

/**
 * Action primitive representing executable operations
 */
export interface ActionPrimitive extends SemanticPrimitive {
  type: 'action';

  /** Action signature */
  signature: {
    subject?: string;
    object?: string;
    instrument?: string;
    location?: string;
    time?: string;
    purpose?: string;
  };

  /** Expected outcomes */
  outcomes: string[];

  /** Preconditions */
  preconditions: string[];

  /** Side effects */
  sideEffects: string[];
}

/**
 * Property primitive representing qualities and attributes
 */
export interface PropertyPrimitive extends SemanticPrimitive {
  type: 'property';

  /** Property domain */
  domain: string[];

  /** Property range */
  range: 'string' | 'number' | 'boolean' | 'date';

  /** Units if applicable */
  units?: string[];

  /** Default value */
  defaultValue?: any;
}

/**
 * Relation primitive representing relationships between concepts
 */
export interface RelationPrimitive extends SemanticPrimitive {
  type: 'relation';

  /** Relation arity (number of arguments) */
  arity: number;

  /** Argument roles */
  arguments: string[];

  /** Relation properties */
  properties: {
    symmetric: boolean;
    transitive: boolean;
    reflexive: boolean;
  };
}

// ============================================================================
// SEMANTIC PROCESSING INTERFACES
// ============================================================================

/**
 * Semantic parsing result
 */
export interface SemanticParseResult {
  /** Parsed semantic frame */
  frame: SemanticCortexFrame;

  /** Parsing confidence */
  confidence: number;

  /** Processing metadata */
  metadata: {
    parser: string;
    processingTime: number;
    tokensProcessed: number;
    language: string;
    entitiesFound?: number;
    frameComplexity?: number;
  };

  /** Alternative interpretations */
  alternatives?: SemanticCortexFrame[];

  /** Parsing errors or warnings */
  issues?: Array<{
    type: 'error' | 'warning';
    message: string;
    location?: {
      start: number;
      end: number;
    };
  }>;
}

/**
 * Semantic similarity score
 */
export interface SemanticSimilarity {
  /** Similarity score (0-1) */
  score: number;

  /** Confidence in the similarity assessment */
  confidence: number;

  /** Types of similarity detected */
  similarityTypes: ('lexical' | 'semantic' | 'structural' | 'contextual')[];

  /** Detailed similarity metrics */
  metrics: {
    lexicalOverlap: number;
    semanticDistance: number;
    structuralSimilarity: number;
    contextualRelevance: number;
  };
}

/**
 * Semantic validation result
 */
export interface SemanticValidationResult {
  /** Whether the semantic structure is valid */
  isValid: boolean;

  /** Validation score (0-1) */
  score: number;

  /** Validation errors */
  errors: string[];

  /** Validation warnings */
  warnings: string[];

  /** Validation suggestions */
  suggestions: string[];

  /** Detailed validation metrics */
  metrics: {
    completeness: number;
    consistency: number;
    coherence: number;
    correctness: number;
  };
}

// ============================================================================
// SEMANTIC VOCABULARY MANAGEMENT
// ============================================================================

/**
 * Semantic vocabulary entry
 */
export interface SemanticVocabularyEntry {
  /** The primitive definition */
  primitive: SemanticPrimitive;

  /** Usage statistics */
  statistics: {
    totalUsage: number;
    successRate: number;
    averageConfidence: number;
    lastUsed: Date;
    usageContexts: string[];
  };

  /** Validation rules */
  validation: {
    requiredFields: string[];
    constraints: Record<string, any>;
    customValidators: string[];
  };

  /** Evolution metadata */
  evolution: {
    created: Date;
    lastModified: Date;
    version: string;
    deprecated: boolean;
    replacement?: string;
  };
}

/**
 * Semantic vocabulary registry
 */
export interface SemanticVocabularyRegistry {
  /** All registered primitives */
  primitives: Map<string, SemanticVocabularyEntry>;

  /** Primitive lookup by synonym */
  synonymIndex: Map<string, string>;

  /** Primitive lookup by type */
  typeIndex: Map<string, string[]>;

  /** Primitive lookup by domain */
  domainIndex: Map<string, string[]>;

  /** Statistics and metrics */
  metrics: {
    totalPrimitives: number;
    typesDistribution: Record<string, number>;
    domainCoverage: Record<string, number>;
    averageConfidence: number;
    lastUpdated: Date;
  };
}

// ============================================================================
// SEMANTIC PROCESSING CONFIGURATION
// ============================================================================

/**
 * Configuration for semantic processing
 */
export interface SemanticProcessingConfig {
  /** Vocabulary settings */
  vocabulary: {
    enabled: boolean;
    registryPath: string;
    autoUpdate: boolean;
    updateInterval: number;
  };

  /** Disambiguation settings */
  disambiguation: {
    strategy: 'most_likely' | 'hybrid' | 'none';
    threshold: number;
    maxCandidates: number;
  };

  /** Semantic validation */
  validation: {
    enabled: boolean;
    strictMode: boolean;
    customValidators: string[];
  };

  /** Processing limits */
  limits: {
    maxProcessingTime: number;
    maxPrimitives: number;
    maxRelationships: number;
  };
}

// ============================================================================
// UTILITY FUNCTIONS AND TYPE GUARDS
// ============================================================================

/**
 * Type guard for concept primitives
 */
export const isConceptPrimitive = (
  primitive: SemanticPrimitive,
): primitive is ConceptPrimitive => {
  return primitive.type === 'concept';
};

/**
 * Type guard for action primitives
 */
export const isActionPrimitive = (
  primitive: SemanticPrimitive,
): primitive is ActionPrimitive => {
  return primitive.type === 'action';
};

/**
 * Type guard for property primitives
 */
export const isPropertyPrimitive = (
  primitive: SemanticPrimitive,
): primitive is PropertyPrimitive => {
  return primitive.type === 'property';
};

/**
 * Type guard for relation primitives
 */
export const isRelationPrimitive = (
  primitive: SemanticPrimitive,
): primitive is RelationPrimitive => {
  return primitive.type === 'relation';
};

/**
 * Get primitive type from ID
 */
export const getPrimitiveType = (id: string): string => {
  if (id.startsWith('concept_')) return 'concept';
  if (id.startsWith('action_')) return 'action';
  if (id.startsWith('prop_')) return 'property';
  if (id.startsWith('relation_')) return 'relation';
  return 'unknown';
};

/**
 * Validate primitive structure
 */
export const validatePrimitive = (primitive: SemanticPrimitive): boolean => {
  const requiredFields = [
    'id',
    'name',
    'type',
    'synonyms',
    'relationships',
    'context',
  ];

  return (
    requiredFields.every((field) => field in primitive) &&
    primitive.synonyms.length > 0 &&
    primitive.context.confidence >= 0 &&
    primitive.context.confidence <= 1
  );
};

/**
 * Create a semantic frame from a regular frame
 */
export const createSemanticFrame = (
  frame: CortexFrame,
  confidence: number = 1.0,
  metadata?: Partial<SemanticCortexFrame['metadata']>,
): SemanticCortexFrame => {
  return {
    id: `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    frameType: frame.frameType,
    roles: Object.entries(frame).reduce(
      (acc, [key, value]) => {
        if (key !== 'frameType') {
          acc[key] = {
            name: key,
            value: value as CortexValue,
            confidence: 1.0,
          };
        }
        return acc;
      },
      {} as Record<string, SemanticRole>,
    ),
    confidence,
    metadata: {
      source: 'cortex_processor',
      timestamp: new Date(),
      model: 'unknown',
      processingTime: 0,
      ...metadata,
    },
  };
};

/**
 * Extract semantic features from a frame
 */
export const extractSemanticFeatures = (
  frame: SemanticCortexFrame,
): Record<string, any> => {
  const features: Record<string, any> = {
    frameType: frame.frameType,
    roleCount: Object.keys(frame.roles).length,
    averageConfidence: 0,
    hasConstraints: false,
    semanticTypes: new Set<string>(),
    domains: new Set<string>(),
  };

  let totalConfidence = 0;
  for (const role of Object.values(frame.roles)) {
    totalConfidence += role.confidence;
    if (role.constraints) {
      features.hasConstraints = true;
    }
    if (role.semanticType) {
      features.semanticTypes.add(role.semanticType);
    }
    if (role.constraints?.domain) {
      role.constraints.domain.forEach((domain) => features.domains.add(domain));
    }
  }

  features.averageConfidence =
    totalConfidence / Object.keys(frame.roles).length;
  features.semanticTypes = Array.from(features.semanticTypes);
  features.domains = Array.from(features.domains);

  return features;
};
