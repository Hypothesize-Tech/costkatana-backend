import AICostTracker, { AIProvider } from 'ai-cost-tracker';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { eventService } from './event.service';
import { Alert } from '../models/Alert';
import { EmailService } from './email.service';
import { UsageMetadata } from 'ai-cost-tracker/dist/types';

export class AICostTrackerService {
    private static tracker: AICostTracker | null = null;
    private static initPromise: Promise<AICostTracker> | null = null;

    /**
     * Initialize the AI Cost Tracker with custom storage
     */
    static async initialize(): Promise<AICostTracker> {
        if (this.tracker) {
            return this.tracker;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.createTracker();
        this.tracker = await this.initPromise;
        return this.tracker;
    }

    private static async createTracker(): Promise<AICostTracker> {
        // Only include providers that have API keys configured
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

        // If no providers are configured, add a default one to prevent initialization errors
        if (providers.length === 0) {
            logger.warn('No AI provider API keys configured. Adding default OpenAI provider with empty key for tracking purposes only.');
            providers.push({ provider: AIProvider.OpenAI, apiKey: 'dummy-key-for-tracking-only' });
        }

        const tracker = await AICostTracker.create({
            providers,
            tracking: {
                enableAutoTracking: true,
                storageType: 'custom',
                customStorage: {
                    save: async (data: UsageMetadata) => {
                        await this.saveUsageData(data);
                    },
                    load: async (filter?: any) => {
                        return await this.loadUsageData(filter);
                    },
                    clear: async () => {
                        // Implement if needed
                    }
                },
                retentionDays: 90
            },
            optimization: {
                enablePromptOptimization: true,
                enableModelSuggestions: true,
                enableCachingSuggestions: true,
                bedrockConfig: {
                    region: process.env.AWS_REGION || 'us-east-1',
                    modelId: 'anthropic.claude-3-haiku-20240307-v1:0'
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
     * Save usage data to MongoDB and update user stats
     */
    private static async saveUsageData(data: UsageMetadata): Promise<void> {
        try {
            // Map provider to service name
            const serviceMap: Record<string, string> = {
                [AIProvider.OpenAI]: 'openai',
                [AIProvider.AWSBedrock]: 'aws-bedrock',
                [AIProvider.Anthropic]: 'anthropic',
                [AIProvider.Google]: 'google-ai',
                [AIProvider.Cohere]: 'cohere',
                [AIProvider.HuggingFace]: 'huggingface'
            };

            // Extract user ID and metadata from the usage data
            const userId = data.sessionId;
            if (!userId) {
                logger.error('No userId found in usage data');
                return;
            }

            // Create usage record
            const usage = await Usage.create({
                userId,
                service: serviceMap[data.provider] || 'unknown',
                model: data.model,
                prompt: data.prompt || '',
                completion: data.completion || '',
                promptTokens: data.promptTokens || 0,
                completionTokens: data.completionTokens || 0,
                totalTokens: data.totalTokens || 0,
                cost: data.estimatedCost || 0,
                responseTime: data.responseTime || 0,
                metadata: {
                    timestamp: new Date(),
                    provider: data.provider
                },
                tags: data.tags || [],
                optimizationApplied: false,
            });

            // Update user's monthly usage
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                {
                    $inc: {
                        'usage.currentMonth.apiCalls': 1,
                        'usage.currentMonth.totalCost': data.estimatedCost || 0,
                        'usage.currentMonth.totalTokens': data.totalTokens || 0
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                logger.error('User not found for usage update', { userId });
                return;
            }

            // Check if user exceeded their limits
            await this.checkUserLimits(updatedUser, usage);

            // Send real-time updates to dashboard
            eventService.sendEvent('usage_tracked', {
                userId,
                usage: {
                    id: usage._id,
                    service: usage.service,
                    model: usage.model,
                    cost: usage.cost,
                    tokens: usage.totalTokens,
                    timestamp: usage.createdAt
                },
                userStats: {
                    monthlyApiCalls: updatedUser.usage.currentMonth.apiCalls,
                    monthlyCost: updatedUser.usage.currentMonth.totalCost,
                    monthlyTokens: updatedUser.usage.currentMonth.totalTokens
                },
                timestamp: new Date()
            });

            logger.info('Usage data saved from ai-cost-tracker', {
                userId,
                service: usage.service,
                model: usage.model,
                cost: usage.cost
            });

        } catch (error) {
            logger.error('Error saving usage data from ai-cost-tracker:', error);
            throw error;
        }
    }

    /**
     * Load usage data from MongoDB
     */
    private static async loadUsageData(filter?: any): Promise<UsageMetadata[]> {
        try {
            const query: any = {};

            if (filter?.userId) query.userId = filter.userId;
            if (filter?.startDate || filter?.endDate) {
                query.createdAt = {};
                if (filter.startDate) query.createdAt.$gte = filter.startDate;
                if (filter.endDate) query.createdAt.$lte = filter.endDate;
            }

            const usageRecords = await Usage.find(query).limit(1000).lean();

            // Convert to ai-cost-tracker format
            return usageRecords.map(record => ({
                provider: this.getProviderFromService(record.service),
                model: record.model,
                promptTokens: record.promptTokens,
                completionTokens: record.completionTokens,
                totalTokens: record.totalTokens,
                estimatedCost: record.cost,
                prompt: record.prompt,
                completion: record.completion,
                responseTime: record.responseTime,
                sessionId: record.userId.toString(),
                tags: record.tags,
            }));

        } catch (error) {
            logger.error('Error loading usage data:', error);
            return [];
        }
    }

    /**
     * Check user limits and create alerts if needed
     */
    private static async checkUserLimits(user: any, usage: any): Promise<void> {
        const monthlyUsage = user.usage.currentMonth;
        const limits = user.subscription.limits;
        const preferences = user.preferences;

        // Check API call limits
        if (monthlyUsage.apiCalls >= limits.apiCalls) {
            await this.createLimitAlert(user, 'api_calls', monthlyUsage.apiCalls, limits.apiCalls);
        }

        // Check cost threshold
        if (monthlyUsage.totalCost >= preferences.alertThreshold) {
            const previousCost = monthlyUsage.totalCost - usage.cost;
            if (previousCost < preferences.alertThreshold) {
                await this.createCostThresholdAlert(user, monthlyUsage.totalCost, preferences.alertThreshold);
            }
        }

        // Check if approaching limits (80% threshold)
        const apiCallsPercentage = (monthlyUsage.apiCalls / limits.apiCalls) * 100;
        if (apiCallsPercentage >= 80 && apiCallsPercentage < 100) {
            eventService.sendEvent('approaching_limit', {
                userId: user._id,
                type: 'api_calls',
                current: monthlyUsage.apiCalls,
                limit: limits.apiCalls,
                percentage: apiCallsPercentage,
                timestamp: new Date()
            });
        }
    }

    /**
     * Create limit alert
     */
    private static async createLimitAlert(user: any, type: string, current: number, limit: number): Promise<void> {
        const alert = await Alert.create({
            userId: user._id,
            type: 'limit_exceeded',
            title: `${type.replace('_', ' ').toUpperCase()} Limit Exceeded`,
            message: `You have exceeded your ${type.replace('_', ' ')} limit (${current}/${limit})`,
            severity: 'high',
            data: { type, current, limit },
            actionRequired: true
        });

        if (user.preferences.emailAlerts) {
            // await EmailService.sendLimitExceededAlert(user, type, current, limit);
        }

        eventService.sendEvent('limit_exceeded', {
            userId: user._id,
            alert,
            type,
            current,
            limit,
            timestamp: new Date()
        });
    }

    /**
     * Create cost threshold alert
     */
    private static async createCostThresholdAlert(user: any, currentCost: number, threshold: number): Promise<void> {
        const alert = await Alert.create({
            userId: user._id,
            type: 'cost_threshold',
            title: 'Cost Threshold Alert',
            message: `Your monthly AI API usage has reached $${currentCost.toFixed(2)}, exceeding your threshold of $${threshold.toFixed(2)}.`,
            severity: 'high',
            data: {
                currentValue: currentCost,
                threshold,
                percentage: (currentCost / threshold) * 100
            },
            actionRequired: true
        });

        if (user.preferences.emailAlerts) {
            await EmailService.sendCostAlert(user, currentCost, threshold);
        }

        eventService.sendEvent('cost_threshold_exceeded', {
            userId: user._id,
            alert,
            currentCost,
            threshold,
            timestamp: new Date()
        });
    }

    /**
     * Get provider enum from service string
     */
    private static getProviderFromService(service: string): AIProvider {
        const providerMap: Record<string, AIProvider> = {
            'openai': AIProvider.OpenAI,
            'aws-bedrock': AIProvider.AWSBedrock,
            'anthropic': AIProvider.Anthropic,
            'google-ai': AIProvider.Google,
            'cohere': AIProvider.Cohere,
            'huggingface': AIProvider.HuggingFace
        };
        return providerMap[service] || AIProvider.OpenAI;
    }

    /**
     * Get the tracker instance
     */
    static async getTracker(): Promise<AICostTracker> {
        return this.initialize();
    }

    /**
     * Track a request manually
     */
    static async trackRequest(
        request: any,
        response: any,
        userId: string,
        metadata?: any
    ): Promise<void> {
        const tracker = await this.getTracker();

        // The tracker will automatically call our custom storage save method
        await tracker.trackUsage(
            { ...request, ...response, ...metadata, sessionId: userId }
        );
    }

    /**
     * Make a tracked request
     */
    static async makeTrackedRequest(
        request: any,
        userId: string,
        metadata?: any
    ): Promise<any> {
        const tracker = await this.getTracker();

        // This will automatically track the usage via our custom storage
        return tracker.makeRequest({ ...request, ...metadata, sessionId: userId });
    }

    /**
     * Get analytics from tracker
     */
    static async getAnalytics(
        startDate?: Date,
        endDate?: Date,
        userId?: string
    ): Promise<any> {
        const tracker = await this.getTracker();
        return tracker.getAnalytics(startDate, endDate, userId);
    }

    /**
     * Get optimization suggestions
     */
    static async getOptimizationSuggestions(
        startDate?: Date,
        endDate?: Date,
        userId?: string
    ): Promise<any> {
        const tracker = await this.getTracker();
        return tracker.getOptimizationSuggestions(startDate, endDate, userId);
    }
} 