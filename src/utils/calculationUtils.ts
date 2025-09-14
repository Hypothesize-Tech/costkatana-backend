import { estimateTokens } from './tokenCounter';
import { estimateCost } from './pricing';
import { AIProvider } from '../types/aiCostTracker.types';
import { CortexImpactMetrics } from '../services/cortexAnalytics.service';
import { loggingService } from '../services/logging.service';

export interface UnifiedCalculationResult {
    originalTokens: number;
    optimizedTokens: number;
    tokensSaved: number; // Can be negative if tokens increased
    tokensSavedPercentage: number; // Can be negative if tokens increased
    originalCost: number;
    optimizedCost: number;
    costSaved: number; // Can be negative if cost increased
    costSavedPercentage: number; // Can be negative if cost increased
    
    // For display purposes (always positive)
    displayTokensSaved: number;
    displayCostSaved: number;
    displayPercentage: number;
    isIncrease: boolean; // True if tokens/cost increased instead of decreased
}

/**
 * Convert AIProvider enum to string for pricing functions
 */
function providerEnumToString(provider: AIProvider): string {
    const providerMap: Record<AIProvider, string> = {
        [AIProvider.OpenAI]: 'OpenAI',
        [AIProvider.Anthropic]: 'Anthropic',
        [AIProvider.Google]: 'Google AI',
        [AIProvider.Gemini]: 'Google AI',
        [AIProvider.AWSBedrock]: 'AWS Bedrock',
        [AIProvider.Cohere]: 'Cohere',
        [AIProvider.DeepSeek]: 'DeepSeek',
        [AIProvider.Groq]: 'Groq',
        [AIProvider.HuggingFace]: 'Hugging Face',
        [AIProvider.Ollama]: 'Ollama',
        [AIProvider.Replicate]: 'Replicate',
        [AIProvider.Azure]: 'Azure OpenAI'
    };
    return providerMap[provider] || 'OpenAI';
}

/**
 * Unified calculation function for token and cost savings
 * This ensures consistency across optimization and cortex flows
 */
export function calculateUnifiedSavings(
    originalPrompt: string,
    optimizedResponse: string,
    provider: AIProvider | string,
    model: string,
    completionTokensEstimate: number = 150
): UnifiedCalculationResult {
    // Convert provider to string if needed
    const providerStr = typeof provider === 'string' ? provider : providerEnumToString(provider);
    
    // Calculate tokens consistently - estimateTokens expects AIProvider enum or undefined
    const originalPromptTokens = estimateTokens(originalPrompt, typeof provider === 'string' ? undefined : provider, model);
    const optimizedResponseTokens = estimateTokens(optimizedResponse, typeof provider === 'string' ? undefined : provider, model);
    
    // For total tokens, we need to consider both prompt and completion
    // Original flow: user query (prompt) + expected response
    const originalTotalTokens = originalPromptTokens + completionTokensEstimate;
    
    // Optimized flow: The cortex/optimization already generated the response
    // So the optimized tokens is just the response tokens (no additional completion needed)
    const optimizedTotalTokens = optimizedResponseTokens;
    
    // Calculate actual difference (can be negative)
    const actualTokenDifference = originalTotalTokens - optimizedTotalTokens;
    const actualTokenPercentage = originalTotalTokens > 0 
        ? (actualTokenDifference / originalTotalTokens) * 100 
        : 0;
    
    // Calculate costs using the same pricing service
    let originalCostEstimate;
    let optimizedCostEstimate;
    
    try {
        originalCostEstimate = estimateCost(
            originalPromptTokens,
            completionTokensEstimate,
            providerStr,
            model
        );
    } catch (error) {
        loggingService.warn(`No pricing data found for ${providerStr}/${model}, using fallback pricing for original`);
        // Use fallback pricing (GPT-4o-mini rates as default)
        originalCostEstimate = {
            inputCost: (originalPromptTokens / 1_000_000) * 0.15,
            outputCost: (completionTokensEstimate / 1_000_000) * 0.60,
            totalCost: (originalPromptTokens / 1_000_000) * 0.15 + (completionTokensEstimate / 1_000_000) * 0.60
        };
    }
    
    try {
        // For optimized, we only have the response tokens (no additional completion)
        optimizedCostEstimate = estimateCost(
            0, // No prompt tokens for the optimized response
            optimizedResponseTokens, // The response is the output
            providerStr,
            model
        );
    } catch (error) {
        loggingService.warn(`No pricing data found for ${providerStr}/${model}, using fallback pricing for optimized`);
        // Use fallback pricing (GPT-4o-mini rates as default)
        optimizedCostEstimate = {
            inputCost: 0,
            outputCost: (optimizedResponseTokens / 1_000_000) * 0.60,
            totalCost: (optimizedResponseTokens / 1_000_000) * 0.60
        };
    }
    
    // Calculate actual cost difference (can be negative)
    const actualCostDifference = originalCostEstimate.totalCost - optimizedCostEstimate.totalCost;
    const actualCostPercentage = originalCostEstimate.totalCost > 0
        ? (actualCostDifference / originalCostEstimate.totalCost) * 100
        : 0;
    
    // Determine if this is an increase or decrease
    const isIncrease = actualTokenDifference < 0;
    
    // For display purposes, we want positive numbers
    const displayTokensSaved = Math.abs(actualTokenDifference);
    const displayCostSaved = Math.abs(actualCostDifference);
    const displayPercentage = Math.abs(actualTokenPercentage);
    
    loggingService.info('Unified calculation completed', {
        originalPromptLength: originalPrompt.length,
        optimizedResponseLength: optimizedResponse.length,
        originalTokens: originalTotalTokens,
        optimizedTokens: optimizedTotalTokens,
        tokenDifference: actualTokenDifference,
        costDifference: actualCostDifference,
        isIncrease,
        provider: providerStr,
        model
    });
    
    return {
        originalTokens: originalTotalTokens,
        optimizedTokens: optimizedTotalTokens,
        tokensSaved: actualTokenDifference,
        tokensSavedPercentage: actualTokenPercentage,
        originalCost: originalCostEstimate.totalCost,
        optimizedCost: optimizedCostEstimate.totalCost,
        costSaved: actualCostDifference,
        costSavedPercentage: actualCostPercentage,
        displayTokensSaved,
        displayCostSaved,
        displayPercentage,
        isIncrease
    };
}

/**
 * Convert unified calculation result to CortexImpactMetrics format
 */
export function convertToCortexMetrics(
    unifiedResult: UnifiedCalculationResult,
    qualityMetrics?: Partial<CortexImpactMetrics['qualityMetrics']>,
    performanceMetrics?: Partial<CortexImpactMetrics['performanceMetrics']>,
    justification?: Partial<CortexImpactMetrics['justification']>
): CortexImpactMetrics {
    return {
        tokenReduction: {
            withoutCortex: unifiedResult.originalTokens,
            withCortex: unifiedResult.optimizedTokens,
            absoluteSavings: unifiedResult.tokensSaved,
            percentageSavings: unifiedResult.tokensSavedPercentage
        },
        costImpact: {
            estimatedCostWithoutCortex: unifiedResult.originalCost,
            actualCostWithCortex: unifiedResult.optimizedCost,
            costSavings: unifiedResult.costSaved,
            savingsPercentage: unifiedResult.costSavedPercentage
        },
        qualityMetrics: {
            clarityScore: qualityMetrics?.clarityScore || 85,
            completenessScore: qualityMetrics?.completenessScore || 90,
            relevanceScore: qualityMetrics?.relevanceScore || 95,
            ambiguityReduction: qualityMetrics?.ambiguityReduction || 30,
            redundancyRemoval: qualityMetrics?.redundancyRemoval || 25
        },
        performanceMetrics: {
            processingTime: performanceMetrics?.processingTime || 1500,
            responseLatency: performanceMetrics?.responseLatency || 1200,
            compressionRatio: performanceMetrics?.compressionRatio || 0.5
        },
        justification: {
            optimizationTechniques: justification?.optimizationTechniques || ['Intelligent response structuring'],
            keyImprovements: justification?.keyImprovements || ['Improved clarity and precision'],
            confidenceScore: justification?.confidenceScore || 80
        }
    };
}

/**
 * Format currency value consistently
 */
export function formatCurrency(value: number): string {
    if (value < 0.0001) {
        return '$0.0000';
    } else if (value < 0.01) {
        return `$${value.toFixed(6)}`;
    } else if (value < 1) {
        return `$${value.toFixed(4)}`;
    } else {
        return `$${value.toFixed(2)}`;
    }
}

/**
 * Format token count consistently
 */
export function formatTokenCount(tokens: number): string {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(2)}M`;
    } else if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    } else {
        return tokens.toLocaleString();
    }
}
