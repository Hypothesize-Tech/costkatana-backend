import { BedrockService } from './bedrock.service';
import { traceService } from './trace.service';
import { calculateCost } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { loggingService } from './logging.service';
import { Request } from 'express';

/**
 * Wrapped Bedrock service that adds tracing to all LLM calls
 */
export class TracedBedrockService {
    /**
     * Wrapped invokeModel that adds tracing (enhanced with ChatGPT-style context)
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
                    name: `LLM: ${model}`,
                    type: 'llm',
                    metadata: {
                        model,
                        promptLength: prompt.length,
                        promptPreview: prompt.substring(0, 200)
                    }
                });
            } catch (error) {
                loggingService.error('Error starting LLM trace span:', { error: error instanceof Error ? error.message : String(error) });
            }
        }
        
        const startTime = Date.now();
        let response: any;
        let error: any;
        
        try {
            // Call the parent class static method with context
            response = await BedrockService.invokeModel(prompt, model, context);
            
            // Estimate tokens (simplified - in production you'd use proper tokenization)
            const inputTokens = estimateTokens(prompt);
            const outputTokens = estimateTokens(response);
            
            // Calculate cost - determine provider from model name
            const provider = model.includes('claude') ? 'anthropic' : 
                           model.includes('anthropic') ? 'anthropic' :
                           model.includes('nova') ? 'aws-bedrock' :
                           model.includes('titan') ? 'aws-bedrock' :
                           model.includes('llama') ? 'aws-bedrock' :
                           'aws-bedrock';
            const cost = calculateCost(inputTokens, outputTokens, provider, model);
            
            // End span with success
            if (trace) {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: 'ok',
                        aiModel: model,
                        tokens: {
                            input: inputTokens,
                            output: outputTokens
                        },
                        costUSD: cost,
                        metadata: {
                            latency: Date.now() - startTime,
                            responseLength: response.length,
                            responsePreview: response.substring(0, 200)
                        }
                    });
                    
                    // Record messages only if sessionId exists
                    if (sessionId) {
                        await traceService.recordMessage({
                            sessionId,
                            traceId: trace.traceId,
                            role: 'user',
                            content: prompt,
                            metadata: { model }
                        });
                        
                        await traceService.recordMessage({
                            sessionId,
                            traceId: trace.traceId,
                            role: 'assistant',
                            content: response,
                            metadata: { model, tokens: { input: inputTokens, output: outputTokens }, cost }
                        });
                    }
                } catch (error) {
                    loggingService.error('Error ending LLM trace span:', { error: error instanceof Error ? error.message : String(error) });
                }
            }
            
            return response;
        } catch (err) {
            error = err;
            
            // End span with error
            if (trace) {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: 'error',
                        error: {
                            message: error.message || 'LLM invocation failed',
                            stack: error.stack
                        },
                        aiModel: model,
                        metadata: {
                            latency: Date.now() - startTime
                        }
                    });
                } catch (endError) {
                    loggingService.error('Error ending LLM trace span with error:', { error: endError instanceof Error ? endError.message : String(endError) });
                }
            }
            
            throw error;
        }
    }
    
    /**
     * Wrapped optimizePrompt with tracing
     */
    static async optimizePrompt(request: any, req?: Request): Promise<any> {
        const parentId = req?.traceContext?.traceId;
        const sessionId = req?.traceContext?.sessionId;
        
        let trace: any;
        if (sessionId) {
            try {
                trace = await traceService.startSpan({
                    sessionId,
                    parentId,
                    name: 'Optimize Prompt',
                    type: 'tool',
                    metadata: {
                        service: request.service,
                        model: request.model,
                        targetReduction: request.targetReduction
                    }
                });
            } catch (error) {
                loggingService.error('Error starting optimize prompt trace span:', { error: error instanceof Error ? error.message : String(error) });
            }
        }
        
        try {
            const result = await BedrockService.optimizePrompt(request);
            
            if (trace) {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: 'ok',
                        tool: 'prompt-optimizer',
                        metadata: {
                            techniques: result.techniques,
                            estimatedTokenReduction: result.estimatedTokenReduction
                        }
                    });
                } catch (error) {
                    loggingService.error('Error ending optimize prompt trace span:', { error: error instanceof Error ? error.message : String(error) });
                }
            }
            
            return result;
        } catch (error: any) {
            if (trace) {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: 'error',
                        error: {
                            message: error.message || 'Prompt optimization failed'
                        }
                    });
                } catch (endError) {
                    loggingService.error('Error ending optimize prompt trace span with error:', { error: endError instanceof Error ? endError.message : String(endError) });
                }
            }
            throw error;
        }
    }
    
    /**
     * Wrapped analyzeUsagePatterns with tracing
     */
    static async analyzeUsagePatterns(request: any, req?: Request): Promise<any> {
        const parentId = req?.traceContext?.traceId;
        const sessionId = req?.traceContext?.sessionId;
        
        let trace: any;
        if (sessionId) {
            try {
                trace = await traceService.startSpan({
                    sessionId,
                    parentId,
                    name: 'Analyze Usage Patterns',
                    type: 'tool',
                    metadata: {
                        timeframe: request.timeframe,
                        dataPoints: request.usageData.length
                    }
                });
            } catch (error) {
                loggingService.error('Error starting analyze usage trace span:', { error: error instanceof Error ? error.message : String(error) });
            }
        }
        
        try {
            const result = await BedrockService.analyzeUsagePatterns(request);
            
            if (trace) {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: 'ok',
                        tool: 'usage-analyzer',
                        metadata: {
                            patternsFound: result.patterns.length,
                            potentialSavings: result.potentialSavings
                        }
                    });
                } catch (error) {
                    loggingService.error('Error ending analyze usage trace span:', { error: error instanceof Error ? error.message : String(error) });
                }
            }
            
            return result;
        } catch (error: any) {
            if (trace) {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: 'error',
                        error: {
                            message: error.message || 'Usage analysis failed'
                        }
                    });
                } catch (endError) {
                    loggingService.error('Error ending analyze usage trace span with error:', { error: endError instanceof Error ? endError.message : String(endError) });
                }
            }
            throw error;
        }
    }
}

// Export as default to replace BedrockService usage
export { TracedBedrockService as BedrockService };
