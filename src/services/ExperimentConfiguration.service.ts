import { BaseService, ServiceError } from '../shared/BaseService';
import { loggingService } from './logging.service';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';

export interface ModelComparisonRequest {
    prompt: string;
    models: Array<{
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
    }>;
    evaluationCriteria: string[];
    iterations?: number;
}

export interface BedrockModelInfo {
    modelId: string;
    modelName: string;
    provider: string;
    inputPricing: number;
    outputPricing: number;
    maxTokens: number;
    supportedRegions: string[];
    capabilities: string[];
}

/**
 * ExperimentConfiguration handles setup and validation of experiments
 * Responsible for model selection, pricing, and configuration validation
 */
export class ExperimentConfigurationService extends BaseService {
    private static instance: ExperimentConfigurationService;
    private static modelPricingIndex = new Map<string, any>();

    // Configuration limits
    private readonly MAX_MODELS_PER_COMPARISON = 10;
    private readonly MAX_ITERATIONS = 50;
    private readonly MAX_PROMPT_LENGTH = 50000;
    private readonly MIN_PROMPT_LENGTH = 10;

    // Supported model configurations
    private readonly SUPPORTED_BEDROCK_MODELS = [
        'amazon.nova-micro-v1:0',
        'amazon.nova-lite-v1:0', 
        'amazon.nova-pro-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'anthropic.claude-3-sonnet-20240229-v1:0',
        'meta.llama3-8b-instruct-v1:0',
        'meta.llama3-70b-instruct-v1:0',
        'cohere.command-r-v1:0',
        'cohere.command-r-plus-v1:0'
    ];

    private constructor() {
        super('ExperimentConfiguration', {
            max: 200, // Cache model configurations
            ttl: 60 * 60 * 1000 // 1 hour TTL
        });

        this.initializeModelPricing();
    }

    public static getInstance(): ExperimentConfigurationService {
        if (!ExperimentConfigurationService.instance) {
            ExperimentConfigurationService.instance = new ExperimentConfigurationService();
        }
        return ExperimentConfigurationService.instance;
    }

    /**
     * Validate model comparison request
     */
    public validateModelComparisonRequest(request: ModelComparisonRequest): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate prompt
        if (!request.prompt || typeof request.prompt !== 'string') {
            errors.push('Prompt is required and must be a string');
        } else {
            if (request.prompt.length < this.MIN_PROMPT_LENGTH) {
                errors.push(`Prompt must be at least ${this.MIN_PROMPT_LENGTH} characters`);
            }
            if (request.prompt.length > this.MAX_PROMPT_LENGTH) {
                errors.push(`Prompt must not exceed ${this.MAX_PROMPT_LENGTH} characters`);
            }
        }

        // Validate models
        if (!Array.isArray(request.models) || request.models.length === 0) {
            errors.push('At least one model must be specified');
        } else {
            if (request.models.length > this.MAX_MODELS_PER_COMPARISON) {
                errors.push(`Maximum ${this.MAX_MODELS_PER_COMPARISON} models allowed per comparison`);
            }

            request.models.forEach((model, index) => {
                const modelErrors = this.validateModelConfig(model, index);
                errors.push(...modelErrors);
            });
        }

        // Validate evaluation criteria
        if (!Array.isArray(request.evaluationCriteria) || request.evaluationCriteria.length === 0) {
            warnings.push('No evaluation criteria specified - using default criteria');
        } else if (request.evaluationCriteria.length > 10) {
            warnings.push('Too many evaluation criteria may slow down evaluation');
        }

        // Validate iterations
        if (request.iterations !== undefined) {
            if (request.iterations < 1) {
                errors.push('Iterations must be at least 1');
            } else if (request.iterations > this.MAX_ITERATIONS) {
                errors.push(`Maximum ${this.MAX_ITERATIONS} iterations allowed`);
            } else if (request.iterations > 10) {
                warnings.push('High iteration count may significantly increase costs and time');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate individual model configuration
     */
    private validateModelConfig(model: any, index: number): string[] {
        const errors: string[] = [];
        const prefix = `Model ${index + 1}`;

        if (!model.provider || typeof model.provider !== 'string') {
            errors.push(`${prefix}: Provider is required`);
        }

        if (!model.model || typeof model.model !== 'string') {
            errors.push(`${prefix}: Model name is required`);
        }

        if (model.temperature !== undefined) {
            if (typeof model.temperature !== 'number' || model.temperature < 0 || model.temperature > 1) {
                errors.push(`${prefix}: Temperature must be a number between 0 and 1`);
            }
        }

        if (model.maxTokens !== undefined) {
            if (typeof model.maxTokens !== 'number' || model.maxTokens < 1 || model.maxTokens > 100000) {
                errors.push(`${prefix}: MaxTokens must be a number between 1 and 100000`);
            }
        }

        // Validate Bedrock model availability
        if (model.provider === 'bedrock' || model.provider === 'aws') {
            const bedrockModelId = this.mapToBedrockModelId(model.model, model.provider);
            if (!this.SUPPORTED_BEDROCK_MODELS.includes(bedrockModelId)) {
                errors.push(`${prefix}: Model ${model.model} is not supported or available`);
            }
        }

        return errors;
    }

    /**
     * Get accessible Bedrock models with pricing information
     */
    public async getAccessibleBedrockModels(): Promise<BedrockModelInfo[]> {
        const cacheKey = 'accessible_bedrock_models';
        
        return this.getCachedOrExecute(cacheKey, async () => {
            return this.executeWithCircuitBreaker(async () => {
                const models: BedrockModelInfo[] = [];

                for (const modelId of this.SUPPORTED_BEDROCK_MODELS) {
                    try {
                        const modelInfo = this.getModelInfo(modelId);
                        if (modelInfo) {
                            models.push(modelInfo);
                        }
                    } catch (error) {
                        loggingService.warn(`Failed to get info for model ${modelId}`, {
                            component: 'ExperimentConfiguration',
                            operation: 'getAccessibleBedrockModels',
                            modelId,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }

                return models.sort((a, b) => a.modelName.localeCompare(b.modelName));
            }, 'getAccessibleBedrockModels');
        }, 30 * 60 * 1000); // Cache for 30 minutes
    }

    /**
     * Get model information including pricing
     */
    private getModelInfo(modelId: string): BedrockModelInfo | null {
        // Map model ID to display name
        const modelNameMap: Record<string, string> = {
            'amazon.nova-micro-v1:0': 'Amazon Nova Micro',
            'amazon.nova-lite-v1:0': 'Amazon Nova Lite',
            'amazon.nova-pro-v1:0': 'Amazon Nova Pro',
            'anthropic.claude-3-haiku-20240307-v1:0': 'Claude 3 Haiku',
            'anthropic.claude-3-sonnet-20240229-v1:0': 'Claude 3 Sonnet',
            'meta.llama3-8b-instruct-v1:0': 'Llama 3 8B Instruct',
            'meta.llama3-70b-instruct-v1:0': 'Llama 3 70B Instruct',
            'cohere.command-r-v1:0': 'Command R',
            'cohere.command-r-plus-v1:0': 'Command R+'
        };

        const modelName = modelNameMap[modelId];
        if (!modelName) return null;

        // Get pricing from AWS Bedrock pricing
        const pricingEntry = AWS_BEDROCK_PRICING.find(p => p.modelId === modelId);
        
        return {
            modelId,
            modelName,
            provider: this.getProviderFromModelId(modelId),
            inputPricing: pricingEntry?.inputPrice || 0,
            outputPricing: pricingEntry?.outputPrice || 0,
            maxTokens: this.getMaxTokensForModel(modelId),
            supportedRegions: ['us-east-1', 'us-west-2'], // Default regions
            capabilities: this.getModelCapabilities(modelId)
        };
    }

    /**
     * Map model name to Bedrock model ID
     */
    public mapToBedrockModelId(modelName: string, provider: string): string {
        // Handle different naming conventions
        const normalizedName = modelName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const modelMap: Record<string, string> = {
            'novamicro': 'amazon.nova-micro-v1:0',
            'novalite': 'amazon.nova-lite-v1:0',
            'novapro': 'amazon.nova-pro-v1:0',
            'claude3haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
            'claudehaiku': 'anthropic.claude-3-haiku-20240307-v1:0',
            'claude3sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
            'claudesonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
            'llama38b': 'meta.llama3-8b-instruct-v1:0',
            'llama370b': 'meta.llama3-70b-instruct-v1:0',
            'commandr': 'cohere.command-r-v1:0',
            'commandrplus': 'cohere.command-r-plus-v1:0'
        };

        return modelMap[normalizedName] || modelName;
    }

    /**
     * Estimate cost for model comparison
     */
    public estimateComparisonCost(request: ModelComparisonRequest): {
        totalEstimatedCost: number;
        costBreakdown: Array<{
            model: string;
            estimatedCost: number;
            inputTokens: number;
            outputTokens: number;
        }>;
        warnings: string[];
    } {
        const warnings: string[] = [];
        const costBreakdown: Array<{
            model: string;
            estimatedCost: number;
            inputTokens: number;
            outputTokens: number;
        }> = [];

        const iterations = request.iterations || 1;
        const inputTokens = this.estimateTokenCount(request.prompt);
        const outputTokens = 500; // Estimated average response length

        let totalCost = 0;

        for (const model of request.models) {
            const bedrockModelId = this.mapToBedrockModelId(model.model, model.provider);
            const pricingEntry = AWS_BEDROCK_PRICING.find(p => p.modelId === bedrockModelId);

            if (!pricingEntry) {
                warnings.push(`Pricing not available for ${model.model}, using default estimate`);
                continue;
            }

            const inputCost = (inputTokens / 1000) * pricingEntry.inputPrice * iterations;
            const outputCost = (outputTokens / 1000) * pricingEntry.outputPrice * iterations;
            const modelCost = inputCost + outputCost;

            costBreakdown.push({
                model: model.model,
                estimatedCost: modelCost,
                inputTokens: inputTokens * iterations,
                outputTokens: outputTokens * iterations
            });

            totalCost += modelCost;
        }

        // Add warnings for high costs
        if (totalCost > 1.0) {
            warnings.push('Estimated cost exceeds $1.00 - consider reducing iterations or models');
        }

        return {
            totalEstimatedCost: totalCost,
            costBreakdown,
            warnings
        };
    }

    /**
     * Get default evaluation criteria
     */
    public getDefaultEvaluationCriteria(): string[] {
        return [
            'accuracy',
            'relevance',
            'completeness',
            'clarity',
            'helpfulness'
        ];
    }

    /**
     * Initialize model pricing cache
     */
    private initializeModelPricing(): void {
        try {
            // Use AWS Bedrock pricing array
            for (const pricing of AWS_BEDROCK_PRICING) {
                ExperimentConfigurationService.modelPricingIndex.set(pricing.modelId, pricing);
            }

            loggingService.info('Model pricing index initialized', {
                component: 'ExperimentConfiguration',
                operation: 'initializeModelPricing',
                modelCount: ExperimentConfigurationService.modelPricingIndex.size
            });
        } catch (error) {
            loggingService.error('Failed to initialize model pricing', {
                component: 'ExperimentConfiguration',
                operation: 'initializeModelPricing',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Estimate token count for text
     */
    private estimateTokenCount(text: string): number {
        // Simple estimation: ~4 characters per token on average
        return Math.ceil(text.length / 4);
    }

    /**
     * Get provider from model ID
     */
    private getProviderFromModelId(modelId: string): string {
        if (modelId.startsWith('amazon.')) return 'Amazon';
        if (modelId.startsWith('anthropic.')) return 'Anthropic';
        if (modelId.startsWith('meta.')) return 'Meta';
        if (modelId.startsWith('cohere.')) return 'Cohere';
        return 'Unknown';
    }

    /**
     * Get maximum tokens for model
     */
    private getMaxTokensForModel(modelId: string): number {
        const maxTokensMap: Record<string, number> = {
            'amazon.nova-micro-v1:0': 128000,
            'amazon.nova-lite-v1:0': 300000,
            'amazon.nova-pro-v1:0': 300000,
            'anthropic.claude-3-haiku-20240307-v1:0': 200000,
            'anthropic.claude-3-sonnet-20240229-v1:0': 200000,
            'meta.llama3-8b-instruct-v1:0': 8192,
            'meta.llama3-70b-instruct-v1:0': 8192,
            'cohere.command-r-v1:0': 128000,
            'cohere.command-r-plus-v1:0': 128000
        };

        return maxTokensMap[modelId] || 4096;
    }

    /**
     * Get model capabilities
     */
    private getModelCapabilities(modelId: string): string[] {
        const capabilitiesMap: Record<string, string[]> = {
            'amazon.nova-micro-v1:0': ['text-generation', 'fast-inference'],
            'amazon.nova-lite-v1:0': ['text-generation', 'balanced-performance'],
            'amazon.nova-pro-v1:0': ['text-generation', 'high-quality', 'reasoning'],
            'anthropic.claude-3-haiku-20240307-v1:0': ['text-generation', 'fast-inference', 'reasoning'],
            'anthropic.claude-3-sonnet-20240229-v1:0': ['text-generation', 'high-quality', 'reasoning', 'analysis'],
            'meta.llama3-8b-instruct-v1:0': ['text-generation', 'instruction-following'],
            'meta.llama3-70b-instruct-v1:0': ['text-generation', 'instruction-following', 'reasoning'],
            'cohere.command-r-v1:0': ['text-generation', 'rag-optimized'],
            'cohere.command-r-plus-v1:0': ['text-generation', 'rag-optimized', 'high-quality']
        };

        return capabilitiesMap[modelId] || ['text-generation'];
    }
}
