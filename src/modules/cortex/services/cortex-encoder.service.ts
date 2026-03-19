/**
 * Cortex Encoder Service
 *
 * Encodes natural language text into Cortex semantic frames using AI models.
 * Handles the first stage of the Cortex processing pipeline.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CortexEncodingRequest,
  CortexEncodingResult,
  CortexFrame,
} from '../types/cortex.types';
import { AIRouterService } from './ai-router.service';
import { CortexVocabularyService } from './cortex-vocabulary.service';
import { CortexCacheService } from './cortex-cache.service';
import { getMaxTokensForModel } from '@/utils/model-tokens';
import { generateSecureId } from '../../../common/utils/secure-id.util';

@Injectable()
export class CortexEncoderService {
  private readonly logger = new Logger(CortexEncoderService.name);

  constructor(
    private readonly aiRouter: AIRouterService,
    private readonly vocabulary: CortexVocabularyService,
    private readonly cache: CortexCacheService,
  ) {}

  /**
   * Encode natural language text into Cortex frames
   */
  async encode(request: CortexEncodingRequest): Promise<CortexEncodingResult> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cacheKey = `encode_${this.generateCacheKey(request)}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.logger.debug('Encoding result found in cache');
        return cached as unknown as CortexEncodingResult;
      }

      // Generate encoding prompt
      const prompt = this.buildEncodingPrompt(request);

      // Invoke AI model
      const defaultEncoderModel = 'anthropic.claude-3-5-haiku-20241022-v1:0';
      const encoderModel =
        request.config?.encoding?.model ?? defaultEncoderModel;
      const aiResult = await this.aiRouter.invokeModel({
        model: encoderModel,
        prompt,
        parameters: {
          temperature: 0.1, // Low temperature for consistent encoding,
          maxTokens: getMaxTokensForModel(encoderModel),
        },
        metadata: {
          requestId: generateSecureId('encode'),
        },
      });

      // Parse AI response into Cortex frame
      const cortexFrame = this.parseEncodingResponse(aiResult.response);

      // Analyze the result
      const analysis = await this.analyzeEncoding(cortexFrame, request.text);

      // Validate the frame
      const validation = await this.validateEncoding(cortexFrame);

      const result: CortexEncodingResult = {
        cortexFrame,
        confidence: validation.confidence,
        processingTime: Date.now() - startTime,
        modelUsed: aiResult.model,
        originalText: request.text,
        analysis,
        error: validation.error,
      };

      // Cache the result
      this.cache.set(cacheKey, result as any, {
        ttl: 3600000, // 1 hour
        type: 'encoding',
        tags: ['encoding', request.language],
        semanticHash: this.generateSemanticHash(cortexFrame),
      });

      this.logger.log(
        `Encoded text to Cortex frame in ${result.processingTime}ms with confidence ${result.confidence.toFixed(2)}`,
      );
      return result;
    } catch (error) {
      this.logger.error('Encoding failed', error);
      throw new Error(`Cortex encoding failed: ${error.message}`);
    }
  }

  /**
   * Batch encode multiple texts
   */
  async encodeBatch(
    requests: CortexEncodingRequest[],
  ): Promise<CortexEncodingResult[]> {
    const promises = requests.map((request) => this.encode(request));
    return await Promise.all(promises);
  }

  /**
   * Build the encoding prompt for the AI model
   */
  private buildEncodingPrompt(request: CortexEncodingRequest): string {
    const vocabularyInfo = this.getVocabularyInfo();
    const examples = this.getEncodingExamples();

    return `
You are a Cortex Encoder. Your task is to convert natural language text into structured Cortex semantic frames.

CORTEX VOCABULARY:
${vocabularyInfo}

FRAME TYPES:
- query: Request for information or action
- answer: Response to a query
- event: Action or occurrence
- state: Static condition or properties
- entity: Person, place, object, or concept
- list: Container for items
- conditional: If/then/else logic
- loop: Iteration logic
- sequence: Sequential execution

FRAME ROLES:
- action: The action being performed
- agent: Entity performing the action
- object: Entity being acted upon
- target: Primary subject
- content: Main body of data
- properties: List of attributes
- reason: Cause or justification
- format: Desired output format

EXAMPLES:
${examples}

TASK:
Convert the following text into a Cortex frame. Return ONLY valid JSON with the frame structure.

TEXT TO ENCODE:
"${request.text}"

LANGUAGE: ${request.language}

OUTPUT FORMAT:
{
  "frameType": "query|answer|event|state|entity|list|conditional|loop|sequence",
  "action": "action_primitive",
  "target": "target_entity",
  "content": "main_content",
  ...additional roles as needed
}

IMPORTANT:
- Use exact primitive names from the vocabulary
- Be precise and unambiguous
- Include only relevant roles
- Use proper JSON syntax
`;
  }

  /**
   * Parse the AI model's response into a Cortex frame
   */
  private parseEncodingResponse(response: string): CortexFrame {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate frame structure
      if (!parsed.frameType) {
        throw new Error('Missing frameType in parsed response');
      }

      // Ensure it's a valid frame type
      const validFrameTypes = [
        'query',
        'answer',
        'event',
        'state',
        'entity',
        'list',
        'conditional',
        'loop',
        'sequence',
      ];
      if (!validFrameTypes.includes(parsed.frameType)) {
        throw new Error(`Invalid frameType: ${parsed.frameType}`);
      }

      return parsed as CortexFrame;
    } catch (error) {
      this.logger.error('Failed to parse encoding response', {
        response,
        error,
      });
      // Return a fallback frame
      return {
        frameType: 'query',
        action: 'action_query',
        target: 'unknown',
        content: response.substring(0, 200), // Truncate for safety
      };
    }
  }

  /**
   * Analyze the encoding result
   */
  private async analyzeEncoding(
    frame: CortexFrame,
    originalText: string,
  ): Promise<CortexEncodingResult['analysis']> {
    const language = this.detectLanguage(originalText);
    const sentiment = this.analyzeSentiment(originalText);
    const complexity = this.calculateComplexity(frame);

    return {
      language,
      sentiment,
      complexity,
    };
  }

  /**
   * Validate the encoded frame
   */
  private async validateEncoding(
    frame: CortexFrame,
  ): Promise<{ confidence: number; error?: string }> {
    try {
      // Basic validation
      if (!frame.frameType) {
        return { confidence: 0, error: 'Missing frame type' };
      }

      // Check for semantic consistency
      const semanticCheck = await this.vocabulary.parseSemanticFrame(
        JSON.stringify(frame),
      );
      const confidence = semanticCheck.confidence;

      return { confidence };
    } catch (error) {
      return { confidence: 0, error: error.message };
    }
  }

  /**
   * Get vocabulary information for the prompt
   */
  private getVocabularyInfo(): string {
    const primitives = this.vocabulary.getVocabularyStats();
    return `
Available primitives: ${primitives.totalPrimitives}
Action primitives: ${this.vocabulary.getPrimitivesByType('action').length}
Concept primitives: ${this.vocabulary.getPrimitivesByType('concept').length}
Common actions: action_query, action_summarize, action_analyze, action_create
Common concepts: concept_document, concept_person, concept_task
`;
  }

  /**
   * Get encoding examples for the prompt
   */
  private getEncodingExamples(): string {
    return `
Example 1:
Text: "Summarize this document for me"
Frame: {"frameType": "query", "action": "action_summarize", "target": "document"}

Example 2:
Text: "What is the weather like today?"
Frame: {"frameType": "query", "action": "action_query", "target": "weather", "aspect": "current"}

Example 3:
Text: "Create a new project called 'AI Research'"
Frame: {"frameType": "event", "action": "action_create", "object": "project", "name": "AI Research"}
`;
  }

  /**
   * Generate cache key for encoding request
   */
  private generateCacheKey(request: CortexEncodingRequest): string {
    return `${request.text}_${request.language}_${JSON.stringify(request.config)}`;
  }

  /**
   * Generate semantic hash for caching
   */
  private generateSemanticHash(frame: CortexFrame): string {
    const content = JSON.stringify(frame);
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Detect language of the text using enhanced heuristics
   */
  private detectLanguage(text: string): string {
    if (!text || text.trim().length < 10) {
      return 'unknown';
    }

    const cleanText = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleanText.split(/\s+/);

    if (words.length < 3) {
      return 'unknown';
    }

    // Language detection patterns with confidence scores
    const languagePatterns = {
      en: {
        commonWords: [
          'the',
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
        ],
        uniqueChars: /[a-z]/,
        script: 'latin',
      },
      es: {
        commonWords: [
          'el',
          'la',
          'los',
          'las',
          'y',
          'o',
          'pero',
          'en',
          'sobre',
          'a',
          'para',
          'de',
          'con',
          'por',
        ],
        uniqueChars: /[ñáéíóúü]/,
        script: 'latin',
      },
      fr: {
        commonWords: [
          'le',
          'la',
          'les',
          'et',
          'ou',
          'mais',
          'dans',
          'sur',
          'à',
          'pour',
          'de',
          'avec',
          'par',
        ],
        uniqueChars: /[àâäéèêëïîôöùûüÿœç]/,
        script: 'latin',
      },
      de: {
        commonWords: [
          'der',
          'die',
          'das',
          'und',
          'oder',
          'aber',
          'in',
          'auf',
          'an',
          'zu',
          'für',
          'von',
          'mit',
          'durch',
        ],
        uniqueChars: /[äöüß]/,
        script: 'latin',
      },
      pt: {
        commonWords: [
          'o',
          'a',
          'os',
          'as',
          'e',
          'ou',
          'mas',
          'em',
          'no',
          'na',
          'para',
          'de',
          'com',
          'por',
        ],
        uniqueChars: /[ãõáéíóúç]/,
        script: 'latin',
      },
      it: {
        commonWords: [
          'il',
          'la',
          'i',
          'le',
          'e',
          'o',
          'ma',
          'in',
          'su',
          'a',
          'per',
          'di',
          'con',
          'da',
        ],
        uniqueChars: /[àèéìíîòóùú]/,
        script: 'latin',
      },
      zh: {
        commonWords: [], // Chinese doesn't have spaces, so we use character patterns
        uniqueChars: /[\u4e00-\u9fff]/,
        script: 'han',
      },
      ja: {
        commonWords: [],
        uniqueChars: /[\u3040-\u309f\u30a0-\u30ff]/, // Hiragana and Katakana
        script: 'japanese',
      },
      ko: {
        commonWords: [],
        uniqueChars: /[\uac00-\ud7af\u1100-\u11ff]/, // Hangul
        script: 'korean',
      },
      ru: {
        commonWords: [
          'и',
          'в',
          'не',
          'на',
          'я',
          'быть',
          'он',
          'с',
          'что',
          'а',
          'по',
          'это',
          'она',
          'как',
        ],
        uniqueChars: /[а-яё]/,
        script: 'cyrillic',
      },
      ar: {
        commonWords: [
          'و',
          'في',
          'من',
          'على',
          'إلى',
          'أن',
          'أو',
          'مع',
          'هذا',
          'تلك',
        ],
        uniqueChars: /[\u0600-\u06ff]/,
        script: 'arabic',
      },
    };

    // Calculate confidence scores for each language
    const scores: Record<string, number> = {};

    for (const [lang, patterns] of Object.entries(languagePatterns)) {
      let score = 0;

      // Check for unique characters (high confidence)
      if (patterns.uniqueChars.test(text)) {
        score += 3;
      }

      // Check common words
      if (patterns.commonWords.length > 0) {
        const commonWords = patterns.commonWords as string[];
        const wordMatches = words.filter((word: string) =>
          commonWords.includes(word.toLowerCase()),
        ).length;
        score += wordMatches * 0.5;
      }

      // Check script consistency
      const scriptMatches = this.getScriptMatches(text, patterns.script);
      score += scriptMatches * 2;

      scores[lang] = score;
    }

    // Find the language with the highest score
    const bestMatch = Object.entries(scores).sort(([, a], [, b]) => b - a)[0];

    // Return language if confidence is high enough
    return bestMatch && bestMatch[1] > 2 ? bestMatch[0] : 'unknown';
  }

  private getScriptMatches(text: string, expectedScript: string): number {
    // Count characters that match the expected script
    let matches = 0;
    let total = 0;

    for (const char of text) {
      if (char.trim()) {
        total++;

        const charScript = this.getCharacterScript(char);
        if (charScript === expectedScript) {
          matches++;
        }
      }
    }

    return total > 0 ? matches / total : 0;
  }

  private getCharacterScript(char: string): string {
    const code = char.charCodeAt(0);

    // Latin script
    if (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 192 && code <= 255)
    ) {
      return 'latin';
    }

    // Cyrillic script
    if (code >= 1040 && code <= 1103) {
      return 'cyrillic';
    }

    // Arabic script
    if (code >= 1536 && code <= 1791) {
      return 'arabic';
    }

    // Chinese/Japanese/Korean
    if (code >= 19968 && code <= 40959) {
      return 'han';
    }

    // Japanese Hiragana
    if (code >= 12352 && code <= 12447) {
      return 'japanese';
    }

    // Japanese Katakana
    if (code >= 12448 && code <= 12543) {
      return 'japanese';
    }

    // Korean Hangul
    if ((code >= 44032 && code <= 55215) || (code >= 4352 && code <= 4607)) {
      return 'korean';
    }

    return 'unknown';
  }

  /**
   * Analyze sentiment of the text
   */
  private analyzeSentiment(text: string): string {
    // Simple sentiment analysis
    const positiveWords =
      /\b(good|great|excellent|amazing|wonderful|fantastic|love|like|best|awesome)\b/gi;
    const negativeWords =
      /\b(bad|terrible|awful|hate|worst|horrible|disappointing|angry|frustrated|sad)\b/gi;

    const positiveMatches = text.match(positiveWords);
    const negativeMatches = text.match(negativeWords);

    const positiveCount = positiveMatches ? positiveMatches.length : 0;
    const negativeCount = negativeMatches ? negativeMatches.length : 0;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Calculate complexity of the frame
   */
  private calculateComplexity(frame: CortexFrame): string {
    const roleCount = Object.keys(frame).length;
    if (roleCount <= 2) return 'simple';
    if (roleCount <= 5) return 'medium';
    return 'complex';
  }

  /**
   * Get cache statistics for encoding entries
   */
  getCacheInfo(): {
    totalEncodings: number;
    averageConfidence: number;
    averageProcessingTime: number;
    errorRate: number;
  } {
    const stats = this.cache.getStats();
    return {
      totalEncodings: stats.totalEntries,
      averageConfidence: 1 - stats.missRate,
      averageProcessingTime: stats.averageAccessTime,
      errorRate: stats.missRate,
    };
  }

  /**
   * Clear the Cortex cache (including encoding entries)
   */
  clearCache(): void {
    const stats = this.cache.getStats();
    const entriesCleared = stats.totalEntries;
    this.cache.clear();
    this.logger.log('Encoder cache cleared', {
      metric: 'cortex_encoder.cache_cleared',
      entriesCleared,
    });
  }
}
