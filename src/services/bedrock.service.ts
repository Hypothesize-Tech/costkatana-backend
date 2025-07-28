import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, AWS_CONFIG } from '../config/aws';
import { logger } from '../utils/logger';
import { retry } from '../utils/helpers';

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
     * Convert model ID to inference profile ARN if needed
     */
    private static convertToInferenceProfile(modelId: string): string {
        const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
        const regionPrefix = region.split('-')[0]; // us, eu, ap, etc.
        
        // Map of model IDs that need inference profile conversion
        const modelMappings: Record<string, string> = {
            // Anthropic Claude 3.5 models require inference profiles
            'anthropic.claude-3-5-haiku-20241022-v1:0': `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
            'anthropic.claude-3-5-sonnet-20241022-v2:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20241022-v2:0`,
            
            // Some regions may require inference profiles for other Claude models
            'anthropic.claude-3-opus-20240229-v1:0': `${regionPrefix}.anthropic.claude-3-opus-20240229-v1:0`,
            'anthropic.claude-3-sonnet-20240229-v1:0': `${regionPrefix}.anthropic.claude-3-sonnet-20240229-v1:0`,
            'anthropic.claude-3-haiku-20240307-v1:0': `${regionPrefix}.anthropic.claude-3-haiku-20240307-v1:0`,
        };

        return modelMappings[modelId] || modelId;
    }

    public static extractJson(text: string): string {
        if (!text) {
            return '';
        }

        // First, try to find JSON within code blocks
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
        const jsonBlockMatch = text.match(jsonBlockRegex);
        
        if (jsonBlockMatch && jsonBlockMatch[1]) {
            const extracted = jsonBlockMatch[1].trim();
            // Validate that it's actually JSON
            try {
                JSON.parse(extracted);
                return extracted;
            } catch (e) {
                // If it's not valid JSON, continue to other methods
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

    private static createMessagesPayload(prompt: string) {
        return {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: AWS_CONFIG.bedrock.maxTokens,
            temperature: AWS_CONFIG.bedrock.temperature,
            messages: [{ role: "user", content: prompt }],
        };
    }

    private static createNovaPayload(prompt: string) {
        return {
            messages: [{ role: "user", content: [{ text: prompt }] }],
            inferenceConfig: {
                max_new_tokens: AWS_CONFIG.bedrock.maxTokens,
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

    public static async invokeModel(prompt: string, model: string): Promise<any> {
        let payload: any;
        let responsePath: string;

        // Check model type and create appropriate payload
        if (model.includes('claude-3') || model.includes('claude-v3')) {
            // Modern Claude models (3.x) use messages format
            payload = this.createMessagesPayload(prompt);
            responsePath = 'content';
        } else if (model.includes('nova')) {
            // Amazon Nova models
            payload = this.createNovaPayload(prompt);
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
            payload = this.createMessagesPayload(prompt);
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
            payload = this.createMessagesPayload(prompt);
            responsePath = 'content';
        }

        // Convert model ID to inference profile if needed
        const actualModelId = this.convertToInferenceProfile(model);
        
        if (actualModelId !== model) {
            logger.info(`Converting model ID: ${model} -> ${actualModelId}`);
        }
        
        const command = new InvokeModelCommand({
            modelId: actualModelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(payload),
        });

        try {
            // Add exponential backoff for throttling with better error handling
            const response = await retry(
                () => bedrockClient.send(command), 
                4, // Increase retry attempts
                2000 // Start with 2 second delay
            );
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            // Extract text based on response format
            if (responsePath === 'content') {
                return responseBody.content[0].text;
            } else if (responsePath === 'nova') {
                return responseBody.output?.message?.content?.[0]?.text || responseBody.message?.content?.[0]?.text || '';
            } else if (responsePath === 'titan') {
                return responseBody.results?.[0]?.outputText || '';
            } else if (responsePath === 'llama') {
                return responseBody.generation || responseBody.outputs?.[0]?.text || '';
            } else if (responsePath === 'cohere') {
                return responseBody.text || responseBody.generations?.[0]?.text || '';
            } else if (responsePath === 'ai21') {
                return responseBody.completions?.[0]?.data?.text || responseBody.outputs?.[0]?.text || '';
            }
            return responseBody.completion || responseBody.text || '';
        } catch (error) {
            logger.error('Error invoking Bedrock model:', { 
                originalModel: model, 
                actualModelId, 
                error 
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
            const cleanedResponse = this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            logger.info('Prompt optimization completed', {
                originalLength: request.prompt.length,
                optimizedLength: result.optimizedPrompt.length,
                reduction: result.estimatedTokenReduction,
            });

            return result;
        } catch (error) {
            logger.error('Error optimizing prompt:', error);
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
            const cleanedResponse = this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            logger.info('Usage analysis completed', {
                timeframe: request.timeframe,
                promptsAnalyzed: request.usageData.length,
                potentialSavings: result.potentialSavings,
            });

            return result;
        } catch (error) {
            logger.error('Error analyzing usage patterns:', error);
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
            const cleanedResponse = this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            logger.info('Model alternatives suggested', {
                currentModel,
                alternativesCount: result.recommendations.length,
            });

            return result;
        } catch (error) {
            logger.error('Error suggesting model alternatives:', error);
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
            const cleanedResponse = this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            logger.info('Prompt template generated', { objective });

            return result;
        } catch (error) {
            logger.error('Error generating prompt template:', error);
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
            const cleanedResponse = this.extractJson(response);
            const result = JSON.parse(cleanedResponse);

            // Convert timestamp strings back to Date objects
            result.anomalies = result.anomalies.map((a: any) => ({
                ...a,
                timestamp: new Date(a.timestamp),
            }));

            logger.info('Anomaly detection completed', {
                anomaliesFound: result.anomalies.length,
            });

            return result;
        } catch (error) {
            logger.error('Error detecting anomalies:', error);
            throw error;
        }
    }
}