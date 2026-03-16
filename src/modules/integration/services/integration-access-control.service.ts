import { Injectable } from '@nestjs/common';
import { IntegrationService } from '../integration.service';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class IntegrationAccessControlService {
  constructor(private readonly integrationService: IntegrationService) {}

  /**
   * Check whether the user is allowed to use the given integration (exists and belongs to user).
   */
  async canUseIntegration(
    userId: string,
    integrationId: string,
  ): Promise<AccessCheckResult> {
    const integration = await this.integrationService.getIntegrationById(
      integrationId,
      userId,
    );
    if (!integration) {
      return {
        allowed: false,
        reason: 'Integration not found or access denied',
      };
    }
    if (integration.status === 'inactive') {
      return { allowed: false, reason: 'Integration is inactive' };
    }
    if (integration.status === 'error') {
      return { allowed: false, reason: 'Integration is in error state' };
    }
    return { allowed: true };
  }

  /**
   * Check whether the user can perform a specific action on the integration.
   */
  async canPerformAction(
    userId: string,
    integrationId: string,
    action: 'send' | 'create_issue' | 'update_issue' | 'test' | 'manage',
  ): Promise<AccessCheckResult> {
    const base = await this.canUseIntegration(userId, integrationId);
    if (!base.allowed) return base;

    const integration = await this.integrationService.getIntegrationById(
      integrationId,
      userId,
    );
    if (!integration) return base;

    const type = integration.type as string;
    const actionMap: Record<string, string[]> = {
      send: [
        'slack_webhook',
        'slack_oauth',
        'discord_webhook',
        'discord_oauth',
        'custom_webhook',
      ],
      create_issue: ['jira_oauth', 'linear_oauth'],
      update_issue: ['jira_oauth', 'linear_oauth'],
      test: [
        'slack_webhook',
        'slack_oauth',
        'discord_webhook',
        'discord_oauth',
        'linear_oauth',
        'jira_oauth',
        'custom_webhook',
      ],
      manage: [
        'slack_webhook',
        'slack_oauth',
        'discord_webhook',
        'discord_oauth',
        'linear_oauth',
        'jira_oauth',
        'custom_webhook',
      ],
    };
    const allowedTypes = actionMap[action];
    if (allowedTypes && !allowedTypes.includes(type)) {
      return {
        allowed: false,
        reason: `Action '${action}' is not supported for integration type '${type}'`,
      };
    }
    return { allowed: true };
  }
}
