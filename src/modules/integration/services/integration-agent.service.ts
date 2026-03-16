import { Injectable, Logger } from '@nestjs/common';
import { IntegrationService } from '../integration.service';
import { IntegrationAccessControlService } from './integration-access-control.service';
import { IntegrationObservabilityService } from './integration-observability.service';
import { IntegrationIntentRecognitionService } from './integration-intent-recognition.service';

export interface AgentStepResult {
  success: boolean;
  data?: unknown;
  error?: string;
  responseTimeMs: number;
}

@Injectable()
export class IntegrationAgentService {
  private readonly logger = new Logger(IntegrationAgentService.name);

  constructor(
    private readonly integrationService: IntegrationService,
    private readonly accessControl: IntegrationAccessControlService,
    private readonly observability: IntegrationObservabilityService,
    private readonly intentRecognition: IntegrationIntentRecognitionService,
  ) {}

  /**
   * Execute an integration flow from natural language intent.
   */
  async executeFromIntent(
    userId: string,
    integrationId: string,
    userText: string,
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const access = await this.accessControl.canUseIntegration(
      userId,
      integrationId,
    );
    if (!access.allowed) {
      return { success: false, error: access.reason };
    }

    const intent = this.intentRecognition.recognize(userText);
    const start = Date.now();

    try {
      let result: unknown;
      if (
        intent.action === 'create_issue' &&
        intent.integrationType === 'linear_oauth'
      ) {
        result = await this.integrationService.createLinearIssue(
          integrationId,
          userId,
          {
            title: String(
              intent.entities.title ?? intent.entities.query ?? 'Task',
            ),
            description: String(intent.entities.description ?? ''),
            teamId: String(
              intent.entities.team ?? intent.entities.teamId ?? '',
            ),
            projectId: intent.entities.projectId as string | undefined,
          },
        );
      } else if (
        intent.action === 'create_issue' &&
        intent.integrationType === 'jira_oauth'
      ) {
        const projects = await this.integrationService.getJiraProjects(
          integrationId,
          userId,
        );
        const projectKey =
          (projects as Array<{ key?: string }>)[0]?.key ?? 'PROJ';
        const types = await this.integrationService.getJiraIssueTypes(
          integrationId,
          userId,
          projectKey,
        );
        const issueTypeId = (types as Array<{ id?: string }>)[0]?.id ?? '10001';
        result = await this.integrationService.createJiraIssue(
          integrationId,
          userId,
          {
            title: String(
              intent.entities.title ?? intent.entities.query ?? 'Task',
            ),
            description: String(intent.entities.description ?? ''),
            projectKey,
            issueTypeId,
          },
        );
      } else if (intent.action === 'test_integration') {
        result = await this.integrationService.testIntegration(
          integrationId,
          userId,
        );
      } else {
        return {
          success: false,
          error: `Unsupported intent: ${intent.action} for integration ${integrationId}`,
        };
      }

      const responseTimeMs = Date.now() - start;
      this.observability.recordDelivery({
        integrationId,
        userId,
        type: intent.action,
        success: true,
        responseTimeMs,
        metadata: { intent: intent.action },
      });
      return { success: true, result };
    } catch (err) {
      const responseTimeMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      this.observability.recordDelivery({
        integrationId,
        userId,
        type: intent.action,
        success: false,
        responseTimeMs,
        metadata: { error: message },
      });
      return { success: false, error: message };
    }
  }
}
