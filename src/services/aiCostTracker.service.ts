import { logger } from '../utils/logger';
import { ProjectService } from './project.service';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { ActivityService } from './activity.service';
import {
    AIProvider,
    OptimizationResult,
    TrackerConfig,
    ProviderConfig,
    OptimizationConfig,
    TrackingConfig
} from '../types/aiCostTracker.types';
import { calculateCost, estimateCost, getModelPricing } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { generateOptimizationSuggestions, applyOptimizations } from '../utils/optimizationUtils';

export class AICostTrackerService {
    private static config: TrackerConfig | null = null;
    private static initialized = false;

    /**
     * Initializes the internal cost tracker configuration
     */
    static async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const providers: ProviderConfig[] = [];

        if (process.env.OPENAI_API_KEY) {
            providers.push({
                provider: AIProvider.OpenAI,
                apiKey: process.env.OPENAI_API_KEY
            });
        }

        if (process.env.AWS_REGION) {
            providers.push({
                provider: AIProvider.AWSBedrock,
                region: process.env.AWS_REGION
            });
        }

        if (process.env.ANTHROPIC_API_KEY) {
            providers.push({
                provider: AIProvider.Anthropic,
                apiKey: process.env.ANTHROPIC_API_KEY
            });
        }

        if (process.env.GOOGLE_AI_API_KEY) {
            providers.push({
                provider: AIProvider.Google,
                apiKey: process.env.GOOGLE_AI_API_KEY
            });
        }

        if (process.env.COHERE_API_KEY) {
            providers.push({
                provider: AIProvider.Cohere,
                apiKey: process.env.COHERE_API_KEY
            });
        }

        if (providers.length === 0) {
            logger.warn('No AI provider API keys configured. Adding default OpenAI provider for tracking purposes only.');
            providers.push({
                provider: AIProvider.OpenAI,
                apiKey: 'dummy-key-for-tracking-only'
            });
        }

        const optimization: OptimizationConfig = {
            enablePromptOptimization: true,
            enableModelSuggestions: true,
            enableCachingSuggestions: true,
            enableCompression: true,
            enableContextTrimming: true,
            enableRequestFusion: true,
            bedrockConfig: {
                region: process.env.AWS_REGION || 'us-east-1',
                modelId: 'anthropic.claude-3-haiku-20240307-v1:0'
            },
            compressionSettings: {
                minCompressionRatio: 0.7,
                jsonCompressionThreshold: 100
            },
            contextTrimmingSettings: {
                maxContextLength: 4000,
                preserveRecentMessages: 3,
                summarizationModel: 'anthropic.claude-3-haiku-20240307-v1:0'
            },
            requestFusionSettings: {
                maxFusionBatch: 5,
                fusionWaitTime: 5000
            },
            thresholds: {
                highCostPerRequest: 0.01,
                highTokenUsage: 10000,
                frequencyThreshold: 1000
            }
        };

        const tracking: TrackingConfig = {
            enableAutoTracking: true,
            retentionDays: 90
        };

        this.config = {
            providers,
            optimization,
            tracking
        };

        this.initialized = true;

        logger.info('Internal AI Cost Tracker initialized successfully', {
            providersConfigured: providers.length,
            providers: providers.map(p => p.provider)
        });
    }

    /**
     * Returns the tracker configuration
     */
    static async getConfig(): Promise<TrackerConfig> {
        await this.initialize();
        return this.config!;
    }

    /**
     * Track a request and response
     */
    static async trackRequest(
        request: any,
        response: any,
        userId: string,
        metadata?: {
            service?: string;
            endpoint?: string;
            historicalSync?: boolean;
            originalCreatedAt?: Date;
            projectId?: string;
            tags?: string[];
            costAllocation?: Record<string, any>;
            promptTemplateId?: string;
        }
    ): Promise<void> {
        try {
            await this.initialize();

            // Extract usage data
            const promptTokens = response.usage?.promptTokens || request.promptTokens || 0;
            const completionTokens = response.usage?.completionTokens || request.completionTokens || 0;
            const totalTokens = response.usage?.totalTokens || (promptTokens + completionTokens);

            // If tokens are not provided, estimate them
            let finalPromptTokens = promptTokens;
            let finalCompletionTokens = completionTokens;
            let finalTotalTokens = totalTokens;

            if (finalPromptTokens === 0 && request.prompt) {
                const provider = this.mapServiceToProvider(metadata?.service || 'openai');
                finalPromptTokens = estimateTokens(request.prompt, provider);
            }

            if (finalCompletionTokens === 0 && (response.content || response.choices?.[0]?.message?.content)) {
                const provider = this.mapServiceToProvider(metadata?.service || 'openai');
                const completion = response.content || response.choices?.[0]?.message?.content || '';
                finalCompletionTokens = estimateTokens(completion, provider);
            }

            finalTotalTokens = finalPromptTokens + finalCompletionTokens;

            // Calculate cost
            const provider = this.mapServiceToProvider(metadata?.service || 'openai');
            const providerString = this.providerEnumToString(provider);
            const estimatedCost = calculateCost(
                finalPromptTokens,
                finalCompletionTokens,
                providerString,
                request.model
            );

            // Check if approval is required for project
            if (metadata?.projectId && !metadata?.historicalSync) {
                const requiresApproval = await ProjectService.checkApprovalRequired(
                    metadata.projectId,
                    estimatedCost,
                );

                if (requiresApproval) {
                    const approvalRequest = await ProjectService.createApprovalRequest(
                        userId,
                        metadata.projectId,
                        {
                            operation: 'API Call',
                            estimatedCost: estimatedCost,
                            estimatedTokens: finalTotalTokens,
                            model: request.model,
                            prompt: request.prompt?.substring(0, 500),
                            reason: 'Exceeds project approval threshold'
                        }
                    );

                    throw new Error(`Approval required. Request ID: ${approvalRequest._id}`);
                }
            }
            console.log("metadatametadatametadata", metadata)
            // Save to database
            await Usage.create({
                userId,
                projectId: metadata?.projectId,
                service: metadata?.service || 'openai',
                model: request.model,
                prompt: request.prompt || '',
                completion: response.content || response.choices?.[0]?.message?.content || '',
                promptTokens: finalPromptTokens,
                completionTokens: finalCompletionTokens,
                totalTokens: finalTotalTokens,
                cost: estimatedCost,
                responseTime: metadata?.endpoint ? 100 : 0,
                metadata: {
                    ...metadata,
                    promptTemplateId: metadata?.promptTemplateId
                },
                tags: metadata?.tags || [],
                costAllocation: metadata?.costAllocation,
                optimizationApplied: false,
                errorOccurred: false,
                createdAt: metadata?.originalCreatedAt || new Date()
            });

            // Update user monthly usage
            await User.findByIdAndUpdate(userId, {
                $inc: {
                    'monthlyUsage.totalCost': estimatedCost,
                    'monthlyUsage.totalTokens': finalTotalTokens,
                    'monthlyUsage.requestCount': 1
                }
            });

            // Log activity if not historical sync
            if (!metadata?.historicalSync) {
                await ActivityService.trackActivity(userId, {
                    type: 'api_call',
                    title: `Made AI request using ${request.model}`,
                    description: `AI request with ${finalTotalTokens} tokens and cost $${estimatedCost.toFixed(6)}`,
                    metadata: {
                        model: request.model,
                        tokens: finalTotalTokens,
                        cost: estimatedCost,
                        projectId: metadata?.projectId
                    }
                });
            }

            logger.debug('Usage tracked successfully', {
                userId,
                model: request.model,
                tokens: finalTotalTokens,
                cost: estimatedCost,
                projectId: metadata?.projectId
            });

        } catch (error) {
            logger.error('Error tracking usage:', error);
            throw error;
        }
    }

    /**
     * Generate optimization suggestions for a prompt
     */
    static async generateOptimizations(
        prompt: string,
        provider: AIProvider,
        model: string,
        conversationHistory?: any[]
    ): Promise<OptimizationResult> {
        await this.initialize();

        return generateOptimizationSuggestions(
            prompt,
            provider,
            model,
            conversationHistory
        );
    }

    /**
     * Apply optimizations to a prompt
     */
    static async applyOptimizations(
        prompt: string,
        optimizations: any[],
        conversationHistory?: any[]
    ): Promise<{
        optimizedPrompt: string;
        optimizedHistory?: any[];
        appliedOptimizations: string[];
    }> {
        await this.initialize();

        return applyOptimizations(prompt, optimizations, conversationHistory);
    }

    /**
     * Estimate cost for a request before making it
     */
    static async estimateRequestCost(
        prompt: string,
        model: string,
        provider: AIProvider,
        expectedCompletionTokens: number = 150
    ): Promise<{
        promptCost: number;
        completionCost: number;
        totalCost: number;
        currency: string;
        breakdown: {
            promptTokens: number;
            completionTokens: number;
            pricePerPromptToken: number;
            pricePerCompletionToken: number;
        };
    }> {
        await this.initialize();

        const promptTokens = estimateTokens(prompt, provider);
        const providerString = this.providerEnumToString(provider);
        const costEstimate = estimateCost(promptTokens, expectedCompletionTokens, providerString, model);

        // Convert to the expected format
        const modelPricing = getModelPricing(providerString, model);
        const inputPricePerToken = modelPricing ? modelPricing.inputPrice / 1000000 : 0;
        const outputPricePerToken = modelPricing ? modelPricing.outputPrice / 1000000 : 0;

        return {
            promptCost: costEstimate.inputCost,
            completionCost: costEstimate.outputCost,
            totalCost: costEstimate.totalCost,
            currency: 'USD',
            breakdown: {
                promptTokens,
                completionTokens: expectedCompletionTokens,
                pricePerPromptToken: inputPricePerToken,
                pricePerCompletionToken: outputPricePerToken
            }
        };
    }

    /**
     * Map service string to AIProvider enum
     */
    private static mapServiceToProvider(service: string): AIProvider {
        const serviceMap: Record<string, AIProvider> = {
            'openai': AIProvider.OpenAI,
            'aws-bedrock': AIProvider.AWSBedrock,
            'bedrock': AIProvider.AWSBedrock,
            'anthropic': AIProvider.Anthropic,
            'google': AIProvider.Google,
            'cohere': AIProvider.Cohere,
            'gemini': AIProvider.Gemini,
            'deepseek': AIProvider.DeepSeek,
            'groq': AIProvider.Groq,
            'huggingface': AIProvider.HuggingFace,
            'ollama': AIProvider.Ollama,
            'replicate': AIProvider.Replicate,
            'azure': AIProvider.Azure
        };

        return serviceMap[service.toLowerCase()] || AIProvider.OpenAI;
    }

    /**
     * Map AIProvider enum to string for pricing functions
     */
    private static providerEnumToString(provider: AIProvider): string {
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
     * Make a tracked request (placeholder for future implementation)
     */
    static async makeTrackedRequest(
        request: any,
        userId: string,
        metadata?: any
    ): Promise<any> {
        // This would be implemented to make actual API calls to providers
        // For now, we'll just track the usage and return a mock response

        const mockResponse = {
            content: 'Mock response for tracking purposes',
            usage: {
                promptTokens: estimateTokens(request.prompt || '', AIProvider.OpenAI),
                completionTokens: 50,
                totalTokens: 0
            }
        };

        mockResponse.usage.totalTokens = mockResponse.usage.promptTokens + mockResponse.usage.completionTokens;

        await this.trackRequest(request, mockResponse, userId, metadata);

        return mockResponse;
    }

    /**
     * Get usage analytics
     */
    static async getUsageAnalytics(
        userId: string,
        projectId?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<any> {
        await this.initialize();

        const query: any = { userId };

        if (projectId) {
            query.projectId = projectId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = startDate;
            if (endDate) query.createdAt.$lte = endDate;
        }

        const usage = await Usage.find(query);

        const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
        const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0);
        const averageTokensPerRequest = usage.length > 0 ? totalTokens / usage.length : 0;

        // Group by model
        const modelUsage = usage.reduce((acc, u) => {
            const key = `${u.service}-${u.model}`;
            if (!acc[key]) {
                acc[key] = {
                    model: u.model,
                    provider: this.mapServiceToProvider(u.service),
                    requestCount: 0,
                    totalTokens: 0,
                    totalCost: 0,
                    averageCostPerRequest: 0
                };
            }
            acc[key].requestCount++;
            acc[key].totalTokens += u.totalTokens;
            acc[key].totalCost += u.cost;
            acc[key].averageCostPerRequest = acc[key].totalCost / acc[key].requestCount;
            return acc;
        }, {} as any);

        return {
            totalCost,
            totalTokens,
            averageTokensPerRequest,
            mostUsedModels: Object.values(modelUsage),
            requestCount: usage.length,
            dateRange: {
                start: startDate,
                end: endDate
            }
        };
    }
} 