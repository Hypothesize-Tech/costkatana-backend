/**
 * Integration Option Provider Service
 * 
 * Fetches real options from connected integrations for interactive parameter selection.
 * This service provides the actual values (projects, channels, repos, etc.) that users
 * can select from when a parameter is missing.
 */

import { SelectionOption } from '../types/integrationAgent.types';
import { loggingService } from './logging.service';

export class IntegrationOptionProviderService {
  /**
   * Get available options for a parameter based on user's connected integrations
   */
  static async getOptionsForParameter(
    userId: string,
    integration: string,
    parameterName: string,
    context?: Record<string, unknown>
  ): Promise<SelectionOption[]> {
    try {
      loggingService.info('Fetching options for parameter', {
        component: 'IntegrationOptionProvider',
        userId,
        integration,
        parameterName,
      });

      switch (integration) {
        case 'vercel':
          return await this.getVercelOptions(userId, parameterName, context);
        case 'slack':
          return await this.getSlackOptions(userId, parameterName);
        case 'discord':
          return await this.getDiscordOptions(userId, parameterName);
        case 'jira':
          return await this.getJiraOptions(userId, parameterName, context);
        case 'linear':
          return await this.getLinearOptions(userId, parameterName, context);
        case 'github':
          return await this.getGitHubOptions(userId, parameterName, context);
        case 'gmail':
        case 'google':
          return await this.getGmailOptions(userId, parameterName);
        case 'drive':
          return await this.getDriveOptions(userId, parameterName);
        case 'calendar':
          return await this.getCalendarOptions(userId, parameterName);
        case 'sheets':
          return await this.getSheetsOptions(userId, parameterName);
        case 'docs':
        case 'gdocs':
          return await this.getDocsOptions(userId, parameterName);
        default:
          return [];
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to fetch options for parameter', {
        component: 'IntegrationOptionProvider',
        error: errorMessage,
        userId,
        integration,
        parameterName,
      });
      return [];
    }
  }

  /**
   * Get Vercel-specific options
   */
  private static async getVercelOptions(
    userId: string,
    parameterName: string,
    context?: Record<string, unknown>
  ): Promise<SelectionOption[]> {
    const { VercelConnection } = await import('../models/VercelConnection');
    const { VercelService } = await import('./vercel.service');

    const connection = await VercelConnection.findOne({
      userId,
      isActive: true,
    });

    if (!connection) {
      return [];
    }

    const connectionId = connection._id.toString();

    switch (parameterName) {
      case 'projectName':
      case 'project': {
        const projects = await VercelService.getProjects(connectionId, true);
        return projects.map((p: { id: string; name: string; framework?: string }) => ({
          id: p.id,
          label: p.name,
          value: p.name,
          description: p.framework ?? 'Vercel Project',
          icon: 'vercel',
        }));
      }

      case 'deploymentId':
      case 'deployment': {
        // Need projectName from context to list deployments
        const projectName = context?.projectName as string | undefined;
        if (!projectName) {
          return [];
        }
        
        try {
          const project = await VercelService.getProject(connectionId, projectName);
          const deployments = await VercelService.getDeployments(connectionId, project.id, 10);
          return deployments.map((d: { uid: string; url?: string; state: string; createdAt: number }) => ({
            id: d.uid,
            label: d.url ?? d.uid,
            value: d.uid,
            description: `${d.state} - ${new Date(d.createdAt).toLocaleDateString()}`,
            icon: d.state === 'READY' ? 'check' : 'clock',
          }));
        } catch {
          return [];
        }
      }

      case 'target': {
        return [
          { id: 'production', label: 'Production', value: 'production', icon: 'globe', description: 'Live production environment' },
          { id: 'preview', label: 'Preview', value: 'preview', icon: 'eye', description: 'Preview deployments' },
          { id: 'development', label: 'Development', value: 'development', icon: 'code', description: 'Development environment' },
        ];
      }

      default:
        return [];
    }
  }

  /**
   * Get Slack-specific options
   */
  private static async getSlackOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { IntegrationService } = await import('./integration.service');
    const { SlackService } = await import('./slack.service');

    const integrations = await IntegrationService.getUserIntegrations(userId, { status: 'active' });
    const slackIntegration = integrations.find(i => 
      i.type === 'slack_oauth' || i.type === 'slack_webhook'
    );

    if (!slackIntegration) {
      return [];
    }

    const credentials = slackIntegration.getCredentials();
    if (!credentials.accessToken) {
      return [];
    }

    switch (parameterName) {
      case 'channelId':
      case 'channel': {
        try {
          const channels = await SlackService.listChannels(credentials.accessToken);
          return channels.map((c: { id: string; name: string; is_private?: boolean }) => ({
            id: c.id,
            label: `#${c.name}`,
            value: c.id,
            description: c.is_private ? 'Private channel' : 'Public channel',
            icon: c.is_private ? 'lock' : 'hash',
          }));
        } catch {
          return [];
        }
      }

      case 'userId':
      case 'user': {
        try {
          const users = await SlackService.listUsers(credentials.accessToken);
          return users.map((u: { id: string; real_name?: string; name: string; is_bot?: boolean }) => ({
            id: u.id,
            label: u.real_name ?? u.name,
            value: u.id,
            description: u.is_bot ? 'Bot' : 'User',
            icon: 'user',
          }));
        } catch {
          return [];
        }
      }

      default:
        return [];
    }
  }

  /**
   * Get Discord-specific options
   */
  private static async getDiscordOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { IntegrationService } = await import('./integration.service');
    const { DiscordService } = await import('./discord.service');

    const integrations = await IntegrationService.getUserIntegrations(userId, { status: 'active' });
    const discordIntegration = integrations.find(i => 
      i.type === 'discord_oauth' || i.type === 'discord_webhook'
    );

    if (!discordIntegration) {
      return [];
    }

    const credentials = discordIntegration.getCredentials();
    if (!credentials.botToken || !credentials.guildId) {
      return [];
    }

    switch (parameterName) {
      case 'channelId':
      case 'channel': {
        try {
          const channels = await DiscordService.listChannels(credentials.botToken, credentials.guildId);
          return channels
            .filter((c: { type: number }) => c.type === 0) // Text channels only
            .map((c: { id: string; name: string }) => ({
              id: c.id,
              label: `#${c.name}`,
              value: c.id,
              description: 'Text channel',
              icon: 'hash',
            }));
        } catch {
          return [];
        }
      }

      case 'userId':
      case 'user': {
        try {
          const members = await DiscordService.listGuildMembers(credentials.botToken, credentials.guildId);
          return members.map((m: { user?: { id: string; username: string }; nick?: string }) => ({
            id: m.user?.id ?? '',
            label: m.nick ?? m.user?.username ?? 'Unknown',
            value: m.user?.id ?? '',
            description: `@${m.user?.username ?? 'unknown'}`,
            icon: 'user',
          }));
        } catch {
          return [];
        }
      }

      default:
        return [];
    }
  }

  /**
   * Get Jira-specific options
   */
  private static async getJiraOptions(
    userId: string,
    parameterName: string,
    context?: Record<string, unknown>
  ): Promise<SelectionOption[]> {
    const { IntegrationService } = await import('./integration.service');
    const { JiraService } = await import('./jira.service');

    const integrations = await IntegrationService.getUserIntegrations(userId, { status: 'active' });
    const jiraIntegration = integrations.find(i => i.type === 'jira_oauth');

    if (!jiraIntegration) {
      return [];
    }

    const credentials = jiraIntegration.getCredentials();
    const siteUrlOrCloudId = credentials.cloudId ?? credentials.siteUrl ?? '';
    const accessToken = credentials.accessToken ?? '';
    const useCloudId = !!credentials.cloudId;

    if (!siteUrlOrCloudId || !accessToken) {
      return [];
    }

    switch (parameterName) {
      case 'projectKey':
      case 'project': {
        try {
          const projects = await JiraService.listProjects(siteUrlOrCloudId, accessToken, useCloudId);
          return projects.map((p: { key: string; name: string }) => ({
            id: p.key,
            label: p.name,
            value: p.key,
            description: p.key,
            icon: 'folder',
          }));
        } catch {
          return [];
        }
      }

      case 'issueType': {
        return [
          { id: 'task', label: 'Task', value: 'Task', icon: 'check', description: 'A task to be done' },
          { id: 'bug', label: 'Bug', value: 'Bug', icon: 'code', description: 'A bug or defect' },
          { id: 'story', label: 'Story', value: 'Story', icon: 'folder', description: 'A user story' },
          { id: 'epic', label: 'Epic', value: 'Epic', icon: 'globe', description: 'A large body of work' },
        ];
      }

      case 'status': {
        return [
          { id: 'todo', label: 'To Do', value: 'To Do', icon: 'clock' },
          { id: 'in_progress', label: 'In Progress', value: 'In Progress', icon: 'code' },
          { id: 'done', label: 'Done', value: 'Done', icon: 'check' },
        ];
      }

      case 'priority': {
        return [
          { id: 'highest', label: 'Highest', value: 'Highest', icon: 'globe', description: 'Critical priority' },
          { id: 'high', label: 'High', value: 'High', icon: 'code' },
          { id: 'medium', label: 'Medium', value: 'Medium', icon: 'folder' },
          { id: 'low', label: 'Low', value: 'Low', icon: 'clock' },
          { id: 'lowest', label: 'Lowest', value: 'Lowest', icon: 'user' },
        ];
      }

      case 'assignee': {
        const projectKey = context?.projectKey as string | undefined;
        if (!projectKey) return [];
        
        try {
          const users = await JiraService.getProjectUsers(siteUrlOrCloudId, accessToken, projectKey, useCloudId);
          return users.map((u: { accountId: string; displayName: string; emailAddress?: string }) => ({
            id: u.accountId,
            label: u.displayName,
            value: u.accountId,
            description: u.emailAddress,
            icon: 'user',
          }));
        } catch {
          return [];
        }
      }

      default:
        return [];
    }
  }

  /**
   * Get Linear-specific options
   */
  private static async getLinearOptions(
    userId: string,
    parameterName: string,
    context?: Record<string, unknown>
  ): Promise<SelectionOption[]> {
    const { IntegrationService } = await import('./integration.service');
    const { LinearService } = await import('./linear.service');

    const integrations = await IntegrationService.getUserIntegrations(userId, { status: 'active' });
    const linearIntegration = integrations.find(i => i.type === 'linear_oauth');

    if (!linearIntegration) {
      return [];
    }

    const credentials = linearIntegration.getCredentials();
    if (!credentials.accessToken) {
      return [];
    }

    switch (parameterName) {
      case 'teamId':
      case 'team': {
        try {
          const teams = await LinearService.listTeams(credentials.accessToken);
          return teams.map((t: { id: string; name: string; key: string }) => ({
            id: t.id,
            label: t.name,
            value: t.id,
            description: t.key,
            icon: 'users',
          }));
        } catch {
          return [];
        }
      }

      case 'projectId':
      case 'project': {
        const teamId = context?.teamId as string | undefined;
        if (!teamId) return []; // teamId is required for listProjects
        try {
          const projects = await LinearService.listProjects(credentials.accessToken, teamId);
          return projects.map((p) => ({
            id: p.id,
            label: p.name,
            value: p.id,
            description: p.description ?? 'Project',
            icon: 'folder',
          }));
        } catch {
          return [];
        }
      }

      case 'stateId':
      case 'status': {
        const teamId = context?.teamId as string | undefined;
        if (!teamId) return [];
        
        try {
          const states = await LinearService.listWorkflows(credentials.accessToken, teamId);
          return states.map((s: { id: string; name: string; type: string }) => ({
            id: s.id,
            label: s.name,
            value: s.id,
            description: s.type,
            icon: s.type === 'completed' ? 'check' : 'clock',
          }));
        } catch {
          return [];
        }
      }

      case 'priority': {
        return [
          { id: '0', label: 'No Priority', value: '0', icon: 'folder' },
          { id: '1', label: 'Urgent', value: '1', icon: 'globe', description: 'Needs immediate attention' },
          { id: '2', label: 'High', value: '2', icon: 'code' },
          { id: '3', label: 'Medium', value: '3', icon: 'folder' },
          { id: '4', label: 'Low', value: '4', icon: 'clock' },
        ];
      }

      default:
        return [];
    }
  }

  /**
   * Get GitHub-specific options
   */
  private static async getGitHubOptions(
    userId: string,
    parameterName: string,
    context?: Record<string, unknown>
  ): Promise<SelectionOption[]> {
    const { GitHubConnection } = await import('../models/GitHubConnection');
    const { GitHubService } = await import('./github.service');

    const connection = await GitHubConnection.findOne({
      userId,
      isActive: true,
    }).select('+accessToken');

    if (!connection) {
      return [];
    }

    switch (parameterName) {
      case 'repo':
      case 'repository': {
        try {
          // Use a type-safe approach
          const connectionWithToken = connection as unknown as { decryptToken: () => string };
          const repos = await GitHubService.listUserRepositories(connectionWithToken as Parameters<typeof GitHubService.listUserRepositories>[0]);
          return repos.map((r) => ({
            id: r.fullName,
            label: r.fullName,
            value: r.name,
            description: r.description ?? 'Repository',
            icon: 'git-branch',
            metadata: { owner: r.fullName.split('/')[0] },
          }));
        } catch {
          return [];
        }
      }

      case 'owner': {
        try {
          const connectionWithToken = connection as unknown as { decryptToken: () => string };
          const user = await GitHubService.getAuthenticatedUser(connectionWithToken.decryptToken());
          return [
            {
              id: user.login,
              label: user.login,
              value: user.login,
              description: 'Your account',
              icon: 'user',
            },
          ];
        } catch {
          return [];
        }
      }

      case 'head':
      case 'base':
      case 'branch': {
        const owner = context?.owner as string | undefined;
        const repo = context?.repo as string | undefined;
        if (!owner || !repo) {
          return [];
        }
        
        try {
          const { Octokit } = await import('@octokit/rest');
          const connectionWithToken = connection as unknown as { decryptToken: () => string };
          const octokit = new Octokit({ auth: connectionWithToken.decryptToken() });
          const { data: branches } = await octokit.rest.repos.listBranches({
            owner,
            repo,
            per_page: 50,
          });
          return branches.map((b) => ({
            id: b.name,
            label: b.name,
            value: b.name,
            description: b.protected ? 'Protected' : 'Branch',
            icon: 'git-branch',
          }));
        } catch {
          return [];
        }
      }

      case 'state': {
        return [
          { id: 'open', label: 'Open', value: 'open', icon: 'folder', description: 'Open issues/PRs' },
          { id: 'closed', label: 'Closed', value: 'closed', icon: 'check', description: 'Closed issues/PRs' },
          { id: 'all', label: 'All', value: 'all', icon: 'globe', description: 'All issues/PRs' },
        ];
      }

      default:
        return [];
    }
  }

  /**
   * Get Gmail-specific options
   */
  private static async getGmailOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { GoogleConnection } = await import('../models/GoogleConnection');

    const connection = await GoogleConnection.findOne({
      userId,
      isActive: true,
    });

    if (!connection) {
      return [];
    }

    switch (parameterName) {
      case 'label':
      case 'folder': {
        return [
          { id: 'INBOX', label: 'Inbox', value: 'INBOX', icon: 'folder' },
          { id: 'SENT', label: 'Sent', value: 'SENT', icon: 'check' },
          { id: 'DRAFT', label: 'Drafts', value: 'DRAFT', icon: 'clock' },
          { id: 'STARRED', label: 'Starred', value: 'STARRED', icon: 'globe' },
          { id: 'IMPORTANT', label: 'Important', value: 'IMPORTANT', icon: 'code' },
          { id: 'SPAM', label: 'Spam', value: 'SPAM', icon: 'lock' },
          { id: 'TRASH', label: 'Trash', value: 'TRASH', icon: 'user' },
        ];
      }

      // Gmail typically doesn't have predefined options for recipients
      // Users enter custom values
      default:
        return [];
    }
  }

  /**
   * Get Google Drive-specific options
   */
  private static async getDriveOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { GoogleConnection } = await import('../models/GoogleConnection');
    const { GoogleService } = await import('./google.service');

    const connection = await GoogleConnection.findOne({
      userId,
      isActive: true,
    }).select('+accessToken +refreshToken');

    if (!connection) {
      return [];
    }

    switch (parameterName) {
      case 'folderId':
      case 'folder':
      case 'parentFolderId': {
        try {
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType='application/vnd.google-apps.folder'",
          });
          return files.map((f: { id: string; name: string }) => ({
            id: f.id,
            label: f.name,
            value: f.id,
            description: 'Folder',
            icon: 'folder',
          }));
        } catch {
          return [];
        }
      }

      case 'fileId':
      case 'file': {
        try {
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType!='application/vnd.google-apps.folder'",
          });
          return files.map((f: { id: string; name: string; mimeType?: string }) => ({
            id: f.id,
            label: f.name,
            value: f.id,
            description: f.mimeType?.split('.').pop() ?? 'File',
            icon: 'folder',
          }));
        } catch {
          return [];
        }
      }

      case 'mimeType': {
        return [
          { id: 'document', label: 'Google Doc', value: 'application/vnd.google-apps.document', icon: 'folder' },
          { id: 'spreadsheet', label: 'Google Sheet', value: 'application/vnd.google-apps.spreadsheet', icon: 'folder' },
          { id: 'presentation', label: 'Google Slides', value: 'application/vnd.google-apps.presentation', icon: 'folder' },
          { id: 'form', label: 'Google Form', value: 'application/vnd.google-apps.form', icon: 'folder' },
          { id: 'pdf', label: 'PDF', value: 'application/pdf', icon: 'folder' },
        ];
      }

      case 'role': {
        return [
          { id: 'reader', label: 'Viewer', value: 'reader', icon: 'eye', description: 'Can view only' },
          { id: 'commenter', label: 'Commenter', value: 'commenter', icon: 'user', description: 'Can view and comment' },
          { id: 'writer', label: 'Editor', value: 'writer', icon: 'code', description: 'Can edit' },
        ];
      }

      default:
        return [];
    }
  }

  /**
   * Get Google Sheets-specific options
   */
  private static async getSheetsOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { GoogleConnection } = await import('../models/GoogleConnection');
    const { GoogleService } = await import('./google.service');

    const connection = await GoogleConnection.findOne({
      userId,
      isActive: true,
    }).select('+accessToken +refreshToken');

    if (!connection) {
      return [];
    }

    switch (parameterName) {
      case 'spreadsheetId':
      case 'spreadsheet': {
        try {
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType='application/vnd.google-apps.spreadsheet'",
          });
          return files.map((f: { id: string; name: string }) => ({
            id: f.id,
            label: f.name,
            value: f.id,
            description: 'Spreadsheet',
            icon: 'folder',
          }));
        } catch {
          return [];
        }
      }

      default:
        return [];
    }
  }

  /**
   * Get Google Docs-specific options
   */
  private static async getDocsOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { GoogleConnection } = await import('../models/GoogleConnection');
    const { GoogleService } = await import('./google.service');

    const connection = await GoogleConnection.findOne({
      userId,
      isActive: true,
    }).select('+accessToken +refreshToken');

    if (!connection) {
      return [];
    }

    switch (parameterName) {
      case 'documentId':
      case 'document': {
        try {
          const { files } = await GoogleService.listDriveFiles(connection, {
            query: "mimeType='application/vnd.google-apps.document'",
          });
          return files.map((f: { id: string; name: string }) => ({
            id: f.id,
            label: f.name,
            value: f.id,
            description: 'Document',
            icon: 'folder',
          }));
        } catch {
          return [];
        }
      }

      default:
        return [];
    }
  }

  /**
   * Get Google Calendar-specific options
   */
  private static async getCalendarOptions(
    userId: string,
    parameterName: string
  ): Promise<SelectionOption[]> {
    const { GoogleConnection } = await import('../models/GoogleConnection');
    const { GoogleService } = await import('./google.service');

    const connection = await GoogleConnection.findOne({
      userId,
      isActive: true,
    }).select('+accessToken +refreshToken');

    if (!connection) {
      return [];
    }

    switch (parameterName) {
      case 'calendarId':
      case 'calendar': {
        // Return primary calendar as default option since listCalendars is not implemented
        return [
          {
            id: 'primary',
            label: 'Primary Calendar',
            value: 'primary',
            description: 'Your default calendar',
            icon: 'clock',
          },
        ];
      }

      case 'eventId':
      case 'event': {
        try {
          const events = await GoogleService.listCalendarEvents(connection, {
            maxResults: 20,
          });
          return events.map((e: { id: string; summary?: string; start?: { dateTime?: string; date?: string } }) => ({
            id: e.id,
            label: e.summary ?? 'Untitled Event',
            value: e.id,
            description: e.start?.dateTime ?? e.start?.date ?? 'Event',
            icon: 'clock',
          }));
        } catch {
          return [];
        }
      }

      default:
        return [];
    }
  }

  /**
   * Check if a parameter typically has options that can be fetched
   */
  static hasOptionsForParameter(integration: string, parameterName: string): boolean {
    const optionableParams: Record<string, string[]> = {
      vercel: ['projectName', 'project', 'deploymentId', 'deployment', 'target'],
      slack: ['channelId', 'channel', 'userId', 'user'],
      discord: ['channelId', 'channel', 'userId', 'user'],
      jira: ['projectKey', 'project', 'issueType', 'status', 'priority', 'assignee'],
      linear: ['teamId', 'team', 'projectId', 'project', 'stateId', 'status', 'priority'],
      github: ['repo', 'repository', 'owner', 'head', 'base', 'branch', 'state'],
      gmail: ['label', 'folder'],
      drive: ['folderId', 'folder', 'parentFolderId', 'fileId', 'file', 'mimeType', 'role'],
      sheets: ['spreadsheetId', 'spreadsheet'],
      docs: ['documentId', 'document'],
      gdocs: ['documentId', 'document'],
      calendar: ['calendarId', 'calendar', 'eventId', 'event'],
    };

    return optionableParams[integration]?.includes(parameterName) ?? false;
  }

  /**
   * Get the display name for an integration
   */
  static getIntegrationDisplayName(integration: string): string {
    const displayNames: Record<string, string> = {
      vercel: 'Vercel',
      slack: 'Slack',
      discord: 'Discord',
      jira: 'Jira',
      linear: 'Linear',
      github: 'GitHub',
      gmail: 'Gmail',
      google: 'Google',
      drive: 'Google Drive',
      sheets: 'Google Sheets',
      docs: 'Google Docs',
      gdocs: 'Google Docs',
      calendar: 'Google Calendar',
    };

    return displayNames[integration] || integration.charAt(0).toUpperCase() + integration.slice(1);
  }
}
