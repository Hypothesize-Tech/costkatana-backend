import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FirewallCheckResult } from '../interfaces/gateway.interfaces';
import { PromptFirewallService } from '../../security/prompt-firewall.service';
import { HtmlSecurityService } from '../../security/html-security.service';
import { RequestProcessingService } from './request-processing.service';
import {
  ThreatLog,
  ThreatLogDocument,
} from '../../../schemas/security/threat-log.schema';

/**
 * Gateway Firewall Service - Security and threat detection for gateway requests.
 * Injects ThreatLog model and HtmlSecurityService and uses PromptFirewallService with them.
 */
@Injectable()
export class GatewayFirewallService {
  private readonly logger = new Logger(GatewayFirewallService.name);

  constructor(
    @InjectModel(ThreatLog.name)
    private readonly threatLogModel: Model<ThreatLogDocument>,
    private readonly htmlSecurityService: HtmlSecurityService,
    private readonly requestProcessingService: RequestProcessingService,
  ) {}

  /**
   * Check firewall rules for a gateway request
   */
  async checkFirewallRules(request: any): Promise<FirewallCheckResult> {
    const context = request.gatewayContext;
    const requestId = (request.headers['x-request-id'] as string) || 'unknown';

    try {
      this.logger.log('Starting firewall check for gateway request', {
        component: 'GatewayFirewallService',
        operation: 'checkFirewallRules',
        type: 'firewall_check_start',
        requestId,
        userId: context.userId,
        hasFirewallEnabled: context.firewallEnabled,
        hasFirewallAdvanced: context.firewallAdvanced,
      });

      // Skip only when LLM security is explicitly off and no explicit firewall headers
      if (
        !context.firewallEnabled &&
        !context.firewallAdvanced &&
        context.securityEnabled === false
      ) {
        this.logger.debug('Firewall disabled, skipping check', {
          component: 'GatewayFirewallService',
          operation: 'checkFirewallRules',
          type: 'firewall_disabled',
          requestId,
        });

        return {
          isBlocked: false,
          reason: 'Firewall disabled',
        };
      }

      // Extract prompt from request
      const prompt = this.extractPromptFromRequest(request.body);
      if (!prompt) {
        this.logger.debug('No prompt found in request, allowing', {
          component: 'GatewayFirewallService',
          operation: 'checkFirewallRules',
          type: 'firewall_no_prompt',
          requestId,
        });

        return {
          isBlocked: false,
          reason: 'No prompt to check',
        };
      }

      // Extract tool calls for comprehensive security checking
      const toolCallExtraction =
        this.requestProcessingService.extractToolCallsFromRequest(request.body);

      // Create firewall service with injected ThreatLog model and HtmlSecurityService
      const firewallService = new PromptFirewallService(
        this.threatLogModel,
        this.htmlSecurityService,
      );

      this.logger.debug('Running firewall check', {
        component: 'GatewayFirewallService',
        operation: 'checkFirewallRules',
        type: 'firewall_check_running',
        requestId,
        promptLength: prompt.length,
        promptThreshold: context.firewallPromptThreshold,
        llamaThreshold: context.firewallLlamaThreshold,
      });

      // Run firewall check (checkPrompt expects: prompt, config, requestId, estimatedCost?, context?, toolCalls?)
      const config: import('../../security/prompt-firewall.service').FirewallConfig =
        {
          enableBasicFirewall: !!(
            context.firewallEnabled ||
            (context.securityEnabled !== false && !context.firewallAdvanced)
          ),
          enableAdvancedFirewall: !!context.firewallAdvanced,
          enableRAGSecurity: false,
          enableToolSecurity: !!context.firewallAdvanced, // Enable tool security when advanced firewall is on
          promptGuardThreshold: context.firewallPromptThreshold ?? 0.8,
          openaiSafeguardThreshold: context.firewallLlamaThreshold ?? 0.7,
          ragSecurityThreshold: 0.8,
          toolSecurityThreshold: 0.8,
          sandboxHighRisk: false,
          requireHumanApproval: false,
        };

      this.logger.debug('Running firewall check with tool call validation', {
        component: 'GatewayFirewallService',
        operation: 'checkFirewallRules',
        type: 'firewall_check_with_tools',
        requestId,
        hasToolCalls: !!toolCallExtraction.toolCalls,
        toolCallCount: toolCallExtraction.toolCalls?.length || 0,
        toolFormat: toolCallExtraction.format,
      });

      const result = await firewallService.checkPrompt(
        prompt,
        config,
        requestId,
        0.01,
        {
          userId: context.userId,
          source: context.provider,
          toolCalls: toolCallExtraction.toolCalls, // Pass tool calls for security validation
        },
      );

      const firewallResult: FirewallCheckResult = {
        isBlocked: result.isBlocked,
        threatCategory: result.threatCategory,
        confidence: result.confidence,
        riskScore: result.riskScore,
        stage: result.stage,
        containmentAction: result.containmentAction,
        matchedPatterns: result.matchedPatterns,
        reason: result.reason,
      };

      // Check if human review is required
      if (result.containmentAction === 'human_review') {
        firewallResult.humanReviewId = result.details?.humanReviewId;
      }

      this.logger.log('Firewall check completed', {
        component: 'GatewayFirewallService',
        operation: 'checkFirewallRules',
        type: result.isBlocked ? 'firewall_blocked' : 'firewall_allowed',
        requestId,
        isBlocked: result.isBlocked,
        threatCategory: result.threatCategory,
        confidence: result.confidence,
        containmentAction: result.containmentAction,
        riskScore: result.riskScore,
      });

      return firewallResult;
    } catch (error: any) {
      this.logger.error('Firewall check failed', {
        component: 'GatewayFirewallService',
        operation: 'checkFirewallRules',
        type: 'firewall_check_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error.stack,
      });

      // Fail-open: allow request if firewall check fails
      return {
        isBlocked: false,
        reason: 'Firewall check failed, request allowed',
      };
    }
  }

  /**
   * Validate request against security rules
   */
  async validateRequest(request: any): Promise<boolean> {
    const result = await this.checkFirewallRules(request);
    return !result.isBlocked;
  }

  /**
   * Detect threats in request
   */
  async detectThreats(request: any): Promise<FirewallCheckResult> {
    return await this.checkFirewallRules(request);
  }

  /**
   * Extract prompt from request body for firewall checking
   */
  private extractPromptFromRequest(requestBody: any): string | null {
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
      this.logger.error('Error extracting prompt from request for firewall', {
        component: 'GatewayFirewallService',
        operation: 'extractPromptFromRequest',
        type: 'prompt_extraction_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}
