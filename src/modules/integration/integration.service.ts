import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Integration,
  IntegrationDocument,
  IntegrationType,
  IntegrationCredentials,
} from '../../schemas/integration/integration.schema';
import { SlackService } from './services/slack.service';
import { DiscordService } from './services/discord.service';
import { LinearService } from './services/linear.service';
import { JiraService } from './services/jira.service';
import { GoogleService } from './services/google.service';

export interface CreateIntegrationDto {
  userId: string;
  type: IntegrationType;
  name: string;
  description?: string;
  status?: 'active' | 'inactive' | 'error' | 'pending';
  credentials: IntegrationCredentials;
  alertRouting?: Record<string, unknown>;
  deliveryConfig?: {
    retryEnabled?: boolean;
    maxRetries?: number;
    timeout?: number;
    batchDelay?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface UpdateIntegrationDto {
  name?: string;
  description?: string;
  status?: 'active' | 'inactive' | 'error' | 'pending';
  credentials?: IntegrationCredentials;
  alertRouting?: Record<string, unknown>;
  deliveryConfig?: {
    retryEnabled?: boolean;
    maxRetries?: number;
    timeout?: number;
    batchDelay?: number;
  };
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    @InjectModel(Integration.name)
    private integrationModel: Model<IntegrationDocument>,
    private readonly slackService: SlackService,
    private readonly discordService: DiscordService,
    private readonly linearService: LinearService,
    private readonly jiraService: JiraService,
    private readonly googleService: GoogleService,
  ) {}

  async createIntegration(
    dto: CreateIntegrationDto,
  ): Promise<IntegrationDocument> {
    const integration = new this.integrationModel({
      userId: new Types.ObjectId(dto.userId),
      type: dto.type,
      name: dto.name,
      description: dto.description,
      status: dto.status ?? 'active',
      encryptedCredentials: '',
      alertRouting: dto.alertRouting
        ? new Map(Object.entries(dto.alertRouting))
        : new Map(),
      deliveryConfig: {
        retryEnabled: dto.deliveryConfig?.retryEnabled ?? true,
        maxRetries: dto.deliveryConfig?.maxRetries ?? 3,
        timeout: dto.deliveryConfig?.timeout ?? 30000,
        batchDelay: dto.deliveryConfig?.batchDelay,
      },
      metadata: dto.metadata ?? {},
      stats: {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        averageResponseTime: 0,
      },
    });
    (integration as any).setCredentials(dto.credentials);
    await integration.save();
    this.logger.log('Integration created', {
      integrationId: integration._id,
      userId: dto.userId,
      type: dto.type,
    });
    return integration as IntegrationDocument;
  }

  async getUserIntegrations(
    userId: string,
    filters?: { type?: IntegrationType; status?: string },
  ): Promise<IntegrationDocument[]> {
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (filters?.type) query.type = filters.type;
    if (filters?.status) query.status = filters.status;
    return this.integrationModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async getIntegrationById(
    integrationId: string,
    userId: string,
  ): Promise<IntegrationDocument | null> {
    return this.integrationModel
      .findOne({
        _id: new Types.ObjectId(integrationId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
  }

  async updateIntegration(
    integrationId: string,
    userId: string,
    updates: UpdateIntegrationDto,
  ): Promise<IntegrationDocument | null> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration) return null;
    if (updates.name) integration.name = updates.name;
    if (updates.description !== undefined)
      integration.description = updates.description;
    if (updates.status) integration.status = updates.status;
    if (updates.credentials)
      (integration as any).setCredentials(updates.credentials);
    if (updates.alertRouting)
      integration.alertRouting = new Map(
        Object.entries(updates.alertRouting),
      ) as any;
    if (updates.deliveryConfig) {
      integration.deliveryConfig = {
        ...integration.deliveryConfig,
        ...updates.deliveryConfig,
      };
    }
    await integration.save();
    this.logger.log('Integration updated', { integrationId, userId });
    return integration;
  }

  async deleteIntegration(
    integrationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.integrationModel
      .deleteOne({
        _id: new Types.ObjectId(integrationId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
    if (result.deletedCount === 0) return false;
    this.logger.log('Integration deleted', { integrationId, userId });
    return true;
  }

  async testIntegration(
    integrationId: string,
    userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    responseTime?: number;
  }> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }
    const credentials = (integration as any).getCredentials();
    if (integration.type === 'slack_webhook') {
      if (!credentials.webhookUrl) {
        return { success: false, message: 'Webhook URL not configured' };
      }
      const result = await this.slackService.testIntegration(
        credentials.webhookUrl,
      );
      return result;
    }
    if (integration.type === 'slack_oauth') {
      if (!credentials.accessToken || !credentials.channelId) {
        return {
          success: false,
          message: 'Slack OAuth credentials or channel not configured',
        };
      }
      const result = await this.slackService.testIntegration(
        undefined,
        credentials.accessToken,
        credentials.channelId,
      );
      return result;
    }
    if (integration.type === 'discord_webhook') {
      if (!credentials.webhookUrl) {
        return {
          success: false,
          message: 'Discord webhook URL not configured',
        };
      }
      return this.discordService.testIntegration(credentials.webhookUrl);
    }
    if (integration.type === 'discord_oauth') {
      if (!credentials.botToken || !credentials.channelId) {
        return {
          success: false,
          message: 'Discord bot credentials or channel not configured',
        };
      }
      return this.discordService.testIntegration(
        undefined,
        credentials.botToken,
        credentials.channelId,
      );
    }
    if (integration.type === 'linear_oauth') {
      if (!credentials.accessToken || !credentials.teamId) {
        return {
          success: false,
          message: 'Linear OAuth credentials or team not configured',
        };
      }
      return this.linearService.testIntegration(
        credentials.accessToken,
        credentials.teamId,
      );
    }
    if (integration.type === 'jira_oauth') {
      if (
        !credentials.accessToken ||
        !credentials.siteUrl ||
        !credentials.projectKey
      ) {
        return {
          success: false,
          message: 'JIRA OAuth credentials or project not configured',
        };
      }
      const identifier = credentials.cloudId ?? credentials.siteUrl;
      const useCloudId = !!credentials.cloudId;
      return this.jiraService.testIntegration(
        identifier,
        credentials.accessToken,
        credentials.projectKey,
        useCloudId,
      );
    }
    if (integration.type === 'custom_webhook') {
      if (!credentials.webhookUrl) {
        return { success: false, message: 'Webhook URL not configured' };
      }
      return this.slackService.testIntegration(credentials.webhookUrl);
    }
    return {
      success: false,
      message: `Unsupported integration type: ${integration.type}`,
    };
  }

  async getSlackChannels(
    integrationId: string,
    userId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'slack_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Slack OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken) {
      throw new Error('Access token not found');
    }
    return this.slackService.listChannels(credentials.accessToken);
  }

  async updateDeliveryStats(
    integrationId: string,
    success: boolean,
    responseTime: number,
  ): Promise<void> {
    const integration = await this.integrationModel
      .findById(integrationId)
      .exec();
    if (!integration) return;
    integration.stats.totalDeliveries += 1;
    if (success) {
      integration.stats.successfulDeliveries += 1;
      integration.stats.lastSuccessAt = new Date();
    } else {
      integration.stats.failedDeliveries += 1;
      integration.stats.lastFailureAt = new Date();
    }
    integration.stats.lastDeliveryAt = new Date();
    const currentAvg = integration.stats.averageResponseTime ?? 0;
    const totalCount = integration.stats.totalDeliveries;
    integration.stats.averageResponseTime =
      (currentAvg * (totalCount - 1) + responseTime) / totalCount;
    await integration.save();
  }

  async getIntegrationStats(
    integrationId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration) return null;
    const s = integration.stats;
    return {
      totalDeliveries: s.totalDeliveries,
      successfulDeliveries: s.successfulDeliveries,
      failedDeliveries: s.failedDeliveries,
      successRate:
        s.totalDeliveries > 0
          ? (s.successfulDeliveries / s.totalDeliveries) * 100
          : 0,
      averageResponseTime: s.averageResponseTime,
      lastDeliveryAt: s.lastDeliveryAt,
      lastSuccessAt: s.lastSuccessAt,
      lastFailureAt: s.lastFailureAt,
      healthStatus: integration.healthCheckStatus,
      lastHealthCheck: integration.lastHealthCheck,
    };
  }

  async getDiscordGuilds(
    integrationId: string,
    userId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'discord_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Discord OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.botToken) throw new Error('Bot token not found');
    return this.discordService.listGuilds(credentials.botToken);
  }

  async getDiscordChannels(
    integrationId: string,
    userId: string,
    guildId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'discord_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Discord OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.botToken) throw new Error('Bot token not found');
    return this.discordService.listGuildChannels(credentials.botToken, guildId);
  }

  async getLinearTeams(
    integrationId: string,
    userId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'linear_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Linear OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken) throw new Error('Access token not found');
    return this.linearService.listTeams(credentials.accessToken);
  }

  async getLinearProjects(
    integrationId: string,
    userId: string,
    teamId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'linear_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Linear OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken) throw new Error('Access token not found');
    return this.linearService.listProjects(credentials.accessToken, teamId);
  }

  async getJiraProjects(
    integrationId: string,
    userId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'jira_oauth') {
      throw new NotFoundException(
        'Integration not found or not a JIRA OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken || !credentials.siteUrl)
      throw new Error('Access token or site URL not found');
    const identifier = credentials.cloudId ?? credentials.siteUrl;
    const useCloudId = !!credentials.cloudId;
    return this.jiraService.listProjects(
      identifier,
      credentials.accessToken,
      useCloudId,
    );
  }

  async getJiraIssueTypes(
    integrationId: string,
    userId: string,
    projectKey: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'jira_oauth') {
      throw new NotFoundException(
        'Integration not found or not a JIRA OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken || !credentials.siteUrl)
      throw new Error('Access token or site URL not found');
    const identifier = credentials.cloudId ?? credentials.siteUrl;
    const useCloudId = !!credentials.cloudId;
    return this.jiraService.getIssueTypes(
      identifier,
      credentials.accessToken,
      projectKey,
      useCloudId,
    );
  }

  async getJiraPriorities(
    integrationId: string,
    userId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'jira_oauth') {
      throw new NotFoundException(
        'Integration not found or not a JIRA OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken || !credentials.siteUrl)
      throw new Error('Access token or site URL not found');
    const identifier = credentials.cloudId ?? credentials.siteUrl;
    const useCloudId = !!credentials.cloudId;
    return this.jiraService.listPriorities(
      identifier,
      credentials.accessToken,
      useCloudId,
    );
  }

  async getGoogleCalendars(
    integrationId: string,
    userId: string,
  ): Promise<unknown[]> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'google_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Google OAuth integration',
      );
    }
    return this.googleService.listCalendarsForUser(userId);
  }

  async validateLinearToken(
    accessToken: string,
  ): Promise<{ user: unknown; teams: unknown[]; projects?: unknown[] }> {
    const user = await this.linearService.getAuthenticatedUser(accessToken);
    const teams = await this.linearService.listTeams(accessToken);
    return { user, teams };
  }

  async validateJiraToken(
    accessToken: string,
    siteUrl: string,
  ): Promise<{ user: unknown; projects: unknown[] }> {
    const user = await this.jiraService.getAuthenticatedUser(
      siteUrl,
      accessToken,
      false,
    );
    const projects = await this.jiraService.listProjects(
      siteUrl,
      accessToken,
      false,
    );
    return { user, projects };
  }

  async createLinearIssue(
    integrationId: string,
    userId: string,
    body: {
      title: string;
      description?: string;
      teamId: string;
      projectId?: string;
    },
  ): Promise<{ issueId: string; issueUrl: string }> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'linear_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Linear OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken)
      throw new Error('Linear access token not configured');
    const alertLike = {
      _id: '',
      title: body.title,
      message: body.description ?? body.title,
      type: 'system',
      severity: 'medium' as const,
      createdAt: new Date(),
      data: {},
    };
    const result = await this.linearService.createIssueFromAlert(
      credentials.accessToken,
      body.teamId,
      body.projectId,
      alertLike,
      undefined,
    );
    if (!result.issueId || !result.issueUrl)
      throw new Error('Linear issue creation failed');
    return { issueId: result.issueId, issueUrl: result.issueUrl };
  }

  async updateLinearIssue(
    integrationId: string,
    userId: string,
    issueId: string,
    updates: {
      title?: string;
      description?: string;
      stateId?: string;
      priority?: number;
    },
  ): Promise<{ responseTime: number }> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'linear_oauth') {
      throw new NotFoundException(
        'Integration not found or not a Linear OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken)
      throw new Error('Linear access token not configured');
    const result = await this.linearService.updateIssue(
      credentials.accessToken,
      issueId,
      updates,
    );
    return { responseTime: result.responseTime };
  }

  async createJiraIssue(
    integrationId: string,
    userId: string,
    body: {
      title: string;
      description?: string;
      projectKey: string;
      issueTypeId: string;
      priorityId?: string;
      labels?: string[];
      components?: Array<{ id: string }>;
    },
  ): Promise<{ issueKey: string; issueUrl: string }> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'jira_oauth') {
      throw new NotFoundException(
        'Integration not found or not a JIRA OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken || !credentials.siteUrl)
      throw new Error('JIRA access token or site URL not configured');
    const identifier = credentials.cloudId ?? credentials.siteUrl;
    const useCloudId = !!credentials.cloudId;
    const alertLike = {
      _id: '',
      title: body.title,
      message: body.description ?? body.title,
      type: 'system',
      severity: 'medium' as const,
      createdAt: new Date(),
      data: {},
    };
    const result = await this.jiraService.createIssueFromAlert(
      identifier,
      credentials.accessToken,
      body.projectKey,
      body.issueTypeId,
      alertLike,
      undefined,
      body.priorityId,
      body.labels,
      body.components,
      useCloudId,
      credentials.siteUrl,
    );
    if (!result.issueKey || !result.issueUrl)
      throw new Error('JIRA issue creation failed');
    return { issueKey: result.issueKey, issueUrl: result.issueUrl };
  }

  async updateJiraIssue(
    integrationId: string,
    userId: string,
    issueKey: string,
    updates: {
      summary?: string;
      description?: string;
      priorityId?: string;
      labels?: string[];
    },
  ): Promise<{ responseTime: number }> {
    const integration = await this.getIntegrationById(integrationId, userId);
    if (!integration || integration.type !== 'jira_oauth') {
      throw new NotFoundException(
        'Integration not found or not a JIRA OAuth integration',
      );
    }
    const credentials = (integration as any).getCredentials();
    if (!credentials.accessToken || !credentials.siteUrl)
      throw new Error('JIRA access token or site URL not configured');
    const identifier = credentials.cloudId ?? credentials.siteUrl;
    const useCloudId = !!credentials.cloudId;
    const result = await this.jiraService.updateIssue(
      identifier,
      credentials.accessToken,
      issueKey,
      updates,
      useCloudId,
    );
    return { responseTime: result.responseTime };
  }
}
