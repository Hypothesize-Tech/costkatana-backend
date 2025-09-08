import { AIProvider } from '../types/aiCostTracker.types';
import { MODEL_PRICING, ModelPricing } from './pricing';
import { loggingService } from '../services/logging.service';

// Import tokenization libraries
let tiktoken: any = null;
let gpt3Encoder: any = null;

// Initialize tokenizers on first use
async function initializeTokenizers() {
    try {
        if (!tiktoken) {
            tiktoken = await import('tiktoken');
        }
        if (!gpt3Encoder) {
            gpt3Encoder = await import('gpt-3-encoder');
        }
    } catch (error) {
        loggingService.warn('Failed to initialize tokenizers, falling back to estimation', {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

/**
 * Synchronous token estimation with provider-specific improvements
 */
export function estimateTokens(text: string, provider: AIProvider = AIProvider.OpenAI, model?: string): number {
    if (!text || typeof text !== 'string') {
        return 0;
    }

    try {
        switch (provider) {
            case AIProvider.OpenAI:
            case AIProvider.Azure:
                return estimateOpenAITokensSync(text, model);

            case AIProvider.Anthropic:
                return estimateAnthropicTokensSync(text, model);

            case AIProvider.AWSBedrock:
                return estimateBedrockTokensSync(text, model);

            case AIProvider.Google:
            case AIProvider.Gemini:
                return estimateGoogleTokensSync(text, model);

            case AIProvider.Cohere:
                return estimateCohereTokensSync(text, model);

            default:
                return estimateFallbackTokens(text);
        }
    } catch (error) {
        loggingService.warn('Token estimation failed, using fallback', {
            provider,
            model,
            error: error instanceof Error ? error.message : String(error)
        });
        return estimateFallbackTokens(text);
    }
}

/**
 * Async token estimation with provider-specific tokenization libraries (for high accuracy)
 */
export async function estimateTokensAsync(text: string, provider: AIProvider = AIProvider.OpenAI, model?: string): Promise<number> {
    if (!text || typeof text !== 'string') {
        return 0;
    }

    // Initialize tokenizers if not already done
    await initializeTokenizers();

    try {
        switch (provider) {
            case AIProvider.OpenAI:
            case AIProvider.Azure:
                return await estimateOpenAITokens(text, model);

            case AIProvider.Anthropic:
                return await estimateAnthropicTokens(text, model);

            case AIProvider.AWSBedrock:
                return await estimateBedrockTokens(text, model);

            case AIProvider.Google:
            case AIProvider.Gemini:
                return await estimateGoogleTokens(text, model);

            case AIProvider.Cohere:
                return await estimateCohereTokens(text, model);

            default:
                return estimateFallbackTokens(text);
        }
    } catch (error) {
        loggingService.warn('Token estimation failed, using fallback', {
            provider,
            model,
            error: error instanceof Error ? error.message : String(error)
        });
        return estimateFallbackTokens(text);
    }
}

/**
 * Accurate OpenAI tokenization using tiktoken
 */
async function estimateOpenAITokens(text: string, model?: string): Promise<number> {
    if (!tiktoken) {
        return estimateFallbackTokens(text);
    }

    try {
        // Map model to encoding
        let encoding;
        if (!model) {
            encoding = tiktoken.get_encoding('cl100k_base'); // Default for GPT-4/GPT-3.5-turbo
        } else if (model.includes('gpt-4') || model.includes('gpt-3.5-turbo')) {
            encoding = tiktoken.get_encoding('cl100k_base');
        } else if (model.includes('gpt-3') || model.includes('davinci') || model.includes('curie') || model.includes('babbage') || model.includes('ada')) {
            encoding = tiktoken.get_encoding('p50k_base');
        } else if (model.includes('code')) {
            encoding = tiktoken.get_encoding('p50k_base');
        } else {
            encoding = tiktoken.get_encoding('cl100k_base'); // Default
        }

        const tokens = encoding.encode(text);
        encoding.free(); // Free memory
        return tokens.length;
    } catch (error) {
        loggingService.warn('TikToken encoding failed, using GPT-3 encoder fallback', { error });
        
        // Fallback to gpt-3-encoder
        if (gpt3Encoder) {
            try {
                return gpt3Encoder.encode(text).length;
            } catch (gpt3Error) {
                loggingService.warn('GPT-3 encoder also failed', { gpt3Error });
            }
        }
        
        return estimateFallbackTokens(text);
    }
}

/**
 * Anthropic tokenization (Claude models)
 */
async function estimateAnthropicTokens(text: string, model?: string): Promise<number> {
    // Claude models use similar tokenization to GPT models
    // We can use tiktoken as approximation or implement Claude-specific logic
    try {
        if (tiktoken) {
            const encoding = tiktoken.get_encoding('cl100k_base');
            const tokens = encoding.encode(text);
            encoding.free();
            // Claude tokens are roughly 1.1x OpenAI tokens based on empirical testing
            return Math.ceil(tokens.length * 1.1);
        }
    } catch (error) {
        loggingService.warn('Claude tokenization estimation failed', { error });
    }
    
    // Fallback to improved heuristics for Claude
    return estimateClaudeFallback(text);
}

/**
 * AWS Bedrock tokenization (depends on underlying model)
 */
async function estimateBedrockTokens(text: string, model?: string): Promise<number> {
    if (!model) {
        return estimateFallbackTokens(text);
    }

    // Route based on underlying model
    if (model.includes('claude')) {
        return estimateAnthropicTokens(text, model);
    } else if (model.includes('titan')) {
        return estimateTitanTokens(text);
    } else if (model.includes('jurassic')) {
        return estimateAI21Tokens(text);
    } else if (model.includes('cohere')) {
        return estimateCohereTokens(text, model);
    }
    
    return estimateFallbackTokens(text);
}

/**
 * Google/Gemini tokenization
 */
async function estimateGoogleTokens(text: string, model?: string): Promise<number> {
    // Google models have different tokenization patterns
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Gemini models tend to be more efficient with tokenization
    const charBasedEstimate = Math.ceil(charCount / 3.5);
    const wordBasedEstimate = Math.ceil(wordCount * 1.2);
    
    return Math.max(charBasedEstimate, wordBasedEstimate);
}

/**
 * Cohere tokenization
 */
async function estimateCohereTokens(text: string, model?: string): Promise<number> {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Cohere models have efficient tokenization
    const charBasedEstimate = Math.ceil(charCount / 4.5);
    const wordBasedEstimate = Math.ceil(wordCount * 1.1);
    
    return Math.max(charBasedEstimate, wordBasedEstimate);
}

/**
 * Improved Claude-specific fallback estimation
 */
function estimateClaudeFallback(text: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Claude-specific adjustments based on empirical testing
    let tokenCount = Math.max(Math.ceil(charCount / 3.8), Math.ceil(wordCount * 1.3));
    
    // Adjust for content types that Claude handles differently
    if (text.includes('```') || text.includes('<') || text.includes('>')) {
        tokenCount *= 1.15; // Code and markup are more token-heavy
    }
    
    if (text.match(/[^\x00-\x7F]/g)) {
        tokenCount *= 1.2; // Non-ASCII characters
    }
    
    return Math.ceil(tokenCount);
}

/**
 * Amazon Titan tokenization
 */
function estimateTitanTokens(text: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Titan models use similar tokenization to GPT
    return Math.max(Math.ceil(charCount / 4), Math.ceil(wordCount * 1.3));
}

/**
 * AI21 (Jurassic) tokenization
 */
function estimateAI21Tokens(text: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // AI21 models have efficient tokenization
    return Math.max(Math.ceil(charCount / 4.2), Math.ceil(wordCount * 1.25));
}

/**
 * Fallback estimation using improved heuristics
 */
function estimateFallbackTokens(text: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Base estimation - use word-based for better accuracy, with character backup
    let tokenCount = Math.ceil(wordCount * 1.3);
    
    // Only use character-based if word-based seems too low (handles edge cases)
    const charBasedEstimate = Math.ceil(charCount / 4);
    if (charBasedEstimate > tokenCount && wordCount < 20) {
        tokenCount = charBasedEstimate;
    }
    
    // Adjust based on content characteristics
    const specialContent = detectSpecialContent(text);
    
    if (specialContent.hasCode) {
        tokenCount *= 1.2; // Code is more token-dense
    }
    
    if (specialContent.hasJson) {
        tokenCount *= 1.05; // Reduced JSON structure overhead (was too aggressive)
    }
    
    if (specialContent.hasUrls) {
        tokenCount *= 1.1; // URLs can be token-heavy
    }
    
    // Non-ASCII characters tend to use more tokens
    const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) || []).length / charCount;
    if (nonAsciiRatio > 0.1) {
        tokenCount *= (1 + nonAsciiRatio * 0.5);
    }
    
    return Math.ceil(tokenCount);
}

/**
 * Synchronous OpenAI tokenization with model-specific logic
 */
function estimateOpenAITokensSync(text: string, model?: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Model-specific token estimation adjustments
    let baseEstimate = Math.max(Math.ceil(charCount / 4), Math.ceil(wordCount * 1.3));
    
    if (model?.includes('gpt-4')) {
        // GPT-4 models tend to be more efficient with tokenization
        baseEstimate *= 0.95;
    } else if (model?.includes('gpt-3.5-turbo')) {
        // GPT-3.5-turbo is similar to GPT-4
        baseEstimate *= 0.98;
    } else if (model?.includes('text-davinci') || model?.includes('davinci')) {
        // Older models are less efficient
        baseEstimate *= 1.05;
    }
    
    return Math.ceil(baseEstimate);
}

/**
 * Synchronous Anthropic tokenization with model-specific logic
 */
function estimateAnthropicTokensSync(text: string, model?: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Claude models generally use more tokens than GPT models
    let baseEstimate = Math.max(Math.ceil(charCount / 3.8), Math.ceil(wordCount * 1.4));
    
    if (model?.includes('claude-3-5-sonnet')) {
        // Latest Sonnet is more efficient
        baseEstimate *= 0.9;
    } else if (model?.includes('claude-3-opus')) {
        // Opus uses slightly more tokens
        baseEstimate *= 1.1;
    } else if (model?.includes('claude-3-haiku')) {
        // Haiku is most efficient
        baseEstimate *= 0.85;
    }
    
    return Math.ceil(baseEstimate);
}

/**
 * Synchronous Bedrock tokenization with model-specific logic
 */
function estimateBedrockTokensSync(text: string, model?: string): number {
    if (!model) {
        return estimateFallbackTokens(text);
    }

    // Route based on underlying model
    if (model.includes('claude')) {
        return estimateAnthropicTokensSync(text, model);
    } else if (model.includes('titan')) {
        return estimateTitanTokens(text);
    } else if (model.includes('jurassic')) {
        return estimateAI21Tokens(text);
    } else if (model.includes('cohere')) {
        return estimateCohereTokensSync(text, model);
    }
    
    return estimateFallbackTokens(text);
}

/**
 * Synchronous Google tokenization with model-specific logic
 */
function estimateGoogleTokensSync(text: string, model?: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Gemini models tend to be more efficient
    let baseEstimate = Math.max(Math.ceil(charCount / 3.5), Math.ceil(wordCount * 1.2));
    
    if (model?.includes('gemini-pro')) {
        baseEstimate *= 0.9;
    } else if (model?.includes('gemini-ultra')) {
        baseEstimate *= 1.05;
    }
    
    return Math.ceil(baseEstimate);
}

/**
 * Synchronous Cohere tokenization with model-specific logic
 */
function estimateCohereTokensSync(text: string, model?: string): number {
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).length;
    
    // Cohere models are generally efficient
    let baseEstimate = Math.max(Math.ceil(charCount / 4.5), Math.ceil(wordCount * 1.1));
    
    if (model?.includes('command-r-plus')) {
        baseEstimate *= 0.95;
    } else if (model?.includes('command-r')) {
        baseEstimate *= 1.0;
    }
    
    return Math.ceil(baseEstimate);
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