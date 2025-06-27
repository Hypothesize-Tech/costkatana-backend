import AICostTracker, { AIProvider } from 'ai-cost-tracker';
import { logger } from '../utils/logger';

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
        metadata?: any
    ): Promise<void> {
        const tracker = await this.getTracker();

        let payload = { ...request, ...response, ...metadata, sessionId: userId };
        if (payload.usage && typeof payload.usage === 'object') {
            payload = { ...payload, ...payload.usage };
            delete payload.usage;
        }
        if (payload.service && !payload.provider) {
            payload.provider = payload.service;
            delete payload.service;
        }
        if (payload.cost && !payload.estimatedCost) {
            payload.estimatedCost = payload.cost;
            delete payload.cost;
        }
        if (typeof payload.prompt !== 'string') {
            payload.prompt = '';
        }
        await tracker.trackUsage(payload);
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