/**
 * JIRA integration service – production implementation.
 * OAuth, REST API, issues, comments; supports cloudId (OAuth) and siteUrl (API token).
 */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { formatCurrency } from '../../../utils/helpers';

const JIRA_OAUTH_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const JIRA_CLOUD_API_PREFIX = 'https://api.atlassian.com/ex/jira';

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  simplified?: boolean;
  avatarUrls?: Record<string, string>;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface JiraUser {
  accountId: string;
  accountType: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { id: string; name: string };
    priority?: { id: string; name: string };
    assignee?: { displayName?: string };
    created?: string;
    updated?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
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
export class JiraService {
  private readonly logger = new Logger(JiraService.name);

  constructor(private readonly httpService: HttpService) {}

  private baseUrl(siteUrlOrCloudId: string, useCloudId: boolean): string {
    if (useCloudId) {
      return `${JIRA_CLOUD_API_PREFIX}/${siteUrlOrCloudId}/rest/api/3`;
    }
    const base = siteUrlOrCloudId.endsWith('/')
      ? siteUrlOrCloudId.slice(0, -1)
      : siteUrlOrCloudId;
    return `${base}/rest/api/3`;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    siteUrlOrCloudId: string,
    accessToken: string,
    path: string,
    body?: unknown,
    useCloudId = false,
  ): Promise<T> {
    const url = `${this.baseUrl(siteUrlOrCloudId, useCloudId)}${path.startsWith('/') ? path : `/${path}`}`;
    const config: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      url: string;
      headers: Record<string, string>;
      data?: unknown;
      timeout: number;
    } = {
      method,
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    };
    if (body !== undefined && method !== 'GET') config.data = body;
    const res = await firstValueFrom(this.httpService.request<T>(config));
    return res.data;
  }

  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<JiraOAuthTokenResponse> {
    const { data } = await firstValueFrom(
      this.httpService.post(
        JIRA_OAUTH_TOKEN_URL,
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
      ),
    );
    this.logger.log('JIRA OAuth token exchange successful');
    return data;
  }

  async getAuthenticatedUser(
    siteUrlOrCloudId: string,
    accessToken: string,
    useCloudId = false,
  ): Promise<JiraUser> {
    return this.request<JiraUser>(
      'GET',
      siteUrlOrCloudId,
      accessToken,
      '/myself',
      undefined,
      useCloudId,
    );
  }

  async listProjects(
    siteUrlOrCloudId: string,
    accessToken: string,
    useCloudId = false,
  ): Promise<JiraProject[]> {
    const data = await this.request<JiraProject[] | undefined>(
      'GET',
      siteUrlOrCloudId,
      accessToken,
      '/project',
      undefined,
      useCloudId,
    );
    return data ?? [];
  }

  async getIssueTypes(
    siteUrlOrCloudId: string,
    accessToken: string,
    projectKey: string,
    useCloudId = false,
  ): Promise<JiraIssueType[]> {
    const data = await this.request<{
      projects?: Array<{ issuetypes?: JiraIssueType[] }>;
    }>(
      'GET',
      siteUrlOrCloudId,
      accessToken,
      `/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`,
      undefined,
      useCloudId,
    );
    const project = data?.projects?.[0];
    return project?.issuetypes ?? [];
  }

  async listPriorities(
    siteUrlOrCloudId: string,
    accessToken: string,
    useCloudId = false,
  ): Promise<JiraPriority[]> {
    const data = await this.request<JiraPriority[] | undefined>(
      'GET',
      siteUrlOrCloudId,
      accessToken,
      '/priority',
      undefined,
      useCloudId,
    );
    return data ?? [];
  }

  async getIssue(
    siteUrlOrCloudId: string,
    accessToken: string,
    issueKey: string,
    useCloudId = false,
  ): Promise<JiraIssue | null> {
    try {
      return await this.request<JiraIssue>(
        'GET',
        siteUrlOrCloudId,
        accessToken,
        `/issue/${encodeURIComponent(issueKey)}`,
        undefined,
        useCloudId,
      );
    } catch {
      return null;
    }
  }

  async createIssue(
    siteUrlOrCloudId: string,
    accessToken: string,
    options: {
      projectKey: string;
      title: string;
      description?: string;
      issueTypeId: string;
      priorityId?: string;
      labels?: string[];
      useCloudId?: boolean;
    },
  ): Promise<JiraIssue> {
    const useCloudId = options.useCloudId ?? false;
    const fields: Record<string, unknown> = {
      project: { key: options.projectKey },
      summary: options.title,
      issuetype: { id: options.issueTypeId },
    };
    if (options.description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: this.textToAdfContent(options.description),
      };
    }
    if (options.priorityId) {
      fields.priority = { id: options.priorityId };
    }
    if (options.labels?.length) {
      fields.labels = options.labels;
    }
    return this.request<JiraIssue>(
      'POST',
      siteUrlOrCloudId,
      accessToken,
      '/issue',
      { fields },
      useCloudId,
    );
  }

  async listIssues(
    siteUrlOrCloudId: string,
    accessToken: string,
    projectKey: string,
    filters?: { status?: string; maxResults?: number; startAt?: number },
    useCloudId = false,
  ): Promise<{ issues: JiraIssue[]; total: number }> {
    let jql = `project = "${projectKey}" ORDER BY created DESC`;
    if (filters?.status) {
      jql = `project = "${projectKey}" AND status = "${filters.status}" ORDER BY created DESC`;
    }
    const data = await this.request<{ issues: JiraIssue[]; total: number }>(
      'GET',
      siteUrlOrCloudId,
      accessToken,
      `/search?jql=${encodeURIComponent(jql)}&maxResults=${filters?.maxResults ?? 50}&startAt=${filters?.startAt ?? 0}&fields=summary,status,priority,assignee,created,updated`,
      undefined,
      useCloudId,
    );
    return { issues: data?.issues ?? [], total: data?.total ?? 0 };
  }

  async addComment(
    siteUrlOrCloudId: string,
    accessToken: string,
    issueKey: string,
    commentText: string,
    useCloudId = false,
  ): Promise<{ success: boolean; commentId?: string }> {
    await this.request(
      'POST',
      siteUrlOrCloudId,
      accessToken,
      `/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        body: {
          type: 'doc',
          version: 1,
          content: this.textToAdfContent(commentText),
        },
      },
      useCloudId,
    );
    return { success: true };
  }

  private textToAdfContent(text: string): unknown[] {
    const lines = text.split('\n');
    const content: unknown[] = [];
    for (const line of lines) {
      if (line.trim()) {
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: line }],
        });
      } else {
        content.push({ type: 'paragraph', content: [] });
      }
    }
    return content.length > 0
      ? content
      : [{ type: 'paragraph', content: [{ type: 'text', text }] }];
  }

  formatAlertMessage(alert: AlertLike, dashboardUrl?: string): string {
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    const ts =
      alert.createdAt instanceof Date
        ? alert.createdAt
        : new Date(alert.createdAt as unknown as string);
    let msg = `${severityEmoji} *${alert.title}*\n\n${alert.message}\n\n`;
    msg += `*Type:* ${this.formatAlertType(alert.type)}\n*Severity:* ${alert.severity.toUpperCase()}\n*Time:* ${ts.toISOString()}\n\n`;
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
        msg += `*Cost Details*\n\n• Current Cost: ${formatCurrency(alert.data.currentValue as number)}\n`;
        msg += `• Threshold: ${formatCurrency(alert.data.threshold as number)}\n• Usage: ${Number(pct).toFixed(1)}%\n\n`;
      }
    }
    if (dashboardUrl) {
      msg += `---\n\n[View in CostKatana Dashboard|${dashboardUrl}]`;
      if (alert.actionRequired)
        msg += ` | [Take Action|${dashboardUrl}/alerts/${alert._id}]`;
    }
    msg += `\n\n_Alert ID: ${alert._id}_`;
    return msg;
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
    let description = `${alert.message}\n\n*Alert Type:* ${this.formatAlertType(alert.type)}\n*Severity:* ${alert.severity.toUpperCase()}\n*Created:* ${ts.toISOString()}\n\n`;
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
        description += `*Cost Details*\n\n• Current: ${formatCurrency(alert.data.currentValue as number)}\n`;
        description += `• Threshold: ${formatCurrency(alert.data.threshold as number)}\n• Usage: ${Number(pct).toFixed(1)}%\n`;
      }
    }
    if (dashboardUrl)
      description += `\n\n[View Details in CostKatana|${dashboardUrl}/alerts/${alert._id}]`;
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
    siteUrlOrCloudId: string,
    accessToken: string,
    issueKey: string,
    alert: AlertLike,
    dashboardUrl?: string,
    useCloudId = false,
  ): Promise<{ success: boolean; responseTime: number; commentId?: string }> {
    const start = Date.now();
    const commentText = this.formatAlertMessage(alert, dashboardUrl);
    await this.request(
      'POST',
      siteUrlOrCloudId,
      accessToken,
      `/issue/${issueKey}/comment`,
      {
        body: {
          type: 'doc',
          version: 1,
          content: this.textToAdfContent(commentText),
        },
      },
      useCloudId,
    );
    const responseTime = Date.now() - start;
    this.logger.log('JIRA comment sent', { issueKey });
    return { success: true, responseTime };
  }

  async createIssueFromAlert(
    siteUrlOrCloudId: string,
    accessToken: string,
    projectKey: string,
    issueTypeId: string,
    alert: AlertLike,
    dashboardUrl?: string,
    priorityId?: string,
    labels?: string[],
    components?: Array<{ id: string }>,
    useCloudId = false,
    siteUrlForBrowse?: string,
  ): Promise<{
    success: boolean;
    responseTime: number;
    issueKey?: string;
    issueUrl?: string;
  }> {
    const start = Date.now();
    const issueData = this.formatIssueFromAlert(alert, dashboardUrl);
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary: issueData.title,
      description: {
        type: 'doc',
        version: 1,
        content: this.textToAdfContent(issueData.description),
      },
      issuetype: { id: issueTypeId },
    };
    if (priorityId) fields.priority = { id: priorityId };
    if (labels?.length) fields.labels = labels;
    if (components?.length) fields.components = components;
    const created = await this.request<{ key: string }>(
      'POST',
      siteUrlOrCloudId,
      accessToken,
      '/issue',
      { fields },
      useCloudId,
    );
    const responseTime = Date.now() - start;
    const issueKey = created.key;
    const baseForUrl =
      siteUrlForBrowse ?? (useCloudId ? undefined : siteUrlOrCloudId);
    const issueUrl = baseForUrl
      ? `${baseForUrl.replace(/\/$/, '')}/browse/${issueKey}`
      : undefined;
    this.logger.log('JIRA issue created', { projectKey, issueKey });
    return { success: true, responseTime, issueKey, issueUrl };
  }

  async updateIssue(
    siteUrlOrCloudId: string,
    accessToken: string,
    issueKey: string,
    updates: {
      summary?: string;
      description?: string;
      priorityId?: string;
      labels?: string[];
    },
    useCloudId = false,
  ): Promise<{ success: boolean; responseTime: number }> {
    const start = Date.now();
    const fields: Record<string, unknown> = {};
    if (updates.summary !== undefined) fields.summary = updates.summary;
    if (updates.description !== undefined)
      fields.description = updates.description;
    if (updates.priorityId !== undefined)
      fields.priority = { id: updates.priorityId };
    if (updates.labels !== undefined) fields.labels = updates.labels;
    if (Object.keys(fields).length === 0)
      throw new Error('No update fields provided');
    await this.request(
      'PUT',
      siteUrlOrCloudId,
      accessToken,
      `/issue/${issueKey}`,
      { fields },
      useCloudId,
    );
    const responseTime = Date.now() - start;
    return { success: true, responseTime };
  }

  async testIntegration(
    siteUrlOrCloudId: string,
    accessToken: string,
    projectKey: string,
    useCloudId = false,
  ): Promise<{ success: boolean; message: string; responseTime: number }> {
    const start = Date.now();
    try {
      const project = await this.request<{ name?: string } | undefined>(
        'GET',
        siteUrlOrCloudId,
        accessToken,
        `/project/${projectKey}`,
        undefined,
        useCloudId,
      );
      const responseTime = Date.now() - start;
      if (!project) throw new Error('Project not found');
      return {
        success: true,
        message: `Successfully connected to JIRA project: ${(project as { name?: string }).name ?? projectKey}`,
        responseTime,
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - start;
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to test JIRA connection',
        responseTime,
      };
    }
  }
}
