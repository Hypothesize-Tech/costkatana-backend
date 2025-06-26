import AICostTracker, { AIProvider } from 'ai-cost-tracker';
import { logger } from '../utils/logger';

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