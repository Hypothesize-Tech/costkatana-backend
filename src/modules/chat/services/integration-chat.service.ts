import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../../common/logger/logger.service';
import { IntegrationService } from '../../integration/integration.service';
import { JiraService } from '../../integration/services/jira.service';
import { LinearService } from '../../integration/services/linear.service';
import { SlackService } from '../../integration/services/slack.service';
import { DiscordService } from '../../integration/services/discord.service';
import { GitHubService } from '../../github/github.service';
import { GoogleService } from '../../google/google.service';
import { GoogleExportIntegrationService } from '../../google/google-export-integration.service';
import { VercelService } from '../../vercel/vercel.service';
import { AWSChatAgentService } from './aws-chat-agent.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';
import { GoogleConnection } from '../../../schemas/integration/google-connection.schema';
import type { GoogleConnectionWithTokens } from '../../google/utils/google-connection-tokens';
import { VercelConnection } from '../../../schemas/integration/vercel-connection.schema';
import { AWSConnection } from '../../../schemas/integration/aws-connection.schema';
import { ChatEventsService } from './chat-events.service';

export interface ParsedMention {
  integration: string;
  entityType?: string;
  entityId?: string;
  subEntityType?: string;
  subEntityId?: string;
  action?: string;
  parameters?: Record<string, any>;
  originalMention: string;
}

export interface IntegrationCommand {
  type:
    | 'create'
    | 'get'
    | 'list'
    | 'update'
    | 'delete'
    | 'send'
    | 'add'
    | 'assign'
    | 'remove'
    | 'ban'
    | 'unban'
    | 'kick'
    | 'export'
    | 'query'
    | 'status'
    | 'optimize';
  entity: string;
  mention: ParsedMention;
  params: Record<string, any>;
  naturalLanguage?: string;
}

export interface IntegrationCommandResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  viewLinks?: Array<{
    label: string;
    url: string;
    type:
      | 'document'
      | 'spreadsheet'
      | 'presentation'
      | 'file'
      | 'email'
      | 'calendar'
      | 'form';
  }>;
  metadata?: {
    type?: string;
    count?: number;
    service?:
      | 'gmail'
      | 'calendar'
      | 'drive'
      | 'gdocs'
      | 'sheets'
      | 'jira'
      | 'linear'
      | 'slack'
      | 'discord'
      | 'github'
      | 'google'
      | 'vercel'
      | 'aws';
    status?: string;
    requiresApproval?: boolean;
    approvalToken?: string;
    requiresPicker?: boolean;
    fileType?: 'docs' | 'sheets' | 'drive';
    suggestions?: string[];
    teamId?: string;
    guildId?: string;
    supportedCommands?: string[];
    channelId?: string;
    setupRequired?: boolean;
    plannedFeatures?: string[];
    repository?: string;
    projectId?: string;
    deploymentId?: string;
  };
}

/** Shape of channel objects returned by Slack/Discord list APIs (id, name) */
interface ChannelInfo {
  id: string;
  name: string;
}

@Injectable()
export class IntegrationChatService {
  constructor(
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly integrationService: IntegrationService,
    private readonly jiraService: JiraService,
    private readonly linearService: LinearService,
    private readonly slackService: SlackService,
    private readonly discordService: DiscordService,
    private readonly gitHubService: GitHubService,
    private readonly googleService: GoogleService,
    private readonly googleExportIntegrationService: GoogleExportIntegrationService,
    private readonly vercelService: VercelService,
    private readonly awsChatAgent: AWSChatAgentService,
    private readonly chatEventsService: ChatEventsService,
    @InjectModel(GitHubConnection.name)
    private readonly githubConnectionModel: Model<GitHubConnectionDocument>,
    @InjectModel(GoogleConnection.name)
    private readonly googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(VercelConnection.name)
    private readonly vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(AWSConnection.name)
    private readonly awsConnectionModel: Model<AWSConnection>,
  ) {}

  /**
   * Parse natural language command with integration mentions
   */
  async parseCommand(
    message: string,
    mentions: ParsedMention[],
  ): Promise<IntegrationCommand | null> {
    try {
      this.logger.debug('Parsing integration command', {
        messageLength: message.length,
        mentionsCount: mentions.length,
      });

      if (mentions.length === 0) {
        // Try to detect implicit integrations from natural language
        const detectedMentions = await this.detectImplicitMentions(message);
        if (detectedMentions.length > 0) {
          mentions = detectedMentions;
        } else {
          // Try MongoDB-specific detection when @mongodb is present
          const mongoMention =
            IntegrationChatService.parseMongoDBCommand(message);
          if (mongoMention) {
            mentions = [mongoMention];
          } else {
            return null; // No integration commands detected
          }
        }
      }

      // Process the first mention (primary command)
      const primaryMention = mentions[0];
      let command: IntegrationCommand | null = null;

      try {
        command = await this.buildCommandFromMention(message, primaryMention);
      } catch {
        // Fallback to manual parsing when buildCommandFromMention fails
        command = IntegrationChatService.parseCommandManual(message, mentions);
      }

      if (!command) {
        return null;
      }

      this.logger.log('Parsed integration command', {
        integration: command.mention.integration,
        type: command.type,
        entity: command.entity,
      });

      return command;
    } catch (error) {
      this.logger.error('Failed to parse integration command', {
        error: error instanceof Error ? error.message : String(error),
        message: message.substring(0, 100),
      });
      return null;
    }
  }

  /**
   * Execute integration command
   */
  async executeCommand(
    userId: string,
    command: IntegrationCommand,
    commandId?: string,
  ): Promise<IntegrationCommandResult> {
    try {
      this.logger.log('Executing integration command', {
        userId,
        integration: command.mention.integration,
        type: command.type,
        entity: command.entity,
        commandId,
      });

      // Emit started event if commandId provided
      if (commandId) {
        this.chatEventsService?.emitStatus(commandId, userId, 'started', {
          integration: command.mention.integration,
          type: command.type,
          entity: command.entity,
        });
      }

      // Route to appropriate integration service
      switch (command.mention.integration.toLowerCase()) {
        case 'jira':
          return await this.executeJiraCommand(userId, command);

        case 'linear':
          return await this.executeLinearCommand(userId, command);

        case 'slack':
          return await this.executeSlackCommand(userId, command);

        case 'discord':
          return await this.executeDiscordCommand(userId, command);

        case 'github':
          return await this.executeGitHubCommand(userId, command);

        case 'google':
        case 'drive':
        case 'sheets':
        case 'docs':
        case 'gdocs':
          return await this.executeGoogleCommand(userId, command);

        case 'vercel':
          return await this.executeVercelCommand(userId, command);

        case 'aws':
          return await this.executeAWSCommand(userId, command);

        case 'mongodb':
          const mongodbResult = {
            success: true,
            message:
              'MongoDB queries are handled by the MongoDB chat agent. Use @mongodb in your message to run queries.',
            data: { integration: 'mongodb', routed: true },
          };

          // Emit completion event if commandId provided
          if (commandId) {
            this.chatEventsService?.emitStatus(commandId, userId, 'completed', {
              success: true,
              integration: 'mongodb',
              data: mongodbResult.data,
            });
          }

          return mongodbResult;

        default:
          const result = {
            success: false,
            message: `Unsupported integration: ${command.mention.integration}`,
            error: 'Integration not supported',
          };

          // Emit completion event if commandId provided
          if (commandId) {
            this.chatEventsService?.emitStatus(commandId, userId, 'completed', {
              success: false,
              error: result.error,
              integration: command.mention.integration,
            });
          }

          return result;
      }
    } catch (error) {
      this.logger.error('Failed to execute integration command', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration: command.mention.integration,
        type: command.type,
      });

      const errorResult = {
        success: false,
        message: 'Failed to execute integration command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      // Emit error completion event if commandId provided
      if (commandId) {
        this.chatEventsService?.emitStatus(commandId, userId, 'completed', {
          success: false,
          error: errorResult.error,
          integration: command.mention.integration,
        });
      }

      return errorResult;
    }
  }

  /**
   * Detect implicit integration mentions from natural language
   */
  async detectImplicitMentions(message: string): Promise<ParsedMention[]> {
    const mentions: ParsedMention[] = [];
    const lowerMessage = message.toLowerCase();

    // Google Workspace detection
    if (
      lowerMessage.includes('google') ||
      lowerMessage.includes('gmail') ||
      lowerMessage.includes('drive') ||
      lowerMessage.includes('docs') ||
      lowerMessage.includes('sheets') ||
      lowerMessage.includes('calendar')
    ) {
      mentions.push({
        integration: 'google',
        originalMention: 'implicit:google',
      });
    }

    // GitHub detection
    if (
      lowerMessage.includes('github') ||
      lowerMessage.includes('repository') ||
      lowerMessage.includes('repo') ||
      lowerMessage.includes('pull request') ||
      lowerMessage.includes('issue') ||
      lowerMessage.includes('commit')
    ) {
      mentions.push({
        integration: 'github',
        originalMention: 'implicit:github',
      });
    }

    // Jira detection
    if (
      lowerMessage.includes('jira') ||
      lowerMessage.includes('ticket') ||
      lowerMessage.includes('epic') ||
      lowerMessage.includes('sprint')
    ) {
      mentions.push({
        integration: 'jira',
        originalMention: 'implicit:jira',
      });
    }

    // Linear detection
    if (
      lowerMessage.includes('linear') ||
      lowerMessage.includes('linear.app')
    ) {
      mentions.push({
        integration: 'linear',
        originalMention: 'implicit:linear',
      });
    }

    // Slack detection
    if (
      lowerMessage.includes('slack') ||
      lowerMessage.includes('channel') ||
      lowerMessage.includes('message') ||
      /\B@\w+/.test(message)
    ) {
      // @ mentions
      mentions.push({
        integration: 'slack',
        originalMention: 'implicit:slack',
      });
    }

    // Discord detection
    if (lowerMessage.includes('discord') || lowerMessage.includes('server')) {
      mentions.push({
        integration: 'discord',
        originalMention: 'implicit:discord',
      });
    }

    // Vercel detection
    if (
      lowerMessage.includes('vercel') ||
      lowerMessage.includes('deployment') ||
      lowerMessage.includes('deploy') ||
      lowerMessage.includes('preview url')
    ) {
      mentions.push({
        integration: 'vercel',
        originalMention: 'implicit:vercel',
      });
    }

    // MongoDB detection
    if (
      lowerMessage.includes('mongodb') ||
      lowerMessage.includes('mongo') ||
      lowerMessage.includes('collection') ||
      lowerMessage.includes('document') ||
      lowerMessage.includes('query') ||
      lowerMessage.includes('aggregate') ||
      lowerMessage.includes('find') ||
      lowerMessage.includes('database')
    ) {
      mentions.push({
        integration: 'mongodb',
        originalMention: 'implicit:mongodb',
      });
    }

    return mentions;
  }

  /**
   * Build command from mention
   */
  private async buildCommandFromMention(
    message: string,
    mention: ParsedMention,
  ): Promise<IntegrationCommand> {
    // Determine command type from message and mention
    const commandType = this.determineCommandType(message, mention);
    const entity = mention.entityType || 'general';
    const params = await this.extractCommandParams(message, mention);

    return {
      type: commandType,
      entity,
      mention,
      params,
      naturalLanguage: message,
    };
  }

  /**
   * Determine command type from message and mention
   */
  private determineCommandType(
    message: string,
    mention: ParsedMention,
  ): IntegrationCommand['type'] {
    const lowerMessage = message.toLowerCase();

    // Action detection
    if (mention.action) {
      switch (mention.action.toLowerCase()) {
        case 'create':
          return 'create';
        case 'get':
          return 'get';
        case 'list':
          return 'list';
        case 'update':
          return 'update';
        case 'delete':
          return 'delete';
        case 'send':
          return 'send';
        case 'add':
          return 'add';
        case 'assign':
          return 'assign';
        case 'remove':
          return 'remove';
        case 'ban':
          return 'ban';
        case 'unban':
          return 'unban';
        case 'kick':
          return 'kick';
        case 'export':
          return 'export';
        case 'query':
          return 'query';
      }
    }

    // Keyword-based detection
    if (
      lowerMessage.includes('create') ||
      lowerMessage.includes('make') ||
      lowerMessage.includes('new')
    ) {
      return 'create';
    }
    if (
      lowerMessage.includes('get') ||
      lowerMessage.includes('show') ||
      lowerMessage.includes('view')
    ) {
      return 'get';
    }
    if (lowerMessage.includes('list') || lowerMessage.includes('find')) {
      return 'list';
    }
    if (
      lowerMessage.includes('update') ||
      lowerMessage.includes('edit') ||
      lowerMessage.includes('change')
    ) {
      return 'update';
    }
    if (lowerMessage.includes('delete') || lowerMessage.includes('remove')) {
      return 'delete';
    }
    if (
      lowerMessage.includes('send') ||
      lowerMessage.includes('post') ||
      lowerMessage.includes('message')
    ) {
      return 'send';
    }

    return 'get'; // Default
  }

  /**
   * Extract command parameters from message
   */
  private async extractCommandParams(
    message: string,
    mention: ParsedMention,
  ): Promise<Record<string, any>> {
    const params: Record<string, any> = {};

    // Extract emails for communication commands
    const emails = this.extractEmailRecipients(message);
    if (emails.length > 0) {
      params.recipients = emails;
    }

    // Extract subject for emails/tickets
    const subject = this.extractSubject(message);
    if (subject) {
      params.subject = subject;
    }

    // Extract body/content
    const body = this.extractBody(message);
    if (body) {
      params.body = body;
      params.content = body;
    }

    // Extract search queries
    const searchQuery = this.extractSearchQuery(message);
    if (searchQuery) {
      params.query = searchQuery;
      params.searchTerm = searchQuery;
    }

    return params;
  }

  /**
   * Extract email recipients from natural language
   */
  private extractEmailRecipients(text: string): string[] {
    const emails: string[] = [];

    // Extract emails using regex
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let match;
    while ((match = emailPattern.exec(text)) !== null) {
      emails.push(match[1].toLowerCase());
    }

    return [...new Set(emails)]; // Remove duplicates
  }

  /**
   * Validate email addresses using regex
   */
  private validateEmailAddresses(emails: string[]): {
    valid: string[];
    invalid: string[];
  } {
    const valid: string[] = [];
    const invalid: string[] = [];

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    for (const email of emails) {
      if (emailRegex.test(email)) {
        valid.push(email);
      } else {
        invalid.push(email);
      }
    }

    return { valid, invalid };
  }

  /**
   * Extract subject from natural language
   */
  private extractSubject(text: string): string | null {
    const patterns = [
      /subject:?\s+["']?([^"']+?)["']?(?:\s|$)/i,
      /with\s+subject\s+["']?([^"']+?)["']?(?:\s|$)/i,
      /titled?\s+["']?([^"']+?)["']?(?:\s|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Extract body/content from natural language
   */
  private extractBody(text: string): string | null {
    const patterns = [
      /saying\s+["']?([^"']+?)["']?(?:\s|$)/i,
      /message:?\s+["']?([^"']+?)["']?(?:\s|$)/i,
      /body:?\s+["']?([^"']+?)["']?(?:\s|$)/i,
      /content:?\s+["']?([^"']+?)["']?(?:\s|$)/i,
      /with\s+(?:message|body|content)\s+["']?([^"']+?)["']?(?:\s|$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Extract search query from natural language
   */
  private extractSearchQuery(text: string): string | null {
    const patterns = [
      /(?:search|find|look)\s+(?:for\s+)?(.+?)(?:\s|$)/i,
      /(.+?)\s+(?:file|document|folder|item)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  // Integration-specific command executors

  private async executeJiraCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      const integrations = await this.integrationService.getUserIntegrations(
        userId,
        {
          status: 'active',
          type: 'jira_oauth' as any,
        },
      );

      if (integrations.length === 0) {
        return {
          success: false,
          message: 'No active JIRA integration found',
          error: 'Integration not configured',
        };
      }

      const integration = integrations[0];
      const credentials = integration.getCredentials();
      const siteUrlOrCloudId = credentials.siteUrl || credentials.cloudId || '';
      const accessToken = credentials.accessToken || '';
      const useCloudId = !!credentials.cloudId;

      if (!siteUrlOrCloudId || !accessToken) {
        return {
          success: false,
          message: 'JIRA credentials not configured',
          error: 'MISSING_CREDENTIALS',
        };
      }

      const resolveIssueKey = (): string | null =>
        command.mention.entityType === 'issue' && command.mention.entityId
          ? command.mention.entityId
          : (command.mention.subEntityId ?? command.params?.issueKey ?? null);

      switch (command.type) {
        case 'create':
          if (command.entity === 'issue') {
            const projectKey =
              command.mention.entityId ?? command.params?.projectKey;
            if (!projectKey) {
              return {
                success: false,
                message:
                  'Project key is required. Use @jira:project:PROJECT-KEY',
                error: 'MISSING_PROJECT_KEY',
              };
            }
            const issueTypes = await this.jiraService.getIssueTypes(
              siteUrlOrCloudId,
              accessToken,
              projectKey,
              useCloudId,
            );
            if (issueTypes.length === 0) {
              return {
                success: false,
                message: 'No issue types found for project',
                error: 'NO_ISSUE_TYPES',
              };
            }
            const issue = await this.jiraService.createIssue(
              siteUrlOrCloudId,
              accessToken,
              {
                projectKey,
                title:
                  command.params?.title ??
                  command.params?.subject ??
                  'Untitled Issue',
                description:
                  command.params?.description ?? command.params?.body,
                issueTypeId: issueTypes[0].id,
                useCloudId,
              },
            );
            return {
              success: true,
              message: `Created JIRA issue ${issue.key}`,
              data: issue,
              metadata: { type: 'issue', service: 'jira' },
            };
          }
          break;

        case 'get':
          if (command.entity === 'issue') {
            const issueKey = resolveIssueKey();
            if (!issueKey) {
              return {
                success: false,
                message:
                  'Issue key is required. Use @jira:issue:ISSUE-KEY or specify in message',
                error: 'MISSING_ISSUE_KEY',
              };
            }
            const issue = await this.jiraService.getIssue(
              siteUrlOrCloudId,
              accessToken,
              issueKey,
              useCloudId,
            );
            if (!issue) {
              return {
                success: false,
                message: `Issue ${issueKey} not found`,
                error: 'ISSUE_NOT_FOUND',
              };
            }
            const summary = (issue.fields?.summary as string) ?? issue.key;
            return {
              success: true,
              message: `Issue ${issue.key}: ${summary}`,
              data: issue,
              metadata: { type: 'issue', service: 'jira' },
            };
          }
          if (command.entity === 'project' && command.mention.entityId) {
            const projects = await this.jiraService.listProjects(
              siteUrlOrCloudId,
              accessToken,
              useCloudId,
            );
            const project = projects.find(
              (p) => p.key === command.mention.entityId,
            );
            if (project) {
              return {
                success: true,
                message: `Found JIRA project: ${project.name}`,
                data: { id: project.key, name: project.name, key: project.key },
                metadata: { type: 'project', service: 'jira' },
              };
            }
          }
          break;

        case 'update':
          if (command.entity === 'issue') {
            const issueKey = resolveIssueKey();
            if (!issueKey) {
              return {
                success: false,
                message:
                  'Issue key is required. Use @jira:issue:ISSUE-KEY or specify in message',
                error: 'MISSING_ISSUE_KEY',
              };
            }
            const updates: { summary?: string; description?: string } = {};
            if (command.params?.title) updates.summary = command.params.title;
            if (command.params?.description)
              updates.description = command.params.description;
            if (Object.keys(updates).length === 0) {
              return {
                success: false,
                message:
                  'No updates provided. Specify title or description to update',
                error: 'NO_UPDATES',
              };
            }
            await this.jiraService.updateIssue(
              siteUrlOrCloudId,
              accessToken,
              issueKey,
              updates,
              useCloudId,
            );
            return {
              success: true,
              message: `Updated issue ${issueKey}`,
              data: { issueKey },
              metadata: { type: 'issue', service: 'jira' },
            };
          }
          break;

        case 'list':
          if (command.entity === 'issue') {
            const projectKey =
              command.mention.entityId ?? command.params?.projectKey;
            if (!projectKey) {
              return {
                success: false,
                message:
                  'Project key is required. Use @jira:project:PROJECT-KEY',
                error: 'MISSING_PROJECT_KEY',
              };
            }
            const listResult = await this.jiraService.listIssues(
              siteUrlOrCloudId,
              accessToken,
              projectKey,
              { maxResults: 50 },
              useCloudId,
            );
            return {
              success: true,
              message: `Found ${listResult.total} issues in project ${projectKey}`,
              data: listResult.issues,
              metadata: {
                type: 'issues',
                count: listResult.total,
                service: 'jira',
              },
            };
          }
          if (command.entity === 'project') {
            const projects = await this.jiraService.listProjects(
              siteUrlOrCloudId,
              accessToken,
              useCloudId,
            );
            return {
              success: true,
              message: `Found ${projects.length} JIRA projects`,
              data: projects.map((p) => ({
                id: p.key,
                name: p.name,
                key: p.key,
              })),
              metadata: {
                type: 'projects',
                count: projects.length,
                service: 'jira',
              },
            };
          }
          break;

        case 'add':
          if (command.entity === 'comment') {
            const issueKey = resolveIssueKey();
            if (!issueKey) {
              return {
                success: false,
                message:
                  'Issue key is required. Use @jira:issue:ISSUE-KEY or specify in message',
                error: 'MISSING_ISSUE_KEY',
              };
            }
            const commentText =
              command.params?.comment ??
              command.params?.body ??
              command.params?.content ??
              'No comment provided';
            await this.jiraService.addComment(
              siteUrlOrCloudId,
              accessToken,
              issueKey,
              commentText,
              useCloudId,
            );
            return {
              success: true,
              message: `Comment added to issue ${issueKey}`,
              data: { issueKey },
              metadata: { type: 'comment', service: 'jira' },
            };
          }
          break;
      }

      return {
        success: false,
        message: `JIRA integration is not fully configured. Command type '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          service: 'jira',
          status: 'not_configured',
          supportedCommands: [
            'list projects',
            'get project',
            'create issue',
            'get issue',
            'update issue',
            'list issues',
            'add comment',
          ],
        },
      };
    } catch (error) {
      this.logger.error('JIRA command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });
      return {
        success: false,
        message: 'Failed to execute JIRA command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeLinearCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      const integrations = await this.integrationService.getUserIntegrations(
        userId,
        {
          status: 'active',
          type: 'linear_oauth' as any,
        },
      );

      if (integrations.length === 0) {
        return {
          success: false,
          message: 'No active Linear integration found',
          error: 'Integration not configured',
        };
      }

      const integration = integrations[0];
      const credentials = integration.getCredentials();
      const accessToken = credentials.accessToken || '';

      if (!accessToken) {
        return {
          success: false,
          message: 'Linear credentials not configured',
          error: 'MISSING_CREDENTIALS',
        };
      }

      const resolveIssueId = (): string | null =>
        command.mention.entityType === 'issue' && command.mention.entityId
          ? command.mention.entityId
          : (command.mention.subEntityId ?? command.params?.issueId ?? null);

      switch (command.type) {
        case 'create':
          if (command.entity === 'issue') {
            const teamId =
              command.mention.entityId ??
              credentials.teamId ??
              command.params?.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID is required. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID',
              };
            }
            const projectId =
              command.mention.subEntityType === 'project' &&
              command.mention.subEntityId
                ? command.mention.subEntityId
                : command.params?.projectId;
            const issue = await this.linearService.createIssue(accessToken, {
              teamId,
              title:
                command.params?.title ??
                command.params?.subject ??
                'Untitled Issue',
              description: command.params?.description ?? command.params?.body,
              projectId,
            });
            return {
              success: true,
              message: `Created Linear issue ${issue.identifier}`,
              data: issue,
              metadata: { type: 'issue', service: 'linear' },
            };
          }
          break;

        case 'get':
          if (command.entity === 'issue') {
            const issueId = resolveIssueId();
            if (!issueId) {
              return {
                success: false,
                message:
                  'Issue ID is required. Use @linear:issue:ISSUE-ID or specify in message',
                error: 'MISSING_ISSUE_ID',
              };
            }
            const issue = await this.linearService.getIssue(
              accessToken,
              issueId,
            );
            if (!issue) {
              return {
                success: false,
                message: `Issue ${issueId} not found`,
                error: 'ISSUE_NOT_FOUND',
              };
            }
            return {
              success: true,
              message: `Issue ${issue.identifier}: ${issue.title}`,
              data: issue,
              metadata: { type: 'issue', service: 'linear' },
            };
          }
          if (command.entity === 'team' && command.mention.entityId) {
            const teams = await this.linearService.listTeams(accessToken);
            const team = teams.find((t) => t.id === command.mention.entityId);
            if (team) {
              return {
                success: true,
                message: `Found Linear team: ${team.name}`,
                data: { id: team.id, name: team.name, key: team.key },
                metadata: { type: 'team', service: 'linear' },
              };
            }
          }
          if (command.entity === 'project' && command.mention.entityId) {
            const projectId = command.mention.entityId;
            const teams = await this.linearService.listTeams(accessToken);
            for (const team of teams) {
              const projects = await this.linearService.listProjects(
                accessToken,
                team.id,
              );
              const project = projects.find((p) => p.id === projectId);
              if (project) {
                return {
                  success: true,
                  message: `Found Linear project: ${project.name}`,
                  data: {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    icon: project.icon,
                    teamId: team.id,
                    teamName: team.name,
                  },
                  metadata: { type: 'project', service: 'linear' },
                };
              }
            }
            return {
              success: false,
              message: `Linear project with ID '${projectId}' not found`,
              error: 'Project not found',
              metadata: { type: 'project', service: 'linear' },
            };
          }
          break;

        case 'update':
          if (command.entity === 'issue') {
            const issueId = resolveIssueId();
            if (!issueId) {
              return {
                success: false,
                message:
                  'Issue ID is required. Use @linear:issue:ISSUE-ID or specify in message',
                error: 'MISSING_ISSUE_ID',
              };
            }
            const updates: { title?: string; description?: string } = {};
            if (command.params?.title) updates.title = command.params.title;
            if (command.params?.description)
              updates.description = command.params.description;
            if (Object.keys(updates).length === 0) {
              return {
                success: false,
                message:
                  'No updates provided. Specify title or description to update',
                error: 'NO_UPDATES',
              };
            }
            await this.linearService.updateIssue(accessToken, issueId, updates);
            return {
              success: true,
              message: `Updated issue ${issueId}`,
              data: { issueId },
              metadata: { type: 'issue', service: 'linear' },
            };
          }
          break;

        case 'list':
          if (command.entity === 'team') {
            const teams = await this.linearService.listTeams(accessToken);
            return {
              success: true,
              message: `Found ${teams.length} Linear teams`,
              data: teams.map((t) => ({ id: t.id, name: t.name, key: t.key })),
              metadata: {
                type: 'teams',
                count: teams.length,
                service: 'linear',
              },
            };
          }
          if (command.entity === 'project') {
            const teamId = command.mention.entityId ?? credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID required for listing Linear projects',
                error: 'Missing team context',
              };
            }
            const projects = await this.linearService.listProjects(
              accessToken,
              teamId,
            );
            return {
              success: true,
              message: `Found ${projects.length} Linear projects`,
              data: projects.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
              })),
              metadata: {
                type: 'projects',
                count: projects.length,
                teamId,
                service: 'linear',
              },
            };
          }
          if (command.entity === 'issue') {
            const teamId = command.mention.entityId ?? credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message:
                  'Team ID is required to list issues. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID',
              };
            }
            const listResult = await this.linearService.listIssues(
              accessToken,
              teamId,
              { limit: 50 },
            );
            return {
              success: true,
              message: `Found ${listResult.total} issues in team`,
              data: listResult.issues,
              metadata: {
                type: 'issues',
                count: listResult.total,
                service: 'linear',
              },
            };
          }
          if (
            command.entity === 'user' ||
            command.entity === 'member' ||
            command.entity === 'users'
          ) {
            const teamId = command.mention.entityId ?? credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID is required. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID',
              };
            }
            const members = await this.linearService.listTeamMembers(
              accessToken,
              teamId,
            );
            return {
              success: true,
              message: `Found ${members.length} team members`,
              data: members.map((m) => ({
                id: m.id,
                name: m.name,
                displayName: m.displayName,
                email: m.email,
              })),
              metadata: {
                type: 'users',
                count: members.length,
                teamId,
                service: 'linear',
              },
            };
          }
          if (command.entity === 'tag' || command.entity === 'label') {
            const teamId = command.mention.entityId ?? credentials.teamId;
            const labels = await this.linearService.listLabels(
              accessToken,
              teamId || undefined,
            );
            return {
              success: true,
              message: `Found ${labels.length} labels`,
              data: labels.map((l) => ({
                id: l.id,
                name: l.name,
                color: l.color,
                description: l.description,
              })),
              metadata: {
                type: 'tags',
                count: labels.length,
                service: 'linear',
              },
            };
          }
          if (command.entity === 'epic') {
            const teamId = command.mention.entityId ?? credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID is required. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID',
              };
            }
            const epics = await this.linearService.listEpics(
              accessToken,
              teamId,
            );
            return {
              success: true,
              message: `Found ${epics.length} epics/projects`,
              data: epics.map((e) => ({
                id: e.id,
                name: e.name,
                description: e.description,
              })),
              metadata: {
                type: 'epics',
                count: epics.length,
                teamId,
                service: 'linear',
              },
            };
          }
          if (
            command.entity === 'iteration' ||
            command.entity === 'cycle' ||
            command.entity === 'iterations'
          ) {
            const teamId = command.mention.entityId ?? credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID is required. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID',
              };
            }
            const iterations = await this.linearService.listIterations(
              accessToken,
              teamId,
            );
            return {
              success: true,
              message: `Found ${iterations.length} iterations/cycles`,
              data: iterations.map((i) => ({
                id: i.id,
                name: i.name,
                startDate: i.startDate,
                endDate: i.endDate,
              })),
              metadata: {
                type: 'iterations',
                count: iterations.length,
                teamId,
                service: 'linear',
              },
            };
          }
          if (command.entity === 'workflow' || command.entity === 'channel') {
            const teamId = command.mention.entityId ?? credentials.teamId;
            if (!teamId) {
              return {
                success: false,
                message: 'Team ID is required. Use @linear:team:TEAM-ID',
                error: 'MISSING_TEAM_ID',
              };
            }
            const states = await this.linearService.listWorkflowStates(
              accessToken,
              teamId,
            );
            return {
              success: true,
              message: `Found ${states.length} workflow states`,
              data: states.map((s) => ({
                id: s.id,
                name: s.name,
                type: s.type,
              })),
              metadata: {
                type: 'workflows',
                count: states.length,
                teamId,
                service: 'linear',
              },
            };
          }
          break;

        case 'add':
          if (command.entity === 'comment') {
            const issueId = resolveIssueId();
            if (!issueId) {
              return {
                success: false,
                message:
                  'Issue ID is required. Use @linear:issue:ISSUE-ID or specify in message',
                error: 'MISSING_ISSUE_ID',
              };
            }
            const commentBody =
              command.params?.comment ??
              command.params?.body ??
              command.params?.content ??
              'No comment provided';
            await this.linearService.addComment(
              accessToken,
              issueId,
              commentBody,
            );
            return {
              success: true,
              message: `Comment added to issue`,
              data: { issueId },
              metadata: { type: 'comment', service: 'linear' },
            };
          }
          break;
      }

      return {
        success: false,
        message: `Linear integration is not fully configured. Command type '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          service: 'linear',
          status: 'not_configured',
          supportedCommands: [
            'list teams',
            'list projects',
            'list issues',
            'list users',
            'list tags',
            'list epics',
            'list iterations',
            'list workflows',
            'get team',
            'get project',
            'create issue',
            'get issue',
            'update issue',
            'add comment',
          ],
        },
      };
    } catch (error) {
      this.logger.error('Linear command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });
      return {
        success: false,
        message: 'Failed to execute Linear command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeSlackCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      const [oauthIntegrations, webhookIntegrations] = await Promise.all([
        this.integrationService.getUserIntegrations(userId, {
          status: 'active',
          type: 'slack_oauth' as any,
        }),
        this.integrationService.getUserIntegrations(userId, {
          status: 'active',
          type: 'slack_webhook' as any,
        }),
      ]);
      const integrations = [...oauthIntegrations, ...webhookIntegrations];

      if (integrations.length === 0) {
        return {
          success: false,
          message: 'No active Slack integration found',
          error: 'Integration not configured',
        };
      }

      const integration = integrations[0];
      const credentials = integration.getCredentials();

      // Route based on command type and entity
      switch (command.type) {
        case 'list':
          if (command.entity === 'channel') {
            const channels = await this.slackService.listChannels(
              credentials.accessToken || '',
            );

            return {
              success: true,
              message: `Found ${channels.length} Slack channels`,
              data: channels.map((c: any) => ({ id: c.id, name: c.name })),
              metadata: {
                type: 'channels',
                count: channels.length,
                service: 'slack',
              },
            };
          }
          if (command.entity === 'user' || command.entity === 'users') {
            const oauthIntegration = integrations.find(
              (i) => i.type === 'slack_oauth',
            );
            if (!oauthIntegration?.getCredentials().accessToken) {
              return {
                success: false,
                message:
                  'Slack OAuth connection is required to list users. Webhook connections do not support users.list.',
                error: 'OAuth required',
                metadata: { service: 'slack' },
              };
            }
            const users = await this.slackService.listUsers(
              oauthIntegration.getCredentials().accessToken || '',
            );
            return {
              success: true,
              message: `Found ${users.length} Slack users`,
              data: users.map((u) => ({
                id: u.id,
                name: u.name,
                realName: u.real_name,
                email: u.email,
              })),
              metadata: {
                type: 'users',
                count: users.length,
                service: 'slack',
              },
            };
          }
          break;

        case 'send':
          if (
            (command.entity === 'message' || command.entity === 'channel') &&
            command.mention.entityId
          ) {
            const channelId = command.mention.entityId;
            const text =
              command.params?.body ??
              command.params?.content ??
              command.naturalLanguage ??
              '';

            if (!text.trim()) {
              return {
                success: false,
                message: 'Message content is required to send to Slack',
                error: 'Missing message body',
                metadata: { channelId, service: 'slack' },
              };
            }

            const oauthIntegration = integrations.find(
              (i) => i.type === 'slack_oauth',
            );
            const webhookIntegration = integrations.find(
              (i) => i.type === 'slack_webhook',
            );

            if (oauthIntegration?.getCredentials().accessToken) {
              const result = await this.slackService.sendOAuthMessage(
                oauthIntegration.getCredentials().accessToken || '',
                channelId,
                { text },
              );
              return {
                success: result.success,
                message: result.success
                  ? 'Message sent to Slack channel'
                  : 'Failed to send Slack message',
                data: {
                  channelId,
                  messageTs: result.messageTs,
                  responseTime: result.responseTime,
                },
                metadata: { type: 'message', service: 'slack' },
              };
            }

            if (webhookIntegration?.getCredentials().webhookUrl) {
              const result = await this.slackService.sendWebhookMessage(
                webhookIntegration.getCredentials().webhookUrl!,
                { text },
              );
              return {
                success: result.success,
                message: result.success
                  ? 'Message sent to Slack via webhook (default channel)'
                  : 'Failed to send Slack message',
                data: { responseTime: result.responseTime },
                metadata: { type: 'message', service: 'slack' },
              };
            }

            return {
              success: false,
              message:
                'Slack integration has no access token or webhook URL. Reconnect Slack to send messages.',
              error: 'Missing credentials',
              metadata: { channelId, service: 'slack' },
            };
          }
          break;

        case 'get':
          if (command.entity === 'channel' && command.mention.entityId) {
            const channels = await this.slackService.listChannels(
              credentials.accessToken || '',
            );
            const channel = channels.find(
              (c: unknown) =>
                (c as ChannelInfo).id === command.mention.entityId,
            ) as ChannelInfo | undefined;

            if (channel) {
              return {
                success: true,
                message: `Found Slack channel: ${channel.name}`,
                data: { id: channel.id, name: channel.name },
                metadata: {
                  type: 'channel',
                  service: 'slack',
                },
              };
            }
          }
          break;

        default:
          // Unsupported command
          break;
      }

      return {
        success: false,
        message: `Slack integration is not fully configured. Command type '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          supportedCommands: [
            'list channels',
            'list users',
            'get channel',
            'send message',
          ],
          service: 'slack',
          status: 'not_configured',
        },
      };
    } catch (error) {
      this.logger.error('Slack command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });

      return {
        success: false,
        message: 'Failed to execute Slack command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeDiscordCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      const [oauthIntegrations, webhookIntegrations] = await Promise.all([
        this.integrationService.getUserIntegrations(userId, {
          status: 'active',
          type: 'discord_oauth' as any,
        }),
        this.integrationService.getUserIntegrations(userId, {
          status: 'active',
          type: 'discord_webhook' as any,
        }),
      ]);
      const integrations = [...oauthIntegrations, ...webhookIntegrations];

      if (integrations.length === 0) {
        return {
          success: false,
          message: 'No active Discord integration found',
          error: 'Integration not configured',
        };
      }

      const integration = integrations[0];
      const credentials = integration.getCredentials();

      const botToken = credentials.botToken || '';
      const resolveGuildId = async (): Promise<string> => {
        const gid = command.mention.entityId || credentials.guildId;
        if (gid) return gid;
        const guilds = await this.discordService.listGuilds(botToken);
        const first = (guilds as Array<{ id: string }>)[0];
        if (!first?.id) {
          throw new Error(
            'No Discord server (guild) found. Connect the bot to a server first.',
          );
        }
        return first.id;
      };

      switch (command.type) {
        case 'list':
          if (command.entity === 'guild' || command.entity === 'server') {
            const guilds = await this.discordService.listGuilds(botToken);
            return {
              success: true,
              message: `Found ${guilds.length} Discord servers`,
              data: (guilds as Array<{ id: string; name: string }>).map(
                (g) => ({ id: g.id, name: g.name }),
              ),
              metadata: {
                type: 'guilds',
                count: guilds.length,
                service: 'discord',
              },
            };
          }
          if (command.entity === 'channel') {
            const guildId = await resolveGuildId();
            const channels = await this.discordService.listGuildChannels(
              botToken,
              guildId,
            );
            return {
              success: true,
              message: `Found ${channels.length} Discord channels`,
              data: (channels as Array<{ id: string; name: string }>).map(
                (c) => ({ id: c.id, name: c.name }),
              ),
              metadata: {
                type: 'channels',
                count: channels.length,
                guildId,
                service: 'discord',
              },
            };
          }
          if (command.entity === 'user' || command.entity === 'users') {
            const guildId = await resolveGuildId();
            const members = await this.discordService.listGuildMembers(
              botToken,
              guildId,
            );
            return {
              success: true,
              message: `Found ${members.length} server members`,
              data: members.map((m) => ({
                id: m.id,
                username: m.username,
                discriminator: m.discriminator,
              })),
              metadata: {
                type: 'users',
                count: members.length,
                guildId,
                service: 'discord',
              },
            };
          }
          if (command.entity === 'role' || command.entity === 'roles') {
            const guildId = await resolveGuildId();
            const roles = await this.discordService.listRoles(
              botToken,
              guildId,
            );
            return {
              success: true,
              message: `Found ${roles.length} roles`,
              data: roles.map((r) => ({
                id: r.id,
                name: r.name,
                color: r.color,
              })),
              metadata: {
                type: 'roles',
                count: roles.length,
                guildId,
                service: 'discord',
              },
            };
          }
          break;

        case 'send':
          if (
            (command.entity === 'message' || command.entity === 'channel') &&
            command.mention.entityId
          ) {
            const channelId = command.mention.entityId;
            const content =
              command.params?.body ??
              command.params?.content ??
              command.naturalLanguage ??
              '';

            if (!content.trim()) {
              return {
                success: false,
                message: 'Message content is required to send to Discord',
                error: 'Missing message body',
                metadata: { channelId, service: 'discord' },
              };
            }

            const oauthIntegration = integrations.find(
              (i) => i.type === 'discord_oauth',
            );
            const webhookIntegration = integrations.find(
              (i) => i.type === 'discord_webhook',
            );
            const botToken =
              oauthIntegration?.getCredentials().botToken ??
              credentials.botToken;

            if (botToken) {
              const result = await this.discordService.sendBotMessage(
                botToken,
                channelId,
                {
                  content: content.substring(0, 2000),
                },
              );
              return {
                success: result.success,
                message: result.success
                  ? 'Message sent to Discord channel'
                  : 'Failed to send Discord message',
                data: {
                  channelId,
                  messageId: result.messageId,
                  responseTime: result.responseTime,
                },
                metadata: { type: 'message', service: 'discord' },
              };
            }

            if (webhookIntegration?.getCredentials().webhookUrl) {
              const result = await this.discordService.sendWebhookMessage(
                webhookIntegration.getCredentials().webhookUrl!,
                { content: content.substring(0, 2000) },
              );
              return {
                success: result.success,
                message: result.success
                  ? 'Message sent to Discord via webhook (default channel)'
                  : 'Failed to send Discord message',
                data: { responseTime: result.responseTime },
                metadata: { type: 'message', service: 'discord' },
              };
            }

            return {
              success: false,
              message:
                'Discord integration has no bot token or webhook URL. Reconnect Discord to send messages.',
              error: 'Missing credentials',
              metadata: { channelId, service: 'discord' },
            };
          }
          break;

        case 'get':
          if (command.entity === 'channel' && command.mention.entityId) {
            const guildId = await resolveGuildId();
            const channels = await this.discordService.listGuildChannels(
              botToken,
              guildId,
            );
            const channel = channels.find(
              (c: unknown) =>
                (c as ChannelInfo).id === command.mention.entityId,
            ) as ChannelInfo | undefined;

            if (channel) {
              return {
                success: true,
                message: `Found Discord channel: ${channel.name}`,
                data: { id: channel.id, name: channel.name },
                metadata: {
                  type: 'channel',
                  service: 'discord',
                },
              };
            }
          }
          break;

        case 'create':
          if (command.entity === 'channel') {
            const guildId = await resolveGuildId();
            const name =
              command.params?.name ||
              command.params?.channelName ||
              command.naturalLanguage?.trim() ||
              'new-channel';
            const result = await this.discordService.createChannel(
              botToken,
              guildId,
              { name, parentId: command.params?.parentId },
            );
            return {
              success: true,
              message: `Channel "${result.name}" created`,
              data: { id: result.id, name: result.name },
              metadata: { type: 'channel', service: 'discord' },
            };
          }
          if (command.entity === 'role') {
            const guildId = await resolveGuildId();
            const name =
              command.params?.name ||
              command.params?.roleName ||
              command.naturalLanguage?.trim() ||
              'New Role';
            const result = await this.discordService.createRole(
              botToken,
              guildId,
              {
                name,
                permissions: command.params?.permissions,
                color: command.params?.color,
              },
            );
            return {
              success: true,
              message: `Role "${result.name}" created`,
              data: { id: result.id, name: result.name },
              metadata: { type: 'role', service: 'discord' },
            };
          }
          break;

        case 'delete':
          if (command.entity === 'channel' && command.mention.entityId) {
            const channelId = command.mention.entityId;
            await this.discordService.deleteChannel(botToken, channelId);
            return {
              success: true,
              message: 'Channel deleted',
              data: { channelId },
              metadata: { type: 'channel', service: 'discord' },
            };
          }
          break;

        case 'kick':
          if (command.entity === 'user') {
            const guildId = await resolveGuildId();
            const userId =
              command.mention.entityId ||
              command.mention.subEntityId ||
              command.params?.userId;
            if (!userId) {
              return {
                success: false,
                message:
                  'User ID is required to kick. Use @discord:user:USER-ID',
                error: 'Missing params',
                metadata: { service: 'discord' },
              };
            }
            await this.discordService.kickMember(
              botToken,
              guildId,
              userId,
              command.params?.reason,
            );
            return {
              success: true,
              message: 'User kicked from server',
              data: { userId },
              metadata: { type: 'user', service: 'discord' },
            };
          }
          break;

        case 'ban':
          if (command.entity === 'user') {
            const guildId = await resolveGuildId();
            const userId =
              command.mention.entityId ||
              command.mention.subEntityId ||
              command.params?.userId;
            if (!userId) {
              return {
                success: false,
                message:
                  'User ID is required to ban. Use @discord:user:USER-ID',
                error: 'Missing params',
                metadata: { service: 'discord' },
              };
            }
            await this.discordService.banMember(botToken, guildId, userId, {
              reason: command.params?.reason,
              deleteMessageDays: command.params?.deleteMessageDays,
            });
            return {
              success: true,
              message: 'User banned from server',
              data: { userId },
              metadata: { type: 'user', service: 'discord' },
            };
          }
          break;

        case 'unban':
          if (command.entity === 'user') {
            const guildId = await resolveGuildId();
            const userId =
              command.mention.entityId ||
              command.mention.subEntityId ||
              command.params?.userId;
            if (!userId) {
              return {
                success: false,
                message:
                  'User ID is required to unban. Use @discord:user:USER-ID',
                error: 'Missing params',
                metadata: { service: 'discord' },
              };
            }
            await this.discordService.unbanMember(botToken, guildId, userId);
            return {
              success: true,
              message: 'User unbanned',
              data: { userId },
              metadata: { type: 'user', service: 'discord' },
            };
          }
          break;

        case 'assign':
          if (command.entity === 'role') {
            const guildId = await resolveGuildId();
            const userId = command.mention.entityId || command.params?.userId;
            const roleId =
              command.mention.subEntityId || command.params?.roleId;
            if (!userId || !roleId) {
              return {
                success: false,
                message:
                  'User ID and Role ID are required. Use @discord:user:USER-ID and specify roleId.',
                error: 'Missing params',
                metadata: { service: 'discord' },
              };
            }
            await this.discordService.assignRole(
              botToken,
              guildId,
              userId,
              roleId,
            );
            return {
              success: true,
              message: 'Role assigned to user',
              data: { userId, roleId },
              metadata: { type: 'role', service: 'discord' },
            };
          }
          break;

        case 'remove':
          if (command.entity === 'role') {
            const guildId = await resolveGuildId();
            const userId = command.mention.entityId || command.params?.userId;
            const roleId =
              command.mention.subEntityId || command.params?.roleId;
            if (!userId || !roleId) {
              return {
                success: false,
                message: 'User ID and Role ID are required.',
                error: 'Missing params',
                metadata: { service: 'discord' },
              };
            }
            await this.discordService.removeRole(
              botToken,
              guildId,
              userId,
              roleId,
            );
            return {
              success: true,
              message: 'Role removed from user',
              data: { userId, roleId },
              metadata: { type: 'role', service: 'discord' },
            };
          }
          break;

        default:
          break;
      }

      return {
        success: false,
        message: `Discord integration is not fully configured. Command type '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          supportedCommands: [
            'list channels',
            'list users',
            'list roles',
            'list guilds',
            'create channel',
            'delete channel',
            'send message',
            'kick user',
            'ban user',
            'unban user',
            'create role',
            'assign role',
            'remove role',
          ],
          service: 'discord',
          status: 'not_configured',
        },
      };
    } catch (error) {
      this.logger.error('Discord command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });

      return {
        success: false,
        message: 'Failed to execute Discord command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeGitHubCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      const connection = await this.githubConnectionModel
        .findOne({ userId, isActive: true })
        .select('+accessToken +refreshToken')
        .exec();

      if (!connection) {
        return {
          success: false,
          message:
            'No active GitHub connection found. Please connect your GitHub account first.',
          error: 'Integration not configured',
          metadata: { service: 'github', setupRequired: true },
        };
      }

      const conn = connection as unknown as GitHubConnectionDocument;

      switch (command.type) {
        case 'list':
          if (
            command.entity === 'repository' ||
            command.entity === 'repo' ||
            command.entity === 'general'
          ) {
            const repos = await this.gitHubService.listUserRepositories(conn);
            return {
              success: true,
              message: `Found ${repos.length} repositories`,
              data: repos.map((r) => ({
                id: r.id,
                name: r.name,
                fullName: r.fullName,
                private: r.private,
                url: r.url,
                description: r.description,
                language: r.language,
              })),
              metadata: {
                type: 'repositories',
                count: repos.length,
                service: 'github',
              },
            };
          }
          if (command.entity === 'issue') {
            const fullName =
              command.mention.entityId ||
              (command.params?.repo as string) ||
              (command.params?.owner && command.params?.repo
                ? `${command.params.owner}/${command.params.repo}`
                : null);
            let owner: string;
            let repo: string;
            if (fullName) {
              const parts = fullName.split('/').filter(Boolean);
              owner = parts[0];
              repo = parts[1] || parts[0];
            } else {
              const repos = await this.gitHubService.listUserRepositories(conn);
              if (!repos.length) {
                return {
                  success: false,
                  message:
                    'No repositories found. Create a repository first or connect GitHub.',
                  error: 'No repositories',
                  metadata: { service: 'github' },
                };
              }
              [owner, repo] = repos[0].fullName.split('/').filter(Boolean);
            }
            const issues = await this.gitHubService.listRepositoryIssues(
              conn,
              owner,
              repo,
            );
            return {
              success: true,
              message: `Found ${issues.length} issues in ${owner}/${repo}`,
              data: issues.map((i) => ({
                number: i.number,
                title: i.title,
                state: i.state,
                url: i.html_url,
                createdAt: i.created_at,
                updatedAt: i.updated_at,
              })),
              metadata: {
                type: 'issues',
                count: issues.length,
                repository: `${owner}/${repo}`,
                service: 'github',
              },
            };
          }
          if (command.entity === 'branch') {
            const fullName =
              command.mention.entityId ||
              (command.params?.repo as string) ||
              (command.params?.owner && command.params?.repo
                ? `${command.params.owner}/${command.params.repo}`
                : null);
            let owner: string;
            let repo: string;
            if (fullName) {
              const parts = fullName.split('/').filter(Boolean);
              owner = parts[0];
              repo = parts[1] || parts[0];
            } else {
              const repos = await this.gitHubService.listUserRepositories(conn);
              if (!repos.length) {
                return {
                  success: false,
                  message:
                    'No repositories found. Create a repository first or connect GitHub.',
                  error: 'No repositories',
                  metadata: { service: 'github' },
                };
              }
              [owner, repo] = repos[0].fullName.split('/').filter(Boolean);
            }
            const branches = await this.gitHubService.listRepositoryBranches(
              conn,
              owner,
              repo,
            );
            return {
              success: true,
              message: `Found ${branches.length} branches in ${owner}/${repo}`,
              data: branches.map((b) => ({
                name: b.name,
                protected: b.protected,
                sha: b.sha,
              })),
              metadata: {
                type: 'branches',
                count: branches.length,
                repository: `${owner}/${repo}`,
                service: 'github',
              },
            };
          }
          if (
            command.entity === 'pull_request' ||
            command.entity === 'pr' ||
            command.entity === 'pullrequest'
          ) {
            const fullName =
              command.mention.entityId ||
              (command.params?.repo as string) ||
              (command.params?.owner && command.params?.repo
                ? `${command.params.owner}/${command.params.repo}`
                : null);
            let owner: string;
            let repo: string;
            if (fullName) {
              const parts = fullName.split('/').filter(Boolean);
              owner = parts[0];
              repo = parts[1] || parts[0];
            } else {
              const repos = await this.gitHubService.listUserRepositories(conn);
              if (!repos.length) {
                return {
                  success: false,
                  message:
                    'No repositories found. Create a repository first or connect GitHub.',
                  error: 'No repositories',
                  metadata: { service: 'github' },
                };
              }
              [owner, repo] = repos[0].fullName.split('/').filter(Boolean);
            }
            const prs = await this.gitHubService.listRepositoryPullRequests(
              conn,
              owner,
              repo,
            );
            return {
              success: true,
              message: `Found ${prs.length} pull requests in ${owner}/${repo}`,
              data: prs.map((p) => ({
                number: p.number,
                title: p.title,
                state: p.state,
                url: p.html_url,
                createdAt: p.created_at,
                updatedAt: p.updated_at,
              })),
              metadata: {
                type: 'pull_requests',
                count: prs.length,
                repository: `${owner}/${repo}`,
                service: 'github',
              },
            };
          }
          break;

        case 'get':
          if (command.entity === 'issue') {
            const fullName =
              command.mention.entityId ||
              (command.params?.repo as string) ||
              (command.params?.owner && command.params?.repo
                ? `${command.params.owner}/${command.params.repo}`
                : null);
            const issueNumber = parseInt(
              command.mention.subEntityId ||
                command.params?.issueNumber ||
                command.params?.number,
              10,
            );
            let owner: string;
            let repo: string;
            if (fullName) {
              const parts = fullName.split('/').filter(Boolean);
              owner = parts[0];
              repo = parts[1] || parts[0];
            } else {
              const repos = await this.gitHubService.listUserRepositories(conn);
              if (!repos.length) {
                return {
                  success: false,
                  message:
                    'No repositories found. Create a repository first or connect GitHub.',
                  error: 'No repositories',
                  metadata: { service: 'github' },
                };
              }
              [owner, repo] = repos[0].fullName.split('/').filter(Boolean);
            }
            if (!Number.isFinite(issueNumber)) {
              return {
                success: false,
                message:
                  'Issue number is required. Use @github:repo:owner/repo and specify issue #.',
                error: 'Missing params',
                metadata: { service: 'github' },
              };
            }
            const issue = await this.gitHubService.getIssue(
              conn,
              owner,
              repo,
              issueNumber,
            );
            if (!issue) {
              return {
                success: false,
                message: `Issue #${issueNumber} not found in ${owner}/${repo}`,
                error: 'Not found',
                metadata: { service: 'github' },
              };
            }
            return {
              success: true,
              message: `Issue #${issue.number}: ${issue.title}`,
              data: {
                number: issue.number,
                title: issue.title,
                state: issue.state,
                url: issue.html_url,
                body: issue.body,
              },
              viewLinks: [
                {
                  label: 'Open issue',
                  url: issue.html_url,
                  type: 'document',
                },
              ],
              metadata: { type: 'issue', service: 'github' },
            };
          }
          if (
            (command.entity === 'repository' || command.entity === 'repo') &&
            command.mention.entityId
          ) {
            const fullName = command.mention.entityId;
            const [owner, repo] = fullName.split('/').filter(Boolean);
            if (!owner || !repo) {
              return {
                success: false,
                message: 'Invalid repository. Use format owner/repo.',
                error: 'Invalid entity',
                metadata: { service: 'github' },
              };
            }
            const repoData = await this.gitHubService.getRepository(
              conn,
              owner,
              repo,
            );
            return {
              success: true,
              message: `Repository: ${repoData.full_name}`,
              data: {
                id: repoData.id,
                name: repoData.name,
                fullName: repoData.full_name,
                private: repoData.private,
                url: repoData.html_url,
                description: repoData.description,
                language: repoData.language,
                defaultBranch: repoData.default_branch,
              },
              metadata: { type: 'repository', service: 'github' },
            };
          }
          if (
            (command.entity === 'pull_request' || command.entity === 'pr') &&
            command.mention.entityId
          ) {
            const fullName =
              command.mention.entityId || (command.params?.repo as string);
            const pullNumber = parseInt(
              command.mention.subEntityId ||
                command.params?.pullNumber ||
                command.params?.number,
              10,
            );
            if (!fullName || !Number.isFinite(pullNumber)) {
              return {
                success: false,
                message:
                  'Repository (owner/repo) and pull request number are required.',
                error: 'Invalid params',
                metadata: { service: 'github' },
              };
            }
            const [owner, repo] = fullName.split('/').filter(Boolean);
            const pr = await this.gitHubService.getPullRequest(
              conn,
              owner,
              repo,
              pullNumber,
            );
            return {
              success: true,
              message: `PR #${pr.number}: ${pr.title}`,
              data: {
                number: pr.number,
                title: pr.title,
                state: pr.state,
                url: pr.html_url,
                body: pr.body,
                user: pr.user,
              },
              metadata: { type: 'pull_request', service: 'github' },
            };
          }
          break;

        case 'create':
          if (command.entity === 'issue') {
            const fullName =
              command.mention.entityId ||
              (command.params?.repo as string) ||
              (command.params?.owner && command.params?.repo
                ? `${command.params.owner}/${command.params.repo}`
                : null);
            let owner: string;
            let repo: string;
            if (fullName) {
              const parts = fullName.split('/').filter(Boolean);
              owner = parts[0];
              repo = parts[1] || parts[0];
            } else {
              const repos = await this.gitHubService.listUserRepositories(conn);
              if (!repos.length) {
                return {
                  success: false,
                  message:
                    'No repositories found. Create a repository first or connect GitHub.',
                  error: 'No repositories',
                  metadata: { service: 'github' },
                };
              }
              [owner, repo] = repos[0].fullName.split('/').filter(Boolean);
            }
            const title =
              command.params?.title ||
              command.params?.subject ||
              command.naturalLanguage?.trim() ||
              'Untitled issue';
            const body =
              command.params?.body || command.params?.description || '';
            const result = await this.gitHubService.createIssue(
              conn,
              owner,
              repo,
              title,
              body,
            );
            return {
              success: true,
              message: `Issue #${result.number} created: ${result.title}`,
              data: {
                number: result.number,
                title: result.title,
                url: result.html_url,
              },
              viewLinks: [
                {
                  label: 'Open issue',
                  url: result.html_url,
                  type: 'document',
                },
              ],
              metadata: { type: 'issue', service: 'github' },
            };
          }
          if (command.entity === 'branch') {
            const fullName =
              command.mention.entityId ||
              (command.params?.repo as string) ||
              (command.params?.owner && command.params?.repo
                ? `${command.params.owner}/${command.params.repo}`
                : null);
            let owner: string;
            let repo: string;
            if (fullName) {
              const parts = fullName.split('/').filter(Boolean);
              owner = parts[0];
              repo = parts[1] || parts[0];
            } else {
              const repos = await this.gitHubService.listUserRepositories(conn);
              if (!repos.length) {
                return {
                  success: false,
                  message:
                    'No repositories found. Create a repository first or connect GitHub.',
                  error: 'No repositories',
                  metadata: { service: 'github' },
                };
              }
              [owner, repo] = repos[0].fullName.split('/').filter(Boolean);
            }
            const branchName =
              command.params?.branchName || command.params?.name || '';
            const baseBranch =
              command.params?.baseBranch || command.params?.base || 'main';
            if (!branchName.trim()) {
              return {
                success: false,
                message:
                  'Branch name is required. Specify branchName or name in the message.',
                error: 'Missing params',
                metadata: { service: 'github' },
              };
            }
            const ref = await this.gitHubService.createBranch(conn, {
              owner,
              repo,
              branchName: branchName.trim(),
              baseBranch,
            });
            return {
              success: true,
              message: `Branch ${branchName} created`,
              data: { ref, branchName: branchName.trim() },
              metadata: { type: 'branch', service: 'github' },
            };
          }
          if (command.entity === 'pull_request' || command.entity === 'pr') {
            const owner =
              (command.mention.entityId as string)?.split('/')[0] ||
              command.params?.owner;
            const repo =
              (command.mention.entityId as string)?.split('/')[1] ||
              command.params?.repo;
            const title =
              command.params?.title || command.params?.subject || 'Untitled PR';
            const body = command.params?.body || command.params?.description;
            const head = command.params?.head || command.params?.branch;
            const base = command.params?.base || 'main';
            if (!owner || !repo || !head) {
              return {
                success: false,
                message:
                  'Owner, repo, and head branch (or head ref) are required to create a pull request.',
                error: 'Missing params',
                metadata: { service: 'github' },
              };
            }
            const result = await this.gitHubService.createPullRequest(conn, {
              owner,
              repo,
              title,
              body,
              head,
              base,
            });
            return {
              success: true,
              message: `Pull request #${result.number} created`,
              data: {
                number: result.number,
                url: result.html_url,
              },
              viewLinks: [
                { label: 'Open PR', url: result.html_url, type: 'document' },
              ],
              metadata: { type: 'pull_request', service: 'github' },
            };
          }
          break;

        case 'add':
          if (command.entity === 'comment') {
            const fullName =
              (command.mention.entityId as string) || command.params?.repo;
            const pullNumber = parseInt(
              command.mention.subEntityId ||
                command.params?.pullNumber ||
                command.params?.number,
              10,
            );
            const body =
              command.params?.comment ||
              command.params?.body ||
              command.params?.content;
            if (!fullName || !Number.isFinite(pullNumber) || !body?.trim()) {
              return {
                success: false,
                message:
                  'Repository (owner/repo), pull request number, and comment body are required.',
                error: 'Missing params',
                metadata: { service: 'github' },
              };
            }
            const [owner, repo] = fullName.split('/').filter(Boolean);
            await this.gitHubService.addPRComment(
              conn,
              owner,
              repo,
              pullNumber,
              body.trim(),
            );
            return {
              success: true,
              message: 'Comment added to pull request',
              metadata: { type: 'comment', service: 'github' },
            };
          }
          break;

        default:
          break;
      }

      return {
        success: false,
        message: `GitHub integration is not fully configured. Command '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          service: 'github',
          status: 'not_configured',
          supportedCommands: [
            'list repositories',
            'list issues',
            'list branches',
            'list pull requests',
            'get repository',
            'get issue',
            'get pull request',
            'create issue',
            'create branch',
            'create pull request',
            'add comment to PR',
          ],
        },
      };
    } catch (error) {
      this.logger.error('GitHub command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });
      return {
        success: false,
        message: 'Failed to execute GitHub command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeGoogleCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      const connection = await this.googleConnectionModel
        .findOne({ userId })
        .select(
          '+encryptedAccessToken +encryptedRefreshToken +accessToken +refreshToken',
        )
        .exec();

      if (!connection) {
        return {
          success: false,
          message:
            'No active Google connection found. Please connect your Google account first.',
          error: 'Integration not configured',
          metadata: { service: 'google', setupRequired: true },
        };
      }

      const conn = connection as unknown as GoogleConnectionWithTokens;

      switch (command.type) {
        case 'list':
          if (
            command.entity === 'document' ||
            command.entity === 'docs' ||
            command.entity === 'general'
          ) {
            const docs = await this.googleService.listDocuments(conn, 20);
            return {
              success: true,
              message: `Found ${docs.length} documents`,
              data: docs.map((d) => ({
                id: d.id,
                name: d.name,
                createdTime: d.createdTime,
                modifiedTime: d.modifiedTime,
                webViewLink: d.webViewLink,
              })),
              metadata: {
                type: 'documents',
                count: docs.length,
                service: 'google',
              },
            };
          }
          if (command.entity === 'spreadsheet' || command.entity === 'sheets') {
            const sheets = await this.googleService.listSpreadsheets(conn, 20);
            return {
              success: true,
              message: `Found ${sheets.length} spreadsheets`,
              data: sheets.map((s) => ({
                id: s.id,
                name: s.name,
                createdTime: s.createdTime,
                modifiedTime: s.modifiedTime,
                webViewLink: s.webViewLink,
              })),
              metadata: {
                type: 'spreadsheets',
                count: sheets.length,
                service: 'google',
              },
            };
          }
          if (
            command.entity === 'file' ||
            command.entity === 'drive' ||
            command.entity === 'general'
          ) {
            const query = command.params?.query as string | undefined;
            const { files, nextPageToken } =
              await this.googleService.listDriveFiles(conn, {
                pageSize: 20,
                query,
              });
            return {
              success: true,
              message: `Found ${files.length} files`,
              data: files.map((f) => ({
                id: f.id,
                name: f.name,
                mimeType: f.mimeType,
                webViewLink: f.webViewLink,
                size: f.size,
              })),
              metadata: {
                type: 'files',
                count: files.length,
                service: 'google',
                ...(nextPageToken && { nextPageToken }),
              },
            };
          }
          break;

        case 'get':
          if (
            (command.entity === 'file' ||
              command.entity === 'document' ||
              command.entity === 'docs' ||
              command.entity === 'spreadsheet' ||
              command.entity === 'sheets') &&
            (command.mention.entityId || command.params?.fileId)
          ) {
            const fileId =
              (command.mention.entityId as string) ||
              (command.params?.fileId as string) ||
              this.googleService.extractFileIdFromLink(
                (command.params?.link as string) || '',
              );
            if (!fileId) {
              return {
                success: false,
                message: 'File ID or link is required.',
                error: 'Missing params',
                metadata: { service: 'google' },
              };
            }
            const includeContent = command.params?.includeContent === true;
            const connId =
              (
                connection as { _id?: { toString: () => string } }
              )._id?.toString() ?? '';

            if (
              (command.entity === 'spreadsheet' ||
                command.entity === 'sheets') &&
              includeContent
            ) {
              const range =
                (command.params?.range as string) || 'Sheet1!A1:Z100';
              const content = await this.googleService.getSpreadsheetContent(
                connId,
                fileId,
                range,
              );
              return {
                success: true,
                message: content?.length
                  ? `Spreadsheet content (${content.length} rows)`
                  : 'Spreadsheet is empty',
                data: { values: content ?? [], spreadsheetId: fileId },
                metadata: { type: 'spreadsheet', service: 'google' },
              };
            }
            if (
              (command.entity === 'document' || command.entity === 'docs') &&
              includeContent
            ) {
              const docResult = await this.googleService.getDocumentContent(
                connId,
                fileId,
              );
              return {
                success: true,
                message: docResult.success
                  ? 'Document content retrieved'
                  : 'Could not retrieve document content',
                data: {
                  content: docResult.content,
                  documentId: fileId,
                },
                metadata: { type: 'document', service: 'google' },
              };
            }

            const file = await this.googleService.getDriveFile(conn, fileId);
            return {
              success: true,
              message: `File: ${file.name}`,
              data: {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                webViewLink: file.webViewLink,
                size: file.size,
              },
              viewLinks: file.webViewLink
                ? [
                    {
                      label: 'Open',
                      url: file.webViewLink,
                      type: 'document',
                    },
                  ]
                : undefined,
              metadata: { type: 'file', service: 'google' },
            };
          }
          break;

        case 'create':
          if (command.entity === 'document' || command.entity === 'docs') {
            const title =
              (command.params?.title as string) ||
              (command.params?.subject as string) ||
              'Untitled document';
            const result = await this.googleService.createDocument(conn, title);
            return {
              success: true,
              message: `Document "${title}" created`,
              data: {
                documentId: result.documentId,
                documentUrl: result.documentUrl,
              },
              viewLinks: [
                {
                  label: 'Open document',
                  url: result.documentUrl,
                  type: 'document',
                },
              ],
              metadata: { type: 'document', service: 'google' },
            };
          }
          if (command.entity === 'spreadsheet' || command.entity === 'sheets') {
            const title =
              (command.params?.title as string) ||
              (command.params?.subject as string) ||
              'Untitled spreadsheet';
            const data = command.params?.data as string[][] | undefined;
            const result = await this.googleService.createSpreadsheet(
              conn,
              title,
              data,
            );
            return {
              success: true,
              message: `Spreadsheet "${title}" created`,
              data: {
                spreadsheetId: result.spreadsheetId,
                spreadsheetUrl: result.spreadsheetUrl,
              },
              viewLinks: [
                {
                  label: 'Open spreadsheet',
                  url: result.spreadsheetUrl,
                  type: 'spreadsheet',
                },
              ],
              metadata: { type: 'spreadsheet', service: 'google' },
            };
          }
          if (command.entity === 'folder') {
            const name =
              (command.params?.name as string) ||
              (command.params?.title as string) ||
              'New folder';
            const parentId = command.params?.parentId as string | undefined;
            const result = await this.googleService.createFolder(
              conn,
              name,
              parentId,
            );
            return {
              success: true,
              message: `Folder "${name}" created`,
              data: {
                id: result.id,
                name: result.name,
                webViewLink: result.webViewLink,
              },
              viewLinks: result.webViewLink
                ? [
                    {
                      label: 'Open folder',
                      url: result.webViewLink,
                      type: 'file',
                    },
                  ]
                : undefined,
              metadata: { type: 'folder', service: 'google' },
            };
          }
          if (
            command.entity === 'report' ||
            (command.entity === 'document' &&
              command.mention.originalMention?.includes('report'))
          ) {
            const startDate = command.params?.startDate
              ? new Date(command.params.startDate as string)
              : undefined;
            const endDate = command.params?.endDate
              ? new Date(command.params.endDate as string)
              : undefined;
            const projectId = command.params?.projectId as string | undefined;
            const result =
              await this.googleExportIntegrationService.createCostReportInDocs(
                conn,
                {
                  userId,
                  connectionId: (connection as any)._id?.toString() ?? '',
                  startDate,
                  endDate,
                  projectId,
                  includeTopModels: true,
                  includeRecommendations: true,
                },
              );
            return {
              success: true,
              message: 'Cost report created',
              data: {
                documentId: result.documentId,
                documentUrl: result.documentUrl,
              },
              viewLinks: [
                {
                  label: 'Open report',
                  url: result.documentUrl,
                  type: 'document',
                },
              ],
              metadata: { type: 'report', service: 'google' },
            };
          }
          break;

        case 'update':
          if (command.entity === 'file') {
            const fileId =
              (command.mention.entityId as string) ||
              (command.params?.fileId as string) ||
              this.googleService.extractFileIdFromLink(
                (command.params?.link as string) || '',
              );
            if (!fileId) {
              return {
                success: false,
                message: 'File ID or link is required for sharing.',
                error: 'Missing params',
                metadata: { service: 'google' },
              };
            }
            const role = ((command.params?.role as string) || 'writer') as
              | 'reader'
              | 'writer'
              | 'commenter';
            const shareResult = await this.googleService.shareFileWithUser(
              conn,
              fileId,
              role,
            );
            return {
              success: true,
              message: 'File shared successfully',
              data: { permissionId: shareResult.permissionId },
              metadata: { type: 'file', service: 'google' },
            };
          }
          if (command.entity === 'spreadsheet' || command.entity === 'sheets') {
            const spreadsheetId =
              (command.mention.entityId as string) ||
              (command.params?.spreadsheetId as string);
            const range = (command.params?.range as string) || 'Sheet1!A1';
            const values = command.params?.values as string[][];
            if (!spreadsheetId || !values?.length) {
              return {
                success: false,
                message: 'Spreadsheet ID and values are required for update.',
                error: 'Missing params',
                metadata: { service: 'google' },
              };
            }
            const result = await this.googleService.updateSpreadsheet(
              conn,
              spreadsheetId,
              range,
              values,
            );
            return {
              success: true,
              message: `Updated ${result.updatedCells} cells`,
              data: { updatedCells: result.updatedCells },
              metadata: { type: 'spreadsheet', service: 'google' },
            };
          }
          break;

        case 'add':
          if (command.entity === 'spreadsheet' || command.entity === 'sheets') {
            const spreadsheetId =
              (command.mention.entityId as string) ||
              (command.params?.spreadsheetId as string);
            const values = command.params?.values as string[][];
            const sheetName = (command.params?.sheetName as string) || 'Sheet1';
            if (!spreadsheetId || !values?.length) {
              return {
                success: false,
                message:
                  'Spreadsheet ID and values are required to append rows.',
                error: 'Missing params',
                metadata: { service: 'google' },
              };
            }
            const result = await this.googleService.appendToSpreadsheet(
              conn,
              spreadsheetId,
              values,
              sheetName,
            );
            return {
              success: true,
              message: `Appended ${result.updatedRows} row(s)`,
              data: { updatedRows: result.updatedRows },
              metadata: { type: 'spreadsheet', service: 'google' },
            };
          }
          break;

        case 'export':
          if (command.entity === 'spreadsheet' || command.entity === 'sheets') {
            const startDate = command.params?.startDate
              ? new Date(command.params.startDate as string)
              : undefined;
            const endDate = command.params?.endDate
              ? new Date(command.params.endDate as string)
              : undefined;
            const projectId = command.params?.projectId as string | undefined;
            const result =
              await this.googleExportIntegrationService.exportCostDataToSheets(
                conn,
                {
                  userId,
                  connectionId: (connection as any)._id?.toString() ?? '',
                  startDate,
                  endDate,
                  projectId,
                },
              );
            return {
              success: true,
              message: 'Cost data exported to spreadsheet',
              data: {
                spreadsheetId: result.spreadsheetId,
                spreadsheetUrl: result.spreadsheetUrl,
              },
              viewLinks: [
                {
                  label: 'Open spreadsheet',
                  url: result.spreadsheetUrl,
                  type: 'spreadsheet',
                },
              ],
              metadata: { type: 'spreadsheet', service: 'google' },
            };
          }
          break;

        default:
          break;
      }

      const gmailCalendarEnabled = this.configService.get<string>(
        'ENABLE_GOOGLE_GMAIL_CALENDAR',
        'false',
      ) === 'true';

      if (command.entity === 'email') {
        return {
          success: false,
          message: gmailCalendarEnabled
            ? 'Gmail send is not available. Use the Gmail app or mail.google.com for now.'
            : 'Gmail send is not enabled for this workspace. Use the Gmail app or mail.google.com.',
          error: 'Feature not available',
          metadata: {
            service: 'google',
          },
        };
      }
      if (command.entity === 'calendar' || command.entity === 'event') {
        return {
          success: false,
          message: gmailCalendarEnabled
            ? 'Google Calendar list is not available. Use calendar.google.com for now.'
            : 'Google Calendar list is not enabled for this workspace. Use calendar.google.com.',
          error: 'Feature not available',
          metadata: {
            service: 'google',
          },
        };
      }

      return {
        success: false,
        message: `Google integration is not fully configured. Command '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          service: 'google',
          status: 'not_configured',
          supportedCommands: [
            'list documents',
            'list spreadsheets',
            'list files (Drive)',
            'get file',
            'get spreadsheet content (includeContent)',
            'get document content (includeContent)',
            'create document',
            'create spreadsheet',
            'create folder',
            'create cost report (docs:report)',
            'update file (share)',
            'update spreadsheet',
            'append to spreadsheet',
            'export cost data to sheets',
          ],
        },
      };
    } catch (error) {
      this.logger.error('Google command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });
      return {
        success: false,
        message: 'Failed to execute Google command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeVercelCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      // Use VercelService.listConnections - same logic as GET /vercel/connections
      // Ensures consistency and supports pending_verification connections
      const connections = await this.vercelService.listConnections(userId);
      const connection = connections.length > 0 ? connections[0] : null;

      if (!connection) {
        this.logger.debug('No Vercel connection found for user', {
          userId,
          connectionsCount: 0,
        });
        return {
          success: false,
          message:
            'No active Vercel connection found. Please connect your Vercel account first.',
          error: 'Integration not configured',
          metadata: { service: 'vercel', setupRequired: true },
        };
      }

      const connectionId = connection._id.toString();

      switch (command.type) {
        case 'list':
          if (command.entity === 'project' || command.entity === 'general') {
            const refresh = command.params?.refresh === true;
            const projects = await this.vercelService.getProjects(
              connectionId,
              refresh,
            );
            return {
              success: true,
              message: `Found ${projects.length} projects`,
              data: projects.map((p) => ({
                id: p.id,
                name: p.name,
                framework: p.framework,
                latestDeployment: p.latestDeployment,
                targets: p.targets,
              })),
              metadata: {
                type: 'projects',
                count: projects.length,
                service: 'vercel',
              },
            };
          }
          if (command.entity === 'deployment') {
            const projectId =
              command.mention.entityId || command.params?.projectId;
            if (projectId) {
              const limit = Math.min(Number(command.params?.limit) || 20, 100);
              const deployments = await this.vercelService.getDeployments(
                connectionId,
                projectId as string,
                limit,
              );
              return {
                success: true,
                message: `Found ${deployments.length} deployments`,
                data: deployments.map((d) => ({
                  uid: d.uid,
                  name: d.name,
                  url: d.url,
                  state: d.state,
                  createdAt: d.createdAt,
                  target: d.target,
                })),
                metadata: {
                  type: 'deployments',
                  count: deployments.length,
                  service: 'vercel',
                },
              };
            }
            const refresh = command.params?.refresh === true;
            const projects = await this.vercelService.getProjects(
              connectionId,
              refresh,
            );
            return {
              success: true,
              message: `Found ${projects.length} projects`,
              data: projects.map((p) => ({
                id: p.id,
                name: p.name,
                framework: p.framework,
                latestDeployment: p.latestDeployment,
                targets: p.targets,
              })),
              metadata: {
                type: 'projects',
                count: projects.length,
                service: 'vercel',
              },
            };
          }
          if (command.entity === 'domain') {
            const projectId =
              command.mention.entityId || command.params?.projectId;
            if (!projectId) {
              return {
                success: false,
                message: 'Project ID is required to list domains.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            const domains = await this.vercelService.getDomains(
              connectionId,
              projectId,
            );
            return {
              success: true,
              message: `Found ${domains.length} domains`,
              data: domains.map((d) => ({
                name: d.name,
                verified: d.verified,
                apexName: d.apexName,
              })),
              metadata: {
                type: 'domains',
                count: domains.length,
                projectId,
                service: 'vercel',
              },
            };
          }
          if (command.entity === 'env') {
            const projectId =
              command.mention.entityId || command.params?.projectId;
            if (!projectId) {
              return {
                success: false,
                message:
                  'Project ID is required to list environment variables.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            const envVars = await this.vercelService.getEnvVars(
              connectionId,
              projectId,
            );
            return {
              success: true,
              message: `Found ${envVars.length} environment variables`,
              data: envVars.map((e) => ({
                key: e.key,
                type: e.type,
                target: e.target,
              })),
              metadata: {
                type: 'env',
                count: envVars.length,
                projectId,
                service: 'vercel',
              },
            };
          }
          break;

        case 'get':
          if (
            command.entity === 'project' &&
            (command.mention.entityId || command.params?.projectId)
          ) {
            const projectId =
              (command.mention.entityId as string) ||
              (command.params?.projectId as string);
            const project = await this.vercelService.getProject(
              connectionId,
              projectId,
            );
            return {
              success: true,
              message: `Project: ${project.name}`,
              data: {
                id: project.id,
                name: project.name,
                framework: project.framework,
                latestDeployment: project.latestDeployment,
                targets: project.targets,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
              },
              metadata: { type: 'project', service: 'vercel' },
            };
          }
          if (
            command.entity === 'deployment' &&
            (command.mention.entityId || command.params?.projectId)
          ) {
            const projectId =
              (command.mention.entityId as string) ||
              (command.params?.projectId as string);
            const limit = Math.min(Number(command.params?.limit) || 20, 100);
            const deployments = await this.vercelService.getDeployments(
              connectionId,
              projectId,
              limit,
            );
            return {
              success: true,
              message: `Found ${deployments.length} deployments`,
              data: deployments.map((d) => ({
                uid: d.uid,
                name: d.name,
                url: d.url,
                state: d.state,
                createdAt: d.createdAt,
                target: d.target,
              })),
              metadata: {
                type: 'deployments',
                count: deployments.length,
                service: 'vercel',
              },
            };
          }
          if (command.entity === 'logs') {
            const deploymentId =
              command.mention.entityId ||
              command.params?.deploymentId ||
              command.params?.deployment;
            if (!deploymentId) {
              return {
                success: false,
                message:
                  'Deployment ID is required. Use @vercel:deployment:DEPLOYMENT-ID or specify deploymentId.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            const logs = await this.vercelService.getDeploymentLogs(
              connectionId,
              deploymentId as string,
            );
            return {
              success: true,
              message: `Retrieved ${logs.length} log entries`,
              data: logs,
              metadata: {
                type: 'logs',
                count: logs.length,
                deploymentId,
                service: 'vercel',
              },
            };
          }
          break;

        case 'add':
          if (command.entity === 'domain') {
            const projectId =
              command.mention.entityId || command.params?.projectId;
            const domain = command.params?.domain || command.params?.name;
            if (!projectId || !domain?.trim()) {
              return {
                success: false,
                message: 'Project ID and domain are required.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            const newDomain = await this.vercelService.addDomain(
              connectionId,
              projectId,
              domain.trim(),
            );
            return {
              success: true,
              message: `Domain ${domain} added`,
              data: {
                name: newDomain.name,
                verified: newDomain.verified,
              },
              metadata: { type: 'domain', service: 'vercel' },
            };
          }
          break;

        case 'create':
          if (command.entity === 'deployment') {
            const projectId =
              command.mention.entityId || command.params?.projectId;
            if (!projectId) {
              return {
                success: false,
                message: 'Project ID is required to trigger a deployment.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            const deployment = await this.vercelService.triggerDeployment(
              connectionId,
              projectId,
              {
                target:
                  (command.params?.target as 'production' | 'preview') ||
                  'preview',
              },
            );
            return {
              success: true,
              message: `Deployment triggered: ${deployment.state}`,
              data: {
                uid: deployment.uid,
                url: deployment.url,
                state: deployment.state,
                createdAt: deployment.createdAt,
              },
              metadata: { type: 'deployment', service: 'vercel' },
            };
          }
          if (command.entity === 'env') {
            const projectId =
              command.mention.entityId || command.params?.projectId;
            const key = command.params?.key || command.params?.name;
            const value = command.params?.value || command.params?.val;
            if (!projectId || !key?.trim() || value === undefined) {
              return {
                success: false,
                message:
                  'Project ID, key, and value are required to set an environment variable.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            const envVar = await this.vercelService.setEnvVar(
              connectionId,
              projectId,
              key.trim(),
              String(value),
              command.params?.target as
                | Array<'production' | 'preview' | 'development'>
                | undefined,
              (command.params?.type as 'plain' | 'secret') || 'plain',
            );
            return {
              success: true,
              message: `Environment variable ${key} set`,
              data: { key: envVar.key, type: envVar.type },
              metadata: { type: 'env', service: 'vercel' },
            };
          }
          break;

        case 'update':
          if (command.entity === 'deployment') {
            const deploymentId =
              command.mention.entityId ||
              command.params?.deploymentId ||
              command.params?.deployment;
            const action =
              command.params?.action || command.naturalLanguage?.toLowerCase();
            const isPromote =
              action.includes('promote') || command.params?.promote === true;
            const isRollback =
              action.includes('rollback') || command.params?.rollback === true;

            if (isPromote && deploymentId) {
              const promoted = await this.vercelService.promoteDeployment(
                connectionId,
                deploymentId,
              );
              return {
                success: true,
                message: 'Deployment promoted to production',
                data: {
                  uid: promoted.uid,
                  url: promoted.url,
                  state: promoted.state,
                },
                metadata: { type: 'deployment', service: 'vercel' },
              };
            }
            if (isRollback && deploymentId) {
              const projectId =
                command.mention.subEntityId || command.params?.projectId;
              if (!projectId) {
                return {
                  success: false,
                  message:
                    'Project ID is required for rollback. Specify projectId.',
                  error: 'Missing params',
                  metadata: { service: 'vercel' },
                };
              }
              const rolled = await this.vercelService.rollbackDeployment(
                connectionId,
                projectId,
                deploymentId,
              );
              return {
                success: true,
                message: 'Deployment rolled back',
                data: {
                  uid: rolled.uid,
                  url: rolled.url,
                  state: rolled.state,
                },
                metadata: { type: 'deployment', service: 'vercel' },
              };
            }
          }
          break;

        case 'delete':
          if (command.entity === 'deployment') {
            const deploymentId =
              command.mention.entityId ||
              command.params?.deploymentId ||
              command.params?.deployment;
            if (!deploymentId) {
              return {
                success: false,
                message: 'Deployment ID is required to cancel.',
                error: 'Missing params',
                metadata: { service: 'vercel' },
              };
            }
            await this.vercelService.cancelDeployment(
              connectionId,
              deploymentId,
            );
            return {
              success: true,
              message: 'Deployment cancelled',
              data: { deploymentId },
              metadata: { type: 'deployment', service: 'vercel' },
            };
          }
          break;

        default:
          break;
      }

      return {
        success: false,
        message: `Vercel integration is not fully configured. Command '${command.type}' for entity '${command.entity}' is not available.`,
        error: 'Integration not configured',
        metadata: {
          service: 'vercel',
          status: 'not_configured',
          supportedCommands: [
            'list projects',
            'list deployments',
            'list domains',
            'list env',
            'get project',
            'get deployments',
            'get logs',
            'create deployment (deploy)',
            'add domain',
            'set env',
            'promote deployment',
            'rollback deployment',
            'cancel deployment',
          ],
        },
      };
    } catch (error) {
      this.logger.error('Vercel command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });
      return {
        success: false,
        message: 'Failed to execute Vercel command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async executeAWSCommand(
    userId: string,
    command: IntegrationCommand,
  ): Promise<IntegrationCommandResult> {
    try {
      // Convert IntegrationCommand to AWSChatRequest format
      const awsRequest = {
        userId,
        action: this.mapAWSCommandToAction(command),
        params: command.params || {},
        connectionId: command.mention.entityId, // If a specific connection is mentioned
      };

      // Delegate to AWS Chat Agent Service
      const awsResult = await this.awsChatAgent.processCommand(awsRequest);

      return {
        success: awsResult.success,
        message: awsResult.message,
        data: awsResult.data,
        error: awsResult.error,
        metadata: {
          service: 'aws',
          requiresApproval: awsResult.requiresApproval,
          approvalToken: awsResult.approvalToken,
        },
      };
    } catch (error) {
      this.logger.error('AWS command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        command: command.type,
        entity: command.entity,
      });
      return {
        success: false,
        message: 'Failed to execute AWS command',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Map IntegrationCommand to AWS action
   */
  private mapAWSCommandToAction(command: IntegrationCommand): string {
    const { type, entity } = command;
    const action = (command.params?.action as string) || '';

    const actionMap: Record<string, string> = {
      costs: 'costs',
      cost_breakdown: 'cost_breakdown',
      cost_forecast: 'cost_forecast',
      anomalies: 'cost_anomalies',
      cost_anomalies: 'cost_anomalies',
      list_ec2: 'list_ec2',
      ec2_costs: 'cost_breakdown',
      stop_ec2: 'stop_ec2',
      start_ec2: 'start_ec2',
      list_s3: 'list_s3',
      s3_costs: 'cost_breakdown',
      list_rds: 'list_rds',
      rds_costs: 'cost_breakdown',
      list_lambda: 'list_lambda',
      lambda_costs: 'cost_breakdown',
      optimize: 'optimize',
      savings: 'optimize',
      reserved: 'optimize',
      spot: 'optimize',
      idle_instances: 'idle_instances',
      status: 'status',
    };

    if (action && actionMap[action]) {
      return actionMap[action];
    }

    switch (type) {
      case 'list':
        if (entity === 'ec2') return 'list_ec2';
        if (entity === 'rds') return 'list_rds';
        if (entity === 'lambda') return 'list_lambda';
        if (entity === 's3') return 'list_s3';
        break;
      case 'update':
        if (entity === 'ec2') {
          if (action.includes('stop')) return 'stop_ec2';
          if (action.includes('start')) return 'start_ec2';
        }
        break;
      case 'create':
        if (entity === 'ec2') return 'create_ec2';
        if (entity === 'rds') return 'create_rds';
        if (entity === 'lambda') return 'create_lambda';
        if (entity === 's3') return 'create_s3';
        if (entity === 'dynamodb') return 'create_dynamodb';
        if (entity === 'ecs') return 'create_ecs';
        break;
    }

    if (type === 'status') return 'status';
    if (type === 'optimize') return 'optimize';

    if (
      entity === 'cost' ||
      entity === 'ec2' ||
      entity === 's3' ||
      entity === 'rds' ||
      entity === 'lambda'
    ) {
      if (command.params?.forecast || action.includes('forecast'))
        return 'cost_forecast';
      if (command.params?.anomalies || action.includes('anomal'))
        return 'cost_anomalies';
      if (action.includes('cost') || entity !== 'cost') return 'cost_breakdown';
      return 'costs';
    }

    return 'status';
  }

  /**
   * Detect MongoDB intent from message
   * Only triggers if @mongodb is explicitly mentioned
   */
  static detectMongoDBIntent(message: string): boolean {
    // Only check for explicit @mongodb mention
    // Don't trigger on generic keywords to avoid false positives
    return /@mongodb[:\s]/i.test(message);
  }

  /**
   * Parse MongoDB command from message
   */
  static parseMongoDBCommand(message: string): ParsedMention | null {
    // Check for MongoDB mention using a simple regex pattern
    const mongoMentionMatch = message.match(/@mongodb[:\s]?([^\s]*)/i);

    if (!mongoMentionMatch && !this.detectMongoDBIntent(message)) {
      return null;
    }

    // Extract the command after @mongodb
    const commandText =
      mongoMentionMatch?.[1] || message.replace(/@mongodb[:\s]?/i, '').trim();

    return {
      integration: 'mongodb',
      entityType: 'query',
      entityId: commandText,
      originalMention: mongoMentionMatch?.[0] || '@mongodb',
    };
  }

  /**
   * Manual parsing fallback (expanded from Express version)
   * This method provides detailed command parsing when AI parsing fails
   */
  private static parseCommandManual(
    message: string,
    mentions: ParsedMention[],
  ): IntegrationCommand | null {
    if (mentions.length === 0) {
      return null;
    }

    const mention = mentions[0]; // Use first mention
    let lowerMessage = message.toLowerCase().trim();

    // Extract command from mention pattern (e.g., @linear:list-issues -> list-issues)
    // Pattern: @integration:command-with-dashes
    const mentionMatch = message.match(
      new RegExp(`@${mention.integration}(?::([a-z]+(?:-[a-z]+)*))?`, 'i'),
    );
    let extractedCommand = '';
    if (mentionMatch && mentionMatch[1]) {
      extractedCommand = mentionMatch[1].toLowerCase();
      // If we extracted a command, add it to the message context for parsing
      if (
        extractedCommand &&
        !lowerMessage.includes(extractedCommand.replace(/-/g, ' '))
      ) {
        // Command was in the mention but not in the full message, add it for parsing
        // Replace dashes with spaces so "list-issues" becomes "list issues" for parsing
        lowerMessage = `${extractedCommand.replace(/-/g, ' ')} ${lowerMessage}`;
      }
    }

    // Extract command type and parameters
    let commandType: IntegrationCommand['type'] | null = null;
    let entity = '';
    const params: Record<string, any> = {};

    // Also check the extractedCommand directly for dashed commands
    if (extractedCommand) {
      if (extractedCommand.startsWith('list-')) {
        commandType = 'list';
        if (extractedCommand === 'list-issues') {
          entity = 'issue';
        } else if (extractedCommand === 'list-projects') {
          entity = 'project';
        } else if (extractedCommand === 'list-channels') {
          entity = 'channel';
        } else if (extractedCommand === 'list-users') {
          entity = 'user';
        } else if (extractedCommand === 'list-teams') {
          entity = 'team';
        } else if (extractedCommand === 'list-workflows') {
          entity = 'workflow';
        } else if (extractedCommand === 'list-tags') {
          entity = 'tag';
        } else if (extractedCommand === 'list-iterations') {
          entity = 'iteration';
        } else if (extractedCommand === 'list-epics') {
          entity = 'epic';
        } else if (
          extractedCommand === 'list-prs' ||
          extractedCommand === 'list-pull-requests'
        ) {
          entity = 'pullrequest';
        } else if (extractedCommand === 'list-branches') {
          entity = 'branch';
        }
      } else if (extractedCommand.startsWith('create-')) {
        commandType = 'create';
        if (extractedCommand === 'create-issue') {
          entity = 'issue';
        } else if (
          extractedCommand === 'create-pr' ||
          extractedCommand === 'create-pull-request'
        ) {
          entity = 'pullrequest';
        }
      } else if (extractedCommand.startsWith('get-')) {
        commandType = 'get';
        if (extractedCommand === 'get-issue') {
          entity = 'issue';
        }
      } else if (extractedCommand.startsWith('update-')) {
        commandType = 'update';
        if (extractedCommand === 'update-issue') {
          entity = 'issue';
        }
      } else if (extractedCommand === 'add-comment') {
        commandType = 'add';
        entity = 'comment';
      } else if (extractedCommand === 'send-message') {
        commandType = 'send';
        entity = 'message';
      }

      // If we successfully parsed from extractedCommand, return the result
      if (commandType && entity) {
        return {
          type: commandType,
          entity,
          mention,
          params,
          naturalLanguage: message,
        };
      }
    }

    // Extract title and description from the message more intelligently
    // Look for patterns like "create issue with title 'X' and description 'Y'"
    // or "create issue titled 'X' description 'Y'"
    const titlePatterns = [
      /(?:title|summary|subject|titled?)[: ]+['"]([^'"]+)['"]/i,
      /(?:title|summary|subject|titled?)[: ]+(\S+(?:\s+\S+)*?)(?:\s+and|\s+description|$)/i,
      /(?:with\s+)?title\s+['"]([^'"]+)['"]/i,
      /(?:create|make|add)\s+(?:an?\s+)?(?:issue|task|story|bug)\s+(?:called|titled|named|with\s+title)\s+['"]([^'"]+)['"]/i,
      /(?:create|make|add)\s+(?:an?\s+)?(?:issue|task|story|bug)\s+['"]([^'"]+)['"]/i,
    ];

    const descriptionPatterns = [
      /(?:description|desc|body|content|details?)[: ]+['"]([^'"]+)['"]/i,
      /(?:description|desc|body|content|details?)[: ]+(\S+(?:\s+\S+)*?)(?:\s+and|\s+title|$)/i,
      /(?:with\s+)?description\s+['"]([^'"]+)['"]/i,
      /(?:and\s+)?description\s+['"]([^'"]+)['"]/i,
    ];

    // Try to extract title
    for (const pattern of titlePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        params.title = match[1].trim();
        break;
      }
    }

    // Try to extract description
    for (const pattern of descriptionPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        params.description = match[1].trim();
        break;
      }
    }

    // Extract assignee/user information
    const assigneePatterns = [
      /(?:assign(?:ed)?\s+to|assignee)[: ]+['"]?([a-zA-Z0-9._-]+)['"]?/i,
      /(?:assign(?:ed)?\s+to|assignee)[: ]+(\S+)/i,
      /(?:for|by)\s+['"]?([a-zA-Z0-9._-]+)['"]?/i,
    ];

    for (const pattern of assigneePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        params.assignee = match[1].trim();
        break;
      }
    }

    // Determine command type from keywords
    if (
      lowerMessage.includes('create') ||
      lowerMessage.includes('add') ||
      lowerMessage.includes('new')
    ) {
      commandType = 'create';
    } else if (
      lowerMessage.includes('list') ||
      lowerMessage.includes('show') ||
      lowerMessage.includes('get all')
    ) {
      commandType = 'list';
    } else if (
      lowerMessage.includes('update') ||
      lowerMessage.includes('edit') ||
      lowerMessage.includes('modify') ||
      lowerMessage.includes('change')
    ) {
      commandType = 'update';
    } else if (
      lowerMessage.includes('delete') ||
      lowerMessage.includes('remove')
    ) {
      commandType = 'delete';
    } else if (
      lowerMessage.includes('send') ||
      lowerMessage.includes('post') ||
      lowerMessage.includes('message')
    ) {
      commandType = 'send';
    }

    // Determine entity from keywords and integration type
    if (mention.integration === 'jira' || mention.integration === 'linear') {
      if (
        lowerMessage.includes('issue') ||
        lowerMessage.includes('task') ||
        lowerMessage.includes('story') ||
        lowerMessage.includes('bug')
      ) {
        entity = 'issue';
      } else if (lowerMessage.includes('project')) {
        entity = 'project';
      } else if (lowerMessage.includes('epic')) {
        entity = 'epic';
      } else if (lowerMessage.includes('comment')) {
        entity = 'comment';
      } else {
        entity = 'issue'; // Default for project management tools
      }
    } else if (
      mention.integration === 'slack' ||
      mention.integration === 'discord'
    ) {
      if (lowerMessage.includes('channel')) {
        entity = 'channel';
      } else if (lowerMessage.includes('message')) {
        entity = 'message';
      } else if (lowerMessage.includes('user')) {
        entity = 'user';
      } else {
        entity = 'message'; // Default for chat tools
      }
    } else if (mention.integration === 'github') {
      if (lowerMessage.includes('issue')) {
        entity = 'issue';
      } else if (
        lowerMessage.includes('pull request') ||
        lowerMessage.includes('pr')
      ) {
        entity = 'pullrequest';
      } else if (
        lowerMessage.includes('repository') ||
        lowerMessage.includes('repo')
      ) {
        entity = 'repository';
      } else if (lowerMessage.includes('branch')) {
        entity = 'branch';
      } else {
        entity = 'issue'; // Default for GitHub
      }
    } else if (mention.integration === 'google') {
      if (lowerMessage.includes('document') || lowerMessage.includes('doc')) {
        entity = 'document';
      } else if (
        lowerMessage.includes('sheet') ||
        lowerMessage.includes('spreadsheet')
      ) {
        entity = 'spreadsheet';
      } else if (lowerMessage.includes('file')) {
        entity = 'file';
      } else {
        entity = 'document'; // Default for Google Workspace
      }
    } else if (mention.integration === 'vercel') {
      if (lowerMessage.includes('project')) {
        entity = 'project';
      } else if (lowerMessage.includes('deployment')) {
        entity = 'deployment';
      } else if (lowerMessage.includes('domain')) {
        entity = 'domain';
      } else {
        entity = 'project'; // Default for Vercel
      }
    }

    // If we still don't have a command type or entity, try to infer from context
    if (!commandType || !entity) {
      // Check for specific action keywords
      if (
        lowerMessage.includes('status') ||
        lowerMessage.includes('check') ||
        lowerMessage.includes('info')
      ) {
        commandType = 'get';
      } else if (
        lowerMessage.includes('help') ||
        lowerMessage.includes('what can you do')
      ) {
        // This might need special handling
        return null;
      }
    }

    // Return null if we couldn't determine command type or entity
    if (!commandType || !entity) {
      return null;
    }

    return {
      type: commandType,
      entity,
      mention,
      params,
      naturalLanguage: message,
    };
  }
}
