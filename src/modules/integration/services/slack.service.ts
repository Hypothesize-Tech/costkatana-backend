/**
 * Slack integration service – production implementation.
 * Format alerts, send via webhook/OAuth, list channels, test.
 */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { formatCurrency } from '../../../utils/helpers';

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
  attachments?: unknown[];
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private static readonly SLACK_API_BASE = 'https://slack.com/api';

  constructor(private readonly httpService: HttpService) {}

  async sendWebhookMessage(
    webhookUrl: string,
    message: SlackMessage,
  ): Promise<{ success: boolean; responseTime: number }> {
    const startTime = Date.now();
    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, message, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }),
      );
      const responseTime = Date.now() - startTime;
      this.logger.log('Slack webhook message sent successfully');
      return { success: true, responseTime };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Failed to send Slack webhook message', {
        error: error instanceof Error ? error.message : String(error),
        responseTime,
      });
      throw error;
    }
  }

  async sendOAuthMessage(
    accessToken: string,
    channelId: string,
    message: SlackMessage,
  ): Promise<{ success: boolean; responseTime: number; messageTs?: string }> {
    const startTime = Date.now();
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${SlackService.SLACK_API_BASE}/chat.postMessage`,
          {
            channel: channelId,
            text: message.text,
            blocks: message.blocks,
            attachments: message.attachments,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        ),
      );
      const responseTime = Date.now() - startTime;
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }
      this.logger.log('Slack OAuth message sent successfully');
      return { success: true, responseTime, messageTs: data.ts };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Failed to send Slack OAuth message', {
        error: error instanceof Error ? error.message : String(error),
        responseTime,
      });
      throw error;
    }
  }

  formatAlertMessage(
    alert: {
      _id: unknown;
      title: string;
      message: string;
      type: string;
      severity: string;
      createdAt: Date;
      data: Record<string, unknown>;
      actionRequired?: boolean;
    },
    dashboardUrl?: string,
  ): SlackMessage {
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    const severityColor = this.getSeverityColor(alert.severity);
    const text = `${severityEmoji} ${alert.title}`;
    const createdAt =
      alert.createdAt instanceof Date
        ? alert.createdAt
        : new Date(alert.createdAt);
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityEmoji} ${alert.title}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Type:*\n${this.formatAlertType(alert.type)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${alert.severity.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n<!date^${Math.floor(createdAt.getTime() / 1000)}^{date_short_pretty} at {time}|${createdAt.toISOString()}>`,
          },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: alert.message },
      },
    ];
    if (
      alert.data?.currentValue !== undefined &&
      alert.data?.threshold !== undefined
    ) {
      const percentage =
        (alert.data.percentage as number) ??
        ((alert.data.currentValue as number) /
          (alert.data.threshold as number)) *
          100;
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Current Cost:*\n${formatCurrency(alert.data.currentValue as number)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Threshold:*\n${formatCurrency(alert.data.threshold as number)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Percentage:*\n${Number(percentage).toFixed(1)}%`,
          },
          {
            type: 'mrkdwn',
            text: `*Period:*\n${(alert.data.period as string) || 'N/A'}`,
          },
        ],
      });
    }
    if (dashboardUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📊 View Dashboard',
              emoji: true,
            },
            url: dashboardUrl,
            style: 'primary',
          },
          ...(alert.actionRequired
            ? [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '⚡ Take Action',
                    emoji: true,
                  },
                  url: `${dashboardUrl}/alerts/${alert._id}`,
                  style: 'danger',
                },
              ]
            : []),
        ],
      });
    }
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🤖 Cost Katana Alert System | Alert ID: \`${alert._id}\``,
        },
      ],
    });
    return {
      text,
      blocks,
      attachments: [{ color: severityColor, fallback: text }],
    };
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

  private getSeverityColor(severity: string): string {
    const map: Record<string, string> = {
      low: '#36a64f',
      medium: '#ffb700',
      high: '#ff6b00',
      critical: '#ff0000',
    };
    return map[severity] ?? '#808080';
  }

  private formatAlertType(type: string): string {
    return type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  async listChannels(accessToken: string): Promise<unknown[]> {
    const { data } = await firstValueFrom(
      this.httpService.get(
        `${SlackService.SLACK_API_BASE}/conversations.list`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { types: 'public_channel,private_channel', limit: 100 },
        },
      ),
    );
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
    return data.channels ?? [];
  }

  async listUsers(
    accessToken: string,
    options?: { limit?: number },
  ): Promise<
    Array<{ id: string; name: string; real_name?: string; email?: string }>
  > {
    const limit = options?.limit ?? 100;
    const { data } = await firstValueFrom(
      this.httpService.get(`${SlackService.SLACK_API_BASE}/users.list`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit },
      }),
    );
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
    const members = data.members ?? [];
    return members
      .filter((m: { deleted?: boolean; is_bot?: boolean }) => !m.deleted)
      .map(
        (m: {
          id: string;
          name: string;
          real_name?: string;
          profile?: { email?: string };
        }) => ({
          id: m.id,
          name: m.name,
          real_name: m.real_name,
          email: m.profile?.email,
        }),
      );
  }

  async testIntegration(
    webhookUrl?: string,
    accessToken?: string,
    channelId?: string,
  ): Promise<{ success: boolean; message: string; responseTime: number }> {
    const testMessage: SlackMessage = {
      text: '✅ Slack Integration Test',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '✅ Slack Integration Test',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Your Slack integration is working correctly! Cost Katana is now connected and ready to send alerts.',
          },
        },
      ],
    };
    try {
      let result: { responseTime: number };
      if (webhookUrl) {
        result = await this.sendWebhookMessage(webhookUrl, testMessage);
      } else if (accessToken && channelId) {
        result = await this.sendOAuthMessage(
          accessToken,
          channelId,
          testMessage,
        );
      } else {
        throw new Error(
          'Either webhookUrl or (accessToken and channelId) must be provided',
        );
      }
      return {
        success: true,
        message: 'Test message sent successfully',
        responseTime: result.responseTime,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to send test message',
        responseTime: 0,
      };
    }
  }
}
