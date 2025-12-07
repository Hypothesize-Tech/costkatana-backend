/**
 * Lazy Summarization Service
 * 
 * Automatically compresses and summarizes context before sending to LLM:
 * - Extracts only relevant sections from long documents
 * - Compresses conversation history
 * - Reduces token usage by 40-60%
 * - Maintains semantic quality
 */

import { loggingService } from './logging.service';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types/aiCostTracker.types';

export interface SummarizationConfig {
  enabled: boolean;
  maxTokens: number;
  aggressiveness: 'light' | 'medium' | 'aggressive';
  preserveCodeBlocks: boolean;
  preserveExamples: boolean;
}

export interface SummarizationResult {
  originalText: string;
  summarizedText: string;
  originalTokens: number;
  summarizedTokens: number;
  reductionPercentage: number;
  technique: string;
  quality: 'high' | 'medium' | 'low';
}

export class LazySummarizationService {
  /**
   * Automatically compress context before LLM request
   */
  static async compressContext(
    context: string | string[],
    targetTokens: number,
    config: Partial<SummarizationConfig> = {}
  ): Promise<SummarizationResult> {
    try {
      const defaultConfig: SummarizationConfig = {
        enabled: true,
        maxTokens: targetTokens,
        aggressiveness: 'medium',
        preserveCodeBlocks: true,
        preserveExamples: true,
        ...config
      };

      const originalText = Array.isArray(context) ? context.join('\n\n') : context;
      const originalTokens = estimateTokens(originalText, AIProvider.OpenAI);

      // If already under target, no summarization needed
      if (originalTokens <= targetTokens) {
        return {
          originalText,
          summarizedText: originalText,
          originalTokens,
          summarizedTokens: originalTokens,
          reductionPercentage: 0,
          technique: 'none',
          quality: 'high'
        };
      }

      loggingService.info('Applying lazy summarization', {
        originalTokens,
        targetTokens,
        aggressiveness: defaultConfig.aggressiveness
      });

      // Apply appropriate compression technique based on content type
      const result = await this.selectAndApplySummarization(
        originalText,
        originalTokens,
        targetTokens,
        defaultConfig
      );

      loggingService.info('Lazy summarization completed', {
        originalTokens: result.originalTokens,
        summarizedTokens: result.summarizedTokens,
        reductionPercentage: result.reductionPercentage,
        technique: result.technique
      });

      return result;
    } catch (error) {
      loggingService.error('Error in lazy summarization', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Fallback: return original
      const originalText = Array.isArray(context) ? context.join('\n\n') : context;
      return {
        originalText,
        summarizedText: originalText,
        originalTokens: estimateTokens(originalText, AIProvider.OpenAI),
        summarizedTokens: estimateTokens(originalText, AIProvider.OpenAI),
        reductionPercentage: 0,
        technique: 'fallback',
        quality: 'high'
      };
    }
  }

  /**
   * Select and apply best summarization technique
   */
  private static async selectAndApplySummarization(
    text: string,
    currentTokens: number,
    targetTokens: number,
    config: SummarizationConfig
  ): Promise<SummarizationResult> {
    // Try techniques in order of quality preservation
    const techniques = [
      { name: 'extractive', preserveQuality: 'high', reduction: 0.4 },
      { name: 'sliding_window', preserveQuality: 'high', reduction: 0.5 },
      { name: 'hierarchical', preserveQuality: 'medium', reduction: 0.6 },
      { name: 'aggressive_truncation', preserveQuality: 'low', reduction: 0.7 }
    ];

    const requiredReduction = 1 - (targetTokens / currentTokens);

    // Select technique based on required reduction and aggressiveness
    let selectedTechnique = techniques[0];
    if (config.aggressiveness === 'aggressive' || requiredReduction > 0.5) {
      selectedTechnique = techniques.find(t => t.reduction >= requiredReduction) || techniques[techniques.length - 1];
    } else if (config.aggressiveness === 'medium') {
      selectedTechnique = techniques.find(t => t.reduction >= requiredReduction && t.reduction < 0.6) || techniques[1];
    }

    // Apply the selected technique
    let result: SummarizationResult;
    
    switch (selectedTechnique.name) {
      case 'extractive':
        result = await this.extractiveSummarization(text, targetTokens, config);
        break;
      case 'sliding_window':
        result = await this.slidingWindowCompression(text, targetTokens, config);
        break;
      case 'hierarchical':
        result = await this.hierarchicalSummarization(text, targetTokens, config);
        break;
      case 'aggressive_truncation':
        result = await this.aggressiveTruncation(text, targetTokens, config);
        break;
      default:
        result = await this.extractiveSummarization(text, targetTokens, config);
    }

    return result;
  }

  /**
   * Extractive summarization - extract most relevant sentences
   */
  private static async extractiveSummarization(
    text: string,
    targetTokens: number,
    config: SummarizationConfig
  ): Promise<SummarizationResult> {
    const sentences = text.split(/[.!?]\s+/);
    
    // Score sentences by importance (simple heuristic)
    const scoredSentences = sentences.map((sentence, index) => {
      let score = 0;
      
      // First and last sentences are important
      if (index === 0 || index === sentences.length - 1) score += 10;
      
      // Questions are important
      if (sentence.includes('?')) score += 5;
      
      // Code blocks are important if preserving
      if (config.preserveCodeBlocks && (sentence.includes('```') || sentence.includes('function') || sentence.includes('class'))) {
        score += 15;
      }
      
      // Examples are important if preserving
      if (config.preserveExamples && (sentence.toLowerCase().includes('example') || sentence.toLowerCase().includes('e.g.'))) {
        score += 10;
      }
      
      // Longer sentences often contain more info
      score += Math.min(sentence.length / 100, 5);
      
      return { sentence, score, index };
    });

    // Sort by score and select top sentences
    scoredSentences.sort((a, b) => b.score - a.score);
    
    const selectedSentences: typeof scoredSentences = [];
    let currentTokens = 0;
    
    for (const item of scoredSentences) {
      const sentenceTokens = estimateTokens(item.sentence, AIProvider.OpenAI);
      if (currentTokens + sentenceTokens <= targetTokens) {
        selectedSentences.push(item);
        currentTokens += sentenceTokens;
      }
    }

    // Sort back to original order
    selectedSentences.sort((a, b) => a.index - b.index);
    const summarizedText = selectedSentences.map(s => s.sentence).join('. ') + '.';
    
    return {
      originalText: text,
      summarizedText,
      originalTokens: estimateTokens(text, AIProvider.OpenAI),
      summarizedTokens: estimateTokens(summarizedText, AIProvider.OpenAI),
      reductionPercentage: ((1 - (estimateTokens(summarizedText, AIProvider.OpenAI) / estimateTokens(text, AIProvider.OpenAI))) * 100),
      technique: 'extractive',
      quality: 'high'
    };
  }

  /**
   * Sliding window compression - keep recent context
   */
  private static async slidingWindowCompression(
    text: string,
    targetTokens: number,
    _config: SummarizationConfig
  ): Promise<SummarizationResult> {
    const paragraphs = text.split('\n\n');
    
    // Keep most recent paragraphs that fit in target
    const recentParagraphs: string[] = [];
    let currentTokens = 0;
    
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const paragraph = paragraphs[i];
      const paragraphTokens = estimateTokens(paragraph, AIProvider.OpenAI);
      
      if (currentTokens + paragraphTokens <= targetTokens) {
        recentParagraphs.unshift(paragraph);
        currentTokens += paragraphTokens;
      } else {
        break;
      }
    }

    const summarizedText = recentParagraphs.join('\n\n');
    
    return {
      originalText: text,
      summarizedText,
      originalTokens: estimateTokens(text, AIProvider.OpenAI),
      summarizedTokens: estimateTokens(summarizedText, AIProvider.OpenAI),
      reductionPercentage: ((1 - (estimateTokens(summarizedText, AIProvider.OpenAI) / estimateTokens(text, AIProvider.OpenAI))) * 100),
      technique: 'sliding_window',
      quality: 'high'
    };
  }

  /**
   * Hierarchical summarization - summarize sections recursively
   */
  private static async hierarchicalSummarization(
    text: string,
    targetTokens: number,
    config: SummarizationConfig
  ): Promise<SummarizationResult> {
    // Split into sections (by headers or paragraphs)
    const sections = text.split(/\n(?=#{1,6}\s|\n)/);

    // Summarize each section to approximately 1/3 of its original token count
    const summarizedSections = sections.map(section => {
      const sectionTokens = estimateTokens(section, AIProvider.OpenAI);
      const targetSectionTokens = Math.max(50, Math.floor(sectionTokens * 0.33));

      // Use extractive for each section, but use targetSectionTokens for actual target, not just percent of sentences
      const sentences = section.split(/[.!?]\s+/);

      // Estimate tokens per sentence, choose as many full sentences as fit within targetSectionTokens
      let tokensAccum = 0;
      const selectedSentences: string[] = [];
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const tokensForSentence = estimateTokens(sentence, AIProvider.OpenAI);
        if (tokensAccum + tokensForSentence > targetSectionTokens && selectedSentences.length > 0) {
          break;
        }
        selectedSentences.push(sentence);
        tokensAccum += tokensForSentence;
      }

      if (selectedSentences.length === 0 && sentences.length > 0) {
        // If no sentence fit but there's at least one, take the first.
        selectedSentences.push(sentences[0]);
      }

      return selectedSentences.join('. ') + (selectedSentences.length ? '.' : '');
    });

    let summarizedText = summarizedSections.join('\n\n');
    
    // If still too long, apply sliding window
    if (estimateTokens(summarizedText, AIProvider.OpenAI) > targetTokens) {
      const result = await this.slidingWindowCompression(summarizedText, targetTokens, config);
      summarizedText = result.summarizedText;
    }

    return {
      originalText: text,
      summarizedText,
      originalTokens: estimateTokens(text, AIProvider.OpenAI),
      summarizedTokens: estimateTokens(summarizedText, AIProvider.OpenAI),
      reductionPercentage: ((1 - (estimateTokens(summarizedText, AIProvider.OpenAI) / estimateTokens(text, AIProvider.OpenAI))) * 100),
      technique: 'hierarchical',
      quality: 'medium'
    };
  }

  /**
   * Aggressive truncation - simply truncate to target length
   */
  private static async aggressiveTruncation(
    text: string,
    targetTokens: number,
    _config: SummarizationConfig
  ): Promise<SummarizationResult> {
    // Estimate characters needed (rough: 4 chars per token)
    const targetChars = targetTokens * 4;
    
    let summarizedText = text;
    if (text.length > targetChars) {
      // Keep beginning and end, truncate middle
      const keepStart = Math.floor(targetChars * 0.7);
      const keepEnd = Math.floor(targetChars * 0.3);
      
      summarizedText = text.substring(0, keepStart) + 
        '\n\n... [content truncated for brevity] ...\n\n' +
        text.substring(text.length - keepEnd);
    }

    return {
      originalText: text,
      summarizedText,
      originalTokens: estimateTokens(text, AIProvider.OpenAI),
      summarizedTokens: estimateTokens(summarizedText, AIProvider.OpenAI),
      reductionPercentage: ((1 - (estimateTokens(summarizedText, AIProvider.OpenAI) / estimateTokens(text, AIProvider.OpenAI))) * 100),
      technique: 'aggressive_truncation',
      quality: 'low'
    };
  }

  /**
   * Compress conversation history
   */
  static async compressConversationHistory(
    messages: Array<{ role: string; content: string }>,
    targetTokens: number
  ): Promise<{
    original: Array<{ role: string; content: string }>;
    compressed: Array<{ role: string; content: string }>;
    reductionPercentage: number;
  }> {
    try {
      const totalTokens = messages.reduce(
        (sum, msg) => sum + estimateTokens(msg.content, AIProvider.OpenAI),
        0
      );

      if (totalTokens <= targetTokens) {
        return {
          original: messages,
          compressed: messages,
          reductionPercentage: 0
        };
      }

      // Keep system message and most recent messages
      const systemMessages = messages.filter(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');
      
      // Always keep last 2 messages
      const recentMessages = conversationMessages.slice(-2);
      const olderMessages = conversationMessages.slice(0, -2);
      
      // Summarize older messages
      const olderText = olderMessages.map(m => `${m.role}: ${m.content}`).join('\n\n');
      const olderTokens = estimateTokens(olderText, AIProvider.OpenAI);
      const targetOlderTokens = targetTokens - estimateTokens(
        systemMessages.concat(recentMessages).map(m => m.content).join('\n'),
        AIProvider.OpenAI
      );

      if (olderTokens > targetOlderTokens && targetOlderTokens > 100) {
        const summarized = await this.compressContext(olderText, targetOlderTokens, {
          aggressiveness: 'medium'
        });

        const compressed = [
          ...systemMessages,
          {
            role: 'system',
            content: `[Previous conversation summary: ${summarized.summarizedText}]`
          },
          ...recentMessages
        ];

        return {
          original: messages,
          compressed,
          reductionPercentage: summarized.reductionPercentage
        };
      }

      // If can't compress enough, just keep recent
      return {
        original: messages,
        compressed: [...systemMessages, ...recentMessages],
        reductionPercentage: ((1 - (recentMessages.length / messages.length)) * 100)
      };
    } catch (error) {
      loggingService.error('Error compressing conversation', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        original: messages,
        compressed: messages,
        reductionPercentage: 0
      };
    }
  }

  /**
   * Auto-detect if summarization would be beneficial
   */
  static shouldApplySummarization(
    tokenCount: number,
    threshold: number = 5000
  ): {
    shouldApply: boolean;
    reason: string;
    recommendedTarget: number;
  } {
    if (tokenCount < threshold) {
      return {
        shouldApply: false,
        reason: 'Token count below threshold',
        recommendedTarget: tokenCount
      };
    }

    const recommendedTarget = Math.floor(tokenCount * 0.6); // Target 40% reduction

    return {
      shouldApply: true,
      reason: `Token count (${tokenCount}) exceeds threshold (${threshold})`,
      recommendedTarget
    };
  }
}

