import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { aiLogger } from '../services/aiLogger.service';

/**
 * Bedrock Client Interceptor
 * Automatically logs all Bedrock AI operations
 */

interface BedrockLogContext {
    userId?: string;
    projectId?: string;
    requestId?: string;
    workflowId?: string;
    experimentId?: string;
    sessionId?: string;
    cortexEnabled?: boolean;
    tags?: string[];
}

/**
 * Wrap Bedrock client send method to auto-log operations
 */
export function wrapBedrockClient(
    client: BedrockRuntimeClient,
    context: BedrockLogContext = {}
): BedrockRuntimeClient {
    const originalSend = client.send.bind(client);
    
    (client as any).send = async function(command: any): Promise<any> {
        const startTime = Date.now();
        const requestId = context.requestId || `bedrock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        let modelId = 'unknown';
        let inputTokens = 0;
        let outputTokens = 0;
        let prompt = '';
        let parameters: any = {};
        let operation = 'unknown';
        
        try {
            // Extract command details
            if (command instanceof InvokeModelCommand) {
                operation = 'invokeModel';
                modelId = command.input.modelId || 'unknown';
                
                // Parse request body
                if (command.input.body) {
                    const bodyBytes = command.input.body instanceof Uint8Array 
                        ? command.input.body 
                        : new Uint8Array(Buffer.from(command.input.body as any));
                    const bodyString = new TextDecoder().decode(bodyBytes);
                    const body = JSON.parse(bodyString);
                    
                    // Extract prompt (different formats for different models)
                    if (body.messages) {
                        prompt = JSON.stringify(body.messages);
                        inputTokens = estimateTokens(prompt);
                    } else if (body.prompt) {
                        prompt = body.prompt;
                        inputTokens = estimateTokens(prompt);
                    } else if (body.inputText) {
                        prompt = body.inputText;
                        inputTokens = estimateTokens(prompt);
                    }
                    
                    // Extract parameters
                    parameters = {
                        temperature: body.temperature,
                        maxTokens: body.max_tokens || body.maxTokens,
                        topP: body.top_p || body.topP,
                        topK: body.top_k || body.topK,
                        stopSequences: body.stop_sequences || body.stopSequences
                    };
                }
            } else if (command instanceof InvokeModelWithResponseStreamCommand) {
                operation = 'invokeModelStream';
                modelId = command.input.modelId || 'unknown';
                
                if (command.input.body) {
                    const bodyBytes = command.input.body instanceof Uint8Array 
                        ? command.input.body 
                        : new Uint8Array(Buffer.from(command.input.body as any));
                    const bodyString = new TextDecoder().decode(bodyBytes);
                    const body = JSON.parse(bodyString);
                    prompt = body.messages ? JSON.stringify(body.messages) : body.prompt || '';
                    inputTokens = estimateTokens(prompt);
                    parameters = {
                        temperature: body.temperature,
                        maxTokens: body.max_tokens || body.maxTokens
                    };
                }
            }
            
            // Execute the actual command
            const response = await originalSend(command);
            const responseTime = Date.now() - startTime;
            
            // Parse response
            let result = '';
            let cost = 0;
            let success = true;
            let statusCode = 200;
            
            if ('body' in response && response.body) {
                const bodyBytes = response.body instanceof Uint8Array 
                    ? response.body 
                    : new Uint8Array(Buffer.from(response.body as any));
                const bodyString = new TextDecoder().decode(bodyBytes);
                const responseBody = JSON.parse(bodyString);
                
                // Extract result based on model response format
                if (responseBody.content) {
                    result = JSON.stringify(responseBody.content);
                    outputTokens = responseBody.usage?.output_tokens || estimateTokens(result);
                } else if (responseBody.completion) {
                    result = responseBody.completion;
                    outputTokens = estimateTokens(result);
                } else if (responseBody.results) {
                    result = responseBody.results[0]?.outputText || '';
                    outputTokens = estimateTokens(result);
                }
                
                // Extract token usage from response
                if (responseBody.usage) {
                    inputTokens = responseBody.usage.input_tokens || inputTokens;
                    outputTokens = responseBody.usage.output_tokens || outputTokens;
                }
                
                // Calculate cost
                cost = estimateCost(modelId, inputTokens, outputTokens);
            }
            
            // Log successful operation
            await aiLogger.logAICall({
                userId: context.userId || 'system',
                projectId: context.projectId,
                requestId,
                service: 'aws-bedrock',
                operation,
                aiModel: modelId,
                endpoint: '/bedrock/invoke',
                method: 'POST',
                statusCode,
                success,
                responseTime,
                inputTokens,
                outputTokens,
                prompt,
                parameters,
                result,
                cost,
                workflowId: context.workflowId,
                experimentId: context.experimentId,
                sessionId: context.sessionId,
                cortexEnabled: context.cortexEnabled,
                tags: context.tags,
                region: process.env.AWS_REGION,
                logSource: 'bedrock-interceptor'
            });
            
            return response;
            
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            const statusCode = error.$metadata?.httpStatusCode || 500;
            const errorType = categorizeBedrockError(error);
            
            // Log failed operation
            await aiLogger.logAICall({
                userId: context.userId || 'system',
                projectId: context.projectId,
                requestId,
                service: 'aws-bedrock',
                operation,
                aiModel: modelId,
                endpoint: '/bedrock/invoke',
                method: 'POST',
                statusCode,
                success: false,
                responseTime,
                inputTokens,
                outputTokens: 0,
                prompt,
                parameters,
                errorMessage: error.message,
                errorType,
                errorCode: error.name || error.code,
                errorStack: error.stack,
                workflowId: context.workflowId,
                experimentId: context.experimentId,
                sessionId: context.sessionId,
                cortexEnabled: context.cortexEnabled,
                tags: context.tags,
                region: process.env.AWS_REGION,
                logLevel: 'ERROR',
                logSource: 'bedrock-interceptor'
            });
            
            throw error;
        }
    };
    
    return client;
}

/**
 * Create a logged Bedrock client
 */
export function createLoggedBedrockClient(context: BedrockLogContext = {}): BedrockRuntimeClient {
    const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        }
    });
    
    return wrapBedrockClient(client, context);
}

/**
 * Estimate tokens from text (rough approximation)
 */
function estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
}

/**
 * Estimate cost based on model and tokens
 */
function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const costs: Record<string, { input: number; output: number }> = {
        'anthropic.claude-3-opus': { input: 0.015, output: 0.075 },
        'anthropic.claude-3-sonnet': { input: 0.003, output: 0.015 },
        'anthropic.claude-3-haiku': { input: 0.00025, output: 0.00125 },
        'anthropic.claude-3-5-sonnet': { input: 0.003, output: 0.015 },
        'anthropic.claude-3-5-haiku': { input: 0.0008, output: 0.004 },
        'amazon.nova-pro': { input: 0.0008, output: 0.0032 },
        'amazon.nova-lite': { input: 0.00006, output: 0.00024 },
        'amazon.nova-micro': { input: 0.000035, output: 0.00014 },
        'amazon.titan-text-express': { input: 0.0002, output: 0.0006 },
        'amazon.titan-text-lite': { input: 0.00015, output: 0.0002 },
        'meta.llama3-70b': { input: 0.00099, output: 0.00099 },
        'meta.llama3-8b': { input: 0.0003, output: 0.0006 },
        'cohere.command-r-plus': { input: 0.003, output: 0.015 },
        'cohere.command-r': { input: 0.0005, output: 0.0015 },
        'ai21.jamba-instruct': { input: 0.0005, output: 0.0007 }
    };
    
    // Find matching cost structure
    let modelCosts = { input: 0.001, output: 0.002 }; // Default
    
    for (const [key, value] of Object.entries(costs)) {
        if (modelId.includes(key)) {
            modelCosts = value;
            break;
        }
    }
    
    // Cost per 1K tokens
    return ((inputTokens / 1000) * modelCosts.input) + ((outputTokens / 1000) * modelCosts.output);
}

/**
 * Categorize Bedrock errors
 */
function categorizeBedrockError(error: any): string {
    const errorName = error.name || error.code || '';
    const statusCode = error.$metadata?.httpStatusCode || 0;
    
    if (errorName.includes('Throttling') || statusCode === 429) return 'throttling';
    if (errorName.includes('AccessDenied') || statusCode === 403) return 'auth_error';
    if (errorName.includes('ValidationException') || statusCode === 400) return 'validation_error';
    if (errorName.includes('ServiceQuotaExceededException')) return 'quota_exceeded';
    if (errorName.includes('Timeout') || statusCode === 408) return 'timeout';
    if (statusCode >= 500) return 'server_error';
    if (statusCode >= 400) return 'client_error';
    return 'unknown';
}

/**
 * Helper to extract Bedrock context from request
 */
export function extractBedrockContext(req: any): BedrockLogContext {
    return {
        userId: req.user?.id || req.userId,
        projectId: req.projectId || req.body?.projectId || req.query?.projectId,
        requestId: req.aiLogContext?.requestId || req.headers?.['x-request-id'],
        workflowId: req.body?.workflowId || req.query?.workflowId,
        experimentId: req.body?.experimentId || req.query?.experimentId,
        sessionId: req.body?.sessionId || req.query?.sessionId,
        cortexEnabled: req.body?.cortex?.enabled || false,
        tags: req.body?.tags || []
    };
}

