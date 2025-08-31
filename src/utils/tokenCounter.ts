import { AIProvider } from '../types/aiCostTracker.types';
import { MODEL_PRICING, ModelPricing } from './pricing';

/**
 * Simple token estimation for text
 * This is a basic implementation - in production you might want to use tiktoken or similar
 */
export function estimateTokens(text: string, provider: AIProvider = AIProvider.OpenAI): number {
    if (!text || typeof text !== 'string') {
        return 0;
    }

    // Basic token estimation based on character count and word count
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;

    // Different providers have different tokenization patterns
    switch (provider) {
        case AIProvider.OpenAI:
        case AIProvider.Azure:
            // OpenAI models typically have ~4 characters per token
            // But this varies significantly based on content
            return Math.max(Math.ceil(charCount / 4), Math.ceil(wordCount * 1.3));

        case AIProvider.Anthropic:
        case AIProvider.AWSBedrock:
            // Claude models have similar tokenization to OpenAI
            return Math.max(Math.ceil(charCount / 4), Math.ceil(wordCount * 1.3));

        case AIProvider.Google:
        case AIProvider.Gemini:
            // Google models might have slightly different tokenization
            return Math.max(Math.ceil(charCount / 3.8), Math.ceil(wordCount * 1.4));

        case AIProvider.Cohere:
            // Cohere tokenization
            return Math.max(Math.ceil(charCount / 4.2), Math.ceil(wordCount * 1.2));

        default:
            // Default estimation
            return Math.max(Math.ceil(charCount / 4), Math.ceil(wordCount * 1.3));
    }
}

/**
 * Estimate tokens for a conversation/messages array
 */
export function estimateConversationTokens(
    messages: Array<{ role: string; content: string }>,
    provider: AIProvider = AIProvider.OpenAI
): number {
    let totalTokens = 0;

    for (const message of messages) {
        // Add tokens for the message content
        totalTokens += estimateTokens(message.content, provider);

        // Add tokens for message metadata (role, formatting, etc.)
        // This varies by provider and format
        totalTokens += 4; // Basic overhead per message
    }

    // Add tokens for conversation formatting overhead
    totalTokens += 3; // Basic conversation overhead

    return totalTokens;
}

/**
 * Estimate tokens for a prompt with system message
 */
export function estimatePromptTokens(
    prompt: string,
    systemMessage?: string,
    provider: AIProvider = AIProvider.OpenAI
): number {
    let totalTokens = 0;

    if (systemMessage) {
        totalTokens += estimateTokens(systemMessage, provider);
        totalTokens += 4; // System message overhead
    }

    totalTokens += estimateTokens(prompt, provider);
    totalTokens += 4; // User message overhead

    return totalTokens;
}

/**
 * Calculate token efficiency metrics
 */
export function calculateTokenEfficiency(
    promptTokens: number,
    completionTokens: number,
    actualOutputLength: number
): {
    efficiency: number;
    tokensPerCharacter: number;
    compressionRatio: number;
} {
    const totalTokens = promptTokens + completionTokens;
    const efficiency = actualOutputLength > 0 ? completionTokens / actualOutputLength : 0;
    const tokensPerCharacter = totalTokens / (actualOutputLength || 1);
    const compressionRatio = actualOutputLength > 0 ? actualOutputLength / totalTokens : 0;

    return {
        efficiency,
        tokensPerCharacter,
        compressionRatio
    };
}

/**
 * Estimate completion tokens based on expected output length
 */
export function estimateCompletionTokens(
    expectedOutputLength: number,
    outputType: 'text' | 'code' | 'json' | 'structured' = 'text',
    provider: AIProvider = AIProvider.OpenAI
): number {
    let multiplier = 1;

    // Different content types have different token densities
    switch (outputType) {
        case 'code':
            multiplier = 1.5; // Code typically uses more tokens per character
            break;
        case 'json':
            multiplier = 1.3; // JSON has structural overhead
            break;
        case 'structured':
            multiplier = 1.2; // Structured content has some overhead
            break;
        case 'text':
        default:
            multiplier = 1.0;
            break;
    }

    const baseTokens = estimateTokens('x'.repeat(expectedOutputLength), provider);
    return Math.ceil(baseTokens * multiplier);
}

/**
 * Calculate token usage statistics
 */
export function calculateTokenStats(
    usageData: Array<{
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    }>
): {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    averagePromptTokens: number;
    averageCompletionTokens: number;
    averageTotalTokens: number;
    promptToCompletionRatio: number;
} {
    const totalPromptTokens = usageData.reduce((sum, usage) => sum + usage.promptTokens, 0);
    const totalCompletionTokens = usageData.reduce((sum, usage) => sum + usage.completionTokens, 0);
    const totalTokens = usageData.reduce((sum, usage) => sum + usage.totalTokens, 0);

    const count = usageData.length || 1;

    return {
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        averagePromptTokens: totalPromptTokens / count,
        averageCompletionTokens: totalCompletionTokens / count,
        averageTotalTokens: totalTokens / count,
        promptToCompletionRatio: totalCompletionTokens > 0 ? totalPromptTokens / totalCompletionTokens : 0
    };
}

/**
 * Detect if text contains special tokens or formatting
 */
export function detectSpecialContent(text: string): {
    hasCode: boolean;
    hasJson: boolean;
    hasMarkdown: boolean;
    hasUrls: boolean;
    specialTokenCount: number;
} {
    const codeRegex = /```[\s\S]*?```|`[^`]+`/g;
    const jsonRegex = /\{[\s\S]*?\}|\[[\s\S]*?\]/g;
    const markdownRegex = /#{1,6}\s|[*_]{1,3}[^*_]+[*_]{1,3}|\[([^\]]+)\]\(([^)]+)\)/g;
    const urlRegex = /https?:\/\/[^\s]+/g;

    const hasCode = codeRegex.test(text);
    const hasJson = jsonRegex.test(text);
    const hasMarkdown = markdownRegex.test(text);
    const hasUrls = urlRegex.test(text);

    // Count special tokens (rough estimation)
    let specialTokenCount = 0;
    if (hasCode) specialTokenCount += (text.match(codeRegex) || []).length * 2;
    if (hasJson) specialTokenCount += (text.match(jsonRegex) || []).length * 1.5;
    if (hasMarkdown) specialTokenCount += (text.match(markdownRegex) || []).length * 1.2;
    if (hasUrls) specialTokenCount += (text.match(urlRegex) || []).length * 1.1;

    return {
        hasCode,
        hasJson,
        hasMarkdown,
        hasUrls,
        specialTokenCount
    };
}

/**
 * Optimize token usage by suggesting content modifications
 */
export function suggestTokenOptimizations(
    text: string,
    maxTokens: number,
    provider: AIProvider = AIProvider.OpenAI
): {
    currentTokens: number;
    needsOptimization: boolean;
    suggestions: string[];
    optimizedText?: string;
} {
    const currentTokens = estimateTokens(text, provider);
    const needsOptimization = currentTokens > maxTokens;
    const suggestions: string[] = [];

    if (!needsOptimization) {
        return {
            currentTokens,
            needsOptimization: false,
            suggestions: []
        };
    }

    // Analyze content for optimization opportunities
    const specialContent = detectSpecialContent(text);

    if (text.length > 1000) {
        suggestions.push('Consider breaking down the text into smaller chunks');
    }

    if (specialContent.hasCode) {
        suggestions.push('Code blocks can be compressed or referenced externally');
    }

    if (specialContent.hasJson) {
        suggestions.push('JSON structures can be minified or simplified');
    }

    if (text.includes('\n\n\n')) {
        suggestions.push('Remove excessive whitespace and line breaks');
    }

    if (text.match(/\b(very|really|quite|somewhat|rather|pretty|fairly)\b/gi)) {
        suggestions.push('Remove unnecessary qualifiers and filler words');
    }

    // Simple optimization attempt
    let optimizedText = text;
    if (suggestions.length > 0) {
        optimizedText = text
            .replace(/\n\n\n+/g, '\n\n') // Remove excessive line breaks
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/\b(very|really|quite|somewhat|rather|pretty|fairly)\s+/gi, '') // Remove qualifiers
            .trim();
    }

    return {
        currentTokens,
        needsOptimization,
        suggestions,
        optimizedText: optimizedText !== text ? optimizedText : undefined
    };
}

/**
 * Calculate token budget distribution
 */
export function calculateTokenBudget(
    maxTokens: number,
    promptTokens: number,
    bufferPercentage: number = 0.1
): {
    availableForCompletion: number;
    recommendedCompletion: number;
    buffer: number;
    utilizationPercentage: number;
} {
    const buffer = Math.ceil(maxTokens * bufferPercentage);
    const availableForCompletion = maxTokens - promptTokens - buffer;
    const recommendedCompletion = Math.max(0, Math.floor(availableForCompletion * 0.8));
    const utilizationPercentage = (promptTokens / maxTokens) * 100;

    return {
        availableForCompletion: Math.max(0, availableForCompletion),
        recommendedCompletion,
        buffer,
        utilizationPercentage
    };
}

/**
 * Get context window limits and pricing information for models
 */
export function getContextWindowLimits(provider: AIProvider, model: string): number {
    // First try to find exact model match
    const exactMatch = MODEL_PRICING.find(p => 
        p.modelId.toLowerCase() === model.toLowerCase() ||
        p.modelName.toLowerCase() === model.toLowerCase()
    );
    
    if (exactMatch?.contextWindow) {
        return exactMatch.contextWindow;
    }
    
    // Try partial matching for common model patterns
    const partialMatch = MODEL_PRICING.find(p => 
        p.modelId.toLowerCase().includes(model.toLowerCase()) ||
        p.modelName.toLowerCase().includes(model.toLowerCase())
    );
    
    if (partialMatch?.contextWindow) {
        return partialMatch.contextWindow;
    }
    
    // Fallback to default based on provider
    const defaultLimits: Record<AIProvider, number> = {
        [AIProvider.OpenAI]: 4096,
        [AIProvider.Azure]: 4096,
        [AIProvider.Anthropic]: 200000,
        [AIProvider.AWSBedrock]: 200000,
        [AIProvider.Google]: 30720,
        [AIProvider.Gemini]: 30720,
        [AIProvider.Cohere]: 4096,
        [AIProvider.DeepSeek]: 8192,
        [AIProvider.Groq]: 8192,
        [AIProvider.HuggingFace]: 4096,
        [AIProvider.Ollama]: 4096,
        [AIProvider.Replicate]: 4096
    };
    
    return defaultLimits[provider] || 4096;
}

/**
 * Get model pricing information from the pricing database
 */
export function getModelPricingInfo(model: string): ModelPricing | undefined {
    // First try to find exact model match
    const exactMatch = MODEL_PRICING.find(p => 
        p.modelId.toLowerCase() === model.toLowerCase() ||
        p.modelName.toLowerCase() === model.toLowerCase()
    );
    
    if (exactMatch) {
        return exactMatch;
    }
    
    // Try partial matching for common model patterns
    const partialMatch = MODEL_PRICING.find(p => 
        p.modelId.toLowerCase().includes(model.toLowerCase()) ||
        p.modelName.toLowerCase().includes(model.toLowerCase())
    );
    
    return partialMatch;
}

/**
 * Get all available models for a specific provider
 */
export function getProviderModels(provider: AIProvider): ModelPricing[] {
    const providerName = provider.toLowerCase();
    return MODEL_PRICING.filter(p => 
        p.provider.toLowerCase() === providerName ||
        p.provider.toLowerCase().includes(providerName)
    );
}

/**
 * Get models by capability (e.g., 'vision', 'reasoning', 'multimodal')
 */
export function getModelsByCapability(capability: string): ModelPricing[] {
    return MODEL_PRICING.filter(p => 
        p.capabilities?.some(cap => 
            cap.toLowerCase().includes(capability.toLowerCase())
        )
    );
}

/**
 * Get models by category (e.g., 'text', 'vision', 'code')
 */
export function getModelsByCategory(category: string): ModelPricing[] {
    return MODEL_PRICING.filter(p => 
        p.category?.toLowerCase() === category.toLowerCase()
    );
}

/**
 * Get latest models for each provider
 */
export function getLatestModels(): ModelPricing[] {
    return MODEL_PRICING.filter(p => p.isLatest === true);
}

/**
 * Calculate estimated cost for a model based on token usage
 */
export function calculateEstimatedCost(
    model: string,
    promptTokens: number,
    completionTokens: number
): { promptCost: number; completionCost: number; totalCost: number; currency: string } | null {
    const pricing = getModelPricingInfo(model);
    
    if (!pricing) {
        return null;
    }
    
    let promptCost = 0;
    let completionCost = 0;
    
    // Convert pricing to per-token cost based on unit
    if (pricing.unit === 'PER_1M_TOKENS') {
        promptCost = (promptTokens / 1_000_000) * pricing.inputPrice;
        completionCost = (completionTokens / 1_000_000) * pricing.outputPrice;
    } else if (pricing.unit === 'PER_1K_TOKENS') {
        promptCost = (promptTokens / 1_000) * pricing.inputPrice;
        completionCost = (completionTokens / 1_000) * pricing.outputPrice;
    } else {
        // For per-request pricing, assume average token usage
        const totalTokens = promptTokens + completionTokens;
        const avgTokensPerRequest = 1000; // Default assumption
        const costPerRequest = pricing.inputPrice; // Use inputPrice as cost per request
        
        if (totalTokens > 0) {
            promptCost = (promptTokens / avgTokensPerRequest) * costPerRequest;
            completionCost = (completionTokens / avgTokensPerRequest) * costPerRequest;
        }
    }
    
    return {
        promptCost: Number(promptCost.toFixed(6)),
        completionCost: Number(completionCost.toFixed(6)),
        totalCost: Number((promptCost + completionCost).toFixed(6)),
        currency: 'USD'
    };
}

/**
 * Validate token usage against model limits and provide cost insights
 */
export function validateTokenUsage(
    provider: AIProvider,
    model: string,
    promptTokens: number,
    expectedCompletionTokens: number = 150
): {
    isValid: boolean;
    totalTokens: number;
    maxTokens: number;
    utilizationPercentage: number;
    warnings: string[];
    costEstimate?: { promptCost: number; completionCost: number; totalCost: number; currency: string };
    modelInfo?: ModelPricing;
} {
    const maxTokens = getContextWindowLimits(provider, model);
    const totalTokens = promptTokens + expectedCompletionTokens;
    const utilizationPercentage = (totalTokens / maxTokens) * 100;
    const warnings: string[] = [];
    
    // Get model pricing information
    const modelInfo = getModelPricingInfo(model);
    const costEstimate = modelInfo ? calculateEstimatedCost(model, promptTokens, expectedCompletionTokens) || undefined : undefined;

    if (totalTokens > maxTokens) {
        warnings.push(`Total tokens (${totalTokens}) exceed model limit (${maxTokens})`);
    }

    if (utilizationPercentage > 90) {
        warnings.push(`High token utilization (${utilizationPercentage.toFixed(1)}%)`);
    }

    if (promptTokens > maxTokens * 0.8) {
        warnings.push(`Prompt tokens are very high (${promptTokens}), leaving little room for completion`);
    }
    
    // Add cost-related warnings if pricing is available
    if (costEstimate && costEstimate.totalCost > 0.01) {
        warnings.push(`Estimated cost: $${costEstimate.totalCost.toFixed(4)} (prompt: $${costEstimate.promptCost.toFixed(4)}, completion: $${costEstimate.completionCost.toFixed(4)})`);
    }

    return {
        isValid: totalTokens <= maxTokens,
        totalTokens,
        maxTokens,
        utilizationPercentage,
        warnings,
        costEstimate,
        modelInfo
    };
}

/**
 * Find cost-effective alternatives for a given model and use case
 */
export function findCostEffectiveAlternatives(
    currentModel: string,
    promptTokens: number,
    completionTokens: number,
    maxBudget?: number
): {
    alternatives: ModelPricing[];
    currentCost: number;
    potentialSavings: number;
    recommendations: string[];
} {
    const currentPricing = getModelPricingInfo(currentModel);
    if (!currentPricing) {
        return {
            alternatives: [],
            currentCost: 0,
            potentialSavings: 0,
            recommendations: []
        };
    }
    
    const currentCost = calculateEstimatedCost(currentModel, promptTokens, completionTokens);
    if (!currentCost) {
        return {
            alternatives: [],
            currentCost: 0,
            potentialSavings: 0,
            recommendations: []
        };
    }
    
    // Find models with similar capabilities but lower cost
    const alternatives = MODEL_PRICING.filter(p => {
        // Skip the current model
        if (p.modelId === currentModel || p.modelName === currentModel) {
            return false;
        }
        
        // Check if model has similar capabilities
        const hasSimilarCapabilities = currentPricing.capabilities?.some((cap: string) => 
            p.capabilities?.includes(cap)
        ) || false;
        
        // Check if model has sufficient context window
        const hasSufficientContext = p.contextWindow && p.contextWindow >= (promptTokens + completionTokens);
        
        // Check if model meets budget constraints
        const alternativeCost = calculateEstimatedCost(p.modelId, promptTokens, completionTokens);
        const meetsBudget = !maxBudget || !alternativeCost || alternativeCost.totalCost <= maxBudget;
        
        return hasSimilarCapabilities && hasSufficientContext && meetsBudget;
    });
    
    // Sort by cost (lowest first)
    alternatives.sort((a, b) => {
        const costA = calculateEstimatedCost(a.modelId, promptTokens, completionTokens);
        const costB = calculateEstimatedCost(b.modelId, promptTokens, completionTokens);
        
        if (!costA && !costB) return 0;
        if (!costA) return 1;
        if (!costB) return -1;
        
        return costA.totalCost - costB.totalCost;
    });
    
    // Calculate potential savings
    const bestAlternative = alternatives[0];
    const bestAlternativeCost = bestAlternative ? calculateEstimatedCost(bestAlternative.modelId, promptTokens, completionTokens) : null;
    const potentialSavings = bestAlternativeCost ? currentCost.totalCost - bestAlternativeCost.totalCost : 0;
    
    // Generate recommendations
    const recommendations: string[] = [];
    if (bestAlternative && potentialSavings > 0) {
        recommendations.push(`Consider switching to ${bestAlternative.modelName} for potential savings of $${potentialSavings.toFixed(4)} per request`);
        
        if (bestAlternative.isLatest) {
            recommendations.push(`${bestAlternative.modelName} is the latest model with improved capabilities`);
        }
        
        if (bestAlternative.capabilities?.includes('vision') && !currentPricing.capabilities?.includes('vision')) {
            recommendations.push(`${bestAlternative.modelName} adds vision capabilities`);
        }
    }
    
    return {
        alternatives: alternatives.slice(0, 5), // Top 5 alternatives
        currentCost: currentCost.totalCost,
        potentialSavings,
        recommendations
    };
} 