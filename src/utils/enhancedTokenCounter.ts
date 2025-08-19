import { AIProvider } from '../types/aiCostTracker.types';
import { calculateCost, getModelPricing } from './pricing';

export interface TokenCountResult {
  tokens: number;
  characters: number;
  words: number;
  estimatedCost: number;
  provider: AIProvider;
  model: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DetailedTokenBreakdown {
  total: TokenCountResult;
  sections: {
    system: TokenCountResult;
    user: TokenCountResult;
    history: TokenCountResult;
    tools: TokenCountResult;
    metadata: TokenCountResult;
  };
}

export class EnhancedTokenCounter {
  private static readonly PROVIDER_TOKENIZERS: Record<string, {
    charsPerToken: number;
    wordsPerToken: number;
    overhead: number;
  }> = {
    [AIProvider.OpenAI]: {
      charsPerToken: 4.0,
      wordsPerToken: 0.75,
      overhead: 3
    },
    [AIProvider.Anthropic]: {
      charsPerToken: 3.5,
      wordsPerToken: 0.8,
      overhead: 2
    },
    [AIProvider.AWSBedrock]: {
      charsPerToken: 3.8,
      wordsPerToken: 0.78,
      overhead: 2
    },
    [AIProvider.Google]: {
      charsPerToken: 4.2,
      wordsPerToken: 0.72,
      overhead: 3
    },
    [AIProvider.Cohere]: {
      charsPerToken: 4.1,
      wordsPerToken: 0.73,
      overhead: 3
    }
  };

  static countTokens(
    text: string,
    provider: AIProvider,
    model: string,
    options: {
      includeOverhead?: boolean;
      estimateOutput?: boolean;
    } = {}
  ): TokenCountResult {
    if (!text || typeof text !== 'string') {
      return this.createEmptyResult(provider, model);
    }

    const config = this.PROVIDER_TOKENIZERS[provider] || this.PROVIDER_TOKENIZERS[AIProvider.OpenAI];
    
    // Calculate base token count
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
    
    // Use provider-specific tokenization
    const estimatedTokens = Math.max(
      Math.ceil(charCount / config.charsPerToken),
      Math.ceil(wordCount / config.wordsPerToken)
    );

    // Add overhead if requested
    const totalTokens = options.includeOverhead ? estimatedTokens + config.overhead : estimatedTokens;
    
    // Estimate cost using dynamic pricing
    const estimatedCost = this.estimateCost(totalTokens, provider, model, options.estimateOutput);
    
    // Determine confidence based on text characteristics
    const confidence = this.assessConfidence(text);

    return {
      tokens: totalTokens,
      characters: charCount,
      words: wordCount,
      estimatedCost,
      provider,
      model,
      confidence
    };
  }

  static countConversationTokens(
    messages: Array<{ role: string; content: string }>,
    provider: AIProvider,
    model: string
  ): TokenCountResult {
    if (!messages || messages.length === 0) {
      return this.createEmptyResult(provider, model);
    }

    let totalTokens = 0;
    let totalChars = 0;
    let totalWords = 0;

    for (const message of messages) {
      const result = this.countTokens(message.content, provider, model, { includeOverhead: false });
      totalTokens += result.tokens;
      totalChars += result.characters;
      totalWords += result.words;
    }

    // Add conversation overhead
    const config = this.PROVIDER_TOKENIZERS[provider] || this.PROVIDER_TOKENIZERS[AIProvider.OpenAI];
    totalTokens += config.overhead * messages.length;

    const estimatedCost = this.estimateCost(totalTokens, provider, model, false);

    return {
      tokens: totalTokens,
      characters: totalChars,
      words: totalWords,
      estimatedCost,
      provider,
      model,
      confidence: 'medium'
    };
  }

  static analyzePromptStructure(
    prompt: string,
    provider: AIProvider,
    model: string,
    options: {
      systemMessage?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      toolCalls?: Array<{ name: string; arguments: string }>;
      metadata?: Record<string, any>;
    } = {}
  ): DetailedTokenBreakdown {
    const sections = {
      system: this.countTokens(options.systemMessage || '', provider, model, { includeOverhead: true }),
      user: this.countTokens(prompt, provider, model, { includeOverhead: true }),
      history: this.countConversationTokens(options.conversationHistory || [], provider, model),
      tools: this.countTokens(
        (options.toolCalls || []).map(t => `${t.name}: ${t.arguments}`).join('\n'),
        provider,
        model,
        { includeOverhead: false }
      ),
      metadata: this.countTokens(
        options.metadata ? JSON.stringify(options.metadata) : '',
        provider,
        model,
        { includeOverhead: false }
      )
    };

    // Calculate totals
    const totalTokens = Object.values(sections).reduce((sum, section) => sum + section.tokens, 0);
    const totalChars = Object.values(sections).reduce((sum, section) => sum + section.characters, 0);
    const totalWords = Object.values(sections).reduce((sum, section) => sum + section.words, 0);
    const totalCost = Object.values(sections).reduce((sum, section) => sum + section.estimatedCost, 0);

    const total: TokenCountResult = {
      tokens: totalTokens,
      characters: totalChars,
      words: totalWords,
      estimatedCost: totalCost,
      provider,
      model,
      confidence: this.assessOverallConfidence(sections)
    };

    return { total, sections };
  }

  static estimateOptimizationSavings(
    originalPrompt: string,
    optimizedPrompt: string,
    provider: AIProvider,
    model: string
  ): {
    originalTokens: number;
    optimizedTokens: number;
    savedTokens: number;
    savingsPercentage: number;
    costSavings: number;
    costSavingsPercentage: number;
  } {
    const original = this.countTokens(originalPrompt, provider, model);
    const optimized = this.countTokens(optimizedPrompt, provider, model);

    const savedTokens = original.tokens - optimized.tokens;
    const savingsPercentage = (savedTokens / original.tokens) * 100;
    const costSavings = original.estimatedCost - optimized.estimatedCost;
    const costSavingsPercentage = (costSavings / original.estimatedCost) * 100;

    return {
      originalTokens: original.tokens,
      optimizedTokens: optimized.tokens,
      savedTokens,
      savingsPercentage,
      costSavings,
      costSavingsPercentage
    };
  }

  static detectTokenOptimizationOpportunities(
    text: string,
    provider: AIProvider,
    model: string
  ): Array<{
    type: 'redundancy' | 'verbosity' | 'structure' | 'formatting';
    description: string;
    estimatedSavings: number;
    confidence: number;
    suggestion: string;
  }> {
    const opportunities: Array<{
      type: 'redundancy' | 'verbosity' | 'structure' | 'formatting';
      description: string;
      estimatedSavings: number;
      confidence: number;
      suggestion: string;
    }> = [];

    // Check for redundant phrases
    const redundantPhrases = this.findRedundantPhrases(text);
    if (redundantPhrases.length > 0) {
      const estimatedSavings = redundantPhrases.reduce((sum, phrase) => {
        const phraseTokens = this.countTokens(phrase, provider, model).tokens;
        return sum + phraseTokens;
      }, 0);

      opportunities.push({
        type: 'redundancy',
        description: `Found ${redundantPhrases.length} redundant phrases`,
        estimatedSavings,
        confidence: 0.9,
        suggestion: 'Remove or consolidate redundant phrases'
      });
    }

    // Check for verbose language
    const verbosePatterns = this.findVerbosePatterns(text);
    if (verbosePatterns.length > 0) {
      const estimatedSavings = verbosePatterns.length * 2; // Rough estimate
      opportunities.push({
        type: 'verbosity',
        description: `Found ${verbosePatterns.length} verbose expressions`,
        estimatedSavings,
        confidence: 0.8,
        suggestion: 'Use more concise language'
      });
    }

    // Check for inefficient structure
    const structureIssues = this.findStructureIssues(text);
    if (structureIssues.length > 0) {
      opportunities.push({
        type: 'structure',
        description: `Found ${structureIssues.length} structural inefficiencies`,
        estimatedSavings: structureIssues.length * 3,
        confidence: 0.7,
        suggestion: 'Restructure for better clarity and efficiency'
      });
    }

    return opportunities;
  }

  private static estimateCost(
    tokens: number,
    provider: AIProvider,
    model: string,
    isOutput: boolean = false
  ): number {
    try {
      // Use the dynamic pricing system
      const cost = calculateCost(tokens, 0, provider, model); // 0 output tokens for input-only sections
      return cost;
    } catch (error) {
      // Fallback to modelPricing if available
      const modelPricing = getModelPricing(provider, model);
      if (modelPricing) {
        const rate = isOutput ? modelPricing.outputPrice : modelPricing.inputPrice;
        return (tokens / 1_000_000) * rate;
      }
      
      // Final fallback - conservative estimate
      const baseCostPerToken = 0.0001;
      return tokens * baseCostPerToken;
    }
  }

  private static assessConfidence(text: string): 'high' | 'medium' | 'low' {
    // High confidence for short, simple text
    if (text.length < 100) return 'high';
    
    // Medium confidence for typical text
    if (text.length < 1000) return 'medium';
    
    // Low confidence for very long or complex text
    if (text.length > 5000) return 'low';
    
    // Check for special content that might affect tokenization
    const hasCode = /```[\s\S]*?```/.test(text);
    const hasJson = /\{[\s\S]*\}/.test(text);
    const hasUrls = /https?:\/\/[^\s]+/.test(text);
    
    if (hasCode || hasJson || hasUrls) return 'medium';
    
    return 'high';
  }

  private static assessOverallConfidence(sections: any): 'high' | 'medium' | 'low' {
    const confidences = Object.values(sections).map((s: any) => s.confidence);
    const avgConfidence = confidences.reduce((sum, c) => sum + (c === 'high' ? 1 : c === 'medium' ? 0.5 : 0), 0) / confidences.length;
    
    if (avgConfidence >= 0.8) return 'high';
    if (avgConfidence >= 0.5) return 'medium';
    return 'low';
  }

  private static createEmptyResult(provider: AIProvider, model: string): TokenCountResult {
    return {
      tokens: 0,
      characters: 0,
      words: 0,
      estimatedCost: 0,
      provider,
      model,
      confidence: 'high'
    };
  }

  private static findRedundantPhrases(text: string): string[] {
    const redundantPatterns = [
      /(?:very|really|quite|somewhat|rather|pretty|fairly)\s+\w+/gi,
      /(?:in order to|so as to)/gi,
      /(?:due to the fact that|because of the fact that)/gi,
      /(?:at this point in time|at the present time)/gi,
      /(?:in the event that|if)/gi
    ];

    const found: string[] = [];
    redundantPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        found.push(...matches);
      }
    });

    return found;
  }

  private static findVerbosePatterns(text: string): string[] {
    const verbosePatterns = [
      /(?:I would like to|I want to)/gi,
      /(?:it is important to note that|it should be noted that)/gi,
      /(?:as you can see|as you may know)/gi,
      /(?:in my opinion|I think that)/gi
    ];

    const found: string[] = [];
    verbosePatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        found.push(...matches);
      }
    });

    return found;
  }

  private static findStructureIssues(text: string): string[] {
    const issues: string[] = [];
    
    // Check for excessive line breaks
    if ((text.match(/\n\n\n+/g) || []).length > 0) {
      issues.push('Excessive line breaks');
    }
    
    // Check for repetitive punctuation
    if ((text.match(/[.!?]{3,}/g) || []).length > 0) {
      issues.push('Repetitive punctuation');
    }
    
    // Check for inconsistent formatting
    if ((text.match(/[A-Z][a-z]*\s+[A-Z][a-z]*\s+[A-Z][a-z]*/g) || []).length > 5) {
      issues.push('Inconsistent capitalization');
    }

    return issues;
  }
}

export const enhancedTokenCounter = new EnhancedTokenCounter();
