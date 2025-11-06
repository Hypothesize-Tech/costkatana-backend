/**
 * Dynamic Primitive Learning System
 * Learns new primitives from user interactions and expands vocabulary
 */

import { CortexQuery, CortexResponse } from '../types';
import { CorePrimitives, PrimitiveIds, PrimitiveNames } from '../core/primitives';
import { loggingService } from '../../services/logging.service';
import { cacheService } from '../../services/cache.service';
import { BedrockModelFormatter } from '../utils/bedrockModelFormatter';
import { RetryWithBackoff } from '../../utils/retryWithBackoff';
import { encodeToTOON, decodeFromTOON } from '../../utils/toon.utils';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

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

export class PrimitiveLearner {
  private learnedPrimitives = new Map<string, LearnedPrimitive>();
  private nextPrimitiveId = 10000; // Start from 10000 for learned primitives
  private bedrockClient: BedrockRuntimeClient;
  private learningRate: number;
  private minConfidenceThreshold: number;
  private maxVocabularySize: number;
  
  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    this.learningRate = parseFloat(process.env.CORTEX_PRIMITIVE_LEARNING_RATE || '0.1');
    this.minConfidenceThreshold = 0.7;
    this.maxVocabularySize = parseInt(process.env.CORTEX_MAX_PRIMITIVE_COUNT || '100000');
    
    // Load existing learned primitives from cache
    this.loadLearnedPrimitives();
  }
  
  /**
   * Analyze interaction for new primitives
   */
  public async analyzeInteraction(
    input: string,
    _query: CortexQuery,
    response: CortexResponse
  ): Promise<LearnedPrimitive[]> {
    if (!process.env.CORTEX_DYNAMIC_PRIMITIVE_LEARNING || 
        process.env.CORTEX_DYNAMIC_PRIMITIVE_LEARNING !== 'true') {
      return [];
    }
    
    const newPrimitives: LearnedPrimitive[] = [];
    
    try {
      // Extract unknown terms from input
      const unknownTerms = await this.extractUnknownTerms(input, _query);
      
      if (unknownTerms.length === 0) {
        return [];
      }
      
      // Analyze each unknown term
      for (const term of unknownTerms) {
        if (Math.random() > this.learningRate) {
          continue; // Skip based on learning rate
        }
        
        const primitive = await this.learnPrimitive(term, input, _query, response);
        
        if (primitive && primitive.confidence >= this.minConfidenceThreshold) {
          this.registerPrimitive(primitive);
          newPrimitives.push(primitive);
        }
      }
      
      // Update metrics
      if (newPrimitives.length > 0) {
        await this.updateLearningMetrics(newPrimitives);
      }
      
    } catch (error) {
      loggingService.warn('Failed to analyze interaction for learning', { error });
    }
    
    return newPrimitives;
  }
  
  /**
   * Extract unknown terms from input
   */
  private async extractUnknownTerms(
    input: string,
    _query: CortexQuery
  ): Promise<string[]> {
    const unknownTerms: string[] = [];
    
    // Tokenize input
    const words = input.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    // Check each word against existing primitives
    for (const word of words) {
      if (!this.isKnownPrimitive(word) && !this.isCommonWord(word)) {
        unknownTerms.push(word);
      }
    }
    
    return unknownTerms;
  }
  
  /**
   * Check if a word is a known primitive
   */
  private isKnownPrimitive(word: string): boolean {
    // Check core primitives
    const corePrimitives = Object.values(CorePrimitives).flat();
    if (corePrimitives.some(p => p.toLowerCase().includes(word))) {
      return true;
    }
    
    // Check learned primitives
    return this.learnedPrimitives.has(word);
  }
  
  /**
   * Check if word is common (stopword)
   */
  private isCommonWord(word: string): boolean {
    const stopwords = [
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'can', 'shall', 'if',
      'then', 'else', 'when', 'where', 'why', 'how', 'what', 'which', 'who'
    ];
    
    return stopwords.includes(word.toLowerCase());
  }
  
  /**
   * Learn a new primitive using LLM analysis
   */
  private async learnPrimitive(
    term: string,
    context: string,
    query: CortexQuery,
    response: CortexResponse
  ): Promise<LearnedPrimitive | null> {
    try {
      const queryTOON = encodeToTOON(query);
      const responseTOON = encodeToTOON(response);
      const queryTOONString = await queryTOON;
      const responseTOONString = await responseTOON;
      
      const analysisPrompt = `Analyze this term for potential inclusion as a Cortex primitive:

TERM: "${term}"
CONTEXT: "${context}"
QUERY (TOON format):
${queryTOONString}
RESPONSE (TOON format):
${responseTOONString}

Determine:
1. Is this a meaningful semantic primitive?
2. What type: action, concept, property, or modifier?
3. Definition in one sentence
4. Confidence score (0.0-1.0)

Response format (TOON ONLY):
result[1]{isPrimitive,type,definition,confidence}:
  true,action,definition_text,0.9
examples[2]{example}:
  example_usage_1
  example_usage_2`;
      
      const modelId = process.env.CORTEX_LEARNING_MODEL || 'amazon.nova-lite-v1:0';
      
      const request = BedrockModelFormatter.formatRequestBody({
        modelId,
        messages: [
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        systemPrompt: 'You are a semantic analyzer for the Cortex meta-language. Identify meaningful primitives.',
        maxTokens: 500,
        temperature: 0.3
      });
      
      const analysisResponse = await RetryWithBackoff.execute(
        () => this.bedrockClient.send(
          new InvokeModelCommand({
            modelId,
            body: JSON.stringify(request),
            contentType: 'application/json',
            accept: 'application/json'
          })
        ),
        { maxRetries: 2, baseDelay: 500 }
      );
      
      if (!analysisResponse.success || !analysisResponse.result) {
        return null;
      }
      
      const responseBody = JSON.parse(new TextDecoder().decode(analysisResponse.result.body));
      const analysisText = BedrockModelFormatter.parseResponseBody(modelId, responseBody);
      
      // Parse analysis result (try TOON first, then fallback to JSON)
      let analysis: any;
      try {
        // Try TOON decode
        analysis = await decodeFromTOON(analysisText);
      } catch {
        // Fallback to JSON parsing
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return null;
        }
        analysis = JSON.parse(jsonMatch[0]);
      }
      
      if (!analysis.isPrimitive || analysis.confidence < this.minConfidenceThreshold) {
        return null;
      }
      
      // Create learned primitive
      const primitive: LearnedPrimitive = {
        id: this.nextPrimitiveId++,
        name: term,
        type: analysis.type,
        definition: analysis.definition,
        examples: analysis.examples || [context],
        confidence: analysis.confidence,
        frequency: 1,
        createdAt: new Date(),
        lastUsed: new Date()
      };
      
      return primitive;
      
    } catch (error) {
      loggingService.warn('Failed to learn primitive', { term, error });
      return null;
    }
  }
  
  /**
   * Register a new learned primitive
   */
  private registerPrimitive(primitive: LearnedPrimitive): void {
    // Check vocabulary size limit
    if (this.learnedPrimitives.size >= this.maxVocabularySize) {
      // Remove least used primitive
      this.pruneLeastUsedPrimitive();
    }
    
    this.learnedPrimitives.set(primitive.name, primitive);
    
    // Update PrimitiveIds and PrimitiveNames dynamically
    const primitiveKey = `${primitive.type}_${primitive.name}`;
    (PrimitiveIds as any)[primitiveKey] = primitive.id;
    (PrimitiveNames as any)[primitive.id] = primitiveKey;
    
    // Save to cache
    this.saveLearnedPrimitives();
    
    loggingService.info('Learned new primitive', {
      name: primitive.name,
      type: primitive.type,
      id: primitive.id,
      confidence: primitive.confidence
    });
  }
  
  /**
   * Prune least used primitive
   */
  private pruneLeastUsedPrimitive(): void {
    let leastUsed: LearnedPrimitive | null = null;
    let minFrequency = Infinity;
    
    this.learnedPrimitives.forEach(primitive => {
      if (primitive.frequency < minFrequency) {
        minFrequency = primitive.frequency;
        leastUsed = primitive;
      }
    });
    
    if (leastUsed !== null) {
      const toRemove = leastUsed as LearnedPrimitive;
      this.learnedPrimitives.delete(toRemove.name);
      
      // Remove from PrimitiveIds and PrimitiveNames
      const primitiveKey = `${toRemove.type}_${toRemove.name}`;
      delete (PrimitiveIds as any)[primitiveKey];
      delete (PrimitiveNames as any)[toRemove.id];
    }
  }
  
  /**
   * Update learning metrics
   */
  private async updateLearningMetrics(_newPrimitives: LearnedPrimitive[]): Promise<void> {
    const metrics: LearningMetrics = {
      totalPrimitives: Object.keys(PrimitiveIds).length,
      learnedPrimitives: this.learnedPrimitives.size,
      learningRate: this.learningRate,
      vocabularyGrowth: (this.learnedPrimitives.size / Object.keys(CorePrimitives).flat().length)
    };
    
    await cacheService.set(
      'cortex:learning:metrics',
      JSON.stringify(metrics),
      3600
    );
    
    loggingService.info('Learning metrics updated', metrics);
  }
  
  /**
   * Load learned primitives from cache
   */
  private async loadLearnedPrimitives(): Promise<void> {
    try {
      const cached = await cacheService.get('cortex:learned:primitives');
      
      if (cached) {
        const primitives = JSON.parse(cached) as LearnedPrimitive[];
        
        primitives.forEach(primitive => {
          this.learnedPrimitives.set(primitive.name, primitive);
          
          // Restore to PrimitiveIds and PrimitiveNames
          const primitiveKey = `${primitive.type}_${primitive.name}`;
          (PrimitiveIds as any)[primitiveKey] = primitive.id;
          (PrimitiveNames as any)[primitive.id] = primitiveKey;
          
          // Update next ID
          if (primitive.id >= this.nextPrimitiveId) {
            this.nextPrimitiveId = primitive.id + 1;
          }
        });
        
        loggingService.info('Loaded learned primitives', {
          count: this.learnedPrimitives.size
        });
      }
    } catch (error) {
      loggingService.warn('Failed to load learned primitives', { error });
    }
  }
  
  /**
   * Save learned primitives to cache
   */
  private async saveLearnedPrimitives(): Promise<void> {
    try {
      const primitives = Array.from(this.learnedPrimitives.values());
      
      await cacheService.set(
        'cortex:learned:primitives',
        JSON.stringify(primitives),
        86400 // 24 hours
      );
    } catch (error) {
      loggingService.warn('Failed to save learned primitives', { error });
    }
  }
  
  /**
   * Get vocabulary expansion suggestions
   */
  public async suggestVocabularyExpansion(
    domain: string
  ): Promise<LearnedPrimitive[]> {
    const suggestions: LearnedPrimitive[] = [];
    
    try {
      const suggestionPrompt = `Suggest domain-specific primitives for Cortex in the "${domain}" domain.

Provide 5 essential primitives that would be valuable for this domain.

Format:
{
  "primitives": [
    {
      "name": "primitive_name",
      "type": "action|concept|property|modifier",
      "definition": "one sentence definition",
      "examples": ["example 1", "example 2"]
    }
  ]
}`;
      
      const modelId = process.env.CORTEX_LEARNING_MODEL || 'amazon.nova-lite-v1:0';
      
      const request = BedrockModelFormatter.formatRequestBody({
        modelId,
        messages: [
          {
            role: 'user',
            content: suggestionPrompt
          }
        ],
        systemPrompt: 'You are a vocabulary designer for the Cortex meta-language.',
        maxTokens: 1000,
        temperature: 0.7
      });
      
      const suggestionResponse = await RetryWithBackoff.execute(
        () => this.bedrockClient.send(
          new InvokeModelCommand({
            modelId,
            body: JSON.stringify(request),
            contentType: 'application/json',
            accept: 'application/json'
          })
        ),
        { maxRetries: 2, baseDelay: 500 }
      );
      
      if (!suggestionResponse.success || !suggestionResponse.result) {
        return suggestions;
      }
      
      const responseBody = JSON.parse(new TextDecoder().decode(suggestionResponse.result.body));
      const suggestionText = BedrockModelFormatter.parseResponseBody(modelId, responseBody);
      
      // Parse suggestions
      const jsonMatch = suggestionText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (parsed.primitives && Array.isArray(parsed.primitives)) {
          parsed.primitives.forEach((prim: any) => {
            const primitive: LearnedPrimitive = {
              id: this.nextPrimitiveId++,
              name: prim.name,
              type: prim.type,
              definition: prim.definition,
              examples: prim.examples || [],
              confidence: 0.8,
              frequency: 0,
              createdAt: new Date(),
              lastUsed: new Date()
            };
            
            suggestions.push(primitive);
          });
        }
      }
    } catch (error) {
      loggingService.warn('Failed to suggest vocabulary expansion', { domain, error });
    }
    
    return suggestions;
  }
  
  /**
   * Get learning metrics
   */
  public getMetrics(): LearningMetrics {
    return {
      totalPrimitives: Object.keys(PrimitiveIds).length,
      learnedPrimitives: this.learnedPrimitives.size,
      learningRate: this.learningRate,
      vocabularyGrowth: this.learnedPrimitives.size > 0 
        ? (this.learnedPrimitives.size / Object.keys(CorePrimitives).flat().length)
        : 0
    };
  }
}

// Export singleton instance
export const primitiveLearner = new PrimitiveLearner();
