import {
    AIProvider,
    OptimizationSuggestion,
    OptimizationResult,
    CompressionDetails,
    ContextTrimDetails,
    RequestFusionDetails,
    ConversationMessage,
    FusionRequest
} from '../types/aiCostTracker.types';
import { estimateTokens, estimateConversationTokens } from './tokenCounter';
import { calculateCost, getModelPricing } from './pricing';
import { loggingService } from '../services/logging.service';

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
 * Compress prompt by removing unnecessary elements
 */
export function compressPrompt(
    prompt: string,
    compressionLevel: 'light' | 'medium' | 'aggressive' = 'medium'
): {
    originalPrompt: string;
    compressedPrompt: string;
    compressionRatio: number;
    details: CompressionDetails;
} {
    const originalSize = prompt.length;
    let compressed = prompt;

    switch (compressionLevel) {
        case 'light':
            // Light compression - just remove extra whitespace
            compressed = prompt
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n')
                .trim();
            break;

        case 'medium':
            // Medium compression - remove whitespace and some redundancy
            compressed = prompt
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n')
                .replace(/\b(please|kindly|if you could|would you mind)\b/gi, '')
                .replace(/\b(very|really|quite|somewhat|rather|pretty|fairly)\s+/gi, '')
                .replace(/\b(the|a|an)\s+/gi, match => Math.random() > 0.5 ? match : '')
                .trim();
            break;

        case 'aggressive':
            // Aggressive compression - significant text reduction
            compressed = prompt
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n')
                .replace(/\b(please|kindly|if you could|would you mind|thank you|thanks)\b/gi, '')
                .replace(/\b(very|really|quite|somewhat|rather|pretty|fairly|extremely|incredibly)\s+/gi, '')
                .replace(/\b(the|a|an)\s+/gi, '')
                .replace(/\b(that|which|who)\s+/gi, '')
                .replace(/\b(is|are|was|were)\s+/gi, '')
                .replace(/[.]{2,}/g, '.')
                .trim();
            break;
    }

    const compressedSize = compressed.length;
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

    return {
        originalPrompt: prompt,
        compressedPrompt: compressed,
        compressionRatio,
        details: {
            technique: 'pattern_replacement',
            originalSize,
            compressedSize,
            compressionRatio,
            reversible: compressionLevel === 'light'
        }
    };
}

/**
 * Compress JSON structures in prompts
 */
export function compressJsonInPrompt(prompt: string): {
    originalPrompt: string;
    compressedPrompt: string;
    compressionRatio: number;
    details: CompressionDetails;
} {
    const originalSize = prompt.length;
    let compressed = prompt;

    // Find and compress JSON structures
    const jsonRegex = /\{[\s\S]*?\}/g;
    const jsonMatches = prompt.match(jsonRegex);

    if (jsonMatches) {
        for (const jsonMatch of jsonMatches) {
            try {
                const parsed = JSON.parse(jsonMatch);
                const minified = JSON.stringify(parsed);
                compressed = compressed.replace(jsonMatch, minified);
            } catch (e) {
                // If it's not valid JSON, just remove extra whitespace
                const cleaned = jsonMatch.replace(/\s+/g, ' ');
                compressed = compressed.replace(jsonMatch, cleaned);
            }
        }
    }

    const compressedSize = compressed.length;
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

    return {
        originalPrompt: prompt,
        compressedPrompt: compressed,
        compressionRatio,
        details: {
            technique: 'json_compression',
            originalSize,
            compressedSize,
            compressionRatio,
            reversible: true
        }
    };
}

/**
 * Trim conversation context to reduce tokens
 */
export function trimConversationContext(
    messages: ConversationMessage[],
    maxTokens: number,
    provider: AIProvider = AIProvider.OpenAI,
    strategy: 'sliding_window' | 'importance_scoring' | 'summarization' = 'sliding_window'
): {
    originalMessages: ConversationMessage[];
    trimmedMessages: ConversationMessage[];
    details: ContextTrimDetails;
} {
    const originalMessages = [...messages];
    let trimmedMessages = [...messages];

    switch (strategy) {
        case 'sliding_window':
            // Keep the most recent messages that fit within token limit
            let totalTokens = 0;
            const keptMessages: ConversationMessage[] = [];

            for (let i = messages.length - 1; i >= 0; i--) {
                const messageTokens = estimateTokens(messages[i].content, provider);
                if (totalTokens + messageTokens <= maxTokens) {
                    keptMessages.unshift(messages[i]);
                    totalTokens += messageTokens;
                } else {
                    break;
                }
            }

            trimmedMessages = keptMessages;
            break;

        case 'importance_scoring':
            // Score messages by importance and keep the highest scoring ones
            const scoredMessages = messages.map((msg, index) => ({
                ...msg,
                score: calculateMessageImportance(msg, index, messages.length),
                tokens: estimateTokens(msg.content, provider)
            }));

            // Sort by importance score (descending)
            scoredMessages.sort((a, b) => b.score - a.score);

            let tokens = 0;
            const importantMessages: ConversationMessage[] = [];

            for (const msg of scoredMessages) {
                if (tokens + msg.tokens <= maxTokens) {
                    importantMessages.push(msg);
                    tokens += msg.tokens;
                }
            }

            // Sort back to chronological order
            trimmedMessages = importantMessages.sort((a, b) =>
                originalMessages.indexOf(a) - originalMessages.indexOf(b)
            );
            break;

        case 'summarization':
            // Summarize older messages and keep recent ones
            const recentMessages = messages.slice(-5); // Keep last 5 messages
            const olderMessages = messages.slice(0, -5);

            if (olderMessages.length > 0) {
                const summary = summarizeMessages(olderMessages);
                const summaryMessage: ConversationMessage = {
                    role: 'system',
                    content: `Previous conversation summary: ${summary}`,
                    timestamp: new Date()
                };

                trimmedMessages = [summaryMessage, ...recentMessages];
            } else {
                trimmedMessages = recentMessages;
            }
            break;
    }

    return {
        originalMessages,
        trimmedMessages,
        details: {
            technique: strategy,
            originalMessages: originalMessages.length,
            trimmedMessages: trimmedMessages.length,
            preservedContext: trimmedMessages.map(msg => `${msg.role}: ${msg.content.substring(0, 50)}...`)
        }
    };
}

/**
 * Calculate message importance for context trimming
 */
function calculateMessageImportance(
    message: ConversationMessage,
    index: number,
    totalMessages: number
): number {
    let score = 0;

    // Recency score (more recent = higher score)
    score += (index / totalMessages) * 0.3;

    // Role score (system messages are more important)
    if (message.role === 'system') score += 0.4;
    else if (message.role === 'user') score += 0.2;
    else if (message.role === 'assistant') score += 0.1;

    // Content length score (longer messages might be more important)
    const contentLength = message.content.length;
    if (contentLength > 500) score += 0.2;
    else if (contentLength > 100) score += 0.1;

    // Keyword importance
    const importantKeywords = ['error', 'problem', 'issue', 'important', 'critical', 'urgent'];
    const hasImportantKeywords = importantKeywords.some(keyword =>
        message.content.toLowerCase().includes(keyword)
    );
    if (hasImportantKeywords) score += 0.3;

    // Manual importance score if provided
    if (message.importance) {
        score += message.importance * 0.4;
    }

    return score;
}

/**
 * Summarize messages for context trimming
 */
function summarizeMessages(messages: ConversationMessage[]): string {
    if (messages.length === 0) return '';

    const topics = new Set<string>();
    const keyPoints: string[] = [];

    for (const message of messages) {
        const content = message.content.toLowerCase();

        // Extract potential topics (simple keyword extraction)
        const words = content.split(/\s+/);
        const importantWords = words.filter(word =>
            word.length > 4 &&
            !['this', 'that', 'with', 'from', 'they', 'have', 'been', 'will', 'were', 'what', 'when', 'where', 'would', 'could', 'should'].includes(word)
        );

        importantWords.forEach(word => topics.add(word));

        // Extract sentences with important keywords
        const sentences = message.content.split(/[.!?]+/);
        const importantSentences = sentences.filter(sentence => {
            const lower = sentence.toLowerCase();
            return lower.includes('important') ||
                lower.includes('need') ||
                lower.includes('should') ||
                lower.includes('must') ||
                lower.includes('error') ||
                lower.includes('problem');
        });

        keyPoints.push(...importantSentences.map(s => s.trim()).filter(s => s.length > 10));
    }

    const topicsArray = Array.from(topics).slice(0, 5);
    const topKeyPoints = keyPoints.slice(0, 3);

    let summary = '';
    if (topicsArray.length > 0) {
        summary += `Topics discussed: ${topicsArray.join(', ')}. `;
    }
    if (topKeyPoints.length > 0) {
        summary += `Key points: ${topKeyPoints.join('; ')}.`;
    }

    return summary || 'Previous conversation covered various topics.';
}

/**
 * Suggest request fusion opportunities
 */
export function suggestRequestFusion(
    requests: FusionRequest[],
    maxBatchSize: number = 5,
    timeWindowMs: number = 5000
): {
    fusionGroups: FusionRequest[][];
    details: RequestFusionDetails[];
    estimatedSavings: number;
} {
    const fusionGroups: FusionRequest[][] = [];
    const details: RequestFusionDetails[] = [];
    const now = Date.now();

    // Group requests by similarity and timing
    const availableRequests = requests.filter(req =>
        now - req.timestamp <= timeWindowMs
    );

    // Simple grouping by provider and model
    const groupsByProviderModel = new Map<string, FusionRequest[]>();

    for (const request of availableRequests) {
        const key = `${request.provider}-${request.model}`;
        if (!groupsByProviderModel.has(key)) {
            groupsByProviderModel.set(key, []);
        }
        groupsByProviderModel.get(key)!.push(request);
    }

    let totalSavings = 0;

    for (const [, groupRequests] of groupsByProviderModel) {
        if (groupRequests.length >= 2) {
            // Create fusion batches
            for (let i = 0; i < groupRequests.length; i += maxBatchSize) {
                const batch = groupRequests.slice(i, i + maxBatchSize);
                if (batch.length >= 2) {
                    fusionGroups.push(batch);

                    // Calculate estimated savings
                    const individualCosts = batch.map(req =>
                        calculateCost(estimateTokens(req.prompt), 150, providerEnumToString(req.provider), req.model)
                    );
                    const totalIndividualCost = individualCosts.reduce((sum, cost) => sum + cost, 0);

                    // Estimate batch cost (assuming 20% overhead but 30% savings from efficiency)
                    const batchCost = totalIndividualCost * 0.9;
                    const savings = totalIndividualCost - batchCost;
                    totalSavings += savings;

                    details.push({
                        fusedRequests: batch.map(req => req.id),
                        fusionStrategy: 'parallel',
                        estimatedTimeReduction: batch.length * 0.2 // 20% time reduction per request
                    });
                }
            }
        }
    }

    return {
        fusionGroups,
        details,
        estimatedSavings: totalSavings
    };
}

/**
 * Generate comprehensive optimization suggestions
 */
export function generateOptimizationSuggestions(
    prompt: string,
    provider: AIProvider,
    model: string,
    conversationHistory?: ConversationMessage[]
): OptimizationResult {
    const suggestions: OptimizationSuggestion[] = [];
    const startTime = Date.now();

    const originalTokens = estimateTokens(prompt, provider);
    let originalCost = 0;
    try {
        originalCost = calculateCost(originalTokens, 150, providerEnumToString(provider), model);
    } catch (error) {
        loggingService.warn('Failed to calculate cost for model, using fallback pricing', {
            component: 'optimizationUtils',
            operation: 'generateOptimizationSuggestions',
            provider,
            model,
            error: error instanceof Error ? error.message : String(error),
            fallbackPricing: 'GPT-4o-mini rates'
        });
        // Use fallback pricing (GPT-4o-mini rates as default)
        originalCost = (originalTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60;
    }

    // Prompt compression suggestions
    const compressionResult = compressPrompt(prompt, 'medium');
    if (compressionResult.compressionRatio < 0.9) {
        const compressedTokens = estimateTokens(compressionResult.compressedPrompt, provider);
        let compressedCost = 0;
        try {
            compressedCost = calculateCost(compressedTokens, 150, providerEnumToString(provider), model);
        } catch (error) {
            loggingService.warn('Failed to calculate compressed cost for model, using fallback pricing', {
                component: 'optimizationUtils',
                operation: 'generateOptimizationSuggestions',
                provider,
                model,
                error: error instanceof Error ? error.message : String(error),
                fallbackPricing: 'GPT-4o-mini rates',
                optimizationType: 'prompt-compression'
            });
            compressedCost = (compressedTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60;
        }
        const savings = originalCost - compressedCost;

        suggestions.push({
            id: 'prompt-compression',
            type: 'compression',
            originalPrompt: prompt,
            optimizedPrompt: compressionResult.compressedPrompt,
            estimatedSavings: savings,
            confidence: 0.8,
            explanation: `Compress prompt by removing unnecessary words and formatting. Reduces tokens by ${Math.round((1 - compressionResult.compressionRatio) * 100)}%.`,
            implementation: 'Apply text compression techniques to reduce token count while preserving meaning.',
            tradeoffs: 'May slightly reduce clarity or natural language flow.',
            compressionDetails: compressionResult.details
        });
    }

    // JSON compression suggestions
    if (prompt.includes('{') && prompt.includes('}')) {
        const jsonCompressionResult = compressJsonInPrompt(prompt);
        if (jsonCompressionResult.compressionRatio < 0.95) {
            const jsonCompressedTokens = estimateTokens(jsonCompressionResult.compressedPrompt, provider);
            let jsonCompressedCost = 0;
            try {
                jsonCompressedCost = calculateCost(jsonCompressedTokens, 150, providerEnumToString(provider), model);
            } catch (error) {
                loggingService.warn('Failed to calculate JSON compressed cost for model, using fallback pricing', {
                    component: 'optimizationUtils',
                    operation: 'generateOptimizationSuggestions',
                    provider,
                    model,
                    error: error instanceof Error ? error.message : String(error),
                    fallbackPricing: 'GPT-4o-mini rates',
                    optimizationType: 'json-compression'
                });
                jsonCompressedCost = (jsonCompressedTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60;
            }
            const jsonSavings = originalCost - jsonCompressedCost;

            suggestions.push({
                id: 'json-compression',
                type: 'compression',
                originalPrompt: prompt,
                optimizedPrompt: jsonCompressionResult.compressedPrompt,
                estimatedSavings: jsonSavings,
                confidence: 0.9,
                explanation: 'Minify JSON structures in the prompt to reduce token usage.',
                implementation: 'Remove unnecessary whitespace from JSON objects and arrays.',
                tradeoffs: 'Minimal impact on readability.',
                compressionDetails: jsonCompressionResult.details
            });
        }
    }

    // Context trimming suggestions
    if (conversationHistory && conversationHistory.length > 10) {
        const contextTrimResult = trimConversationContext(conversationHistory, originalTokens * 0.7, provider);
        if (contextTrimResult.trimmedMessages.length < contextTrimResult.originalMessages.length) {
            const contextTokens = estimateConversationTokens(contextTrimResult.trimmedMessages, provider);
            let contextCost = 0;
            try {
                contextCost = calculateCost(contextTokens, 150, providerEnumToString(provider), model);
            } catch (error) {
                loggingService.warn('Failed to calculate context cost for model, using fallback pricing', {
                    component: 'optimizationUtils',
                    operation: 'generateOptimizationSuggestions',
                    provider,
                    model,
                    error: error instanceof Error ? error.message : String(error),
                    fallbackPricing: 'GPT-4o-mini rates',
                    optimizationType: 'context-trimming'
                });
                contextCost = (contextTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60;
            }
            const contextSavings = originalCost - contextCost;

            suggestions.push({
                id: 'context-trimming',
                type: 'context_trimming',
                estimatedSavings: contextSavings,
                confidence: 0.7,
                explanation: `Reduce conversation context by keeping only the most relevant messages. Removes ${contextTrimResult.originalMessages.length - contextTrimResult.trimmedMessages.length} messages.`,
                implementation: 'Use sliding window or importance scoring to trim conversation history.',
                tradeoffs: 'May lose some conversation context that could be relevant.',
                contextTrimDetails: contextTrimResult.details
            });
        }
    }

    // Model suggestion
    const modelSuggestion = suggestAlternativeModel(provider, model, originalTokens);
    if (modelSuggestion) {
        suggestions.push(modelSuggestion);
    }

    // Calculate total savings
    const totalSavings = suggestions.reduce((sum, suggestion) => sum + suggestion.estimatedSavings, 0);
    const appliedOptimizations = suggestions.map(s => s.id);

    const processingTime = Date.now() - startTime;
    const optimizedTokens = suggestions.length > 0 ?
        originalTokens - Math.round(originalTokens * 0.2) : originalTokens;

    return {
        id: `optimization-${Date.now()}`,
        suggestions,
        totalSavings,
        appliedOptimizations,
        metadata: {
            processingTime,
            originalTokens,
            optimizedTokens,
            techniques: suggestions.map(s => s.type)
        }
    };
}

/**
 * Suggest alternative models for cost optimization
 */
function suggestAlternativeModel(
    provider: AIProvider,
    currentModel: string,
    tokenCount: number
): OptimizationSuggestion | null {
    const currentPricing = getModelPricing(providerEnumToString(provider), currentModel);
    if (!currentPricing) return null;

    let currentCost = 0;
    try {
        currentCost = calculateCost(tokenCount, 150, providerEnumToString(provider), currentModel);
    } catch (error) {
        loggingService.warn('Failed to calculate current cost for model, using fallback pricing', {
            component: 'optimizationUtils',
            operation: 'suggestAlternativeModel',
            provider,
            currentModel,
            error: error instanceof Error ? error.message : String(error),
            fallbackPricing: 'GPT-4o-mini rates'
        });
        currentCost = (tokenCount / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60;
    }

    // Model alternatives by provider
    const alternatives: Record<AIProvider, string[]> = {
        [AIProvider.OpenAI]: ['gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4'],
        [AIProvider.AWSBedrock]: ['anthropic.claude-3-haiku-20240307-v1:0', 'anthropic.claude-3-sonnet-20240229-v1:0'],
        [AIProvider.Anthropic]: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229'],
        [AIProvider.Google]: ['gemini-1.5-flash', 'gemini-pro'],
        [AIProvider.Cohere]: ['command-light', 'command'],
        [AIProvider.Gemini]: ['gemini-1.5-flash', 'gemini-pro'],
        [AIProvider.DeepSeek]: [],
        [AIProvider.Groq]: [],
        [AIProvider.HuggingFace]: [],
        [AIProvider.Ollama]: [],
        [AIProvider.Replicate]: [],
        [AIProvider.Azure]: ['gpt-3.5-turbo', 'gpt-4-turbo']
    };

    const modelAlternatives = alternatives[provider] || [];
    let bestAlternative: { model: string; cost: number; savings: number } | null = null;

    for (const altModel of modelAlternatives) {
        if (altModel !== currentModel) {
            let altCost = 0;
            try {
                altCost = calculateCost(tokenCount, 150, providerEnumToString(provider), altModel);
            } catch (error) {
                loggingService.warn('Failed to calculate alternative cost for model, skipping', {
                    component: 'optimizationUtils',
                    operation: 'suggestAlternativeModel',
                    provider,
                    currentModel,
                    alternativeModel: altModel,
                    error: error instanceof Error ? error.message : String(error)
                });
                continue;
            }
            const savings = currentCost - altCost;

            if (savings > 0 && (!bestAlternative || savings > bestAlternative.savings)) {
                bestAlternative = { model: altModel, cost: altCost, savings };
            }
        }
    }

    if (bestAlternative) {
        return {
            id: 'model-optimization',
            type: 'model',
            estimatedSavings: bestAlternative.savings,
            confidence: 0.6,
            explanation: `Switch to ${bestAlternative.model} for cost savings. Estimated ${Math.round((bestAlternative.savings / currentCost) * 100)}% cost reduction.`,
            implementation: `Change model from ${currentModel} to ${bestAlternative.model}`,
            tradeoffs: 'May have different performance characteristics or capabilities.'
        };
    }

    return null;
}

/**
 * Apply optimization suggestions to a prompt
 */
export function applyOptimizations(
    prompt: string,
    optimizations: OptimizationSuggestion[],
    conversationHistory?: ConversationMessage[]
): {
    optimizedPrompt: string;
    optimizedHistory?: ConversationMessage[];
    appliedOptimizations: string[];
} {
    let optimizedPrompt = prompt;
    let optimizedHistory = conversationHistory ? [...conversationHistory] : undefined;
    const appliedOptimizations: string[] = [];

    for (const optimization of optimizations) {
        switch (optimization.type) {
            case 'compression':
                if (optimization.optimizedPrompt) {
                    optimizedPrompt = optimization.optimizedPrompt;
                    appliedOptimizations.push(optimization.id);
                }
                break;

            case 'context_trimming':
                if (optimization.contextTrimDetails && conversationHistory) {
                    const trimResult = trimConversationContext(
                        conversationHistory,
                        estimateConversationTokens(conversationHistory) * 0.7
                    );
                    optimizedHistory = trimResult.trimmedMessages;
                    appliedOptimizations.push(optimization.id);
                }
                break;

            default:
                // Other optimizations would be applied at the request level
                break;
        }
    }

    return {
        optimizedPrompt,
        optimizedHistory,
        appliedOptimizations
    };
} 

/**
 * Sanitize model names for safe storage and display
 * Removes sensitive information like AWS account IDs from ARNs
 */
export function sanitizeModelName(model: string): string {
    if (!model) return model;
    
    // Handle AWS ARNs - extract clean model name
    if (model.toLowerCase().startsWith('arn:aws:bedrock:')) {
        const arnParts = model.split('/');
        if (arnParts.length > 1) {
            // Get the last part after '/' which contains the actual model
            let modelName = arnParts[arnParts.length - 1];
            
            // Remove region prefix (us., eu., etc.) but keep vendor prefix (amazon., anthropic.)
            modelName = modelName.replace(/^(us|eu|ap-[a-z]+|ca-[a-z]+)\./, '');
            
            return modelName;
        }
    }
    
    // For non-ARN models, return as-is
    return model;
}