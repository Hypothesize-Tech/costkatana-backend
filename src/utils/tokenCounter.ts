import { AIProvider } from '../types/aiCostTracker.types';

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
 * Estimate tokens for different model context windows
 */
export function getContextWindowLimits(_provider: AIProvider, model: string): number {
    const contextLimits: Record<string, number> = {
        // OpenAI
        'gpt-4': 8192,
        'gpt-4-32k': 32768,
        'gpt-4-turbo': 128000,
        'gpt-4-turbo-preview': 128000,
        'gpt-3.5-turbo': 4096,
        'gpt-3.5-turbo-16k': 16384,
        'text-davinci-003': 4097,

        // Anthropic
        'claude-3-5-sonnet-20240620': 200000,
        'claude-3-sonnet-20240229': 200000,
        'claude-3-haiku-20240307': 200000,
        'claude-instant-v1': 100000,
        'claude-v2': 100000,

        // AWS Bedrock
        'anthropic.claude-3-5-sonnet-20240620-v1:0': 200000,
        'anthropic.claude-3-sonnet-20240229-v1:0': 200000,
        'anthropic.claude-3-haiku-20240307-v1:0': 200000,
        'anthropic.claude-instant-v1': 100000,
        'anthropic.claude-v2:1': 100000,
        'amazon.titan-text-express-v1': 8000,
        'amazon.titan-text-lite-v1': 4000,

        // Google
        'gemini-pro': 30720,
        'gemini-1.5-pro': 1048576,
        'gemini-1.5-flash': 1048576,

        // Cohere
        'command': 4096,
        'command-light': 4096
    };

    return contextLimits[model] || 4096; // Default fallback
}

/**
 * Validate token usage against model limits
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
} {
    const maxTokens = getContextWindowLimits(provider, model);
    const totalTokens = promptTokens + expectedCompletionTokens;
    const utilizationPercentage = (totalTokens / maxTokens) * 100;
    const warnings: string[] = [];

    if (totalTokens > maxTokens) {
        warnings.push(`Total tokens (${totalTokens}) exceed model limit (${maxTokens})`);
    }

    if (utilizationPercentage > 90) {
        warnings.push(`High token utilization (${utilizationPercentage.toFixed(1)}%)`);
    }

    if (promptTokens > maxTokens * 0.8) {
        warnings.push(`Prompt tokens are very high (${promptTokens}), leaving little room for completion`);
    }

    return {
        isValid: totalTokens <= maxTokens,
        totalTokens,
        maxTokens,
        utilizationPercentage,
        warnings
    };
} 