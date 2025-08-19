import { logger } from '../utils/logger';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types/aiCostTracker.types';
import { calculateCost, getModelPricing, getProviderModels } from '../utils/pricing';

export interface TokenAttribution {
  systemPrompt: { tokens: number; cost: number; impact: 'high' | 'medium' | 'low' };
  userMessage: { tokens: number; cost: number; impact: 'high' | 'medium' | 'low' };
  conversationHistory: { tokens: number; cost: number; impact: 'high' | 'medium' | 'low' };
  toolCalls: { tokens: number; cost: number; impact: 'high' | 'medium' | 'low' };
  metadata: { tokens: number; cost: number; impact: 'high' | 'medium' | 'low' };
  total: { tokens: number; cost: number; impact: 'high' | 'medium' | 'low' };
}

export interface PromptSection {
  id: string;
  type: 'system' | 'user' | 'history' | 'tool' | 'metadata';
  content: string;
  tokens: number;
  cost: number;
  impact: 'high' | 'medium' | 'low';
  startIndex: number;
  endIndex: number;
  optimizationSuggestions: string[];
}

export interface CostDebuggerAnalysis {
  promptId: string;
  timestamp: Date;
  provider: AIProvider;
  model: string;
  tokenAttribution: TokenAttribution;
  sections: PromptSection[];
  totalTokens: number;
  totalCost: number;
  optimizationOpportunities: {
    highImpact: string[];
    mediumImpact: string[];
    lowImpact: string[];
    estimatedSavings: number;
    confidence: number;
  };
  qualityMetrics: {
    instructionClarity: number;
    contextRelevance: number;
    exampleEfficiency: number;
    overallScore: number;
  };
  pricingInfo: {
    modelPricing: any;
    costPerToken: number;
    provider: string;
    modelName: string;
  };
}

export interface DeadWeightAnalysis {
  redundantInstructions: string[];
  unnecessaryExamples: string[];
  verbosePhrasing: string[];
  duplicateContext: string[];
  estimatedSavings: number;
  confidence: number;
}

export class CostDebuggerService {
  async analyzePrompt(
    prompt: string,
    provider: AIProvider,
    model: string,
    options: {
      systemMessage?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      toolCalls?: Array<{ name: string; arguments: string }>;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<CostDebuggerAnalysis> {
    try {
      logger.info('🔍 Starting prompt cost analysis');

      // Get model pricing information
      const modelPricing = getModelPricing(provider, model);
      if (!modelPricing) {
        throw new Error(`No pricing data found for ${provider}/${model}`);
      }

      // Parse prompt into sections
      const sections = await this.parsePromptSections(prompt, provider, options);
      
      // Calculate token attribution with dynamic pricing
      const tokenAttribution = await this.calculateTokenAttribution(sections, provider, model, modelPricing);
      
      // Analyze optimization opportunities
      const optimizationOpportunities = await this.analyzeOptimizationOpportunities(sections, provider, model);
      
      // Assess quality metrics
      const qualityMetrics = await this.assessPromptQuality(sections, provider, model);

      const analysis: CostDebuggerAnalysis = {
        promptId: this.generatePromptId(),
        timestamp: new Date(),
        provider,
        model,
        tokenAttribution,
        sections,
        totalTokens: tokenAttribution.total.tokens,
        totalCost: tokenAttribution.total.cost,
        optimizationOpportunities,
        qualityMetrics,
        pricingInfo: {
          modelPricing,
          costPerToken: (modelPricing.inputPrice + modelPricing.outputPrice) / 2_000_000, // Average cost per token
          provider: modelPricing.provider,
          modelName: modelPricing.modelName
        }
      };

      logger.info(`✅ Prompt analysis complete: ${analysis.totalTokens} tokens, $${analysis.totalCost.toFixed(6)} cost`);
      return analysis;

    } catch (error) {
      logger.error('❌ Error analyzing prompt:', error);
      throw new Error(`Failed to analyze prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async parsePromptSections(
    prompt: string,
    provider: AIProvider,
    options: {
      systemMessage?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      toolCalls?: Array<{ name: string; arguments: string }>;
      metadata?: Record<string, any>;
    }
  ): Promise<PromptSection[]> {
    const sections: PromptSection[] = [];
    let currentIndex = 0;

    // System prompt section
    if (options.systemMessage) {
      const systemSection: PromptSection = {
        id: 'system-prompt',
        type: 'system',
        content: options.systemMessage,
        tokens: estimateTokens(options.systemMessage, provider),
        cost: 0, // Will be calculated later
        impact: 'high',
        startIndex: currentIndex,
        endIndex: currentIndex + options.systemMessage.length,
        optimizationSuggestions: []
      };
      sections.push(systemSection);
      currentIndex += options.systemMessage.length;
    }

    // User message section
    const userSection: PromptSection = {
      id: 'user-message',
      type: 'user',
      content: prompt,
      tokens: estimateTokens(prompt, provider),
      cost: 0, // Will be calculated later
      impact: 'high',
      startIndex: currentIndex,
      endIndex: currentIndex + prompt.length,
      optimizationSuggestions: []
    };
    sections.push(userSection);
    currentIndex += prompt.length;

    // Conversation history sections
    if (options.conversationHistory && options.conversationHistory.length > 0) {
      for (let i = 0; i < options.conversationHistory.length; i++) {
        const msg = options.conversationHistory[i];
        const historySection: PromptSection = {
          id: `history-${i}`,
          type: 'history',
          content: `${msg.role}: ${msg.content}`,
          tokens: estimateTokens(`${msg.role}: ${msg.content}`, provider),
          cost: 0, // Will be calculated later
          impact: i < 2 ? 'medium' : 'low', // Recent messages have higher impact
          startIndex: currentIndex,
          endIndex: currentIndex + msg.content.length,
          optimizationSuggestions: []
        };
        sections.push(historySection);
        currentIndex += msg.content.length;
      }
    }

    // Tool call sections
    if (options.toolCalls && options.toolCalls.length > 0) {
      for (let i = 0; i < options.toolCalls.length; i++) {
        const tool = options.toolCalls[i];
        const toolSection: PromptSection = {
          id: `tool-${i}`,
          type: 'tool',
          content: `Tool: ${tool.name}\nArguments: ${tool.arguments}`,
          tokens: estimateTokens(`Tool: ${tool.name}\nArguments: ${tool.arguments}`, provider),
          cost: 0, // Will be calculated later
          impact: 'medium',
          startIndex: currentIndex,
          endIndex: currentIndex + tool.arguments.length,
          optimizationSuggestions: []
        };
        sections.push(toolSection);
        currentIndex += tool.arguments.length;
      }
    }

    // Metadata section
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      const metadataStr = JSON.stringify(options.metadata);
      const metadataSection: PromptSection = {
        id: 'metadata',
        type: 'metadata',
        content: metadataStr,
        tokens: estimateTokens(metadataStr, provider),
        cost: 0, // Will be calculated later
        impact: 'low',
        startIndex: currentIndex,
        endIndex: currentIndex + metadataStr.length,
        optimizationSuggestions: []
      };
      sections.push(metadataSection);
    }

    return sections;
  }

  private async calculateTokenAttribution(
    sections: PromptSection[],
    provider: AIProvider,
    model: string,
    modelPricing: any
  ): Promise<TokenAttribution> {
    const attribution: TokenAttribution = {
      systemPrompt: { tokens: 0, cost: 0, impact: 'high' },
      userMessage: { tokens: 0, cost: 0, impact: 'high' },
      conversationHistory: { tokens: 0, cost: 0, impact: 'medium' },
      toolCalls: { tokens: 0, cost: 0, impact: 'medium' },
      metadata: { tokens: 0, cost: 0, impact: 'low' },
      total: { tokens: 0, cost: 0, impact: 'high' }
    };

    for (const section of sections) {
      const cost = await this.calculateSectionCost(section.tokens, provider, model, modelPricing);
      section.cost = cost;

      switch (section.type) {
        case 'system':
          attribution.systemPrompt.tokens += section.tokens;
          attribution.systemPrompt.cost += cost;
          break;
        case 'user':
          attribution.userMessage.tokens += section.tokens;
          attribution.userMessage.cost += cost;
          break;
        case 'history':
          attribution.conversationHistory.tokens += section.tokens;
          attribution.conversationHistory.cost += cost;
          break;
        case 'tool':
          attribution.toolCalls.tokens += section.tokens;
          attribution.toolCalls.cost += cost;
          break;
        case 'metadata':
          attribution.metadata.tokens += section.tokens;
          attribution.metadata.cost += cost;
          break;
      }

      attribution.total.tokens += section.tokens;
      attribution.total.cost += cost;
    }

    return attribution;
  }

  private async calculateSectionCost(
    tokens: number, 
    provider: AIProvider, 
    model: string, 
    modelPricing: any
  ): Promise<number> {
    try {
      // Use the dynamic pricing system
      const cost = calculateCost(tokens, 0, provider, model); // 0 output tokens for input-only sections
      return cost;
    } catch (error) {
      logger.warn(`Failed to calculate cost using pricing system for ${provider}/${model}, using fallback:`, error);
      // Fallback to modelPricing if available
      if (modelPricing) {
        const inputCost = (tokens / 1_000_000) * modelPricing.inputPrice;
        return inputCost;
      }
      // Final fallback
      const baseCostPerToken = 0.0001;
      return tokens * baseCostPerToken;
    }
  }

  private async analyzeOptimizationOpportunities(
    sections: PromptSection[],
    provider: AIProvider,
    model: string
  ): Promise<{
    highImpact: string[];
    mediumImpact: string[];
    lowImpact: string[];
    estimatedSavings: number;
    confidence: number;
  }> {
    const highImpact: string[] = [];
    const mediumImpact: string[] = [];
    const lowImpact: string[] = [];
    let totalSavings = 0;

    // Get alternative models for comparison
    const alternativeModels = getProviderModels(provider)
      .filter(m => m.modelId !== model)
      .sort((a, b) => (a.inputPrice + a.outputPrice) - (b.inputPrice + b.outputPrice))
      .slice(0, 3);

    for (const section of sections) {
      const suggestions = await this.generateSectionOptimizations(section, provider, model, alternativeModels);
      section.optimizationSuggestions = suggestions;

      for (const suggestion of suggestions) {
        if (suggestion.includes('Save 30%') || suggestion.includes('Save 40%')) {
          highImpact.push(suggestion);
          totalSavings += section.cost * 0.35; // Average of 30-40%
        } else if (suggestion.includes('Save 20%') || suggestion.includes('Save 25%')) {
          mediumImpact.push(suggestion);
          totalSavings += section.cost * 0.225; // Average of 20-25%
        } else {
          lowImpact.push(suggestion);
          totalSavings += section.cost * 0.1; // Conservative estimate
        }
      }
    }

    // Add model switching suggestions if significant savings are possible
    if (alternativeModels.length > 0) {
      const currentModelPricing = getModelPricing(provider, model);
      if (currentModelPricing) {
        const cheapestAlternative = alternativeModels[0];
        const currentCost = currentModelPricing.inputPrice + currentModelPricing.outputPrice;
        const alternativeCost = cheapestAlternative.inputPrice + cheapestAlternative.outputPrice;
        
        if (alternativeCost < currentCost) {
          const savingsPercentage = ((currentCost - alternativeCost) / currentCost) * 100;
          if (savingsPercentage > 20) {
            highImpact.push(`Switch to ${cheapestAlternative.modelName} → Save ${savingsPercentage.toFixed(1)}% on model costs`);
            totalSavings += totalSavings * 0.1; // Additional savings from model switch
          }
        }
      }
    }

    return {
      highImpact,
      mediumImpact,
      lowImpact,
      estimatedSavings: totalSavings,
      confidence: 0.85
    };
  }

  private async generateSectionOptimizations(
    section: PromptSection,
    _provider: AIProvider,
    _model: string,
    _alternativeModels: any[]
  ): Promise<string[]> {
    const suggestions: string[] = [];

    switch (section.type) {
      case 'system':
        if (section.tokens > 500) {
          suggestions.push('Compress system instructions → Save 30%');
        }
        if (section.content.includes('very') || section.content.includes('really')) {
          suggestions.push('Remove qualifiers → Save 15%');
        }
        if (section.content.includes('please') && section.content.includes('kindly')) {
          suggestions.push('Remove redundant politeness → Save 10%');
        }
        break;

      case 'user':
        if (section.tokens > 1000) {
          suggestions.push('Break down complex request → Save 25%');
        }
        if (section.content.includes('example') && section.content.includes('example')) {
          suggestions.push('Consolidate examples → Save 20%');
        }
        if (section.content.includes('I would like to') || section.content.includes('I want to')) {
          suggestions.push('Use direct language → Save 15%');
        }
        break;

      case 'history':
        if (section.tokens > 800) {
          suggestions.push('Summarize older messages → Save 40%');
        }
        if (section.content.includes('similar') || section.content.includes('same')) {
          suggestions.push('Remove redundant context → Save 25%');
        }
        if (section.content.includes('as mentioned before') || section.content.includes('as I said earlier')) {
          suggestions.push('Remove repetitive references → Save 20%');
        }
        break;

      case 'tool':
        if (section.tokens > 300) {
          suggestions.push('Simplify tool arguments → Save 20%');
        }
        if (section.content.includes('detailed') && section.content.includes('comprehensive')) {
          suggestions.push('Remove redundant descriptors → Save 15%');
        }
        break;

      case 'metadata':
        if (section.tokens > 100) {
          suggestions.push('Minimize metadata → Save 15%');
        }
        if (section.content.includes('timestamp') && section.content.includes('created_at')) {
          suggestions.push('Consolidate timestamp fields → Save 10%');
        }
        break;
    }

    return suggestions;
  }

  private async assessPromptQuality(
    sections: PromptSection[],
    _provider: AIProvider,
    _model: string
  ): Promise<{
    instructionClarity: number;
    contextRelevance: number;
    exampleEfficiency: number;
    overallScore: number;
  }> {
    let instructionClarity = 0;
    let contextRelevance = 0;
    let exampleEfficiency = 0;

    for (const section of sections) {
      if (section.type === 'system') {
        instructionClarity = this.scoreInstructionClarity(section.content);
      } else if (section.type === 'history') {
        contextRelevance = this.scoreContextRelevance(section.content);
      } else if (section.type === 'user' && section.content.includes('example')) {
        exampleEfficiency = this.scoreExampleEfficiency(section.content);
      }
    }

    const overallScore = (instructionClarity + contextRelevance + exampleEfficiency) / 3;

    return {
      instructionClarity,
      contextRelevance,
      exampleEfficiency,
      overallScore
    };
  }

  private scoreInstructionClarity(content: string): number {
    let score = 70; // Base score

    if (content.includes('MUST') || content.includes('REQUIRED')) score += 10;
    if (content.includes('DO NOT') || content.includes('NEVER')) score += 10;
    if (content.includes('format') || content.includes('structure')) score += 5;
    if (content.length < 200) score += 5;
    if (content.length > 500) score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  private scoreContextRelevance(content: string): number {
    let score = 70; // Base score

    if (content.includes('relevant') || content.includes('important')) score += 10;
    if (content.includes('recent') || content.includes('latest')) score += 10;
    if (content.includes('similar') || content.includes('same')) score -= 15;
    if (content.length < 100) score += 10;
    if (content.length > 400) score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  private scoreExampleEfficiency(content: string): number {
    let score = 70; // Base score

    const exampleCount = (content.match(/example/gi) || []).length;
    if (exampleCount === 1) score += 15;
    if (exampleCount === 2) score += 10;
    if (exampleCount > 3) score -= 20;

    if (content.includes('brief') || content.includes('concise')) score += 10;
    if (content.includes('detailed') && content.length > 200) score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  private generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async detectDeadWeight(prompt: string, provider: AIProvider, model: string): Promise<DeadWeightAnalysis> {
    try {
      const analysis = await this.analyzePrompt(prompt, provider, model);
      
      const redundantInstructions: string[] = [];
      const unnecessaryExamples: string[] = [];
      const verbosePhrasing: string[] = [];
      const duplicateContext: string[] = [];

      for (const section of analysis.sections) {
        if (section.optimizationSuggestions.some(s => s.includes('redundant'))) {
          redundantInstructions.push(section.content.substring(0, 100) + '...');
        }
        if (section.optimizationSuggestions.some(s => s.includes('examples'))) {
          unnecessaryExamples.push(section.content.substring(0, 100) + '...');
        }
        if (section.optimizationSuggestions.some(s => s.includes('qualifiers'))) {
          verbosePhrasing.push(section.content.substring(0, 100) + '...');
        }
        if (section.optimizationSuggestions.some(s => s.includes('duplicate'))) {
          duplicateContext.push(section.content.substring(0, 100) + '...');
        }
      }

      return {
        redundantInstructions,
        unnecessaryExamples,
        verbosePhrasing,
        duplicateContext,
        estimatedSavings: analysis.optimizationOpportunities.estimatedSavings,
        confidence: analysis.optimizationOpportunities.confidence
      };

    } catch (error) {
      logger.error('❌ Error detecting dead weight:', error);
      throw new Error(`Failed to detect dead weight: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async comparePromptVersions(
    originalPrompt: string,
    optimizedPrompt: string,
    provider: AIProvider,
    model: string
  ): Promise<{
    originalAnalysis: CostDebuggerAnalysis;
    optimizedAnalysis: CostDebuggerAnalysis;
    improvements: {
      tokensSaved: number;
      costSaved: number;
      savingsPercentage: number;
      qualityImpact: number;
    };
  }> {
    try {
      const [originalAnalysis, optimizedAnalysis] = await Promise.all([
        this.analyzePrompt(originalPrompt, provider, model),
        this.analyzePrompt(optimizedPrompt, provider, model)
      ]);

      const tokensSaved = originalAnalysis.totalTokens - optimizedAnalysis.totalTokens;
      const costSaved = originalAnalysis.totalCost - optimizedAnalysis.totalCost;
      const savingsPercentage = (tokensSaved / originalAnalysis.totalTokens) * 100;
      const qualityImpact = optimizedAnalysis.qualityMetrics.overallScore - originalAnalysis.qualityMetrics.overallScore;

      return {
        originalAnalysis,
        optimizedAnalysis,
        improvements: {
          tokensSaved,
          costSaved,
          savingsPercentage,
          qualityImpact
        }
      };

    } catch (error) {
      logger.error('❌ Error comparing prompt versions:', error);
      throw new Error(`Failed to compare prompt versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getProviderComparison(
    prompt: string,
    providers: string[],
    model: string
  ): Promise<Array<{
    provider: string;
    model: string;
    tokens: number;
    cost: number;
    quality: number;
    pricing: any;
  }>> {
    try {
      const comparisons = await Promise.all(
        providers.map(async (provider) => {
          try {
            const analysis = await this.analyzePrompt(prompt, provider as AIProvider, model);
            const modelPricing = getModelPricing(provider, model);
            
            return {
              provider,
              model,
              tokens: analysis.totalTokens,
              cost: analysis.totalCost,
              quality: analysis.qualityMetrics.overallScore,
              pricing: modelPricing
            };
          } catch (error) {
            logger.warn(`Failed to analyze for ${provider}/${model}:`, error);
            return {
              provider,
              model,
              tokens: 0,
              cost: 0,
              quality: 0,
              pricing: null,
              error: 'Analysis failed'
            };
          }
        })
      );

      return comparisons;
    } catch (error) {
      logger.error('❌ Error getting provider comparison:', error);
      throw new Error(`Failed to get provider comparison: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const costDebuggerService = new CostDebuggerService();
