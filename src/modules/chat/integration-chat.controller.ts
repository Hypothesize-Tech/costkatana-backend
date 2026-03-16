import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoggerService } from '../../common/logger/logger.service';
import { UseInterceptors } from '@nestjs/common';
import { ChatMentionsInterceptor } from './interceptors/chat-mentions.interceptor';
import {
  IntegrationChatService,
  ParsedMention,
} from './services/integration-chat.service';
import { ChatSSEService } from './services/chat-sse.service';
import { ChatEventsService } from './services/chat-events.service';
import { IntegrationService } from '../integration/integration.service';
import { JiraService } from '../integration/services/jira.service';
import type { JiraIssue } from '../integration/services/jira.service';
import { LinearService } from '../integration/services/linear.service';
import type { LinearIssue } from '../integration/services/linear.service';
import { SlackService } from '../integration/services/slack.service';
import { DiscordService } from '../integration/services/discord.service';
import { GitHubService } from '../integration/services/github.service';
import { GoogleService } from '../integration/services/google.service';
import { VercelService } from '../vercel/vercel.service';
import { ExecuteCommandDto, AutocompleteQueryDto } from './dto';
import type { RequestWithMentions } from './interceptors/chat-mentions.interceptor';
import { McpIntegrationHandlerService } from './services/mcp-integration-handler.service';

interface AuthenticatedUser {
  id: string;
  _id?: string;
  email?: string;
}

@ApiTags('Chat - Integrations')
@Controller(['api/chat/integrations', 'api/chat/integration'])
@UseGuards(JwtAuthGuard)
export class IntegrationChatController {
  constructor(
    private readonly logger: LoggerService,
    private readonly integrationChatService: IntegrationChatService,
    private readonly mcpIntegrationHandler: McpIntegrationHandlerService,
    private readonly chatSSEService: ChatSSEService,
    private readonly chatEventsService: ChatEventsService,
    private readonly integrationService: IntegrationService,
    private readonly jiraService: JiraService,
    private readonly linearService: LinearService,
    private readonly slackService: SlackService,
    private readonly discordService: DiscordService,
    private readonly githubService: GitHubService,
    private readonly googleService: GoogleService,
    private readonly vercelService: VercelService,
  ) {}

  /**
   * Execute integration command from chat
   * POST /chat/integrations/execute
   */
  @ApiOperation({
    summary: 'Execute integration command',
    description:
      'Execute integration commands using @mention syntax (e.g., @github, @vercel, @mongodb)',
  })
  @ApiResponse({ status: 200, description: 'Command executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid command or parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post('execute')
  @UseInterceptors(ChatMentionsInterceptor)
  async executeCommand(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: ExecuteCommandDto,
    @Req() request: RequestWithMentions,
  ) {
    const startTime = Date.now();

    try {
      // Use server-parsed mentions from interceptor when present; otherwise use DTO
      const parsedMentions: ParsedMention[] = request.mentions?.length
        ? request.mentions
        : (dto.mentions?.map((m) => ({
            integration: m.integration,
            entityType: m.entityType,
            entityId: m.entityId,
            action: m.action,
            originalMention: `@${m.integration}${
              m.entityType ? ` ${m.entityType}` : ''
            }${m.entityId ? ` ${m.entityId}` : ''}`.trim(),
          })) ?? []);

      this.logger.log('Executing integration command', {
        userId: user.id,
        messageLength: dto.message.length,
        mentionsCount: parsedMentions.length,
      });

      if (!dto.message || parsedMentions.length === 0) {
        throw new HttpException(
          {
            success: false,
            message: 'Message and mentions are required',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const command = await this.integrationChatService.parseCommand(
        dto.message,
        parsedMentions,
      );
      if (!command) {
        throw new HttpException(
          {
            success: false,
            message: 'Could not parse command from message',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Generate a unique command ID for tracking
      const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Execute command via MCP integration handler for security, rate limiting, and audit logging
      const mcpRequest = {
        userId: user.id,
        command,
        mentions: parsedMentions,
        context: {
          userId: user.id,
          userEmail: user.email,
          integration: command.mention.integration,
          timestamp: new Date().toISOString(),
        },
      };

      const mcpResponse =
        await this.mcpIntegrationHandler.handleIntegrationOperation(mcpRequest);
      const result = mcpResponse.result;

      // Emit completion event for tracking
      this.chatEventsService.emitStatus(commandId, user.id, 'completed', {
        success: result.success,
        integration: command.mention.integration,
        data: result.data,
      });

      this.logger.log('Integration command executed successfully', {
        userId: user.id,
        integration: command.mention.integration,
        commandType: command.type,
        entity: command.entity,
        success: result.success,
        duration: Date.now() - startTime,
      });

      return {
        success: result.success,
        data: result.data,
        message: result.message,
        metadata: result.metadata,
        viewLinks: result.viewLinks,
      };
    } catch (error) {
      this.logger.error('Failed to execute integration command', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        messageLength: dto.message?.length,
        mentionsCount: dto.mentions?.length,
        duration: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to execute integration command',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get autocomplete suggestions for @ mentions
   * GET /chat/integrations/autocomplete
   */
  @Get('autocomplete')
  async getAutocomplete(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ValidationPipe({ transform: true })) query: AutocompleteQueryDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.debug('Getting autocomplete suggestions', {
        userId: user.id,
        query: query.query,
        integration: query.integration,
        entityType: query.entityType,
      });

      // Get user's active integrations
      const integrations = await this.integrationService.getUserIntegrations(
        user.id,
        {
          status: 'active',
        },
      );

      // Build suggestions based on query
      const suggestions: Array<{
        id: string;
        label: string;
        type: 'integration' | 'entity' | 'subentity';
        integration?: string;
        entityType?: string;
        entityId?: string;
      }> = [];

      let filteredIntegrations = integrations;
      if (query.integration) {
        filteredIntegrations = integrations.filter((i) => {
          if (query.integration === 'jira') return i.type === 'jira_oauth';
          if (query.integration === 'linear') return i.type === 'linear_oauth';
          if (query.integration === 'slack')
            return i.type === 'slack_oauth' || i.type === 'slack_webhook';
          if (query.integration === 'discord')
            return i.type === 'discord_oauth' || i.type === 'discord_webhook';
          if (query.integration === 'github') return i.type === 'github_oauth';
          return false;
        });
      }

      if (!query.integration) {
        // Show integration list - always show the 6 default integrations (like Express)
        suggestions.push(
          {
            id: 'jira',
            label: 'JIRA',
            type: 'integration' as const,
            integration: 'jira',
          },
          {
            id: 'linear',
            label: 'Linear',
            type: 'integration' as const,
            integration: 'linear',
          },
          {
            id: 'slack',
            label: 'Slack',
            type: 'integration' as const,
            integration: 'slack',
          },
          {
            id: 'discord',
            label: 'Discord',
            type: 'integration' as const,
            integration: 'discord',
          },
          {
            id: 'github',
            label: 'GitHub',
            type: 'integration' as const,
            integration: 'github',
          },
          {
            id: 'google',
            label: 'Google Drive, Gmail, Calendar, Sheets, Docs',
            type: 'integration' as const,
            integration: 'google',
          },
        );
      } else if (!query.entityType) {
        // Show entity types for the selected integration
        if (query.integration === 'jira') {
          suggestions.push(
            {
              id: 'project',
              label: 'Project',
              type: 'entity',
              integration: 'jira',
              entityType: 'project',
            },
            {
              id: 'issue',
              label: 'Issue',
              type: 'entity',
              integration: 'jira',
              entityType: 'issue',
            },
          );
        } else if (query.integration === 'linear') {
          suggestions.push(
            {
              id: 'team',
              label: 'Team',
              type: 'entity',
              integration: 'linear',
              entityType: 'team',
            },
            {
              id: 'project',
              label: 'Project',
              type: 'entity',
              integration: 'linear',
              entityType: 'project',
            },
          );
        } else if (query.integration === 'github') {
          suggestions.push(
            {
              id: 'repository',
              label: 'Repository',
              type: 'entity',
              integration: 'github',
              entityType: 'repository',
            },
            {
              id: 'issue',
              label: 'Issue',
              type: 'entity',
              integration: 'github',
              entityType: 'issue',
            },
            {
              id: 'pullrequest',
              label: 'Pull Request',
              type: 'entity',
              integration: 'github',
              entityType: 'pullrequest',
            },
            {
              id: 'branch',
              label: 'Branch',
              type: 'entity',
              integration: 'github',
              entityType: 'branch',
            },
          );
        } else if (
          query.integration === 'slack' ||
          query.integration === 'discord'
        ) {
          suggestions.push({
            id: 'channel',
            label: 'Channel',
            type: 'entity',
            integration: query.integration,
            entityType: 'channel',
          });
        }
      }

      // Filter by query if provided
      let filteredSuggestions = suggestions;
      if (query.query) {
        const lowerQuery = query.query.toLowerCase();
        filteredSuggestions = suggestions.filter(
          (s) =>
            s.label.toLowerCase().includes(lowerQuery) ||
            s.id.toLowerCase().includes(lowerQuery),
        );
      }

      this.logger.log('Autocomplete suggestions generated', {
        userId: user.id,
        suggestionsCount: filteredSuggestions.length,
        query: query.query,
        integration: query.integration,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: filteredSuggestions,
      };
    } catch (error) {
      this.logger.error('Failed to get autocomplete suggestions', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        query: query.query,
        duration: Date.now() - startTime,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get autocomplete suggestions',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * List entities for an integration type
   * GET /chat/integrations/:type/entities
   */
  @Get(':type/entities')
  async listEntities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Query('entityType') entityType?: string,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Listing integration entities', {
        userId: user.id,
        type,
        entityType,
      });

      // Get user's integrations
      const integrations = await this.integrationService.getUserIntegrations(
        user.id,
        {
          status: 'active',
        },
      );

      // Filter by type
      const integration = integrations.find((i) => {
        if (type === 'jira') return i.type === 'jira_oauth';
        if (type === 'linear') return i.type === 'linear_oauth';
        if (type === 'slack')
          return i.type === 'slack_oauth' || i.type === 'slack_webhook';
        if (type === 'discord')
          return i.type === 'discord_oauth' || i.type === 'discord_webhook';
        if (type === 'github') return i.type === 'github_oauth';
        return false;
      });

      if (!integration) {
        throw new HttpException(
          {
            success: false,
            message: `No active ${type} integration found`,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      const entities: Array<{ id: string; name: string }> = [];

      try {
        // Get integration credentials
        const credentials = integration.getCredentials();

        // Route to appropriate service based on integration type
        if (type === 'jira' && entityType === 'project') {
          const projects = await this.jiraService.listProjects(
            credentials.siteUrl || credentials.cloudId || '',
            credentials.accessToken || '',
            !!credentials.cloudId,
          );
          entities.push(...projects.map((p) => ({ id: p.key, name: p.name })));
        } else if (type === 'linear' && entityType === 'team') {
          const teams = await this.linearService.listTeams(
            credentials.accessToken || '',
          );
          entities.push(...teams.map((t) => ({ id: t.id, name: t.name })));
        } else if (type === 'linear' && entityType === 'project') {
          const projects = await this.linearService.listProjects(
            credentials.accessToken || '',
            credentials.teamId || '',
          );
          entities.push(...projects.map((p) => ({ id: p.id, name: p.name })));
        } else if (type === 'slack' && entityType === 'channel') {
          const channels = await this.slackService.listChannels(
            credentials.accessToken || '',
          );
          entities.push(
            ...channels.map((c: any) => ({ id: c.id, name: c.name })),
          );
        } else if (type === 'discord' && entityType === 'channel') {
          const channels = await this.discordService.listGuildChannels(
            credentials.botToken || '',
            credentials.guildId || '',
          );
          entities.push(
            ...channels.map((c: any) => ({ id: c.id, name: c.name })),
          );
        } else if (type === 'github' && entityType === 'repository') {
          const repositories = await this.githubService.listUserRepositories(
            integration._id.toString(),
          );
          entities.push(
            ...repositories.map((r) => ({ id: r.fullName, name: r.fullName })),
          );
        }
      } catch (error: any) {
        this.logger.warn('Failed to fetch entities from integration service', {
          error: error.message,
          type,
          entityType,
          userId: user.id,
        });
        // Return empty array on error rather than failing
      }

      this.logger.log('Integration entities listed successfully', {
        userId: user.id,
        type,
        entityType,
        entitiesCount: entities.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: entities,
      };
    } catch (error) {
      this.logger.error('Failed to list integration entities', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        type,
        entityType,
        duration: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to list entities',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get sub-entities for a parent entity
   * GET /chat/integrations/:type/:entityId/subentities?subEntityType=:type
   *
   * Supported sub-entity types by integration:
   * - Linear: projects (for teams), issues (for projects)
   * - JIRA: issue_types (for projects), issues (for projects)
   * - Slack: none currently supported (service API limitation)
   * - Discord: none currently supported (service API limitation)
   *
   * @param type Integration type (jira, linear, slack, discord)
   * @param entityId Parent entity ID (project key, team ID, etc.)
   * @param subEntityType Type of sub-entities to retrieve
   */
  @Get(':type/:entityId/subentities')
  async getSubEntities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Param('entityId') entityId: string,
    @Query('subEntityType') subEntityType?: string,
  ) {
    const startTime = Date.now();

    try {
      // Validate required parameters
      if (!subEntityType) {
        throw new HttpException(
          {
            success: false,
            message: 'subEntityType query parameter is required',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validate integration type
      const supportedIntegrations = [
        'jira',
        'linear',
        'slack',
        'discord',
        'github',
        'google',
      ];
      if (!supportedIntegrations.includes(type)) {
        throw new HttpException(
          {
            success: false,
            message: `Unsupported integration type: ${type}. Supported: ${supportedIntegrations.join(', ')}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log('Getting integration sub-entities', {
        userId: user.id,
        type,
        entityId,
        subEntityType,
      });

      // Get user's integrations
      const integrations = await this.integrationService.getUserIntegrations(
        user.id,
        {
          status: 'active',
        },
      );

      // Filter by type
      const integration = integrations.find((i) => {
        if (type === 'jira') return i.type === 'jira_oauth';
        if (type === 'linear') return i.type === 'linear_oauth';
        if (type === 'slack')
          return i.type === 'slack_oauth' || i.type === 'slack_webhook';
        if (type === 'discord')
          return i.type === 'discord_oauth' || i.type === 'discord_webhook';
        if (type === 'github') return i.type === 'github_oauth';
        return false;
      });

      if (!integration) {
        throw new HttpException(
          {
            success: false,
            message: `No active ${type} integration found`,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      const subEntities: Array<{ id: string; name: string }> = [];

      try {
        // Get integration credentials
        const credentials = integration.getCredentials();

        // Route to appropriate service based on integration type
        if (type === 'linear') {
          if (subEntityType === 'projects') {
            // Linear projects for team (entityId is teamId)
            const projects = await this.linearService.listProjects(
              credentials.accessToken || '',
              entityId,
            );
            subEntities.push(
              ...projects.map((p) => ({ id: p.id, name: p.name })),
            );
          } else if (subEntityType === 'issues') {
            // Linear issues for project (entityId is projectId)
            const result = await this.linearService.listIssues(
              credentials.accessToken || '',
              entityId, // projectId
            );
            subEntities.push(
              ...result.issues.map((issue: LinearIssue) => ({
                id: issue.id,
                name: `${issue.identifier}: ${issue.title}`,
              })),
            );
          } else {
            this.logger.warn('Unsupported Linear sub-entity type', {
              subEntityType,
              teamId: entityId,
              userId: user.id,
            });
          }
        } else if (type === 'jira') {
          if (subEntityType === 'issues') {
            // JIRA issues for project (entityId is projectKey)
            const result = await this.jiraService.listIssues(
              credentials.siteUrl || credentials.cloudId || '',
              credentials.accessToken || '',
              entityId, // projectKey
              { maxResults: 50 },
              !!credentials.cloudId,
            );
            subEntities.push(
              ...result.issues.map((issue: JiraIssue) => ({
                id: issue.key,
                name: `${issue.key}: ${issue.fields.summary}`,
              })),
            );
          } else if (subEntityType === 'issue_types') {
            // JIRA issue types for project
            try {
              const issueTypes = await this.jiraService.listPriorities(
                credentials.siteUrl || credentials.cloudId || '',
                credentials.accessToken || '',
                !!credentials.cloudId,
              );
              subEntities.push(
                ...issueTypes.map((it) => ({ id: it.id, name: it.name })),
              );
            } catch (error) {
              this.logger.warn('Failed to fetch JIRA issue types', {
                error: error instanceof Error ? error.message : String(error),
                projectKey: entityId,
                userId: user.id,
              });
            }
          } else {
            this.logger.warn('Unsupported JIRA sub-entity type', {
              subEntityType,
              projectKey: entityId,
              userId: user.id,
            });
          }
        } else if (type === 'slack') {
          this.logger.warn('Unsupported Slack sub-entity type', {
            subEntityType,
            channelId: entityId,
            userId: user.id,
          });
        } else if (type === 'discord') {
          if (subEntityType === 'roles') {
            // Discord roles - not supported by current Discord service API
            this.logger.error(
              'Discord roles integration not supported by service API',
              {
                guildId: credentials.guildId,
                userId: user.id,
              },
            );
            throw new HttpException(
              'Discord roles integration is not supported by the service API',
              HttpStatus.NOT_IMPLEMENTED,
            );
          } else {
            this.logger.warn('Unsupported Discord sub-entity type', {
              subEntityType,
              channelId: entityId,
              userId: user.id,
            });
          }
        } else if (type === 'github') {
          // entityId is repository (owner/repo) for GitHub
          const repoParts = entityId.split('/');
          const owner = repoParts[0];
          const repo = repoParts[1] || repoParts[0];

          if (subEntityType === 'issues') {
            const issues = await this.githubService.listRepositoryIssues(
              integration._id.toString(),
              owner,
              repo,
            );
            subEntities.push(
              ...issues.map((issue) => ({
                id: issue.number.toString(),
                name: `#${issue.number}: ${issue.title}`,
              })),
            );
          } else if (subEntityType === 'pullrequests') {
            const prs = await this.githubService.listRepositoryPullRequests(
              integration._id.toString(),
              owner,
              repo,
            );
            subEntities.push(
              ...prs.map((pr) => ({
                id: pr.number.toString(),
                name: `#${pr.number}: ${pr.title}`,
              })),
            );
          } else if (subEntityType === 'branches') {
            const branches = await this.githubService.listRepositoryBranches(
              integration._id.toString(),
              owner,
              repo,
            );
            subEntities.push(
              ...branches.map((branch) => ({
                id: branch.name,
                name: branch.name,
              })),
            );
          } else {
            this.logger.warn('Unsupported GitHub sub-entity type', {
              subEntityType,
              repository: entityId,
              userId: user.id,
            });
          }
        } else if (type === 'google') {
          // Google Drive/Docs/Sheets sub-entities
          if (subEntityType === 'spreadsheets') {
            const spreadsheets = await this.googleService.listSpreadsheets(
              integration._id.toString(),
            );
            subEntities.push(
              ...spreadsheets.map((file) => ({
                id: file.id,
                name: file.name,
              })),
            );
          } else if (subEntityType === 'documents') {
            const documents = await this.googleService.listDocuments(
              integration._id.toString(),
            );
            subEntities.push(
              ...documents.map((file) => ({
                id: file.id,
                name: file.name,
              })),
            );
          } else if (subEntityType === 'files' || subEntityType === 'folders') {
            const mimeType =
              subEntityType === 'folders'
                ? 'application/vnd.google-apps.folder'
                : '';
            const { files } = await this.googleService.listDriveFiles(
              integration._id.toString(),
              {
                query: mimeType ? `mimeType='${mimeType}'` : undefined,
                pageSize: 50,
              },
            );
            subEntities.push(
              ...files.map((file) => ({
                id: file.id,
                name: file.name,
              })),
            );
          } else {
            this.logger.warn('Unsupported Google sub-entity type', {
              subEntityType,
              userId: user.id,
            });
          }
        } else if (type === 'vercel') {
          // Vercel projects/deployments sub-entities
          if (subEntityType === 'projects') {
            const projects = await this.vercelService.getProjects(
              integration._id.toString(),
            );
            subEntities.push(
              ...projects.map((project) => ({
                id: project.id,
                name: project.name,
              })),
            );
          } else if (subEntityType === 'deployments') {
            // If entityId is provided, get deployments for that specific project
            if (entityId) {
              const deployments = await this.vercelService.getDeployments(
                integration._id.toString(),
                entityId,
              );
              subEntities.push(
                ...deployments.map((deployment) => ({
                  id: deployment.uid,
                  name: `${deployment.url} (${deployment.state})`,
                })),
              );
            } else {
              this.logger.warn('Project ID required for Vercel deployments', {
                subEntityType,
                userId: user.id,
              });
            }
          } else {
            this.logger.warn('Unsupported Vercel sub-entity type', {
              subEntityType,
              userId: user.id,
            });
          }
        } else {
          this.logger.warn('Unsupported integration type for sub-entities', {
            type,
            entityId,
            subEntityType,
            userId: user.id,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          'Failed to fetch sub-entities from integration service',
          {
            error: error.message,
            type,
            entityId,
            subEntityType,
            userId: user.id,
          },
        );
        // Return empty array on error rather than failing the entire request
      }

      this.logger.log('Integration sub-entities retrieved successfully', {
        userId: user.id,
        type,
        entityId,
        subEntityType,
        subEntitiesCount: subEntities.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: subEntities,
        metadata: {
          integration: type,
          entityId,
          subEntityType,
          count: subEntities.length,
          supported: this.getSupportedSubEntityTypes(type),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get integration sub-entities', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        type,
        entityId,
        subEntityType,
        duration: Date.now() - startTime,
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get sub-entities',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get supported sub-entity types for an integration
   */
  private getSupportedSubEntityTypes(integrationType: string): string[] {
    switch (integrationType) {
      case 'linear':
        return ['projects', 'issues'];
      case 'jira':
        return ['issue_types', 'issues'];
      case 'slack':
        return []; // users could be added when API supports it
      case 'discord':
        return []; // users, roles could be added when API supports it
      case 'github':
        return ['issues', 'pullrequests', 'branches'];
      case 'vercel':
        return ['projects', 'deployments'];
      case 'google':
        return ['spreadsheets', 'documents', 'files', 'folders'];
      default:
        return [];
    }
  }

  /**
   * Stream integration command execution progress
   * GET /api/chat/integrations/:commandId/stream
   */
  @ApiOperation({
    summary: 'Stream integration command execution',
    description:
      'Server-sent events stream for long-running integration command execution progress',
  })
  @ApiResponse({ status: 200, description: 'SSE stream established' })
  @ApiParam({
    name: 'commandId',
    description: 'Unique identifier for the integration command',
  })
  @Get(':commandId/stream')
  streamIntegrationCommand(
    @Param('commandId') commandId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): void {
    const startTime = Date.now();

    try {
      this.logger.log('Starting SSE stream for integration command', {
        commandId,
        userId: user.id,
      });

      // Set up SSE headers
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // Send initial connection event
      response.write(
        `data: ${JSON.stringify({
          type: 'connection',
          message: 'SSE stream established',
          commandId,
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );

      // Listen for command status events
      const eventPattern = `chat.${commandId}.status`;
      let completed = false;

      const eventListener = (event: any) => {
        if (completed) return;

        try {
          const eventData = event.data;

          // Send status updates to client
          response.write(
            `data: ${JSON.stringify({
              type: eventData.status,
              message:
                eventData.status === 'started'
                  ? 'Integration command started'
                  : eventData.status === 'completed'
                    ? `Integration command ${eventData.success ? 'completed successfully' : 'failed'}`
                    : 'Processing integration command...',
              commandId,
              success: eventData.success,
              integration: eventData.integration,
              data: eventData.data,
              error: eventData.error,
              timestamp: new Date().toISOString(),
            })}\n\n`,
          );

          // If completed, end the stream
          if (eventData.status === 'completed') {
            completed = true;
            response.end();
            this.chatEventsService.off(eventPattern, eventListener);
          }
        } catch (error) {
          this.logger.error('Error processing command event', {
            error: error instanceof Error ? error.message : String(error),
            commandId,
            userId: user.id,
          });
        }
      };

      // Subscribe to command events
      this.chatEventsService.on(eventPattern, eventListener);

      // Timeout after 5 minutes if no completion event received
      const timeout = setTimeout(
        () => {
          if (!completed) {
            this.logger.warn('Integration command stream timed out', {
              commandId,
              userId: user.id,
              duration: Date.now() - startTime,
            });

            response.write(
              `data: ${JSON.stringify({
                type: 'timeout',
                message: 'Integration command timed out',
                commandId,
                timestamp: new Date().toISOString(),
              })}\n\n`,
            );
            response.end();
            this.chatEventsService.off(eventPattern, eventListener);
          }
        },
        5 * 60 * 1000,
      ); // 5 minutes

      // Handle client disconnect
      response.on('close', () => {
        clearTimeout(timeout);
        this.chatEventsService.off(eventPattern, eventListener);
        this.logger.log('SSE stream closed for integration command', {
          commandId,
          userId: user.id,
          duration: Date.now() - startTime,
        });
      });
    } catch (error) {
      this.logger.error(
        'Failed to establish SSE stream for integration command',
        {
          error: error instanceof Error ? error.message : String(error),
          commandId,
          userId: user.id,
          duration: Date.now() - startTime,
        },
      );

      response.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: 'Failed to establish stream',
          error: error instanceof Error ? error.message : 'Unknown error',
          commandId,
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );
      response.end();
    }
  }
}
