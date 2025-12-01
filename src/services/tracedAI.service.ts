/**
 * Traced AI Service
 * Wraps AIRouterService with tracing capabilities for all AI provider calls
 */

import { AIRouterService } from './aiRouter.service';
import { traceService } from './trace.service';
import { loggingService } from './logging.service';
import { Request } from 'express';

export class TracedAIService {
    /**
     * Wrapped invokeModel that adds tracing to all AI calls
     */
    static async invokeModel(
        prompt: string, 
        model: string, 
        context?: { recentMessages?: Array<{ role: string; content: string }>; useSystemPrompt?: boolean }, 
        req?: Request
    ): Promise<any> {
        const parentId = req?.traceContext?.traceId;
        const sessionId = req?.traceContext?.sessionId;
        
        // Start LLM span
        let trace: any;
        if (sessionId) {
            try {
                trace = await traceService.startSpan({
                    sessionId,
                    parentId,
                    name: `AI: ${model}`,
                    type: 'llm',
                    metadata: {
                        model,
                        promptLength: prompt.length,
                        promptPreview: prompt.substring(0, 200),
                        provider: AIRouterService.detectProvider(model)
                    }
                });
            } catch (error) {
                loggingService.error('Error starting AI trace span:', { 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
        }
        
        const startTime = Date.now();
        let response: any;
        let error: any;
        
        try {
            response = await AIRouterService.invokeModel(prompt, model, undefined, context);
            
            if (trace) {
                try {
                    await traceService.endSpan(trace.id, {
                        status: 'ok',
                        metadata: {
                            responseLength: typeof response === 'string' ? response.length : 0,
                            latency: Date.now() - startTime
                        }
                    });
                } catch (traceError) {
                    loggingService.error('Error ending AI trace span:', { 
                        error: traceError instanceof Error ? traceError.message : String(traceError) 
                    });
                }
            }
            
            return response;
        } catch (err) {
            error = err;
            
            if (trace) {
                try {
                    await traceService.endSpan(trace.id, {
                        status: 'error',
                        error: {
                            message: error instanceof Error ? error.message : String(error),
                            stack: error instanceof Error ? error.stack : undefined
                        },
                        metadata: {
                            latency: Date.now() - startTime
                        }
                    });
                } catch (traceError) {
                    loggingService.error('Error ending AI trace span with error:', { 
                        error: traceError instanceof Error ? traceError.message : String(traceError) 
                    });
                }
            }
            
            throw error;
        }
    }

    /**
     * Get provider status (pass through to AIRouter)
     */
    static getProviderStatus() {
        return AIRouterService.getProviderStatus();
    }

    /**
     * Get supported models (pass through to AIRouter)
     */
    static getSupportedModels() {
        return AIRouterService.getSupportedModels();
    }

    /**
     * Check if model is supported (pass through to AIRouter)
     */
    static isModelSupported(model: string): boolean {
        return AIRouterService.isModelSupported(model);
    }

    /**
     * Detect provider for a model (pass through to AIRouter)
     */
    static detectProvider(model: string) {
        return AIRouterService.detectProvider(model);
    }
}

// For backward compatibility, keep BedrockService as an alias
export const BedrockService = TracedAIService;

