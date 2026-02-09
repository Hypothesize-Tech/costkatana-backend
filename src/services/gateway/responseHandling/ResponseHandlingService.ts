import { Request, Response } from 'express';
import { AxiosResponse } from 'axios';
import { loggingService } from '../../logging.service';

/**
 * Interface for moderation result
 */
export interface ModerationResult {
    response: any;
    moderationApplied: boolean;
    action: string;
    violationCategories: string[];
    isBlocked: boolean;
}

/**
 * Interface for moderation configuration
 */
export interface ModerationConfig {
    enableOutputModeration: boolean;
    toxicityThreshold: number;
    enablePIIDetection: boolean;
    enableToxicityCheck: boolean;
    enableHateSpeechCheck: boolean;
    enableSexualContentCheck: boolean;
    enableViolenceCheck: boolean;
    enableSelfHarmCheck: boolean;
    action: 'allow' | 'annotate' | 'redact' | 'block';
}

/**
 * ResponseHandlingService - Handles response formatting, streaming, and error handling
 * 
 * @description This service extracts all response handling business logic from the gateway controller,
 * including response processing, output moderation, content extraction/replacement, and header management.
 */
export class ResponseHandlingService {
    /**
     * Process response from AI provider, applying privacy settings
     * 
     * @param req - Express request object
     * @param response - Axios response from AI provider
     * @returns Processed response data
     */
    static async processResponse(req: Request, response: AxiosResponse): Promise<any> {
        const context = req.gatewayContext!;
        let responseData = response.data;

        // Apply privacy settings if configured
        if (context.omitResponse) {
            loggingService.info('Response content omitted due to privacy settings', {
                requestId: req.headers['x-request-id'] as string
            });
            responseData = { 
                message: 'Response content omitted for privacy',
                costKatanaNote: 'Original response was processed but not returned due to CostKatana-Omit-Response header'
            };
        }

        return responseData;
    }

    /**
     * Apply output moderation to AI response
     * 
     * @param req - Express request object
     * @param responseData - Response data to moderate
     * @returns Moderation result with processed response
     */
    static async moderateOutput(req: Request, responseData: any): Promise<ModerationResult> {
        const context = req.gatewayContext!;

        try {
            // Check if output moderation is enabled via headers
            const outputModerationEnabled = req.headers['costkatana-output-moderation-enabled'] === 'true';
            
            // Default moderation config (can be customized via headers)
            const moderationConfig: ModerationConfig = {
                enableOutputModeration: outputModerationEnabled,
                toxicityThreshold: parseFloat(req.headers['costkatana-toxicity-threshold'] as string || '0.7'),
                enablePIIDetection: req.headers['costkatana-pii-detection-enabled'] !== 'false',
                enableToxicityCheck: req.headers['costkatana-toxicity-check-enabled'] !== 'false',
                enableHateSpeechCheck: req.headers['costkatana-hate-speech-check-enabled'] !== 'false',
                enableSexualContentCheck: req.headers['costkatana-sexual-content-check-enabled'] !== 'false',
                enableViolenceCheck: req.headers['costkatana-violence-check-enabled'] !== 'false',
                enableSelfHarmCheck: req.headers['costkatana-self-harm-check-enabled'] !== 'false',
                action: (req.headers['costkatana-moderation-action'] as string || 'block') as 'allow' | 'annotate' | 'redact' | 'block'
            };

            if (!moderationConfig.enableOutputModeration) {
                // Return original response without moderation
                return {
                    response: responseData,
                    moderationApplied: false,
                    action: 'allow',
                    violationCategories: [],
                    isBlocked: false
                };
            }

            // Extract content from response
            const responseContent = this.extractContentFromResponse(responseData);
            
            if (!responseContent) {
                loggingService.info('No content found to moderate in response', {
                    requestId: req.headers['x-request-id'] as string
                });
                return {
                    response: responseData,
                    moderationApplied: false,
                    action: 'allow',
                    violationCategories: [],
                    isBlocked: false
                };
            }

            // Apply output moderation
            const { OutputModerationService } = await import('../../outputModeration.service');
            const moderationResult = await OutputModerationService.moderateOutput(
                responseContent,
                moderationConfig,
                context.requestId || 'unknown',
                this.inferModelFromRequest(req)
            );

            loggingService.info('Output moderation completed', {
                requestId: context.requestId,
                isBlocked: moderationResult.isBlocked,
                action: moderationResult.action,
                violationCategories: moderationResult.violationCategories,
                headerRequestId: req.headers['x-request-id'] as string
            });

            // Handle different moderation actions
            let finalResponse = responseData;
            
            if (moderationResult.isBlocked) {
                switch (moderationResult.action) {
                    case 'block':
                        finalResponse = {
                            error: 'Content blocked by moderation',
                            message: 'The AI response was blocked due to policy violations.',
                            details: `Violation categories: ${moderationResult.violationCategories.join(', ')}`,
                            costKatanaNote: 'Response blocked by CostKATANA output moderation system'
                        };
                        break;
                        
                    case 'redact':
                        if (moderationResult.sanitizedContent) {
                            // Replace original content with sanitized version
                            finalResponse = this.replaceContentInResponse(responseData, moderationResult.sanitizedContent);
                        }
                        break;
                        
                    case 'annotate':
                        // Add annotation to response
                        if (typeof finalResponse === 'object') {
                            finalResponse.costKatanaModerationNote = `This response was flagged for: ${moderationResult.violationCategories.join(', ')}`;
                        }
                        break;
                        
                    default: // allow
                        break;
                }
            }

            return {
                response: finalResponse,
                moderationApplied: true,
                action: moderationResult.action,
                violationCategories: moderationResult.violationCategories,
                isBlocked: moderationResult.isBlocked
            };

        } catch (error: any) {
            loggingService.error('Output moderation error', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: req.headers['x-request-id'] as string
            });
            // In case of moderation error, return original response (fail-open)
            return {
                response: responseData,
                moderationApplied: false,
                action: 'allow',
                violationCategories: [],
                isBlocked: false
            };
        }
    }

    /**
     * Extract text content from AI response for moderation
     * 
     * @param responseData - Response data object
     * @returns Extracted content string or null
     */
    static extractContentFromResponse(responseData: any): string | null {
        try {
            if (!responseData) return null;
            
            // Handle different response formats
            if (typeof responseData === 'string') {
                return responseData;
            }
            
            // OpenAI/Anthropic format
            if (responseData.choices && responseData.choices[0]?.message?.content) {
                return responseData.choices[0].message.content;
            }
            
            // Anthropic format
            if (responseData.content && Array.isArray(responseData.content) && responseData.content[0]?.text) {
                return responseData.content[0].text;
            }
            
            // Direct content field
            if (responseData.content) {
                return typeof responseData.content === 'string' ? responseData.content : JSON.stringify(responseData.content);
            }
            
            // Text completion format
            if (responseData.text) {
                return responseData.text;
            }
            
            // Completion format
            if (responseData.completion) {
                return responseData.completion;
            }
            
            // If we can't find specific content fields, stringify the whole response
            return JSON.stringify(responseData);
            
        } catch (error: any) {
            loggingService.warn('Error extracting content from response', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return null;
        }
    }

    /**
     * Replace content in AI response structure
     * 
     * @param responseData - Original response data
     * @param newContent - New content to replace
     * @returns Modified response with new content
     */
    static replaceContentInResponse(responseData: any, newContent: string): any {
        try {
            if (!responseData || typeof responseData !== 'object') {
                return newContent;
            }
            
            const modifiedResponse = JSON.parse(JSON.stringify(responseData)); // Deep clone
            
            // Handle different response formats
            if (modifiedResponse.choices && modifiedResponse.choices[0]?.message) {
                modifiedResponse.choices[0].message.content = newContent;
            } else if (modifiedResponse.content && Array.isArray(modifiedResponse.content) && modifiedResponse.content[0]) {
                modifiedResponse.content[0].text = newContent;
            } else if (modifiedResponse.content) {
                modifiedResponse.content = newContent;
            } else if (modifiedResponse.text) {
                modifiedResponse.text = newContent;
            } else if (modifiedResponse.completion) {
                modifiedResponse.completion = newContent;
            } else {
                // If we can't identify the structure, return the new content with a note
                return {
                    ...modifiedResponse,
                    content: newContent,
                    costKatanaModerationNote: 'Content was modified by output moderation'
                };
            }
            
            return modifiedResponse;
            
        } catch (error: any) {
            loggingService.warn('Error replacing content in response', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return responseData;
        }
    }

    /**
     * Add response headers to the Express response
     * 
     * @param req - Express request object
     * @param res - Express response object
     * @param response - Axios response from AI provider
     * @param moderationResult - Moderation result
     * @param failoverProviderIndex - Index of provider used in failover (if applicable)
     */
    static addResponseHeaders(
        req: Request,
        res: Response,
        response: AxiosResponse,
        moderationResult: ModerationResult,
        failoverProviderIndex: number = -1
    ): void {
        const context = req.gatewayContext!;

        // Set response status
        res.status(response.status);
        
        // Add CostKatana-Request-Id header for feedback tracking
        if (context.requestId) {
            res.setHeader('CostKatana-Request-Id', context.requestId);
        }

        // Add Cortex response headers if Cortex was used
        if (context.cortexEnabled && context.cortexMetadata) {
            const { GatewayCortexService } = require('../../gatewayCortex.service');
            GatewayCortexService.addCortexResponseHeaders(res, context);
        }
        
        // Add CostKatana-Failover-Index header for failover requests
        if (context.failoverEnabled && failoverProviderIndex >= 0) {
            res.setHeader('CostKatana-Failover-Index', failoverProviderIndex.toString());
        }
        
        // Copy relevant headers from the AI provider response
        const headersToForward = ['content-type', 'content-length', 'content-encoding'];
        headersToForward.forEach(header => {
            if (response.headers[header]) {
                res.setHeader(header, response.headers[header]);
            }
        });

        // Add moderation headers
        if (moderationResult.moderationApplied) {
            res.setHeader('CostKatana-Moderation-Applied', 'true');
            res.setHeader('CostKatana-Moderation-Action', moderationResult.action);
            if (moderationResult.violationCategories.length > 0) {
                res.setHeader('CostKatana-Moderation-Categories', moderationResult.violationCategories.join(','));
            }
        }

        // 🚀 Add prompt caching headers if caching was applied
        if (context.promptCaching?.enabled) {
            const cacheData = context.promptCaching;

            // Core prompt caching headers
            res.setHeader('CostKatana-Prompt-Caching-Enabled', 'true');
            res.setHeader('CostKatana-Prompt-Caching-Type', cacheData.type || 'automatic');
            res.setHeader('CostKatana-Prompt-Caching-Estimated-Savings', cacheData.estimatedSavings?.toFixed(6) || '0.000000');

            // Add provider-specific cache headers
            if (cacheData.cacheHeaders) {
                Object.entries(cacheData.cacheHeaders as Record<string, string>).forEach(([key, value]) => {
                    res.setHeader(key, value);
                });
            }

            loggingService.debug('Prompt caching headers added to response', {
                requestId: context.requestId,
                cacheType: cacheData.type,
                estimatedSavings: cacheData.estimatedSavings,
                headerCount: cacheData.cacheHeaders ? Object.keys(cacheData.cacheHeaders).length : 0
            });
        }
    }

    /**
     * Send cache hit response
     * 
     * @param req - Express request object
     * @param res - Express response object
     * @param cachedResponse - Cached response data
     */
    static sendCacheHitResponse(req: Request, res: Response, cachedResponse: any): void {
        const context = req.gatewayContext!;

        loggingService.info('Cache hit - returning cached response', {
            requestId: req.headers['x-request-id'] as string
        });

        res.setHeader('CostKatana-Cache-Status', 'HIT');
        
        if (context.requestId) {
            res.setHeader('CostKatana-Request-Id', context.requestId);
        }
        
        res.status(200).json(cachedResponse.response);
    }

    /**
     * Send budget exceeded error response
     * 
     * @param req - Express request object
     * @param res - Express response object
     * @param blockData - Budget block data with details
     */
    static sendBudgetExceededResponse(
        req: Request,
        res: Response,
        blockData: { 
            allowed: boolean; 
            message?: string; 
            simulation?: any;
            cheaperAlternatives?: any[];
        }
    ): void {
        const context = req.gatewayContext!;

        loggingService.error('❌ HARD BLOCK: Budget violation prevented', {
            userId: context.userId,
            budgetId: context.budgetId,
            estimatedCost: blockData.simulation?.originalRequest?.estimatedCost,
            reason: blockData.message,
            requestId: req.headers['x-request-id'] as string
        });

        // Return detailed error with alternatives
        res.status(402).json({
            error: 'BUDGET_EXCEEDED',
            message: blockData.message || 'Budget limit exceeded - request blocked',
            budgetId: context.budgetId,
            estimatedCost: blockData.simulation?.originalRequest?.estimatedCost,
            cheaperAlternatives: blockData.cheaperAlternatives || [],
            suggestedActions: [
                'Upgrade your plan to increase budget limits',
                'Use a cheaper model from the alternatives list',
                'Reduce prompt length to lower costs',
                'Wait until next billing cycle'
            ],
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Send firewall blocked response
     * 
     * @param req - Express request object
     * @param res - Express response object
     * @param firewallResult - Firewall check result
     */
    static sendFirewallBlockedResponse(
        req: Request,
        res: Response,
        firewallResult: any
    ): void {
        let statusCode = 400;
        let errorCode = 'PROMPT_BLOCKED_BY_FIREWALL';
        
        if (firewallResult.containmentAction === 'human_review') {
            statusCode = 202;
            errorCode = 'PROMPT_REQUIRES_REVIEW';
        }

        const response: any = {
            success: false,
            error: {
                code: errorCode,
                message: firewallResult.containmentAction === 'human_review'
                    ? 'The request requires human review due to security considerations.'
                    : 'The request was blocked by the CostKATANA security system due to a detected threat.',
                details: `${firewallResult.reason}. View threat category and details in your CostKATANA security dashboard for request ID: ${req.headers['x-request-id'] || 'unknown'}`
            },
            security: {
                category: firewallResult.threatCategory,
                confidence: firewallResult.confidence,
                riskScore: firewallResult.riskScore,
                stage: firewallResult.stage,
                containmentAction: firewallResult.containmentAction,
                matchedPatterns: firewallResult.matchedPatterns?.length || 0
            }
        };

        if (firewallResult.humanReviewId) {
            response.humanReview = {
                reviewId: firewallResult.humanReviewId,
                status: 'pending',
                message: 'Your request is pending human review. You will be notified once reviewed.'
            };
        }

        res.status(statusCode).json(response);
    }

    /**
     * Send circuit breaker open response
     * 
     * @param res - Express response object
     * @param provider - Provider name
     * @param retryAfter - Seconds until retry
     */
    static sendCircuitBreakerResponse(
        res: Response,
        provider: string,
        retryAfter: number
    ): void {
        res.status(503).json({
            error: 'Service temporarily unavailable',
            message: `Circuit breaker is open for ${provider}`,
            retryAfter
        });
    }

    /**
     * Infer model from request for moderation purposes
     * 
     * @param req - Express request object
     * @returns Model name string or undefined
     */
    private static inferModelFromRequest(req: Request): string | undefined {
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
