import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types/aiCostTracker.types';
import { calculateCost, getModelPricing, getProviderModels } from '../utils/pricing';
import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';

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
  // Circuit breaker for AI service calls
  private aiFailureCount = 0;
  private readonly MAX_AI_FAILURES = 3;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 5 * 60 * 1000; // 5 minutes
  private lastFailureTime = 0;

  // Memory optimization: Content chunking configuration
  private readonly MAX_CONTENT_CHUNK_SIZE = 1000;
  private readonly MAX_SECTION_PREVIEW_SIZE = 300;

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
      loggingService.info('🚀 analyzePrompt method entered', { value:  {  prompt, provider, model, options  } });
      loggingService.info('� analyzePrompt method entered', { value:  {  prompt, provider, model, options  } });

      // Get model pricing information
      loggingService.info('🔍 Getting model pricing...');
      const modelPricing = getModelPricing(provider, model);
      if (!modelPricing) {
        throw new Error(`No pricing data found for ${provider}/${model}`);
      }
      loggingService.info('✅ Model pricing retrieved successfully', { value:  {  modelPricing  } });

      // Parse prompt into sections
      loggingService.info('🔍 Parsing prompt sections...');
      const sections = await this.parsePromptSections(prompt, provider, options);
      loggingService.info('✅ Prompt sections parsed successfully', { value:  {  sectionsCount: sections.length  } });
      
      // Solution 1 & 3: Parallel processing of token attribution and AI analyses
      loggingService.info('🔍 Starting parallel analysis processing...');
      
      const [tokenAttribution, optimizationOpportunities, qualityMetrics] = await Promise.all([
        // Calculate token attribution with batch processing
        this.calculateTokenAttributionOptimized(sections, provider, model, modelPricing),
        // Analyze optimization opportunities with circuit breaker
        this.performAnalysisWithFallback(
          () => this.analyzeOptimizationOpportunities(sections, provider, model),
          () => this.fallbackOptimizationAnalysis(sections, provider, model)
        ),
        // Assess quality metrics with circuit breaker
        this.performAnalysisWithFallback(
          () => this.assessPromptQuality(sections, provider, model),
          () => ({
            instructionClarity: 70,
            contextRelevance: 70,
            exampleEfficiency: 70,
            overallScore: 70
          })
        )
      ]);
      
      loggingService.info('✅ Parallel analysis completed successfully', { 
        value: { 
          totalTokens: tokenAttribution.total.tokens,
          optimizationCount: optimizationOpportunities.highImpact.length + optimizationOpportunities.mediumImpact.length,
          qualityScore: qualityMetrics.overallScore
        } 
      });

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

      loggingService.info(`✅ Prompt analysis complete: ${analysis.totalTokens} tokens, $${analysis.totalCost.toFixed(6)} cost`);
      return analysis;

    } catch (error) {
      loggingService.error('❌ Error analyzing prompt:', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to analyze prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Solution 4: Memory-efficient prompt section parsing
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

    // System prompt section with memory optimization
    if (options.systemMessage) {
      const systemContent = this.optimizeContentForMemory(options.systemMessage);
      const systemSection: PromptSection = {
        id: 'system-prompt',
        type: 'system',
        content: systemContent,
        tokens: estimateTokens(options.systemMessage, provider), // Use original for accurate token count
        cost: 0, // Will be calculated later
        impact: 'high',
        startIndex: currentIndex,
        endIndex: currentIndex + options.systemMessage.length,
        optimizationSuggestions: []
      };
      sections.push(systemSection);
      currentIndex += options.systemMessage.length;
    }

    // User message section with memory optimization
    const userContent = this.optimizeContentForMemory(prompt);
    const userSection: PromptSection = {
      id: 'user-message',
      type: 'user',
      content: userContent,
      tokens: estimateTokens(prompt, provider), // Use original for accurate token count
      cost: 0, // Will be calculated later
      impact: 'high',
      startIndex: currentIndex,
      endIndex: currentIndex + prompt.length,
      optimizationSuggestions: []
    };
    sections.push(userSection);
    currentIndex += prompt.length;

    // Conversation history sections with memory optimization
    if (options.conversationHistory && options.conversationHistory.length > 0) {
      for (let i = 0; i < options.conversationHistory.length; i++) {
        const msg = options.conversationHistory[i];
        const fullContent = `${msg.role}: ${msg.content}`;
        const optimizedContent = this.optimizeContentForMemory(fullContent);
        
        const historySection: PromptSection = {
          id: `history-${i}`,
          type: 'history',
          content: optimizedContent,
          tokens: estimateTokens(fullContent, provider), // Use original for accurate token count
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

    // Tool call sections with memory optimization
    if (options.toolCalls && options.toolCalls.length > 0) {
      for (let i = 0; i < options.toolCalls.length; i++) {
        const tool = options.toolCalls[i];
        const fullContent = `Tool: ${tool.name}\nArguments: ${tool.arguments}`;
        const optimizedContent = this.optimizeContentForMemory(fullContent);
        
        const toolSection: PromptSection = {
          id: `tool-${i}`,
          type: 'tool',
          content: optimizedContent,
          tokens: estimateTokens(fullContent, provider), // Use original for accurate token count
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

    // Metadata section with memory optimization
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      const metadataStr = JSON.stringify(options.metadata);
      const optimizedContent = this.optimizeContentForMemory(metadataStr);
      
      const metadataSection: PromptSection = {
        id: 'metadata',
        type: 'metadata',
        content: optimizedContent,
        tokens: estimateTokens(metadataStr, provider), // Use original for accurate token count
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

  // Solution 3: Optimized batch token attribution calculation
  private async calculateTokenAttributionOptimized(
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

    // Batch process all section costs in parallel
    const sectionCosts = await Promise.all(
      sections.map(section => 
        this.calculateSectionCost(section.tokens, provider, model, modelPricing)
      )
    );

    // Apply costs and calculate attribution in a single pass
    sections.forEach((section, index) => {
      const cost = sectionCosts[index];
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
    });

    return attribution;
  }

  // Keep original method for backward compatibility
  private async calculateTokenAttribution(
    sections: PromptSection[],
    provider: AIProvider,
    model: string,
    modelPricing: any
  ): Promise<TokenAttribution> {
    return this.calculateTokenAttributionOptimized(sections, provider, model, modelPricing);
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
      loggingService.warn(`Failed to calculate cost using pricing system for ${provider}/${model}, using fallback:`, { error: error instanceof Error ? error.message : String(error) });
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
    try {
      // Use AI-powered optimization analysis for better suggestions
      const aiOptimizations = await this.performAIOptimizationAnalysis(sections, provider, model);
      return aiOptimizations;
    } catch (error) {
      loggingService.warn('AI optimization analysis failed, falling back to heuristic analysis:', { error: error instanceof Error ? error.message : String(error) });
      return this.fallbackOptimizationAnalysis(sections, provider, model);
    }
  }

  private async performAIOptimizationAnalysis(
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
    try {
      const optimizationPrompt = this.buildOptimizationAnalysisPrompt(sections, provider, model);
      const aiResponse = await BedrockService.invokeModel(optimizationPrompt, 'anthropic.claude-3-5-haiku-20241022-v1:0');
      
      const optimizations = this.parseOptimizationSuggestions(aiResponse);
      
      // Update section optimization suggestions
      for (const section of sections) {
        section.optimizationSuggestions = optimizations.sectionSuggestions[section.id] || [];
      }
      
      loggingService.info('AI optimization analysis completed successfully', { value:  {  optimizations  } });
      return optimizations;
      
    } catch (error) {
      loggingService.error('AI optimization analysis failed:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private buildOptimizationAnalysisPrompt(
    sections: PromptSection[],
    provider: AIProvider,
    model: string
  ): string {
    const systemPrompt = `You are an expert AI prompt optimization analyst. Analyze the given prompt sections and provide specific optimization suggestions to reduce token usage and improve cost efficiency.

Provider: ${provider}
Model: ${model}

Prompt Sections:
${sections.map(section => `
**${section.id} (${section.type})**: ${section.content}
Tokens: ${section.tokens}
Cost: $${section.cost.toFixed(6)}
`).join('\n')}

Analyze each section and provide optimization suggestions. Focus on:
1. Removing redundant or unnecessary content
2. Simplifying complex instructions
3. Consolidating similar information
4. Improving clarity while reducing length

Provide your response as a valid JSON object with this exact format:
{
  "highImpact": [
    "Remove redundant system instructions → Save 35% on system prompt tokens",
    "Consolidate multiple examples into one comprehensive example → Save 40% on user message"
  ],
  "mediumImpact": [
    "Simplify verbose language → Save 25% on instruction clarity",
    "Remove duplicate context references → Save 20% on conversation history"
  ],
  "lowImpact": [
    "Optimize metadata structure → Save 15% on metadata tokens",
    "Streamline tool call arguments → Save 10% on tool section"
  ],
  "estimatedSavings": 0.000015,
  "confidence": 0.88,
  "sectionSuggestions": {
    "system-prompt": ["Compress system instructions → Save 30%"],
    "user-message": ["Break down complex request → Save 25%"],
    "history-0": ["Summarize older messages → Save 40%"]
  }
}

Scoring Guidelines:
- High Impact: 25-40% token reduction potential
- Medium Impact: 15-25% token reduction potential  
- Low Impact: 5-15% token reduction potential

Be specific about what to change and estimated savings.`;

    return systemPrompt;
  }

  private parseOptimizationSuggestions(aiResponse: string): {
    highImpact: string[];
    mediumImpact: string[];
    lowImpact: string[];
    estimatedSavings: number;
    confidence: number;
    sectionSuggestions: Record<string, string[]>;
  } {
    try {
      const jsonResponse = BedrockService.extractJson(aiResponse);
      const parsed = JSON.parse(jsonResponse);
      
      return {
        highImpact: Array.isArray(parsed.highImpact) ? parsed.highImpact : [],
        mediumImpact: Array.isArray(parsed.mediumImpact) ? parsed.mediumImpact : [],
        lowImpact: Array.isArray(parsed.lowImpact) ? parsed.lowImpact : [],
        estimatedSavings: Number(parsed.estimatedSavings) || 0,
        confidence: Number(parsed.confidence) || 0.85,
        sectionSuggestions: parsed.sectionSuggestions || {}
      };
    } catch (error) {
      loggingService.error('Failed to parse AI optimization suggestions:', { error: error instanceof Error ? error.message : String(error) });
      return {
        highImpact: [],
        mediumImpact: [],
        lowImpact: [],
        estimatedSavings: 0,
        confidence: 0.85,
        sectionSuggestions: {}
      };
    }
  }

  private async fallbackOptimizationAnalysis(
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
    provider: AIProvider,
    model: string
  ): Promise<{
    instructionClarity: number;
    contextRelevance: number;
    exampleEfficiency: number;
    overallScore: number;
  }> {
    loggingService.info('🔍 Starting quality assessment', { value:  {  
      sectionsCount: sections.length, 
      provider, 
      model 
     } });
    
    try {
      // Use AI-powered quality assessment for better accuracy
      loggingService.info('🤖 Attempting AI-powered quality analysis...');
      const qualityAnalysis = await this.performAIQualityAnalysis(sections, provider, model);
      loggingService.info('✅ AI quality analysis completed successfully', { value:  {  qualityAnalysis  } });
      return qualityAnalysis;
    } catch (error) {
      loggingService.error('❌ AI quality analysis failed with error:', { error: error instanceof Error ? error.message : String(error) });
      loggingService.warn('⚠️ Falling back to heuristic scoring');
      const fallbackScores = this.fallbackQualityAssessment(sections);
      loggingService.info('🔄 Using fallback quality scores', { value:  {  fallbackScores  } });
      return fallbackScores;
    }
  }

  private async performAIQualityAnalysis(
    sections: PromptSection[],
    provider: AIProvider,
    model: string
  ): Promise<{
    instructionClarity: number;
    contextRelevance: number;
    exampleEfficiency: number;
    overallScore: number;
  }> {
    try {
      // Prepare the prompt for AI analysis
      const analysisPrompt = this.buildQualityAnalysisPrompt(sections);
      
      loggingService.info('🚀 Starting AI quality analysis', { value:  {  
        sectionsCount: sections.length, 
        promptLength: analysisPrompt.length,
        provider,
        model
       } });
      
      // Use Bedrock service for AI-powered analysis - use a more cost-effective model
      const aiResponse = await BedrockService.invokeModel(analysisPrompt, 'anthropic.claude-3-5-haiku-20241022-v1:0');
      
      loggingService.info('✅ AI quality analysis completed successfully', { 
        responseLength: aiResponse.length,
        responsePreview: aiResponse.substring(0, 200) + '...'
      });
      
      // Parse the AI response to extract quality scores
      const qualityScores = this.parseQualityScores(aiResponse);
      
      // Validate that we got meaningful scores
      if (qualityScores.overallScore > 0) {
        loggingService.info('🎯 Quality scores parsed successfully', { value:  {  qualityScores  } });
        return qualityScores;
      } else {
        loggingService.warn('⚠️ AI returned zero scores, falling back to heuristic analysis');
        return this.fallbackQualityAssessment(sections);
      }
      
    } catch (error) {
      loggingService.warn('⚠️ AI quality analysis failed, falling back to heuristic scoring', { 
        error: error instanceof Error ? error.message : String(error),
        provider,
        model
      });
      
      // Fallback to heuristic scoring instead of throwing
      return this.fallbackQualityAssessment(sections);
    }
  }

  private buildQualityAnalysisPrompt(sections: PromptSection[]): string {
    const systemPrompt = `You are an expert AI prompt quality analyst. Analyze the given prompt sections and provide quality scores on a scale of 0-100 for each metric.

Please evaluate the following prompt sections and provide scores for:

1. **Instruction Clarity (0-100)**: How clear, specific, and actionable the instructions are
2. **Context Relevance (0-100)**: How relevant and necessary the provided context is
3. **Example Efficiency (0-100)**: How well examples illustrate the requirements without being redundant
4. **Overall Score (0-100)**: Weighted average considering all factors

Prompt Sections:
${sections.map(section => `
**${section.type.toUpperCase()}**: ${section.content}
`).join('\n')}

Provide your response as a valid JSON object with this exact format:
{
  "instructionClarity": 85,
  "contextRelevance": 90,
  "exampleEfficiency": 75,
  "overallScore": 83
}

Scoring Guidelines:
- 90-100: Excellent - Clear, concise, well-structured
- 80-89: Good - Clear with minor improvements possible
- 70-79: Fair - Generally clear but could be improved
- 60-69: Poor - Unclear or verbose
- 0-59: Very Poor - Confusing or overly complex

Focus on clarity, conciseness, and effectiveness.`;

    return systemPrompt;
  }

  private parseQualityScores(aiResponse: string): {
    instructionClarity: number;
    contextRelevance: number;
    exampleEfficiency: number;
    overallScore: number;
  } {
    try {
      // Extract JSON from AI response
      const jsonResponse = BedrockService.extractJson(aiResponse);
      const parsed = JSON.parse(jsonResponse);
      
      // Validate and return scores
      return {
        instructionClarity: Math.max(0, Math.min(100, Number(parsed.instructionClarity) || 0)),
        contextRelevance: Math.max(0, Math.min(100, Number(parsed.contextRelevance) || 0)),
        exampleEfficiency: Math.max(0, Math.min(100, Number(parsed.exampleEfficiency) || 0)),
        overallScore: Math.max(0, Math.min(100, Number(parsed.overallScore) || 0))
      };
    } catch (error) {
      loggingService.error('Failed to parse AI quality scores:', { error: error instanceof Error ? error.message : String(error) });
      // Return default scores if parsing fails
      return {
        instructionClarity: 70,
        contextRelevance: 70,
        exampleEfficiency: 70,
        overallScore: 70
      };
    }
  }

  private fallbackQualityAssessment(sections: PromptSection[]): {
    instructionClarity: number;
    contextRelevance: number;
    exampleEfficiency: number;
    overallScore: number;
  } {
    let instructionClarity = 75; // Improved base score
    let contextRelevance = 75;
    let exampleEfficiency = 75;

    for (const section of sections) {
      if (section.type === 'system') {
        instructionClarity = this.scoreInstructionClarity(section.content);
      } else if (section.type === 'history') {
        contextRelevance = this.scoreContextRelevance(section.content);
      } else if (section.type === 'user' && section.content.includes('example')) {
        exampleEfficiency = this.scoreExampleEfficiency(section.content);
      }
    }

    // Ensure we never return 0 scores
    instructionClarity = Math.max(instructionClarity, 60);
    contextRelevance = Math.max(contextRelevance, 60);
    exampleEfficiency = Math.max(exampleEfficiency, 60);

    const overallScore = Math.round((instructionClarity + contextRelevance + exampleEfficiency) / 3);

    loggingService.info('Using fallback quality assessment', { value:  {  
      instructionClarity, 
      contextRelevance, 
      exampleEfficiency, 
      overallScore 
     } });

    return {
      instructionClarity,
      contextRelevance,
      exampleEfficiency,
      overallScore
    };
  }

  private scoreInstructionClarity(content: string): number {
    let score = 75; // Improved base score

    // Positive indicators
    if (content.includes('MUST') || content.includes('REQUIRED')) score += 10;
    if (content.includes('DO NOT') || content.includes('NEVER')) score += 10;
    if (content.includes('format') || content.includes('structure')) score += 8;
    if (content.includes('step') || content.includes('steps')) score += 5;
    if (content.includes('example') || content.includes('examples')) score += 5;
    if (content.length < 200) score += 5;
    if (content.length < 100) score += 10;

    // Negative indicators
    if (content.length > 500) score -= 15;
    if (content.includes('very') || content.includes('really')) score -= 5;
    if (content.includes('please') && content.includes('kindly')) score -= 5;

    return Math.min(100, Math.max(60, score)); // Ensure minimum score of 60
  }

  private scoreContextRelevance(content: string): number {
    let score = 75; // Improved base score

    // Positive indicators
    if (content.includes('relevant') || content.includes('important')) score += 10;
    if (content.includes('recent') || content.includes('latest')) score += 10;
    if (content.includes('current') || content.includes('today')) score += 8;
    if (content.length < 100) score += 10;
    if (content.length < 50) score += 15;

    // Negative indicators
    if (content.includes('similar') || content.includes('same')) score -= 15;
    if (content.includes('duplicate') || content.includes('repeated')) score -= 10;
    if (content.length > 400) score -= 15;
    if (content.includes('as mentioned before') || content.includes('as I said earlier')) score -= 10;

    return Math.min(100, Math.max(60, score)); // Ensure minimum score of 60
  }

  private scoreExampleEfficiency(content: string): number {
    let score = 75; // Improved base score

    const exampleCount = (content.match(/example/gi) || []).length;
    
    // Example count scoring
    if (exampleCount === 1) score += 15;
    if (exampleCount === 2) score += 10;
    if (exampleCount === 3) score += 5;
    if (exampleCount > 3) score -= 20;

    // Positive indicators
    if (content.includes('brief') || content.includes('concise')) score += 10;
    if (content.includes('simple') || content.includes('clear')) score += 8;
    if (content.includes('step-by-step') || content.includes('step by step')) score += 10;

    // Negative indicators
    if (content.includes('detailed') && content.length > 200) score -= 10;
    if (content.includes('verbose') || content.includes('lengthy')) score -= 15;
    if (content.includes('comprehensive') && content.length > 300) score -= 8;

    return Math.min(100, Math.max(60, score)); // Ensure minimum score of 60
  }

  private generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Solution 5: Smart Fallback Strategy with Circuit Breaker
  private async performAnalysisWithFallback<T>(
    aiAnalysis: () => Promise<T>,
    fallback: () => T | Promise<T>
  ): Promise<T> {
    // Check if circuit breaker is open
    if (this.isCircuitBreakerOpen()) {
      loggingService.info('🔴 Circuit breaker is open, using fallback analysis');
      return await fallback();
    }

    try {
      const result = await aiAnalysis();
      this.resetCircuitBreaker(); // Reset on success
      return result;
    } catch (error) {
      this.recordFailure();
      loggingService.warn('⚠️ AI analysis failed, using fallback', { 
        error: error instanceof Error ? error.message : String(error),
        failureCount: this.aiFailureCount
      });
      return await fallback();
    }
  }

  private isCircuitBreakerOpen(): boolean {
    if (this.aiFailureCount < this.MAX_AI_FAILURES) {
      return false;
    }
    
    // Check if enough time has passed to reset the circuit breaker
    if (Date.now() - this.lastFailureTime > this.CIRCUIT_BREAKER_RESET_TIME) {
      this.resetCircuitBreaker();
      return false;
    }
    
    return true;
  }

  private recordFailure(): void {
    this.aiFailureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.aiFailureCount >= this.MAX_AI_FAILURES) {
      loggingService.warn('🔴 Circuit breaker opened due to repeated AI failures', {
        failureCount: this.aiFailureCount,
        resetTime: new Date(Date.now() + this.CIRCUIT_BREAKER_RESET_TIME).toISOString()
      });
    }
  }

  private resetCircuitBreaker(): void {
    if (this.aiFailureCount > 0) {
      loggingService.info('🟢 Circuit breaker reset - AI service recovered', {
        previousFailures: this.aiFailureCount
      });
    }
    this.aiFailureCount = 0;
    this.lastFailureTime = 0;
  }

  // Solution 4: Memory-efficient content processing
  private optimizeContentForMemory(content: string): string {
    // For very large content, truncate but preserve structure
    if (content.length <= this.MAX_SECTION_PREVIEW_SIZE) {
      return content;
    }

    // For large content, create a meaningful preview
    const preview = content.substring(0, this.MAX_SECTION_PREVIEW_SIZE);
    const lastSpaceIndex = preview.lastIndexOf(' ');
    
    // Try to break at word boundary if possible
    if (lastSpaceIndex > this.MAX_SECTION_PREVIEW_SIZE * 0.8) {
      return preview.substring(0, lastSpaceIndex) + '...';
    }
    
    return preview + '...';
  }

  private processLargeContent(content: string): string[] {
    if (content.length <= this.MAX_CONTENT_CHUNK_SIZE) {
      return [content];
    }

    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += this.MAX_CONTENT_CHUNK_SIZE) {
      chunks.push(content.slice(i, i + this.MAX_CONTENT_CHUNK_SIZE));
    }
    return chunks;
  }

  async detectDeadWeight(prompt: string, provider: AIProvider, model: string): Promise<DeadWeightAnalysis> {
    try {
      const analysis = await this.analyzePrompt(prompt, provider, model);
      
      // Use AI-powered dead weight detection for better accuracy
      try {
        const aiDeadWeight = await this.performAIDeadWeightAnalysis(analysis, provider, model);
        return aiDeadWeight;
      } catch (error) {
        loggingService.warn('AI dead weight analysis failed, falling back to heuristic detection:', { error: error instanceof Error ? error.message : String(error) });
        return this.fallbackDeadWeightDetection(analysis);
      }

    } catch (error) {
      loggingService.error('❌ Error detecting dead weight:', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to detect dead weight: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async performAIDeadWeightAnalysis(
    analysis: CostDebuggerAnalysis,
    provider: AIProvider,
    model: string
  ): Promise<DeadWeightAnalysis> {
    try {
      const deadWeightPrompt = this.buildDeadWeightAnalysisPrompt(analysis, provider, model);
      const aiResponse = await BedrockService.invokeModel(deadWeightPrompt, 'anthropic.claude-3-5-haiku-20241022-v1:0');
      
      const deadWeight = this.parseDeadWeightAnalysis(aiResponse);
      
      loggingService.info('AI dead weight analysis completed successfully', { value:  {  deadWeight  } });
      return deadWeight;
      
    } catch (error) {
      loggingService.error('AI dead weight analysis failed:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private buildDeadWeightAnalysisPrompt(
    analysis: CostDebuggerAnalysis,
    provider: AIProvider,
    model: string
  ): string {
    const systemPrompt = `You are an expert AI prompt optimization analyst specializing in detecting "dead weight" - unnecessary, redundant, or verbose content that increases token usage without adding value.

Provider: ${provider}
Model: ${model}
Total Tokens: ${analysis.totalTokens}
Total Cost: $${analysis.totalCost.toFixed(6)}

Prompt Sections:
${analysis.sections.map(section => `
**${section.id} (${section.type})**: ${section.content}
Tokens: ${section.tokens}
Cost: $${section.cost.toFixed(6)}
`).join('\n')}

Analyze each section and identify dead weight in these categories:

1. **Redundant Instructions**: Repeated or unnecessary instructions
2. **Unnecessary Examples**: Examples that don't add value or are too verbose
3. **Verbose Phrasing**: Overly wordy or complex language
4. **Duplicate Context**: Repeated information across sections

Provide your response as a valid JSON object with this exact format:
{
  "redundantInstructions": [
    "System prompt contains redundant role definitions that are already clear from context",
    "User message repeats the same request in different words"
  ],
  "unnecessaryExamples": [
    "Multiple similar examples that could be consolidated into one comprehensive example",
    "Example is too detailed and doesn't match the complexity of the actual request"
  ],
  "verbosePhrasing": [
    "Uses 'very' and 'really' qualifiers that don't add meaning",
    "Overly formal language that could be simplified"
  ],
  "duplicateContext": [
    "Conversation history repeats information already in the user message",
    "Metadata contains redundant timestamp information"
  ],
  "estimatedSavings": 0.000012,
  "confidence": 0.92
}

Focus on identifying content that can be removed or simplified without losing the prompt's effectiveness.`;

    return systemPrompt;
  }

  private parseDeadWeightAnalysis(aiResponse: string): DeadWeightAnalysis {
    try {
      const jsonResponse = BedrockService.extractJson(aiResponse);
      const parsed = JSON.parse(jsonResponse);
      
      return {
        redundantInstructions: Array.isArray(parsed.redundantInstructions) ? parsed.redundantInstructions : [],
        unnecessaryExamples: Array.isArray(parsed.unnecessaryExamples) ? parsed.unnecessaryExamples : [],
        verbosePhrasing: Array.isArray(parsed.verbosePhrasing) ? parsed.verbosePhrasing : [],
        duplicateContext: Array.isArray(parsed.duplicateContext) ? parsed.duplicateContext : [],
        estimatedSavings: Number(parsed.estimatedSavings) || 0,
        confidence: Number(parsed.confidence) || 0.85
      };
    } catch (error) {
      loggingService.error('Failed to parse AI dead weight analysis:', { error: error instanceof Error ? error.message : String(error) });
      return {
        redundantInstructions: [],
        unnecessaryExamples: [],
        verbosePhrasing: [],
        duplicateContext: [],
        estimatedSavings: 0,
        confidence: 0.85
      };
    }
  }

  private fallbackDeadWeightDetection(analysis: CostDebuggerAnalysis): DeadWeightAnalysis {
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
      aiInsights: string[];
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

      // Get AI-powered insights on the comparison
      let aiInsights: string[] = [];
      try {
        aiInsights = await this.getAIComparisonInsights(originalAnalysis, optimizedAnalysis, provider, model);
      } catch (error) {
        loggingService.warn('AI comparison insights failed, using basic analysis:', { error: error instanceof Error ? error.message : String(error) });
        aiInsights = this.generateBasicComparisonInsights(originalAnalysis, optimizedAnalysis);
      }

      return {
        originalAnalysis,
        optimizedAnalysis,
        improvements: {
          tokensSaved,
          costSaved,
          savingsPercentage,
          qualityImpact,
          aiInsights
        }
      };

    } catch (error) {
      loggingService.error('❌ Error comparing prompt versions:', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to compare prompt versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getAIComparisonInsights(
    originalAnalysis: CostDebuggerAnalysis,
    optimizedAnalysis: CostDebuggerAnalysis,
    provider: AIProvider,
    model: string
  ): Promise<string[]> {
    try {
      const comparisonPrompt = this.buildComparisonAnalysisPrompt(originalAnalysis, optimizedAnalysis, provider, model);
      const aiResponse = await BedrockService.invokeModel(comparisonPrompt, 'anthropic.claude-3-5-haiku-20241022-v1:0');
      
      const insights = this.parseComparisonInsights(aiResponse);
      
      loggingService.info('AI comparison insights generated successfully', { value:  {  insights  } });
      return insights;
      
    } catch (error) {
      loggingService.error('AI comparison insights failed:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private buildComparisonAnalysisPrompt(
    originalAnalysis: CostDebuggerAnalysis,
    optimizedAnalysis: CostDebuggerAnalysis,
    provider: AIProvider,
    model: string
  ): string {
    const systemPrompt = `You are an expert AI prompt optimization analyst. Compare the original and optimized prompt versions and provide specific insights about the improvements made.

Provider: ${provider}
Model: ${model}

**ORIGINAL PROMPT ANALYSIS:**
- Total Tokens: ${originalAnalysis.totalTokens}
- Total Cost: $${originalAnalysis.totalCost.toFixed(6)}
- Quality Score: ${originalAnalysis.qualityMetrics.overallScore}/100
- Sections: ${originalAnalysis.sections.map(s => `${s.type}(${s.tokens})`).join(', ')}

**OPTIMIZED PROMPT ANALYSIS:**
- Total Tokens: ${optimizedAnalysis.totalTokens}
- Total Cost: $${optimizedAnalysis.totalCost.toFixed(6)}
- Quality Score: ${optimizedAnalysis.qualityMetrics.overallScore}/100
- Sections: ${optimizedAnalysis.sections.map(s => `${s.type}(${s.tokens})`).join(', ')}

**IMPROVEMENTS:**
- Tokens Saved: ${originalAnalysis.totalTokens - optimizedAnalysis.totalTokens}
- Cost Saved: $${(originalAnalysis.totalCost - optimizedAnalysis.totalCost).toFixed(6)}
- Quality Impact: ${optimizedAnalysis.qualityMetrics.overallScore - originalAnalysis.qualityMetrics.overallScore}

Provide 3-5 specific insights about what was optimized and how it improves the prompt. Focus on:
1. Specific changes that led to token reduction
2. Quality improvements or potential concerns
3. Cost-effectiveness of the optimization
4. Areas that could still be improved

Provide your response as a valid JSON array of strings:
[
  "Removed redundant system instructions, saving 15 tokens while maintaining clarity",
  "Consolidated multiple examples into one comprehensive example, reducing user message by 25%",
  "Simplified verbose language in conversation history, improving readability",
  "Quality score improved by 8 points due to better instruction clarity",
  "Cost reduction of $0.000008 represents 40% savings with no quality loss"
]

Be specific about what changed and the impact of those changes.`;

    return systemPrompt;
  }

  private parseComparisonInsights(aiResponse: string): string[] {
    try {
      const jsonResponse = BedrockService.extractJson(aiResponse);
      const parsed = JSON.parse(jsonResponse);
      
      if (Array.isArray(parsed)) {
        return parsed.filter(insight => typeof insight === 'string');
      }
      
      return [];
    } catch (error) {
      loggingService.error('Failed to parse AI comparison insights:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  private generateBasicComparisonInsights(
    originalAnalysis: CostDebuggerAnalysis,
    optimizedAnalysis: CostDebuggerAnalysis
  ): string[] {
    const insights: string[] = [];
    
    const tokensSaved = originalAnalysis.totalTokens - optimizedAnalysis.totalTokens;
    const costSaved = originalAnalysis.totalCost - optimizedAnalysis.totalCost;
    const qualityImpact = optimizedAnalysis.qualityMetrics.overallScore - originalAnalysis.qualityMetrics.overallScore;
    
    if (tokensSaved > 0) {
      insights.push(`Reduced tokens from ${originalAnalysis.totalTokens} to ${optimizedAnalysis.totalTokens} (${tokensSaved} saved)`);
    }
    
    if (costSaved > 0) {
      insights.push(`Cost reduced from $${originalAnalysis.totalCost.toFixed(6)} to $${optimizedAnalysis.totalCost.toFixed(6)}`);
    }
    
    if (qualityImpact > 0) {
      insights.push(`Quality improved from ${originalAnalysis.qualityMetrics.overallScore}/100 to ${optimizedAnalysis.qualityMetrics.overallScore}/100`);
    } else if (qualityImpact < 0) {
      insights.push(`Quality decreased from ${originalAnalysis.qualityMetrics.overallScore}/100 to ${optimizedAnalysis.qualityMetrics.overallScore}/100`);
    }
    
    return insights;
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
            loggingService.warn(`Failed to analyze for ${provider}/${model}:`, { error: error instanceof Error ? error.message : String(error) });
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
      loggingService.error('❌ Error getting provider comparison:', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to get provider comparison: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const costDebuggerService = new CostDebuggerService();
