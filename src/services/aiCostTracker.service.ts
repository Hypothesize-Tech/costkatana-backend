import AICostTracker, { AIProvider } from 'ai-cost-tracker';
import { logger } from '../utils/logger';
import { ProjectService } from './project.service';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { ActivityService } from './activity.service';

export class AICostTrackerService {
    private static tracker: AICostTracker | null = null;
    private static initPromise: Promise<AICostTracker> | null = null;

    /**
     * Initializes the AICostTracker instance.
     * This method is called once and subsequent calls will return the existing promise.
     */
    static async initialize(): Promise<AICostTracker> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.createTracker();
        this.tracker = await this.initPromise;
        return this.tracker;
    }

    /**
     * Creates and configures the AICostTracker instance.
     */
    private static async createTracker(): Promise<AICostTracker> {
        const providers = [];

        if (process.env.OPENAI_API_KEY) {
            providers.push({ provider: AIProvider.OpenAI, apiKey: process.env.OPENAI_API_KEY });
        }

        if (process.env.AWS_REGION) {
            providers.push({ provider: AIProvider.AWSBedrock, region: process.env.AWS_REGION });
        }

        if (process.env.ANTHROPIC_API_KEY) {
            providers.push({ provider: AIProvider.Anthropic, apiKey: process.env.ANTHROPIC_API_KEY });
        }

        if (process.env.GOOGLE_AI_API_KEY) {
            providers.push({ provider: AIProvider.Google, apiKey: process.env.GOOGLE_AI_API_KEY });
        }

        if (process.env.COHERE_API_KEY) {
            providers.push({ provider: AIProvider.Cohere, apiKey: process.env.COHERE_API_KEY });
        }

        if (providers.length === 0) {
            logger.warn('No AI provider API keys configured. Adding default OpenAI provider with empty key for tracking purposes only.');
            providers.push({ provider: AIProvider.OpenAI, apiKey: 'dummy-key-for-tracking-only' });
        }

        const tracker = await AICostTracker.create({
            providers,
            tracking: {
                enableAutoTracking: true,
                retentionDays: 90
            },
            optimization: {
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
            }
        });

        logger.info('AI Cost Tracker initialized successfully', {
            providersConfigured: providers.length,
            providers: providers.map(p => p.provider)
        });
        return tracker;
    }

    /**
     * Returns the singleton AICostTracker instance.
     * Ensures the tracker is initialized before returning.
     */
    static async getTracker(): Promise<AICostTracker> {
        return this.initialize();
    }

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
            const tracker = await this.getTracker();

            // Extract usage data
            const promptTokens = response.usage?.promptTokens || request.promptTokens || 0;
            const completionTokens = response.usage?.completionTokens || request.completionTokens || 0;
            const totalTokens = response.usage?.totalTokens || (promptTokens + completionTokens);

            // Estimate cost (rough calculation)
            const estimatedCost = this.calculateCost(request.model, totalTokens);

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
                            estimatedTokens: totalTokens,
                            model: request.model,
                            prompt: request.prompt?.substring(0, 500),
                            reason: 'Exceeds project approval threshold'
                        }
                    );

                    throw new Error(`Approval required. Request ID: ${approvalRequest._id}`);
                }
            }

            // Track the usage
            const payload = {
                provider: metadata?.service || 'openai',
                model: request.model,
                promptTokens,
                completionTokens,
                totalTokens,
                prompt: request.prompt || '',
                estimatedCost,
                sessionId: userId
            };

            await tracker.trackUsage(payload);

            // Save to database
            const usage = await Usage.create({
                userId,
                projectId: metadata?.projectId,
                service: metadata?.service || 'openai',
                model: request.model,
                prompt: request.prompt || '',
                completion: response.content || response.choices?.[0]?.message?.content || '',
                promptTokens,
                completionTokens,
                totalTokens,
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
                    'usage.currentMonth.apiCalls': 1,
                    'usage.currentMonth.totalCost': estimatedCost,
                    'usage.currentMonth.totalTokens': totalTokens,
                },
            });

            // Update project spending if projectId is provided
            if (metadata?.projectId) {
                await ProjectService.updateProjectSpending(metadata.projectId, {
                    amount: estimatedCost,
                    userId,
                    usageId: usage._id.toString(),
                    model: request.model,
                    service: metadata?.service || 'openai'
                });
            }

            // Track API call activity
            await ActivityService.trackActivity(userId, {
                type: 'api_call',
                title: 'API Call Made',
                description: `${metadata?.service || 'openai'} - ${request.model} (${totalTokens} tokens)`,
                metadata: {
                    service: metadata?.service || 'openai',
                    model: request.model,
                    cost: estimatedCost,
                    tokens: totalTokens,
                    projectId: metadata?.projectId
                }
            });

            logger.info('Request tracked successfully', {
                userId,
                projectId: metadata?.projectId,
                service: metadata?.service || 'openai',
                model: request.model,
                cost: estimatedCost,
            });
        } catch (error) {
            logger.error('Error tracking request:', error);
            throw error;
        }
    }

    /**
     * Simple cost calculation based on model
     */
    private static calculateCost(model: string, tokens: number): number {
        // Simple pricing estimates (per 1K tokens)
        const pricing: Record<string, number> = {
            'gpt-4': 0.03,
            'gpt-4-turbo': 0.01,
            'gpt-3.5-turbo': 0.002,
            'claude-2': 0.008,
            'claude-instant': 0.0024,
            'default': 0.002
        };

        const pricePerToken = (pricing[model] || pricing.default) / 1000;
        return tokens * pricePerToken;
    }

    static async makeTrackedRequest(
        request: any,
        userId: string,
        metadata?: any
    ): Promise<any> {
        const tracker = await this.getTracker();

        let payload = { ...request, ...metadata, sessionId: userId };
        if (typeof payload.prompt !== 'string') {
            payload.prompt = '';
        }
        return tracker.makeRequest(payload);
    }
} 