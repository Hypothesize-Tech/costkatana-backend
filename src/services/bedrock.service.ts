import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, AWS_CONFIG } from '../config/aws';
import { retryBedrockOperation } from '../utils/bedrockRetry';
import { recordGenAIUsage } from '../utils/genaiTelemetry';
import { calculateCost } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types/aiCostTracker.types';
import { loggingService } from './logging.service';
import { AICostTrackingService } from './aiCostTracking.service';
import { decodeFromTOON, extractStructuredData } from '../utils/toon.utils';

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
     * Build messages array from recent conversation history (ChatGPT-style)
     */
    private static buildMessagesArray(
        recentMessages: Array<{ role: string; content: string }>,
        newMessage: string
    ): Array<{ role: 'user' | 'assistant'; content: string }> {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        
        // Convert recent messages to chronological order
        const chronological = [...recentMessages].reverse();
        
        // Add each message
        chronological.forEach(msg => {
            if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                messages.push({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content
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
        // Higher token limits for more capable models to ensure complete code generation
        if (modelId.includes('claude-opus-4')) {
            return 16384; // Claude Opus 4.1 - maximum capability for large code responses
        } else if (modelId.includes('claude-3-5-sonnet')) {
            return 12288; // Claude 3.5 Sonnet - enhanced for large outputs
        } else if (modelId.includes('claude-3-5-haiku')) {
            return 8192; // Claude 3.5 Haiku - increased for better performance
        } else if (modelId.includes('nova-pro')) {
            return 8000; // Nova Pro can handle larger outputs
        } else if (modelId.includes('nova')) {
            return 6000; // Other Nova models - increased limit
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
            'anthropic.claude-3-5-haiku-20241022-v1:0': `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
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

            // Use enhanced Bedrock retry logic with exponential backoff and jitter
            const response = await retryBedrockOperation(
                () => bedrockClient.send(command),
                {
                    maxRetries: 4,
                    baseDelay: 2000, // Start with 2 second delay
                    maxDelay: 30000, // Cap at 30 seconds
                    backoffMultiplier: 2, // Exponential backoff
                    jitterFactor: 0.25 // ±25% jitter
                },
                {
                    modelId: actualModelId,
                    operation: 'invokeModel'
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
}