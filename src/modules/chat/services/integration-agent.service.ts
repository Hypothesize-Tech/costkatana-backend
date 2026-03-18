import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BedrockService } from '../../bedrock/bedrock.service';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  IntegrationChatService,
  IntegrationCommand,
} from './integration-chat.service';
import { ResponseSanitizerService } from '../utils/response-sanitizer';
import { IntegrationOptionProviderService } from '../../integration/services/integration-option-provider.service';
import { IntegrationService } from '../../integration/integration.service';
import type { IntegrationType } from '../../schemas/integration/integration.schema';

const VercelGetLogsSchema = z.object({
  deploymentId: z.string().min(1, 'Deployment ID is required'),
});

const VercelAddDomainSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  domain: z.string().min(1, 'Domain is required'),
});

const GitHubCreatePrSchema = z.object({
  repo: z.string().min(1, 'Repository is required'),
  title: z.string().min(1, 'Title is required'),
});

const GitHubGetIssueSchema = z.object({
  issueNumber: z.union([z.string(), z.number()]).transform(String),
});

const JiraCreateIssueSchema = z.object({
  project: z.string().min(1, 'Project key is required'),
  title: z.string().min(1, 'Title is required'),
});

const JiraUpdateIssueSchema = z.object({
  issueId: z.string().min(1, 'Issue ID is required'),
});

const integrationActionSchemas: Record<
  string,
  Record<string, z.ZodSchema<Record<string, unknown>>>
> = {
  vercel: {
    get_logs: VercelGetLogsSchema,
    add_domain: VercelAddDomainSchema,
  },
  github: {
    create_pr: GitHubCreatePrSchema,
    create_pull_request: GitHubCreatePrSchema,
    get_issue: GitHubGetIssueSchema,
  },
  jira: {
    create_issue: JiraCreateIssueSchema,
    update_issue: JiraUpdateIssueSchema,
  },
};

export interface IntegrationAgentRequest {
  userId: string;
  integration: string;
  message: string;
  mentions?: any[];
  conversationId?: string;
  selectionResponse?: {
    parameterName: string;
    value: any;
    collectedParams?: Record<string, any>;
  };
}

export interface IntegrationAgentResponse {
  success: boolean;
  message?: string;
  agentPath?: string[]; // Additional agentPath field
  optimizationsApplied?: string[]; // Additional optimizationsApplied field
  requiresSelection?: boolean;
  selection?: {
    parameterName: string;
    question: string;
    options: Array<{
      id: string;
      label: string;
      value: string;
      description?: string;
    }>;
    allowCustom: boolean;
    customPlaceholder: string;
    integration: string;
    pendingAction: string;
    collectedParams: Record<string, any>;
  };
  result?: any;
  metadata?: any;
  error?: string;
}

const PARAM_TO_OPTION_TYPE: Record<
  string,
  'projects' | 'teams' | 'channels' | 'guilds' | 'issueTypes' | 'priorities'
> = {
  projectId: 'projects',
  project: 'projects',
  projectKey: 'projects',
  teamId: 'teams',
  team: 'teams',
  channelId: 'channels',
  channel: 'channels',
  guildId: 'guilds',
  guild: 'guilds',
};

const INTEGRATION_NAME_TO_TYPE: Record<string, string> = {
  vercel: 'vercel_oauth',
  github: 'github_oauth',
  jira: 'jira_oauth',
  linear: 'linear_oauth',
  slack: 'slack_oauth',
  discord: 'discord_oauth',
};

@Injectable()
export class IntegrationAgentService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly logger: LoggerService,
    private readonly integrationChatService: IntegrationChatService,
    private readonly responseSanitizer: ResponseSanitizerService,
    private readonly integrationOptionProvider: IntegrationOptionProviderService,
    private readonly integrationService: IntegrationService,
  ) {}

  /**
   * Main entry point - process an integration command with AI-powered parameter extraction
   */
  async processIntegrationCommand(
    request: IntegrationAgentRequest,
  ): Promise<IntegrationAgentResponse> {
    const startTime = Date.now();

    try {
      this.logger.log('Processing integration command with AI', {
        userId: request.userId,
        integration: request.integration,
        messagePreview: request.message.substring(0, 100),
        hasSelectionResponse: !!request.selectionResponse,
      });

      // 1. Detect the action from the message
      const action = await this.detectAction(
        request.message,
        request.integration,
      );

      if (!action) {
        return {
          success: false,
          message: `I couldn't understand what you want to do with ${request.integration}. Please be more specific about the action.`,
          error: 'ACTION_NOT_DETECTED',
        };
      }

      // 2. Extract and validate parameters using Zod schemas
      const extractedParams = this.extractAndValidateParams(
        request.message,
        request.integration,
        action,
        request.selectionResponse,
      );

      // 3. Check if we need more parameters (Zod-based validation)
      const needsMoreParams = this.needsAdditionalParameters(
        request.integration,
        action,
        extractedParams,
      );

      if (needsMoreParams) {
        const missingParam = needsMoreParams.missingParam;
        const question = needsMoreParams.question;
        const options = await this.getOptionsForParam(
          request.userId,
          request.integration,
          missingParam,
        );

        return {
          success: false,
          message: question,
          requiresSelection: true,
          selection: {
            parameterName: missingParam,
            question,
            options: options.map((o) => ({
              id: o.value,
              label: o.label,
              value: o.value,
              description: o.metadata ? JSON.stringify(o.metadata) : undefined,
            })),
            allowCustom: options.length === 0,
            customPlaceholder: 'Enter custom value...',
            integration: request.integration,
            pendingAction: action,
            collectedParams: extractedParams,
          },
          metadata: {
            integration: request.integration,
            action,
            executionTimeMs: Date.now() - startTime,
            modelUsed: 'nova-pro',
          },
        };
      }

      // 5. Execute the integration command
      const result = await this.executeIntegrationCommand(
        request.integration,
        action,
        extractedParams,
        request.userId,
      );

      return {
        success: true,
        result:
          this.responseSanitizer.formatIntegrationResultForDisplay(result),
        metadata: {
          integration: request.integration,
          action,
          executionTimeMs: Date.now() - startTime,
          modelUsed: 'nova-pro',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Integration agent error', {
        error: errorMessage,
        userId: request.userId,
        integration: request.integration,
      });

      return {
        success: false,
        message: `Failed to process ${request.integration} command: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Detect the action from the user's message using AI
   */
  private async detectAction(
    message: string,
    integration: string,
  ): Promise<string | null> {
    const lowerMessage = message.toLowerCase();

    // First, try explicit command patterns like @vercel:list-deployments
    const commandMatch = message.match(
      new RegExp(`@${integration}:([a-z_-]+)`, 'i'),
    );
    if (commandMatch) {
      return commandMatch[1].replace(/-/g, '_');
    }

    // Common action patterns (simplified)
    const actionPatterns: Record<string, string[]> = {
      list_projects: ['list project', 'show project', 'my project'],
      list_deployments: ['list deployment', 'show deployment', 'deployments'],
      get_logs: ['get log', 'show log', 'logs'],
      list: ['list', 'show all', 'get all'],
      search: ['search', 'find', 'look for'],
      create: ['create', 'new', 'add'],
      delete: ['delete', 'remove'],
    };

    // Check patterns
    for (const [action, patterns] of Object.entries(actionPatterns)) {
      for (const pattern of patterns) {
        if (lowerMessage.includes(pattern)) {
          return action;
        }
      }
    }

    // Use AI for detection as fallback
    try {
      const prompt = `Given this user message for ${integration} integration: "${message}"

What action is the user trying to perform? Respond with ONLY the action name (like "list_projects", "create_issue", etc.), nothing else.
If you can't determine the action, respond with "unknown".`;

      const response = await BedrockService.invokeModelDirectly(
        'amazon.nova-pro-v1:0',
        {
          prompt,
          max_tokens: 50,
          temperature: 0.1,
        },
      );

      const detectedAction = (response as any)?.response
        ?.trim()
        .toLowerCase()
        .replace(/-/g, '_');

      if (detectedAction && detectedAction !== 'unknown') {
        return detectedAction;
      }
    } catch (error) {
      this.logger.warn('AI action detection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Default actions based on integration
    const defaultActions: Record<string, string> = {
      vercel: 'list_projects',
      github: 'list_repos',
      jira: 'list_issues',
      linear: 'list_teams',
      slack: 'list_channels',
      discord: 'list_channels',
      aws: 'costs',
      google: 'create',
      drive: 'create_folder',
      sheets: 'create',
      docs: 'create',
    };

    return defaultActions[integration] || null;
  }

  /**
   * Extract and validate parameters from message and selection response using Zod schemas
   */
  private extractAndValidateParams(
    message: string,
    integration: string,
    action: string,
    selectionResponse?: {
      parameterName: string;
      value: unknown;
      collectedParams?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { action };

    if (selectionResponse) {
      params[selectionResponse.parameterName] = selectionResponse.value;
      Object.assign(params, selectionResponse.collectedParams || {});
    }

    const schema = integrationActionSchemas[integration]?.[action];
    if (schema) {
      const inferred = this.inferParamsFromMessage(message, integration, action);
      Object.assign(params, inferred);
      const result = schema.safeParse(params);
      if (result.success) {
        return { ...params, ...result.data };
      }
    }

    return params;
  }

  /**
   * Infer parameter values from message using patterns and AI fallback
   */
  private inferParamsFromMessage(
    message: string,
    integration: string,
    action: string,
  ): Record<string, unknown> {
    const inferred: Record<string, unknown> = {};

    if (
      integration === 'github' &&
      (action === 'create_pr' || action === 'create_pull_request')
    ) {
      const repoMatch = message.match(/(?:repo|repository)[:\s]+([^\s,]+)/i) ||
        message.match(/\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\b/);
      if (repoMatch) inferred.repo = repoMatch[1];
      const titleMatch = message.match(/(?:title|pr title)[:\s]+"([^"]+)"|(?:title|pr title)[:\s]+([^\n,]+)/i);
      if (titleMatch) inferred.title = (titleMatch[1] || titleMatch[2] || '').trim();
    }
    if (integration === 'github' && action === 'get_issue') {
      const numMatch = message.match(/#(\d+)|issue\s*#?(\d+)/i);
      if (numMatch) inferred.issueNumber = numMatch[1] || numMatch[2];
    }
    if (integration === 'vercel' && action === 'get_logs') {
      const depMatch = message.match(/(?:deployment|dpl)[:\s]+([a-zA-Z0-9_-]+)/i);
      if (depMatch) inferred.deploymentId = depMatch[1];
    }
    if (integration === 'jira' && action === 'create_issue') {
      const projMatch = message.match(/(?:project)[:\s]+([A-Z][A-Z0-9]+)/i) || message.match(/\b([A-Z][A-Z0-9]{1,9})\b/);
      if (projMatch) inferred.project = projMatch[1];
      const titleMatch = message.match(/(?:title)[:\s]+"([^"]+)"|(?:title)[:\s]+([^\n,]+)/i);
      if (titleMatch) inferred.title = (titleMatch[1] || titleMatch[2] || '').trim();
    }

    return inferred;
  }

  /**
   * Get options for a parameter from IntegrationOptionProviderService
   */
  private async getOptionsForParam(
    userId: string,
    integrationName: string,
    paramName: string,
  ): Promise<Array<{ value: string; label: string; metadata?: Record<string, unknown> }>> {
    const optionType = PARAM_TO_OPTION_TYPE[paramName];
    if (!optionType) return [];

    const integrationType = INTEGRATION_NAME_TO_TYPE[integrationName];
    if (!integrationType) return [];

    const integrations = await this.integrationService.getUserIntegrations(
      userId,
      { type: integrationType as IntegrationType, status: 'active' },
    );
    const integration = integrations[0];
    if (!integration) return [];

    return this.integrationOptionProvider.getOptions(
      userId,
      String(integration._id),
      optionType,
    );
  }

  /**
   * Check if additional parameters are needed (Zod schema-based validation)
   */
  private needsAdditionalParameters(
    integration: string,
    action: string,
    params: Record<string, unknown>,
  ): { missingParam: string; question: string } | null {
    const schema = integrationActionSchemas[integration]?.[action];
    if (!schema) return null;

    const result = schema.safeParse(params);
    if (result.success) return null;

    const firstError = result.error.errors[0];
    if (!firstError) return null;

    const path = firstError.path[0];
    const paramName = typeof path === 'string' ? path : String(path);
    const readableName = paramName.replace(/([A-Z])/g, ' $1').toLowerCase().trim();

    return {
      missingParam: paramName,
      question: `What ${readableName} would you like to use?`,
    };
  }

  /**
   * Execute the integration command by delegating to IntegrationChatService
   */
  private async executeIntegrationCommand(
    integration: string,
    action: string,
    params: Record<string, any>,
    userId: string,
  ): Promise<any> {
    this.logger.log(
      'Executing integration command via IntegrationChatService',
      {
        integration,
        action,
        params: Object.keys(params),
        userId,
      },
    );

    // Convert IntegrationAgentService format to IntegrationChatService format.
    // Use action-based entity mapping when params don't contain explicit entity (e.g. list_issues → issue).
    const entityFromParams = this.extractEntityFromParams(params);
    const entityFromAction = this.mapActionToEntity(action);
    const entity =
      entityFromParams !== 'item'
        ? entityFromParams
        : entityFromAction || 'item';

    const integrationCommand: IntegrationCommand = {
      type: this.mapActionToCommandType(action) as IntegrationCommand['type'],
      entity,
      mention: this.createParsedMention(integration, params, entity),
      params,
      naturalLanguage: params.message || `Execute ${action} on ${integration}`,
    };

    // Delegate to IntegrationChatService
    const result = await this.integrationChatService.executeCommand(
      userId,
      integrationCommand,
    );

    return result;
  }

  /**
   * Map action name to entity when params don't contain explicit entity indicators.
   * Enables correct routing for @github:list-issues, @linear:list-issues, etc.
   */
  private mapActionToEntity(action: string): string {
    const actionToEntityMap: Record<string, string> = {
      // GitHub
      list_issues: 'issue',
      list_branches: 'branch',
      list_repos: 'repository',
      list_prs: 'pull_request',
      list_pull_requests: 'pull_request',
      create_issue: 'issue',
      get_issue: 'issue',
      update_issue: 'issue',
      add_comment: 'comment',
      create_pr: 'pull_request',
      create_pull_request: 'pull_request',
      // Linear
      list_projects: 'project',
      list_teams: 'team',
      list_users: 'user',
      list_tags: 'tag',
      list_epics: 'epic',
      list_iterations: 'iteration',
      list_workflows: 'workflow',
      list_channels: 'channel', // Linear: workflow states; Slack/Discord: channels
      list_guilds: 'guild',
      list_roles: 'role',
      send_message: 'message',
      create_channel: 'channel',
      delete_channel: 'channel',
      kick_user: 'user',
      ban_user: 'user',
      unban_user: 'user',
      create_role: 'role',
      assign_role: 'role',
      remove_role: 'role',
      // Vercel
      list_deployments: 'deployment',
      list_domains: 'domain',
      list_env: 'env',
      get_logs: 'logs',
      deploy: 'deployment',
      rollback: 'deployment',
      promote: 'deployment',
      add_domain: 'domain',
      set_env: 'env',
      // AWS
      list_ec2: 'ec2',
      list_s3: 's3',
      list_rds: 'rds',
      list_lambda: 'lambda',
      stop_ec2: 'ec2',
      start_ec2: 'ec2',
      costs: 'cost',
      cost_breakdown: 'cost',
      cost_forecast: 'cost',
      anomalies: 'cost',
      ec2_costs: 'ec2',
      s3_costs: 's3',
      rds_costs: 'rds',
      lambda_costs: 'lambda',
      optimize: 'cost',
      savings: 'cost',
      reserved: 'cost',
      spot: 'cost',
      // Google
      upload: 'file',
      folder: 'folder',
      create_folder: 'folder',
      share: 'file',
      create: 'spreadsheet',
      export: 'spreadsheet',
      update: 'spreadsheet',
      append: 'spreadsheet',
      report: 'report',
    };
    return actionToEntityMap[action] || '';
  }

  /**
   * Map IntegrationAgentService action to IntegrationChatService command type
   */
  private mapActionToCommandType(action: string): string {
    const actionToTypeMap: Record<string, string> = {
      // List actions
      list_projects: 'list',
      list_deployments: 'list',
      list_repos: 'list',
      list_issues: 'list',
      list_teams: 'list',
      list_channels: 'list',
      list_guilds: 'list',
      list_prs: 'list',
      list_pull_requests: 'list',
      list_users: 'list',
      list_roles: 'list',
      list_domains: 'list',
      list_env: 'list',
      list_tags: 'list',
      list_epics: 'list',
      list_iterations: 'list',
      list_workflows: 'list',
      list_ec2: 'list',
      list_s3: 'list',
      list_rds: 'list',
      list_lambda: 'list',
      // Create actions
      create_issue: 'create',
      create_pr: 'create',
      create_pull_request: 'create',
      create_channel: 'create',
      create_role: 'create',
      deploy: 'create',
      set_env: 'create',
      upload: 'create',
      folder: 'create',
      create_folder: 'create',
      create: 'create',
      report: 'create',
      // Get actions
      get_issue: 'get',
      get_logs: 'get',
      // Update actions
      update_issue: 'update',
      rollback: 'update',
      promote: 'update',
      stop_ec2: 'update',
      start_ec2: 'update',
      update: 'update',
      share: 'update',
      export: 'export',
      append: 'add',
      // Add actions
      add_comment: 'add',
      add_domain: 'add',
      // Send
      send_message: 'send',
      // Delete
      delete_channel: 'delete',
      // Discord moderation
      kick_user: 'kick',
      ban_user: 'ban',
      unban_user: 'unban',
      assign_role: 'assign',
      remove_role: 'remove',
      // AWS
      costs: 'status',
      cost_breakdown: 'status',
      cost_forecast: 'status',
      anomalies: 'status',
      ec2_costs: 'status',
      s3_costs: 'status',
      rds_costs: 'status',
      lambda_costs: 'status',
      optimize: 'optimize',
      savings: 'optimize',
      reserved: 'optimize',
      spot: 'optimize',
      // Misc
      search: 'list',
    };

    return actionToTypeMap[action] || 'list';
  }

  /**
   * Extract entity from params (e.g., 'project', 'issue', 'channel')
   */
  private extractEntityFromParams(params: Record<string, any>): string {
    if (params.collection) return 'collection';
    if (params.projectKey || params.project) return 'project';
    if (params.issueKey || params.issueId || params.issueNumber) return 'issue';
    if (params.repo) return 'repository';
    if (params.channel) return 'channel';
    if (params.team) return 'team';
    if (params.deploymentId) return 'deployment';
    if (params.guildId || params.guild) return 'guild';
    if (params.domain) return 'domain';
    if (params.userId) return 'user';
    if (params.roleId || params.role) return 'role';

    return 'item';
  }

  /**
   * Create a ParsedMention object from integration and params
   */
  private createParsedMention(
    integration: string,
    params: Record<string, any>,
    resolvedEntity?: string,
  ): any {
    const entityType =
      resolvedEntity ??
      (this.extractEntityFromParams(params) !== 'item'
        ? this.extractEntityFromParams(params)
        : this.mapActionToEntity(params.action));
    return {
      integration,
      entityType: entityType || 'general',
      entityId:
        params.projectKey ||
        params.repo ||
        params.issueKey ||
        params.deploymentId ||
        params.guildId ||
        params.projectId ||
        (params.owner && params.repo
          ? `${params.owner}/${params.repo}`
          : undefined),
      action: undefined,
      parameters: {},
      originalMention: `@${integration}`,
      command: params.message || '',
    };
  }
}
