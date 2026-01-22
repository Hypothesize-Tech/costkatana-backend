import { Request } from 'express';
import { loggingService } from '../../logging.service';
import { LazySummarizationService } from '../../lazySummarization.service';
import { PromptCompilerService } from '../../../compiler/promptCompiler.service';
import { ParallelExecutionOptimizerService } from '../../../compiler/parallelExecutionOptimizer.service';
import { ProactiveSuggestionsService } from '../../proactiveSuggestions.service';
import { GatewayCortexService } from '../../gatewayCortex.service';
import https from 'https';

/**
 * Interface for conversation messages
 */
interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
}

/**
 * Interface for proxy request configuration
 */
export interface ProxyRequestConfig {
    method: string;
    url: string;
    headers: Record<string, any>;
    data: any;
    timeout: number;
    validateStatus: () => boolean;
    httpsAgent: https.Agent;
    maxRedirects: number;
    decompress: boolean;
}

/**
 * Interface for prompt extraction result
 */
export interface PromptExtractionResult {
    prompt: string | null;
    format: 'openai' | 'anthropic' | 'google' | 'cohere' | 'generic' | 'unknown';
}

/**
 * Interface for tool call extraction result
 */
export interface ToolCallExtractionResult {
    toolCalls: any[] | undefined;
    format: 'openai' | 'anthropic' | 'google' | 'unknown';
}

/**
 * RequestProcessingService - Handles request validation, transformation, and routing logic
 * 
 * @description This service extracts all request processing business logic from the gateway controller,
 * including prompt extraction, request transformation, lazy summarization, prompt compilation,
 * and proxy request preparation.
 */
export class RequestProcessingService {
    // Create a connection pool for better performance
    private static httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000
    });

    /**
     * Extract prompt text from various request formats
     * 
     * @param requestBody - The request body object
     * @returns Extracted prompt string or null if not found
     */
    static extractPromptFromRequest(requestBody: any): PromptExtractionResult {
        if (!requestBody) {
            return { prompt: null, format: 'unknown' };
        }

        try {
            // OpenAI format
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                const prompt = requestBody.messages
                    .map((msg: any) => msg.content || '')
                    .filter((content: string) => content.trim().length > 0)
                    .join('\n');
                return { prompt, format: 'openai' };
            }

            // Anthropic format
            if (requestBody.prompt && typeof requestBody.prompt === 'string') {
                return { prompt: requestBody.prompt, format: 'anthropic' };
            }

            // Google AI format
            if (requestBody.contents && Array.isArray(requestBody.contents)) {
                const prompt = requestBody.contents
                    .flatMap((content: any) => content.parts || [])
                    .map((part: any) => part.text || '')
                    .filter((text: string) => text.trim().length > 0)
                    .join('\n');
                return { prompt, format: 'google' };
            }

            // Cohere format
            if (requestBody.message && typeof requestBody.message === 'string') {
                return { prompt: requestBody.message, format: 'cohere' };
            }

            // Generic text field
            if (requestBody.text && typeof requestBody.text === 'string') {
                return { prompt: requestBody.text, format: 'generic' };
            }

            // Input field
            if (requestBody.input && typeof requestBody.input === 'string') {
                return { prompt: requestBody.input, format: 'generic' };
            }

            return { prompt: null, format: 'unknown' };

        } catch (error: any) {
            loggingService.error('Error extracting prompt from request', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return { prompt: null, format: 'unknown' };
        }
    }

    /**
     * Extract tool calls from various request formats
     * 
     * @param requestBody - The request body object
     * @returns Array of tool calls or undefined if not found
     */
    static extractToolCallsFromRequest(requestBody: any): ToolCallExtractionResult {
        if (!requestBody) {
            return { toolCalls: undefined, format: 'unknown' };
        }

        try {
            // OpenAI format - tools can be in different places
            if (requestBody.tools && Array.isArray(requestBody.tools)) {
                return { toolCalls: requestBody.tools, format: 'openai' };
            }

            // Function calling in messages
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                const toolCalls: any[] = [];
                
                requestBody.messages.forEach((msg: any) => {
                    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                        toolCalls.push(...msg.tool_calls);
                    }
                });
                
                return toolCalls.length > 0 
                    ? { toolCalls, format: 'openai' } 
                    : { toolCalls: undefined, format: 'openai' };
            }

            // Anthropic function calling
            if (requestBody.tools && Array.isArray(requestBody.tools)) {
                return { toolCalls: requestBody.tools, format: 'anthropic' };
            }

            // Google AI function calling
            if (requestBody.function_declarations && Array.isArray(requestBody.function_declarations)) {
                return { toolCalls: requestBody.function_declarations, format: 'google' };
            }

            return { toolCalls: undefined, format: 'unknown' };

        } catch (error: any) {
            loggingService.warn('Error extracting tool calls from request', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return { toolCalls: undefined, format: 'unknown' };
        }
    }

    /**
     * Apply lazy summarization to compress large conversation contexts
     * 
     * @param req - Express request object
     * @param proxyRequest - The proxy request configuration to modify
     * @returns Modified proxy request with compressed messages
     */
    static async applyLazySummarization(
        req: Request,
        proxyRequest: ProxyRequestConfig
    ): Promise<ProxyRequestConfig> {
        const context = req.gatewayContext!;

        try {
            if (req.body && req.body.messages && Array.isArray(req.body.messages)) {
                const messages: ConversationMessage[] = req.body.messages.map((m: any) => ({
                    role: m.role || 'user',
                    content: m.content || '',
                    timestamp: m.timestamp ? new Date(m.timestamp) : undefined
                }));
                
                const totalTokens = messages.reduce((sum, m) => sum + (m.content.length / 4), 0);
                const shouldSummarize = LazySummarizationService.shouldApplySummarization(totalTokens);
                
                if (shouldSummarize.shouldApply) {
                    const summarizationResult = await LazySummarizationService.compressConversationHistory(
                        messages,
                        shouldSummarize.recommendedTarget!
                    );
                    
                    if (summarizationResult.reductionPercentage > 20) {
                        loggingService.info('🗜️ Lazy summarization applied', {
                            userId: context.userId,
                            originalMessages: summarizationResult.original.length,
                            compressedMessages: summarizationResult.compressed.length,
                            reduction: `${summarizationResult.reductionPercentage.toFixed(1)}%`
                        });
                        
                        // Update request body with compressed messages
                        proxyRequest.data = {
                            ...proxyRequest.data,
                            messages: summarizationResult.compressed
                        };
                        req.body.messages = summarizationResult.compressed;
                        
                        // Push proactive suggestion notification
                        ProactiveSuggestionsService.pushContextCompressionSuggestion(
                            context.userId!,
                            summarizationResult.original.length,
                            summarizationResult.compressed.length,
                            summarizationResult.reductionPercentage
                        ).catch(err => {
                            loggingService.warn('Failed to push suggestion', { error: err.message });
                        });
                    }
                }
            }
        } catch (error) {
            loggingService.warn('Lazy summarization failed, continuing with original', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return proxyRequest;
    }

    /**
     * Apply prompt compiler optimizations to reduce token usage
     * 
     * @param req - Express request object
     * @param proxyRequest - The proxy request configuration to modify
     * @returns Modified proxy request with optimized prompt
     */
    static async applyPromptCompiler(
        req: Request,
        proxyRequest: ProxyRequestConfig
    ): Promise<ProxyRequestConfig> {
        const context = req.gatewayContext!;
        const enableCompiler = req.headers['x-costkatana-enable-compiler'] === 'true';
        const optimizationLevel = parseInt(req.headers['x-costkatana-optimization-level'] as string) || 2;
        
        if (!enableCompiler) {
            return proxyRequest;
        }

        try {
            const prompt = req.body.prompt || req.body.messages?.map((m: any) => m.content).join('\n') || '';
            
            if (prompt && prompt.length > 200) { // Only optimize prompts > 200 chars
                const compilationResult = await PromptCompilerService.compile(prompt, {
                    optimizationLevel: optimizationLevel as 0 | 1 | 2 | 3,
                    preserveQuality: true,
                    enableParallelization: true
                });
                
                if (compilationResult.success && compilationResult.metrics.tokenReduction > 10) {
                    loggingService.info('🔧 Prompt compiler applied optimizations', {
                        userId: context.userId,
                        originalTokens: compilationResult.metrics.originalTokens,
                        optimizedTokens: compilationResult.metrics.optimizedTokens,
                        reduction: `${compilationResult.metrics.tokenReduction.toFixed(1)}%`,
                        passes: compilationResult.metrics.optimizationPasses.length
                    });
                    
                    // Update request with optimized prompt
                    if (req.body.prompt) {
                        proxyRequest.data = {
                            ...proxyRequest.data,
                            prompt: compilationResult.optimizedPrompt
                        };
                        req.body.prompt = compilationResult.optimizedPrompt;
                    } else if (req.body.messages) {
                        // Update last message with optimized content
                        const messages = [...req.body.messages];
                        messages[messages.length - 1] = {
                            ...messages[messages.length - 1],
                            content: compilationResult.optimizedPrompt
                        };
                        proxyRequest.data = {
                            ...proxyRequest.data,
                            messages
                        };
                        req.body.messages = messages;
                    }
                    
                    // Analyze parallelization opportunities
                    if (compilationResult.ast) {
                        const parallelAnalysis = ParallelExecutionOptimizerService.analyzeParallelizationOpportunities(
                            compilationResult.ast
                        );
                        
                        if (parallelAnalysis.parallelizationPercentage > 30) {
                            loggingService.info('📊 Parallel execution opportunities detected', {
                                userId: context.userId,
                                parallelizableNodes: parallelAnalysis.parallelizableNodes,
                                percentage: `${parallelAnalysis.parallelizationPercentage.toFixed(1)}%`,
                                estimatedSpeedup: `${parallelAnalysis.estimatedSpeedup.toFixed(2)}x`,
                                recommendedParallelism: parallelAnalysis.recommendedMaxParallelism
                            });
                            
                            // Push proactive suggestion about parallelization
                            ProactiveSuggestionsService.generateSuggestionsForUser(
                                context.userId!
                            ).catch((err: any) => {
                                loggingService.debug('Suggestion generation failed', { error: err.message });
                            });
                        }
                    }
                }
            }
        } catch (error) {
            loggingService.warn('Prompt compilation failed, continuing with original', {
                error: error instanceof Error ? error.message : String(error),
                userId: context.userId
            });
        }

        return proxyRequest;
    }

    /**
     * Apply Gateway Cortex processing for memory-efficient request transformation
     * 
     * @param req - Express request object
     * @param proxyRequest - The proxy request configuration to modify
     * @returns Modified proxy request with Cortex processing applied
     */
    static async applyCortexProcessing(
        req: Request,
        proxyRequest: ProxyRequestConfig
    ): Promise<ProxyRequestConfig> {
        const context = req.gatewayContext!;

        if (!context.cortexEnabled || !GatewayCortexService.isEligibleForCortex(req.body, context)) {
            return proxyRequest;
        }

        loggingService.info('🔄 Processing request through Gateway Cortex', {
            requestId: context.requestId,
            coreModel: context.cortexCoreModel,
            operation: context.cortexOperation
        });

        try {
            const cortexResult = await GatewayCortexService.processGatewayRequest(req, req.body);
            
            if (!cortexResult.shouldBypass) {
                proxyRequest.data = cortexResult.processedBody;
                
                loggingService.info('✅ Gateway Cortex processing completed', {
                    requestId: context.requestId,
                    tokensSaved: cortexResult.cortexMetadata.tokensSaved,
                    reductionPercentage: cortexResult.cortexMetadata.reductionPercentage?.toFixed(1),
                    processingTime: cortexResult.cortexMetadata.processingTime
                });
            }
        } catch (cortexError) {
            loggingService.warn('⚠️ Gateway Cortex processing failed, continuing with original request', {
                requestId: context.requestId,
                error: cortexError instanceof Error ? cortexError.message : String(cortexError)
            });
        }

        return proxyRequest;
    }

    /**
     * Prepare the proxy request to the AI provider with all necessary headers and configuration
     * 
     * @param req - Express request object
     * @returns Configured proxy request ready to be sent
     */
    static async prepareProxyRequest(req: Request): Promise<ProxyRequestConfig> {
        const context = req.gatewayContext!;
        
        // Build the full target URL
        const targetUrl = new URL(context.targetUrl!);
        const fullUrl = `${targetUrl.origin}${req.path}`;
        
        // Prepare headers - remove gateway-specific headers
        const headers = { ...req.headers };
        Object.keys(headers).forEach(key => {
            if (key.toLowerCase().startsWith('costkatana-')) {
                delete headers[key];
            }
        });
        
        // Add Content-Type if not present
        if (!headers['content-type']) {
            headers['content-type'] = 'application/json';
        }

        // Add provider API key - check if we have a resolved proxy key first
        let providerApiKey: string | null = null;
        
        if (context.providerKey) {
            // Use the resolved provider API key from proxy key authentication
            providerApiKey = context.providerKey;
            loggingService.info('Using resolved proxy key for provider', { 
                hostname: targetUrl.hostname, 
                provider: context.provider,
                proxyKeyId: context.proxyKeyId,
                requestId: req.headers['x-request-id'] as string
            });
        } else {
            // Fall back to environment variables
            providerApiKey = this.getProviderApiKey(targetUrl.hostname);
            loggingService.info('Using environment API key for provider', { 
                hostname: targetUrl.hostname, 
                hasKey: !!providerApiKey,
                requestId: req.headers['x-request-id'] as string
            });
        }
        
        if (providerApiKey) {
            headers['authorization'] = `Bearer ${providerApiKey}`;
        } else {
            loggingService.warn('No API key found for provider', { 
                hostname: targetUrl.hostname,
                requestId: req.headers['x-request-id'] as string
            });
        }

        // Override model if specified
        let body = req.body;
        if (context.modelOverride && body && typeof body === 'object') {
            body = { ...body, model: context.modelOverride };
        }

        // Add headers to bypass Cloudflare detection
        headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headers['Accept'] = 'application/json, text/plain, */*';
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['Accept-Encoding'] = 'gzip, deflate, br';
        headers['Connection'] = 'keep-alive';
        headers['Sec-Fetch-Dest'] = 'empty';
        headers['Sec-Fetch-Mode'] = 'cors';
        headers['Sec-Fetch-Site'] = 'cross-site';
        
        // Add proper Host header to bypass Cloudflare
        headers['Host'] = targetUrl.hostname;

        return {
            method: req.method,
            url: fullUrl,
            headers,
            data: body,
            timeout: 120000, // 2 minutes timeout
            validateStatus: () => true, // Don't throw on HTTP error status
            httpsAgent: this.httpsAgent, // Use shared connection pool
            maxRedirects: 5,
            decompress: true
        };
    }

    /**
     * Get the appropriate API key for the target provider
     * 
     * @param hostname - The hostname of the target provider
     * @returns API key string or null if not found
     */
    private static getProviderApiKey(hostname: string): string | null {
        const host = hostname.toLowerCase();
        
        if (host.includes('openai.com')) {
            return process.env.OPENAI_API_KEY || null;
        }
        
        if (host.includes('anthropic.com')) {
            return process.env.ANTHROPIC_API_KEY || null;
        }
        
        if (host.includes('googleapis.com')) {
            return process.env.GOOGLE_API_KEY || null;
        }
        
        if (host.includes('amazonaws.com')) {
            // AWS Bedrock uses AWS credentials, not API key
            return null;
        }
        
        if (host.includes('cohere.ai')) {
            return process.env.COHERE_API_KEY || null;
        }
        
        if (host.includes('deepseek.com')) {
            return process.env.DEEPSEEK_API_KEY || null;
        }
        
        if (host.includes('groq.com')) {
            return process.env.GROQ_API_KEY || null;
        }
        
        if (host.includes('huggingface.co')) {
            return process.env.HUGGINGFACE_API_KEY || null;
        }
        
        loggingService.warn(`No API key configured for provider: ${hostname}`, {
            hostname
        });
        return null;
    }

    /**
     * Infer service name from target URL
     * 
     * @param url - The target URL
     * @returns Service name string
     */
    static inferServiceFromUrl(url: string): string {
        const hostname = new URL(url).hostname.toLowerCase();
        
        if (hostname.includes('openai.com')) return 'openai';
        if (hostname.includes('anthropic.com')) return 'anthropic';
        if (hostname.includes('googleapis.com')) return 'google-ai';
        if (hostname.includes('cohere.ai')) return 'cohere';
        if (hostname.includes('amazonaws.com')) return 'aws-bedrock';
        if (hostname.includes('azure.com')) return 'azure';
        if (hostname.includes('deepseek.com')) return 'deepseek';
        if (hostname.includes('groq.com')) return 'groq';
        if (hostname.includes('huggingface.co')) return 'huggingface';
        
        return 'openai'; // Default to openai instead of unknown
    }

    /**
     * Infer model from request for tracking purposes
     * 
     * @param req - Express request object
     * @returns Model name string
     */
    static inferModelFromRequest(req: Request): string | undefined {
        try {
            if (req.body?.model) {
                return req.body.model;
            }
            
            // Try to infer from URL path
            const url = req.gatewayContext?.targetUrl || '';
            if (url.includes('claude')) return 'claude';
            if (url.includes('gpt-4')) return 'gpt-4';
            if (url.includes('gpt-3.5')) return 'gpt-3.5';
            if (url.includes('llama')) return 'llama';
            
            return 'unknown';
        } catch (error: any) {
            return 'unknown';
        }
    }
}
