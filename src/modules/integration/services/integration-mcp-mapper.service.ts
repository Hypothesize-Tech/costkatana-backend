import { Injectable, Logger } from '@nestjs/common';

export interface McpToolMapping {
  mcpToolName: string;
  integrationType: string;
  capability: string;
  configKeys: string[];
}

const MCP_TO_INTEGRATION: McpToolMapping[] = [
  {
    mcpToolName: 'slack_send_message',
    integrationType: 'slack_webhook',
    capability: 'send_message',
    configKeys: ['webhookUrl', 'channel', 'text'],
  },
  {
    mcpToolName: 'slack_send_oauth',
    integrationType: 'slack_oauth',
    capability: 'send_message',
    configKeys: ['accessToken', 'channelId', 'text'],
  },
  {
    mcpToolName: 'discord_send',
    integrationType: 'discord_webhook',
    capability: 'send_message',
    configKeys: ['webhookUrl', 'content'],
  },
  {
    mcpToolName: 'jira_create_issue',
    integrationType: 'jira_oauth',
    capability: 'create_issue',
    configKeys: ['projectKey', 'issueTypeId', 'summary', 'description'],
  },
  {
    mcpToolName: 'jira_update_issue',
    integrationType: 'jira_oauth',
    capability: 'update_issue',
    configKeys: ['issueKey', 'updates'],
  },
  {
    mcpToolName: 'linear_create_issue',
    integrationType: 'linear_oauth',
    capability: 'create_issue',
    configKeys: ['teamId', 'title', 'description'],
  },
  {
    mcpToolName: 'linear_update_issue',
    integrationType: 'linear_oauth',
    capability: 'update_issue',
    configKeys: ['issueId', 'updates'],
  },
  {
    mcpToolName: 'webhook_post',
    integrationType: 'custom_webhook',
    capability: 'send_message',
    configKeys: ['webhookUrl', 'body'],
  },
];

@Injectable()
export class IntegrationMcpMapperService {
  private readonly logger = new Logger(IntegrationMcpMapperService.name);
  private readonly byMcpTool = new Map<string, McpToolMapping>();
  private readonly byIntegrationAndCapability = new Map<
    string,
    McpToolMapping[]
  >();

  constructor() {
    for (const m of MCP_TO_INTEGRATION) {
      this.byMcpTool.set(m.mcpToolName, m);
      const key = `${m.integrationType}:${m.capability}`;
      const list = this.byIntegrationAndCapability.get(key) ?? [];
      list.push(m);
      this.byIntegrationAndCapability.set(key, list);
    }
  }

  getIntegrationTypeForMcpTool(mcpToolName: string): string | null {
    return this.byMcpTool.get(mcpToolName)?.integrationType ?? null;
  }

  getMcpToolForIntegration(
    integrationType: string,
    capability: string,
  ): McpToolMapping | null {
    const list = this.byIntegrationAndCapability.get(
      `${integrationType}:${capability}`,
    );
    return list?.[0] ?? null;
  }

  getRequiredConfigKeys(mcpToolName: string): string[] {
    return this.byMcpTool.get(mcpToolName)?.configKeys ?? [];
  }

  listMappings(): McpToolMapping[] {
    return [...this.byMcpTool.values()];
  }
}
