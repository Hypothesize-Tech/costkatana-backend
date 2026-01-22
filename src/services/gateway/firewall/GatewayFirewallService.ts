import { Request } from 'express';
import { loggingService } from '../../logging.service';

/**
 * GatewayFirewallService - Handles request filtering and security checks
 * Provides comprehensive security scanning for prompts and tool calls
 */
export class GatewayFirewallService {
    /**
     * Check request through comprehensive security system
     */
    static async checkFirewallRules(req: Request): Promise<{
        isBlocked: boolean;
        confidence: number;
        reason: string;
        stage: string;
        containmentAction: string;
        threatCategory?: string;
        riskScore?: number;
        matchedPatterns?: any[];
        humanReviewId?: string;
    }> {
        const context = req.gatewayContext!;
        
        try {
            // Import LLMSecurityService dynamically to avoid circular dependencies
            const { LLMSecurityService } = await import('../../llmSecurity.service');
            
            // Extract prompt from request body
            const prompt = GatewayFirewallService.extractPromptFromRequest(req.body);
            if (!prompt) {
                // If no prompt found, allow the request
                return {
                    isBlocked: false,
                    confidence: 0.0,
                    reason: 'No prompt content found to analyze',
                    stage: 'prompt-guard',
                    containmentAction: 'allow'
                };
            }

            // Extract tool calls if present (for comprehensive tool security)
            const toolCalls = GatewayFirewallService.extractToolCallsFromRequest(req.body);

            // Estimate cost for this request (for analytics)
            const estimatedCost = GatewayFirewallService.estimateRequestCost(req.body, null);
            
            // Generate request ID for tracking
            const requestId = req.headers['x-request-id'] as string || 
                             `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Extract IP address and user agent for logging
            const ipAddress = req.ip || 
                            req.headers['x-forwarded-for']?.toString().split(',')[0] || 
                            req.socket.remoteAddress || 
                            'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';

            // Run comprehensive security check (automatically handles HTML content)
            // The LLMSecurityService -> PromptFirewallService -> HTMLSecurityService chain
            // will extract text from HTML and scan for all threat categories
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                prompt,
                requestId,
                context.userId,
                {
                    toolCalls,
                    provenanceSource: context.targetUrl,
                    estimatedCost,
                    ipAddress,
                    userAgent,
                    source: 'gateway'
                }
            );

            const result = securityCheck.result;

            // Handle different containment actions
            if (result.containmentAction === 'human_review') {
                // For human review, we'll block the request but provide special handling
                return {
                    isBlocked: true,
                    confidence: result.confidence,
                    reason: `Request requires human approval. Review ID: ${securityCheck.humanReviewId}`,
                    stage: result.stage,
                    containmentAction: result.containmentAction || 'human_review',
                    threatCategory: result.threatCategory,
                    riskScore: result.riskScore,
                    matchedPatterns: result.matchedPatterns,
                    humanReviewId: securityCheck.humanReviewId
                };
            } else if (result.containmentAction === 'sandbox') {
                // For sandbox, we could implement request sandboxing
                // For now, we'll allow but log as sandboxed
                loggingService.info('Request sandboxed - proceeding with monitoring', {
                    requestId,
                    userId: context.userId,
                    threatCategory: result.threatCategory,
                    riskScore: result.riskScore
                });
                
                // Allow the request but mark it as sandboxed
                return {
                    isBlocked: false,
                    confidence: result.confidence,
                    reason: 'Request allowed in sandbox mode - monitoring enabled',
                    stage: result.stage,
                    containmentAction: result.containmentAction || 'sandbox',
                    threatCategory: result.threatCategory,
                    riskScore: result.riskScore,
                    matchedPatterns: result.matchedPatterns
                };
            }

            // Standard block/allow behavior
            if (context.userId && result.isBlocked) {
                // Enhanced logging with new security data
                loggingService.info('Security system blocked request', {
                    requestId,
                    userId: context.userId,
                    threatCategory: result.threatCategory,
                    confidence: result.confidence,
                    riskScore: result.riskScore,
                    stage: result.stage,
                    containmentAction: result.containmentAction,
                    costSaved: estimatedCost,
                    matchedPatterns: result.matchedPatterns
                });
            }

            return {
                isBlocked: result.isBlocked,
                confidence: result.confidence,
                reason: result.reason,
                stage: result.stage,
                containmentAction: result.containmentAction || 'allow',
                threatCategory: result.threatCategory,
                riskScore: result.riskScore,
                matchedPatterns: result.matchedPatterns,
                humanReviewId: securityCheck.humanReviewId
            };

        } catch (error: any) {
            loggingService.error('Error in security check', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                userId: context.userId,
                targetUrl: context.targetUrl
            });

            // In case of error, allow the request to proceed (fail-open)
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'Security check failed - allowing request',
                stage: 'prompt-guard',
                containmentAction: 'allow'
            };
        }
    }

    /**
     * Validate request against firewall rules
     */
    static async validateRequest(
        prompt: string,
        userId?: string,
        metadata?: Record<string, any>
    ): Promise<{
        isValid: boolean;
        reason?: string;
        threatCategory?: string;
        riskScore?: number;
    }> {
        try {
            const { LLMSecurityService } = await import('../../llmSecurity.service');
            
            const requestId = `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                prompt,
                requestId,
                userId,
                metadata
            );

            return {
                isValid: !securityCheck.result.isBlocked,
                reason: securityCheck.result.reason,
                threatCategory: securityCheck.result.threatCategory,
                riskScore: securityCheck.result.riskScore
            };
        } catch (error: any) {
            loggingService.error('Request validation error', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                userId
            });
            return {
                isValid: true, // Fail-open
                reason: 'Validation failed - allowing request'
            };
        }
    }

    /**
     * Detect threats in prompt content
     */
    static async detectThreats(
        prompt: string,
        options?: {
            userId?: string;
            checkToolCalls?: boolean;
            strictMode?: boolean;
        }
    ): Promise<{
        threatsDetected: boolean;
        threats: Array<{
            category: string;
            confidence: number;
            severity: string;
        }>;
        riskScore: number;
    }> {
        try {
            const { LLMSecurityService } = await import('../../llmSecurity.service');
            
            const requestId = `threat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                prompt,
                requestId,
                options?.userId,
                {
                    source: 'threat-detection'
                }
            );

            const result = securityCheck.result;

            return {
                threatsDetected: result.isBlocked,
                threats: result.matchedPatterns?.map((pattern: any) => ({
                    category: result.threatCategory || 'unknown',
                    confidence: result.confidence,
                    severity: result.riskScore && result.riskScore > 0.7 ? 'high' : 
                             result.riskScore && result.riskScore > 0.4 ? 'medium' : 'low'
                })) || [],
                riskScore: result.riskScore || 0
            };
        } catch (error: any) {
            loggingService.error('Threat detection error', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return {
                threatsDetected: false,
                threats: [],
                riskScore: 0
            };
        }
    }

    /**
     * Extract prompt text from various request formats
     */
    private static extractPromptFromRequest(requestBody: any): string | null {
        if (!requestBody) return null;

        try {
            // OpenAI format
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                return requestBody.messages
                    .map((msg: any) => msg.content || '')
                    .filter((content: string) => content.trim().length > 0)
                    .join('\n');
            }

            // Anthropic format
            if (requestBody.prompt && typeof requestBody.prompt === 'string') {
                return requestBody.prompt;
            }

            // Google AI format
            if (requestBody.contents && Array.isArray(requestBody.contents)) {
                return requestBody.contents
                    .flatMap((content: any) => content.parts || [])
                    .map((part: any) => part.text || '')
                    .filter((text: string) => text.trim().length > 0)
                    .join('\n');
            }

            // Cohere format
            if (requestBody.message && typeof requestBody.message === 'string') {
                return requestBody.message;
            }

            // Generic text field
            if (requestBody.text && typeof requestBody.text === 'string') {
                return requestBody.text;
            }

            // Input field
            if (requestBody.input && typeof requestBody.input === 'string') {
                return requestBody.input;
            }

            return null;

        } catch (error: any) {
            loggingService.error('Error extracting prompt from request', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return null;
        }
    }

    /**
     * Extract tool calls from various request formats
     */
    private static extractToolCallsFromRequest(requestBody: any): any[] | undefined {
        if (!requestBody) return undefined;

        try {
            // OpenAI format - tools can be in different places
            if (requestBody.tools && Array.isArray(requestBody.tools)) {
                return requestBody.tools;
            }

            // Function calling in messages
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                const toolCalls: any[] = [];
                
                requestBody.messages.forEach((msg: any) => {
                    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                        toolCalls.push(...msg.tool_calls);
                    }
                });
                
                return toolCalls.length > 0 ? toolCalls : undefined;
            }

            // Anthropic function calling
            if (requestBody.tools && Array.isArray(requestBody.tools)) {
                return requestBody.tools;
            }

            // Google AI function calling
            if (requestBody.function_declarations && Array.isArray(requestBody.function_declarations)) {
                return requestBody.function_declarations;
            }

            return undefined;

        } catch (error: any) {
            loggingService.warn('Error extracting tool calls from request', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return undefined;
        }
    }

    /**
     * Estimate cost of a request (simplified calculation)
     */
    private static estimateRequestCost(requestBody: any, response: any): number {
        try {
            // Simple estimation based on token usage from response
            if (response && response.usage) {
                const promptTokens = response.usage.prompt_tokens || 0;
                const completionTokens = response.usage.completion_tokens || 0;
                
                // Use basic pricing (can be refined based on actual model)
                const promptCost = promptTokens * 0.00001; // $0.01 per 1K tokens
                const completionCost = completionTokens * 0.00002; // $0.02 per 1K tokens
                
                return promptCost + completionCost;
            }
            
            // Fallback estimation based on request size
            const requestSize = JSON.stringify(requestBody || {}).length;
            return Math.max(0.001, requestSize * 0.000001); // Minimum $0.001
        } catch (error: any) {
            loggingService.warn('Failed to estimate request cost', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return 0.001; // Default minimum cost
        }
    }
}
