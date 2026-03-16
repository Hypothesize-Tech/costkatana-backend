/**
 * Linear integration service – production implementation.
 * OAuth, GraphQL API, issues, comments, format alerts.
 */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { formatCurrency } from '../../../utils/helpers';

const LINEAR_API_BASE = 'https://api.linear.app/graphql';
const LINEAR_OAUTH_BASE = 'https://api.linear.app';

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
  description?: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface LinearIssue {
  id: string;
  title: string;
  description?: string;
  identifier: string;
  url?: string;
  state?: { id: string; name: string; type: string };
}

export interface LinearOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email?: string;
  active: boolean;
}

export interface AlertLike {
  _id: unknown;
  title: string;
  message: string;
  type: string;
  severity: string;
  createdAt: Date;
  data: Record<string, unknown>;
  actionRequired?: boolean;
}

@Injectable()
export class LinearService {
  private readonly logger = new Logger(LinearService.name);

  constructor(private readonly httpService: HttpService) {}

  private async executeQuery<T>(
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        LINEAR_API_BASE,
        { query, variables },
        {
          headers: {
            Authorization: accessToken,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
    if (data?.errors?.length) {
      throw new Error(
        `Linear API error: ${data.errors[0]?.message ?? 'Unknown error'}`,
      );
    }
    return data?.data as T;
  }

  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<LinearOAuthTokenResponse> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        `${LINEAR_OAUTH_BASE}/oauth/token`,
        {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
      ),
    );
    this.logger.log('Linear OAuth token exchange successful');
    return data;
  }

  async getAuthenticatedUser(accessToken: string): Promise<LinearUser> {
    const data = await this.executeQuery<{ viewer: LinearUser }>(
      accessToken,
      `query { viewer { id name email active } }`,
    );
    return data.viewer;
  }

  async listTeams(accessToken: string): Promise<LinearTeam[]> {
    const data = await this.executeQuery<{ teams: { nodes: LinearTeam[] } }>(
      accessToken,
      `query { teams { nodes { id name key description } } }`,
    );
    return data.teams?.nodes ?? [];
  }

  async listProjects(
    accessToken: string,
    teamId: string,
  ): Promise<LinearProject[]> {
    const data = await this.executeQuery<{
      team: { projects: { nodes: LinearProject[] } };
    }>(
      accessToken,
      `query($teamId: String!) { team(id: $teamId) { projects { nodes { id name description icon } } } }`,
      { teamId },
    );
    return data.team?.projects?.nodes ?? [];
  }

  async listTeamMembers(
    accessToken: string,
    teamId: string,
  ): Promise<Array<{ id: string; name: string; displayName?: string; email?: string }>> {
    const data = await this.executeQuery<{
      team: {
        members: {
          nodes: Array<{
            id: string;
            user?: {
              id: string;
              name?: string;
              displayName?: string;
              email?: string;
            };
          }>;
        };
      };
    }>(
      accessToken,
      `query($teamId: String!) { team(id: $teamId) { members { nodes { id user { id name displayName email } } } } }`,
      { teamId },
    );
    return (data.team?.members?.nodes ?? [])
      .filter((m) => m.user)
      .map((m) => ({
        id: m.user!.id,
        name: m.user!.name ?? m.user!.displayName ?? 'Unknown',
        displayName: m.user!.displayName,
        email: m.user!.email,
      }));
  }

  async listLabels(
    accessToken: string,
    teamId?: string,
  ): Promise<Array<{ id: string; name: string; color?: string; description?: string }>> {
    if (teamId) {
      const data = await this.executeQuery<{
        team: {
          labels: { nodes: Array<{ id: string; name: string; color?: string; description?: string }> };
        };
      }>(
        accessToken,
        `query($teamId: String!) { team(id: $teamId) { labels { nodes { id name color description } } } }`,
        { teamId },
      );
      return data.team?.labels?.nodes ?? [];
    }
    const data = await this.executeQuery<{
      issueLabels: { nodes: Array<{ id: string; name: string; color?: string; description?: string }> };
    }>(
      accessToken,
      `query { issueLabels { nodes { id name color description } } }`,
    );
    return data.issueLabels?.nodes ?? [];
  }

  async listIterations(
    accessToken: string,
    teamId: string,
  ): Promise<Array<{ id: string; name: string; startDate?: string; endDate?: string }>> {
    const data = await this.executeQuery<{
      team: {
        cycles: {
          nodes: Array<{
            id: string;
            name: string;
            startDate?: string;
            endDate?: string;
          }>;
        };
      };
    }>(
      accessToken,
      `query($teamId: String!) { team(id: $teamId) { cycles { nodes { id name startDate endDate } } } }`,
      { teamId },
    );
    return data.team?.cycles?.nodes ?? [];
  }

  async listWorkflowStates(
    accessToken: string,
    teamId: string,
  ): Promise<Array<{ id: string; name: string; type: string }>> {
    const data = await this.executeQuery<{
      team: {
        states: {
          nodes: Array<{ id: string; name: string; type: string }>;
        };
      };
    }>(
      accessToken,
      `query($teamId: String!) { team(id: $teamId) { states { nodes { id name type } } } }`,
      { teamId },
    );
    return data.team?.states?.nodes ?? [];
  }

  async listEpics(
    accessToken: string,
    teamId: string,
  ): Promise<Array<{ id: string; name: string; description?: string }>> {
    const projects = await this.listProjects(accessToken, teamId);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
  }

  async getIssue(
    accessToken: string,
    issueId: string,
  ): Promise<LinearIssue | null> {
    const data = await this.executeQuery<{ issue: LinearIssue | null }>(
      accessToken,
      `query($issueId: String!) { issue(id: $issueId) { id title description identifier url state { id name type } } }`,
      { issueId },
    );
    return data.issue ?? null;
  }

  async createIssue(
    accessToken: string,
    options: {
      teamId: string;
      title: string;
      description?: string;
      projectId?: string;
    },
  ): Promise<LinearIssue> {
    const variables: Record<string, unknown> = {
      teamId: options.teamId,
      title: options.title,
      description: options.description ?? null,
    };
    if (options.projectId) variables.projectId = options.projectId;
    const mutation = options.projectId
      ? `mutation($teamId: String!, $title: String!, $description: String, $projectId: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description, projectId: $projectId }) { success issue { id title description identifier url state { id name type } } } }`
      : `mutation($teamId: String!, $title: String!, $description: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { id title description identifier url state { id name type } } } }`;
    const data = await this.executeQuery<{
      issueCreate: { success: boolean; issue: LinearIssue | null };
    }>(accessToken, mutation, variables);
    if (!data.issueCreate?.success || !data.issueCreate.issue) {
      throw new Error('Failed to create Linear issue');
    }
    return data.issueCreate.issue;
  }

  async listIssues(
    accessToken: string,
    teamId: string,
    filters?: { limit?: number },
  ): Promise<{ issues: LinearIssue[]; total: number }> {
    const first = filters?.limit ?? 50;
    const data = await this.executeQuery<{
      issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean } };
    }>(
      accessToken,
      `query($teamId: String!, $first: Int!) { issues(filter: { team: { id: { eq: $teamId } } }, first: $first) { nodes { id title description identifier url state { id name type } } pageInfo { hasNextPage } } }`,
      { teamId, first },
    );
    const nodes = data.issues?.nodes ?? [];
    return { issues: nodes, total: nodes.length };
  }

  async addComment(
    accessToken: string,
    issueId: string,
    body: string,
  ): Promise<{ success: boolean; commentId?: string }> {
    const data = await this.executeQuery<{
      commentCreate: { success: boolean; comment?: { id: string } };
    }>(
      accessToken,
      `mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } } }`,
      { issueId, body },
    );
    if (!data.commentCreate?.success) {
      throw new Error('Failed to create comment on Linear issue');
    }
    return { success: true, commentId: data.commentCreate.comment?.id };
  }

  formatAlertMessage(alert: AlertLike, dashboardUrl?: string): string {
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    const ts =
      alert.createdAt instanceof Date
        ? alert.createdAt
        : new Date(alert.createdAt as unknown as string);
    let md = `## ${severityEmoji} ${alert.title}\n\n${alert.message}\n\n`;
    md += `**Type:** ${this.formatAlertType(alert.type)}\n**Severity:** ${alert.severity.toUpperCase()}\n**Time:** ${ts.toISOString()}\n\n`;
    if (alert.type === 'cost_threshold' || alert.type === 'cost') {
      if (
        alert.data?.currentValue !== undefined &&
        alert.data?.threshold !== undefined
      ) {
        const pct =
          (alert.data.percentage as number) ??
          ((alert.data.currentValue as number) /
            (alert.data.threshold as number)) *
            100;
        md += `### Cost Details\n\n- **Current Cost:** ${formatCurrency(alert.data.currentValue as number)}\n`;
        md += `- **Threshold:** ${formatCurrency(alert.data.threshold as number)}\n- **Usage:** ${Number(pct).toFixed(1)}%\n\n`;
      }
    }
    if (dashboardUrl) {
      md += `---\n\n[View in CostKatana Dashboard](${dashboardUrl})`;
      if (alert.actionRequired)
        md += ` | [Take Action](${dashboardUrl}/alerts/${alert._id})`;
    }
    md += `\n\n*Alert ID: ${alert._id}*`;
    return md;
  }

  formatIssueFromAlert(
    alert: AlertLike,
    dashboardUrl?: string,
  ): { title: string; description: string } {
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    const ts =
      alert.createdAt instanceof Date
        ? alert.createdAt
        : new Date(alert.createdAt as unknown as string);
    const title = `${severityEmoji} [${alert.severity.toUpperCase()}] ${alert.title}`;
    let description = `${alert.message}\n\n**Alert Type:** ${this.formatAlertType(alert.type)}\n**Severity:** ${alert.severity.toUpperCase()}\n**Created:** ${ts.toISOString()}\n\n`;
    if (alert.type === 'cost_threshold' || alert.type === 'cost') {
      if (
        alert.data?.currentValue !== undefined &&
        alert.data?.threshold !== undefined
      ) {
        const pct =
          (alert.data.percentage as number) ??
          ((alert.data.currentValue as number) /
            (alert.data.threshold as number)) *
            100;
        description += `## Cost Details\n\n- Current: ${formatCurrency(alert.data.currentValue as number)}\n`;
        description += `- Threshold: ${formatCurrency(alert.data.threshold as number)}\n- Usage: ${Number(pct).toFixed(1)}%\n`;
      }
    }
    if (dashboardUrl)
      description += `\n\n[View Details in CostKatana](${dashboardUrl}/alerts/${alert._id})`;
    return { title, description };
  }

  private getSeverityEmoji(severity: string): string {
    const map: Record<string, string> = {
      low: '🔵',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };
    return map[severity] ?? '⚪';
  }

  private formatAlertType(type: string): string {
    return type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  async sendAlertComment(
    accessToken: string,
    issueId: string,
    alert: AlertLike,
    dashboardUrl?: string,
  ): Promise<{ success: boolean; responseTime: number; commentId?: string }> {
    const start = Date.now();
    const body = this.formatAlertMessage(alert, dashboardUrl);
    const data = await this.executeQuery<{
      commentCreate: { success: boolean; comment?: { id: string } };
    }>(
      accessToken,
      `mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } } }`,
      { issueId, body },
    );
    const responseTime = Date.now() - start;
    if (!data.commentCreate?.success)
      throw new Error('Failed to create comment on Linear issue');
    this.logger.log(
      `Linear comment sent successfully issueId=${issueId} commentId=${data.commentCreate.comment?.id}`,
    );
    return {
      success: true,
      responseTime,
      commentId: data.commentCreate.comment?.id,
    };
  }

  async createIssueFromAlert(
    accessToken: string,
    teamId: string,
    projectId: string | undefined,
    alert: AlertLike,
    dashboardUrl?: string,
  ): Promise<{
    success: boolean;
    responseTime: number;
    issueId?: string;
    issueUrl?: string;
  }> {
    const start = Date.now();
    const issueData = this.formatIssueFromAlert(alert, dashboardUrl);
    const variables: Record<string, unknown> = {
      teamId,
      title: issueData.title,
      description: issueData.description,
    };
    if (projectId) variables.projectId = projectId;
    const mutation = projectId
      ? `mutation($teamId: String!, $title: String!, $description: String, $projectId: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description, projectId: $projectId }) { success issue { id identifier url title } } }`
      : `mutation($teamId: String!, $title: String!, $description: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { id identifier url title } } }`;
    const data = await this.executeQuery<{
      issueCreate: {
        success: boolean;
        issue?: { id: string; identifier: string; url: string; title: string };
      };
    }>(accessToken, mutation, variables);
    const responseTime = Date.now() - start;
    if (!data.issueCreate?.success || !data.issueCreate.issue)
      throw new Error('Failed to create Linear issue');
    this.logger.log('Linear issue created', {
      teamId,
      issueId: data.issueCreate.issue.id,
    });
    return {
      success: true,
      responseTime,
      issueId: data.issueCreate.issue.id,
      issueUrl: data.issueCreate.issue.url,
    };
  }

  async updateIssue(
    accessToken: string,
    issueId: string,
    updates: {
      title?: string;
      description?: string;
      stateId?: string;
      priority?: number;
    },
  ): Promise<{ success: boolean; responseTime: number }> {
    const start = Date.now();
    const inputFields: string[] = [];
    const variables: Record<string, unknown> = { issueId };
    if (updates.title !== undefined) {
      inputFields.push('title: $title');
      variables.title = updates.title;
    }
    if (updates.description !== undefined) {
      inputFields.push('description: $description');
      variables.description = updates.description;
    }
    if (updates.stateId !== undefined) {
      inputFields.push('stateId: $stateId');
      variables.stateId = updates.stateId;
    }
    if (updates.priority !== undefined) {
      inputFields.push('priority: $priority');
      variables.priority = updates.priority;
    }
    if (inputFields.length === 0) throw new Error('No update fields provided');
    const mutation = `mutation($issueId: String!, ${Object.keys(variables)
      .filter((k) => k !== 'issueId')
      .map((k) => `$${k}: ${k === 'priority' ? 'Int' : 'String'}`)
      .join(
        ', ',
      )}) { issueUpdate(id: $issueId, input: { ${inputFields.join(', ')} }) { success issue { id title } } }`;
    const data = await this.executeQuery<{ issueUpdate: { success: boolean } }>(
      accessToken,
      mutation,
      variables,
    );
    const responseTime = Date.now() - start;
    if (!data.issueUpdate?.success)
      throw new Error('Failed to update Linear issue');
    return { success: true, responseTime };
  }

  async testIntegration(
    accessToken: string,
    teamId: string,
  ): Promise<{ success: boolean; message: string; responseTime: number }> {
    const start = Date.now();
    try {
      const data = await this.executeQuery<{
        team: { id: string; name: string; key: string } | null;
      }>(
        accessToken,
        `query($teamId: String!) { team(id: $teamId) { id name key } }`,
        { teamId },
      );
      const responseTime = Date.now() - start;
      if (!data.team) throw new Error('Team not found');
      return {
        success: true,
        message: `Successfully connected to Linear team: ${data.team.name}`,
        responseTime,
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - start;
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to test Linear connection',
        responseTime,
      };
    }
  }
}
