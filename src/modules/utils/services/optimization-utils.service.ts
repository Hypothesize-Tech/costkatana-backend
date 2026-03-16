/**
 * Optimization Utils Service
 *
 * Provides utility functions for prompt optimization, compression, and text processing.
 * Handles conversation context trimming, prompt compression, and optimization suggestions.
 * Uses NLP libraries (natural, compromise) for advanced text analysis and compression.
 */

import { Injectable, Logger } from '@nestjs/common';
// @ts-ignore - natural may not have types
import * as natural from 'natural';
// @ts-ignore - compromise may not have types
import nlp from 'compromise';

export interface OptimizationSuggestion {
  /** Type of optimization */
  type:
    | 'compression'
    | 'context_trimming'
    | 'semantic_caching'
    | 'prompt_engineering'
    | 'model_selection';

  /** Description of the optimization */
  description: string;

  /** Expected impact (percentage improvement) */
  impact: number;

  /** Confidence in the suggestion (0-1) */
  confidence: number;

  /** Implementation difficulty */
  difficulty: 'low' | 'medium' | 'high';

  /** Estimated token savings */
  tokenSavings?: number;

  /** Cost savings in USD */
  costSavings?: number;
}

export interface CompressedPrompt {
  /** Original prompt */
  original: string;

  /** Compressed prompt */
  compressed: string;

  /** Compression ratio (0-1, where 1 means no compression) */
  compressionRatio: number;

  /** Token savings */
  tokenSavings: number;

  /** Quality preservation score (0-1) */
  qualityScore: number;

  /** Applied compression techniques */
  techniques: string[];
}

export interface ConversationContext {
  /** Conversation messages */
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
    tokenCount?: number;
    metadata?: Record<string, unknown>;
  }>;

  /** Current context window size */
  currentWindowSize: number;

  /** Maximum allowed context size */
  maxContextSize: number;

  /** Context utilization (0-1) */
  utilization: number;
}

@Injectable()
export class OptimizationUtilsService {
  private readonly logger = new Logger(OptimizationUtilsService.name);

  /**
   * Generate optimization suggestions based on usage patterns
   */
  generateOptimizationSuggestions(
    prompt: string,
    context?: ConversationContext,
    currentModel?: string,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Analyze prompt for compression opportunities
    const compressionSuggestions = this.analyzeCompressionOpportunities(prompt);
    suggestions.push(...compressionSuggestions);

    // Analyze context for trimming opportunities
    if (context) {
      const contextSuggestions =
        this.analyzeContextTrimmingOpportunities(context);
      suggestions.push(...contextSuggestions);
    }

    // Analyze for semantic caching opportunities
    const cachingSuggestions = this.analyzeSemanticCachingOpportunities(prompt);
    suggestions.push(...cachingSuggestions);

    // Analyze for model optimization opportunities
    if (currentModel) {
      const modelSuggestions = this.analyzeModelOptimizationOpportunities(
        prompt,
        currentModel,
      );
      suggestions.push(...modelSuggestions);
    }

    // Sort by impact and confidence
    return suggestions
      .sort((a, b) => b.impact * b.confidence - a.impact * a.confidence)
      .slice(0, 5); // Return top 5 suggestions
  }

  /**
   * Compress a prompt using various techniques
   */
  compressPrompt(
    prompt: string,
    targetReduction: number = 0.3,
    preserveSemantics: boolean = true,
  ): CompressedPrompt {
    let compressed = prompt;
    const techniques: string[] = [];
    let qualityScore = 1.0;

    // Remove redundant whitespace
    if (/\s{2,}/.test(compressed)) {
      compressed = compressed.replace(/\s+/g, ' ').trim();
      techniques.push('whitespace_normalization');
    }

    // Remove unnecessary punctuation
    if (targetReduction > 0.1) {
      compressed = this.removeUnnecessaryPunctuation(compressed);
      techniques.push('punctuation_optimization');
      qualityScore *= 0.98;
    }

    // Compress repetitive phrases
    if (targetReduction > 0.2) {
      const repetitionResult = this.compressRepetitivePhrases(compressed);
      compressed = repetitionResult.text;
      if (repetitionResult.compressed) {
        techniques.push('repetition_compression');
        qualityScore *= 0.95;
      }
    }

    // Semantic compression (advanced)
    if (targetReduction > 0.4 && preserveSemantics) {
      const semanticResult = this.performSemanticCompression(compressed);
      compressed = semanticResult.text;
      techniques.push('semantic_compression');
      qualityScore *= semanticResult.qualityImpact;
    }

    // Calculate metrics
    const originalTokens = Math.ceil(prompt.length / 4);
    const compressedTokens = Math.ceil(compressed.length / 4);
    const tokenSavings = Math.max(0, originalTokens - compressedTokens);
    const compressionRatio = compressed.length / prompt.length;

    return {
      original: prompt,
      compressed,
      compressionRatio,
      tokenSavings,
      qualityScore: Math.max(0.1, qualityScore),
      techniques,
    };
  }

  /**
   * Trim conversation context to fit within limits
   */
  trimConversationContext(
    context: ConversationContext,
    strategy:
      | 'recent_first'
      | 'important_first'
      | 'summarize_old' = 'recent_first',
  ): ConversationContext {
    const { messages, maxContextSize } = context;

    if (context.currentWindowSize <= maxContextSize) {
      return context; // No trimming needed
    }

    let trimmedMessages = [...messages];
    const currentSize = context.currentWindowSize;

    switch (strategy) {
      case 'recent_first':
        // Keep most recent messages
        trimmedMessages = this.trimByRecency(messages, maxContextSize);
        break;

      case 'important_first':
        // Keep messages based on importance scoring
        trimmedMessages = this.trimByImportance(messages, maxContextSize);
        break;

      case 'summarize_old':
        // Summarize older messages and keep recent ones
        trimmedMessages = this.trimBySummarization(messages, maxContextSize);
        break;
    }

    // Recalculate current window size
    const newWindowSize = trimmedMessages.reduce(
      (sum, msg) => sum + (msg.tokenCount || Math.ceil(msg.content.length / 4)),
      0,
    );

    return {
      ...context,
      messages: trimmedMessages,
      currentWindowSize: newWindowSize,
      utilization: newWindowSize / maxContextSize,
    };
  }

  /**
   * Analyze compression opportunities in a prompt
   */
  private analyzeCompressionOpportunities(
    prompt: string,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Check for redundant whitespace
    const whitespaceCount = (prompt.match(/\s{2,}/g) || []).length;
    if (whitespaceCount > 0) {
      const impact = Math.min(0.05, whitespaceCount * 0.01);
      suggestions.push({
        type: 'compression',
        description: 'Remove redundant whitespace to reduce token count',
        impact,
        confidence: 0.95,
        difficulty: 'low',
        tokenSavings: Math.ceil(whitespaceCount * 0.5),
      });
    }

    // Check for repetitive phrases
    const repetitionScore = this.calculateRepetitionScore(prompt);
    if (repetitionScore > 0.3) {
      suggestions.push({
        type: 'compression',
        description: 'Compress repetitive phrases and instructions',
        impact: Math.min(0.25, repetitionScore * 0.8),
        confidence: 0.85,
        difficulty: 'medium',
        tokenSavings: Math.ceil((prompt.length * 0.15) / 4),
      });
    }

    // Check for verbose instructions
    const verbosityScore = this.calculateVerbosityScore(prompt);
    if (verbosityScore > 0.7) {
      suggestions.push({
        type: 'compression',
        description: 'Simplify verbose instructions while preserving meaning',
        impact: Math.min(0.3, verbosityScore * 0.4),
        confidence: 0.8,
        difficulty: 'high',
        tokenSavings: Math.ceil((prompt.length * 0.2) / 4),
      });
    }

    return suggestions;
  }

  /**
   * Analyze context trimming opportunities
   */
  private analyzeContextTrimmingOpportunities(
    context: ConversationContext,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    if (context.utilization > 0.9) {
      suggestions.push({
        type: 'context_trimming',
        description:
          'Context window is nearly full - consider trimming older messages',
        impact: Math.min(0.2, (context.utilization - 0.9) * 2),
        confidence: 0.9,
        difficulty: 'low',
        tokenSavings: Math.ceil(
          (context.currentWindowSize - context.maxContextSize * 0.8) * 0.5,
        ),
      });
    }

    // Check for message patterns that could be summarized
    const oldMessages = context.messages.slice(
      0,
      Math.floor(context.messages.length * 0.7),
    );
    const summarizableCount = oldMessages.filter(
      (msg) => msg.content.length > 100 && msg.role !== 'system',
    ).length;

    if (summarizableCount > 2) {
      suggestions.push({
        type: 'context_trimming',
        description:
          'Summarize older conversation messages to save context space',
        impact: 0.15,
        confidence: 0.75,
        difficulty: 'medium',
        tokenSavings: Math.ceil((summarizableCount * 50) / 4),
      });
    }

    return suggestions;
  }

  /**
   * Analyze semantic caching opportunities
   */
  private analyzeSemanticCachingOpportunities(
    prompt: string,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Check for common query patterns
    const commonPatterns = [
      /explain|describe|what is/i,
      /how to|how do/i,
      /write|create|generate/i,
      /analyze|review|evaluate/i,
    ];

    const matches = commonPatterns.filter((pattern) =>
      pattern.test(prompt),
    ).length;

    if (matches > 0) {
      suggestions.push({
        type: 'semantic_caching',
        description: 'Similar queries could benefit from semantic caching',
        impact: Math.min(0.4, matches * 0.1),
        confidence: 0.7,
        difficulty: 'medium',
      });
    }

    return suggestions;
  }

  /**
   * Analyze model optimization opportunities
   */
  private analyzeModelOptimizationOpportunities(
    prompt: string,
    currentModel: string,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Simple heuristic: if prompt is short and simple, suggest cheaper model
    const promptComplexity = this.calculatePromptComplexity(prompt);

    if (
      (promptComplexity < 0.3 && currentModel.includes('gpt-4')) ||
      currentModel.includes('claude-3-opus')
    ) {
      suggestions.push({
        type: 'model_selection',
        description: 'Consider using a lighter model for this simple task',
        impact: 0.6, // Significant cost savings
        confidence: 0.8,
        difficulty: 'low',
      });
    }

    // If prompt is very complex, suggest more capable model
    if (
      promptComplexity > 0.8 &&
      (currentModel.includes('haiku') || currentModel.includes('gpt-4o-mini'))
    ) {
      suggestions.push({
        type: 'model_selection',
        description: 'Complex task may benefit from a more capable model',
        impact: 0.1, // Quality improvement
        confidence: 0.6,
        difficulty: 'low',
      });
    }

    return suggestions;
  }

  /**
   * Remove unnecessary punctuation
   */
  private removeUnnecessaryPunctuation(text: string): string {
    return (
      text
        // Remove multiple consecutive punctuation
        .replace(/([.!?]){2,}/g, '$1')
        // Remove trailing punctuation before newlines
        .replace(/[.!?,;:]\s*\n/g, '\n')
        // Normalize quotes
        .replace(/[""]+/g, '"')
        .replace(/['']+/g, "'")
    );
  }

  /**
   * Compress repetitive phrases using NLP-powered pattern recognition
   * Uses natural and compromise for semantic analysis and phrase consolidation
   */
  private compressRepetitivePhrases(text: string): {
    text: string;
    compressed: boolean;
  } {
    try {
      // Use compromise for linguistic analysis
      const doc = nlp(text);

      // Extract sentences
      const sentences = doc.sentences().out('array');

      if (sentences.length < 3) {
        return { text, compressed: false };
      }

      let compressed = text;
      let hasCompression = false;

      // 1. Find and consolidate similar sentences using NLP
      const similarGroups = this.findSimilarSentencesNLP(sentences);

      for (const group of similarGroups) {
        if (group.length > 1) {
          const consolidated = this.consolidateSimilarSentencesNLP(group);
          // Replace all occurrences with the consolidated version
          for (let i = 1; i < group.length; i++) {
            compressed = compressed.replace(group[i], '');
            hasCompression = true;
          }
          compressed = compressed.replace(group[0], consolidated);
        }
      }

      // 2. Remove redundant phrases using semantic similarity
      const phrases = doc.clauses().out('array');
      const redundantPhrases = this.findRedundantPhrasesNLP(phrases);

      for (const phrase of redundantPhrases) {
        // Keep only first occurrence
        const firstIndex = compressed.indexOf(phrase);
        if (firstIndex !== -1) {
          compressed =
            compressed.substring(0, firstIndex + phrase.length) +
            compressed
              .substring(firstIndex + phrase.length)
              .replace(new RegExp(this.escapeRegex(phrase), 'g'), '');
          hasCompression = true;
        }
      }

      // 3. Consolidate repetitive instructions
      compressed = this.consolidateInstructionsNLP(compressed);

      // 4. Remove filler words and redundant modifiers
      compressed = this.removeFillerWordsNLP(compressed);
      if (compressed !== text) {
        hasCompression = true;
      }

      // Clean up extra whitespace
      compressed = compressed.replace(/\s+/g, ' ').trim();

      return { text: compressed, compressed: hasCompression };
    } catch (error) {
      this.logger.warn('NLP compression failed, using fallback', error);
      return this.compressRepetitivePhrasesHeuristic(text);
    }
  }

  /**
   * Find similar sentences using NLP semantic analysis
   */
  private findSimilarSentencesNLP(sentences: string[]): string[][] {
    const groups: string[][] = [];
    const used = new Set<number>();

    for (let i = 0; i < sentences.length; i++) {
      if (used.has(i)) continue;

      const group = [sentences[i]];
      const doc1 = nlp(sentences[i]);

      for (let j = i + 1; j < sentences.length; j++) {
        if (used.has(j)) continue;

        const doc2 = nlp(sentences[j]);

        // Check semantic similarity
        const similarity = this.calculateSemanticSimilarity(doc1, doc2);

        if (similarity > 0.7) {
          group.push(sentences[j]);
          used.add(j);
        }
      }

      if (group.length > 1) {
        groups.push(group);
        used.add(i);
      }
    }

    return groups;
  }

  /**
   * Calculate semantic similarity between two sentences
   */
  private calculateSemanticSimilarity(doc1: any, doc2: any): number {
    // Extract key terms
    const terms1 = new Set(
      doc1
        .terms()
        .out('array')
        .map((t: string) => t.toLowerCase()),
    );
    const terms2 = new Set(
      doc2
        .terms()
        .out('array')
        .map((t: string) => t.toLowerCase()),
    );

    // Calculate Jaccard similarity
    const intersection = new Set([...terms1].filter((x) => terms2.has(x)));
    const union = new Set([...terms1, ...terms2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Consolidate similar sentences using NLP
   */
  private consolidateSimilarSentencesNLP(sentences: string[]): string {
    if (sentences.length === 0) return '';
    if (sentences.length === 1) return sentences[0];

    // Parse all sentences
    const docs = sentences.map((s) => nlp(s));

    // Extract common subject and verb (compromise plugins: subjects/objects)
    const subjects = docs
      .map((d) => (d as any).subjects?.().out('text') ?? '')
      .filter((s) => s);
    const verbs = docs.map((d) => d.verbs().out('text')).filter((v) => v);
    const objects = docs
      .map((d) => (d as any).objects?.().out('text') ?? '')
      .filter((o) => o);

    // Find most common elements
    const commonSubject = this.getMostCommon(subjects);
    const commonVerb = this.getMostCommon(verbs);

    // Collect unique objects/complements
    const uniqueObjects = [...new Set(objects)];

    // Construct consolidated sentence
    if (commonSubject && commonVerb && uniqueObjects.length > 0) {
      return `${commonSubject} ${commonVerb} ${uniqueObjects.join(' and ')}`;
    }

    // Fallback: return the shortest sentence (likely most concise)
    return sentences.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest,
    );
  }

  /**
   * Find redundant phrases using NLP
   */
  private findRedundantPhrasesNLP(phrases: string[]): string[] {
    const redundant: string[] = [];
    const seenPhrases = new Map<string, number>();

    for (const phrase of phrases) {
      const doc = nlp(phrase);
      const normalized = doc.normalize().out('text').toLowerCase();

      if (seenPhrases.has(normalized)) {
        seenPhrases.set(normalized, seenPhrases.get(normalized)! + 1);
        if (seenPhrases.get(normalized)! > 1) {
          redundant.push(phrase);
        }
      } else {
        seenPhrases.set(normalized, 1);
      }
    }

    return redundant;
  }

  /**
   * Consolidate repetitive instructions using NLP
   */
  private consolidateInstructionsNLP(text: string): string {
    const doc = nlp(text);

    // Find imperative sentences (instructions)
    const imperatives = doc.sentences().match('#Imperative').out('array');

    if (imperatives.length < 2) return text;

    // Group similar instructions
    const groups = this.groupSimilarInstructions(imperatives);

    let result = text;
    for (const group of groups) {
      if (group.length > 1) {
        const consolidated = this.mergeInstructions(group);
        // Replace all with consolidated version
        for (const instruction of group) {
          result = result.replace(instruction, '');
        }
        result = consolidated + ' ' + result;
      }
    }

    return result.trim();
  }

  /**
   * Group similar instructions
   */
  private groupSimilarInstructions(instructions: string[]): string[][] {
    const groups: string[][] = [];
    const used = new Set<number>();

    for (let i = 0; i < instructions.length; i++) {
      if (used.has(i)) continue;

      const group = [instructions[i]];
      const doc1 = nlp(instructions[i]);
      const verb1 = doc1.verbs().out('text');

      for (let j = i + 1; j < instructions.length; j++) {
        if (used.has(j)) continue;

        const doc2 = nlp(instructions[j]);
        const verb2 = doc2.verbs().out('text');

        // Group if they have the same verb
        if (verb1 && verb2 && verb1.toLowerCase() === verb2.toLowerCase()) {
          group.push(instructions[j]);
          used.add(j);
        }
      }

      if (group.length > 1) {
        groups.push(group);
        used.add(i);
      }
    }

    return groups;
  }

  /**
   * Merge multiple instructions into one
   */
  private mergeInstructions(instructions: string[]): string {
    if (instructions.length === 0) return '';
    if (instructions.length === 1) return instructions[0];

    const docs = instructions.map((i) => nlp(i));
    const verb = docs[0].verbs().out('text');
    const objects = docs
      .map((d) => (d as any).objects?.().out('text') ?? '')
      .filter((o) => o);

    if (verb && objects.length > 0) {
      return `${verb} ${[...new Set(objects)].join(', ')}`;
    }

    return instructions[0];
  }

  /**
   * Remove filler words and redundant modifiers using NLP
   */
  private removeFillerWordsNLP(text: string): string {
    const doc = nlp(text);

    // Remove adverbs that don't add meaning
    const unnecessaryAdverbs = [
      'very',
      'really',
      'quite',
      'extremely',
      'totally',
      'absolutely',
      'completely',
    ];
    const pattern = unnecessaryAdverbs.join('|');
    doc.adverbs().match(pattern).delete(pattern);
    let result = doc.out('text');

    // Remove redundant phrases
    const redundantPhrases = [
      'it is important to',
      'you should',
      'please',
      'kindly',
      'i want you to',
      'can you please',
      'could you',
      'would you mind',
    ];

    for (const phrase of redundantPhrases) {
      result = result.replace(
        new RegExp(`\\b${this.escapeRegex(phrase)}\\b`, 'gi'),
        '',
      );
    }

    return result.replace(/\s+/g, ' ').trim();
  }

  /**
   * Get most common element from array
   */
  private getMostCommon(arr: string[]): string {
    if (arr.length === 0) return '';

    const frequency = arr.reduce(
      (acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return Object.keys(frequency).reduce((a, b) =>
      frequency[a] > frequency[b] ? a : b,
    );
  }

  /**
   * Heuristic fallback for compression (when NLP fails)
   */
  private compressRepetitivePhrasesHeuristic(text: string): {
    text: string;
    compressed: boolean;
  } {
    // Enhanced repetition detection with multiple analysis layers
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim());

    if (sentences.length < 3) {
      return { text, compressed: false };
    }

    // Multi-level repetition detection
    const repetitions = this.findRepetitions(sentences);

    if (repetitions.length === 0) {
      return { text, compressed: false };
    }

    // Apply compression based on detected repetitions
    let compressed = text;
    let hasCompression = false;

    for (const repetition of repetitions) {
      if (repetition.type === 'exact_sentence') {
        // Remove exact duplicate sentences, keep first occurrence
        const firstOccurrence = repetition.matches[0];
        repetition.matches.slice(1).forEach((match) => {
          compressed = compressed.replace(match, '');
          hasCompression = true;
        });
      } else if (repetition.type === 'similar_starter') {
        // Consolidate sentences with similar starters
        const consolidated = this.consolidateSimilarStarters(
          repetition.matches,
        );
        if (consolidated !== repetition.matches.join(' ')) {
          // Replace the original matches with consolidated version
          const originalText = repetition.matches.join(' ');
          compressed = compressed.replace(originalText, consolidated);
          hasCompression = true;
        }
      } else if (repetition.type === 'keyword_repetition') {
        // Remove redundant keywords while preserving meaning
        const deduplicated = this.deduplicateKeywords(repetition.matches);
        if (deduplicated !== repetition.matches.join(' ')) {
          const originalText = repetition.matches.join(' ');
          compressed = compressed.replace(originalText, deduplicated);
          hasCompression = true;
        }
      }
    }

    // Clean up extra whitespace
    compressed = compressed.replace(/\s+/g, ' ').trim();

    return { text: compressed, compressed: hasCompression };
  }

  /**
   * Find various types of repetitions in text
   */
  private findRepetitions(sentences: string[]): Array<{
    type: 'exact_sentence' | 'similar_starter' | 'keyword_repetition';
    matches: string[];
    confidence: number;
  }> {
    const repetitions: Array<{
      type: 'exact_sentence' | 'similar_starter' | 'keyword_repetition';
      matches: string[];
      confidence: number;
    }> = [];

    // 1. Find exact sentence duplicates
    const sentenceCounts = sentences.reduce(
      (acc, sentence) => {
        const normalized = sentence.trim().toLowerCase();
        acc[normalized] = acc[normalized] || { count: 0, originals: [] };
        acc[normalized].count++;
        acc[normalized].originals.push(sentence.trim());
        return acc;
      },
      {} as Record<string, { count: number; originals: string[] }>,
    );

    Object.values(sentenceCounts).forEach(({ count, originals }) => {
      if (count > 1) {
        repetitions.push({
          type: 'exact_sentence',
          matches: originals,
          confidence: 1.0,
        });
      }
    });

    // 2. Find sentences with similar starters (first 2-4 words)
    const starterGroups = sentences.reduce(
      (acc, sentence) => {
        const words = sentence.trim().split(/\s+/);
        const starter = words
          .slice(0, Math.min(3, words.length))
          .join(' ')
          .toLowerCase();
        if (starter.length > 3) {
          // Only consider meaningful starters
          acc[starter] = acc[starter] || [];
          acc[starter].push(sentence.trim());
        }
        return acc;
      },
      {} as Record<string, string[]>,
    );

    Object.values(starterGroups).forEach((group) => {
      if (group.length > 1) {
        repetitions.push({
          type: 'similar_starter',
          matches: group,
          confidence: 0.8,
        });
      }
    });

    // 3. Find keyword repetitions within sentences
    const keywordPatterns = [
      /\b(please|kindly|you should|you must|it is important|remember to)\b/gi,
      /\b(make sure|ensure|verify|confirm|check)\b/gi,
      /\b(also|additionally|furthermore|moreover)\b/gi,
    ];

    sentences.forEach((sentence) => {
      keywordPatterns.forEach((pattern) => {
        const matches = sentence.match(pattern);
        if (matches && matches.length > 1) {
          repetitions.push({
            type: 'keyword_repetition',
            matches: [sentence], // Single sentence with internal repetition
            confidence: 0.6,
          });
        }
      });
    });

    return repetitions;
  }

  /**
   * Consolidate sentences with similar starters
   */
  private consolidateSimilarStarters(sentences: string[]): string {
    if (sentences.length < 2) return sentences.join(' ');

    // Find common starter
    const firstWords = sentences.map((s) =>
      s.split(/\s+/).slice(0, 2).join(' ').toLowerCase(),
    );
    const commonStarter = firstWords[0];

    if (
      firstWords.every((words) => words.startsWith(commonStarter.split(' ')[0]))
    ) {
      // Combine into single instruction with common starter
      const uniqueParts = sentences
        .map((s) =>
          s.replace(
            new RegExp(
              `^${this.escapeRegex(commonStarter.split(' ').slice(0, 1).join(' '))}\\s+`,
              'i',
            ),
            '',
          ),
        )
        .filter((part, index, arr) => arr.indexOf(part) === index);

      return `${commonStarter} ${uniqueParts.join(' and ')}`;
    }

    return sentences.join(' ');
  }

  /**
   * Remove redundant keywords while preserving meaning
   */
  private deduplicateKeywords(sentences: string[]): string {
    const redundantWords = [
      'please',
      'kindly',
      'also',
      'additionally',
      'furthermore',
      'moreover',
      'make sure',
      'ensure',
      'verify',
      'confirm',
      'check',
    ];

    let combined = sentences.join(' ');

    redundantWords.forEach((word) => {
      const pattern = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'gi');
      const matches = combined.match(pattern);
      if (matches && matches.length > 1) {
        // Keep only the first occurrence
        combined = combined.replace(pattern, (match, offset) => {
          return offset === combined.indexOf(match) ? match : '';
        });
      }
    });

    return combined.replace(/\s+/g, ' ').trim();
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Perform semantic compression using NLP
   * Uses natural language processing to maintain meaning while reducing tokens
   */
  private performSemanticCompression(text: string): {
    text: string;
    qualityImpact: number;
  } {
    try {
      const doc = nlp(text);
      let compressed = text;
      let qualityImpact = 1.0;

      // 1. Remove redundant adjectives and adverbs
      const unnecessaryModifiers = doc
        .adverbs()
        .concat(doc.adjectives())
        .match(
          '(very|really|quite|extremely|totally|absolutely|completely|highly|fairly|rather)',
        )
        .out('array');

      if (unnecessaryModifiers.length > 0) {
        const modifierPattern =
          '(very|really|quite|extremely|totally|absolutely|completely)';
        doc.adverbs().match(modifierPattern).delete(modifierPattern);
        compressed = doc.out('text');
        qualityImpact *= 0.98;
      }

      // 2. Simplify passive voice to active voice (toActive from compromise plugin if available)
      const passiveVoice = nlp(compressed).sentences().match('#Passive');
      if (passiveVoice.found && (passiveVoice as any).toActive) {
        compressed = (passiveVoice as any).toActive().out('text');
        qualityImpact *= 0.95;
      }

      // 3. Remove unnecessary prepositional phrases
      const unnecessaryPhrases = [
        'it is important to note that',
        'it should be noted that',
        'please be aware that',
        'it is worth mentioning that',
        'in order to',
        'for the purpose of',
        'due to the fact that',
        'in the event that',
        'at this point in time',
        'in a timely manner',
      ];

      for (const phrase of unnecessaryPhrases) {
        const regex = new RegExp(`\\b${this.escapeRegex(phrase)}\\b`, 'gi');
        if (regex.test(compressed)) {
          compressed = compressed.replace(regex, '');
          qualityImpact *= 0.97;
        }
      }

      // 4. Condense verbose constructions
      const replacements = [
        { from: /\bmake use of\b/gi, to: 'use' },
        { from: /\bin order to\b/gi, to: 'to' },
        { from: /\bdue to the fact that\b/gi, to: 'because' },
        { from: /\bin the event that\b/gi, to: 'if' },
        { from: /\bat this point in time\b/gi, to: 'now' },
        { from: /\bfor the purpose of\b/gi, to: 'to' },
        { from: /\bhas the ability to\b/gi, to: 'can' },
        { from: /\bis able to\b/gi, to: 'can' },
        { from: /\bin a\s+\w+\s+manner\b/gi, to: '' },
      ];

      for (const { from, to } of replacements) {
        compressed = compressed.replace(from, to);
      }

      // 5. Remove politeness markers (context-dependent)
      const politenessMarkers = [
        'please',
        'kindly',
        "if you don't mind",
        'if possible',
        'i would appreciate',
        'thank you',
      ];

      for (const marker of politenessMarkers) {
        const regex = new RegExp(`\\b${this.escapeRegex(marker)}\\b`, 'gi');
        compressed = compressed.replace(regex, '');
      }

      // Clean up extra whitespace and punctuation
      compressed = compressed
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/([,.!?;:])\s*\1+/g, '$1')
        .trim();

      // Ensure quality impact doesn't drop too low
      qualityImpact = Math.max(0.85, qualityImpact);

      return { text: compressed, qualityImpact };
    } catch (error) {
      this.logger.warn(
        'NLP semantic compression failed, using fallback',
        error,
      );
      return this.performSemanticCompressionHeuristic(text);
    }
  }

  /**
   * Heuristic semantic compression fallback
   */
  private performSemanticCompressionHeuristic(text: string): {
    text: string;
    qualityImpact: number;
  } {
    let compressed = text;
    const qualityImpact = 0.9;

    // Remove redundant adjectives
    compressed = compressed.replace(
      /\b(very|really|quite|extremely|totally)\s+(\w+)\b/gi,
      '$2',
    );

    // Simplify complex sentences (basic)
    compressed = compressed.replace(
      /\b(it is important to|you should|please)\b/gi,
      '',
    );

    // Remove unnecessary phrases
    const unnecessaryPhrases = [
      'i want you to',
      'can you please',
      'could you',
      'would you mind',
      'if possible',
    ];

    unnecessaryPhrases.forEach((phrase) => {
      compressed = compressed.replace(
        new RegExp(this.escapeRegex(phrase), 'gi'),
        '',
      );
    });

    return { text: compressed.trim(), qualityImpact };
  }

  /**
   * Trim messages by keeping most recent ones
   */
  private trimByRecency(
    messages: ConversationContext['messages'],
    maxTokens: number,
  ): ConversationContext['messages'] {
    const trimmed: ConversationContext['messages'] = [];
    let currentTokens = 0;

    // Always keep system messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    trimmed.push(...systemMessages);
    currentTokens += systemMessages.reduce(
      (sum, m) => sum + (m.tokenCount || Math.ceil(m.content.length / 4)),
      0,
    );

    // Add most recent messages
    for (
      let i = messages.length - 1;
      i >= 0 && currentTokens < maxTokens;
      i--
    ) {
      const message = messages[i];
      if (message.role === 'system') continue; // Already added

      const messageTokens =
        message.tokenCount || Math.ceil(message.content.length / 4);
      if (currentTokens + messageTokens <= maxTokens) {
        trimmed.unshift(message); // Add to beginning to maintain order
        currentTokens += messageTokens;
      }
    }

    return trimmed;
  }

  /**
   * Trim messages by importance (simplified heuristic)
   */
  private trimByImportance(
    messages: ConversationContext['messages'],
    maxTokens: number,
  ): ConversationContext['messages'] {
    const scored = messages.map((msg, index) => ({
      message: msg,
      score: this.calculateMessageImportance(msg, index, messages.length),
      tokens: msg.tokenCount || Math.ceil(msg.content.length / 4),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const selected: ConversationContext['messages'] = [];
    let currentTokens = 0;

    for (const item of scored) {
      if (currentTokens + item.tokens <= maxTokens) {
        selected.push(item.message);
        currentTokens += item.tokens;
      }
    }

    // Sort back to original order
    return selected.sort((a, b) => {
      const aIndex = messages.indexOf(a);
      const bIndex = messages.indexOf(b);
      return aIndex - bIndex;
    });
  }

  /**
   * Trim by summarization - implements extractive summarization
   * to preserve key information while reducing token count
   */
  private trimBySummarization(
    messages: ConversationContext['messages'],
    maxTokens: number,
  ): ConversationContext['messages'] {
    if (messages.length <= 1) return messages;

    try {
      // Calculate current token usage
      const currentTokens = this.estimateTokenUsage(messages);

      if (currentTokens <= maxTokens) {
        return messages; // No trimming needed
      }

      // Sort messages by importance and recency
      const scoredMessages = messages.map((message, index) => ({
        message,
        index,
        score:
          this.calculateMessageImportance(message, index, messages.length) *
          (1 + index / messages.length), // Favor recent messages
        tokens: this.estimateMessageTokens(message),
      }));

      // Sort by score (descending) to prioritize important messages
      scoredMessages.sort((a, b) => b.score - a.score);

      // Select messages until we hit the token limit
      const selectedMessages: ConversationContext['messages'] = [];
      let totalTokens = 0;

      for (const scored of scoredMessages) {
        if (totalTokens + scored.tokens <= maxTokens) {
          selectedMessages.push(scored.message);
          totalTokens += scored.tokens;
        } else {
          // Try to create a summary of remaining messages
          const remainingMessages = scoredMessages
            .slice(selectedMessages.length)
            .map((s) => s.message);

          if (remainingMessages.length > 0) {
            const summaryMessage = this.createSummaryMessage(remainingMessages);
            if (
              summaryMessage &&
              this.estimateMessageTokens(summaryMessage) <=
                maxTokens - totalTokens
            ) {
              selectedMessages.push(summaryMessage);
            }
          }
          break;
        }
      }

      // Restore chronological order
      return selectedMessages.sort((a, b) => {
        const aTime = new Date(a.timestamp || 0).getTime();
        const bTime = new Date(b.timestamp || 0).getTime();
        return aTime - bTime;
      });
    } catch (error) {
      this.logger.warn(
        'Summarization failed, falling back to recency-based trimming',
        error,
      );
      return this.trimByRecency(messages, maxTokens);
    }
  }

  /**
   * Estimate token usage for a list of messages
   */
  private estimateTokenUsage(
    messages: ConversationContext['messages'],
  ): number {
    return messages.reduce(
      (total, message) => total + this.estimateMessageTokens(message),
      0,
    );
  }

  /**
   * Estimate token count for a single message
   */
  private estimateMessageTokens(
    message: ConversationContext['messages'][0],
  ): number {
    const text = `${message.role}: ${message.content}`;
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Create a summary message from multiple messages
   */
  private createSummaryMessage(
    messages: ConversationContext['messages'],
  ): ConversationContext['messages'][0] | null {
    if (messages.length === 0) return null;

    // Extract key information from messages
    const roles = [...new Set(messages.map((m) => m.role))];
    const totalLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    const avgLength = totalLength / messages.length;

    // Create a concise summary
    const summary = `${messages.length} ${roles.join('/')} messages summarized (${Math.round(avgLength)} chars avg)`;

    return {
      role: 'system',
      content: `[Summary: ${summary}]`,
      timestamp: new Date(),
      metadata: {
        summarizedMessages: messages.length,
        originalRoles: roles,
        summaryType: 'extractive',
      },
    };
  }

  /**
   * Calculate message importance score
   */
  private calculateMessageImportance(
    message: ConversationContext['messages'][0],
    index: number,
    totalMessages: number,
  ): number {
    let score = 0;

    // Recency bonus
    const recencyScore = (totalMessages - index) / totalMessages;
    score += recencyScore * 0.4;

    // Length bonus (longer messages tend to be more important)
    const lengthScore = Math.min(1, message.content.length / 500);
    score += lengthScore * 0.3;

    // Role bonus
    const roleScore =
      message.role === 'system' ? 1 : message.role === 'user' ? 0.8 : 0.6;
    score += roleScore * 0.3;

    return score;
  }

  /**
   * Calculate repetition score
   */
  private calculateRepetitionScore(text: string): number {
    const words = text.toLowerCase().split(/\s+/);
    const wordCounts = words.reduce(
      (acc, word) => {
        if (word.length > 3) {
          // Only count meaningful words
          acc[word] = (acc[word] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    const repeatedWords = Object.values(wordCounts).filter(
      (count) => count > 2,
    ).length;
    return Math.min(1, repeatedWords / 10);
  }

  /**
   * Calculate verbosity score
   */
  private calculateVerbosityScore(text: string): number {
    const words = text.split(/\s+/).length;
    const chars = text.length;
    const avgWordLength = chars / words;

    // Verbose text tends to have longer words and more words per sentence
    const sentences = text.split(/[.!?]+/).length;
    const wordsPerSentence = words / sentences;

    return Math.min(1, (avgWordLength - 4) / 5 + (wordsPerSentence - 15) / 10);
  }

  /**
   * Calculate prompt complexity
   */
  private calculatePromptComplexity(prompt: string): number {
    // Simple heuristic based on length, vocabulary, and structure
    const lengthScore = Math.min(1, prompt.length / 2000);
    const uniqueWords = new Set(prompt.toLowerCase().split(/\s+/)).size;
    const totalWords = prompt.split(/\s+/).length;
    const vocabularyScore = Math.min(1, uniqueWords / totalWords);

    // Check for complex structures
    const structureIndicators = [
      /if.*then/i,
      /for.*in/i,
      /while.*do/i,
      /function|class|method/i,
      /algorithm|process|system/i,
    ];

    const structureScore =
      structureIndicators.filter((pattern) => pattern.test(prompt)).length /
      structureIndicators.length;

    return lengthScore * 0.4 + vocabularyScore * 0.3 + structureScore * 0.3;
  }
}
