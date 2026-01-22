import { Request } from 'express';
import { LLMSecurityService } from '@services/llmSecurity.service';
import { loggingService } from '@services/logging.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Security check result interface
 */
export interface SecurityCheckResult {
    passed: boolean;
    isBlocked: boolean;
    threatCategory?: string;
    confidence?: number;
    stage?: string;
    reason?: string;
}

/**
 * Security context for requests
 */
export interface SecurityContext {
    requestId: string;
    ipAddress: string;
    userAgent: string;
    estimatedTokens: number;
    estimatedCost: number;
}

/**
 * ChatSecurityHandler
 * Centralizes security checks, IP extraction, and threat detection for chat requests
 * Eliminates duplication across controllers
 */
export class ChatSecurityHandler {
    
    /**
     * Extract IP address from request
     * Handles x-forwarded-for, socket remoteAddress, and direct IP
     * 
     * @param req - Express request object
     * @returns IP address string
     */
    static extractIpAddress(req: Request): string {
        return req.ip || 
               req.headers['x-forwarded-for']?.toString().split(',')[0] || 
               req.socket.remoteAddress || 
               'unknown';
    }

    /**
     * Extract user agent from request headers
     * 
     * @param req - Express request object
     * @returns User agent string
     */
    static extractUserAgent(req: Request): string {
        return req.headers['user-agent'] || 'unknown';
    }

    /**
     * Generate request ID for tracking
     * Uses x-request-id header if available, otherwise generates new UUID
     * 
     * @param req - Express request object
     * @param prefix - Optional prefix for generated ID (default: 'chat')
     * @returns Request ID string
     */
    static generateRequestId(req: Request, prefix: string = 'chat'): string {
        return req.headers['x-request-id'] as string || 
               `${prefix}_${Date.now()}_${uuidv4()}`;
    }

    /**
     * Estimate tokens from message length
     * Uses standard 4 characters per token estimation
     * 
     * @param messageLength - Length of message in characters
     * @param maxTokens - Maximum output tokens expected
     * @returns Estimated total tokens
     */
    static estimateTokens(messageLength: number, maxTokens: number = 1000): number {
        return Math.ceil(messageLength / 4) + maxTokens;
    }

    /**
     * Estimate cost for request
     * Uses rough estimate of $0.01 per 1000 tokens
     * 
     * @param estimatedTokens - Total estimated tokens
     * @returns Estimated cost in dollars
     */
    static estimateCost(estimatedTokens: number): number {
        return estimatedTokens * 0.00001; // $0.01 per 1000 tokens
    }

    /**
     * Build security context from request
     * Extracts all security-related information in one place
     * 
     * @param req - Express request object
     * @param messageLength - Length of message being sent
     * @param maxTokens - Maximum output tokens
     * @returns SecurityContext object
     */
    static buildSecurityContext(
        req: Request, 
        messageLength: number, 
        maxTokens: number = 1000
    ): SecurityContext {
        const requestId = this.generateRequestId(req);
        const ipAddress = this.extractIpAddress(req);
        const userAgent = this.extractUserAgent(req);
        const estimatedTokens = this.estimateTokens(messageLength, maxTokens);
        const estimatedCost = this.estimateCost(estimatedTokens);

        return {
            requestId,
            ipAddress,
            userAgent,
            estimatedTokens,
            estimatedCost
        };
    }

    /**
     * Perform comprehensive security check on message
     * Checks for all 15 threat categories including HTML content
     * 
     * @param message - Message content to check
     * @param userId - User ID for tracking
     * @param context - Security context
     * @returns SecurityCheckResult
     */
    static async performSecurityCheck(
        message: string,
        userId: string,
        context: SecurityContext
    ): Promise<SecurityCheckResult> {
        try {
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                message,
                context.requestId,
                userId,
                {
                    estimatedCost: context.estimatedCost,
                    provenanceSource: 'chat-api',
                    ipAddress: context.ipAddress,
                    userAgent: context.userAgent,
                    source: 'chat-api'
                }
            );

            // Log based on result
            if (securityCheck.result.isBlocked) {
                loggingService.warn('Chat message blocked by security', {
                    requestId: context.requestId,
                    userId,
                    threatCategory: securityCheck.result.threatCategory,
                    confidence: securityCheck.result.confidence,
                    stage: securityCheck.result.stage,
                    reason: securityCheck.result.reason
                });

                return {
                    passed: false,
                    isBlocked: true,
                    threatCategory: securityCheck.result.threatCategory,
                    confidence: securityCheck.result.confidence,
                    stage: securityCheck.result.stage,
                    reason: securityCheck.result.reason
                };
            }

            loggingService.debug('Chat message security check passed', {
                requestId: context.requestId,
                userId,
                messageLength: message.length
            });

            return {
                passed: true,
                isBlocked: false
            };

        } catch (error: any) {
            // Log security check failures but allow request to proceed (fail-open)
            loggingService.error('Chat message security check failed, allowing request', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                messageLength: message.length
            });
            
            // Fail-open: Return passed=true but log the error
            return {
                passed: true,
                isBlocked: false
            };
        }
    }

    /**
     * Perform security check with full request context
     * Convenience method that builds context and performs check
     * 
     * @param message - Message content to check
     * @param userId - User ID for tracking
     * @param req - Express request object
     * @param maxTokens - Maximum output tokens expected
     * @returns SecurityCheckResult
     */
    static async checkMessageSecurity(
        message: string,
        userId: string,
        req: Request,
        maxTokens: number = 1000
    ): Promise<SecurityCheckResult> {
        const context = this.buildSecurityContext(req, message.length, maxTokens);
        return this.performSecurityCheck(message, userId, context);
    }
}
