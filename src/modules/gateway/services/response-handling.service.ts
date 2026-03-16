import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AxiosResponse } from 'axios';
import {
  ModerationResult,
  ModerationConfig,
} from '../interfaces/gateway.interfaces';
import { OutputModerationService } from './output-moderation.service';

/**
 * Response Handling Service - Handles response formatting, streaming, and error handling
 * Integrates with moderation services for content filtering and response processing
 */
@Injectable()
export class ResponseHandlingService {
  private readonly logger = new Logger(ResponseHandlingService.name);

  constructor(
    private readonly outputModerationService: OutputModerationService,
  ) {}

  /**
   * Process response from AI provider, applying privacy settings
   */
  async processResponse(
    request: Request,
    response: AxiosResponse,
  ): Promise<any> {
    const context = (request as any).gatewayContext;
    let responseData = response.data;

    // Apply privacy settings if configured
    if (context.omitResponse) {
      this.logger.log('Response content omitted due to privacy settings', {
        requestId: request.headers['x-request-id'] as string,
      });
      responseData = {
        message: 'Response content omitted for privacy',
        costKatanaNote:
          'Original response was processed but not returned due to CostKatana-Omit-Response header',
      };
    }

    return responseData;
  }

  /**
   * Apply output moderation to AI response
   */
  async moderateOutput(
    request: Request,
    responseData: any,
  ): Promise<ModerationResult> {
    const context = (request as any).gatewayContext;

    try {
      // Check if output moderation is enabled via headers
      const outputModerationEnabled =
        request.headers['costkatana-output-moderation-enabled'] === 'true';

      // Default moderation config (can be customized via headers)
      const moderationConfig: ModerationConfig = {
        enableOutputModeration: outputModerationEnabled,
        toxicityThreshold: parseFloat(
          (request.headers['costkatana-toxicity-threshold'] as string) || '0.7',
        ),
        enablePIIDetection:
          request.headers['costkatana-pii-detection-enabled'] !== 'false',
        enableToxicityCheck:
          request.headers['costkatana-toxicity-check-enabled'] !== 'false',
        enableHateSpeechCheck:
          request.headers['costkatana-hate-speech-check-enabled'] !== 'false',
        enableSexualContentCheck:
          request.headers['costkatana-sexual-content-check-enabled'] !==
          'false',
        enableViolenceCheck:
          request.headers['costkatana-violence-check-enabled'] !== 'false',
        enableSelfHarmCheck:
          request.headers['costkatana-self-harm-check-enabled'] !== 'false',
        action: ((request.headers['costkatana-moderation-action'] as string) ||
          'block') as 'allow' | 'annotate' | 'redact' | 'block',
      };

      if (!moderationConfig.enableOutputModeration) {
        // Return original response without moderation
        return {
          response: responseData,
          moderationApplied: false,
          action: 'allow',
          violationCategories: [],
          isBlocked: false,
        };
      }

      // Extract content from response
      const responseContent = this.extractContentFromResponse(responseData);

      if (!responseContent) {
        this.logger.log('No content found to moderate in response', {
          requestId: request.headers['x-request-id'] as string,
        });
        return {
          response: responseData,
          moderationApplied: false,
          action: 'allow',
          violationCategories: [],
          isBlocked: false,
        };
      }

      // Apply output moderation (real implementation: Bedrock + pattern fallback)
      const moderationResult =
        await this.outputModerationService.moderateOutput(
          responseContent,
          moderationConfig,
          context.requestId || 'unknown',
          this.inferModelFromRequest(request),
        );

      this.logger.log('Output moderation completed', {
        requestId: context.requestId,
        isBlocked: moderationResult.isBlocked,
        action: moderationResult.action,
        violationCategories: moderationResult.violationCategories,
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
              costKatanaNote:
                'Response blocked by CostKATANA output moderation system',
            };
            break;

          case 'redact':
            if (moderationResult.sanitizedContent) {
              // Replace original content with sanitized version
              finalResponse = this.replaceContentInResponse(
                responseData,
                moderationResult.sanitizedContent,
              );
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
        isBlocked: moderationResult.isBlocked,
      };
    } catch (error: any) {
      this.logger.error('Output moderation error', {
        error: error.message || 'Unknown error',
        stack: error.stack,
        requestId: request.headers['x-request-id'] as string,
      });
      // In case of moderation error, return original response (fail-open)
      return {
        response: responseData,
        moderationApplied: false,
        action: 'allow',
        violationCategories: [],
        isBlocked: false,
      };
    }
  }

  /**
   * Extract text content from AI response for moderation
   */
  extractContentFromResponse(responseData: any): string | null {
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
      if (
        responseData.content &&
        Array.isArray(responseData.content) &&
        responseData.content[0]?.text
      ) {
        return responseData.content[0].text;
      }

      // Direct content field
      if (responseData.content) {
        return typeof responseData.content === 'string'
          ? responseData.content
          : JSON.stringify(responseData.content);
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
      this.logger.warn('Error extracting content from response', {
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Replace content in AI response structure
   */
  replaceContentInResponse(responseData: any, newContent: string): any {
    try {
      if (!responseData || typeof responseData !== 'object') {
        return newContent;
      }

      const modifiedResponse = JSON.parse(JSON.stringify(responseData)); // Deep clone

      // Handle different response formats
      if (modifiedResponse.choices && modifiedResponse.choices[0]?.message) {
        modifiedResponse.choices[0].message.content = newContent;
      } else if (
        modifiedResponse.content &&
        Array.isArray(modifiedResponse.content) &&
        modifiedResponse.content[0]
      ) {
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
          costKatanaModerationNote: 'Content was modified by output moderation',
        };
      }

      return modifiedResponse;
    } catch (error: any) {
      this.logger.warn('Error replacing content in response', {
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      return responseData;
    }
  }

  /**
   * Add response headers to the Express response
   */
  addResponseHeaders(
    request: Request,
    response: Response,
    axiosResponse: AxiosResponse,
    moderationResult: ModerationResult,
    failoverProviderIndex: number = -1,
  ): void {
    const context = (request as any).gatewayContext;

    // Set response status
    response.status(axiosResponse.status);

    // Add CostKatana-Request-Id header for feedback tracking
    if (context.requestId) {
      response.setHeader('CostKatana-Request-Id', context.requestId);
    }

    // Add Cortex response headers if Cortex was used
    if (context.cortexEnabled && context.cortexMetadata) {
      // Import GatewayCortexService dynamically
      import('./gateway-cortex.service')
        .then(({ GatewayCortexService }) => {
          const cortexService = new GatewayCortexService();
          cortexService.addCortexResponseHeaders(response, context);
        })
        .catch((error) => {
          this.logger.warn('Failed to add Cortex response headers', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
    }

    // Add CostKatana-Failover-Index header for failover requests
    if (context.failoverEnabled && failoverProviderIndex >= 0) {
      response.setHeader(
        'CostKatana-Failover-Index',
        failoverProviderIndex.toString(),
      );
    }

    // Copy relevant headers from the AI provider response
    const headersToForward = [
      'content-type',
      'content-length',
      'content-encoding',
    ];
    headersToForward.forEach((header) => {
      if (axiosResponse.headers[header]) {
        response.setHeader(header, axiosResponse.headers[header]);
      }
    });

    // Add moderation headers
    if (moderationResult.moderationApplied) {
      response.setHeader('CostKatana-Moderation-Applied', 'true');
      response.setHeader(
        'CostKatana-Moderation-Action',
        moderationResult.action,
      );
      if (moderationResult.violationCategories.length > 0) {
        response.setHeader(
          'CostKatana-Moderation-Categories',
          moderationResult.violationCategories.join(','),
        );
      }
    }

    // 🚀 Add prompt caching headers if caching was applied
    if (context.promptCaching?.enabled) {
      const cacheData = context.promptCaching;

      // Core prompt caching headers
      response.setHeader('CostKatana-Prompt-Caching-Enabled', 'true');
      response.setHeader(
        'CostKatana-Prompt-Caching-Type',
        cacheData.type || 'automatic',
      );
      response.setHeader(
        'CostKatana-Prompt-Caching-Estimated-Savings',
        cacheData.estimatedSavings?.toFixed(6) || '0.000000',
      );

      // Add provider-specific cache headers
      if (cacheData.cacheHeaders) {
        Object.entries(
          cacheData.cacheHeaders as Record<string, string>,
        ).forEach(([key, value]) => {
          response.setHeader(key, value);
        });
      }

      this.logger.debug('Prompt caching headers added to response', {
        requestId: context.requestId,
        cacheType: cacheData.type,
        estimatedSavings: cacheData.estimatedSavings,
        headerCount: cacheData.cacheHeaders
          ? Object.keys(cacheData.cacheHeaders).length
          : 0,
      });
    }
  }

  /**
   * Send cache hit response
   */
  sendCacheHitResponse(
    request: Request,
    response: Response,
    cachedResponse: any,
  ): void {
    const context = (request as any).gatewayContext;

    this.logger.log('Cache hit - returning cached response', {
      requestId: request.headers['x-request-id'] as string,
    });

    response.setHeader('CostKatana-Cache-Status', 'HIT');

    if (context.requestId) {
      response.setHeader('CostKatana-Request-Id', context.requestId);
    }

    response.status(200).json(cachedResponse.response);
  }

  /**
   * Send budget exceeded error response
   */
  sendBudgetExceededResponse(
    request: Request,
    response: Response,
    blockData: {
      allowed: boolean;
      message?: string;
      simulation?: any;
      cheaperAlternatives?: any[];
    },
  ): void {
    const context = (request as any).gatewayContext;

    this.logger.error('❌ HARD BLOCK: Budget violation prevented', {
      userId: context.userId,
      budgetId: context.budgetId,
      estimatedCost: blockData.simulation?.originalRequest?.estimatedCost,
      reason: blockData.message,
      requestId: request.headers['x-request-id'] as string,
    });

    // Return detailed error with alternatives
    response.status(402).json({
      error: 'BUDGET_EXCEEDED',
      message: blockData.message || 'Budget limit exceeded - request blocked',
      budgetId: context.budgetId,
      estimatedCost: blockData.simulation?.originalRequest?.estimatedCost,
      cheaperAlternatives: blockData.cheaperAlternatives || [],
      suggestedActions: [
        'Upgrade your plan to increase budget limits',
        'Use a cheaper model from the alternatives list',
        'Reduce prompt length to lower costs',
        'Wait until next billing cycle',
      ],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send firewall blocked response
   */
  sendFirewallBlockedResponse(
    request: Request,
    response: Response,
    firewallResult: any,
  ): void {
    let statusCode = 400;
    let errorCode = 'PROMPT_BLOCKED_BY_FIREWALL';

    if (firewallResult.containmentAction === 'human_review') {
      statusCode = 202;
      errorCode = 'PROMPT_REQUIRES_REVIEW';
    }

    const responseBody: any = {
      success: false,
      error: {
        code: errorCode,
        message:
          firewallResult.containmentAction === 'human_review'
            ? 'The request requires human review due to security considerations.'
            : 'The request was blocked by the CostKATANA security system due to a detected threat.',
        details: `${firewallResult.reason}. View threat category and details in your CostKATANA security dashboard for request ID: ${request.headers['x-request-id'] || 'unknown'}`,
      },
      security: {
        category: firewallResult.threatCategory,
        confidence: firewallResult.confidence,
        riskScore: firewallResult.riskScore,
        stage: firewallResult.stage,
        containmentAction: firewallResult.containmentAction,
        matchedPatterns: firewallResult.matchedPatterns?.length || 0,
      },
    };

    if (firewallResult.humanReviewId) {
      responseBody.humanReview = {
        reviewId: firewallResult.humanReviewId,
        status: 'pending',
        message:
          'Your request is pending human review. You will be notified once reviewed.',
      };
    }

    response.status(statusCode).json(responseBody);
  }

  /**
   * Send circuit breaker open response
   */
  sendCircuitBreakerResponse(
    response: Response,
    provider: string,
    retryAfter: number,
  ): void {
    response.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Circuit breaker is open for ${provider}`,
      retryAfter,
    });
  }

  /**
   * Infer model from request for moderation purposes
   */
  private inferModelFromRequest(request: Request): string | undefined {
    try {
      if (request.body?.model) {
        return request.body.model;
      }

      // Try to infer from URL path
      const url = (request as any).gatewayContext?.targetUrl || '';
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
