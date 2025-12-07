/**
 * Provider Adapter Initializer
 * 
 * Initializes and registers all provider adapters with the ModelCapabilityRegistry.
 * Called during application startup.
 */

import { ModelCapabilityRegistry } from './modelCapabilityRegistry.service';
import { OpenAIAdapter } from './providers/adapters/openai.adapter';
import { GeminiAdapter } from './providers/adapters/gemini.adapter';
import { BedrockAdapter } from './providers/adapters/bedrock.adapter';
import { AIProviderType } from '../types/aiProvider.types';
import { loggingService } from './logging.service';

export class ProviderAdapterInitializer {
    private static initialized = false;
    
    /**
     * Initialize all provider adapters
     */
    static async initialize(): Promise<void> {
        if (this.initialized) {
            loggingService.debug('Provider adapters already initialized');
            return;
        }
        
        try {
            loggingService.info('Initializing provider adapters...');
            
            const registry = ModelCapabilityRegistry.getInstance();
            
            // Register OpenAI adapter
            if (process.env.OPENAI_API_KEY) {
                const openaiAdapter = new OpenAIAdapter(process.env.OPENAI_API_KEY);
                registry.registerProviderAdapter(AIProviderType.OpenAI, openaiAdapter);
                loggingService.info('✅ OpenAI adapter registered');
            } else {
                loggingService.warn('⚠️  OPENAI_API_KEY not found, skipping OpenAI adapter');
            }
            
            // Register Gemini adapter
            if (process.env.GEMINI_API_KEY) {
                const geminiAdapter = new GeminiAdapter(process.env.GEMINI_API_KEY);
                registry.registerProviderAdapter(AIProviderType.Google, geminiAdapter);
                loggingService.info('✅ Gemini adapter registered');
            } else {
                loggingService.warn('⚠️  GEMINI_API_KEY not found, skipping Gemini adapter');
            }
            
            // Register Bedrock adapter (uses AWS credentials from environment)
            if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
                const bedrockAdapter = new BedrockAdapter();
                registry.registerProviderAdapter(AIProviderType.Bedrock, bedrockAdapter);
                loggingService.info('✅ Bedrock adapter registered');
            } else {
                loggingService.warn('⚠️  AWS credentials not found, skipping Bedrock adapter');
            }
            
            this.initialized = true;
            loggingService.info('🎯 Provider adapter initialization complete');
            
            // Log registry stats
            const stats = registry.getStats();
            loggingService.info('Registry statistics', {
                totalModels: stats.totalModels,
                providers: Object.keys(stats.modelsByProvider),
                capabilities: Object.keys(stats.modelsByCapability).length
            });
            
        } catch (error) {
            loggingService.error('Failed to initialize provider adapters', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    /**
     * Check if adapters are initialized
     */
    static isInitialized(): boolean {
        return this.initialized;
    }
}

