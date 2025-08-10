import { BedrockService } from './bedrock.service';
import { traceService } from './trace.service';
import { calculateCost } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { logger } from '../utils/logger';
import { Request } from 'express';

/**
 * Wrapped Bedrock service that adds tracing to all LLM calls
 */
export class TracedBedrockService extends BedrockService {
    /**
     * Wrapped invokeModel that adds tracing
     */
    static async invokeModel(prompt: string, model: string, req?: Request): Promise<any> {
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
                logger.error('Error starting LLM trace span:', error);
            }
        }
        
        const startTime = Date.now();
        let response: any;
        let error: any;
        
        try {
            // Call the parent class method
            response = await super.invokeModel(prompt, model);
            
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
                    logger.error('Error ending LLM trace span:', error);
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
                    logger.error('Error ending LLM trace span with error:', endError);
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
                logger.error('Error starting optimize prompt trace span:', error);
            }
        }
        
        try {
            const result = await super.optimizePrompt(request);
            
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
                    logger.error('Error ending optimize prompt trace span:', error);
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
                    logger.error('Error ending optimize prompt trace span with error:', endError);
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
                logger.error('Error starting analyze usage trace span:', error);
            }
        }
        
        try {
            const result = await super.analyzeUsagePatterns(request);
            
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
                    logger.error('Error ending analyze usage trace span:', error);
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
                    logger.error('Error ending analyze usage trace span with error:', endError);
                }
            }
            throw error;
        }
    }
}

// Export as default to replace BedrockService usage
export { TracedBedrockService as BedrockService };
