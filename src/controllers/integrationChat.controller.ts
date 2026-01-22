import { Request, Response } from 'express';
import { IntegrationChatService, ParsedMention } from '../services/integrationChat.service';
import { MCPIntegrationHandler } from '../services/mcpIntegrationHandler.service';
import { IntegrationService } from '../services/integration.service';
import { JiraService } from '../services/jira.service';
import { LinearService } from '../services/linear.service';
import { SlackService } from '../services/slack.service';
import { DiscordService } from '../services/discord.service';
import { GitHubService } from '../services/github.service';
import { IGitHubConnection } from '../models';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export interface ExecuteCommandRequest {
  message: string;
  mentions: ParsedMention[];
}

export interface AutocompleteRequest {
  query: string;
  integration?: string;
  entityType?: string;
  entityId?: string;
}

export class IntegrationChatController {
  /**
   * Execute integration command from chat
   * POST /api/chat/integrations/execute
   */
  static async executeCommand(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('executeCommand', req);

    try {

      const { message, mentions }: ExecuteCommandRequest = req.body;

      if (!message || !mentions || mentions.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Message and mentions are required'
        });
      }

      // Parse command (now async with AI recognition)
      const command = await IntegrationChatService.parseCommand(message, mentions);
      if (!command) {
        return res.status(400).json({
          success: false,
          message: 'Could not parse command from message'
        });
      }

      // Execute via MCP handler for security
      const result = await MCPIntegrationHandler.handleIntegrationOperation({
        userId,
        command,
        context: {
          message,
          mentions
        }
      });

      ControllerHelper.logRequestSuccess('executeCommand', req, startTime, {
        success: result.success
      });

      return res.json({
        success: result.success,
        data: result.result,
        auditLog: result.auditLog
      });
    } catch (error: any) {
      ControllerHelper.handleError('executeCommand', error, req, res, startTime);
      return res;
    }
  }

  /**
   * Get autocomplete suggestions for @ mentions
   * GET /api/chat/integrations/autocomplete
   */
  static async getAutocomplete(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getAutocomplete', req, { query: req.query });

    try {

      const queryParams = req.query as unknown as Partial<AutocompleteRequest>;
      const query = typeof queryParams.query === 'string' ? queryParams.query : '';
      const integration = typeof queryParams.integration === 'string' ? queryParams.integration : undefined;
      const entityType = typeof queryParams.entityType === 'string' ? queryParams.entityType : undefined;

      // Get user's active integrations
      const integrations = await IntegrationService.getUserIntegrations(userId, {
        status: 'active'
      });

      // Filter by integration type if specified
      let filteredIntegrations = integrations;
      if (integration) {
        filteredIntegrations = integrations.filter(i => {
          if (integration === 'jira') return i.type === 'jira_oauth';
          if (integration === 'linear') return i.type === 'linear_oauth';
          if (integration === 'slack') return i.type === 'slack_oauth' || i.type === 'slack_webhook';
          if (integration === 'discord') return i.type === 'discord_oauth' || i.type === 'discord_webhook';
          if (integration === 'github') return i.type === 'github_oauth';
          if (integration === 'webhook') return i.type === 'custom_webhook';
          return false;
        });
      }

      // Build suggestions based on query
      const suggestions: Array<{
        id: string;
        label: string;
        type: 'integration' | 'entity' | 'subentity';
        integration?: string;
        entityType?: string;
        entityId?: string;
      }> = [];

      if (!integration) {
        // Show integration list
        suggestions.push(
          { id: 'jira', label: 'JIRA', type: 'integration', integration: 'jira' },
          { id: 'linear', label: 'Linear', type: 'integration', integration: 'linear' },
          { id: 'slack', label: 'Slack', type: 'integration', integration: 'slack' },
          { id: 'discord', label: 'Discord', type: 'integration', integration: 'discord' },
          { id: 'github', label: 'GitHub', type: 'integration', integration: 'github' }
        );
      } else if (!entityType) {
        // Show entity types
        if (integration === 'jira') {
          suggestions.push(
            { id: 'project', label: 'Project', type: 'entity', integration: 'jira', entityType: 'project' },
            { id: 'issue', label: 'Issue', type: 'entity', integration: 'jira', entityType: 'issue' }
          );
        } else if (integration === 'linear') {
          suggestions.push(
            { id: 'team', label: 'Team', type: 'entity', integration: 'linear', entityType: 'team' },
            { id: 'project', label: 'Project', type: 'entity', integration: 'linear', entityType: 'project' },
            { id: 'issue', label: 'Issue', type: 'entity', integration: 'linear', entityType: 'issue' }
          );
        } else if (integration === 'slack' || integration === 'discord') {
          suggestions.push(
            { id: 'channel', label: 'Channel', type: 'entity', integration, entityType: 'channel' },
            { id: 'user', label: 'User', type: 'entity', integration, entityType: 'user' }
          );
        } else if (integration === 'github') {
          suggestions.push(
            { id: 'repository', label: 'Repository', type: 'entity', integration: 'github', entityType: 'repository' },
            { id: 'issue', label: 'Issue', type: 'entity', integration: 'github', entityType: 'issue' },
            { id: 'pullrequest', label: 'Pull Request', type: 'entity', integration: 'github', entityType: 'pullrequest' },
            { id: 'branch', label: 'Branch', type: 'entity', integration: 'github', entityType: 'branch' }
          );
        }
      }

      // Filter by query if provided
      let filteredSuggestions = suggestions;
      if (query) {
        const lowerQuery = query.toLowerCase();
        filteredSuggestions = suggestions.filter(s => 
          s.label.toLowerCase().includes(lowerQuery) ||
          s.id.toLowerCase().includes(lowerQuery)
        );
      }

      ControllerHelper.logRequestSuccess('getAutocomplete', req, startTime, {
        suggestionsCount: filteredSuggestions.length
      });

      return res.json({
        success: true,
        data: filteredSuggestions
      });
    } catch (error: any) {
      ControllerHelper.handleError('getAutocomplete', error, req, res, startTime);
      return res;
    }
  }

  /**
   * List entities for an integration type
   * GET /api/chat/integrations/:type/entities
   */
  static async listEntities(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { type } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('listEntities', req, { type });

    try {

      const { type } = req.params;
      const { entityType } = req.query;

      // Get user's integrations
      const integrations = await IntegrationService.getUserIntegrations(userId, {
        status: 'active'
      });

      // Filter by type
      const integration = integrations.find(i => {
        if (type === 'jira') return i.type === 'jira_oauth';
        if (type === 'linear') return i.type === 'linear_oauth';
        if (type === 'slack') return i.type === 'slack_oauth' || i.type === 'slack_webhook';
        if (type === 'discord') return i.type === 'discord_oauth' || i.type === 'discord_webhook';
        if (type === 'github') return i.type === 'github_oauth';
        if (type === 'webhook') return i.type === 'custom_webhook';
        return false;
      });

      if (!integration) {
        return res.status(404).json({
          success: false,
          message: `No active ${type} integration found`
        });
      }

      const credentials = integration.getCredentials();
      const entities: Array<{ id: string; name: string }> = [];

      try {
        if (type === 'jira') {
          if (entityType === 'project') {
            const siteUrlOrCloudId = credentials.cloudId || credentials.siteUrl || '';
            const accessToken = credentials.accessToken || '';
            const useCloudId = !!credentials.cloudId;

            if (siteUrlOrCloudId && accessToken) {
              const projects = await JiraService.listProjects(siteUrlOrCloudId, accessToken, useCloudId);
              entities.push(...projects.map(p => ({
                id: p.key,
                name: p.name
              })));
            }
          }
        } else if (type === 'linear') {
          if (entityType === 'team') {
            const accessToken = credentials.accessToken || '';
            if (accessToken) {
              const teams = await LinearService.listTeams(accessToken);
              entities.push(...teams.map(t => ({
                id: t.id,
                name: t.name
              })));
            }
          } else if (entityType === 'project') {
            const accessToken = credentials.accessToken || '';
            const teamId = credentials.teamId || '';
            if (accessToken && teamId) {
              const projects = await LinearService.listProjects(accessToken, teamId);
              entities.push(...projects.map(p => ({
                id: p.id,
                name: p.name
              })));
            }
          }
        } else if (type === 'slack') {
          if (entityType === 'channel') {
            const accessToken = credentials.accessToken || '';
            if (accessToken) {
              const channels = await SlackService.listChannels(accessToken);
              entities.push(...channels.map((ch: any) => ({
                id: ch.id,
                name: ch.name || ch.id
              })));
            }
          }
        } else if (type === 'discord') {
          if (entityType === 'channel') {
            const botToken = credentials.botToken || '';
            const guildId = credentials.guildId || '';
            if (botToken && guildId) {
              const channels = await DiscordService.listChannels(botToken, guildId);
              entities.push(...channels.map((ch: any) => ({
                id: ch.id,
                name: ch.name || ch.id
              })));
            }
          }
        } else if (type === 'github') {
          if (entityType === 'repository') {
            const connection = integration as unknown as IGitHubConnection & { decryptToken: () => string };
            if (connection) {
              const repos = await GitHubService.listUserRepositories(connection);
              entities.push(...repos.map(r => ({
                id: r.fullName,
                name: r.fullName
              })));
            }
          }
        }
      } catch (error: any) {
        loggingService.error('Failed to fetch entities from integration service', {
          error: error.message,
          type,
          entityType
        });
        // Return empty array on error rather than failing
      }

      ControllerHelper.logRequestSuccess('listEntities', req, startTime, {
        type,
        entitiesCount: entities.length
      });

      return res.json({
        success: true,
        data: entities
      });
    } catch (error: any) {
      ControllerHelper.handleError('listEntities', error, req, res, startTime, { type });
      return res;
    }
  }

  /**
   * Get sub-entities for a parent entity
   * GET /api/chat/integrations/:type/:entityId/subentities
   */
  static async getSubEntities(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { type, entityId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return res;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getSubEntities', req, { type, entityId });

    try {

      const { type, entityId } = req.params;
      const { subEntityType } = req.query;

      // Get user's integrations
      const integrations = await IntegrationService.getUserIntegrations(userId, {
        status: 'active'
      });

      // Filter by type
      const integration = integrations.find(i => {
        if (type === 'jira') return i.type === 'jira_oauth';
        if (type === 'linear') return i.type === 'linear_oauth';
        if (type === 'slack') return i.type === 'slack_oauth' || i.type === 'slack_webhook';
        if (type === 'discord') return i.type === 'discord_oauth' || i.type === 'discord_webhook';
        if (type === 'github') return i.type === 'github_oauth';
        if (type === 'google') return i.type === 'google_oauth';
        if (type === 'webhook') return i.type === 'custom_webhook';
        return false;
      });

      if (!integration) {
        return res.status(404).json({
          success: false,
          message: `No active ${type} integration found`
        });
      }

      const credentials = integration.getCredentials();
      const subEntities: Array<{ id: string; name: string }> = [];

      try {
        if (type === 'jira') {
          // entityId is projectKey for JIRA
          if (subEntityType === 'issues' || subEntityType === 'issue') {
            const siteUrlOrCloudId = credentials.cloudId || credentials.siteUrl || '';
            const accessToken = credentials.accessToken || '';
            const useCloudId = !!credentials.cloudId;

            if (siteUrlOrCloudId && accessToken && entityId) {
              const result = await JiraService.listIssues(
                siteUrlOrCloudId,
                accessToken,
                entityId,
                { maxResults: 50 },
                useCloudId
              );
              subEntities.push(...result.issues.map(issue => ({
                id: issue.key,
                name: `${issue.key}: ${issue.fields.summary}`
              })));
            }
          }
        } else if (type === 'linear') {
          // entityId is teamId for Linear
          if (subEntityType === 'issues') {
            const accessToken = credentials.accessToken || '';
            if (accessToken && entityId) {
              const result = await LinearService.listIssues(accessToken, entityId);
              subEntities.push(...result.issues.map(issue => ({
                id: issue.id,
                name: `${issue.identifier}: ${issue.title}`
              })));
            }
          } else if (subEntityType === 'projects') {
            const accessToken = credentials.accessToken || '';
            if (accessToken && entityId) {
              const projects = await LinearService.listProjects(accessToken, entityId);
              subEntities.push(...projects.map(p => ({
                id: p.id,
                name: p.name
              })));
            }
          }
        } else if (type === 'github') {
          // entityId is repository (owner/repo) for GitHub
          const repoParts = entityId.split('/');
          const owner = repoParts[0];
          const repo = repoParts[1] || repoParts[0];
          const connection = integration as unknown as IGitHubConnection & { decryptToken: () => string };

          if (subEntityType === 'issues') {
            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.issues.listForRepo({
              owner,
              repo,
              state: 'open',
              per_page: 50
            });
            subEntities.push(...data.map((issue: { number: number; title: string }) => ({
              id: issue.number.toString(),
              name: `#${issue.number}: ${issue.title}`
            })));
          } else if (subEntityType === 'pullrequests') {
            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.pulls.list({
              owner,
              repo,
              state: 'open',
              per_page: 50
            });
            subEntities.push(...data.map((pr: { number: number; title: string }) => ({
              id: pr.number.toString(),
              name: `#${pr.number}: ${pr.title}`
            })));
          } else if (subEntityType === 'branches') {
            const octokit = await GitHubService['getOctokitFromConnection'](connection);
            const { data } = await octokit.rest.repos.listBranches({
              owner,
              repo,
              per_page: 50
            });
            subEntities.push(...data.map((branch: { name: string }) => ({
              id: branch.name,
              name: branch.name
            })));
          }
        } else if (type === 'google') {
          // Google Drive/Docs/Sheets sub-entities
          const { GoogleService } = await import('../services/google.service');
          const { GoogleConnection } = await import('../models/GoogleConnection');
          
          const connectionId = integration.metadata?.connectionId;
          if (connectionId) {
            const connection = await GoogleConnection.findById(connectionId).select('+accessToken +refreshToken');
            
            if (connection) {
              if (subEntityType === 'spreadsheets') {
                const { files } = await GoogleService.listDriveFiles(connection, {
                  query: "mimeType='application/vnd.google-apps.spreadsheet'",
                  pageSize: 50
                });
                subEntities.push(...files.map(file => ({
                  id: file.id,
                  name: file.name
                })));
              } else if (subEntityType === 'documents') {
                const { files } = await GoogleService.listDriveFiles(connection, {
                  query: "mimeType='application/vnd.google-apps.document'",
                  pageSize: 50
                });
                subEntities.push(...files.map(file => ({
                  id: file.id,
                  name: file.name
                })));
              } else if (subEntityType === 'files' || subEntityType === 'folders') {
                const mimeType = subEntityType === 'folders' ? 'application/vnd.google-apps.folder' : '';
                const { files } = await GoogleService.listDriveFiles(connection, {
                  query: mimeType ? `mimeType='${mimeType}'` : undefined,
                  pageSize: 50
                });
                subEntities.push(...files.map(file => ({
                  id: file.id,
                  name: file.name
                })));
              }
            }
          }
        }
      } catch (error: any) {
        loggingService.error('Failed to fetch sub-entities from integration service', {
          error: error.message,
          type,
          entityId,
          subEntityType
        });
        // Return empty array on error rather than failing
      }

      ControllerHelper.logRequestSuccess('getSubEntities', req, startTime, {
        type,
        entityId,
        subEntitiesCount: subEntities.length
      });

      return res.json({
        success: true,
        data: subEntities
      });
    } catch (error: any) {
      ControllerHelper.handleError('getSubEntities', error, req, res, startTime, { type, entityId });
      return res;
    }
  }
}

