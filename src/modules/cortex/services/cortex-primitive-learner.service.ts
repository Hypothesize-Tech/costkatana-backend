/**
 * Cortex Primitive Learner Service for NestJS
 * Learns new primitives from user interactions and expands vocabulary
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface LearnedPrimitive {
  id: number;
  name: string;
  type: 'action' | 'concept' | 'property' | 'modifier';
  definition: string;
  examples: string[];
  confidence: number;
  frequency: number;
  createdAt: Date;
  lastUsed: Date;
}

interface LearningMetrics {
  totalPrimitives: number;
  learnedPrimitives: number;
  learningRate: number;
  vocabularyGrowth: number;
}

@Injectable()
export class CortexPrimitiveLearnerService {
  private readonly logger = new Logger(CortexPrimitiveLearnerService.name);
  private nextPrimitiveId = 10000; // Start from 10000 for learned primitives
  private readonly learningRate: number;
  private readonly minConfidenceThreshold: number;
  private readonly maxVocabularySize: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel('LearnedPrimitive') private learnedPrimitiveModel: Model<any>,
  ) {
    this.learningRate = parseFloat(
      this.configService.get('CORTEX_PRIMITIVE_LEARNING_RATE', '0.1'),
    );
    this.minConfidenceThreshold = 0.7;
    this.maxVocabularySize = parseInt(
      this.configService.get('CORTEX_MAX_PRIMITIVE_COUNT', '100000'),
    );
  }

  /**
   * Learn from a successful interaction
   */
  async learnFromInteraction(
    input: string,
    output: string,
    context?: any,
  ): Promise<void> {
    try {
      this.logger.debug('Learning from interaction', {
        inputLength: input.length,
        outputLength: output.length,
        hasContext: !!context,
      });

      // Extract potential new primitives from the interaction
      const candidates = await this.extractPrimitiveCandidates(
        input,
        output,
        context,
      );

      for (const candidate of candidates) {
        await this.evaluateAndLearnPrimitive(candidate);
      }
    } catch (error) {
      this.logger.error('Failed to learn from interaction', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Extract primitive candidates from interaction using NLP-based analysis
   */
  private async extractPrimitiveCandidates(
    input: string,
    output: string,
    context?: any,
  ): Promise<
    Array<{
      name: string;
      type: string;
      definition: string;
      examples: string[];
    }>
  > {
    const candidates: Array<{
      name: string;
      type: string;
      definition: string;
      examples: string[];
    }> = [];

    // Enhanced pattern recognition with NLP-like processing
    const patterns = {
      // Action patterns with object recognition
      actions: [
        /\b(create|build|make|generate|produce|develop|design|construct)\b\s+(?:a|an|the)?\s*(\w+(?:\s+\w+)*)/gi,
        /\b(analyze|process|transform|convert|modify|update|change|edit)\b\s+(?:the)?\s*(\w+(?:\s+\w+)*)/gi,
        /\b(search|find|locate|discover|retrieve|get|fetch|query)\b\s+(?:for)?\s*(\w+(?:\s+\w+)*)/gi,
        /\b(delete|remove|destroy|erase|clear|purge)\b\s+(?:the)?\s*(\w+(?:\s+\w+)*)/gi,
        /\b(send|transmit|deliver|dispatch|forward)\b\s+(?:the)?\s*(\w+(?:\s+\w+)*)/gi,
        /\b(calculate|compute|measure|evaluate|assess)\b\s+(?:the)?\s*(\w+(?:\s+\w+)*)/gi,
      ],

      // Concept patterns for abstract primitives
      concepts: [
        /\b(\w+(?:\s+\w+)*)\b\s+(?:is|are|was|were|represents?|means?|defines?|refers?\s+to)\s+(.+?)(?:\.|\n|$)/gi,
        /\b(understanding|knowledge|concept|idea)\b\s+(?:of|about)\s+(\w+(?:\s+\w+)*)/gi,
      ],

      // Property patterns
      properties: [
        /\b(\w+(?:\s+\w+)*)\b\s+(?:has|contains|includes|with)\s+(?:a|an|the)?\s*(\w+(?:\s+\w+)*)/gi,
        /\b(attribute|property|field|value)\b\s+(?:of|for)\s+(\w+(?:\s+\w+)*)\s+(?:is|equals|=)\s*(.+?)(?:\.|\n|$)/gi,
      ],

      // Modifier patterns
      modifiers: [
        /\b(make|set|change|update)\b\s+(\w+(?:\s+\w+)*)\s+(?:to|as)\s+(\w+(?:\s+\w+)*)/gi,
        /\b(\w+(?:\s+\w+)*)\s+(?:should|must|can|may)\s+(?:be|have|do)\s+(.+?)(?:\.|\n|$)/gi,
      ],
    };

    // Process action patterns
    for (const pattern of patterns.actions) {
      const matches = input.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleanMatch = match.toLowerCase().trim();
          const parts = cleanMatch.split(/\s+/);
          if (parts.length >= 2) {
            const action = parts[0];
            const target = parts.slice(1).join('_').replace(/[^\w]/g, '_');

            const candidate = {
              name: `${action}_${target}`,
              type: 'action',
              definition: `To ${action} ${target.replace(/_/g, ' ')}`,
              examples: [match.trim()],
            };

            // Avoid duplicates
            if (!candidates.some((c) => c.name === candidate.name)) {
              candidates.push(candidate);
            }
          }
        }
      }
    }

    // Process concept patterns
    for (const pattern of patterns.concepts) {
      const matches = input.match(pattern);
      if (matches) {
        for (const match of matches) {
          const conceptMatch = match.match(
            /\b(\w+(?:\s+\w+)*)\b\s+(?:is|are|was|were|represents?|means?|defines?|refers?\s+to)\s+(.+?)(?:\.|\n|$)/i,
          );
          if (conceptMatch && conceptMatch[1] && conceptMatch[2]) {
            const concept = conceptMatch[1].toLowerCase().replace(/\s+/g, '_');
            const definition = conceptMatch[2].trim();

            const candidate = {
              name: `concept_${concept}`,
              type: 'concept',
              definition: `${concept.replace(/_/g, ' ')}: ${definition}`,
              examples: [match.trim()],
            };

            if (!candidates.some((c) => c.name === candidate.name)) {
              candidates.push(candidate);
            }
          }
        }
      }
    }

    // Process property patterns
    for (const pattern of patterns.properties) {
      const matches = input.match(pattern);
      if (matches) {
        for (const match of matches) {
          const propertyMatch = match.match(
            /\b(\w+(?:\s+\w+)*)\b\s+(?:has|contains|includes|with)\s+(?:a|an|the)?\s*(\w+(?:\s+\w+)*)/i,
          );
          if (propertyMatch && propertyMatch[1] && propertyMatch[2]) {
            const object = propertyMatch[1].toLowerCase().replace(/\s+/g, '_');
            const property = propertyMatch[2]
              .toLowerCase()
              .replace(/\s+/g, '_');

            const candidate = {
              name: `property_${object}_${property}`,
              type: 'property',
              definition: `${object.replace(/_/g, ' ')} has ${property.replace(/_/g, ' ')}`,
              examples: [match.trim()],
            };

            if (!candidates.some((c) => c.name === candidate.name)) {
              candidates.push(candidate);
            }
          }
        }
      }
    }

    // Process modifier patterns
    for (const pattern of patterns.modifiers) {
      const matches = input.match(pattern);
      if (matches) {
        for (const match of matches) {
          const modifierMatch = match.match(
            /\b(make|set|change|update)\b\s+(\w+(?:\s+\w+)*)\s+(?:to|as)\s+(\w+(?:\s+\w+)*)/i,
          );
          if (
            modifierMatch &&
            modifierMatch[1] &&
            modifierMatch[2] &&
            modifierMatch[3]
          ) {
            const action = modifierMatch[1].toLowerCase();
            const target = modifierMatch[2].toLowerCase().replace(/\s+/g, '_');
            const value = modifierMatch[3].toLowerCase().replace(/\s+/g, '_');

            const candidate = {
              name: `modifier_${action}_${target}_${value}`,
              type: 'modifier',
              definition: `To ${action} ${target.replace(/_/g, ' ')} to ${value.replace(/_/g, ' ')}`,
              examples: [match.trim()],
            };

            if (!candidates.some((c) => c.name === candidate.name)) {
              candidates.push(candidate);
            }
          }
        }
      }
    }

    // Semantic analysis - look for patterns in output that indicate learned behavior
    if (output && output.length > 0) {
      // If output contains structured data or specific patterns, extract those as primitives
      const structuredPatterns = [
        /\{[\s\S]*?\}/g, // JSON-like objects
        /\[[\s\S]*?\]/g, // Arrays
        /"[^"]*":\s*[^,}]+/g, // Key-value pairs
      ];

      for (const pattern of structuredPatterns) {
        const matches = output.match(pattern);
        if (matches && matches.length > 0) {
          candidates.push({
            name: `structure_output_${Date.now()}`,
            type: 'action',
            definition: 'To generate structured output data',
            examples: matches.slice(0, 3), // Limit examples
          });
          break; // Only add one structured output primitive
        }
      }
    }

    // Context-aware enhancement
    if (context && typeof context === 'object') {
      // If context indicates a specific domain, enhance primitive extraction
      if (
        context.domain === 'ai-optimization' ||
        context.domain === 'cost-tracking'
      ) {
        // Add domain-specific primitives
        const domainPrimitives = [
          {
            name: 'optimize_cost',
            type: 'action',
            definition: 'To optimize costs in AI operations',
            examples: [
              'optimize costs',
              'reduce expenses',
              'cost optimization',
            ],
          },
          {
            name: 'analyze_usage',
            type: 'action',
            definition: 'To analyze usage patterns',
            examples: ['analyze usage', 'usage analysis', 'pattern analysis'],
          },
        ];

        // Only add if not already present and context suggests relevance
        for (const primitive of domainPrimitives) {
          if (
            !candidates.some((c) => c.name === primitive.name) &&
            (input.toLowerCase().includes(primitive.name.split('_')[0]) ||
              input.toLowerCase().includes(primitive.name.split('_')[1]))
          ) {
            candidates.push(primitive);
          }
        }
      }
    }

    this.logger.debug(
      `Extracted ${candidates.length} primitive candidates from interaction`,
      {
        inputLength: input.length,
        outputLength: output.length,
        hasContext: !!context,
      },
    );

    return candidates;
  }

  /**
   * Evaluate and potentially learn a primitive
   */
  private async evaluateAndLearnPrimitive(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): Promise<void> {
    try {
      // Check if primitive already exists
      const existing = await this.learnedPrimitiveModel
        .findOne({
          name: candidate.name,
        })
        .lean();

      if (existing) {
        // Update frequency and confidence
        await this.learnedPrimitiveModel.updateOne(
          { name: candidate.name },
          {
            $inc: { frequency: 1 },
            $set: {
              lastUsed: new Date(),
              confidence: Math.min(
                1.0,
                (existing as any).confidence + this.learningRate,
              ),
            },
          },
        );
        return;
      }

      // Evaluate if candidate is worth learning
      const confidence = await this.evaluateCandidateConfidence(candidate);

      if (confidence >= this.minConfidenceThreshold) {
        const learnedPrimitive: LearnedPrimitive = {
          id: this.nextPrimitiveId++,
          name: candidate.name,
          type: candidate.type as any,
          definition: candidate.definition,
          examples: candidate.examples,
          confidence,
          frequency: 1,
          createdAt: new Date(),
          lastUsed: new Date(),
        };

        await this.learnedPrimitiveModel.create(learnedPrimitive);

        this.logger.log('Learned new primitive', {
          name: candidate.name,
          type: candidate.type,
          confidence,
        });
      }
    } catch (error) {
      this.logger.error('Failed to evaluate/learn primitive', {
        candidate: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Evaluate confidence in a primitive candidate using semantic coherence analysis
   */
  private async evaluateCandidateConfidence(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): Promise<number> {
    let confidence = 0.3; // Base confidence - more conservative starting point

    // Semantic coherence analysis
    const coherenceScore = await this.calculateSemanticCoherence(candidate);
    confidence += coherenceScore * 0.4; // Coherence contributes up to 40%

    // Linguistic quality analysis
    const linguisticScore = this.calculateLinguisticQuality(candidate);
    confidence += linguisticScore * 0.3; // Quality contributes up to 30%

    // Example strength analysis
    const exampleScore = this.calculateExampleStrength(candidate);
    confidence += exampleScore * 0.2; // Examples contribute up to 20%

    // Type-specific adjustments
    confidence += this.calculateTypeSpecificScore(candidate);

    // Frequency and recency bonuses (calculated from historical data)
    confidence += await this.calculateFrequencyBonus(candidate);

    // Domain relevance bonus
    confidence += await this.calculateDomainRelevance(candidate);

    return Math.min(1.0, Math.max(0.0, confidence));
  }

  /**
   * Calculate semantic coherence score
   */
  private async calculateSemanticCoherence(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): Promise<number> {
    let coherence = 0.5;

    // Check definition clarity and completeness
    const definition = candidate.definition.toLowerCase();
    const words = definition.split(/\s+/);

    // Penalize very short definitions
    if (words.length < 3) {
      coherence -= 0.2;
    }

    // Reward definitions with clear action verbs or conceptual terms
    const actionVerbs = [
      'create',
      'build',
      'make',
      'generate',
      'analyze',
      'process',
      'transform',
      'find',
      'search',
      'calculate',
      'compute',
    ];
    const conceptualTerms = [
      'concept',
      'idea',
      'understanding',
      'knowledge',
      'property',
      'attribute',
      'relationship',
    ];

    const hasActionVerb = actionVerbs.some((verb) => definition.includes(verb));
    const hasConceptualTerm = conceptualTerms.some((term) =>
      definition.includes(term),
    );

    if (candidate.type === 'action' && hasActionVerb) {
      coherence += 0.2;
    } else if (candidate.type === 'concept' && hasConceptualTerm) {
      coherence += 0.2;
    }

    // Check consistency between name and definition
    const nameWords = candidate.name.toLowerCase().split('_');
    const definitionWords = definition.split(/\s+/);

    const nameDefinitionOverlap = nameWords.filter((word) =>
      definitionWords.some(
        (defWord) =>
          defWord.includes(word) ||
          word.includes(defWord) ||
          this.calculateWordSimilarity(word, defWord) > 0.8,
      ),
    ).length;

    const overlapRatio = nameDefinitionOverlap / Math.max(nameWords.length, 1);
    coherence += overlapRatio * 0.2;

    // Check for semantic redundancy or contradictions
    const contradictions = ['not', 'never', 'cannot', 'impossible'];
    const hasContradictions = contradictions.some((word) =>
      definition.includes(word),
    );

    if (hasContradictions) {
      coherence -= 0.1;
    }

    return Math.max(0.0, Math.min(1.0, coherence));
  }

  /**
   * Calculate word similarity using simple string metrics
   */
  private calculateWordSimilarity(word1: string, word2: string): number {
    if (word1 === word2) return 1.0;

    const longer = word1.length > word2.length ? word1 : word2;
    const shorter = word1.length > word2.length ? word2 : word1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance for string similarity
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i += 1) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j += 1) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate linguistic quality score
   */
  private calculateLinguisticQuality(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): number {
    let quality = 0.5;

    // Check for proper grammar and structure
    const definition = candidate.definition;

    // Reward complete sentences
    if (
      definition.endsWith('.') ||
      definition.endsWith('!') ||
      definition.endsWith('?')
    ) {
      quality += 0.1;
    }

    // Penalize excessive punctuation
    const punctuationCount = (definition.match(/[!?.,;:]/g) || []).length;
    const wordCount = definition.split(/\s+/).length;

    if (punctuationCount / wordCount > 0.3) {
      quality -= 0.1;
    }

    // Check for proper capitalization (first word of definition)
    if (
      definition.length > 0 &&
      definition[0] === definition[0].toUpperCase()
    ) {
      quality += 0.1;
    }

    // Penalize ALL CAPS or all lowercase (except for acronyms/initialisms)
    const allCaps = definition === definition.toUpperCase();
    const allLower = definition === definition.toLowerCase();

    if (allCaps && definition.length > 5) {
      quality -= 0.1;
    }

    if (allLower && definition.length > 20) {
      quality -= 0.05;
    }

    // Check for meaningful content (not just stop words)
    const stopWords = [
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
    ];
    const meaningfulWords = definition
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => !stopWords.includes(word) && word.length > 2);

    if (meaningfulWords.length < 2) {
      quality -= 0.2;
    }

    return Math.max(0.0, Math.min(1.0, quality));
  }

  /**
   * Calculate example strength score
   */
  private calculateExampleStrength(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): number {
    const examples = candidate.examples;
    let strength = 0.0;

    if (examples.length === 0) return 0.0;

    // Base score from number of examples
    strength += Math.min(examples.length * 0.1, 0.3);

    // Quality of examples
    for (const example of examples) {
      // Reward examples that demonstrate the concept clearly
      if (example.length > 10) {
        strength += 0.05;
      }

      // Check if example contains relevant terms from name or definition
      const nameWords = candidate.name.toLowerCase().split('_');
      const defWords = candidate.definition.toLowerCase().split(/\s+/);

      const relevantTerms = [...nameWords, ...defWords].filter(
        (word) => word.length > 2,
      );
      const exampleLower = example.toLowerCase();

      const termMatches = relevantTerms.filter((term) =>
        exampleLower.includes(term),
      ).length;

      if (termMatches > 0) {
        strength += 0.05 * (termMatches / relevantTerms.length);
      }
    }

    // Diversity bonus - different examples showing different aspects
    if (examples.length > 1) {
      const uniqueLengths = new Set(examples.map((e) => e.length)).size;
      strength += (uniqueLengths / examples.length) * 0.1;
    }

    return Math.min(1.0, strength);
  }

  /**
   * Calculate type-specific score adjustments
   */
  private calculateTypeSpecificScore(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): number {
    let adjustment = 0.0;

    switch (candidate.type) {
      case 'action':
        // Actions should have imperative definitions
        if (candidate.definition.toLowerCase().startsWith('to ')) {
          adjustment += 0.1;
        }
        // Actions benefit from concrete examples
        if (
          candidate.examples.some(
            (ex) => ex.includes(' ') && ex.split(' ').length > 2,
          )
        ) {
          adjustment += 0.05;
        }
        break;

      case 'concept':
        // Concepts should be descriptive
        if (
          candidate.definition.includes(':') ||
          candidate.definition.includes('means')
        ) {
          adjustment += 0.1;
        }
        // Concepts benefit from explanatory examples
        if (candidate.examples.some((ex) => ex.length > 30)) {
          adjustment += 0.05;
        }
        break;

      case 'property':
        // Properties should describe relationships
        if (
          candidate.definition.includes('has') ||
          candidate.definition.includes('contains')
        ) {
          adjustment += 0.1;
        }
        break;

      case 'modifier':
        // Modifiers should describe changes
        if (
          candidate.definition.includes('to') ||
          candidate.definition.includes('change')
        ) {
          adjustment += 0.1;
        }
        break;
    }

    return adjustment;
  }

  /**
   * Calculate frequency bonus based on historical usage patterns
   */
  private async calculateFrequencyBonus(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): Promise<number> {
    let bonus = 0.0;

    try {
      // Query historical usage patterns from database
      const existingPrimitive = await this.learnedPrimitiveModel
        .findOne({
          name: candidate.name,
        })
        .lean();

      if (existingPrimitive) {
        const frequency = (existingPrimitive as any).frequency || 0;
        const confidence = (existingPrimitive as any).confidence || 0;
        const lastUsed = (existingPrimitive as any).lastUsed || new Date();
        const createdAt = (existingPrimitive as any).createdAt || new Date();

        // Base frequency bonus (0-0.1 based on usage count)
        const frequencyScore = Math.min(frequency / 100, 0.1);
        bonus += frequencyScore;

        // Recency bonus - more recent usage gets higher bonus
        const daysSinceLastUse =
          (Date.now() - new Date(lastUsed).getTime()) / (1000 * 60 * 60 * 24);
        const recencyBonus = Math.max(
          0,
          0.05 * Math.exp(-daysSinceLastUse / 30),
        ); // Exponential decay over 30 days
        bonus += recencyBonus;

        // Consistency bonus - primitives that maintain high confidence over time
        if (confidence > 0.8) {
          bonus += 0.02;
        }

        // Maturity bonus - primitives that have been around longer are more trusted
        const daysSinceCreation =
          (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const maturityBonus = Math.min((daysSinceCreation / 365) * 0.03, 0.03); // Up to 3% over a year
        bonus += maturityBonus;
      } else {
        // New candidate bonuses based on quality indicators
        // Bonus for candidates that appear to be commonly useful patterns
        if (candidate.examples.length > 1) {
          bonus += 0.05;
        }

        // Bonus for candidates with clear, actionable definitions
        if (
          candidate.definition.length > 20 &&
          candidate.definition.split(' ').length > 5
        ) {
          bonus += 0.03;
        }

        // Pattern recognition bonus - check if candidate matches common successful patterns
        const successfulPatterns = await this.learnedPrimitiveModel
          .find({
            confidence: { $gte: 0.8 },
            frequency: { $gte: 10 },
          })
          .limit(100)
          .lean();

        const patternSimilarity = this.calculatePatternSimilarity(
          candidate,
          successfulPatterns,
        );
        bonus += patternSimilarity * 0.02;
      }

      // Success rate bonus based on type
      const typeStats = await this.getPrimitiveTypeStats(candidate.type);
      if (typeStats.avgConfidence > 0.7) {
        bonus += 0.01;
      }
    } catch (error) {
      this.logger.warn('Failed to calculate frequency bonus, using fallback', {
        candidate: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple bonuses
      if (candidate.examples.length > 1) {
        bonus += 0.05;
      }
      if (
        candidate.definition.length > 20 &&
        candidate.definition.split(' ').length > 5
      ) {
        bonus += 0.03;
      }
    }

    return Math.min(0.2, bonus); // Cap at 20% bonus
  }

  /**
   * Get statistics for a primitive type
   */
  private async getPrimitiveTypeStats(
    type: string,
  ): Promise<{ avgConfidence: number; avgFrequency: number; count: number }> {
    try {
      const stats = await this.learnedPrimitiveModel.aggregate([
        { $match: { type } },
        {
          $group: {
            _id: null,
            avgConfidence: { $avg: '$confidence' },
            avgFrequency: { $avg: '$frequency' },
            count: { $sum: 1 },
          },
        },
      ]);

      if (stats.length > 0) {
        const stat = stats[0];
        return {
          avgConfidence: stat.avgConfidence || 0,
          avgFrequency: stat.avgFrequency || 0,
          count: stat.count || 0,
        };
      }
    } catch (error) {
      this.logger.warn('Failed to get primitive type stats', { type, error });
    }

    return { avgConfidence: 0, avgFrequency: 0, count: 0 };
  }

  /**
   * Calculate similarity to successful patterns
   */
  private calculatePatternSimilarity(
    candidate: {
      name: string;
      type: string;
      definition: string;
      examples: string[];
    },
    successfulPatterns: any[],
  ): number {
    let maxSimilarity = 0;

    for (const pattern of successfulPatterns) {
      let similarity = 0;

      // Type similarity
      if (pattern.type === candidate.type) {
        similarity += 0.3;
      }

      // Name similarity (basic string overlap)
      const nameWords = candidate.name.toLowerCase().split('_');
      const patternWords = pattern.name.toLowerCase().split('_');
      const nameOverlap = nameWords.filter((word) =>
        patternWords.includes(word),
      ).length;
      similarity +=
        (nameOverlap / Math.max(nameWords.length, patternWords.length)) * 0.4;

      // Definition length similarity
      const defLengthDiff = Math.abs(
        candidate.definition.length - pattern.definition.length,
      );
      const lengthSimilarity = Math.max(0, 1 - defLengthDiff / 200); // Normalize over 200 chars
      similarity += lengthSimilarity * 0.3;

      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    return maxSimilarity;
  }

  /**
   * Calculate domain relevance bonus based on current context and usage patterns
   */
  private async calculateDomainRelevance(candidate: {
    name: string;
    type: string;
    definition: string;
    examples: string[];
  }): Promise<number> {
    let relevance = 0.0;

    try {
      // Get current domain context from recent high-confidence primitives
      const recentPrimitives = await this.learnedPrimitiveModel
        .find({
          confidence: { $gte: 0.8 },
          lastUsed: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
        })
        .sort({ frequency: -1 })
        .limit(50)
        .lean();

      // Extract domain themes from recent successful primitives
      const domainThemes = this.extractDomainThemes(recentPrimitives);

      // Calculate relevance based on semantic similarity to current domain themes
      const candidateText = (
        candidate.name +
        ' ' +
        candidate.definition +
        ' ' +
        candidate.examples.join(' ')
      ).toLowerCase();
      const themeMatches = domainThemes.filter(
        (theme) =>
          candidateText.includes(theme.term.toLowerCase()) ||
          this.calculateSemanticSimilarity(candidateText, theme.term) > 0.7,
      );

      relevance += themeMatches.length * 0.015; // 1.5% per matching theme

      // Domain-specific term matching with weighted scoring
      const domainTerms = {
        'ai-optimization': {
          terms: [
            'optimize',
            'cost',
            'efficiency',
            'performance',
            'model',
            'ai',
            'learning',
            'inference',
            'token',
            'latency',
          ],
          weight: 1.0,
        },
        'cost-tracking': {
          terms: [
            'cost',
            'budget',
            'spend',
            'pricing',
            'billing',
            'usage',
            'consumption',
            'expense',
          ],
          weight: 1.0,
        },
        'api-usage': {
          terms: [
            'api',
            'endpoint',
            'request',
            'response',
            'rate',
            'limit',
            'quota',
            'call',
          ],
          weight: 0.8,
        },
        documentation: {
          terms: [
            'document',
            'guide',
            'tutorial',
            'example',
            'reference',
            'manual',
            'help',
          ],
          weight: 0.6,
        },
        general: {
          terms: [
            'create',
            'build',
            'make',
            'find',
            'search',
            'update',
            'delete',
            'process',
          ],
          weight: 0.4,
        },
      };

      for (const [domain, config] of Object.entries(domainTerms)) {
        const matches = config.terms.filter((term) =>
          candidateText.includes(term),
        ).length;
        if (matches > 0) {
          relevance += matches * 0.01 * config.weight;
        }
      }

      // Context-aware relevance - check if candidate complements recent primitives
      const complementaryScore = this.calculateComplementaryScore(
        candidate,
        recentPrimitives,
      );
      relevance += complementaryScore * 0.02;

      // Type popularity in current domain
      const typeFrequency = recentPrimitives.filter(
        (p) => p.type === candidate.type,
      ).length;
      const typeRatio = typeFrequency / recentPrimitives.length;
      relevance += typeRatio * 0.01; // Small bonus for popular types in current context
    } catch (error) {
      this.logger.warn('Failed to calculate domain relevance, using fallback', {
        candidate: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to basic term matching
      const aiTerms = [
        'optimize',
        'cost',
        'efficiency',
        'performance',
        'model',
        'ai',
        'learning',
      ];
      const candidateText = (
        candidate.name +
        ' ' +
        candidate.definition
      ).toLowerCase();

      const aiMatches = aiTerms.filter((term) =>
        candidateText.includes(term),
      ).length;
      relevance += aiMatches * 0.02;
    }

    return Math.min(0.15, relevance); // Cap at 15% bonus
  }

  /**
   * Extract domain themes from successful primitives
   */
  private extractDomainThemes(
    primitives: any[],
  ): Array<{ term: string; frequency: number; type: string }> {
    const themes: Map<string, { frequency: number; types: Set<string> }> =
      new Map();

    for (const primitive of primitives) {
      // Extract key terms from primitive names and definitions
      const terms = [
        ...primitive.name.split('_'),
        ...primitive.definition
          .toLowerCase()
          .split(/\s+/)
          .filter((word: string) => word.length > 3),
      ];

      for (const term of terms) {
        if (!themes.has(term)) {
          themes.set(term, { frequency: 0, types: new Set() });
        }
        const theme = themes.get(term)!;
        theme.frequency++;
        theme.types.add(primitive.type);
      }
    }

    // Return top themes by frequency
    return Array.from(themes.entries())
      .map(([term, data]) => ({
        term,
        frequency: data.frequency,
        type: data.types.values().next().value || 'general',
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 20); // Top 20 themes
  }

  /**
   * Calculate semantic similarity between two texts
   */
  private calculateSemanticSimilarity(text1: string, text2: string): number {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set(Array.from(set1).filter((x) => set2.has(x)));
    const union = new Set([...Array.from(set1), ...Array.from(set2)]);

    return intersection.size / union.size;
  }

  /**
   * Calculate how well a candidate complements recent primitives
   */
  private calculateComplementaryScore(
    candidate: {
      name: string;
      type: string;
      definition: string;
      examples: string[];
    },
    recentPrimitives: any[],
  ): number {
    let complementaryScore = 0;

    // Look for complementary relationships
    const candidateTerms = candidate.name.toLowerCase().split('_');

    for (const primitive of recentPrimitives) {
      const primitiveTerms = primitive.name.toLowerCase().split('_');

      // Check for action-object complementarity (e.g., "create_user" complements "find_user")
      if (candidate.type === 'action' && primitive.type === 'action') {
        const sharedObjects = candidateTerms.filter(
          (term) => primitiveTerms.includes(term) && term.length > 3,
        );

        if (sharedObjects.length > 0) {
          complementaryScore += 0.1;
        }
      }

      // Check for concept-action complementarity
      if (
        (candidate.type === 'concept' && primitive.type === 'action') ||
        (candidate.type === 'action' && primitive.type === 'concept')
      ) {
        const overlap = candidateTerms.filter((term) =>
          primitive.definition.toLowerCase().includes(term),
        ).length;

        if (overlap > 0) {
          complementaryScore += 0.05;
        }
      }
    }

    return Math.min(1.0, complementaryScore);
  }

  /**
   * Get learning metrics
   */
  async getLearningMetrics(): Promise<LearningMetrics> {
    try {
      const totalPrimitives = await this.learnedPrimitiveModel.countDocuments();
      const learnedPrimitives = await this.learnedPrimitiveModel.countDocuments(
        {
          confidence: { $gte: this.minConfidenceThreshold },
        },
      );

      const vocabularyGrowth =
        totalPrimitives > 0 ? learnedPrimitives / totalPrimitives : 0;

      return {
        totalPrimitives,
        learnedPrimitives,
        learningRate: this.learningRate,
        vocabularyGrowth,
      };
    } catch (error) {
      this.logger.error('Failed to get learning metrics', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalPrimitives: 0,
        learnedPrimitives: 0,
        learningRate: this.learningRate,
        vocabularyGrowth: 0,
      };
    }
  }

  /**
   * Get learned primitives
   */
  async getLearnedPrimitives(limit = 100): Promise<LearnedPrimitive[]> {
    try {
      const primitives = await this.learnedPrimitiveModel
        .find({ confidence: { $gte: this.minConfidenceThreshold } })
        .sort({ frequency: -1, lastUsed: -1 })
        .limit(limit)
        .lean();

      return primitives.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        definition: p.definition,
        examples: p.examples,
        confidence: p.confidence,
        frequency: p.frequency,
        createdAt: p.createdAt,
        lastUsed: p.lastUsed,
      }));
    } catch (error) {
      this.logger.error('Failed to get learned primitives', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Clean up old/low-confidence primitives
   */
  async cleanupPrimitives(): Promise<number> {
    try {
      const result = await this.learnedPrimitiveModel.deleteMany({
        $or: [
          { confidence: { $lt: this.minConfidenceThreshold } },
          {
            lastUsed: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          }, // Older than 90 days
        ],
      });

      this.logger.log('Cleaned up primitives', {
        deletedCount: result.deletedCount,
      });

      return result.deletedCount;
    } catch (error) {
      this.logger.error('Failed to cleanup primitives', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
