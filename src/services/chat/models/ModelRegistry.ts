/**
 * Model Registry
 * Provides list of available AI models with pricing and capabilities
 */

import { AWS_BEDROCK_PRICING } from '../../../utils/pricing/aws-bedrock';
import { ModelMetadata } from './ModelMetadata';
import { loggingService } from '../../logging.service';

export interface ModelInfo {
    id: string;
    name: string;
    provider: string;
    description: string;
    capabilities: string[];
    pricing?: {
        input: number;
        output: number;
        unit: string;
    };
}

export class ModelRegistry {
    // Static fallback models to prevent memory allocation on every error
    private static readonly FALLBACK_MODELS: ModelInfo[] = [
        {
            id: 'amazon.nova-micro-v1:0',
            name: 'Nova Micro',
            provider: 'Amazon',
            description: 'Fast and cost-effective model for simple tasks',
            capabilities: ['text', 'chat'],
            pricing: { input: 0.035, output: 0.14, unit: 'Per 1M tokens' }
        },
        {
            id: 'amazon.nova-lite-v1:0',
            name: 'Nova Lite',
            provider: 'Amazon',
            description: 'Balanced performance and cost for general use',
            capabilities: ['text', 'chat'],
            pricing: { input: 0.06, output: 0.24, unit: 'Per 1M tokens' }
        },
        {
            id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            name: 'Claude 3.5 Haiku',
            provider: 'Anthropic',
            description: 'Fast and intelligent for quick responses',
            capabilities: ['text', 'chat'],
            pricing: { input: 1.0, output: 5.0, unit: 'Per 1M tokens' }
        },
        {
            id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            name: 'Claude 3.5 Sonnet',
            provider: 'Anthropic',
            description: 'Advanced reasoning and analysis capabilities',
            capabilities: ['text', 'chat'],
            pricing: { input: 3.0, output: 15.0, unit: 'Per 1M tokens' }
        },
        {
            id: 'meta.llama3-1-8b-instruct-v1:0',
            name: 'Llama 3.1 8B',
            provider: 'Meta',
            description: 'Good balance of performance and efficiency',
            capabilities: ['text', 'chat'],
            pricing: { input: 0.3, output: 0.6, unit: 'Per 1M tokens' }
        }
    ];

    /**
     * Get available models for chat
     */
    static getAvailableModels(): ModelInfo[] {
        try {
            // Use AWS Bedrock pricing data directly to avoid circular dependencies
            const models = AWS_BEDROCK_PRICING.map(pricing => ({
                id: pricing.modelId,
                name: ModelMetadata.getDisplayName(pricing.modelId),
                provider: ModelMetadata.getProvider(pricing.modelId),
                description: ModelMetadata.getDescription(pricing.modelId),
                capabilities: pricing.capabilities || ['text', 'chat'],
                pricing: {
                    input: pricing.inputPrice,
                    output: pricing.outputPrice,
                    unit: pricing.unit
                }
            }));
            
            // Filter out models with invalid model IDs
            return models.filter(model => model && model.id && typeof model.id === 'string' && model.id.trim() !== '');

        } catch (error) {
            loggingService.error('Error getting available models:', { error: error instanceof Error ? error.message : String(error) });
            
            // Return static fallback models instead of creating new objects
            return [...this.FALLBACK_MODELS]; // Shallow copy to prevent mutations
        }
    }
}
