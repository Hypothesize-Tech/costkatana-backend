import { Injectable, Logger } from '@nestjs/common';
import { MCPClientService } from './mcp-client.service';
import { McpIntegrationHandlerService } from './mcp-integration-handler.service';
import { VercelService } from '../../vercel/vercel.service';
import { AIRouterService } from '../../cortex/services/ai-router.service';
import type { ModelInvocationRequest } from '../../cortex/services/ai-router.service';

export interface VercelChatContext {
  conversationId?: string;
  vercelConnectionId?: string;
  userId: string;
  projectName?: string;
  deployments?: any[];
  domains?: any[];
  envVars?: any[];
  projects?: any[];
}

export interface VercelCommand {
  action:
    | 'list_projects'
    | 'deploy'
    | 'rollback'
    | 'promote'
    | 'list_deployments'
    | 'get_logs'
    | 'list_domains'
    | 'add_domain'
    | 'list_env'
    | 'set_env'
    | 'connect'
    | 'help';
  parameters?: Record<string, any>;
}

export interface VercelChatResponse {
  message: string;
  data?: any;
  suggestions?: string[];
  requiresAction?: boolean;
  action?: VercelCommand;
  toolUsed?: string;
}

/**
 * Vercel Chat Agent Service
 *
 * ARCHITECTURE:
 * - Uses Vercel's Official MCP Server for READ operations via MCPClientService
 * - Uses Direct Vercel API via VercelService for WRITE operations
 * - All operations wrapped in MCP security handler for rate limiting and audit logging
 * - Provides real-time activity tracking for transparency
 */
@Injectable()
export class VercelChatAgentService {
  private readonly logger = new Logger(VercelChatAgentService.name);

  constructor(
    private readonly mcpClient: MCPClientService,
    private readonly vercelService: VercelService,
    private readonly aiRouter: AIRouterService,
    private readonly mcpIntegrationHandler: McpIntegrationHandlerService,
  ) {}

  /**
   * Parse user message to detect Vercel-related intents
   */
  static parseVercelIntent(message: string): VercelCommand | null {
    const lowerMessage = message.toLowerCase();

    // Connect intent
    if (
      lowerMessage.includes('connect vercel') ||
      lowerMessage.includes('link vercel') ||
      lowerMessage.includes('setup vercel')
    ) {
      return { action: 'connect' };
    }

    // List projects intent
    if (
      (lowerMessage.includes('list') && lowerMessage.includes('project')) ||
      (lowerMessage.includes('show') && lowerMessage.includes('project')) ||
      lowerMessage.includes('my vercel project')
    ) {
      return { action: 'list_projects' };
    }

    // Deploy intent
    if (
      lowerMessage.includes('deploy') ||
      lowerMessage.includes('push to vercel') ||
      lowerMessage.includes('ship')
    ) {
      const projectMatch = message.match(
        /(?:deploy|ship)\s+(?:to\s+)?["']?([a-zA-Z0-9-_]+)["']?/i,
      );
      const targetMatch = message.match(/(?:to\s+)?(production|preview)/i);
      return {
        action: 'deploy',
        parameters: {
          projectName: projectMatch?.[1],
          target: targetMatch?.[1]?.toLowerCase() || 'preview',
        },
      };
    }

    // Rollback intent
    if (
      lowerMessage.includes('rollback') ||
      lowerMessage.includes('revert') ||
      lowerMessage.includes('go back')
    ) {
      const projectMatch = message.match(
        /(?:rollback|revert)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
      );
      return {
        action: 'rollback',
        parameters: {
          projectName: projectMatch?.[1],
        },
      };
    }

    // Promote intent
    if (
      lowerMessage.includes('promote') ||
      (lowerMessage.includes('to production') &&
        !lowerMessage.includes('deploy'))
    ) {
      const deploymentMatch = message.match(
        /promote\s+["']?([a-zA-Z0-9-_]+)["']?/i,
      );
      return {
        action: 'promote',
        parameters: {
          deploymentId: deploymentMatch?.[1],
        },
      };
    }

    // List deployments intent
    if (
      (lowerMessage.includes('deployment') || lowerMessage.includes('build')) &&
      (lowerMessage.includes('list') ||
        lowerMessage.includes('show') ||
        lowerMessage.includes('history'))
    ) {
      const projectMatch = message.match(
        /(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
      );
      return {
        action: 'list_deployments',
        parameters: {
          projectName: projectMatch?.[1],
        },
      };
    }

    // Get logs intent
    if (
      lowerMessage.includes('log') ||
      lowerMessage.includes('build output') ||
      lowerMessage.includes('deployment output')
    ) {
      const projectMatch = message.match(
        /(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
      );
      return {
        action: 'get_logs',
        parameters: {
          projectName: projectMatch?.[1],
        },
      };
    }

    // Domain intents
    if (lowerMessage.includes('domain')) {
      if (lowerMessage.includes('add') || lowerMessage.includes('set')) {
        const domainMatch = message.match(
          /(?:add|set)\s+(?:domain\s+)?["']?([a-zA-Z0-9.-]+)["']?/i,
        );
        const projectMatch = message.match(
          /(?:to|for)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
        );
        return {
          action: 'add_domain',
          parameters: {
            domain: domainMatch?.[1],
            projectName: projectMatch?.[1],
          },
        };
      }
      return {
        action: 'list_domains',
        parameters: {
          projectName: message.match(
            /(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
          )?.[1],
        },
      };
    }

    // Environment variable intents
    if (
      lowerMessage.includes('env') ||
      lowerMessage.includes('environment') ||
      lowerMessage.includes('variable') ||
      lowerMessage.includes('secret')
    ) {
      if (
        lowerMessage.includes('set') ||
        lowerMessage.includes('add') ||
        lowerMessage.includes('create')
      ) {
        const keyMatch = message.match(
          new RegExp(
            '(?:set|add|create)\\s+(?:env(?:ironment)?\\s+(?:var(?:iable)?\\s+)?)?["\']?([A-Z_][A-Z0-9_]*)["\']?',
            'i',
          ),
        );
        const valueRe = new RegExp(
          '(?:to|=|value)\\s+["\']?([^\\s"\']+)["\']?',
          'i',
        );
        const valueMatch = message.match(valueRe);
        const projectMatch = message.match(
          /(?:for|in|on)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
        );
        return {
          action: 'set_env',
          parameters: {
            key: keyMatch?.[1],
            value: valueMatch?.[1],
            projectName: projectMatch?.[1],
          },
        };
      }
      return {
        action: 'list_env',
        parameters: {
          projectName: message.match(
            /(?:for|of|in)\s+["']?([a-zA-Z0-9-_]+)["']?/i,
          )?.[1],
        },
      };
    }

    // Help intent
    if (lowerMessage.includes('help') && lowerMessage.includes('vercel')) {
      return { action: 'help' };
    }

    return null;
  }

  /**
   * Process a Vercel-related chat message
   * ALL operations go through MCP handler for security, rate limiting, and audit logging
   */
  async processMessage(
    message: string,
    context: VercelChatContext,
  ): Promise<VercelChatResponse> {
    try {
      // Check for Vercel connection
      const connections = await this.vercelService.listConnections(
        context.userId,
      );
      const connection = context.vercelConnectionId
        ? connections.find(
            (c: any) => c._id.toString() === context.vercelConnectionId,
          )
        : connections[0];

      // Parse intent
      const command = VercelChatAgentService.parseVercelIntent(message);

      if (!command) {
        return this.generateAIResponse(message, context, connection);
      }

      // Handle connect action (no connection required)
      if (command.action === 'connect') {
        const isUsableConnection =
          connection?.status === 'active' ||
          connection?.status === 'pending_verification';
        if (isUsableConnection) {
          return {
            message: `You're already connected to Vercel as **${(connection as any).vercelUsername}**${(connection as any).teamSlug ? ` (Team: ${(connection as any).teamSlug})` : ''}. Would you like to reconnect or manage your projects?`,
            suggestions: [
              'Show my projects',
              'Disconnect Vercel',
              'Deploy to Vercel',
            ],
          };
        }
        return {
          message:
            'To connect your Vercel account, click the "Connect Vercel" button in the Apps menu or visit the Integrations page.',
          requiresAction: true,
          action: command,
          suggestions: ['Go to Integrations', 'What can Vercel do?'],
        };
      }

      // Handle help action
      if (command.action === 'help') {
        return this.getHelpResponse();
      }

      // Check connection for other actions
      const hasUsableConnection =
        connection &&
        ((connection as any).status === 'active' ||
          (connection as any).status === 'pending_verification');
      if (!hasUsableConnection) {
        return {
          message:
            'You need to connect your Vercel account first to perform this action.',
          requiresAction: true,
          action: { action: 'connect' },
          suggestions: ['Connect Vercel', 'What is Vercel?'],
        };
      }

      // ALL operations go through MCP handler for security
      const integrationCommand = this.convertToIntegrationCommand(
        command,
        connection,
      );
      if (integrationCommand) {
        const mcpResult =
          await this.mcpIntegrationHandler.handleIntegrationOperation({
            userId: context.userId,
            command: integrationCommand,
            context: {
              message,
              vercelConnectionId: connection._id.toString(),
            },
          });

        if (mcpResult.success && mcpResult.result.success) {
          return {
            message: mcpResult.result.message,
            data: mcpResult.result.data,
            suggestions: this.getSuggestionsForAction(command.action),
          };
        } else {
          return {
            message: mcpResult.result.message || 'Operation failed',
            suggestions: ['Show my projects', 'Help with Vercel'],
          };
        }
      }

      // Fallback: Execute command directly (for help and connect actions only)
      return this.executeCommand(command, connection, context);
    } catch (error: any) {
      this.logger.error('Vercel chat agent error', {
        error: error.message,
        userId: context.userId,
      });
      return {
        message: `I encountered an error: ${error.message}. Please try again or check your Vercel connection.`,
        suggestions: ['Show my projects', 'Help with Vercel'],
      };
    }
  }

  /**
   * Convert Vercel command to integration command format for MCP handler
   */
  private convertToIntegrationCommand(
    command: VercelCommand,
    connection: any,
  ): any | null {
    const mention = {
      integration: 'vercel',
      entityType: '',
      entityId: connection?._id ? connection._id.toString() : '',
      rawText: `@vercel ${command.action}`,
    };

    // Map Vercel actions to integration command types
    const actionMap: Record<string, { type: string; entity: string }> = {
      list_projects: { type: 'list', entity: 'projects' },
      deploy: { type: 'create', entity: 'deployment' },
      rollback: { type: 'update', entity: 'deployment' },
      promote: { type: 'update', entity: 'deployment' },
      list_deployments: { type: 'list', entity: 'deployments' },
      get_logs: { type: 'get', entity: 'logs' },
      list_domains: { type: 'list', entity: 'domains' },
      add_domain: { type: 'create', entity: 'domain' },
      list_env: { type: 'list', entity: 'env' },
      set_env: { type: 'create', entity: 'env' },
    };

    const mapping = actionMap[command.action];
    if (!mapping) {
      return null;
    }

    return {
      type: mapping.type,
      entity: mapping.entity,
      params: command.parameters ?? {},
      mention,
    };
  }

  /**
   * Get contextual suggestions based on action
   */
  private getSuggestionsForAction(action: string): string[] {
    const suggestionMap: Record<string, string[]> = {
      list_projects: ['Deploy to Vercel', 'Show deployments', 'List domains'],
      deploy: ['Show deployments', 'Get logs', 'Promote to production'],
      rollback: ['Show deployments', 'Deploy again'],
      promote: ['Show deployments', 'List domains'],
      list_deployments: ['Deploy', 'Get logs', 'Rollback'],
      get_logs: ['Deploy again', 'Show deployments'],
      list_domains: ['Add domain', 'Show projects'],
      add_domain: ['List domains', 'Deploy'],
      list_env: ['Set env var', 'Deploy'],
      set_env: ['List env vars', 'Deploy'],
    };

    return suggestionMap[action] || ['Show my projects', 'Help with Vercel'];
  }

  /**
   * Execute a Vercel command
   */
  private async executeCommand(
    command: VercelCommand,
    connection: any,
    context: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const connectionId = connection._id.toString();

    switch (command.action) {
      case 'list_projects':
        return this.handleListProjects(connectionId);

      case 'deploy':
        return this.handleDeploy(connectionId, command.parameters, context);

      case 'rollback':
        return this.handleRollback(connectionId, command.parameters, context);

      case 'promote':
        return this.handlePromote(connectionId, command.parameters);

      case 'list_deployments':
        return this.handleListDeployments(
          connectionId,
          command.parameters,
          context,
        );

      case 'get_logs':
        return this.handleGetLogs(connectionId, command.parameters, context);

      case 'list_domains':
        return this.handleListDomains(
          connectionId,
          command.parameters,
          context,
        );

      case 'add_domain':
        return this.handleAddDomain(connectionId, command.parameters, context);

      case 'list_env':
        return this.handleListEnv(connectionId, command.parameters, context);

      case 'set_env':
        return this.handleSetEnv(connectionId, command.parameters, context);

      default:
        return {
          message:
            "I'm not sure how to handle that Vercel command. Try asking for help.",
          suggestions: ['Help with Vercel', 'Show my projects'],
        };
    }
  }

  /**
   * Handle list projects command
   * Uses Vercel's official MCP server for optimal performance
   */
  private async handleListProjects(
    connectionId: string,
  ): Promise<VercelChatResponse> {
    try {
      const mcpProjects = await this.vercelService.getProjects(connectionId);

      if (!mcpProjects || mcpProjects.length === 0) {
        return {
          message:
            "You don't have any projects in Vercel yet. Create a project on Vercel first, or deploy a new project.",
          suggestions: ['How to create a Vercel project?', 'Deploy to Vercel'],
        };
      }

      const projectList = mcpProjects
        .map((p: any) => {
          const status =
            p.latestDeployment?.readyState ??
            p.latestDeployment?.state ??
            'No deployments';
          const statusEmoji =
            status === 'READY'
              ? '✅'
              : status === 'BUILDING'
                ? '🔄'
                : status === 'ERROR'
                  ? '❌'
                  : '⏳';
          return `- **${p.name}** ${statusEmoji} (${p.framework || 'Unknown framework'})`;
        })
        .join('\n');

      return {
        message: `Here are your Vercel projects:\n\n${projectList}`,
        data: mcpProjects,
        suggestions: mcpProjects
          .slice(0, 3)
          .map((p: any) => `Deploy ${p.name}`),
      };
    } catch (error: any) {
      this.logger.warn('Failed to list Vercel projects', error);

      return {
        message:
          'I encountered an error listing your Vercel projects. Please check your connection.',
        suggestions: ['Check Vercel connection', 'Help with Vercel'],
      };
    }
  }

  /**
   * Handle deploy command
   * Uses context to infer project if not specified
   */
  private async handleDeploy(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      if (projects.length === 1) {
        params = { ...params, projectName: projects[0].name };
      } else {
        return {
          message: 'Which project would you like to deploy?',
          suggestions: projects.slice(0, 5).map((p) => `Deploy ${p.name}`),
        };
      }
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}". Here are your projects:`,
        suggestions: projects.slice(0, 5).map((p) => `Deploy ${p.name}`),
      };
    }

    const deployment = await this.vercelService.triggerDeployment(
      connectionId,
      project.id,
      {
        target: params.target || 'preview',
      },
    );

    return {
      message:
        `🚀 Deployment triggered for **${project.name}**!\n\n` +
        `- **Status**: ${deployment.state}\n` +
        `- **Target**: ${params.target || 'preview'}\n` +
        `- **URL**: https://${deployment.url}`,
      data: deployment,
      suggestions: [
        `Show deployments for ${project.name}`,
        `Get logs for ${project.name}`,
      ],
    };
  }

  /**
   * Handle rollback command
   * Uses context to infer project if not specified
   */
  private async handleRollback(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message: 'Which project would you like to rollback?',
        suggestions: projects.slice(0, 5).map((p) => `Rollback ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects.slice(0, 5).map((p) => `Rollback ${p.name}`),
      };
    }

    // Get previous successful deployment
    const deployments = await this.vercelService.getDeployments(
      connectionId,
      project.id,
      10,
    );
    const successfulDeployments = deployments.filter(
      (d: any) => (d.readyState ?? d.state) === 'READY',
    );

    if (successfulDeployments.length < 2) {
      return {
        message: `I couldn't find a previous deployment to rollback to for ${project.name}.`,
        suggestions: [
          `Deploy ${project.name}`,
          `Show deployments for ${project.name}`,
        ],
      };
    }

    const rollbackTarget = successfulDeployments[1]; // Second most recent successful deployment
    const deploymentId = (rollbackTarget as { uid: string }).uid;

    await this.vercelService.rollbackDeployment(
      connectionId,
      project.id,
      deploymentId,
    );

    return {
      message: `🔄 Rollback initiated for **${project.name}**!\n\nRolling back to deployment: ${deploymentId}\n\nThe rollback should complete in a few moments.`,
      data: { rollbackTarget },
      suggestions: [
        `Show deployments for ${project.name}`,
        `Deploy ${project.name}`,
      ],
    };
  }

  /**
   * Handle promote command
   */
  private async handlePromote(
    connectionId: string,
    params?: Record<string, any>,
  ): Promise<VercelChatResponse> {
    if (!params?.deploymentId) {
      return {
        message: 'Which deployment would you like to promote to production?',
        suggestions: ['Show my deployments', 'Help with Vercel'],
      };
    }

    await this.vercelService.promoteDeployment(
      connectionId,
      params.deploymentId,
    );

    return {
      message: `🎉 Deployment **${params.deploymentId}** has been promoted to production!\n\nThe production deployment is now live.`,
      suggestions: ['Show deployments', 'Check production status'],
    };
  }

  /**
   * Handle list deployments command
   */
  private async handleListDeployments(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message: 'For which project would you like to see deployments?',
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Show deployments for ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Show deployments for ${p.name}`),
      };
    }

    const deployments = await this.vercelService.getDeployments(
      connectionId,
      project.id,
      10,
    );

    if (deployments.length === 0) {
      return {
        message: `No deployments found for ${project.name}. Try deploying first.`,
        suggestions: [`Deploy ${project.name}`, `Help with Vercel`],
      };
    }

    const deploymentList = deployments
      .slice(0, 5)
      .map((d: any) => {
        const status = d.readyState ?? d.state;
        const statusEmoji =
          status === 'READY'
            ? '✅'
            : status === 'BUILDING'
              ? '🔄'
              : status === 'ERROR'
                ? '❌'
                : '⏳';
        const url = d.url ? ` - https://${d.url}` : '';
        const id = d.uid ?? d.id;
        return `- **${id}** ${statusEmoji} ${status}${url}`;
      })
      .join('\n');

    return {
      message: `Here are the recent deployments for **${project.name}**:\n\n${deploymentList}`,
      data: deployments,
      suggestions: [`Deploy ${project.name}`, `Get logs for ${project.name}`],
    };
  }

  /**
   * Handle get logs command
   */
  private async handleGetLogs(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message: 'For which project would you like to get logs?',
        suggestions: projects.slice(0, 5).map((p) => `Get logs for ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects.slice(0, 5).map((p) => `Get logs for ${p.name}`),
      };
    }

    // getDeploymentLogs(connectionId, deploymentId) - get latest deployment first
    const deployments = await this.vercelService.getDeployments(
      connectionId,
      project.id,
      1,
    );
    const latest = deployments[0];
    if (!latest) {
      return {
        message: `No deployments found for ${project.name}. Deploy first to see logs.`,
        suggestions: [
          `Deploy ${project.name}`,
          `Show deployments for ${project.name}`,
        ],
      };
    }
    const deploymentId = (latest as { uid: string }).uid;
    const logs = await this.vercelService.getDeploymentLogs(
      connectionId,
      deploymentId,
    );

    if (!logs || logs.length === 0) {
      return {
        message: `No recent logs found for ${project.name}. The deployment might be very old or still building.`,
        suggestions: [
          `Deploy ${project.name}`,
          `Show deployments for ${project.name}`,
        ],
      };
    }

    const logSample = logs.slice(0, 20).join('\n');

    return {
      message: `Here are the recent logs for **${project.name}**:\n\n\`\`\`\n${logSample}\n\`\`\`\n\n${logs.length > 20 ? `... and ${logs.length - 20} more lines` : ''}`,
      data: logs,
      suggestions: [
        `Deploy ${project.name}`,
        `Show deployments for ${project.name}`,
      ],
    };
  }

  /**
   * Handle list domains command
   */
  private async handleListDomains(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message: 'For which project would you like to see domains?',
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Show domains for ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Show domains for ${p.name}`),
      };
    }

    const domains = await this.vercelService.getDomains(
      connectionId,
      project.id,
    );

    if (!domains || domains.length === 0) {
      return {
        message: `No custom domains configured for ${project.name}. The default Vercel domain is used.`,
        suggestions: [
          `Add domain to ${project.name}`,
          `Deploy ${project.name}`,
        ],
      };
    }

    const domainList = domains
      .map((d: any) => {
        const verified = d.verified ? '✅' : '⏳';
        return `- **${d.name}** ${verified}`;
      })
      .join('\n');

    return {
      message: `Here are the domains for **${project.name}**:\n\n${domainList}`,
      data: domains,
      suggestions: [`Add domain to ${project.name}`, `Deploy ${project.name}`],
    };
  }

  /**
   * Handle add domain command
   */
  private async handleAddDomain(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    if (!params?.domain) {
      return {
        message: 'What domain would you like to add?',
        suggestions: ['Add example.com', 'Help with domains'],
      };
    }

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message: `To which project would you like to add ${params.domain}?`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Add ${params.domain} to ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Add ${params.domain} to ${p.name}`),
      };
    }

    await this.vercelService.addDomain(connectionId, project.id, params.domain);

    return {
      message: `✅ Domain **${params.domain}** has been added to **${project.name}**!\n\nThe domain will need to be verified. Check your DNS settings and Vercel dashboard for verification instructions.`,
      suggestions: [
        `Show domains for ${project.name}`,
        `Deploy ${project.name}`,
      ],
    };
  }

  /**
   * Handle list environment variables command
   */
  private async handleListEnv(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message:
          'For which project would you like to see environment variables?',
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Show env vars for ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Show env vars for ${p.name}`),
      };
    }

    const envVars = await this.vercelService.getEnvVars(
      connectionId,
      project.id,
    );

    if (!envVars || envVars.length === 0) {
      return {
        message: `No environment variables configured for ${project.name}.`,
        suggestions: [
          `Set env var for ${project.name}`,
          `Help with environment variables`,
        ],
      };
    }

    const envList = envVars
      .map((env: any) => {
        const targets = Array.isArray(env.target)
          ? env.target.join(', ')
          : (env.target ?? 'all');
        const type = env.type === 'encrypted' ? '🔒' : '📝';
        return `- **${env.key}** ${type} (${targets})`;
      })
      .join('\n');

    return {
      message: `Here are the environment variables for **${project.name}**:\n\n${envList}`,
      data: envVars,
      suggestions: [
        `Set env var for ${project.name}`,
        `Deploy ${project.name}`,
      ],
    };
  }

  /**
   * Handle set environment variable command
   */
  private async handleSetEnv(
    connectionId: string,
    params?: Record<string, any>,
    context?: VercelChatContext,
  ): Promise<VercelChatResponse> {
    const projects = await this.vercelService.getProjects(connectionId);

    if (!params?.key || !params?.value) {
      return {
        message:
          'Please specify the environment variable key and value. Example: "Set API_KEY to my-secret-value"',
        suggestions: [
          'Set API_KEY to value',
          'Help with environment variables',
        ],
      };
    }

    // Use context.projectName if params.projectName is not provided
    if (!params?.projectName && context?.projectName) {
      params = { ...params, projectName: context.projectName };
    }

    if (!params?.projectName) {
      return {
        message: `For which project would you like to set ${params.key}?`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Set ${params.key} for ${p.name}`),
      };
    }

    const project = projects.find(
      (p) => p.name.toLowerCase() === params?.projectName?.toLowerCase(),
    );

    if (!project) {
      return {
        message: `I couldn't find a project named "${params.projectName}".`,
        suggestions: projects
          .slice(0, 5)
          .map((p) => `Set ${params.key} for ${p.name}`),
      };
    }

    await this.vercelService.setEnvVar(
      connectionId,
      project.id,
      params.key,
      params.value,
      ['production', 'preview', 'development'],
      'encrypted',
    );

    return {
      message: `✅ Environment variable **${params.key}** has been set for **${project.name}**!\n\nThe variable is encrypted and will be available in all environments.`,
      suggestions: [
        `Show env vars for ${project.name}`,
        `Deploy ${project.name}`,
      ],
    };
  }

  /**
   * Get help response
   */
  private getHelpResponse(): VercelChatResponse {
    return {
      message: `## Vercel Commands 🚀

Here's what I can help you with:

**Projects**
- "Show my Vercel projects"
- "Deploy [project-name]" or "Deploy [project-name] to production"

**Deployments**
- "Show deployments for [project]"
- "Get logs for [project]"
- "Rollback [project]"
- "Promote [deployment-id] to production"

**Domains**
- "Show domains for [project]"
- "Add domain example.com to [project]"

**Environment Variables**
- "Show env vars for [project]"
- "Set env API_KEY to value for [project]"

**Connection**
- "Connect Vercel" - Link your Vercel account`,
      suggestions: [
        'Show my projects',
        'Connect Vercel',
        'Deploy to production',
      ],
    };
  }

  /**
   * Generate AI response for complex queries
   */
  private async generateAIResponse(
    message: string,
    context: VercelChatContext,
    connection?: any | null,
  ): Promise<VercelChatResponse> {
    let contextSection = '';
    if (context) {
      const parts: string[] = [];
      if (context.projectName) {
        parts.push(`The current project is "${context.projectName}".`);
      }
      if (
        context.deployments &&
        Array.isArray(context.deployments) &&
        context.deployments.length > 0
      ) {
        parts.push(
          `Recent deployments: ${context.deployments
            .map((d: any) => d.name || d.id || '[deployment]')
            .slice(0, 3)
            .join(', ')}.`,
        );
      }
      if (
        context.domains &&
        Array.isArray(context.domains) &&
        context.domains.length > 0
      ) {
        parts.push(
          `Connected domains: ${context.domains
            .map((d: any) => d.name || '[domain]')
            .slice(0, 3)
            .join(', ')}.`,
        );
      }
      if (
        context.envVars &&
        Array.isArray(context.envVars) &&
        context.envVars.length > 0
      ) {
        parts.push(
          `Some environment variables are set (e.g., ${context.envVars
            .map((e: any) => e.key || '[env]')
            .slice(0, 3)
            .join(', ')}).`,
        );
      }
      if (parts.length > 0) {
        contextSection =
          '\n\nHere is some current context:\n' + parts.join(' ') + '\n';
      }
    }

    const systemPrompt = `You are a helpful assistant for Vercel deployments and project management within Cost Katana.
${connection ? `The user is connected as ${connection.vercelUsername}${connection.teamSlug ? ` (Team: ${connection.teamSlug})` : ''}.` : 'The user is not connected to Vercel yet.'}
${contextSection}
You can help with:
- Deploying projects to Vercel
- Managing deployments (rollback, promote)
- Configuring domains
- Setting environment variables
- Viewing analytics

If the user asks about something you can help with, provide guidance on how to do it.
If they need to perform an action, suggest the appropriate command.`;

    const fullPrompt = `${systemPrompt}\n\nUser: ${message}`;
    const defaultModel = 'anthropic.claude-3-5-haiku-20241022-v1:0';

    try {
      const request: ModelInvocationRequest = {
        model: defaultModel,
        prompt: fullPrompt,
        parameters: { temperature: 0.2, maxTokens: 1024 },
      };
      const result = await this.aiRouter.invokeModel(request);
      const response = result?.response ?? '';

      return {
        message:
          response ||
          'I\'m not sure how to help with that. Try asking "Help with Vercel" for available commands.',
        suggestions: ['Help with Vercel', 'Show my projects', 'Connect Vercel'],
      };
    } catch (error) {
      this.logger.error('AI response generation failed', error);
      return {
        message:
          "I'm having trouble understanding that request. Here are some things I can help with:",
        suggestions: [
          'Help with Vercel',
          'Show my projects',
          'Deploy to Vercel',
        ],
      };
    }
  }

  /**
   * Handles Vercel-related chat queries for a user.
   * Converts the NestJS interface into a VercelChatContext,
   * delegates processing to this.processMessage, and
   * maps the response to the correct format.
   */
  async handleVercelQuery(
    userId: string,
    message: string,
  ): Promise<{ response: string; toolUsed?: string; routeToMcp?: boolean }> {
    try {
      // Build the Vercel chat context for this user.
      const context: VercelChatContext = { userId };

      // Process the incoming chat message with relevant context.
      const result = await this.processMessage(message, context);

      return {
        response:
          result?.message ?? 'Sorry, I could not process your Vercel request.',
        routeToMcp: result?.requiresAction ?? false,
        // If tool usage is detected by processMessage, expose it; otherwise undefined.
        toolUsed: result?.toolUsed,
      };
    } catch (err) {
      // General type for error; safely extract properties.
      const error = err as Error | { message?: unknown; stack?: unknown };
      const messageText =
        error && typeof error === 'object' && 'message' in error
          ? (error.message as string)
          : 'Unknown error';
      const stackText =
        error && typeof error === 'object' && 'stack' in error
          ? error.stack
          : undefined;

      this.logger.error('Vercel chat message processing failed', {
        userId,
        error: messageText,
        stack: stackText,
      });

      return {
        response: `I encountered an error: ${messageText}. Please try again or contact support if the issue persists.`,
        routeToMcp: false,
        toolUsed: undefined,
      };
    }
  }
}
