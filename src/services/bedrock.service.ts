import { InvokeModelCommand, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, AWS_CONFIG } from '../config/aws';
import { ServiceHelper } from '@utils/serviceHelper';
import { recordGenAIUsage } from '@utils/genaiTelemetry';
import { calculateCost } from '@utils/pricing';
import { estimateTokens } from '@utils/tokenCounter';
import { TokenEstimator } from '@utils/tokenEstimator';
import { AIProvider } from '../types/aiCostTracker.types';
import { loggingService } from './logging.service';
import { AICostTrackingService } from './aiCostTracking.service';
import { decodeFromTOON } from '@utils/toon.utils';
import { S3Service } from './s3.service';
import { RawPricingData, LLMExtractionResult } from '../types/modelDiscovery.types';

interface PromptOptimizationRequest {
    prompt: string;
    model: string;
    service: string;
    context?: string;
    targetReduction?: number;
    preserveIntent?: boolean;
}

interface PromptOptimizationResponse {
    optimizedPrompt: string;
    techniques: string[];
    estimatedTokenReduction: number;
    suggestions: string[];
    alternatives?: string[];
}

interface UsageAnalysisRequest {
    usageData: Array<{
        prompt: string;
        tokens: number;
        cost: number;
        timestamp: Date;
    }>;
    timeframe: 'daily' | 'weekly' | 'monthly';
}

interface UsageAnalysisResponse {
    patterns: string[];
    recommendations: string[];
    potentialSavings: number;
    optimizationOpportunities: Array<{
        prompt: string;
        reason: string;
        estimatedSaving: number;
    }>;
}

export class BedrockService {
    
    /**
     * Check if model should use Converse API (newer Claude 4.x and Sonnet 4.5 models)
     */
    private static shouldUseConverseAPI(model: string): boolean {
        // Global inference profile models MUST use Converse API
        if (model.startsWith('global.')) {
            return true;
        }
        
        // Claude 4.5, Opus 4, and newer models should use Converse API for better support
        const converseModels = [
            'claude-sonnet-4-5',
            'claude-opus-4-5',
            'claude-haiku-4-5',
            'claude-opus-4'
        ];
        
        return converseModels.some(name => model.includes(name));
    }

    /**
     * Invoke model using Converse API (for newer Claude models)
     */
    private static async invokeWithConverseAPI(
        model: string,
        prompt: string,
        context?: { 
            recentMessages?: Array<{ role: string; content: string; metadata?: any }>;
            useSystemPrompt?: boolean;
        }
    ): Promise<{result: string, inputTokens: number, outputTokens: number}> {
        const messages: Array<{role: 'user' | 'assistant', content: Array<{text: string}>}> = [];
        
        // Build messages array if context provided
        if (context?.recentMessages && context.recentMessages.length > 0) {
            const msgArray = this.buildMessagesArray(context.recentMessages, prompt);
            msgArray.forEach(msg => {
                messages.push({
                    role: msg.role,
                    content: [{ text: msg.content }]
                });
            });
        } else {
            // Single user message
            messages.push({
                role: 'user',
                content: [{ text: prompt }]
            });
        }

        // Build system prompts
        const systemPrompts: Array<{text: string}> = [];
        if (context?.useSystemPrompt !== false) {
            systemPrompts.push({
                text: 'You are a helpful AI assistant specializing in AI cost optimization and cloud infrastructure. Remember context from previous messages and provide actionable, cost-effective recommendations.'
            });
        }

        const command = new ConverseCommand({
            modelId: model,
            messages,
            system: systemPrompts.length > 0 ? systemPrompts : undefined,
            inferenceConfig: {
                maxTokens: this.getMaxTokensForModel(model),
                temperature: 0.7
            }
        });

        const response = await ServiceHelper.withRetry(
            () => bedrockClient.send(command),
            {
                maxRetries: 4,
                delayMs: 2000,
                backoffMultiplier: 2
            }
        );

        // Extract text from response
        const result = response.output?.message?.content?.[0]?.text || '';
        const inputTokens = response.usage?.inputTokens || TokenEstimator.estimate(prompt);
        const outputTokens = response.usage?.outputTokens || Math.ceil(result.length / 4);

        return { result, inputTokens, outputTokens };
    }
    
    /**
     * Build messages array from recent conversation history (ChatGPT-style)
     */
    private static buildMessagesArray(
        recentMessages: Array<{ role: string; content: string; metadata?: any }>,
        newMessage: string
    ): Array<{ role: 'user' | 'assistant'; content: string }> {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        
        // Convert recent messages to chronological order
        const chronological = [...recentMessages].reverse();
        
        // Add each message
        chronological.forEach(msg => {
            if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                let messageContent = msg.content;
                
                // Only include document content metadata if the new message is asking about documents/files
                // This prevents old document context from polluting new queries about integrations (Vercel, GitHub, etc.)
                const isDocumentQuery = newMessage.toLowerCase().includes('document') || 
                                       newMessage.toLowerCase().includes('file') ||
                                       newMessage.toLowerCase().includes('pdf') ||
                                       newMessage.toLowerCase().includes('what does it say') ||
                                       newMessage.toLowerCase().includes('what did') ||
                                       newMessage.toLowerCase().includes('analyze');
                
                if (msg.role === 'assistant' && msg.metadata?.type === 'document_content' && msg.metadata?.content && isDocumentQuery) {
                    // Add document content as context (truncate if too long to avoid token limits)
                    const maxContentLength = 10000; // Limit to ~2500 tokens
                    const docContent = msg.metadata.content.length > maxContentLength 
                        ? msg.metadata.content.substring(0, maxContentLength) + '... [content truncated]'
                        : msg.metadata.content;
                    
                    messageContent = `${msg.content}\n\n[Document Content Retrieved]:\n${docContent}`;
                }
                
                messages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: messageContent
                });
            }
        });
        
        // Add the new user message
        messages.push({
            role: 'user',
            content: newMessage
        });
        
        return messages;
    }

    /**
     * Get appropriate max tokens based on model capability
     */
    private static getMaxTokensForModel(modelId: string): number {
        // AWS Bedrock output token limits per model
        // Reference: https://docs.anthropic.com/en/docs/about-claude/models
        if (modelId.includes('claude-sonnet-4-5') || modelId.includes('claude-opus-4-5')) {
            return 32768; // Claude Sonnet 4.5 / Opus 4.5 - supports up to 64K, using 32K for safety
        } else if (modelId.includes('claude-opus-4')) {
            return 16384; // Claude Opus 4 - increased for large outputs
        } else if (modelId.includes('claude-haiku-4-5') || modelId.includes('claude-haiku-4')) {
            return 16384; // Claude Haiku 4.5 - supports large outputs
        } else if (modelId.includes('claude-3-5-sonnet')) {
            return 8192; // Claude 3.5 Sonnet - standard limit
        } else if (modelId.includes('claude-3-5-haiku')) {
            return 8192; // Claude 3.5 Haiku - standard limit
        } else if (modelId.includes('nova-pro')) {
            return 5000; // Nova Pro actual limit
        } else if (modelId.includes('nova')) {
            return 5000; // Other Nova models actual limit
        } else {
            return AWS_CONFIG.bedrock.maxTokens; // Default fallback
        }
    }

    /**
     * Convert model ID to inference profile ARN if needed
     */
    private static convertToInferenceProfile(modelId: string): string {
        const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
        const regionPrefix = region.split('-')[0]; // us, eu, ap, etc.
        
        // Map of model IDs that need inference profile conversion
        const modelMappings: Record<string, string> = {
            // Anthropic Claude 3.5 models require inference profiles
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': `${regionPrefix}.global.anthropic.claude-haiku-4-5-20251001-v1:0`,
            'anthropic.claude-3-5-sonnet-20240620-v1:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20240620-v1:0`,
            'anthropic.claude-3-5-sonnet-20241022-v2:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20241022-v2:0`,
            
            // Legacy Claude 3 models removed - use Claude 3.5+ only
            'anthropic.claude-3-haiku-20240307-v1:0': `${regionPrefix}.anthropic.claude-3-haiku-20240307-v1:0`,
            
            // Add Claude 4 and upgraded Claude 3.5 models
            'anthropic.claude-opus-4-1-20250805-v1:0': `${regionPrefix}.anthropic.claude-opus-4-1-20250805-v1:0`,
            
            // Add Nova Pro
            'amazon.nova-pro-v1:0': `amazon.nova-pro-v1:0`, // Nova models don't need inference profiles
        };

        return modelMappings[modelId] || modelId;
    }

    public static async extractJson(text: string): Promise<string> {
        // Edge case: null/undefined/empty input
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return '';
        }

        // Edge case: very large text (potential DoS)
        const MAX_EXTRACT_SIZE = 5 * 1024 * 1024; // 5MB limit
        if (text.length > MAX_EXTRACT_SIZE) {
            loggingService.warn('Text too large for extraction, truncating', {
                size: text.length,
                maxSize: MAX_EXTRACT_SIZE
            });
            text = text.substring(0, MAX_EXTRACT_SIZE);
        }

        // First, try to extract TOON format (for Cortex responses)
        // Enhanced pattern matching for malformed TOON
        const toonPatterns = [
            /(\w+\[\d+\]\{[^}]+\}:[\s\S]*?)(?=\n\n|\n\w+\[|$)/,
            /(\w+\s*\[\s*\d+\s*\]\s*\{[^}]+\}\s*:[\s\S]*?)(?=\n\n|\n\w+\s*\[|$)/
        ];

        for (const pattern of toonPatterns) {
            const toonMatch = text.match(pattern);
            if (toonMatch && toonMatch[1]) {
                try {
                    // Validate TOON can be decoded (with timeout)
                    const decodePromise = decodeFromTOON(toonMatch[1]);
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('TOON validation timeout')), 2000)
                    );
                    await Promise.race([decodePromise, timeoutPromise]);
                    // Return as TOON string (caller will handle decoding)
                    return toonMatch[1];
                } catch (e) {
                    // Not valid TOON, continue to next pattern or JSON extraction
                    loggingService.debug('TOON validation failed, trying next method', {
                        error: e instanceof Error ? e.message : String(e)
                    });
                }
            }
        }

        // Try to find JSON within code blocks
        const jsonBlockRegex = /```(?:json|toon)?\s*([\s\S]*?)\s*```/;
        const jsonBlockMatch = text.match(jsonBlockRegex);
        
        if (jsonBlockMatch && jsonBlockMatch[1]) {
            const extracted = jsonBlockMatch[1].trim();
            // Try TOON first, then JSON
            try {
                await decodeFromTOON(extracted);
                return extracted;
            } catch {
                try {
                    JSON.parse(extracted);
                    return extracted;
                } catch (e) {
                    // Continue to other methods
                }
            }
        }

        // Try to find JSON object in the text
        const jsonObjectRegex = /\{[\s\S]*\}/;
        const jsonObjectMatch = text.match(jsonObjectRegex);
        
        if (jsonObjectMatch) {
            const extracted = jsonObjectMatch[0];
            // Validate that it's actually JSON
            try {
                JSON.parse(extracted);
                return extracted;
            } catch (e) {
                // If it's not valid JSON, continue to other methods
            }
        }

        // Try to find JSON array in the text
        const jsonArrayRegex = /\[[\s\S]*\]/;
        const jsonArrayMatch = text.match(jsonArrayRegex);
        
        if (jsonArrayMatch) {
            const extracted = jsonArrayMatch[0];
            // Validate that it's actually JSON
            try {
                JSON.parse(extracted);
                return extracted;
            } catch (e) {
                // If it's not valid JSON, continue to other methods
            }
        }

        // If no valid JSON is found, return the original text
        // but try to clean it up first
        const cleanedText = text.trim();
        
        // Remove common prefixes/suffixes that might be added by AI models
        const withoutPrefix = cleanedText.replace(/^(Here's the|The|Here is the|JSON:?|Response:?|Answer:?)\s*/i, '');
        const withoutSuffix = withoutPrefix.replace(/\s*(\.|$)/, '');
        
        return withoutSuffix;
    }

    private static createMessagesPayload(prompt: string, model?: string) {
        // Dynamic token limits based on model capability
        const maxTokens = this.getMaxTokensForModel(model || '');
        
        return {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: maxTokens,
            temperature: AWS_CONFIG.bedrock.temperature,
            messages: [{ role: "user", content: prompt }],
        };
    }

    private static createNovaPayload(prompt: string, model?: string) {
        // Dynamic token limits based on model capability
        const maxTokens = this.getMaxTokensForModel(model || '');
        
        return {
            messages: [{ role: "user", content: [{ text: prompt }] }],
            inferenceConfig: {
                max_new_tokens: maxTokens,
                temperature: AWS_CONFIG.bedrock.temperature,
                top_p: 0.9,
            }
        };
    }

    private static createLegacyPayload(prompt: string) {
        return {
            prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
            max_tokens_to_sample: AWS_CONFIG.bedrock.maxTokens,
            temperature: AWS_CONFIG.bedrock.temperature,
            stop_sequences: ["\n\nHuman:"],
        };
    }

    private static createTitanPayload(prompt: string) {
        return {
            inputText: prompt,
            textGenerationConfig: {
                maxTokenCount: AWS_CONFIG.bedrock.maxTokens,
                temperature: AWS_CONFIG.bedrock.temperature,
            },
        };
    }

    private static createLlamaPayload(prompt: string) {
        return {
            prompt: prompt,
            max_gen_len: AWS_CONFIG.bedrock.maxTokens,
            temperature: AWS_CONFIG.bedrock.temperature,
            top_p: 0.9,
        };
    }

    private static createCoherePayload(prompt: string) {
        return {
            message: prompt,
            max_tokens: AWS_CONFIG.bedrock.maxTokens,
            temperature: AWS_CONFIG.bedrock.temperature,
            p: 0.9,
            k: 0,
            stop_sequences: [],
            return_likelihoods: "NONE"
        };
    }

    private static createAI21Payload(prompt: string) {
        return {
            prompt: prompt,
            maxTokens: AWS_CONFIG.bedrock.maxTokens,
            temperature: AWS_CONFIG.bedrock.temperature,
            topP: 1,
            stopSequences: [],
            countPenalty: {
                scale: 0
            },
            presencePenalty: {
                scale: 0
            },
            frequencyPenalty: {
                scale: 0
            }
        };
    }

    public static async invokeModel(
        prompt: string, 
        model: string, 
        context?: { recentMessages?: Array<{ role: string; content: string }>; useSystemPrompt?: boolean }
    ): Promise<any> {
        const startTime = Date.now();
        let payload: any;
        let responsePath: string;
        let inputTokens = 0;
        let outputTokens = 0;
        let result: string = '';

        // Check if we should use Converse API (for newer Claude models and global profiles)
        if (this.shouldUseConverseAPI(model)) {
            try {
                loggingService.info(`Using Converse API for model: ${model}`);
                const converseResult = await this.invokeWithConverseAPI(model, prompt, context);
                result = converseResult.result;
                inputTokens = converseResult.inputTokens;
                outputTokens = converseResult.outputTokens;
                
                // Track cost and usage
                const costUSD = calculateCost(inputTokens, outputTokens, AIProvider.AWSBedrock, model);
                await recordGenAIUsage({
                    provider: AIProvider.AWSBedrock,
                    operationName: 'converse',
                    model: model,
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    costUSD,
                    latencyMs: Date.now() - startTime
                });

                return result;
            } catch (error: any) {
                loggingService.error('Converse API failed', {
                    error: error.message,
                    model
                });
                throw error;
            }
        }

        // Fallback to InvokeModel API for older models
        // Enhanced: Use messages array format for Claude/Nova if context provided
        const useMessagesFormat = context?.recentMessages && context.recentMessages.length > 0 &&
            (model.includes('claude-3') || model.includes('claude-4') || model.includes('nova'));

        // Check model type and create appropriate payload
        if (model.includes('claude-3') || model.includes('claude-4') || model.includes('claude-opus-4')) {
            if (useMessagesFormat && context?.recentMessages) {
                // Use messages array for better context
                const messages = this.buildMessagesArray(context.recentMessages, prompt);
                payload = {
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: this.getMaxTokensForModel(model),
                    temperature: 0.7,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    }))
                };
                
                // Add system prompt for conversational behavior
                if (context?.useSystemPrompt !== false) {
                    payload.system = 'You are a helpful AI assistant specializing in AI cost optimization and cloud infrastructure. Remember context from previous messages and provide actionable, cost-effective recommendations.';
                }
            } else {
                // Modern Claude models (3.x) use messages format
                payload = this.createMessagesPayload(prompt, model);
            }
            responsePath = 'content';
        } else if (model.includes('nova')) {
            if (useMessagesFormat && context?.recentMessages) {
                // Use messages array for better context
                const messages = this.buildMessagesArray(context.recentMessages, prompt);
                payload = {
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: [{ text: msg.content }]
                    })),
                    inferenceConfig: {
                        max_new_tokens: this.getMaxTokensForModel(model),
                        temperature: 0.7,
                        top_p: 0.9
                    }
                };
            } else {
                // Amazon Nova models
                payload = this.createNovaPayload(prompt, model);
            }
            responsePath = 'nova';
        } else if (model.includes('amazon.titan')) {
            // Amazon Titan models
            payload = this.createTitanPayload(prompt);
            responsePath = 'titan';
        } else if (model.includes('meta.llama')) {
            // Meta Llama models use messages format
            payload = this.createLlamaPayload(prompt);
            responsePath = 'llama';
        } else if (model.includes('mistral')) {
            // Mistral models use messages format
            payload = this.createMessagesPayload(prompt, model);
            responsePath = 'content';
        } else if (model.includes('cohere.command')) {
            // Cohere Command models
            payload = this.createCoherePayload(prompt);
            responsePath = 'cohere';
        } else if (model.includes('ai21')) {
            // AI21 models (Jurassic, Jamba)
            payload = this.createAI21Payload(prompt);
            responsePath = 'ai21';
        } else if (model.includes('claude')) {
            // Legacy Claude models
            payload = this.createLegacyPayload(prompt);
            responsePath = 'completion';
        } else {
            // Default to messages format for unknown models
            payload = this.createMessagesPayload(prompt, model);
            responsePath = 'content';
        }

        // Convert model ID to inference profile if needed
        const actualModelId = this.convertToInferenceProfile(model);
        
        if (actualModelId !== model) {
            loggingService.info(`Converting model ID: ${model} -> ${actualModelId}`);
        }
        
        const command = new InvokeModelCommand({
            modelId: actualModelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(payload),
        });

        try {
            // Calculate input tokens
            try {
                inputTokens = estimateTokens(prompt, AIProvider.AWSBedrock);
            } catch (e) {
                // Fallback to estimation
                inputTokens = Math.ceil(prompt.length / 4);
            }

            // Use standardized retry logic with exponential backoff and jitter
            const response = await ServiceHelper.withRetry(
                () => bedrockClient.send(command),
                {
                    maxRetries: 4,
                    delayMs: 2000,
                    backoffMultiplier: 2
                }
            );
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            // Extract text based on response format
            if (responsePath === 'content') {
                result = responseBody.content[0].text;
            } else if (responsePath === 'nova') {
                result = responseBody.output?.message?.content?.[0]?.text || responseBody.message?.content?.[0]?.text || '';
            } else if (responsePath === 'titan') {
                result = responseBody.results?.[0]?.outputText || '';
            } else if (responsePath === 'llama') {
                result = responseBody.generation || responseBody.outputs?.[0]?.text || '';
            } else if (responsePath === 'cohere') {
                result = responseBody.text || responseBody.generations?.[0]?.text || '';
            } else if (responsePath === 'ai21') {
                result = responseBody.completions?.[0]?.data?.text || responseBody.outputs?.[0]?.text || '';
            } else {
                result = responseBody.completion || responseBody.text || '';
            }

            // Calculate output tokens
            try {
                outputTokens = estimateTokens(result, AIProvider.AWSBedrock);
            } catch (e) {
                // Fallback to estimation
                outputTokens = Math.ceil(result.length / 4);
            }

            // Extract usage from response if available
            if (responseBody.usage) {
                inputTokens = responseBody.usage.input_tokens || inputTokens;
                outputTokens = responseBody.usage.output_tokens || outputTokens;
            } else if (responseBody.amazon_bedrock_invocationMetrics) {
                inputTokens = responseBody.amazon_bedrock_invocationMetrics.inputTokenCount || inputTokens;
                outputTokens = responseBody.amazon_bedrock_invocationMetrics.outputTokenCount || outputTokens;
            }

            // Calculate cost
            const costUSD = calculateCost(inputTokens, outputTokens, 'aws-bedrock', model);

            // Record telemetry
            recordGenAIUsage({
                provider: 'aws-bedrock',
                operationName: 'chat.completions',
                model: actualModelId,
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                costUSD,
                prompt,
                completion: result,
                temperature: AWS_CONFIG.bedrock.temperature,
                maxTokens: AWS_CONFIG.bedrock.maxTokens,
                latencyMs: Date.now() - startTime,
            });

            // Track AI cost for monitoring
            AICostTrackingService.trackCall({
                service: 'bedrock',
                operation: 'invoke_model',
                model: actualModelId,
                inputTokens,
                outputTokens,
                estimatedCost: costUSD,
                latency: Date.now() - startTime,
                success: true,
                metadata: {
                    promptLength: prompt.length,
                    responseLength: result.length,
                    hasContext: !!context?.recentMessages
                }
            });

            return result;
        } catch (error: any) {
            loggingService.error('Error invoking Bedrock model:', { 
                originalModel: model, 
                actualModelId, 
                error 
            });

            // Record error in telemetry
            recordGenAIUsage({
                provider: 'aws-bedrock',
                operationName: 'chat.completions',
                model: actualModelId,
                promptTokens: inputTokens,
                completionTokens: 0,
                costUSD: 0,
                error,
                latencyMs: Date.now() - startTime,
            });

            // Track failed AI call for monitoring
            AICostTrackingService.trackCall({
                service: 'bedrock',
                operation: 'invoke_model',
                model: actualModelId,
                inputTokens,
                outputTokens: 0,
                estimatedCost: 0,
                latency: Date.now() - startTime,
                success: false,
                error: error.message || String(error),
                metadata: {
                    promptLength: prompt.length,
                    errorType: error.name || 'UnknownError'
                }
            });

            throw error;
        }
    }

    static async optimizePrompt(request: PromptOptimizationRequest): Promise<PromptOptimizationResponse> {
        try {
            const systemPrompt = `You are an AI prompt optimization expert. Your task is to optimize the given prompt to reduce token usage while maintaining its intent and effectiveness. The prompt is intended for the '${request.service}' service and the '${request.model}' model.

Original Prompt: ${request.prompt}
${request.context ? `Context: ${request.context}` : ''}
${request.targetReduction ? `Target Token Reduction: ${request.targetReduction}%` : ''}
${request.preserveIntent ? 'Requirement: Preserve the exact intent and expected output format' : ''}

Please provide:
1. An optimized version of the prompt
2. List of optimization techniques used
3. Estimated token reduction percentage
4. Specific suggestions for further optimization
5. Alternative prompt variations (if applicable)

Format your response as a single valid JSON object:
{
  "optimizedPrompt": "...",
  "techniques": ["...", "..."],
  "estimatedTokenReduction": 30,
  "suggestions": ["...", "..."],
  "alternatives": ["...", "..."]
}`;

            const response = await this.invokeModel(systemPrompt, AWS_CONFIG.bedrock.modelId);
            const cleanedResponse = await this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            loggingService.info('Prompt optimization completed', { value:  { 
                originalLength: request.prompt.length,
                optimizedLength: result.optimizedPrompt.length,
                reduction: result.estimatedTokenReduction,
             } });

            return result;
        } catch (error) {
            loggingService.error('Error optimizing prompt:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async analyzeUsagePatterns(request: UsageAnalysisRequest): Promise<UsageAnalysisResponse> {
        try {
            const systemPrompt = `You are an AI usage analyst. Analyze the following usage data and provide insights and recommendations for cost optimization.

Usage Data Summary:
- Total prompts: ${request.usageData.length}
- Timeframe: ${request.timeframe}
- Total tokens: ${request.usageData.reduce((sum, d) => sum + d.tokens, 0)}
- Total cost: $${request.usageData.reduce((sum, d) => sum + d.cost, 0).toFixed(2)}

Top 10 Most Expensive Prompts:
${request.usageData
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 10)
                    .map((d, i) => `${i + 1}. Cost: $${d.cost.toFixed(4)}, Tokens: ${d.tokens}, Prompt: "${d.prompt.substring(0, 100)}..."`)
                    .join('\n')}

Please analyze and provide:
1. Usage patterns (repeated prompts, inefficient structures, etc.)
2. Specific recommendations for cost reduction
3. Estimated potential savings in dollars
            4. Optimization opportunities with specific prompts and reasons

Format your response as JSON:
            {
                "patterns": ["...", "..."],
                    "recommendations": ["...", "..."],
                        "potentialSavings": 25.50,
                            "optimizationOpportunities": [
                                {
                                    "prompt": "...",
                                    "reason": "...",
                                    "estimatedSaving": 5.00
                                }
                            ]
            } `;

            const response = await this.invokeModel(systemPrompt, AWS_CONFIG.bedrock.modelId);
            const cleanedResponse = await this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            loggingService.info('Usage analysis completed', { value:  { 
                timeframe: request.timeframe,
                promptsAnalyzed: request.usageData.length,
                potentialSavings: result.potentialSavings,
             } });

            return result;
        } catch (error) {
            loggingService.error('Error analyzing usage patterns:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async suggestModelAlternatives(
        currentModel: string,
        useCase: string,
        requirements: string[]
    ): Promise<{
        recommendations: Array<{
            model: string;
            provider: string;
            estimatedCostReduction: number;
            tradeoffs: string[];
        }>;
    }> {
        try {
            const systemPrompt = `You are an AI model selection expert.Based on the current model usage and requirements, suggest alternative models that could reduce costs.

Current Model: ${currentModel}
Use Case: ${useCase}
            Requirements: ${requirements.join(', ')}

Suggest alternative models that could:
            1. Reduce costs while meeting the requirements
            2. Provide similar or acceptable performance
            3. Be easily integrated

Format your response as JSON:
            {
                "recommendations": [
                    {
                        "model": "model-name",
                        "provider": "provider-name",
                        "estimatedCostReduction": 40,
                        "tradeoffs": ["...", "..."]
                    }
                ]
            } `;

            const response = await this.invokeModel(systemPrompt, AWS_CONFIG.bedrock.modelId);
            const cleanedResponse = await this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            loggingService.info('Model alternatives suggested', { value:  { 
                currentModel,
                alternativesCount: result.recommendations.length,
             } });

            return result;
        } catch (error) {
            loggingService.error('Error suggesting model alternatives:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async generatePromptTemplate(
        objective: string,
        examples: string[],
        constraints?: string[]
    ): Promise<{
        template: string;
        variables: string[];
        estimatedTokens: number;
        bestPractices: string[];
    }> {
        try {
            const systemPrompt = `You are a prompt engineering expert.Create an optimized prompt template for the given objective.

                Objective: ${objective}
Example Inputs: ${examples.join(', ')}
${constraints ? `Constraints: ${constraints.join(', ')}` : ''}

Create a reusable prompt template that:
            1. Minimizes token usage
            2. Maximizes clarity and effectiveness
            3. Uses variables for dynamic content
4. Follows prompt engineering best practices

Format your response as JSON:
            {
                "template": "...",
                    "variables": ["var1", "var2"],
                        "estimatedTokens": 150,
                            "bestPractices": ["...", "..."]
            } `;

            const response = await this.invokeModel(systemPrompt, AWS_CONFIG.bedrock.modelId);
            const cleanedResponse = await this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            loggingService.info('Prompt template generated', { value:  {  objective  } });

            return result;
        } catch (error) {
            loggingService.error('Error generating prompt template:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async detectAnomalies(
        recentUsage: Array<{ timestamp: Date; cost: number; tokens: number }>,
        historicalAverage: { cost: number; tokens: number }
    ): Promise<{
        anomalies: Array<{
            timestamp: Date;
            type: 'cost_spike' | 'token_spike' | 'unusual_pattern';
            severity: 'low' | 'medium' | 'high';
            description: string;
        }>;
        recommendations: string[];
    }> {
        try {
            const systemPrompt = `You are an AI-powered security and cost anomaly detection system.Analyze the following data to identify any anomalies.

Historical Daily Average:
            - Cost: $${historicalAverage.cost.toFixed(2)}
            - Tokens: ${historicalAverage.tokens}

Recent Usage (last 7 entries):
${recentUsage
                    .slice(-7)
                    .map(u => `- ${u.timestamp.toISOString()}: Cost: $${u.cost.toFixed(2)}, Tokens: ${u.tokens}`)
                    .join('\n')}

Identify:
1. Any anomalies or unusual patterns
2. Severity of each anomaly
3. Recommendations to prevent future anomalies

Format your response as JSON:
                    {
                        "anomalies": [
                            {
                                "timestamp": "ISO-8601-timestamp",
                                "type": "cost_spike",
                                "severity": "high",
                                "description": "..."
                            }
                        ],
                        "recommendations": ["..."]
                    }`;

            const response = await this.invokeModel(systemPrompt, AWS_CONFIG.bedrock.modelId);
            const cleanedResponse = await this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            // Convert timestamp strings back to Date objects
            result.anomalies = result.anomalies.map((a: any) => ({
                ...a,
                timestamp: new Date(a.timestamp),
            }));

            loggingService.info('Anomaly detection completed', { value:  { 
                anomaliesFound: result.anomalies.length,
             } });

            return result;
        } catch (error) {
            loggingService.error('Error detecting anomalies:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Invoke Claude model with image support
     */
    public     static async invokeWithImage(
        prompt: string,
        imageUrl: string,
        userId: string,
        modelId: string = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    ): Promise<{ response: string; inputTokens: number; outputTokens: number; cost: number }> {
        // ABSOLUTE FIRST THING: Log that this function was called
        console.log('='.repeat(80));
        console.log('🚨 BEDROCK SERVICE invokeWithImage CALLED - ABSOLUTE FIRST LOG');
        console.log('imageUrl type:', typeof imageUrl);
        console.log('imageUrl length:', imageUrl?.length);
        console.log('imageUrl first 100 chars:', imageUrl?.substring(0, 100));
        console.log('='.repeat(80));
        
        // CRITICAL DEBUG: Log exactly what we receive
        loggingService.info('🔍 BEDROCK SERVICE invokeWithImage CALLED', {
            component: 'BedrockService',
            imageUrlType: typeof imageUrl,
            imageUrlLength: imageUrl?.length || 0,
            imageUrlPrefix: imageUrl?.substring(0, 100) || '',
            imageUrlStarts: {
                isS3: imageUrl?.startsWith('s3://') || false,
                isHttp: imageUrl?.startsWith('http://') || false,
                isHttps: imageUrl?.startsWith('https://') || false,
                isDataUri: imageUrl?.startsWith('data:') || false
            }
        });
        
        const startTime = Date.now();
        
        // CRITICAL DEBUG: Log the exact parameters at function entry
        loggingService.info('=== invokeWithImage CALLED ===', {
            component: 'BedrockService',
            operation: 'invokeWithImage',
            imageUrlType: typeof imageUrl,
            imageUrlLength: typeof imageUrl === 'string' ? imageUrl.length : 'N/A',
            imageUrlPrefix: typeof imageUrl === 'string' ? imageUrl.substring(0, 100) : 'NOT_A_STRING',
            imageUrlStartsWith: {
                dataImage: typeof imageUrl === 'string' && imageUrl.startsWith('data:image'),
                http: typeof imageUrl === 'string' && imageUrl.startsWith('http'),
                https: typeof imageUrl === 'string' && imageUrl.startsWith('https'),
                s3: typeof imageUrl === 'string' && imageUrl.startsWith('s3://')
            },
            promptLength: prompt.length,
            userId,
            modelId
        });
        
        // EARLY VALIDATION: Check base64 size for data URLs
        if (imageUrl.startsWith('data:image')) {
            const maxBase64Size = 5 * 1024 * 1024; // 5MB limit for base64 (AWS Bedrock Messages API limit)
            
            if (imageUrl.length > maxBase64Size) {
                const sizeMB = (imageUrl.length / (1024 * 1024)).toFixed(2);
                const maxSizeMB = (maxBase64Size / (1024 * 1024)).toFixed(2);
                
                loggingService.error('Image base64 exceeds AWS Bedrock limit', {
                    component: 'BedrockService',
                    operation: 'invokeWithImage',
                    base64Size: imageUrl.length,
                    sizeMB,
                    maxSizeMB,
                    userId
                });
                
                throw new Error(
                    `Image too large (${sizeMB}MB). AWS Bedrock limit is ${maxSizeMB}MB. Please compress the image before uploading.`
                );
            }
            
            loggingService.info('Base64 size validation passed', {
                component: 'BedrockService',
                base64Size: imageUrl.length,
                sizeMB: (imageUrl.length / (1024 * 1024)).toFixed(2),
                maxSizeMB: (maxBase64Size / (1024 * 1024)).toFixed(2)
            });
        }
        
        try {
            // Fetch the image
            let imageBuffer: Buffer;
            let imageType: string;
            let imageBase64: string = ''; // Initialize to empty string // Store base64 directly for data URLs

            if (imageUrl.startsWith('data:image')) {
                // Handle base64 data URL
                loggingService.info('Processing base64 data URL', {
                    component: 'BedrockService',
                    urlLength: imageUrl.length,
                    urlPrefix: imageUrl.substring(0, 100)
                });
                
                const matches = imageUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/s);
                if (!matches) {
                    loggingService.error('Failed to match base64 data URL pattern', {
                        component: 'BedrockService',
                        urlPrefix: imageUrl.substring(0, 200)
                    });
                    throw new Error('Invalid base64 data URL format');
                }
                const [, format, base64Data] = matches;
                
                loggingService.info('Extracted base64 data from URL', {
                    component: 'BedrockService',
                    format,
                    rawBase64Length: base64Data.length,
                    rawBase64Prefix: base64Data.substring(0, 100),
                    hasWhitespace: /\s/.test(base64Data)
                });
                
                // CRITICAL FIX: Remove ALL non-base64 characters
                // Only keep: A-Z, a-z, 0-9, +, /, = (padding)
                imageBase64 = base64Data.replace(/[^A-Za-z0-9+/=]/g, '');
                
                loggingService.info('Cleaned base64 data (strict RFC 4648)', {
                    component: 'BedrockService',
                    originalLength: base64Data.length,
                    cleanedLength: imageBase64.length,
                    removedChars: base64Data.length - imageBase64.length,
                    cleanedPrefix: imageBase64.substring(0, 100),
                    cleanedSuffix: imageBase64.substring(imageBase64.length - 20)
                });
                
                // Validate base64 data
                if (!imageBase64 || imageBase64.length === 0) {
                    throw new Error('Empty base64 data after cleaning');
                }
                
                // Test if base64 is valid by trying to decode it
                try {
                    const testBuffer = Buffer.from(imageBase64, 'base64');
                    if (testBuffer.length === 0) {
                        throw new Error('Base64 decoded to empty buffer');
                    }
                    imageBuffer = testBuffer; // Store for size calculation
                    
                    loggingService.info('Successfully decoded base64 to buffer', {
                        component: 'BedrockService',
                        bufferLength: testBuffer.length,
                        base64Length: imageBase64.length
                    });
                } catch (error) {
                    loggingService.error('Failed to decode base64 data', {
                        component: 'BedrockService',
                        error: error instanceof Error ? error.message : String(error),
                        base64Length: imageBase64.length,
                        base64Prefix: imageBase64.substring(0, 100),
                        base64Suffix: imageBase64.substring(imageBase64.length - 100)
                    });
                    throw new Error(`Invalid base64 data: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
                
                imageType = `image/${format}`;
            } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                // Download from URL
                const response = await fetch(imageUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image: ${response.statusText}`);
                }
                imageBuffer = Buffer.from(await response.arrayBuffer());
                imageType = response.headers.get('content-type') || 'image/jpeg';
                // Convert to base64
                imageBase64 = imageBuffer.toString('base64');
            } else if (imageUrl.startsWith('s3://')) {
                // Generate presigned URL and fetch via HTTP (produces cleaner buffer)
                const s3Key = S3Service.s3UrlToKey(imageUrl);
                const presignedUrl = await S3Service.generatePresignedUrl(s3Key, 3600);
                
                loggingService.info('Fetching image from S3 via HTTP presigned URL', {
                    component: 'BedrockService',
                    s3Key,
                    operation: 'invokeWithImage'
                });
                
                const response = await fetch(presignedUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image from S3: ${response.statusText}`);
                }
                
                // Get clean buffer from HTTP response
                imageBuffer = Buffer.from(await response.arrayBuffer());
                
                loggingService.info('Image fetched successfully via HTTP', {
                    component: 'BedrockService',
                    bufferSize: imageBuffer.length,
                    contentType: response.headers.get('content-type')
                });
                
                // Set image type from content-type header or default to JPEG
                const contentType = response.headers.get('content-type');
                if (contentType) {
                    if (contentType.includes('png')) {
                        imageType = 'image/png';
                    } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
                        imageType = 'image/jpeg';
                    } else if (contentType.includes('webp')) {
                        imageType = 'image/webp';
                    } else if (contentType.includes('gif')) {
                        imageType = 'image/gif';
                    } else {
                        imageType = 'image/jpeg'; // Default for unknown types
                    }
                } else {
                    imageType = 'image/jpeg'; // Default if no content-type header
                }
                
                // imageBase64 will be set after sharp processing below
            } else {
                throw new Error('Invalid image URL format');
            }

            // Determine image media type
            let mediaType = 'image/jpeg';
            if (imageType.includes('png')) {
                mediaType = 'image/png';
            } else if (imageType.includes('webp')) {
                mediaType = 'image/webp';
            } else if (imageType.includes('gif')) {
                mediaType = 'image/gif';
            }

            // TEMPORARY TEST: Skip Sharp processing to test if it's causing corruption
            // Use the raw buffer directly
            const processedBuffer = imageBuffer;
            
            loggingService.info('TESTING: Using raw buffer without Sharp processing', {
                component: 'BedrockService',
                bufferSize: imageBuffer.length,
                originalType: imageType
            });
            
            // Convert processed buffer to base64
            // IMPORTANT: For data URIs, imageBase64 is already cleaned and validated (line 862)
            // For other sources (HTTP, S3), we need to encode the buffer
            const finalBase64 = imageBase64 || processedBuffer.toString('base64');
            
            // Validate the base64 string
            if (!finalBase64 || finalBase64.length === 0) {
                throw new Error('Base64 encoding resulted in empty string');
            }
            
            // Verify it can be decoded back (validation test)
            try {
                const testDecode = Buffer.from(finalBase64, 'base64');
                if (testDecode.length !== processedBuffer.length) {
                    throw new Error('Base64 round-trip validation failed');
                }
            } catch (error) {
                loggingService.error('Base64 validation failed', {
                    component: 'BedrockService',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    base64Length: finalBase64.length,
                    bufferLength: processedBuffer.length
                });
                throw new Error('Invalid base64 encoding');
            }
            
            loggingService.info('Base64 encoding validated successfully', {
                component: 'BedrockService',
                base64Length: finalBase64.length,
                bufferLength: processedBuffer.length,
                mediaType
            });

            // Build the Bedrock API payload
            // AWS Bedrock Anthropic Messages API ONLY supports base64 images
            // URL-based images are NOT supported
            
            // CRITICAL FIX: AWS Bedrock requires STRICTLY RFC 4648 compliant base64
            // Step 1: Remove ALL whitespace characters
            const cleanedBase64 = finalBase64
                .replace(/[\r\n\s\t]/g, '');  // Remove all whitespace characters
            
            // Step 2: Remove any existing padding
            const base64WithoutPadding = cleanedBase64.replace(/=+$/, '');
            
            // Step 3: Calculate correct padding
            const paddingNeeded = (4 - (base64WithoutPadding.length % 4)) % 4;
            
            // Step 4: Add correct padding
            const properlyPaddedBase64 = base64WithoutPadding + '='.repeat(paddingNeeded);
            
            // Validate: Final base64 string length must be multiple of 4
            if (properlyPaddedBase64.length % 4 !== 0) {
                throw new Error(`Invalid base64 padding: length ${properlyPaddedBase64.length} is not multiple of 4`);
            }
            
            // Validate: Test that we can decode the base64 back to a buffer
            try {
                const testDecodeBuffer = Buffer.from(properlyPaddedBase64, 'base64');
                if (testDecodeBuffer.length !== processedBuffer.length) {
                    loggingService.warn('Base64 decode length mismatch after cleaning/padding', {
                        component: 'BedrockService',
                        originalBufferLength: processedBuffer.length,
                        decodedBufferLength: testDecodeBuffer.length,
                        difference: Math.abs(testDecodeBuffer.length - processedBuffer.length)
                    });
                }
            } catch (decodeError) {
                loggingService.error('Failed to validate cleaned base64', {
                    component: 'BedrockService',
                    error: decodeError instanceof Error ? decodeError.message : 'Unknown error',
                    base64Length: properlyPaddedBase64.length,
                    base64Sample: properlyPaddedBase64.substring(0, 50)
                });
                throw new Error('Base64 validation failed after cleaning/padding');
            }
            
            // FINAL SIZE VALIDATION: Check if base64 is within AWS Bedrock limits
            const maxBase64Size = 4.5 * 1024 * 1024; // 4.5MB safe limit for base64 content
            if (properlyPaddedBase64.length > maxBase64Size) {
                const sizeMB = (properlyPaddedBase64.length / (1024 * 1024)).toFixed(2);
                const maxSizeMB = (maxBase64Size / (1024 * 1024)).toFixed(2);
                
                loggingService.error('Final base64 exceeds AWS Bedrock safe limit', {
                    component: 'BedrockService',
                    operation: 'invokeWithImage',
                    base64Size: properlyPaddedBase64.length,
                    sizeMB,
                    maxSizeMB,
                    userId
                });
                
                throw new Error(
                    `Processed image too large (${sizeMB}MB). AWS Bedrock safe limit is ${maxSizeMB}MB. Please use a smaller image.`
                );
            }
            
            loggingService.info('Building Bedrock payload with RFC 4648 compliant base64', {
                component: 'BedrockService',
                operation: 'invokeWithImage',
                originalBase64Length: finalBase64.length,
                cleanedBase64Length: cleanedBase64.length,
                withoutPaddingLength: base64WithoutPadding.length,
                paddedBase64Length: properlyPaddedBase64.length,
                paddingAdded: paddingNeeded,
                isMultipleOf4: properlyPaddedBase64.length % 4 === 0,
                mediaType,
                firstChars: properlyPaddedBase64.substring(0, 20),
                lastChars: properlyPaddedBase64.substring(properlyPaddedBase64.length - 20),
                sizeMB: (properlyPaddedBase64.length / (1024 * 1024)).toFixed(2)
            });
            
            const payload: any = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: this.getMaxTokensForModel(modelId),
                temperature: 0.7,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: mediaType,
                                    data: properlyPaddedBase64  // Use properly padded base64
                                }
                            },
                            {
                                type: 'text',
                                text: prompt
                            }
                        ]
                    }
                ]
            };

            // Convert model ID to inference profile if needed
            const actualModelId = this.convertToInferenceProfile(modelId);

            // Log the complete payload structure for debugging (without full base64)
            loggingService.info('Bedrock payload prepared', {
                component: 'BedrockService',
                operation: 'invokeWithImage',
                payloadStructure: {
                    anthropic_version: payload.anthropic_version,
                    max_tokens: payload.max_tokens,
                    temperature: payload.temperature,
                    messagesCount: payload.messages.length,
                    message: {
                        role: payload.messages[0].role,
                        contentLength: payload.messages[0].content.length,
                        contentTypes: payload.messages[0].content.map((c: any) => c.type),
                        imageSource: {
                            type: (payload.messages[0].content[0] as any).source?.type,
                            media_type: (payload.messages[0].content[0] as any).source?.media_type,
                            dataLength: (payload.messages[0].content[0] as any).source?.data?.length,
                            dataType: typeof (payload.messages[0].content[0] as any).source?.data,
                            dataPreview: (payload.messages[0].content[0] as any).source?.data?.substring(0, 50)
                        },
                        textContent: (payload.messages[0].content[1] as any).text?.substring(0, 100)
                    }
                },
                modelId: actualModelId,
                imageSize: processedBuffer.length,
                mediaType,
                base64Length: finalBase64.length
            });

            // Validate payload structure before sending (image at index 0, text at index 1)
            const imageContent = payload.messages[0].content[0] as any;
            if (!imageContent.source || !imageContent.source.data || typeof imageContent.source.data !== 'string') {
                throw new Error('Invalid payload structure: image data must be a string');
            }

            // Serialize payload - use standard JSON.stringify
            // The AWS SDK will handle proper encoding
            const payloadJson = JSON.stringify(payload);
            
            loggingService.info('Payload serialization for Bedrock', {
                component: 'BedrockService',
                operation: 'invokeWithImage',
                payloadLength: payloadJson.length,
                imageDataLength: (payload.messages[0].content[0] as any).source.data.length,
                mediaType,
                hasValidBase64: /^[A-Za-z0-9+/=]+$/.test((payload.messages[0].content[0] as any).source.data)
            });

            // CRITICAL DEBUG: Log the exact base64 that will be sent to AWS
            const imageData = (payload.messages[0].content[0] as any).source.data;
            loggingService.info('FINAL BASE64 CHECK BEFORE AWS BEDROCK', {
                component: 'BedrockService',
                base64Length: imageData.length,
                base64IsString: typeof imageData === 'string',
                base64First100: imageData.substring(0, 100),
                base64Last100: imageData.substring(Math.max(0, imageData.length - 100)),
                isValidBase64Chars: /^[A-Za-z0-9+/=]+$/.test(imageData),
                hasWhitespace: /\s/.test(imageData),
                isMultipleOf4: imageData.length % 4 === 0,
                mediaType
            });
            
            // AWS SDK InvokeModelCommand - use string body, not Uint8Array
            // The SDK handles encoding internally
            const command = new InvokeModelCommand({
                modelId: actualModelId,
                contentType: 'application/json',
                accept: 'application/json',
                body: payloadJson  // Just use the JSON string
            });

            loggingService.info('Invoking Claude with image', {
                component: 'BedrockService',
                operation: 'invokeWithImage',
                modelId: actualModelId,
                commandBodyLength: payloadJson.length
            });

            // Use standardized retry logic
            const response = await ServiceHelper.withRetry(
                async () => await bedrockClient.send(command),
                { maxRetries: 3, delayMs: 1000 }
            );

            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            // Extract response text
            let responseText = '';
            if (responseBody.content && Array.isArray(responseBody.content)) {
                const textContent = responseBody.content.find((c: any) => c.type === 'text');
                responseText = textContent?.text || '';
            }

            // Get token usage
            const inputTokens = responseBody.usage?.input_tokens || 0;
            const outputTokens = responseBody.usage?.output_tokens || 0;

            // Calculate cost
            const cost = calculateCost(
                inputTokens,
                outputTokens,
                AIProvider.AWSBedrock,
                modelId
            );

            // Record usage
            await recordGenAIUsage({
                provider: AIProvider.AWSBedrock,
                operationName: 'vision-analysis',
                model: modelId,
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                costUSD: cost,
                userId,
                requestId: `vision-${Date.now()}`
            });

            // Track via AICostTrackingService
            AICostTrackingService.trackCall({
                userId,
                service: AIProvider.AWSBedrock,
                model: modelId,
                operation: 'vision-analysis',
                inputTokens,
                outputTokens,
                estimatedCost: cost,
                latency: Date.now() - startTime,
                success: true,
                metadata: {
                    imageSize: imageBuffer.length,
                    mediaType
                }
            });

            loggingService.info('Claude with image invocation completed', {
                component: 'BedrockService',
                operation: 'invokeWithImage',
                inputTokens,
                outputTokens,
                cost,
                latency: Date.now() - startTime
            });

            return {
                response: responseText,
                inputTokens,
                outputTokens,
                cost
            };

        } catch (error) {
            loggingService.error('Error invoking Claude with image', {
                component: 'BedrockService',
                operation: 'invokeWithImage',
                error: error instanceof Error ? error.message : String(error),
                modelId
            });

            // Track failure
            AICostTrackingService.trackCall({
                userId,
                service: AIProvider.AWSBedrock,
                model: modelId,
                operation: 'vision-analysis',
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latency: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });

            throw error;
        }
    }

    /**
     * Extract model names from search results using Nova Pro
     * Phase 1 of model discovery
     */
    static async extractModelsFromText(provider: string, searchText: string): Promise<LLMExtractionResult> {
        try {
            const prompt = `Analyze the following search results about ${provider} AI models and extract a list of all model names/IDs mentioned.

Search Content:
${searchText}

Your task: Extract ONLY the model names or model IDs. Return a JSON array of strings.

Example output format:
["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "claude-3-5-sonnet", "gemini-1.5-pro"]

Rules:
1. Include ONLY official model names/IDs, not marketing names
2. Include version numbers if present (e.g., "gpt-4-turbo", "claude-3-5-sonnet-20241022")
3. Do NOT include pricing information
4. Do NOT include descriptions or explanations
5. Return ONLY the JSON array, nothing else

Return your response as a valid JSON array:`;

            const result = await this.invokeModel(
                prompt,
                'us.amazon.nova-pro-v1:0'
            );

            // Parse the JSON response
            let models: string[];
            try {
                const cleanResponse = result.trim()
                    .replace(/^```json\n?/, '')
                    .replace(/\n?```$/, '')
                    .trim();
                models = JSON.parse(cleanResponse);
            } catch (parseError) {
                loggingService.error('Failed to parse model names from LLM response', {
                    response: result,
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
                return {
                    success: false,
                    error: 'Failed to parse JSON response',
                    prompt,
                    response: result
                };
            }

            loggingService.info(`Extracted ${models.length} models for ${provider}`, {
                provider,
                modelsCount: models.length
            });

            return {
                success: true,
                data: models,
                prompt,
                response: result.result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error extracting models from text', {
                provider,
                error: errorMessage
            });
            return {
                success: false,
                error: errorMessage,
                prompt: '',
                response: ''
            };
        }
    }

    /**
     * Extract pricing data from search results using Nova Pro
     * Phase 2 of model discovery
     */
    static async extractPricingFromText(
        provider: string,
        modelName: string,
        searchText: string
    ): Promise<LLMExtractionResult> {
        try {
            const prompt = `Analyze the following search results about ${provider}'s ${modelName} model and extract precise pricing information.

Search Content:
${searchText}

Return ONLY valid JSON with this exact structure:
{
  "modelId": "exact-model-identifier",
  "modelName": "Human readable name",
  "inputPricePerMToken": 2.50,
  "outputPricePerMToken": 10.00,
  "cachedInputPricePerMToken": 1.25,
  "contextWindow": 128000,
  "capabilities": ["text", "multimodal", "code"],
  "category": "text",
  "isLatest": true
}

CRITICAL PRICING CONVERSION RULES:
- Prices MUST be in dollars per MILLION tokens (not per 1K tokens)
- If you see "$2.50 per 1M tokens" or "$2.50 per million tokens" → use 2.50
- If you see "$0.50 per 1K tokens" or "$0.50 per thousand tokens" → convert to 500.0 (multiply by 1000)
- If you see "$15 per 1M tokens" → use 15.0
- DO NOT multiply prices that are already per million tokens!

**CRITICAL DECIMAL HANDLING:**
- When parsing numbers, ensure that decimal points are correctly interpreted
- For example, "$1.750" means ONE dollar and 75 cents, NOT $1750!
- Always treat a period (.) as a decimal separator
- "$1.750 per 1M tokens" → 1.75 (NOT 1750)
- "$0.075 per 1M tokens" → 0.075 (NOT 75)

FIELD REQUIREMENTS:
- modelId: Use the exact technical identifier (e.g., "gpt-4o", "claude-3-5-sonnet-20241022")
- modelName: Human-readable name (e.g., "GPT-4o", "Claude 3.5 Sonnet")
- inputPricePerMToken: MUST be a number in dollars per million tokens
- outputPricePerMToken: MUST be a number in dollars per million tokens
- cachedInputPricePerMToken: Optional, only if cached pricing exists
- contextWindow: Maximum context window in tokens (e.g., 128000, 200000)
- capabilities: Array of strings like "text", "multimodal", "code", "reasoning", "vision", "image"
- category: ONE of: "text", "multimodal", "embedding", "code"
- isLatest: true if this is the newest/recommended model, false otherwise

EXAMPLES OF CORRECT CONVERSIONS:
- "$2.50 per 1M tokens" → inputPricePerMToken: 2.50
- "$10.00 per million tokens" → outputPricePerMToken: 10.00
- "$0.15 per 1M tokens" → inputPricePerMToken: 0.15
- "$0.50 per 1K tokens" → inputPricePerMToken: 500.0
- "$30 per million tokens" → outputPricePerMToken: 30.0
- "$1.750 per 1M tokens" → inputPricePerMToken: 1.75 (ONE dollar and 75 cents)
- "$0.075 per 1M tokens" → inputPricePerMToken: 0.075 (7.5 cents)

Return ONLY the JSON object, no markdown formatting, no additional text.`;

            const result = await this.invokeModel(
                prompt,
                'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
            );

            // Parse the JSON response
            let pricingData: RawPricingData;
            try {
                const cleanResponse = result.trim()
                    .replace(/^```json\n?/, '')
                    .replace(/\n?```$/, '')
                    .trim();
                pricingData = JSON.parse(cleanResponse);
            } catch (parseError) {
                loggingService.error('Failed to parse pricing data from LLM response', {
                    modelName,
                    response: result,
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
                return {
                    success: false,
                    error: 'Failed to parse JSON response',
                    prompt,
                    response: result
                };
            }

            loggingService.info(`Extracted pricing for ${provider} ${modelName}`, {
                provider,
                modelName,
                inputPrice: pricingData.inputPricePerMToken,
                outputPrice: pricingData.outputPricePerMToken
            });

            return {
                success: true,
                data: pricingData,
                prompt,
                response: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error extracting pricing from text', {
                provider,
                modelName,
                error: errorMessage
            });
            return {
                success: false,
                error: errorMessage,
                prompt: '',
                response: ''
            };
        }
    }
}