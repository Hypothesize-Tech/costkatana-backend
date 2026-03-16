/**
 * Notification service – send alerts to integrations (Slack, Discord, Linear, JIRA, custom webhook).
 * Production implementation with retries, delivery status, and delivery logs.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Alert, AlertDocument } from '../../schemas/core/alert.schema';
import {
  Integration,
  IntegrationDocument,
} from '../../schemas/integration/integration.schema';
import { User, UserDocument } from '../../schemas/user/user.schema';
import { IntegrationService } from './integration.service';
import { SlackService } from './services/slack.service';
import { DiscordService } from './services/discord.service';
import { LinearService } from './services/linear.service';
import { JiraService } from './services/jira.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const DEFAULT_DASHBOARD_URL =
  process.env.FRONTEND_URL ?? 'https://app.costkatana.com';

export interface AlertLike {
  _id: unknown;
  userId: unknown;
  type: string;
  title: string;
  message: string;
  severity: string;
  createdAt: Date;
  data: Record<string, unknown>;
  actionRequired?: boolean;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(Alert.name) private alertModel: Model<AlertDocument>,
    @InjectModel(Integration.name)
    private integrationModel: Model<IntegrationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly integrationService: IntegrationService,
    private readonly slackService: SlackService,
    private readonly discordService: DiscordService,
    private readonly linearService: LinearService,
    private readonly jiraService: JiraService,
    private readonly httpService: HttpService,
  ) {}

  async sendAlert(alert: AlertDocument): Promise<void> {
    try {
      const userId = String(alert.userId);
      const dashboardUrl = DEFAULT_DASHBOARD_URL;
      const user = await this.userModel.findById(userId).lean().exec();
      if (!user) {
        this.logger.warn(`User not found for alert ${alert._id}`);
        return;
      }
      const targetIntegrations = await this.getTargetIntegrations(
        alert,
        user as Record<string, unknown>,
      );
      if (targetIntegrations.length === 0) {
        this.logger.log(`No integrations configured for alert ${alert._id}`);
        return;
      }
      alert.deliveryChannels = targetIntegrations.map((i) => String(i._id));
      alert.deliveryStatus = new Map();
      for (const integration of targetIntegrations) {
        alert.deliveryStatus.set(String(integration._id), {
          status: 'pending',
          attempts: 0,
        });
      }
      await alert.save();
      const promises = targetIntegrations.map((integration) =>
        this.deliverToIntegration(alert, integration, dashboardUrl),
      );
      await Promise.allSettled(promises);
      this.logger.log(
        `Alert sent to integrations alertId=${alert._id} count=${targetIntegrations.length}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send alert: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getTargetIntegrations(
    alert: AlertDocument,
    user: Record<string, unknown>,
  ): Promise<IntegrationDocument[]> {
    const userId = String(alert.userId);
    const allIntegrations = await this.integrationModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .exec();
    if (allIntegrations.length === 0) return [];
    const target: IntegrationDocument[] = [];
    for (const integration of allIntegrations) {
      const routingRule = integration.alertRouting?.get(alert.type as any);
      if (routingRule) {
        if (
          routingRule.enabled &&
          (routingRule.severities.length === 0 ||
            routingRule.severities.includes(alert.severity))
        ) {
          target.push(integration);
        }
      } else {
        const defaultChannels =
          (user?.preferences as any)?.integrations?.defaultChannels ?? [];
        const alertTypeRouting =
          (user?.preferences as any)?.integrations?.alertTypeRouting?.get?.(
            alert.type,
          ) ?? [];
        const integrationId = String(integration._id);
        if (
          alertTypeRouting.includes(integrationId) ||
          defaultChannels.includes(integrationId)
        ) {
          target.push(integration);
        }
      }
    }
    return target;
  }

  private async deliverToIntegration(
    alert: AlertDocument,
    integration: IntegrationDocument,
    dashboardUrl: string,
  ): Promise<void> {
    const integrationId = String(integration._id);
    const maxRetries = integration.deliveryConfig?.retryEnabled
      ? integration.deliveryConfig.maxRetries
      : 0;
    let attempts = 0;
    let lastError: string | undefined;
    const alertLike = this.toAlertLike(alert);

    while (attempts <= maxRetries) {
      try {
        attempts++;
        const currentStatus = alert.deliveryStatus?.get(integrationId);
        if (currentStatus) {
          currentStatus.status = attempts > 1 ? 'retrying' : 'pending';
          currentStatus.attempts = attempts;
          await alert.save();
        }
        const result = await this.sendToIntegration(
          alertLike,
          integration,
          dashboardUrl,
        );
        if (currentStatus) {
          currentStatus.status = 'sent';
          currentStatus.sentAt = new Date();
          currentStatus.responseTime = result.responseTime;
          await alert.save();
        }
        await this.integrationService.updateDeliveryStats(
          integrationId,
          true,
          result.responseTime,
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Delivery failed alertId=${alert._id} integrationId=${integrationId} attempt=${attempts}`,
        );
        if (attempts > maxRetries) {
          const currentStatus = alert.deliveryStatus?.get(integrationId);
          if (currentStatus) {
            currentStatus.status = 'failed';
            currentStatus.lastError = lastError;
            await alert.save();
          }
          await this.integrationService.updateDeliveryStats(
            integrationId,
            false,
            0,
          );
        } else {
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
  }

  private toAlertLike(alert: AlertDocument): AlertLike {
    return {
      _id: alert._id,
      userId: alert.userId,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      createdAt: alert.createdAt,
      data: alert.data ?? {},
      actionRequired: alert.actionRequired,
    };
  }

  private async sendToIntegration(
    alert: AlertLike,
    integration: IntegrationDocument,
    dashboardUrl: string,
  ): Promise<{ responseTime: number }> {
    const credentials = (integration as any).getCredentials();

    switch (integration.type) {
      case 'slack_webhook':
        if (!credentials.webhookUrl)
          throw new Error('Slack webhook URL not configured');
        return this.slackService.sendWebhookMessage(
          credentials.webhookUrl,
          this.slackService.formatAlertMessage(alert as any, dashboardUrl),
        );
      case 'slack_oauth':
        if (!credentials.accessToken || !credentials.channelId)
          throw new Error('Slack OAuth credentials not configured');
        return this.slackService.sendOAuthMessage(
          credentials.accessToken,
          credentials.channelId,
          this.slackService.formatAlertMessage(alert as any, dashboardUrl),
        );
      case 'discord_webhook':
        if (!credentials.webhookUrl)
          throw new Error('Discord webhook URL not configured');
        return this.discordService.sendWebhookMessage(
          credentials.webhookUrl,
          this.discordService.formatAlertMessage(alert, dashboardUrl),
        );
      case 'discord_oauth':
        if (!credentials.botToken || !credentials.channelId)
          throw new Error('Discord bot credentials not configured');
        return this.discordService.sendBotMessage(
          credentials.botToken,
          credentials.channelId,
          this.discordService.formatAlertMessage(alert, dashboardUrl),
        );
      case 'linear_oauth': {
        if (!credentials.accessToken)
          throw new Error('Linear OAuth credentials not configured');
        const linearIssueId = credentials.issueId;
        const autoCreateIssues =
          (integration.metadata as any)?.autoCreateIssues === true;
        if (linearIssueId) {
          return this.linearService.sendAlertComment(
            credentials.accessToken,
            linearIssueId,
            alert,
            dashboardUrl,
          );
        }
        if (autoCreateIssues && credentials.teamId) {
          return this.linearService.createIssueFromAlert(
            credentials.accessToken,
            credentials.teamId,
            credentials.projectId,
            alert,
            dashboardUrl,
          );
        }
        throw new Error(
          'Linear integration not configured: missing issueId or teamId with autoCreateIssues',
        );
      }
      case 'jira_oauth': {
        if (!credentials.accessToken || !credentials.siteUrl)
          throw new Error('JIRA OAuth credentials not configured');
        const identifier = credentials.cloudId ?? credentials.siteUrl;
        const useCloudId = !!credentials.cloudId;
        const jiraIssueKey = credentials.issueKey;
        const autoCreateIssues =
          (integration.metadata as any)?.autoCreateIssues === true;
        if (jiraIssueKey) {
          return this.jiraService.sendAlertComment(
            identifier,
            credentials.accessToken,
            jiraIssueKey,
            alert,
            dashboardUrl,
            useCloudId,
          );
        }
        if (
          autoCreateIssues &&
          credentials.projectKey &&
          credentials.issueTypeId
        ) {
          return this.jiraService.createIssueFromAlert(
            identifier,
            credentials.accessToken,
            credentials.projectKey,
            credentials.issueTypeId,
            alert,
            dashboardUrl,
            credentials.priorityId,
            credentials.labels,
            credentials.components,
            useCloudId,
            credentials.siteUrl,
          );
        }
        throw new Error(
          'JIRA integration not configured: missing issueKey or projectKey/issueTypeId with autoCreateIssues',
        );
      }
      case 'custom_webhook':
        if (!credentials.webhookUrl)
          throw new Error('Custom webhook URL not configured');
        const start = Date.now();
        await firstValueFrom(
          this.httpService.post(
            credentials.webhookUrl,
            {
              alert: {
                id: alert._id,
                type: alert.type,
                title: alert.title,
                message: alert.message,
                severity: alert.severity,
                data: alert.data,
                createdAt: alert.createdAt,
              },
            },
            {
              timeout: integration.deliveryConfig?.timeout ?? 30000,
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'CostKatana-Alert-System/1.0',
              },
            },
          ),
        );
        return { responseTime: Date.now() - start };
      default:
        throw new Error(`Unsupported integration type: ${integration.type}`);
    }
  }

  async getDeliveryLogs(
    userId: string,
    integrationId?: string,
    filters?: {
      status?: string;
      alertType?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (integrationId) query.deliveryChannels = integrationId;
    if (filters?.alertType) query.type = filters.alertType;
    if (filters?.startDate || filters?.endDate) {
      query.createdAt = {};
      if (filters.startDate) (query.createdAt as any).$gte = filters.startDate;
      if (filters.endDate) (query.createdAt as any).$lte = filters.endDate;
    }
    const alerts = await this.alertModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filters?.limit ?? 100)
      .lean()
      .exec();
    const logs: unknown[] = [];
    for (const alert of alerts) {
      const deliveryStatus = alert.deliveryStatus as
        | Record<
            string,
            {
              status: string;
              sentAt?: Date;
              responseTime?: number;
              attempts?: number;
              lastError?: string;
            }
          >
        | undefined;
      if (!deliveryStatus) continue;
      const entries =
        deliveryStatus instanceof Map
          ? Array.from(deliveryStatus.entries())
          : Object.entries(deliveryStatus ?? {});
      for (const [intId, status] of entries) {
        if (integrationId && intId !== integrationId) continue;
        if (filters?.status && status.status !== filters.status) continue;
        logs.push({
          alertId: alert._id,
          alertType: alert.type,
          alertTitle: alert.title,
          alertSeverity: alert.severity,
          integrationId: intId,
          status: status.status,
          sentAt: status.sentAt,
          responseTime: status.responseTime,
          attempts: status.attempts,
          lastError: status.lastError,
          createdAt: alert.createdAt,
        });
      }
    }
    return logs;
  }

  async retryFailedDeliveries(alertId: string): Promise<void> {
    const alert = await this.alertModel.findById(alertId).exec();
    if (!alert) throw new Error('Alert not found');
    const failedIds: string[] = [];
    alert.deliveryStatus?.forEach((status, integrationId) => {
      if (status.status === 'failed') failedIds.push(integrationId);
    });
    if (failedIds.length === 0) return;
    const integrations = await this.integrationModel
      .find({
        _id: { $in: failedIds.map((id) => new Types.ObjectId(id)) },
        status: 'active',
      })
      .exec();
    const dashboardUrl = DEFAULT_DASHBOARD_URL;
    await Promise.allSettled(
      integrations.map((integration) =>
        this.deliverToIntegration(alert, integration, dashboardUrl),
      ),
    );
    this.logger.log(
      `Retried failed deliveries alertId=${alertId} count=${integrations.length}`,
    );
  }
}
