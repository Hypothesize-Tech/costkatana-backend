/**
 * Cortex Vocabulary Type Definitions
 *
 * This file defines the semantic primitives and vocabulary system used by Cortex
 * for natural language understanding and processing. The vocabulary system
 * provides a structured, unambiguous representation of concepts and actions.
 */

import { CortexValue } from './cortex.types';

// ============================================================================
// ENHANCED SEMANTIC PARSING TYPES
// ============================================================================

/**
 * Token with enhanced metadata
 */
export interface Token {
  text: string;
  index: number;
  lemma: string;
  isStopWord: boolean;
  isPunctuation: boolean;
}

/**
 * Part-of-speech tag with confidence
 */
export interface POSTag {
  token: string;
  tag: string;
  confidence: number;
}

/**
 * Named entity recognition result
 */
export interface Entity {
  text: string;
  type: string;
  start: number;
  end: number;
  confidence: number;
}

/**
 * Dependency relation between tokens
 */
export interface Dependency {
  head: number;
  dependent: number;
  relation: string;
  confidence: number;
}

/**
 * Frame types for semantic parsing
 */
export type FrameType = 'query' | 'action' | 'entity_description' | 'statement';

/**
 * Context object for semantic parsing operations
 */
export interface SemanticParsingContext {
  tokens: Token[];
  posTags: POSTag[];
  entities: Entity[];
  dependencies: Dependency[];
}

// ============================================================================
// SEMANTIC PRIMITIVES
// ============================================================================

/**
 * Semantic primitives represent universal concepts and actions
 */
export interface SemanticPrimitive {
  /** Unique identifier for the primitive */
  id: string;

  /** Human-readable name */
  name: string;

  /** Optional value for similarity comparison */
  value?: unknown;

  /** Optional metadata for similarity comparison */
  metadata?: Record<string, unknown>;

  /** Optional contexts array for context similarity */
  contexts?: string[];

  /** Optional category for category similarity */
  category?: string;

  /** Type of primitive */
  type:
    | 'concept'
    | 'action'
    | 'property'
    | 'modifier'
    | 'control'
    | 'comparison'
    | 'logical';

  /** Natural language synonyms */
  synonyms: string[];

  /** Semantic relationships */
  relationships: {
    is_a?: string[]; // Hypernyms (broader terms)
    part_of?: string[]; // Meronyms (part-whole relationships)
    related_to?: string[]; // Related concepts
    opposites?: string[]; // Antonyms
    entails?: string[]; // Implied actions/concepts
  };

  /** Usage context */
  context: {
    domain: string[]; // Domains where this primitive is commonly used
    frequency: 'low' | 'medium' | 'high';
    confidence: number; // Confidence score (0-1)
  };
}

/**
 * Action primitives represent executable operations
 */
export interface ActionPrimitive extends SemanticPrimitive {
  type: 'action';

  /** Action signature */
  signature: {
    subject?: string; // Who performs the action
    object?: string; // What the action is performed on
    instrument?: string; // Tool or method used
    location?: string; // Where the action occurs
    time?: string; // When the action occurs
    purpose?: string; // Why the action is performed
  };

  /** Expected outcomes */
  outcomes: string[];

  /** Preconditions for execution */
  preconditions: string[];

  /** Side effects */
  sideEffects: string[];
}

/**
 * Concept primitives represent entities and ideas
 */
export interface ConceptPrimitive extends SemanticPrimitive {
  type: 'concept';

  /** Concept properties */
  properties: string[];

  /** Concept categories */
  categories: string[];

  /** Typical attributes */
  attributes: Record<string, any>;

  /** Real-world examples */
  examples: string[];
}

/**
 * Property primitives represent qualities and attributes
 */
export interface PropertyPrimitive extends SemanticPrimitive {
  type: 'property';

  /** Property domain (what it can apply to) */
  domain: string[];

  /** Property range (possible values) */
  range: 'string' | 'number' | 'boolean' | 'date' | 'list' | 'object';

  /** Units if applicable */
  units?: string[];

  /** Default value */
  defaultValue?: any;
}

/**
 * Modifier primitives represent qualifiers and modifiers
 */
export interface ModifierPrimitive extends SemanticPrimitive {
  type: 'modifier';

  /** What this modifier can modify */
  modifies: string[];

  /** Type of modification */
  modificationType:
    | 'quantitative'
    | 'qualitative'
    | 'temporal'
    | 'spatial'
    | 'intensional';

  /** Intensity level */
  intensity?: 'low' | 'medium' | 'high';
}

/**
 * Control primitives represent flow control operations
 */
export interface ControlPrimitive extends SemanticPrimitive {
  type: 'control';

  /** Control structure type */
  controlType:
    | 'conditional'
    | 'loop'
    | 'sequence'
    | 'parallel'
    | 'switch'
    | 'exception';

  /** Control parameters */
  parameters: Record<string, any>;

  /** Execution semantics */
  semantics: {
    blocking: boolean;
    parallelizable: boolean;
    interruptible: boolean;
  };
}

/**
 * Comparison primitives represent relational operations
 */
export interface ComparisonPrimitive extends SemanticPrimitive {
  type: 'comparison';

  /** Comparison operator */
  operator:
    | 'equals'
    | 'not_equals'
    | 'greater_than'
    | 'less_than'
    | 'greater_equal'
    | 'less_equal'
    | 'contains'
    | 'matches';

  /** Applicable data types */
  applicableTypes: string[];

  /** Symmetric operation */
  symmetric: boolean;
}

/**
 * Logical primitives represent boolean operations
 */
export interface LogicalPrimitive extends SemanticPrimitive {
  type: 'logical';

  /** Logical operator */
  operator: 'and' | 'or' | 'not' | 'xor' | 'implies' | 'iff';

  /** Arity (number of operands) */
  arity: number;

  /** Truth table */
  truthTable?: Record<string, boolean>;
}

// ============================================================================
// VOCABULARY MANAGEMENT
// ============================================================================

/**
 * Vocabulary entry combining primitive and metadata
 */
export interface VocabularyEntry {
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
 * Vocabulary registry for managing semantic primitives
 */
export interface VocabularyRegistry {
  /** All registered primitives */
  primitives: Map<string, VocabularyEntry>;

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
// SEMANTIC FRAME EXTENSIONS
// ============================================================================

/**
 * Enhanced semantic frame with vocabulary integration
 */
export interface SemanticCortexFrame {
  /** Base frame type */
  frameType: string;

  /** Frame identifier */
  id: string;

  /** Semantic roles with vocabulary references */
  roles: Record<string, SemanticRole>;

  /** Frame confidence */
  confidence: number;

  /** Processing metadata */
  metadata: {
    source: string;
    timestamp: Date;
    model: string;
    processingTime: number;
  };

  /** Semantic relationships */
  relationships: {
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
 * Semantic role with vocabulary integration
 */
export interface SemanticRole {
  /** Role name */
  name: string;

  /** Role value */
  value: CortexValue;

  /** Vocabulary primitive reference */
  primitive?: string;

  /** Confidence in role assignment */
  confidence: number;

  /** Role constraints */
  constraints?: {
    required: boolean;
    type: string;
    domain?: string[];
    range?: any[];
  };
}

// ============================================================================
// VOCABULARY OPERATIONS
// ============================================================================

/**
 * Vocabulary query for finding primitives
 */
export interface VocabularyQuery {
  /** Search criteria */
  criteria: {
    type?: string[];
    domain?: string[];
    name?: string;
    synonym?: string;
    relationship?: {
      type: 'is_a' | 'part_of' | 'related_to' | 'opposite';
      target: string;
    };
  };

  /** Search options */
  options: {
    fuzzy: boolean;
    limit: number;
    sortBy: 'frequency' | 'confidence' | 'name';
    sortOrder: 'asc' | 'desc';
  };
}

/**
 * Vocabulary query result
 */
export interface VocabularyQueryResult {
  /** Matching primitives */
  matches: VocabularyEntry[];

  /** Query statistics */
  statistics: {
    totalMatches: number;
    searchTime: number;
    relevanceScores: Record<string, number>;
  };

  /** Suggestions for query refinement */
  suggestions: string[];
}

/**
 * Vocabulary update operation
 */
export interface VocabularyUpdate {
  /** Update type */
  type: 'add' | 'modify' | 'deprecate' | 'remove';

  /** Target primitive */
  primitiveId: string;

  /** Update data */
  data: Partial<VocabularyEntry>;

  /** Update metadata */
  metadata: {
    reason: string;
    author: string;
    timestamp: Date;
    version: string;
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
// PREDEFINED VOCABULARY CONSTANTS
// ============================================================================

/**
 * Core action primitives
 */
export const CORE_ACTION_PRIMITIVES: Record<string, ActionPrimitive> = {
  action_query: {
    id: 'action_query',
    name: 'Query',
    type: 'action',
    synonyms: ['ask', 'request', 'inquire', 'seek', 'find'],
    relationships: {
      is_a: ['action_communicate'],
      entails: ['action_receive_response'],
    },
    context: {
      domain: ['communication', 'information_retrieval'],
      frequency: 'high',
      confidence: 0.95,
    },
    signature: {
      subject: 'agent',
      object: 'information',
      purpose: 'obtain_knowledge',
    },
    outcomes: ['information_obtained'],
    preconditions: ['agent_has_question'],
    sideEffects: [],
  },

  action_summarize: {
    id: 'action_summarize',
    name: 'Summarize',
    type: 'action',
    synonyms: ['condense', 'abstract', 'outline', 'recap'],
    relationships: {
      is_a: ['action_transform'],
      related_to: ['action_compress'],
    },
    context: {
      domain: ['text_processing', 'content_management'],
      frequency: 'high',
      confidence: 0.92,
    },
    signature: {
      subject: 'agent',
      object: 'content',
      instrument: 'summarization_algorithm',
    },
    outcomes: ['shorter_content', 'preserved_meaning'],
    preconditions: ['content_exists', 'content_length_sufficient'],
    sideEffects: [],
  },

  action_analyze: {
    id: 'action_analyze',
    name: 'Analyze',
    type: 'action',
    synonyms: ['examine', 'study', 'investigate', 'evaluate'],
    relationships: {
      is_a: ['action_process'],
      related_to: ['action_understand'],
    },
    context: {
      domain: ['data_processing', 'research'],
      frequency: 'high',
      confidence: 0.9,
    },
    signature: {
      subject: 'agent',
      object: 'data',
      instrument: 'analysis_tools',
    },
    outcomes: ['insights', 'patterns_identified'],
    preconditions: ['data_available'],
    sideEffects: [],
  },
};

/**
 * Core concept primitives
 */
export const CORE_CONCEPT_PRIMITIVES: Record<string, ConceptPrimitive> = {
  concept_document: {
    id: 'concept_document',
    name: 'Document',
    type: 'concept',
    synonyms: ['file', 'text', 'content', 'material'],
    relationships: {
      is_a: ['concept_information'],
      part_of: ['concept_knowledge_base'],
    },
    context: {
      domain: ['content_management', 'information_systems'],
      frequency: 'high',
      confidence: 0.98,
    },
    properties: ['title', 'content', 'author', 'created_date'],
    categories: ['digital', 'physical'],
    attributes: {
      format: ['text', 'pdf', 'docx', 'html'],
      language: 'string',
      length: 'number',
    },
    examples: ['report.pdf', 'article.docx', 'email.txt'],
  },

  concept_person: {
    id: 'concept_person',
    name: 'Person',
    type: 'concept',
    synonyms: ['individual', 'human', 'user', 'agent'],
    relationships: {
      is_a: ['concept_entity'],
      related_to: ['concept_organization'],
    },
    context: {
      domain: ['social', 'business', 'identity'],
      frequency: 'high',
      confidence: 0.99,
    },
    properties: ['name', 'age', 'role', 'contact_info'],
    categories: ['employee', 'customer', 'contact'],
    attributes: {
      name: 'string',
      age: 'number',
      email: 'string',
    },
    examples: ['John Doe', 'Jane Smith', 'Dr. Brown'],
  },
};

/**
 * Core property primitives
 */
export const CORE_PROPERTY_PRIMITIVES: Record<string, PropertyPrimitive> = {
  prop_name: {
    id: 'prop_name',
    name: 'Name',
    type: 'property',
    synonyms: ['title', 'label', 'identifier'],
    relationships: {
      is_a: ['prop_identifier'],
      related_to: ['prop_title'],
    },
    context: {
      domain: ['identity', 'classification'],
      frequency: 'high',
      confidence: 0.97,
    },
    domain: ['entity', 'object', 'concept'],
    range: 'string',
    units: [],
  },

  prop_sentiment: {
    id: 'prop_sentiment',
    name: 'Sentiment',
    type: 'property',
    synonyms: ['emotion', 'tone', 'attitude'],
    relationships: {
      is_a: ['prop_emotional'],
      opposites: ['prop_objectivity'],
    },
    context: {
      domain: ['text_analysis', 'communication'],
      frequency: 'medium',
      confidence: 0.85,
    },
    domain: ['text', 'communication', 'opinion'],
    range: 'string',
  },
};

// ============================================================================
// UTILITY FUNCTIONS AND TYPE GUARDS
// ============================================================================

/**
 * Type guard for action primitives
 */
export const isActionPrimitive = (
  primitive: SemanticPrimitive,
): primitive is ActionPrimitive => {
  return primitive.type === 'action';
};

/**
 * Type guard for concept primitives
 */
export const isConceptPrimitive = (
  primitive: SemanticPrimitive,
): primitive is ConceptPrimitive => {
  return primitive.type === 'concept';
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
 * Get primitive type from ID
 */
export const getPrimitiveType = (id: string): string => {
  if (id.startsWith('action_')) return 'action';
  if (id.startsWith('concept_')) return 'concept';
  if (id.startsWith('prop_')) return 'property';
  if (id.startsWith('mod_')) return 'modifier';
  if (id.startsWith('control_')) return 'control';
  if (id.startsWith('comparison_')) return 'comparison';
  if (id.startsWith('logical_')) return 'logical';
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
