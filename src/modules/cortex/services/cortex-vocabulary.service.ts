/**
 * Cortex Vocabulary Service
 *
 * Manages the semantic vocabulary system for Cortex meta-language processing.
 * Handles semantic primitives, vocabulary lookup, and semantic similarity calculations.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  SemanticPrimitive,
  VocabularyEntry,
  VocabularyRegistry,
  Token,
  POSTag,
  Entity,
  Dependency,
  FrameType,
  SemanticParsingContext,
} from '../types/cortex-vocabulary.types';
import {
  SemanticVocabularyRegistry,
  SemanticParseResult,
  SemanticSimilarity,
} from '../types/semanticPrimitives.types';

@Injectable()
export class CortexVocabularyService {
  private readonly logger = new Logger(CortexVocabularyService.name);
  private vocabularyRegistry: VocabularyRegistry;
  private semanticRegistry: SemanticVocabularyRegistry;

  constructor() {
    this.initializeVocabulary();
    this.initializeSemanticRegistry();
  }

  /**
   * Initialize the vocabulary with core primitives
   */
  private initializeVocabulary(): void {
    this.vocabularyRegistry = {
      primitives: new Map(),
      synonymIndex: new Map(),
      typeIndex: new Map(),
      domainIndex: new Map(),
      metrics: {
        totalPrimitives: 0,
        typesDistribution: {},
        domainCoverage: {},
        averageConfidence: 0,
        lastUpdated: new Date(),
      },
    };

    // Add core action primitives
    this.addPrimitive('action_query', {
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
    });

    // Add core concept primitives
    this.addPrimitive('concept_document', {
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
    });

    this.updateMetrics();
  }

  /**
   * Initialize semantic vocabulary registry
   */
  private initializeSemanticRegistry(): void {
    this.semanticRegistry = {
      primitives: new Map(),
      synonymIndex: new Map(),
      typeIndex: new Map(),
      domainIndex: new Map(),
      metrics: {
        totalPrimitives: 0,
        typesDistribution: {},
        domainCoverage: {},
        averageConfidence: 0,
        lastUpdated: new Date(),
      },
    };
  }

  /**
   * Add a primitive to the vocabulary
   */
  addPrimitive(id: string, primitive: SemanticPrimitive): void {
    const entry: VocabularyEntry = {
      primitive,
      statistics: {
        totalUsage: 0,
        successRate: 1.0,
        averageConfidence: primitive.context.confidence,
        lastUsed: new Date(),
        usageContexts: [],
      },
      validation: {
        requiredFields: ['id', 'name', 'type'],
        constraints: {},
        customValidators: [],
      },
      evolution: {
        created: new Date(),
        lastModified: new Date(),
        version: '1.0',
        deprecated: false,
      },
    };

    this.vocabularyRegistry.primitives.set(id, entry);

    // Update indexes
    for (const synonym of primitive.synonyms) {
      this.vocabularyRegistry.synonymIndex.set(synonym.toLowerCase(), id);
    }

    const typeList =
      this.vocabularyRegistry.typeIndex.get(primitive.type) || [];
    typeList.push(id);
    this.vocabularyRegistry.typeIndex.set(primitive.type, typeList);

    for (const domain of primitive.context.domain) {
      const domainList = this.vocabularyRegistry.domainIndex.get(domain) || [];
      domainList.push(id);
      this.vocabularyRegistry.domainIndex.set(domain, domainList);
    }

    this.updateMetrics();
  }

  /**
   * Look up a primitive by ID
   */
  getPrimitive(id: string): SemanticPrimitive | undefined {
    const entry = this.vocabularyRegistry.primitives.get(id);
    return entry?.primitive;
  }

  /**
   * Look up primitive by synonym
   */
  getPrimitiveBySynonym(synonym: string): SemanticPrimitive | undefined {
    const id = this.vocabularyRegistry.synonymIndex.get(synonym.toLowerCase());
    return id ? this.getPrimitive(id) : undefined;
  }

  /**
   * Get primitives by type
   */
  getPrimitivesByType(type: string): SemanticPrimitive[] {
    const ids = this.vocabularyRegistry.typeIndex.get(type) || [];
    return ids
      .map((id) => this.getPrimitive(id))
      .filter(Boolean) as SemanticPrimitive[];
  }

  /**
   * Get primitives by domain
   */
  getPrimitivesByDomain(domain: string): SemanticPrimitive[] {
    const ids = this.vocabularyRegistry.domainIndex.get(domain) || [];
    return ids
      .map((id) => this.getPrimitive(id))
      .filter(Boolean) as SemanticPrimitive[];
  }

  /**
   * Calculate semantic similarity between two primitives
   */
  calculateSemanticSimilarity(
    primitive1: string | SemanticPrimitive,
    primitive2: string | SemanticPrimitive,
  ): SemanticSimilarity {
    const p1 =
      typeof primitive1 === 'string'
        ? this.getPrimitive(primitive1)
        : primitive1;
    const p2 =
      typeof primitive2 === 'string'
        ? this.getPrimitive(primitive2)
        : primitive2;

    if (!p1 || !p2) {
      return {
        score: 0,
        confidence: 0,
        similarityTypes: [],
        metrics: {
          lexicalOverlap: 0,
          semanticDistance: 1,
          structuralSimilarity: 0,
          contextualRelevance: 0,
        },
      };
    }

    // Calculate lexical similarity (synonym overlap)
    const lexicalOverlap = this.calculateLexicalOverlap(p1, p2);

    // Calculate semantic distance (relationship-based)
    const semanticDistance = this.calculateSemanticDistance(p1, p2);

    // Calculate structural similarity (type and domain matching)
    const structuralSimilarity = this.calculateStructuralSimilarity(p1, p2);

    // Calculate contextual relevance
    const contextualRelevance = this.calculateContextualRelevance(p1, p2);

    // Combine metrics into overall score
    const score =
      lexicalOverlap * 0.3 +
      (1 - semanticDistance) * 0.3 +
      structuralSimilarity * 0.2 +
      contextualRelevance * 0.2;

    // Determine similarity types
    const similarityTypes: SemanticSimilarity['similarityTypes'] = [];
    if (lexicalOverlap > 0.5) similarityTypes.push('lexical');
    if (semanticDistance < 0.3) similarityTypes.push('semantic');
    if (structuralSimilarity > 0.7) similarityTypes.push('structural');
    if (contextualRelevance > 0.6) similarityTypes.push('contextual');

    return {
      score,
      confidence: Math.min(p1.context.confidence, p2.context.confidence),
      similarityTypes,
      metrics: {
        lexicalOverlap,
        semanticDistance,
        structuralSimilarity,
        contextualRelevance,
      },
    };
  }

  /**
   * Parse text into semantic frames using advanced vocabulary analysis
   */
  async parseSemanticFrame(text: string): Promise<SemanticParseResult> {
    const startTime = Date.now();

    // Enhanced semantic parsing with NLP-like processing
    const processedText = this.preprocessText(text);
    const tokens = this.tokenizeAdvanced(processedText);
    const posTags = this.performPosTagging(tokens);
    const entities = this.extractEntities(tokens, posTags);
    const dependencies = this.buildDependencyGraph(tokens, posTags);
    const primitives = this.identifyPrimitivesAdvanced(
      tokens,
      posTags,
      entities,
    );

    // Determine frame type based on content analysis
    const frameType = this.determineFrameType(tokens, posTags, entities);

    // Build sophisticated semantic frame with role identification
    const roles = this.extractSemanticRoles(
      tokens,
      posTags,
      entities,
      dependencies,
      frameType,
    );
    const confidence = this.calculateParsingConfidence(
      roles,
      entities,
      dependencies,
    );

    const frame = {
      id: `frame_${Date.now()}_${this.generateFrameHash(text)}`,
      frameType,
      roles,
      confidence,
      metadata: {
        source: 'vocabulary_service',
        timestamp: new Date(),
        model: 'advanced_vocabulary_parser',
        processingTime: Date.now() - startTime,
        language: this.detectLanguage(text),
        entities: entities.length,
        tokens: tokens.length,
        dependencies: dependencies.length,
        primitives: primitives.length,
      },
    };

    return {
      frame,
      confidence,
      metadata: {
        parser: 'vocabulary_service',
        processingTime: Date.now() - startTime,
        tokensProcessed: tokens.length,
        entitiesFound: entities.length,
        language: this.detectLanguage(text),
        frameComplexity: this.calculateFrameComplexity(frame),
      },
    };
  }

  /**
   * Find the best matching primitive for a given term
   */
  findBestMatch(term: string, context?: string[]): SemanticPrimitive | null {
    // Check exact synonym matches first
    const exactMatch = this.getPrimitiveBySynonym(term);
    if (exactMatch) return exactMatch;

    // Check fuzzy matches
    const candidates = Array.from(this.vocabularyRegistry.primitives.values())
      .map((entry) => entry.primitive)
      .filter((primitive) => {
        // Check if term is similar to any synonym
        return primitive.synonyms.some(
          (synonym) => this.calculateStringSimilarity(term, synonym) > 0.8,
        );
      });

    if (candidates.length === 0) return null;

    // Score candidates
    const scored = candidates.map((candidate) => ({
      primitive: candidate,
      score: this.scoreCandidate(candidate, term, context),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0].primitive;
  }

  /**
   * Get vocabulary statistics
   */
  getVocabularyStats(): VocabularyRegistry['metrics'] {
    return { ...this.vocabularyRegistry.metrics };
  }

  /**
   * Update vocabulary metrics
   */
  private updateMetrics(): void {
    const primitives = Array.from(this.vocabularyRegistry.primitives.values());
    const types: Record<string, number> = {};
    const domains: Record<string, number> = {};
    let totalConfidence = 0;

    for (const entry of primitives) {
      const primitive = entry.primitive;

      // Count types
      types[primitive.type] = (types[primitive.type] || 0) + 1;

      // Count domains
      for (const domain of primitive.context.domain) {
        domains[domain] = (domains[domain] || 0) + 1;
      }

      totalConfidence += primitive.context.confidence;
    }

    this.vocabularyRegistry.metrics = {
      totalPrimitives: primitives.length,
      typesDistribution: types,
      domainCoverage: domains,
      averageConfidence:
        primitives.length > 0 ? totalConfidence / primitives.length : 0,
      lastUpdated: new Date(),
    };
  }

  // Helper methods

  private calculateLexicalOverlap(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    const s1 = new Set(p1.synonyms.map((s) => s.toLowerCase()));
    const s2 = new Set(p2.synonyms.map((s) => s.toLowerCase()));

    const intersection = new Set([...s1].filter((x) => s2.has(x)));
    const union = new Set([...s1, ...s2]);

    return intersection.size / union.size;
  }

  private calculateSemanticDistance(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Enhanced semantic distance using ontology/graph-based approach

    // Maximum distance for completely different types
    if (p1.type !== p2.type) {
      return this.calculateCrossTypeDistance(p1, p2);
    }

    // Same type - calculate intra-type distance
    const typeDistance = this.calculateIntraTypeDistance(p1, p2);

    // Relationship-based distance
    const relationshipDistance = this.calculateRelationshipDistance(p1, p2);

    // Context similarity
    const contextSimilarity = this.calculateContextSimilarity(p1, p2);

    // Hierarchical distance (ontology depth)
    const hierarchicalDistance = this.calculateHierarchicalDistance(p1, p2);

    // Weighted combination of distance metrics
    const overallDistance =
      typeDistance * 0.2 +
      relationshipDistance * 0.3 +
      (1 - contextSimilarity) * 0.3 +
      hierarchicalDistance * 0.2;

    // Ensure distance is between 0 and 1
    return Math.min(1.0, Math.max(0.0, overallDistance));
  }

  private calculateCrossTypeDistance(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Define type compatibility matrix
    const typeCompatibility: Record<string, Record<string, number>> = {
      action: { concept: 0.7, prop: 0.8, control: 0.6 },
      concept: { action: 0.7, prop: 0.6, control: 0.5 },
      prop: { action: 0.8, concept: 0.6, control: 0.7 },
      control: { action: 0.6, concept: 0.5, prop: 0.7 },
      comparison: { logical: 0.8, control: 0.7 },
      logical: { comparison: 0.8, control: 0.6 },
    };

    const compatibility = typeCompatibility[p1.type]?.[p2.type] ?? 0.3;
    return 1.0 - compatibility;
  }

  private calculateIntraTypeDistance(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Same type - detailed comparison
    let distance = 0;

    // Value similarity
    if (p1.value === p2.value) {
      distance += 0;
    } else if (typeof p1.value === 'string' && typeof p2.value === 'string') {
      const similarity = this.calculateStringSimilarity(p1.value, p2.value);
      distance += (1 - similarity) * 0.4;
    } else {
      distance += 0.4; // Different values
    }

    // Metadata similarity
    const metadataSimilarity = this.calculateMetadataSimilarity(
      p1.metadata,
      p2.metadata,
    );
    distance += (1 - metadataSimilarity) * 0.3;

    // Semantic category similarity
    const categorySimilarity = this.calculateCategorySimilarity(p1, p2);
    distance += (1 - categorySimilarity) * 0.3;

    return Math.min(1.0, distance);
  }

  private calculateRelationshipDistance(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    const p1Relationships = Object.values(p1.relationships).flat();
    const p2Relationships = Object.values(p2.relationships).flat();

    if (p1Relationships.length === 0 && p2Relationships.length === 0) {
      return 0; // No relationships to compare
    }

    const sharedRelationships = p1Relationships.filter((r) =>
      p2Relationships.includes(r),
    ).length;

    const totalRelationships = new Set([...p1Relationships, ...p2Relationships])
      .size;

    if (totalRelationships === 0) return 0;

    // Jaccard similarity for relationships
    const jaccardSimilarity = sharedRelationships / totalRelationships;

    // Consider relationship strength and types
    const relationshipTypeSimilarity = this.calculateRelationshipTypeSimilarity(
      p1.relationships,
      p2.relationships,
    );

    return 1.0 - (jaccardSimilarity * 0.6 + relationshipTypeSimilarity * 0.4);
  }

  private calculateContextSimilarity(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Compare contextual usage patterns
    const p1Contexts = p1.contexts || [];
    const p2Contexts = p2.contexts || [];

    if (p1Contexts.length === 0 && p2Contexts.length === 0) {
      return 0.5; // Neutral similarity
    }

    const sharedContexts = p1Contexts.filter((ctx: string) =>
      p2Contexts.some((p2Ctx: string) => this.contextsAreSimilar(ctx, p2Ctx)),
    ).length;

    const totalUniqueContexts = new Set([...p1Contexts, ...p2Contexts]).size;

    return totalUniqueContexts > 0 ? sharedContexts / totalUniqueContexts : 0.5;
  }

  private calculateHierarchicalDistance(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Calculate distance based on ontology hierarchy depth
    const p1Depth = this.getOntologyDepth(p1);
    const p2Depth = this.getOntologyDepth(p2);

    // Same depth level = closer
    const depthDifference = Math.abs(p1Depth - p2Depth);
    const maxDepth = Math.max(p1Depth, p2Depth, 5); // Assume max depth of 5

    return depthDifference / maxDepth;
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    // Enhanced string similarity using multiple metrics
    if (str1 === str2) return 1.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    // Levenshtein distance
    const distance = this.levenshteinDistance(longer, shorter);
    const levenshteinSimilarity = (longer.length - distance) / longer.length;

    // Jaccard similarity for word sets
    const words1 = new Set(shorter.toLowerCase().split(/\s+/));
    const words2 = new Set(longer.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    const jaccardSimilarity = intersection.size / union.size;

    return levenshteinSimilarity * 0.6 + jaccardSimilarity * 0.4;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  private calculateMetadataSimilarity(meta1: any, meta2: any): number {
    if (!meta1 && !meta2) return 1.0;
    if (!meta1 || !meta2) return 0.0;

    const keys1 = Object.keys(meta1);
    const keys2 = Object.keys(meta2);

    const sharedKeys = keys1.filter((key) => keys2.includes(key));
    const totalKeys = new Set([...keys1, ...keys2]).size;

    if (totalKeys === 0) return 1.0;

    let valueSimilarity = 0;
    for (const key of sharedKeys) {
      if (meta1[key] === meta2[key]) {
        valueSimilarity += 1;
      }
    }

    return (
      (sharedKeys.length / totalKeys) * (valueSimilarity / sharedKeys.length)
    );
  }

  private calculateCategorySimilarity(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Compare semantic categories and domains
    const cat1 = p1.category || 'general';
    const cat2 = p2.category || 'general';

    if (cat1 === cat2) return 1.0;

    // Define category compatibility
    const categoryHierarchy: Record<string, string[]> = {
      action: ['event', 'process'],
      concept: ['entity', 'idea'],
      prop: ['attribute', 'property'],
      control: ['logic', 'flow'],
    };

    const cat1Parents = categoryHierarchy[cat1] || [];
    const cat2Parents = categoryHierarchy[cat2] || [];

    if (cat1Parents.includes(cat2) || cat2Parents.includes(cat1)) {
      return 0.7; // Parent-child relationship
    }

    return 0.3; // Unrelated categories
  }

  private calculateRelationshipTypeSimilarity(
    rel1: Record<string, string[]>,
    rel2: Record<string, string[]>,
  ): number {
    const types1 = Object.keys(rel1);
    const types2 = Object.keys(rel2);

    const sharedTypes = types1.filter((type) => types2.includes(type));
    const totalTypes = new Set([...types1, ...types2]).size;

    if (totalTypes === 0) return 1.0;

    // Consider relationship strength for shared types
    let typeStrengthSimilarity = 0;
    for (const type of sharedTypes) {
      const strength1 = rel1[type]?.length || 0;
      const strength2 = rel2[type]?.length || 0;
      const maxStrength = Math.max(strength1, strength2, 1);
      typeStrengthSimilarity +=
        1 - Math.abs(strength1 - strength2) / maxStrength;
    }

    return sharedTypes.length > 0
      ? typeStrengthSimilarity / sharedTypes.length
      : 0;
  }

  private contextsAreSimilar(ctx1: string, ctx2: string): boolean {
    // Simple context similarity - could be enhanced with NLP
    const words1 = ctx1.toLowerCase().split(/\s+/);
    const words2 = ctx2.toLowerCase().split(/\s+/);

    const commonWords = words1.filter((word) => words2.includes(word));
    const similarity =
      commonWords.length / Math.max(words1.length, words2.length);

    return similarity > 0.5;
  }

  private getOntologyDepth(primitive: SemanticPrimitive): number {
    // Calculate ontology depth based on semantic category hierarchy
    const categoryDepths: Record<string, number> = {
      action: 2,
      concept: 2,
      prop: 2,
      control: 2,
      comparison: 3,
      logical: 3,
    };

    return categoryDepths[primitive.category || 'general'] || 1;
  }

  private calculateStructuralSimilarity(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    let score = 0;

    // Type matching
    if (p1.type === p2.type) score += 0.4;

    // Domain overlap
    const domainOverlap = p1.context.domain.filter((d) =>
      p2.context.domain.includes(d),
    ).length;
    const maxDomains = Math.max(
      p1.context.domain.length,
      p2.context.domain.length,
    );
    score += 0.4 * (domainOverlap / maxDomains);

    // Frequency similarity
    const freqSimilarity =
      1 -
      Math.abs(
        (p1.context.frequency === 'high'
          ? 1
          : p1.context.frequency === 'medium'
            ? 0.5
            : 0) -
          (p2.context.frequency === 'high'
            ? 1
            : p2.context.frequency === 'medium'
              ? 0.5
              : 0),
      );
    score += 0.2 * freqSimilarity;

    return score;
  }

  private calculateContextualRelevance(
    p1: SemanticPrimitive,
    p2: SemanticPrimitive,
  ): number {
    // Simplified contextual relevance
    const confidenceSimilarity =
      1 - Math.abs(p1.context.confidence - p2.context.confidence);
    return confidenceSimilarity;
  }

  private scoreCandidate(
    candidate: SemanticPrimitive,
    term: string,
    context?: string[],
  ): number {
    let score = 0;

    // Exact synonym match
    if (
      candidate.synonyms.some((s) => s.toLowerCase() === term.toLowerCase())
    ) {
      score += 1.0;
    }

    // Fuzzy synonym match
    const fuzzyMatch = candidate.synonyms.some(
      (s) => this.calculateStringSimilarity(term, s) > 0.8,
    );
    if (fuzzyMatch) score += 0.7;

    // Context relevance
    if (context) {
      const contextOverlap = context.filter((c) =>
        candidate.context.domain.includes(c),
      ).length;
      score += 0.3 * (contextOverlap / context.length);
    }

    // Confidence boost
    score += 0.1 * candidate.context.confidence;

    return score;
  }

  // ===== ENHANCED SEMANTIC PARSING METHODS =====

  /**
   * Preprocess text for better parsing
   */
  private preprocessText(text: string): string {
    return text
      .replace(/['']s\b/g, '') // Remove possessive 's
      .replace(/['']ve\b/g, ' have') // Expand contractions
      .replace(/['']re\b/g, ' are')
      .replace(/['']ll\b/g, ' will')
      .replace(/['']d\b/g, ' would')
      .replace(/['']m\b/g, ' am')
      .replace(/n't\b/g, ' not')
      .replace(/['']t\b/g, ' not')
      .replace(/['']s\b/g, ' is');
  }

  /**
   * Advanced tokenization with better handling
   */
  private tokenizeAdvanced(text: string): Token[] {
    const tokens: Token[] = [];
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];

    words.forEach((word, index) => {
      tokens.push({
        text: word,
        index,
        lemma: this.lemmatize(word),
        isStopWord: this.isStopWord(word),
        isPunctuation: false,
      });
    });

    return tokens;
  }

  /**
   * Simple POS tagging simulation
   */
  private performPosTagging(tokens: Token[]): POSTag[] {
    return tokens.map((token) => {
      let tag: string;

      if (token.isStopWord) {
        tag = 'STOP';
      } else if (this.isVerb(token.text)) {
        tag = 'VERB';
      } else if (this.isNoun(token.text)) {
        tag = 'NOUN';
      } else if (this.isAdjective(token.text)) {
        tag = 'ADJ';
      } else {
        tag = 'UNKNOWN';
      }

      return {
        token: token.text,
        tag,
        confidence: 0.8,
      };
    });
  }

  /**
   * Extract entities from tokens
   */
  private extractEntities(tokens: Token[], posTags: POSTag[]): Entity[] {
    const entities: Entity[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const posTag = posTags[i];

      if (posTag.tag === 'NOUN' && !token.isStopWord) {
        // Check for multi-word entities
        const entityTokens = [token];
        let j = i + 1;

        while (
          j < tokens.length &&
          tokens[j].text.match(/^(and|or|of|in|on|at|by|for|with)$/)
        ) {
          j++;
        }

        while (j < tokens.length && posTags[j].tag === 'NOUN') {
          entityTokens.push(tokens[j]);
          j++;
        }

        if (entityTokens.length > 1) {
          entities.push({
            text: entityTokens.map((t) => t.text).join(' '),
            type: 'compound_noun',
            start: i,
            end: j - 1,
            confidence: 0.9,
          });
          i = j - 1;
        } else {
          entities.push({
            text: token.text,
            type: 'noun',
            start: i,
            end: i,
            confidence: 0.8,
          });
        }
      }
    }

    return entities;
  }

  /**
   * Build dependency graph between tokens
   */
  private buildDependencyGraph(
    tokens: Token[],
    posTags: POSTag[],
  ): Dependency[] {
    const dependencies: Dependency[] = [];

    for (let i = 0; i < tokens.length - 1; i++) {
      const current = tokens[i];
      const next = tokens[i + 1];

      // Simple dependency rules
      if (posTags[i].tag === 'NOUN' && posTags[i + 1].tag === 'NOUN') {
        dependencies.push({
          head: current.index,
          dependent: next.index,
          relation: 'compound',
          confidence: 0.7,
        });
      } else if (posTags[i].tag === 'ADJ' && posTags[i + 1].tag === 'NOUN') {
        dependencies.push({
          head: next.index,
          dependent: current.index,
          relation: 'amod',
          confidence: 0.8,
        });
      }
    }

    return dependencies;
  }

  /**
   * Advanced primitive identification with context
   */
  private identifyPrimitivesAdvanced(
    tokens: Token[],
    posTags: POSTag[],
    entities: Entity[],
  ): SemanticPrimitive[] {
    const primitives: SemanticPrimitive[] = [];

    for (const token of tokens) {
      if (!token.isStopWord) {
        const primitive = this.findBestMatch(token.text);
        if (primitive) {
          primitives.push(primitive);
        }
      }
    }

    // Add entity-based primitives
    for (const entity of entities) {
      const entityPrimitive = this.findBestMatch(entity.text);
      if (
        entityPrimitive &&
        !primitives.find((p) => p.id === entityPrimitive.id)
      ) {
        primitives.push(entityPrimitive);
      }
    }

    return primitives;
  }

  /**
   * Determine the type of semantic frame
   */
  private determineFrameType(
    tokens: Token[],
    posTags: POSTag[],
    entities: Entity[],
  ): FrameType {
    const verbs = posTags.filter((tag) => tag.tag === 'VERB').length;
    const nouns = posTags.filter((tag) => tag.tag === 'NOUN').length;
    const questions = tokens.some((t) =>
      t.text.match(/^(what|how|when|where|why|who|which)$/i),
    );

    if (questions) {
      return 'query';
    } else if (verbs > nouns) {
      return 'action';
    } else if (entities.length > 0) {
      return 'entity_description';
    } else {
      return 'statement';
    }
  }

  /**
   * Extract semantic roles from parsed components
   */
  private extractSemanticRoles(
    tokens: Token[],
    posTags: POSTag[],
    entities: Entity[],
    dependencies: Dependency[],
    frameType: FrameType,
  ): Record<string, any> {
    const roles: Record<string, any> = {};
    const context: SemanticParsingContext = {
      tokens,
      posTags,
      entities,
      dependencies,
    };

    // Extract different roles based on frame type
    switch (frameType) {
      case 'query':
        roles.subject = this.extractQuerySubject(
          context.tokens,
          context.posTags,
        );
        roles.predicate = this.extractQueryPredicate(
          context.tokens,
          context.posTags,
        );
        roles.object = this.extractQueryObject(
          context.tokens,
          context.entities,
        );
        break;

      case 'action':
        roles.agent = this.extractAgent(context.tokens, context.posTags);
        roles.action = this.extractAction(context.tokens, context.posTags);
        roles.patient = this.extractPatient(context.entities);
        break;

      case 'entity_description':
        roles.entity = context.entities[0]?.text;
        roles.properties = this.extractProperties(
          context.tokens,
          context.posTags,
          context.entities[0],
        );
        break;

      default:
        roles.topic = this.extractTopic(context.tokens, context.entities);
        roles.content = context.tokens.map((t) => t.text).join(' ');
    }

    return roles;
  }

  /**
   * Calculate overall parsing confidence
   */
  private calculateParsingConfidence(
    roles: Record<string, any>,
    entities: Entity[],
    dependencies: Dependency[],
  ): number {
    let confidence = 0.5; // Base confidence

    // Boost based on entities found
    confidence += Math.min(entities.length * 0.1, 0.2);

    // Boost based on roles identified
    confidence += Math.min(Object.keys(roles).length * 0.1, 0.2);

    // Boost based on dependencies
    confidence += Math.min(dependencies.length * 0.05, 0.1);

    return Math.min(confidence, 1.0);
  }

  /**
   * Simple language detection
   */
  private detectLanguage(text: string): string {
    // Basic language detection - could be enhanced with proper NLP library
    const englishWords = /\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/gi;
    const spanishWords =
      /\b(el|la|los|las|y|o|pero|en|sobre|a|para|de|con|por)\b/gi;

    const englishMatches = (text.match(englishWords) || []).length;
    const spanishMatches = (text.match(spanishWords) || []).length;

    if (englishMatches > spanishMatches) return 'en';
    if (spanishMatches > englishMatches) return 'es';
    return 'en'; // Default to English
  }

  /**
   * Generate hash for frame identification
   */
  private generateFrameHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Calculate frame complexity score
   */
  private calculateFrameComplexity(frame: any): number {
    let complexity = 0;

    // Base complexity from role count
    complexity += Object.keys(frame.roles || {}).length * 0.2;

    // Complexity from entity count
    complexity += (frame.metadata?.entities || 0) * 0.1;

    // Complexity from token count
    complexity += Math.min((frame.metadata?.tokens || 0) / 100, 1.0);

    return Math.min(complexity, 1.0);
  }

  // ===== ROLE EXTRACTION HELPERS =====

  private extractQuerySubject(
    tokens: Token[],
    posTags: POSTag[],
  ): string | null {
    const nouns = tokens.filter((_, i) => posTags[i].tag === 'NOUN');
    return nouns.length > 0 ? nouns[0].text : null;
  }

  private extractQueryPredicate(
    tokens: Token[],
    posTags: POSTag[],
  ): string | null {
    const verbs = tokens.filter((_, i) => posTags[i].tag === 'VERB');
    return verbs.length > 0 ? verbs[0].text : null;
  }

  private extractQueryObject(
    tokens: Token[],
    entities: Entity[],
  ): string | null {
    return entities.length > 0 ? entities[0].text : null;
  }

  private extractAgent(tokens: Token[], posTags: POSTag[]): string | null {
    const nouns = tokens.filter((_, i) => posTags[i].tag === 'NOUN');
    return nouns.length > 0 ? nouns[0].text : null;
  }

  private extractAction(tokens: Token[], posTags: POSTag[]): string | null {
    const verbs = tokens.filter((_, i) => posTags[i].tag === 'VERB');
    return verbs.length > 0 ? verbs[0].text : null;
  }

  private extractPatient(entities: Entity[]): string | null {
    return entities.length > 0 ? entities[0].text : null;
  }

  private extractProperties(
    tokens: Token[],
    posTags: POSTag[],
    entity: Entity,
  ): string[] {
    const adjectives = tokens.filter((_, i) => posTags[i].tag === 'ADJ');
    return adjectives.map((adj) => adj.text);
  }

  private extractTopic(tokens: Token[], entities: Entity[]): string {
    if (entities.length > 0) return entities[0].text;
    const significantTokens = tokens.filter((t) => !t.isStopWord);
    return significantTokens.length > 0 ? significantTokens[0].text : 'unknown';
  }

  // ===== UTILITY METHODS =====

  private lemmatize(word: string): string {
    // Simple lemmatization - could be enhanced with proper NLP library
    const lemmas: Record<string, string> = {
      running: 'run',
      cats: 'cat',
      dogs: 'dog',
      better: 'good',
      best: 'good',
    };
    return lemmas[word.toLowerCase()] || word.toLowerCase();
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'me',
      'him',
      'her',
      'us',
      'them',
    ]);
    return stopWords.has(word.toLowerCase());
  }

  private isVerb(word: string): boolean {
    const verbs = [
      'run',
      'walk',
      'eat',
      'drink',
      'sleep',
      'work',
      'play',
      'go',
      'come',
      'see',
      'hear',
      'feel',
      'think',
      'know',
    ];
    return verbs.includes(word.toLowerCase());
  }

  private isNoun(word: string): boolean {
    const nouns = [
      'cat',
      'dog',
      'house',
      'car',
      'book',
      'computer',
      'phone',
      'table',
      'chair',
      'food',
      'water',
      'time',
      'day',
      'night',
    ];
    return nouns.includes(word.toLowerCase());
  }

  private isAdjective(word: string): boolean {
    const adjectives = [
      'good',
      'bad',
      'big',
      'small',
      'hot',
      'cold',
      'fast',
      'slow',
      'happy',
      'sad',
      'red',
      'blue',
      'green',
    ];
    return adjectives.includes(word.toLowerCase());
  }
}
